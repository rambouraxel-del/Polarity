import { describe, expect, it } from 'vitest';
import { BALANCE_VERSION } from '../src/config/version';
import { POWER_CODES } from '../src/config/powers';
import { POWERS } from '../src/config/powers';
import { createSimulation } from '../src/modes/run';
import { REPLAY_FORMAT, REPLAY_FORMAT_POWERS, type Category, type LeaderboardResponse, type RegisterResponse, type RunSubmission, type Ticket, type TicketsResponse } from '../src/net/protocol';
import { GameSession } from '../src/game/session';
import { defaultSave, parseSave } from '../src/save/save';
import * as S from '../src/ui/screens';
import { createApp, type HttpRequest, type HttpResponse } from '../server/app';
import { openDb } from '../server/db';
import { replaySurvival } from '../server/verify';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';

function play(seed: number, bonus: boolean | undefined, plan: (sim: ReturnType<typeof createSimulation>, i: number) => void = () => undefined) {
  const sim = createSimulation({ mode: 'survival', seed, stock: { boost: 9, gel: 9 }, bonus });
  for (let i = 0; i < 120 * 900 && sim.state === 'running'; i++) {
    if (i % 29 === 7) sim.flip();
    plan(sim, i);
    sim.step();
    sim.events.length = 0;
  }
  expect(sim.state).toBe('dead');
  return { sim, flips: [...sim.flipLog], acts: sim.powers.log.map((a) => [a.step, POWER_CODES[a.kind]] as [number, number]), time: sim.time, score: sim.scoring.score };
}
const planBoost = (sim: ReturnType<typeof createSimulation>, i: number): void => {
  if (i === 20) sim.power('boost');
};

describe('Survie « Sans bonus » : simulation', () => {
  it('aucun pouvoir : Boost, Gel et Bouclier refusés, aucune charge consommée, la jauge du Bouclier ne se remplit pas', () => {
    const { sim, acts } = play(31, false, (s, i) => {
      if (i === 20) s.power('boost');
      if (i === 40) s.power('gel');
      if (i === 60) s.power('shield');
    });
    expect(acts).toEqual([]);
    expect(sim.powers.rejected).toBe(3);
    expect(sim.powers.used).toEqual({ boost: 0, gel: 0, shield: 0 });
    expect(sim.powers.stock).toEqual({ boost: 9, gel: 9 });
    for (let i = 0; i < POWERS.shield.beacons + 2; i++) sim.powers.onBeacon();
    expect(sim.powers.shieldStored).toBe(false);
    expect(sim.powers.deny('boost', 0)).toBe('disabled');
  });

  it('sans activation, la partie est strictement identique dans les deux modes (physique, durée, score)', () => {
    const a = play(31, false);
    const b = play(31, true);
    const c = play(31, undefined);
    expect(a.time).toBe(b.time);
    expect(a.score).toBe(b.score);
    expect(a.flips).toEqual(b.flips);
    expect(c.score).toBe(b.score);
  });
});

describe('rejeu du service : le mode choisi au départ fait foi', () => {
  const plain = play(31, false);
  const bonus = play(77, true, planBoost);

  it('« avec bonus » sans aucune activation → catégorie « bonus » ; « sans bonus » → « plain » ; sans déclaration (ancien client) → déduite', () => {
    const asBonus = replaySurvival(31, plain.flips, [], undefined, 'bonus');
    const asPlain = replaySurvival(31, plain.flips, [], undefined, 'plain');
    const legacy = replaySurvival(31, plain.flips, []);
    expect(asBonus.ok && asBonus.category).toBe('bonus');
    expect(asPlain.ok && asPlain.category).toBe('plain');
    expect(legacy.ok && legacy.category).toBe('plain');
    // Même résultat de jeu quelle que soit la catégorie
    expect(asBonus.ok && asPlain.ok && asBonus.score === asPlain.score && asBonus.steps === asPlain.steps).toBe(true);
    const legacyBonus = replaySurvival(77, bonus.flips, bonus.acts);
    expect(bonus.acts.length).toBeGreaterThan(0);
    expect(legacyBonus.ok && legacyBonus.category).toBe('bonus');
  });

  it('une activation dans une partie déclarée « sans bonus » prouve un journal falsifié', () => {
    expect(replaySurvival(77, bonus.flips, bonus.acts, undefined, 'plain')).toEqual({ ok: false, reason: 'bad_powers' });
    expect(replaySurvival(77, bonus.flips, bonus.acts, undefined, 'bonus').ok).toBe(true);
  });
});

describe('service : catégorie = mode déclaré, contrôlée par le rejeu', () => {
  function setup() {
    const db = openDb(':memory:');
    const now = { t: 1_700_000_000_000 };
    const app = createApp(db, { ticketSecret: SECRET, now: () => now.t, balance: BALANCE_VERSION });
    const call = (method: string, path: string, o: { body?: unknown; token?: string; query?: string } = {}): HttpResponse => {
      const req: HttpRequest = { method, path, query: new URLSearchParams(o.query ?? ''), headers: { authorization: o.token ? `Bearer ${o.token}` : undefined }, body: o.body, ip: '10.0.0.1' };
      return app(req);
    };
    const reg = call('POST', '/api/register', { body: { nickname: 'Axel' } }).body as RegisterResponse;
    const auth = `${reg.playerId}.${reg.token}`;
    const ts = (call('POST', '/api/tickets', { token: auth }).body as TicketsResponse).tickets;
    let used = 0;
    const submit = (r: { flips: number[]; acts: [number, number][]; time: number; score: number }, t: Ticket, replay: Partial<RunSubmission['replay']>): HttpResponse => {
      now.t += 4000;
      const body: RunSubmission = { ticket: t, replay: { v: REPLAY_FORMAT_POWERS, flips: r.flips, acts: r.acts, ...replay }, claimed: { time: r.time, score: r.score }, client: { balance: BALANCE_VERSION, build: 'test', installId: 'i-1', bonusBought: { boost: 0, gel: 0 } } };
      return call('POST', '/api/runs', { token: auth, body });
    };
    const lb = (category: Category): LeaderboardResponse => call('GET', '/api/leaderboard', { query: `category=${category}` }).body as LeaderboardResponse;
    return { ts, submit, lb, next: () => ts[used++] };
  }

  it('« Avec bonus » choisi, aucun pouvoir utilisé : classé « Avec bonus » (pas dans « Sans bonus ») ; « Sans bonus » : classé « Sans bonus »', () => {
    const s = setup();
    const t1 = s.next();
    const g1 = play(t1.seed, true);
    expect(g1.acts).toEqual([]);
    expect(s.submit(g1, t1, { category: 'bonus' }).body).toMatchObject({ status: 'accepted', category: 'bonus' });
    expect(s.lb('bonus').entries).toHaveLength(1);
    expect(s.lb('plain').entries).toHaveLength(0);
    const t2 = s.next();
    const g2 = play(t2.seed, false);
    expect(s.submit(g2, t2, { category: 'plain' }).body).toMatchObject({ status: 'accepted', category: 'plain' });
    expect(s.lb('plain').entries).toHaveLength(1);
  });

  it('un journal contenant un pouvoir ne peut pas être déclaré « Sans bonus » ; déclarations invalides refusées ; ancien client : déduction', () => {
    const s = setup();
    const t1 = s.next();
    // La graine est imposée par le ticket : on joue cette graine avec un Boost
    const g = play(t1.seed, true, planBoost);
    expect(g.acts.length).toBeGreaterThan(0);
    expect(s.submit(g, t1, { category: 'plain' }).body).toMatchObject({ status: 'rejected', reason: 'bad_powers' });
    const t2 = s.next();
    const g2 = play(t2.seed, true);
    expect(s.submit(g2, t2, { category: 'nimporte' as unknown as Category }).status).toBe(400);
    expect(s.submit(g2, t2, { v: REPLAY_FORMAT, acts: undefined, category: 'plain' }).status).toBe(400);
    // Ancien client (aucune déclaration) : catégorie déduite des activations rejouées
    expect(s.submit(g2, t2, {}).body).toMatchObject({ status: 'accepted', category: 'plain' });
  });
});

describe('interface et sauvegarde : choix du mode à la préparation', () => {
  it('deux boutons de mode ; « Sans bonus » : pas de cartes de bonus, record du mode ; « Avec bonus » : cartes affichées', () => {
    const s = defaultSave();
    s.survival.bestTime = 100;
    s.survivalBonus.bestTime = 200;
    const plain = S.prepScreen(s, null, 'plain');
    const bonus = S.prepScreen(s, null, 'bonus');
    expect(plain).toContain('data-mode="plain"');
    expect(plain).toContain('data-mode="bonus"');
    expect(plain).toContain('Record : 1:40');
    expect(plain).not.toContain('data-action="bonus-ask"');
    expect(bonus).toContain('Record : 3:20');
    expect(bonus).toContain('data-action="bonus-ask"');
    expect(bonus).toMatch(/aria-checked="true"[^>]*data-mode="bonus"/);
  });

  it('le mode préféré est conservé dans les options (défaut « Sans bonus », valeur inconnue → défaut)', () => {
    expect(defaultSave().options.survivalMode).toBe('plain');
    const s = defaultSave();
    s.options.survivalMode = 'bonus';
    const r = parseSave(JSON.stringify(s));
    expect(r?.options.survivalMode).toBe('bonus');
    const bad = JSON.parse(JSON.stringify(s));
    bad.options.survivalMode = 'x';
    const r2 = parseSave(JSON.stringify(bad));
    expect(r2?.options.survivalMode).toBe('plain');
  });

  it('résumé de partie : la catégorie est le mode choisi au départ, même sans pouvoir utilisé', () => {
    const mk = (bonus: boolean | undefined) => new GameSession({ mode: 'survival', seed: 5, bonus, stock: { boost: 1, gel: 1 } }, {}).summary().category;
    expect(mk(true)).toBe('bonus');
    expect(mk(false)).toBe('plain');
    expect(mk(undefined)).toBe('plain');
  });
});
