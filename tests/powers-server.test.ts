import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { BALANCE_VERSION } from '../src/config/version';
import { POWER_CODES } from '../src/config/powers';
import { createSimulation } from '../src/modes/run';
import { REPLAY_FORMAT, REPLAY_FORMAT_POWERS, type LeaderboardResponse, type MeResponse, type RegisterResponse, type RunResponse, type RunSubmission, type Ticket, type TicketsResponse } from '../src/net/protocol';
import { defaultSave } from '../src/save/save';
import { Bot } from '../src/sim/bot';
import { createApp, type HttpRequest, type HttpResponse } from '../server/app';
import { MIGRATIONS, openDb, type Db } from '../server/db';
import { inventoryOf } from '../server/profile';
import { replaySurvival } from '../server/verify';
import { signTicket } from '../server/auth';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';
const INSTALL = 'install-pow-0001';

function ctx(db: Db = openDb(':memory:')) {
  const now = { t: 1_700_000_000_000 };
  const app = createApp(db, { ticketSecret: SECRET, now: () => now.t, balance: BALANCE_VERSION });
  const call = (method: string, path: string, o: { body?: unknown; token?: string; query?: string; ip?: string } = {}): HttpResponse => {
    const req: HttpRequest = { method, path, query: new URLSearchParams(o.query ?? ''), headers: { authorization: o.token ? `Bearer ${o.token}` : undefined }, body: o.body, ip: o.ip ?? '10.0.0.1' };
    return app(req);
  };
  return { db, now, call };
}
type Ctx = ReturnType<typeof ctx>;

function player(c: Ctx, nickname: string, ip = '10.0.0.1'): { id: string; auth: string } {
  const res = c.call('POST', '/api/register', { body: { nickname }, ip });
  expect(res.status).toBe(201);
  const b = res.body as RegisterResponse;
  return { id: b.playerId, auth: `${b.playerId}.${b.token}` };
}

const tickets = (c: Ctx, auth: string): Ticket[] => (c.call('POST', '/api/tickets', { token: auth }).body as TicketsResponse).tickets;

interface PlayedRun {
  flips: number[];
  acts: [number, number][];
  time: number;
  score: number;
}

/** Joue une partie de Survie avec le code du jeu (première vie jusqu'à la mort), avec des activations planifiées. */
function play(seed: number, plan: (sim: ReturnType<typeof createSimulation>, i: number) => void = () => undefined, stock = { boost: 9, gel: 9 }): PlayedRun {
  const sim = createSimulation({ mode: 'survival', seed, stock });
  for (let i = 0; i < 120 * 900 && sim.state === 'running'; i++) {
    if (i % 29 === 7) sim.flip();
    plan(sim, i);
    sim.step();
    sim.events.length = 0;
  }
  expect(sim.state).toBe('dead');
  return { flips: [...sim.flipLog], acts: sim.powers.log.map((a) => [a.step, POWER_CODES[a.kind]] as [number, number]), time: sim.time, score: sim.scoring.score };
}

const planBoostGel = (sim: ReturnType<typeof createSimulation>, i: number): void => {
  if (i === 20) sim.power('boost');
  if (i === 650) sim.power('gel');
  if (sim.powers.shieldStored) sim.power('shield');
};

/** Tire des tickets jusqu'à en trouver un dont la partie (graine imposée par le serveur) satisfait le critère. */
const pools = new WeakMap<Ctx, Ticket[]>();
function pick(c: Ctx, auth: string, plan: (sim: ReturnType<typeof createSimulation>, i: number) => void, ok: (r: PlayedRun) => boolean = () => true, skip: Set<string> = new Set()): { t: Ticket; run: PlayedRun } {
  if (!pools.has(c)) pools.set(c, [...tickets(c, auth), ...tickets(c, auth)]);
  {
    for (const t of pools.get(c)!) {
      if (skip.has(t.id)) continue;
      const run = play(t.seed, plan);
      if (ok(run)) {
        skip.add(t.id);
        return { t, run };
      }
    }
  }
  throw new Error('aucune graine adaptée');
}
const hasBoostGel = (r: PlayedRun): boolean => r.acts.some((a) => a[1] === 0) && r.acts.some((a) => a[1] === 1);
const hasBoost = (r: PlayedRun): boolean => r.acts.some((a) => a[1] === 0);
const none = (r: PlayedRun): boolean => r.acts.length === 0;

const sub = (t: Ticket, r: PlayedRun, o: { v?: 1 | 2; acts?: [number, number][]; client?: Partial<RunSubmission['client']> } = {}): RunSubmission => ({
  ticket: t,
  replay: { v: o.v ?? REPLAY_FORMAT_POWERS, flips: r.flips, acts: o.acts ?? r.acts },
  claimed: { time: r.time, score: r.score },
  client: { balance: BALANCE_VERSION, build: 'test', installId: INSTALL, bonusBought: { boost: 0, gel: 0 }, ...o.client },
});

/** Crédite le joueur par le chemin normal (Éclats gagnés puis achat de bonus confirmé par le service). */
function stockUp(c: Ctx, auth: string, boost: number, gel: number): void {
  const res = c.call('POST', '/api/sync', { token: auth, body: { installId: INSTALL, earned: 1500, purchases: {}, claims: [], bonusBought: { boost, gel }, save: defaultSave() } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const send = (c: Ctx, auth: string, s: RunSubmission): HttpResponse => {
  c.now.t += 4000; // un résultat toutes les 3 s au plus
  return c.call('POST', '/api/runs', { token: auth, body: s });
};

describe('rejeu avec pouvoirs : le service juge chaque activation', () => {
  it('une partie sans activation reste identique à l’ancien rejeu (format 1 comme format 2) : catégorie « sans bonus »', () => {
    const r = play(31);
    expect(r.acts).toEqual([]);
    const v1 = replaySurvival(31, r.flips);
    const v2 = replaySurvival(31, r.flips, []);
    expect(v1).toEqual(v2);
    expect(v1.ok && v1.category).toBe('plain');
    expect(v1.ok && Math.abs(v1.time - r.time) < 1e-9 && v1.score === r.score).toBe(true);
  });

  it('les activations (Boost, Gel, Bouclier) sont rejouées à l’identique : même durée, même score, catégorie « avec bonus »', () => {
    const seed = [77, 11, 12, 31, 201, 202, 203, 204].find((sd) => hasBoostGel(play(sd, planBoostGel)))!;
    const r = play(seed, planBoostGel);
    expect(r.acts.length).toBeGreaterThanOrEqual(2);
    const rep = replaySurvival(seed, r.flips, r.acts);
    expect(rep.ok).toBe(true);
    if (!rep.ok) return;
    expect(rep.time).toBeCloseTo(r.time, 9);
    expect(rep.score).toBe(r.score);
    expect(rep.category).toBe('bonus');
    expect(rep.powers.boost).toBe(1);
    expect(rep.powers.gel).toBe(1);
    // Le même journal SANS les activations ne reproduit pas la partie (le Boost et le Gel ont de vrais effets)
    const without = replaySurvival(seed, r.flips, []);
    expect(!without.ok || without.time !== rep.time || without.score !== rep.score).toBe(true);
  });

  it('journal falsifié : activation refusée par les règles, hors délai, après la mort, ou mal formée', () => {
    const seed = [77, 11, 12, 31, 201, 202, 203, 204].find((sd) => hasBoostGel(play(sd, planBoostGel)))!;
    const r = play(seed, planBoostGel);
    const first = r.acts[0];
    // Deux Boosts dans les 10 s (recharge) → refusé
    expect(replaySurvival(seed, r.flips, [first, [first[0] + 60, POWER_CODES.boost], ...r.acts.slice(1)])).toEqual({ ok: false, reason: 'bad_powers' });
    // Gel pendant le Boost (exclusivité) → refusé
    expect(replaySurvival(seed, r.flips, [first, [first[0] + 10, POWER_CODES.gel]])).toEqual({ ok: false, reason: 'bad_powers' });
    // Bouclier sans les 18 balises → refusé
    expect(replaySurvival(seed, r.flips, [[5, POWER_CODES.shield], ...r.acts])).toEqual({ ok: false, reason: 'bad_powers' });
    // Plus de 3 Boosts dans la première vie → refusé (3 × recharge de 10 s)
    const four = [0, 1300, 2600, 3900].map((s) => [s, POWER_CODES.boost] as [number, number]);
    expect(replaySurvival(seed, r.flips, four).ok).toBe(false);
    // Activation après la mort
    const late = [...r.acts, [Math.round(r.time * 120) + 500, POWER_CODES.boost] as [number, number]];
    expect(replaySurvival(seed, r.flips, late)).toEqual({ ok: false, reason: 'inputs_after_end' });
  });
});

describe('service : deux classements, catégorie déduite du rejeu', () => {
  it('sans activation → « sans bonus » ; avec une activation réussie → « avec bonus » ; records distincts par catégorie', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    stockUp(c, p.auth, 3, 3);
    const used = new Set<string>();
    const { t: t1, run: plain } = pick(c, p.auth, () => undefined, none, used);
    const r1 = send(c, p.auth, sub(t1, plain, { client: { bonusBought: { boost: 3, gel: 3 } } })).body as RunResponse;
    expect(r1).toMatchObject({ status: 'accepted', category: 'plain' });
    const { t: t2, run: bonus } = pick(c, p.auth, planBoostGel, hasBoostGel, used);
    const r2 = send(c, p.auth, sub(t2, bonus, { client: { bonusBought: { boost: 3, gel: 3 } } })).body as RunResponse;
    expect(r2).toMatchObject({ status: 'accepted', category: 'bonus', powers: { boost: 1, gel: 1 } });
    const lbPlain = c.call('GET', '/api/leaderboard', { query: 'category=plain', token: p.auth }).body as LeaderboardResponse;
    const lbBonus = c.call('GET', '/api/leaderboard', { query: 'category=bonus', token: p.auth }).body as LeaderboardResponse;
    expect(lbPlain.category).toBe('plain');
    expect(lbPlain.entries).toHaveLength(1);
    expect(lbPlain.entries[0].score).toBe(plain.score);
    expect(lbBonus.entries).toHaveLength(1);
    expect(lbBonus.entries[0].score).toBe(bonus.score);
    // Par défaut : sans bonus (comme l'ancien classement)
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries[0].score).toBe(plain.score);
    const me = c.call('GET', '/api/me', { token: p.auth, query: 'category=bonus' }).body as MeResponse;
    expect(me.bests.plain?.score).toBe(plain.score);
    expect(me.bests.bonus?.score).toBe(bonus.score);
    expect(me.best?.score).toBe(bonus.score);
  });

  it('les charges utilisées sont consommées par le rejeu (une seule fois) ; un ticket ne sert qu’une fois ; l’inventaire ne ment pas', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    stockUp(c, p.auth, 3, 3);
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 3, gel: 3 });
    const { t: t1, run } = pick(c, p.auth, planBoostGel, hasBoostGel);
    expect(send(c, p.auth, sub(t1, run, { client: { bonusBought: { boost: 3, gel: 3 } } })).status).toBe(200);
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 2, gel: 2 });
    const again = send(c, p.auth, sub(t1, run));
    expect(again.status).toBe(422);
    expect(again.body).toMatchObject({ reason: 'ticket_used' });
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 2, gel: 2 });
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'use:%'").get()).toEqual({ n: 2 });
  });

  it('les mêmes charges ne financent pas deux records : le second record est refusé faute de charges', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    stockUp(c, p.auth, 1, 0);
    const boostOnly = (sim: ReturnType<typeof createSimulation>, i: number): void => {
      if (i === 20) sim.power('boost');
    };
    const used = new Set<string>();
    const { t: t1, run: a } = pick(c, p.auth, boostOnly, hasBoost, used);
    const { t: t2, run: b } = pick(c, p.auth, boostOnly, hasBoost, used);
    const client = { bonusBought: { boost: 1, gel: 0 } };
    expect(send(c, p.auth, sub(t1, a, { client })).body).toMatchObject({ status: 'accepted', category: 'bonus' });
    const second = send(c, p.auth, sub(t2, b, { client }));
    expect(second.status).toBe(422);
    expect(second.body).toMatchObject({ reason: 'bonus_unfunded' });
    expect(inventoryOf(c.db, p.id).boost).toBe(0);
  });

  it('achats pas encore synchronisés : « réessayer après synchronisation » (ticket conservé) ; puis acceptée une fois les achats traités', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const { t: t1, run } = pick(c, p.auth, planBoostGel, hasBoostGel);
    const early = send(c, p.auth, sub(t1, run, { client: { bonusBought: { boost: 3, gel: 3 } } }));
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ reason: 'bonus_sync_required' });
    expect(c.db.prepare('SELECT used_at FROM tickets WHERE id = ?').get(t1.id)).toEqual({ used_at: null });
    stockUp(c, p.auth, 3, 3);
    expect(send(c, p.auth, sub(t1, run, { client: { bonusBought: { boost: 3, gel: 3 } } })).status).toBe(200);
  });

  it('achat hors ligne refusé par le service (fonds insuffisants) : le record qui en dépendait est refusé, un record indépendant reste valide', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    // Aucun Éclat gagné : l'achat de 3 Boosts est refusé au traitement
    const res = c.call('POST', '/api/sync', { token: p.auth, body: { installId: INSTALL, earned: 0, purchases: {}, claims: [], bonusBought: { boost: 3, gel: 3 }, save: defaultSave() } });
    expect((res.body as { bonusRejected: { boost: number } }).bonusRejected.boost).toBe(3);
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 0, gel: 0 });
    const used = new Set<string>();
    const { t: t1, run: dependent } = pick(c, p.auth, planBoostGel, hasBoostGel, used);
    const refused = send(c, p.auth, sub(t1, dependent, { client: { bonusBought: { boost: 3, gel: 3 } } }));
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ reason: 'bonus_unfunded' });
    // Une partie sans bonus du même joueur est homologuée normalement
    const { t: t2, run: independent } = pick(c, p.auth, () => undefined, none, used);
    expect(send(c, p.auth, sub(t2, independent)).body).toMatchObject({ status: 'accepted', category: 'plain' });
  });

  it('le Bouclier est gratuit : rejoué sans aucune charge, classé « avec bonus » ; refus si la jauge n’est pas pleine', () => {
    const seed = 5;
    const sim = createSimulation({ mode: 'survival', seed, stock: { boost: 0, gel: 0 } });
    const bot = new Bot(sim, true);
    for (let i = 0; i < 120 * 900 && sim.state === 'running'; i++) {
      if (sim.powers.used.shield === 0) bot.tick();
      else if (i % 29 === 7) sim.flip();
      if (sim.powers.shieldStored) sim.power('shield');
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.state).toBe('dead');
    expect(sim.powers.used.shield).toBeGreaterThan(0);
    const acts = sim.powers.log.map((a) => [a.step, POWER_CODES[a.kind]] as [number, number]);
    const rep = replaySurvival(seed, [...sim.flipLog], acts);
    expect(rep.ok && rep.category).toBe('bonus');
    expect(rep.ok && rep.powers).toMatchObject({ boost: 0, gel: 0 });
    expect(rep.ok && rep.powers.shield).toBe(sim.powers.used.shield);
    expect(replaySurvival(seed, [...sim.flipLog], [[acts[0][0] - 600, POWER_CODES.shield]])).toEqual({ ok: false, reason: 'bad_powers' });
  });

  it('journaux invalides : forme refusée (400), ancien format avec activations refusé, journal falsifié refusé et ticket consommé', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    stockUp(c, p.auth, 3, 3);
    const used = new Set<string>();
    const { t: t1, run } = pick(c, p.auth, planBoostGel, hasBoostGel, used);
    const t2 = pick(c, p.auth, () => undefined, () => true, used).t;
    const { t: t3, run: run3 } = pick(c, p.auth, planBoostGel, hasBoostGel, used);
    const { t: t4, run: plain } = pick(c, p.auth, () => undefined, none, used);
    expect(send(c, p.auth, sub(t1, run, { acts: [[5, 9]] as [number, number][] })).status).toBe(400);
    expect(send(c, p.auth, sub(t1, run, { v: 1 })).status).toBe(400); // format 1 : jamais d'activations
    expect(send(c, p.auth, { ...sub(t1, run), replay: { v: 3 as never, flips: run.flips } }).status).toBe(400);
    // Journal falsifié : Gel pendant le Boost
    const bad = send(c, p.auth, sub(t2, run, { acts: [run.acts[0], [run.acts[0][0] + 10, POWER_CODES.gel]], client: { bonusBought: { boost: 3, gel: 3 } } }));
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ reason: 'bad_powers' });
    expect(send(c, p.auth, sub(t2, run)).body).toMatchObject({ reason: 'ticket_used' });
    // Annonce falsifiée (score) : divergence ; l'inventaire n'a pas bougé
    const lie = send(c, p.auth, { ...sub(t3, run3, { client: { bonusBought: { boost: 3, gel: 3 } } }), claimed: { time: run3.time + 50, score: run3.score * 3 } });
    expect(lie.status).toBe(422);
    expect(lie.body).toMatchObject({ reason: 'divergence' });
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 3, gel: 3 });
    // Format 1 sans activation : toujours accepté (compatibilité des anciens clients et des parties en attente)
    expect(send(c, p.auth, { ...sub(t4, plain), replay: { v: REPLAY_FORMAT, flips: plain.flips } }).body).toMatchObject({ status: 'accepted', category: 'plain' });
  });
});

describe('migration SQLite v4 → v5 : les anciens records rejoignent « sans bonus », rien n’est perdu ni dupliqué', () => {
  it('records, pseudos, versions d’équilibrage et parties conservés ; classement « avec bonus » vide ; ancien ticket encore valable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-v5-'));
    try {
      const path = join(dir, 'classement.sqlite');
      const old = new DatabaseSync(path);
      for (let i = 0; i < 4; i++) old.exec(MIGRATIONS[i]);
      old.exec('PRAGMA user_version = 4');
      old.prepare("INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES ('p1', 'Axel', 'axel', 'h', 1), ('p2', 'Lea', 'lea', 'h', 1)").run();
      old.prepare("INSERT INTO runs (id, player_id, balance, ticket_id, seed, steps, score, flips, created_at) VALUES (1, 'p1', 3, 't1', 5, 4000, 900, '[1,2]', 10), (2, 'p2', 2, 't2', 6, 3000, 700, '[3]', 11)").run();
      old.prepare("INSERT INTO bests (player_id, balance, steps, score, run_id, achieved_at) VALUES ('p1', 3, 4000, 900, 1, 10), ('p2', 2, 3000, 700, 2, 11)").run();
      old.close();
      const db = openDb(path);
      const rows = db.prepare('SELECT player_id, balance, category, steps, score, run_id, achieved_at FROM bests ORDER BY player_id').all();
      expect(rows).toEqual([
        { player_id: 'p1', balance: 3, category: 'plain', steps: 4000, score: 900, run_id: 1, achieved_at: 10 },
        { player_id: 'p2', balance: 2, category: 'plain', steps: 3000, score: 700, run_id: 2, achieved_at: 11 },
      ]);
      expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 2 });
      expect(db.prepare("SELECT category, replay_v FROM runs WHERE id = 1").get()).toEqual({ category: 'plain', replay_v: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM bests WHERE category = 'bonus'").get()).toEqual({ n: 0 });
      db.close();
      // Servi par l'application : l'ancien record est au classement « sans bonus » (par défaut), le classement « avec bonus » est vide
      const c = ctx(openDb(path));
      c.call('GET', '/api/health');
      const plainTop = c.call('GET', '/api/leaderboard', { query: 'balance=3' }).body as LeaderboardResponse;
      expect(plainTop.entries.map((e) => [e.nickname, e.score])).toEqual([['Axel', 900]]);
      const bonusTop = c.call('GET', '/api/leaderboard', { query: 'balance=3&category=bonus' }).body as LeaderboardResponse;
      expect(bonusTop.entries).toEqual([]);
      const balances = c.call('GET', '/api/balances').body as { versions: { balance: number; players: number }[] };
      expect(balances.versions.map((v) => [v.balance, v.players])).toEqual([[3, 1], [2, 1]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('usage déclaré (parties non classées) et reprises payées en Prismes', () => {
  const sync = (c: Ctx, auth: string, used: { boost: number; gel: number }, bought = { boost: 3, gel: 3 }): HttpResponse =>
    c.call('POST', '/api/sync', { token: auth, body: { installId: INSTALL, earned: 1500, purchases: {}, claims: [], bonusBought: bought, bonusUsed: used, save: defaultSave() } });

  it('seul l’écart du compteur monotone consomme des charges, une fois, sans jamais passer sous zéro', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    stockUp(c, p.auth, 3, 3);
    expect(sync(c, p.auth, { boost: 1, gel: 0 }).status).toBe(200);
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 2, gel: 3 });
    // Requête rejouée (réponse perdue) : rien de plus
    sync(c, p.auth, { boost: 1, gel: 0 });
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 2, gel: 3 });
    // Compteur plus bas (sauvegarde ancienne) : ignoré
    sync(c, p.auth, { boost: 0, gel: 0 });
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 2, gel: 3 });
    // Déclaration excessive : plafonnée à l'inventaire réel
    sync(c, p.auth, { boost: 50, gel: 1 });
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 0, gel: 2 });
  });

  const prisms = (c: Ctx, id: string, n: number): void => {
    c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'prisms', 'grant', ?, ?, 1)").run(id, n, `test:${id}:${n}:${Math.random()}`);
  };
  const revive = (c: Ctx, auth: string | undefined, body: unknown): HttpResponse => c.call('POST', '/api/revive', { token: auth, body });

  it('deuxième chance 5 Prismes, troisième 10 : débit par le service, idempotent par (partie, vie), jamais négatif', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const bal = (): number => (c.call('GET', '/api/profile', { token: p.auth }).body as { balance: { prisms: number } }).balance.prisms;
    expect(revive(c, p.auth, { runId: 'run-abcdef01', life: 2 }).status).toBe(409); // aucun Prisme
    prisms(c, p.id, 20);
    const r2 = revive(c, p.auth, { runId: 'run-abcdef01', life: 2 });
    expect(r2.body).toMatchObject({ life: 2, charged: true, price: 5, balance: { prisms: 15 } });
    // Même requête rejouée (coupure réseau) : « déjà payée », aucun second débit
    expect(revive(c, p.auth, { runId: 'run-abcdef01', life: 2 }).body).toMatchObject({ charged: false, price: 5, balance: { prisms: 15 } });
    expect(revive(c, p.auth, { runId: 'run-abcdef01', life: 3 }).body).toMatchObject({ charged: true, price: 10, balance: { prisms: 5 } });
    expect(bal()).toBe(5);
    // Une autre partie : prix plein, refus faute de solde, rien n'est débité
    expect(revive(c, p.auth, { runId: 'run-abcdef02', life: 3 }).status).toBe(409);
    expect(bal()).toBe(5);
  });

  it('requêtes invalides : authentification requise, vie 1 ou 4 refusées, identifiant mal formé, prix imposé par le service', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    prisms(c, p.id, 50);
    expect(revive(c, undefined, { runId: 'run-abcdef01', life: 2 }).status).toBe(401);
    for (const life of [1, 4, 0, '2', null]) expect(revive(c, p.auth, { runId: 'run-abcdef01', life }).status).toBe(400);
    for (const runId of ['', 'x', 'a b c d e f g h', 'é'.repeat(10), 'a'.repeat(65), 42]) expect(revive(c, p.auth, { runId, life: 2 }).status).toBe(400);
    // Le client ne fixe jamais le prix
    const res = revive(c, p.auth, { runId: 'run-abcdef03', life: 2, price: 0, prisms: 999 });
    expect(res.body).toMatchObject({ price: 5, balance: { prisms: 45 } });
  });
});

describe('plafond de 3 activations par bonus et par première vie : jamais contournable', () => {
  /** Écarts supérieurs à la recharge (Boost 1 200 pas, Gel 2 400 pas) ; durée de jeu du robot suffisante pour la quatrième demande. */
  const PLAN = {
    boost: { steps: [20, 1300, 2600, 3900], botSeconds: 45, minTime: 40 },
    gel: { steps: [20, 2500, 5000, 7600], botSeconds: 90, minTime: 70 },
  } as const;

  /** Partie jouée avec le code du jeu : le robot survit ; quatre activations sont DEMANDÉES (le jeu refuse la quatrième). */
  function playFourRequests(kind: 'boost' | 'gel', seed: number): { flips: number[]; acts: [number, number][]; time: number; score: number; rejected: number } {
    const plan = PLAN[kind];
    const sim = createSimulation({ mode: 'survival', seed, stock: { boost: 9, gel: 9 } });
    const bot = new Bot(sim, true);
    for (let i = 0; i < 120 * 900 && sim.state === 'running'; i++) {
      if (i < 120 * plan.botSeconds) bot.tick();
      if ((plan.steps as readonly number[]).includes(i)) sim.power(kind);
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.state).toBe('dead');
    return { flips: [...sim.flipLog], acts: sim.powers.log.map((a) => [a.step, POWER_CODES[a.kind]] as [number, number]), time: sim.time, score: sim.scoring.score, rejected: sim.powers.rejected };
  }
  const seedFor = (kind: 'boost' | 'gel'): number => {
    const found = [5, 11, 12, 31, 77, 201, 202, 203, 1, 2, 3, 4, 6, 7, 8].find((sd) => playFourRequests(kind, sd).time > PLAN[kind].minTime);
    if (found === undefined) throw new Error(`aucune graine assez longue pour ${kind}`);
    return found;
  };

  for (const kind of ['boost', 'gel'] as const) {
    it(`${kind} : le jeu refuse la quatrième demande ; le rejeu du service accepte 3 activations et REFUSE un journal qui en contient 4`, () => {
      const seed = seedFor(kind);
      const r = playFourRequests(kind, seed);
      expect(r.acts).toHaveLength(3);
      expect(r.rejected).toBe(1);
      const ok = replaySurvival(seed, r.flips, r.acts);
      expect(ok.ok && ok.powers[kind]).toBe(3);
      // Client modifié : une quatrième activation (hors recharge) ajoutée au journal
      const forged = [...r.acts, [PLAN[kind].steps[3], POWER_CODES[kind]] as [number, number]];
      expect(replaySurvival(seed, r.flips, forged)).toEqual({ ok: false, reason: 'bad_powers' });
    });
  }

  it('à la réception : record refusé (ticket consommé, aucune charge déduite, aucun record) ; la partie honnête à 3 activations est classée « avec bonus »', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    stockUp(c, p.auth, 5, 0);
    const seed = seedFor('boost');
    const r = playFourRequests('boost', seed);
    const give = (id: string): Ticket => {
      const exp = Math.floor(c.now.t / 1000) + 7 * 86400;
      c.db.prepare('INSERT INTO tickets (id, player_id, seed, exp, issued_at) VALUES (?, ?, ?, ?, ?)').run(id, p.id, seed, exp, c.now.t);
      return { id, seed, exp, sig: signTicket(SECRET, { id, seed, exp }, p.id) };
    };
    const before = inventoryOf(c.db, p.id);
    const forgedTicket = give('cap-forged-0001');
    const forged = send(c, p.auth, sub(forgedTicket, r, { acts: [...r.acts, [3900, POWER_CODES.boost]] }));
    expect(forged.status).toBe(422);
    expect(forged.body).toMatchObject({ status: 'rejected', reason: 'bad_powers' });
    expect(inventoryOf(c.db, p.id)).toEqual(before);
    expect((c.call('GET', '/api/leaderboard', { query: 'category=bonus' }).body as LeaderboardResponse).total).toBe(0);
    expect(send(c, p.auth, sub(forgedTicket, r)).body).toMatchObject({ reason: 'ticket_used' });
    const honest = send(c, p.auth, sub(give('cap-honest-0001'), r));
    expect(honest.status).toBe(200);
    expect(honest.body).toMatchObject({ status: 'accepted', category: 'bonus', powers: { boost: 3 } });
    expect(inventoryOf(c.db, p.id).boost).toBe(before.boost - 3);
  });
});

describe('compteurs de charges : jamais en dessous du service (retour arrière du jeu, sauvegarde ancienne)', () => {
  const syncBody = (bought: { boost: number; gel: number }, used: { boost: number; gel: number }) => ({ installId: INSTALL, earned: 1500, purchases: {}, claims: [], bonusBought: bought, bonusUsed: used, save: defaultSave() });

  it('la réponse indique les compteurs d’usage déjà déduits ; un compteur local redescendu ne déduit rien, ne rend rien, et n’empêche pas un nouvel achat une fois réaligné', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const post = (b: ReturnType<typeof syncBody>): { used: { boost: number; gel: number }; bonus: { boost: number; gel: number }; inventory: { boost: number; gel: number } } => {
      const r = c.call('POST', '/api/sync', { token: p.auth, body: b });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body as never;
    };
    expect(post(syncBody({ boost: 4, gel: 0 }, { boost: 0, gel: 0 })).inventory.boost).toBe(4);
    const a = post(syncBody({ boost: 4, gel: 0 }, { boost: 2, gel: 0 }));
    expect(a.used).toEqual({ boost: 2, gel: 0 });
    expect(a.bonus).toEqual({ boost: 4, gel: 0 });
    expect(a.inventory.boost).toBe(2);
    // Sauvegarde réécrite : compteurs à zéro. Le service ne déduit rien de plus ni ne rend rien, et répond avec SES compteurs
    const stale = post(syncBody({ boost: 0, gel: 0 }, { boost: 0, gel: 0 }));
    expect(stale.used).toEqual({ boost: 2, gel: 0 });
    expect(stale.bonus).toEqual({ boost: 4, gel: 0 });
    expect(stale.inventory.boost).toBe(2);
    // Le client réaligné (max) peut racheter : 5ᵉ charge achetée = compteur 5 → créditée
    const next = post(syncBody({ boost: 5, gel: 0 }, { boost: 2, gel: 0 }));
    expect(next.inventory.boost).toBe(3);
  });
});
