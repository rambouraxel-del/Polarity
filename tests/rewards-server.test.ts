import { describe, expect, it } from 'vitest';
import { BALANCE_VERSION } from '../src/config/version';
import { SIM } from '../src/config/balance';
import { BONUS } from '../src/config/economy';
import { DAILY_RANKING, DAILY_STANDARD_TOTAL, DROPS, LOYALTY, PRISM_SOURCES, dailyPrizeForRank, loyaltyTotals } from '../src/config/rewards';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';
import { dailySeed } from '../src/modes/daily';
import type { DailyBoard, DailyNoticesResponse, LoyaltyState } from '../src/net/rewardsProtocol';
import type { RegisterResponse, RunResponse, RunSubmission, Ticket } from '../src/net/protocol';
import { createApp, type HttpRequest, type HttpResponse } from '../server/app';
import { signTicket } from '../server/auth';
import { openDb, type Db } from '../server/db';
import { balancesOf, inventoryOf } from '../server/profile';
import { sha256Hex } from '../src/core/sha256';
import { dailyDigestInput } from '../src/net/rewardsProtocol';
import { dayString, dayStartMs, dropDraw, nextPresence, rollDrop, utcDayNumber, validDate, type CycleCounters } from '../server/rewards';
import { replayDaily, replaySurvival } from '../server/verify';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';
const D0 = Date.UTC(2026, 9, 15, 12, 0, 0); // 15 octobre 2026, midi UTC
const DAY = 86_400_000;

function ctx(db: Db = openDb(':memory:'), t0 = D0) {
  const now = { t: t0 };
  const app = createApp(db, { ticketSecret: SECRET, now: () => now.t, balance: BALANCE_VERSION });
  let ipSeq = 1;
  const call = (method: string, path: string, o: { body?: unknown; auth?: string; query?: string; ip?: string } = {}): HttpResponse => {
    const req: HttpRequest = { method, path, query: new URLSearchParams(o.query ?? ''), headers: { authorization: o.auth ? `Bearer ${o.auth}` : undefined }, body: o.body, ip: o.ip ?? `10.0.0.${ipSeq}` };
    return app(req);
  };
  const newIp = (): string => `10.1.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`;
  return { db, now, app, call, newIp };
}
type Ctx = ReturnType<typeof ctx>;

/** Profil avec pseudo (éligible aux Prismes et aux classements). */
function player(c: Ctx, nickname: string): { id: string; auth: string } {
  const res = c.call('POST', '/api/register', { body: { nickname }, ip: c.newIp() });
  expect(res.status).toBe(201);
  const b = res.body as RegisterResponse;
  return { id: b.playerId, auth: `${b.playerId}.${b.token}` };
}
/** Profil invité (pseudo non choisi). */
function guest(c: Ctx): { id: string; auth: string } {
  const res = c.call('POST', '/api/register', { body: {}, ip: c.newIp() });
  expect(res.status).toBe(201);
  const b = res.body as RegisterResponse;
  return { id: b.playerId, auth: `${b.playerId}.${b.token}` };
}

const checkin = (c: Ctx, auth: string): LoyaltyState => {
  const r = c.call('POST', '/api/loyalty/checkin', { auth });
  expect(r.status).toBe(200);
  return r.body as LoyaltyState;
};
const claim = (c: Ctx, auth: string, cycle: number, day: number): HttpResponse => c.call('POST', '/api/loyalty/claim', { auth, body: { cycle, day } });
/** Passe au jour UTC suivant (à midi) et valide la présence. */
const nextDay = (c: Ctx, auth: string, n = 1): LoyaltyState => {
  c.now.t += n * DAY;
  return checkin(c, auth);
};

// ———————————————————————————————————————————————————————————————— configuration

describe('Configuration des récompenses', () => {
  it('calendrier : 10 jours, 200 Éclats, 2 Boosts, 2 Gels, 5 Prismes dans l’ordre prévu', () => {
    expect(LOYALTY.days.map((d) => `${d.kind}:${d.amount}`)).toEqual(['shards:20', 'boost:1', 'shards:30', 'gel:1', 'shards:40', 'boost:1', 'shards:50', 'gel:1', 'shards:60', 'prisms:5']);
    expect(loyaltyTotals()).toEqual({ shards: 200, boost: 2, gel: 2, prisms: 5 });
    expect(LOYALTY.absencesAllowed).toBe(1);
  });

  it('classement quotidien : 15/10/5, 4ᵉ à 7ᵉ 2 chacun, 8ᵉ à 10ᵉ 1 chacun ; 41 Prismes par jour standard ; rien au-delà du 10ᵉ rang', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(dailyPrizeForRank)).toEqual([15, 10, 5, 2, 2, 2, 2, 1, 1, 1, 0]);
    expect(DAILY_STANDARD_TOTAL).toBe(41);
    expect(DAILY_RANKING.graceMinutes).toBe(15);
  });

  it('drop : 0,02 % par balise, un Prisme au plus ; sources futures déclarées mais désactivées', () => {
    expect(DROPS.prism).toEqual({ chancePerBeacon: 0.0002, maxPerRun: 1, amount: 1 });
    expect(PRISM_SOURCES.every((s) => !s.enabled && s.amount === 0)).toBe(true);
  });
});

// ———————————————————————————————————————————————————————————————— calendrier : règles pures

describe('Calendrier : présence, absences, cycles (règles pures)', () => {
  const run = (days: number[]): { cur: CycleCounters | null; kinds: string[] } => {
    let cur: CycleCounters | null = null;
    const kinds: string[] = [];
    for (const d of days) {
      const o = nextPresence(cur, d);
      kinds.push(o.kind);
      cur = o.next;
    }
    return { cur, kinds };
  };

  it('dix jours consécutifs : cycle complet ; une présence répétée le même jour ne compte pas', () => {
    const r = run([100, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(r.cur).toEqual({ days: 10, absences: 0, lastDay: 109 });
    expect(r.kinds[1]).toBe('same');
  });

  it('une seule absence est tolérée : la progression continue (le jour manqué ne compte pas)', () => {
    const r = run([100, 101, 103]); // le 102 manqué
    expect(r.cur).toEqual({ days: 3, absences: 1, lastDay: 103 });
    expect(r.kinds).toEqual(['start', 'advance', 'advance']);
  });

  it('la deuxième absence, même non consécutive, réinitialise ; deux jours manqués d’un coup aussi', () => {
    expect(run([100, 102, 104]).cur).toEqual({ days: 1, absences: 0, lastDay: 104 });
    expect(run([100, 102, 104]).kinds).toEqual(['start', 'advance', 'reset']);
    expect(run([100, 101, 104]).kinds).toEqual(['start', 'advance', 'reset']);
    expect(run([100, 101, 104]).cur).toEqual({ days: 1, absences: 0, lastDay: 104 });
  });

  it('après le jour 10, le nouveau cycle démarre au prochain jour UTC éligible (même après une longue absence)', () => {
    const full: CycleCounters = { days: 10, absences: 1, lastDay: 200 };
    expect(nextPresence(full, 200).kind).toBe('same');
    expect(nextPresence(full, 201)).toMatchObject({ kind: 'start', next: { days: 1, absences: 0, lastDay: 201 } });
    expect(nextPresence(full, 260)).toMatchObject({ kind: 'start', next: { days: 1, absences: 0, lastDay: 260 } });
  });

  it('un jour passé ou la même journée ne fait jamais reculer ni avancer (horloge ramenée en arrière)', () => {
    expect(nextPresence({ days: 4, absences: 0, lastDay: 300 }, 299).kind).toBe('same');
  });

  it('dates UTC : numéro de jour, format et validation', () => {
    expect(dayString(utcDayNumber(Date.UTC(2026, 9, 15, 23, 59, 59)))).toBe('2026-10-15');
    expect(dayString(utcDayNumber(Date.UTC(2026, 9, 16, 0, 0, 0)))).toBe('2026-10-16');
    expect(validDate('2026-10-15')).toBe(true);
    for (const bad of ['2026-13-01', '2026-02-30', '26-10-15', '', 5, null, '2026-10-15T00:00']) expect(validDate(bad)).toBe(false);
  });
});

// ———————————————————————————————————————————————————————————————— calendrier : service

describe('Calendrier de connexion : service (autorité UTC, réclamation atomique et idempotente)', () => {
  it('première connexion : jour 1 validé, rien n’est crédité sans réclamation ; idempotent dans la journée', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const s1 = checkin(c, p.auth);
    expect(s1.presentToday).toBe(true);
    expect(s1.today).toBe('2026-10-15');
    expect(s1.claimable).toBe(1);
    expect(s1.cycles[0].days.map((d) => d.unlocked)).toEqual([true, ...Array(9).fill(false)]);
    expect(balancesOf(c.db, p.id).shards).toBe(0);
    expect(checkin(c, p.auth).claimable).toBe(1);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM loyalty_cycles').get()).toEqual({ n: 1 });
  });

  it('le changement de jour se fait à 00 h 00 UTC pile, sur l’horloge du service', () => {
    const c = ctx(openDb(':memory:'), Date.UTC(2026, 9, 15, 23, 59, 59));
    const p = player(c, 'Axel');
    checkin(c, p.auth);
    c.now.t = Date.UTC(2026, 9, 15, 23, 59, 59, 999);
    expect(checkin(c, p.auth).cycles[0].days.filter((d) => d.unlocked)).toHaveLength(1);
    c.now.t = Date.UTC(2026, 9, 16, 0, 0, 0, 0);
    const s = checkin(c, p.auth);
    expect(s.cycles[0].days.filter((d) => d.unlocked)).toHaveLength(2);
    expect(s.nextDayAt).toBe(Date.UTC(2026, 9, 17));
  });

  it('un client ne peut pas annoncer sa présence ni sa date : seule l’horloge du service compte', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const r = c.call('POST', '/api/loyalty/checkin', { auth: p.auth, body: { day: '2030-01-01', days: 10, presence: [1, 2, 3] } });
    expect((r.body as LoyaltyState).today).toBe('2026-10-15');
    expect((r.body as LoyaltyState).cycles[0].days.filter((d) => d.unlocked)).toHaveLength(1);
    expect(c.call('POST', '/api/loyalty/checkin').status).toBe(401);
  });

  it('réclamation : Éclats crédités une seule fois, requête rejouée sans effet ; jour verrouillé et cycle étranger refusés', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const other = player(c, 'Lea');
    const st = checkin(c, p.auth);
    const cycle = st.cycles[0].id;
    const r1 = claim(c, p.auth, cycle, 1);
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ credited: true, reward: { kind: 'shards', amount: 20 }, balance: { shards: 20 } });
    const r2 = claim(c, p.auth, cycle, 1);
    expect(r2.body).toMatchObject({ credited: false, balance: { shards: 20 } });
    expect(balancesOf(c.db, p.id).shards).toBe(20);
    expect(claim(c, p.auth, cycle, 2).status).toBe(409); // pas encore débloqué
    expect(claim(c, other.auth, cycle, 1).status).toBe(400); // le cycle d'un autre joueur
    for (const bad of [{ cycle, day: 0 }, { cycle, day: 11 }, { cycle: 'x', day: 1 }, { cycle: 99999, day: 1 }]) expect(c.call('POST', '/api/loyalty/claim', { auth: p.auth, body: bad }).status).toBe(400);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'loy:%'").get()).toEqual({ n: 1 });
  });

  it('cycle complet sans absence : 200 Éclats, 2 Boosts, 2 Gels, 5 Prismes, récupérables jour par jour ou tous à la fin', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    let st = checkin(c, p.auth);
    for (let i = 1; i < 10; i++) st = nextDay(c, p.auth);
    expect(st.cycles[0].complete).toBe(true);
    expect(st.absencesLeft).toBeNull();
    expect(st.claimable).toBe(10);
    for (let d = 1; d <= 10; d++) expect(claim(c, p.auth, st.cycles[0].id, d).status, `jour ${d}`).toBe(200);
    expect(balancesOf(c.db, p.id)).toMatchObject({ shards: 200, prisms: 5 });
    expect(inventoryOf(c.db, p.id)).toEqual({ boost: 2, gel: 2 });
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'loy:%'").get()).toEqual({ n: 10 });
    // Nouveau cycle au prochain jour UTC éligible
    const next = nextDay(c, p.auth);
    expect(next.cycles[0].id).not.toBe(st.cycles[0].id);
    expect(next.cycles[0].days.filter((d) => d.unlocked)).toHaveLength(1);
    expect(next.claimable).toBe(1);
  });

  it('absence tolérée (indicateur), puis réinitialisation à la deuxième : l’ancien cycle reste récupérable indéfiniment', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    checkin(c, p.auth); // jour 1 (J)
    let st = nextDay(c, p.auth); // jour 2
    expect(st.absencesLeft).toBe(1);
    st = nextDay(c, p.auth, 2); // un jour manqué : jour 3, absence utilisée
    expect(st.absencesLeft).toBe(0);
    expect(st.cycles[0].days.filter((d) => d.unlocked)).toHaveLength(3);
    const oldCycle = st.cycles[0].id;
    st = nextDay(c, p.auth, 2); // deuxième absence : réinitialisation
    expect(st.cycles[0].id).not.toBe(oldCycle);
    expect(st.cycles[0].current).toBe(true);
    expect(st.cycles[0].days.filter((d) => d.unlocked)).toHaveLength(1);
    expect(st.absencesLeft).toBe(1);
    // L'ancien cycle (3 jours débloqués) est conservé et récupérable des mois plus tard
    expect(st.cycles.find((x) => x.id === oldCycle)?.days.filter((d) => d.unlocked && !d.claimed)).toHaveLength(3);
    c.now.t += 200 * DAY;
    expect(claim(c, p.auth, oldCycle, 1).status).toBe(200);
    expect(claim(c, p.auth, oldCycle, 3).status).toBe(200);
    expect(claim(c, p.auth, oldCycle, 3).body).toMatchObject({ credited: false });
    expect(balancesOf(c.db, p.id).shards).toBe(20 + 30);
  });

  it('stock plein (99) : Boost/Gel non récupérables (rien consommé), la récompense reste disponible ; récupérable dès qu’une place se libère', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    checkin(c, p.auth);
    const st = nextDay(c, p.auth); // jour 2 : 1 Boost
    const cycle = st.cycles[0].id;
    c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'boost', 'bonus', ?, 'test:plein', 1)").run(p.id, BONUS.maxStock);
    const full = claim(c, p.auth, cycle, 2);
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ error: 'stock_full' });
    expect(inventoryOf(c.db, p.id).boost).toBe(BONUS.maxStock);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref = ?").get(`loy:${cycle}:2`)).toEqual({ n: 0 });
    expect((checkin(c, p.auth).claimable)).toBe(2);
    c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'boost', 'use', -1, 'test:use', 2)").run(p.id);
    expect(claim(c, p.auth, cycle, 2).status).toBe(200);
    expect(inventoryOf(c.db, p.id).boost).toBe(BONUS.maxStock);
  });

  it('Prismes du jour 10 : jamais pour un profil invité (la récompense reste disponible) ; accordés dès qu’un pseudo est choisi', () => {
    const c = ctx();
    const g = guest(c);
    let st = checkin(c, g.auth);
    for (let i = 1; i < 10; i++) st = nextDay(c, g.auth);
    expect(st.canClaimPrisms).toBe(false);
    const refused = claim(c, g.auth, st.cycles[0].id, 10);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'account_required' });
    expect(balancesOf(c.db, g.id).prisms).toBe(0);
    // Pseudo choisi : le profil n'est plus invité
    expect(c.call('PATCH', '/api/me', { auth: g.auth, body: { nickname: 'Nova' } }).status).toBe(200);
    expect(claim(c, g.auth, st.cycles[0].id, 10).body).toMatchObject({ credited: true, balance: { prisms: 5 } });
    expect(claim(c, g.auth, st.cycles[0].id, 10).body).toMatchObject({ credited: false, balance: { prisms: 5 } });
  });

  it('effacement du profil : cycles supprimés avec le reste ; limiteur de requêtes', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    checkin(c, p.auth);
    expect(c.call('DELETE', '/api/me', { auth: p.auth }).status).toBe(200);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM loyalty_cycles').get()).toEqual({ n: 0 });
    const q = player(c, 'Lea');
    let limited = 0;
    for (let i = 0; i < 200; i++) if (c.call('POST', '/api/loyalty/checkin', { auth: q.auth }).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});

// ———————————————————————————————————————————————————————————————— drop rare

describe('Drop rare de Prismes : tirage du service', () => {
  it('taux exact : seuil = 0,02 %, répartition uniforme sur 300 000 tirages (écart ≤ 5σ)', () => {
    let hits = 0;
    const n = 300_000;
    for (let i = 1; i <= n; i++) if (dropDraw(SECRET, 'ticket-stat', i) < DROPS.prism.chancePerBeacon) hits++;
    const expected = n * DROPS.prism.chancePerBeacon; // 60
    expect(Math.abs(hits - expected)).toBeLessThanOrEqual(5 * Math.sqrt(expected));
    // Les tirages sont dans [0, 1)
    for (let i = 1; i < 200; i++) {
      const v = dropDraw(SECRET, 'x', i);
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('déterministe (secret + ticket + index), indépendant du client ; un autre secret ou ticket change les tirages', () => {
    expect(dropDraw(SECRET, 't1', 7)).toBe(dropDraw(SECRET, 't1', 7));
    expect(dropDraw(SECRET, 't1', 7)).not.toBe(dropDraw(SECRET, 't1', 8));
    expect(dropDraw(SECRET, 't1', 7)).not.toBe(dropDraw(SECRET, 't2', 7));
    expect(dropDraw(`${SECRET}x`, 't1', 7)).not.toBe(dropDraw(SECRET, 't1', 7));
  });

  it('au plus un Prisme par partie : rollDrop renvoie la PREMIÈRE balise gagnante ; plus de balises ne change jamais un tirage déjà fait (aucun reroll)', () => {
    let id = '';
    for (let k = 0; k < 200_000 && !id; k++) if (rollDrop(SECRET, `ticket-${k}`, 40) > 0) id = `ticket-${k}`;
    expect(id).not.toBe('');
    const first = rollDrop(SECRET, id, 40);
    expect(first).toBeGreaterThan(0);
    for (const n of [first, first + 1, 100, 1000]) expect(rollDrop(SECRET, id, n)).toBe(first);
    if (first > 1) expect(rollDrop(SECRET, id, first - 1)).toBe(0);
    expect(rollDrop(SECRET, id, 0)).toBe(0);
  });
});

/** Joue une partie de Survie (inversions seules) avec la graine donnée jusqu'à la mort. */
function playSurvival(seed: number): { flips: number[]; time: number; score: number; beacons: number } {
  const sim = createSimulation({ mode: 'survival', seed, stock: { boost: 0, gel: 0 } });
  const bot = new Bot(sim, true);
  for (let i = 0; i < 120 * 900 && sim.state === 'running'; i++) {
    // Joueur appliqué pendant 25 s (collecte des balises), puis maladroit jusqu'à la mort
    if (i < 120 * 25) bot.tick();
    else if (i % 29 === 7) sim.flip();
    sim.step();
    sim.events.length = 0;
  }
  const rep = replaySurvival(seed, [...sim.flipLog]);
  if (!rep.ok) throw new Error('rejeu');
  return { flips: [...sim.flipLog], time: sim.time, score: sim.scoring.score, beacons: rep.beacons };
}

/** Insère un ticket avec un identifiant et une graine choisis (le service les a émis : on contourne seulement le tirage aléatoire). */
function giveTicket(c: Ctx, p: { id: string; auth: string }, id: string, seed: number): Ticket {
  const exp = Math.floor(c.now.t / 1000) + 7 * 86400;
  c.db.prepare('INSERT INTO tickets (id, player_id, seed, exp, issued_at) VALUES (?, ?, ?, ?, ?)').run(id, p.id, seed, exp, c.now.t);
  return { id, seed, exp, sig: signTicket(SECRET, { id, seed, exp }, p.id) };
}
const submit = (c: Ctx, p: { auth: string }, t: Ticket, r: { flips: number[]; time: number; score: number }): HttpResponse => {
  c.now.t += 4000;
  const body: RunSubmission = { ticket: t, replay: { v: 1, flips: r.flips }, claimed: { time: r.time, score: r.score }, client: { balance: BALANCE_VERSION, build: 't' } };
  return c.call('POST', '/api/runs', { auth: p.auth, body });
};

describe('Drop rare de Prismes : crédit par le service à la validation', () => {
  /** Cherche un identifiant de ticket dont le tirage gagne (ou perd) pour ce nombre de balises. */
  const findId = (beacons: number, wins: boolean): string => {
    for (let k = 0; k < 400_000; k++) if ((rollDrop(SECRET, `drop-${wins ? 'w' : 'l'}-${k}`, beacons) > 0) === wins) return `drop-${wins ? 'w' : 'l'}-${k}`;
    throw new Error('aucun identifiant');
  };
  const seed = 31;
  const game = playSurvival(seed);

  it('partie démarrée EN LIGNE + validée par le rejeu : 1 Prisme crédité une fois, jamais deux, ticket à usage unique', () => {
    expect(game.beacons).toBeGreaterThan(0);
    const c = ctx();
    const p = player(c, 'Axel');
    const t = giveTicket(c, p, findId(game.beacons, true), seed);
    expect(c.call('POST', '/api/tickets/start', { auth: p.auth, body: { ticketId: t.id } }).status).toBe(200);
    c.now.t += (game.time + 5) * 1000; // le temps réel écoulé couvre la durée de la partie
    const r = submit(c, p, t, game);
    expect(r.status).toBe(200);
    expect((r.body as RunResponse & { status: 'accepted' }).drop).toEqual({ prisms: 1 });
    expect(balancesOf(c.db, p.id).prisms).toBe(1);
    expect(c.db.prepare("SELECT amount FROM ledger WHERE ref = ?").get(`drop:${t.id}`)).toEqual({ amount: 1 });
    // Soumission répétée : refusée, aucun second crédit
    expect(submit(c, p, t, game).status).toBe(422);
    expect(balancesOf(c.db, p.id).prisms).toBe(1);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'drop:%'").get()).toEqual({ n: 1 });
    expect(c.db.prepare('SELECT drop_prisms FROM runs').get()).toEqual({ drop_prisms: 1 });
  });

  it('partie entièrement hors ligne (aucun démarrage enregistré) : aucun tirage, même avec un ticket « gagnant » ; démarrage tardif refusé', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const t = giveTicket(c, p, findId(game.beacons, true), seed);
    c.now.t += 3600_000;
    const r = submit(c, p, t, game);
    expect(r.status).toBe(200);
    expect((r.body as { drop?: unknown }).drop).toBeUndefined();
    expect(balancesOf(c.db, p.id).prisms).toBe(0);
    // Aucun tirage rétroactif : le ticket est consommé, on ne peut plus enregistrer de démarrage
    expect(c.call('POST', '/api/tickets/start', { auth: p.auth, body: { ticketId: t.id } }).status).toBe(400);
  });

  it('heure de démarrage incompatible avec la durée de la partie (envoi immédiat) : pas de drop ; ticket perdant : pas de drop', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const win = giveTicket(c, p, findId(game.beacons, true), seed);
    c.call('POST', '/api/tickets/start', { auth: p.auth, body: { ticketId: win.id } });
    const fast = submit(c, p, win, game); // 4 s seulement depuis le démarrage : la partie en a duré davantage
    expect(fast.status).toBe(200);
    expect((fast.body as { drop?: unknown }).drop).toBeUndefined();
    const lose = giveTicket(c, p, findId(game.beacons, false), seed);
    c.call('POST', '/api/tickets/start', { auth: p.auth, body: { ticketId: lose.id } });
    c.now.t += (game.time + 5) * 1000;
    expect((submit(c, p, lose, game).body as { drop?: unknown }).drop).toBeUndefined();
    expect(balancesOf(c.db, p.id).prisms).toBe(0);
  });

  it('démarrage : ticket d’un autre joueur, inconnu ou déjà démarré (heure conservée) ; changer la graine ne sert à rien (ticket lié à sa graine)', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const q = player(c, 'Lea');
    const t = giveTicket(c, p, findId(game.beacons, true), seed);
    expect(c.call('POST', '/api/tickets/start', { auth: q.auth, body: { ticketId: t.id } }).status).toBe(400);
    expect(c.call('POST', '/api/tickets/start', { auth: p.auth, body: { ticketId: 'inconnu' } }).status).toBe(400);
    expect(c.call('POST', '/api/tickets/start', { auth: p.auth, body: {} }).status).toBe(400);
    c.call('POST', '/api/tickets/start', { auth: p.auth, body: { ticketId: t.id } });
    const at = (c.db.prepare('SELECT started_at FROM tickets WHERE id = ?').get(t.id) as { started_at: number }).started_at;
    c.now.t += 60_000;
    c.call('POST', '/api/tickets/start', { auth: p.auth, body: { ticketId: t.id } });
    expect((c.db.prepare('SELECT started_at FROM tickets WHERE id = ?').get(t.id) as { started_at: number }).started_at).toBe(at);
    // Ticket falsifié (graine modifiée) : signature invalide
    const forged = { ...t, seed: seed + 1 };
    c.now.t += (game.time + 5) * 1000;
    expect(submit(c, p, forged, game).status).toBe(422);
    expect(balancesOf(c.db, p.id).prisms).toBe(0);
  });

  it('le Défi quotidien et la Campagne n’ont aucun drop : aucune ligne « drop » issue d’un défi', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const att = (c.call('POST', '/api/daily/start', { auth: p.auth, body: { date: '2026-10-15' } }).body as { attempt: { id: string } }).attempt;
    const r = playDaily('2026-10-15');
    c.now.t += (r.time + 5) * 1000;
    const res = c.call('POST', '/api/daily/runs', { auth: p.auth, body: { attemptId: att.id, date: '2026-10-15', replay: { v: 1, flips: r.flips }, claimed: { time: r.time, score: r.score }, client: { build: 't' } } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('drop');
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'drop:%'").get()).toEqual({ n: 0 });
  });
});

// ———————————————————————————————————————————————————————————————— défi quotidien

function playDaily(date: string, every = 29): { flips: number[]; time: number; score: number; steps: number } {
  const sim = createSimulation({ mode: 'daily', seed: 0, date });
  for (let i = 0; i < 120 * 900 && sim.state === 'running'; i++) {
    if (i % every === 7) sim.flip();
    sim.step();
    sim.events.length = 0;
  }
  return { flips: [...sim.flipLog], time: sim.time, score: sim.scoring.score, steps: sim.stepIndex };
}
const dailyBody = (attemptId: string, date: string, r: { flips: number[]; time: number; score: number }): unknown => ({ attemptId, date, replay: { v: 1, flips: r.flips }, claimed: { time: r.time, score: r.score }, client: { build: 't' } });
/** Engagement horodaté d'une tentative terminée (empreinte date + score + inversions). */
const commitDaily = (c: Ctx, auth: string, attemptId: string, date: string, r: { flips: number[]; score: number }): HttpResponse =>
  c.call('POST', '/api/daily/commit', { auth, body: { attemptId, digest: sha256Hex(dailyDigestInput(date, r.score, r.flips)) } });
const startDaily = (c: Ctx, auth: string, date = dayString(utcDayNumber(c.now.t))): string => {
  const r = c.call('POST', '/api/daily/start', { auth, body: { date } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { attempt: { id: string } }).attempt.id;
};
const board = (c: Ctx, date?: string, auth?: string): DailyBoard => c.call('GET', '/api/daily/leaderboard', { query: date ? `date=${date}` : '', auth, ip: c.newIp() }).body as DailyBoard;

describe('Défi quotidien : rejeu serveur', () => {
  it('le rejeu du service reproduit exactement la partie (même graine par date, mêmes règles, aucun pouvoir)', () => {
    const date = '2026-10-15';
    const r = playDaily(date);
    const rep = replayDaily(date, r.flips);
    expect(rep.ok).toBe(true);
    if (!rep.ok) return;
    expect(rep.steps).toBe(r.steps);
    expect(rep.score).toBe(r.score);
    // Le Défi n'a jamais de pouvoirs ; sa graine ne dépend que de la date
    expect(createSimulation({ mode: 'daily', seed: 0, date }).powers.enabled).toBe(false);
    expect(dailySeed(date)).not.toBe(dailySeed('2026-10-16'));
    // Le même journal sur une autre date donne une autre partie (la date fait partie de la preuve)
    const other = replayDaily('2026-10-16', r.flips);
    expect(!other.ok || other.steps !== rep.steps || other.score !== rep.score).toBe(true);
    expect(replayDaily('pas-une-date', r.flips)).toEqual({ ok: false, reason: 'bad_replay' });
  });
});

describe('Défi quotidien : soumission, preuves d’horaire, anti-rejeu', () => {
  const date = '2026-10-15';

  it('tentative démarrée en ligne puis envoyée : acceptée, rang calculé, un résultat par joueur ; une tentative ne sert qu’une fois', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const r = playDaily(date);
    const id = startDaily(c, p.auth);
    c.now.t += (r.time + 3) * 1000;
    const ok = c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'accepted', date, rank: 1, personalBest: true, late: false, state: 'open', eligible: true });
    expect((ok.body as { time: number }).time).toBeCloseTo(r.time, 6);
    c.now.t += 4000;
    const again = c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) });
    expect(again.status).toBe(422);
    expect(again.body).toMatchObject({ reason: 'attempt_used' });
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_bests').get()).toEqual({ n: 1 });
    // Aucun effet sur les classements de Survie
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM bests').get()).toEqual({ n: 0 });
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });

  it('le meilleur résultat du jour est conservé (un record par joueur et par date) ; un moins bon n’écrase rien', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const good = playDaily(date, 29);
    const bad = playDaily(date, 3);
    const best = good.steps >= bad.steps ? good : bad;
    const worse = best === good ? bad : good;
    if (best.steps === worse.steps) return;
    for (const r of [best, worse]) {
      const id = startDaily(c, p.auth);
      c.now.t += (r.time + 3) * 1000;
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) }).status).toBe(200);
    }
    expect(board(c, date).entries[0].time).toBeCloseTo(best.time, 6);
  });

  it('preuves : tentative inconnue, d’un autre joueur, mauvaise date ; score falsifié ; durée impossible depuis l’heure de début ; démarrage d’une autre date refusé', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const q = player(c, 'Lea');
    const r = playDaily(date);
    const id = startDaily(c, p.auth);
    c.now.t += (r.time + 3) * 1000;
    expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody('0'.repeat(32), date, r) }).body).toMatchObject({ reason: 'bad_attempt' });
    expect(c.call('POST', '/api/daily/runs', { auth: q.auth, body: dailyBody(id, date, r) }).body).toMatchObject({ reason: 'bad_attempt' });
    c.now.t += 4000;
    expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, '2026-10-14', r) }).body).toMatchObject({ reason: 'bad_attempt' });
    c.now.t += 4000;
    const forged = c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, { ...r, score: r.score * 3, time: r.time + 20 }) });
    expect(forged.body).toMatchObject({ reason: 'divergence' });
    // Tentative consommée par le refus ; une nouvelle, envoyée sans laisser le temps de jouer : durée impossible
    const id2 = startDaily(c, p.auth);
    c.now.t += 4000;
    expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id2, date, r) }).body).toMatchObject({ reason: 'too_fast' });
    expect(c.call('POST', '/api/daily/start', { auth: p.auth, body: { date: '2026-10-14' } }).status).toBe(400);
    expect(c.call('POST', '/api/daily/start', { auth: p.auth, body: { date: '2026-10-16' } }).status).toBe(400);
    expect(c.call('POST', '/api/daily/start', { auth: p.auth, body: { date: 'x' } }).status).toBe(400);
    expect(c.call('POST', '/api/daily/start').status).toBe(401);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_bests').get()).toEqual({ n: 0 });
  });

  it('soumission tardive (00 h 00 – 00 h 15) : acceptée SEULEMENT avec un engagement horodaté par le service avant minuit, identique au résultat envoyé', () => {
    const r = playDaily(date);
    const end = dayStartMs(date) + DAY;
    const setup = (startAt: number): { c: Ctx; p: { id: string; auth: string }; id: string } => {
      const c = ctx(openDb(':memory:'), startAt);
      const p = player(c, 'Axel');
      return { c, p, id: startDaily(c, p.auth) };
    };
    // Engagement reçu à 23 h 55 (la partie est finie), journal complet envoyé à 00 h 05 : accepté « tardif »
    {
      const { c, p, id } = setup(end - 10 * 60_000);
      c.now.t = end - 5 * 60_000;
      expect(commitDaily(c, p.auth, id, date, r).status).toBe(200);
      c.now.t = end + 5 * 60_000;
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) }).body).toMatchObject({ status: 'accepted', late: true, state: 'grace' });
    }
    // Début + durée compatibles avec minuit MAIS aucun engagement avant minuit : refusé (une durée simulée ne prouve pas l'heure de fin)
    {
      const { c, p, id } = setup(end - 10 * 60_000);
      c.now.t = end + 5 * 60_000;
      const res = c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ reason: 'late_unproven' });
    }
    // Engagement d'un AUTRE contenu (score ou inversions différents) : refusé ; engagement trop précoce (avant la durée de jeu) : refusé
    {
      const { c, p, id } = setup(end - 10 * 60_000);
      c.now.t = end - 5 * 60_000;
      const other = playDaily(date, 7);
      commitDaily(c, p.auth, id, date, other);
      c.now.t = end + 5 * 60_000;
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) }).body).toMatchObject({ reason: 'late_unproven' });
    }
    {
      const { c, p, id } = setup(end - 1000);
      c.now.t = end - 500;
      commitDaily(c, p.auth, id, date, r); // moins d'une seconde après le début : la partie n'a pas pu être jouée
      c.now.t = end + 5 * 60_000;
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) }).body).toMatchObject({ reason: 'late_unproven' });
    }
    // Engagement envoyé APRÈS minuit : refusé (409), donc aucune soumission tardive possible ; engagement figé (le premier reste) ; format invalide
    {
      const { c, p, id } = setup(end - 10 * 60_000);
      c.now.t = end - 5 * 60_000;
      expect(commitDaily(c, p.auth, id, date, r).body).toMatchObject({ repeated: false });
      expect(commitDaily(c, p.auth, id, date, r).body).toMatchObject({ repeated: true });
      expect(commitDaily(c, p.auth, id, date, playDaily(date, 7)).status).toBe(409);
      expect(c.call('POST', '/api/daily/commit', { auth: p.auth, body: { attemptId: id, digest: 'zz' } }).status).toBe(400);
      expect(c.call('POST', '/api/daily/commit', { auth: p.auth, body: { attemptId: '0'.repeat(32), digest: 'a'.repeat(64) } }).status).toBe(400);
      c.now.t = end + 1000;
      const id2 = id;
      expect(commitDaily(c, p.auth, id2, date, r).status).toBe(200); // déjà engagé avant minuit : répétition sans effet
    }
    {
      const { c, p, id } = setup(end - 10 * 60_000);
      c.now.t = end + 60_000;
      expect(commitDaily(c, p.auth, id, date, r).status).toBe(409);
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) }).body).toMatchObject({ reason: 'late_unproven' });
    }
    // Après 00 h 15 : plus rien n'est accepté, même avec un engagement parfait
    {
      const { c, p, id } = setup(end - 10 * 60_000);
      c.now.t = end - 5 * 60_000;
      commitDaily(c, p.auth, id, date, r);
      c.now.t = end + 15 * 60_000;
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) }).body).toMatchObject({ reason: 'closed' });
    }
    // Avant minuit : l'envoi complet suffit (l'heure d'arrivée est celle du service) ; un ticket ou un horodatage client ne prouvent rien
    {
      const { c, p, id } = setup(end - 10 * 60_000);
      c.now.t = end - 60_000;
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: { ...(dailyBody(id, date, r) as object), startedAt: end - 5000, finishedAt: end - 1 } }).body).toMatchObject({ status: 'accepted', late: false });
      const c2 = ctx(openDb(':memory:'), end + 60_000);
      const p2 = player(c2, 'Lea');
      expect(c2.call('POST', '/api/daily/start', { auth: p2.auth, body: { date, startedAt: end - 5000 } }).status).toBe(400);
    }
  });
});

describe('Défi quotidien : classement, ex æquo, clôture et Prismes', () => {
  const date = '2026-10-15';
  const end = dayStartMs(date) + DAY;

  /** Insère directement des résultats (durée en pas, score) pour des profils avec pseudo : l'objet testé est le calcul des rangs et des Prismes. */
  let nameSeq = 0;
  function seed(c: Ctx, results: { steps: number; score: number }[], d = date): { id: string; auth: string }[] {
    return results.map((r, i) => {
      const p = player(c, `Pilote${String.fromCharCode(65 + (nameSeq % 26))}${Math.floor(nameSeq++ / 26)}x`);
      void i;
      const run = Number((c.db.prepare("INSERT INTO daily_runs (player_id, date, attempt_id, steps, score, flips, created_at) VALUES (?, ?, 'a', ?, ?, '[]', 1)").run(p.id, d, r.steps, r.score) as unknown as { lastInsertRowid: number | bigint }).lastInsertRowid);
      c.db.prepare('INSERT INTO daily_bests (player_id, date, steps, score, run_id, achieved_at) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, d, r.steps, r.score, run, 1000 + i);
      return p;
    });
  }
  const results = (c: Ctx, d = date): { rank: number; prisms: number; player_id: string }[] => c.db.prepare('SELECT rank, prisms, player_id FROM daily_results WHERE date = ? ORDER BY rank, player_id').all(d) as unknown as { rank: number; prisms: number; player_id: string }[];
  const closeAt = (c: Ctx, d = date): void => {
    c.now.t = dayStartMs(d) + DAY + DAILY_RANKING.graceMinutes * 60_000;
    c.app.tick(true);
  };

  it('dix joueurs éligibles sans égalité : 15+10+5+4×2+3×1 = 41 Prismes crédités au registre', () => {
    const c = ctx();
    const ps = seed(c, Array.from({ length: 10 }, (_, i) => ({ steps: 10000 - i * 100, score: 5000 })));
    seed(c, [{ steps: 100, score: 1 }, { steps: 50, score: 1 }]); // 11ᵉ et 12ᵉ : rien
    closeAt(c);
    expect(results(c).map((r) => r.prisms)).toEqual([15, 10, 5, 2, 2, 2, 2, 1, 1, 1]);
    expect(results(c).reduce((t, r) => t + r.prisms, 0)).toBe(41);
    expect(balancesOf(c.db, ps[0].id).prisms).toBe(15);
    expect(balancesOf(c.db, ps[9].id).prisms).toBe(1);
    expect(c.db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE ref = ?").get(`daily:${date}`)).toEqual({ n: 41 });
    expect(c.db.prepare('SELECT rewarded FROM daily_closed WHERE date = ?').get(date)).toEqual({ rewarded: 41 });
  });

  it('ex æquo : même rang = même récompense, les rangs suivants sautent (égalités aux rangs 1, 3, 7 et 10)', () => {
    // Durées/scores : A=B (rang 1) ; C (rang 3) ; D=E (rang 4) ; F (6) ; G=H (rang 7) ; I (9) ; J=K=L (rang 10)
    const c = ctx();
    const data = [
      [1000, 50], [1000, 50],
      [900, 40],
      [800, 30], [800, 30],
      [700, 20],
      [600, 10], [600, 10],
      [500, 9],
      [400, 5], [400, 5], [400, 5],
      [300, 1],
    ].map(([steps, score]) => ({ steps, score }));
    seed(c, data);
    closeAt(c);
    const r = results(c);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3, 4, 4, 6, 7, 7, 9, 10, 10, 10]);
    expect(r.map((x) => x.prisms)).toEqual([15, 15, 5, 2, 2, 2, 2, 2, 1, 1, 1, 1]);
    // Tous les ex æquo du 10ᵉ rang sont récompensés : la distribution dépasse 41
    expect(r.reduce((t, x) => t + x.prisms, 0)).toBe(15 + 15 + 5 + 2 + 2 + 2 + 2 + 2 + 1 + 1 + 1 + 1);
    expect(r.reduce((t, x) => t + x.prisms, 0)).toBeGreaterThan(41);
    // Le 13ᵉ (rang 13) n'a rien
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_results WHERE date = ?').get(date)).toEqual({ n: 12 });
  });

  it('égalité = métriques officielles identiques (durée ET score) : à durée égale, le score départage', () => {
    const c = ctx();
    seed(c, [{ steps: 1000, score: 60 }, { steps: 1000, score: 50 }, { steps: 1000, score: 50 }]);
    closeAt(c);
    expect(results(c).map((x) => x.rank)).toEqual([1, 2, 2]);
    expect(results(c).map((x) => x.prisms)).toEqual([15, 10, 10]);
  });

  it('profils invités et exclus par la modération : ni classés, ni récompensés ; leurs résultats ne déplacent personne', () => {
    const c = ctx();
    const ps = seed(c, [{ steps: 900, score: 1 }, { steps: 800, score: 1 }]);
    const g = guest(c);
    c.db.prepare("INSERT INTO daily_bests (player_id, date, steps, score, run_id, achieved_at) VALUES (?, ?, 5000, 99, 1, 1)").run(g.id, date);
    const bad = seed(c, [{ steps: 7000, score: 1 }])[0];
    c.db.prepare('UPDATE players SET moderation = 2 WHERE id = ?').run(bad.id);
    closeAt(c);
    expect(results(c).map((x) => [x.player_id, x.rank, x.prisms])).toEqual([[ps[0].id, 1, 15], [ps[1].id, 2, 10]]);
    expect(balancesOf(c.db, g.id).prisms).toBe(0);
    expect(board(c, date).entries.map((e) => e.rank)).toEqual([1, 2]);
  });

  it('un invité obtient ses récompenses avec un simple pseudo (aucun compte OAuth) : classement du jour et Prismes, avant la clôture', () => {
    const c = ctx();
    const g = guest(c);
    c.db.prepare('INSERT INTO daily_bests (player_id, date, steps, score, run_id, achieved_at) VALUES (?, ?, 5000, 9, 1, 1)').run(g.id, date);
    expect(board(c, date, g.auth).me).toMatchObject({ eligible: false, prisms: 0 });
    expect(c.call('PATCH', '/api/me', { auth: g.auth, body: { nickname: 'Nova' } }).status).toBe(200);
    expect(board(c, date, g.auth).me).toMatchObject({ eligible: true, rank: 1, prisms: 15 });
    closeAt(c);
    expect(balancesOf(c.db, g.id).prisms).toBe(15);
    // Pas de compte OAuth : aucune identité n'est associée au profil
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM identities WHERE player_id = ?').get(g.id)).toEqual({ n: 0 });
  });

  it('clôture : rien avant 00 h 15 UTC, tout à 00 h 15 ; statut ouvert → provisoire → définitif', () => {
    const c = ctx();
    seed(c, [{ steps: 900, score: 1 }]);
    c.now.t = end - 1;
    c.app.tick(true);
    expect(board(c, date).status).toBe('open');
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_closed').get()).toEqual({ n: 0 });
    c.now.t = end;
    expect(board(c, date).status).toBe('grace');
    c.now.t = end + 15 * 60_000 - 1;
    c.app.tick(true);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_closed').get()).toEqual({ n: 0 });
    expect(board(c, date).status).toBe('grace');
    c.now.t = end + 15 * 60_000;
    expect(board(c, date).status).toBe('final'); // la consultation déclenche aussi la clôture échue
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_closed').get()).toEqual({ n: 1 });
  });

  it('idempotent et rejouable après panne : relancer ne crédite jamais deux fois ; plusieurs jours échus pendant l’arrêt sont clos dans l’ordre', () => {
    const c = ctx();
    const a = seed(c, [{ steps: 900, score: 1 }, { steps: 800, score: 1 }]);
    seed(c, [{ steps: 700, score: 1 }], '2026-10-16');
    closeAt(c);
    const before = balancesOf(c.db, a[0].id).prisms;
    for (let i = 0; i < 3; i++) c.app.tick(true);
    expect(balancesOf(c.db, a[0].id).prisms).toBe(before);
    // Panne simulée : le marqueur de clôture est perdu, les crédits existent déjà → la reprise ne duplique rien
    c.db.prepare('DELETE FROM daily_closed WHERE date = ?').run(date);
    c.db.prepare('DELETE FROM daily_results WHERE date = ?').run(date);
    c.app.tick(true);
    expect(balancesOf(c.db, a[0].id).prisms).toBe(before);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref = ?").get(`daily:${date}`)).toEqual({ n: 2 });
    expect(results(c)).toHaveLength(2);
    // Le service est arrêté 3 jours : au redémarrage (nouvelle application sur la même base), tout ce qui est échu est clos
    c.now.t = dayStartMs('2026-10-20');
    const restarted = createApp(c.db, { ticketSecret: SECRET, now: () => c.now.t, balance: BALANCE_VERSION });
    expect(restarted).toBeTypeOf('function');
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_closed').get()).toEqual({ n: 2 });
  });

  it('une soumission après la clôture est refusée ; une journée sans joueur ne produit rien', () => {
    const c = ctx();
    const p = player(c, 'Axel');
    const r = playDaily(date);
    const id = startDaily(c, p.auth);
    closeAt(c);
    const res = c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) });
    expect(res.body).toMatchObject({ reason: 'closed' });
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM daily_results').get()).toEqual({ n: 0 });
  });

  it('classement consultable : rang personnel, Prismes provisoires puis définitifs, compte à rebours, invité signalé non éligible', () => {
    const c = ctx();
    const ps = seed(c, Array.from({ length: 12 }, (_, i) => ({ steps: 5000 - i * 10, score: 1 })));
    const g = guest(c);
    c.db.prepare("INSERT INTO daily_bests (player_id, date, steps, score, run_id, achieved_at) VALUES (?, ?, 100, 1, 1, 1)").run(g.id, date);
    const b = board(c, date, ps[2].auth);
    expect(b).toMatchObject({ date, status: 'open', total: 12, endsAt: end, finalAt: end + 15 * 60_000, me: { rank: 3, prisms: 5, eligible: true } });
    expect(b.entries).toHaveLength(12);
    expect(b.entries[2]).toMatchObject({ rank: 3, prisms: 5, you: true });
    expect(b.entries[11].prisms).toBe(0);
    expect(board(c, date, g.auth).me).toMatchObject({ eligible: false, prisms: 0 });
    closeAt(c);
    expect(board(c, date, ps[2].auth)).toMatchObject({ status: 'final', me: { rank: 3, prisms: 5 } });
    // Dates invalides ou futures refusées
    expect(c.call('GET', '/api/daily/leaderboard', { query: 'date=2099-01-01', ip: c.newIp() }).status).toBe(400);
    expect(c.call('GET', '/api/daily/leaderboard', { query: 'date=nope', ip: c.newIp() }).status).toBe(400);
  });

  it('notification au prochain lancement : rang et Prismes gagnés, une seule fois (accusé de réception)', () => {
    const c = ctx();
    const ps = seed(c, [{ steps: 900, score: 1 }, { steps: 800, score: 1 }]);
    closeAt(c);
    const n = c.call('GET', '/api/daily/notices', { auth: ps[0].auth }).body as DailyNoticesResponse;
    expect(n.notices).toEqual([{ date, rank: 1, prisms: 15, time: 900 * SIM.dt, score: 1 }]);
    expect(c.call('POST', '/api/daily/ack', { auth: ps[0].auth, body: { dates: [date] } }).status).toBe(200);
    expect((c.call('GET', '/api/daily/notices', { auth: ps[0].auth }).body as DailyNoticesResponse).notices).toEqual([]);
    expect((c.call('GET', '/api/daily/notices', { auth: ps[1].auth }).body as DailyNoticesResponse).notices).toHaveLength(1);
    expect(c.call('POST', '/api/daily/ack', { auth: ps[0].auth, body: { dates: ['x'] } }).status).toBe(400);
    expect(c.call('GET', '/api/daily/notices').status).toBe(401);
  });

  it('bout en bout : trois tentatives réelles (rejeu), clôture, Prismes ; les égalités exactes partagent le rang', () => {
    const c = ctx();
    const a = player(c, 'Axel');
    const b = player(c, 'Lea');
    const d = player(c, 'Nova');
    const same = playDaily(date, 29);
    const lower = playDaily(date, 5);
    const flows: [typeof a, ReturnType<typeof playDaily>][] = [[a, same], [b, same], [d, lower]];
    for (const [p, r] of flows) {
      const id = startDaily(c, p.auth);
      c.now.t += (r.time + 3) * 1000;
      expect(c.call('POST', '/api/daily/runs', { auth: p.auth, body: dailyBody(id, date, r) }).status).toBe(200);
      c.now.t += 4000;
    }
    closeAt(c);
    const rs = results(c);
    if (same.steps === lower.steps && same.score === lower.score) return;
    const expectedTop = same.steps > lower.steps || (same.steps === lower.steps && same.score > lower.score);
    expect(rs.map((x) => x.rank)).toEqual(expectedTop ? [1, 1, 3] : [1, 2, 2]);
    expect(rs.map((x) => x.prisms)).toEqual(expectedTop ? [15, 15, 5] : [15, 10, 10]);
  });
});

describe('Migration SQLite v6 : additive, sans toucher aux données existantes', () => {
  it('les tables de récompenses sont créées, le schéma v5 (records, tickets, parties) est conservé tel quel', async () => {
    const { MIGRATIONS, SCHEMA_VERSION } = await import('../server/db');
    const { DatabaseSync } = await import('node:sqlite');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    expect(SCHEMA_VERSION).toBe(8);
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-v6-'));
    try {
      const path = join(dir, 'c.sqlite');
      const old = new DatabaseSync(path);
      for (let i = 0; i < 5; i++) old.exec(MIGRATIONS[i]);
      old.exec('PRAGMA user_version = 5');
      old.prepare("INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES ('p1', 'Axel', 'axel', 'h', 1)").run();
      old.prepare("INSERT INTO tickets (id, player_id, seed, exp, issued_at) VALUES ('t1', 'p1', 5, 9999999999, 1)").run();
      old.prepare("INSERT INTO runs (id, player_id, balance, ticket_id, seed, steps, score, flips, created_at) VALUES (1, 'p1', 3, 't1', 5, 4000, 900, '[1]', 10)").run();
      old.prepare("INSERT INTO bests (player_id, balance, category, steps, score, run_id, achieved_at) VALUES ('p1', 3, 'plain', 4000, 900, 1, 10)").run();
      old.close();
      const db = openDb(path);
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
      expect(db.prepare('SELECT steps, score FROM bests').all()).toEqual([{ steps: 4000, score: 900 }]);
      expect(db.prepare('SELECT id, started_at FROM tickets').all()).toEqual([{ id: 't1', started_at: null }]);
      expect(db.prepare('SELECT drop_prisms FROM runs').all()).toEqual([{ drop_prisms: 0 }]);
      for (const t of ['loyalty_cycles', 'daily_attempts', 'daily_runs', 'daily_bests', 'daily_results', 'daily_closed']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SHA-256 de l’engagement : identique à node:crypto', () => {
  it('vecteurs connus, longueurs limites du bourrage, texte accentué', async () => {
    const { createHash } = await import('node:crypto');
    for (const t of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(119), 'é€😀 inversions', JSON.stringify(Array.from({ length: 500 }, (_, i) => i * 7))]) {
      expect(sha256Hex(t), t.slice(0, 12)).toBe(createHash('sha256').update(t).digest('hex'));
    }
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
