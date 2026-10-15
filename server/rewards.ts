import { createHmac, randomBytes } from 'node:crypto';
import { SIM } from '../src/config/balance';
import { BONUS } from '../src/config/economy';
import { DAILY_RANKING, DROPS, LOYALTY, LOYALTY_LENGTH, dailyPrizeForRank } from '../src/config/rewards';
import { sha256Hex } from '../src/core/sha256';
import { validFlips } from '../src/net/protocol';
import { dailyDigestInput } from '../src/net/rewardsProtocol';
import type {
  DailyAttempt,
  DailyBoard,
  DailyEntry,
  DailyNotice,
  DailyRejectReason,
  DailyRunResponse,
  DailyStatus,
  LoyaltyClaimResponse,
  LoyaltyCycleView,
  LoyaltyState,
} from '../src/net/rewardsProtocol';
import type { HttpRequest, HttpResponse, PlayerRow } from './app';
import { transaction, type Db } from './db';
import { balancesOf, inventoryOf } from './profile';
import { replayDaily } from './verify';

/**
 * Récompenses gratuites (phase 4) : calendrier de connexion, classement mondial du Défi quotidien, drop rare de Prismes.
 *
 * Principes : le SERVICE fait seul autorité sur les dates (UTC), les classements et les tirages ; chaque crédit est une ligne du registre `ledger`
 * (clé unique par profil → idempotent, jamais de doublon) écrite dans la même transaction que la décision ; aucune route ne crédite sur la
 * simple demande du client ; tout ce qui est « à faire à une heure donnée » (clôture d'un défi) est rejouable après une panne.
 */

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const HOUR = 3_600_000;

// ————————————————————————— dates UTC

export const utcDayNumber = (ms: number): number => Math.floor(ms / DAY_MS);
export const dayString = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const dayStartMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(dayStartMs(v)) && dayString(utcDayNumber(dayStartMs(v))) === v;

// ————————————————————————— calendrier : progression (fonction pure)

export interface CycleCounters {
  days: number;
  absences: number;
  lastDay: number;
}

export type PresenceOutcome =
  | { kind: 'same'; next: CycleCounters }
  | { kind: 'advance'; next: CycleCounters }
  /** Nouveau cycle (premier cycle, cycle précédent terminé, ou deuxième absence). */
  | { kind: 'start' | 'reset'; next: CycleCounters };

/**
 * Applique la présence du jour UTC `day`. Règles : une absence tolérée par cycle (la deuxième, même non consécutive, réinitialise) ; un cycle terminé
 * (10 jours) est suivi d'un nouveau cycle au prochain jour UTC éligible ; une présence ne compte qu'une fois par jour.
 */
export function nextPresence(cur: CycleCounters | null, day: number): PresenceOutcome {
  const fresh: CycleCounters = { days: 1, absences: 0, lastDay: day };
  if (!cur) return { kind: 'start', next: fresh };
  if (day <= cur.lastDay) return { kind: 'same', next: cur };
  if (cur.days >= LOYALTY_LENGTH) return { kind: 'start', next: fresh };
  const absences = cur.absences + (day - cur.lastDay - 1);
  if (absences > LOYALTY.absencesAllowed) return { kind: 'reset', next: fresh };
  return { kind: 'advance', next: { days: cur.days + 1, absences, lastDay: day } };
}

// ————————————————————————— drop rare de Prismes

const dropKey = (secret: string): Buffer => createHmac('sha256', secret).update('polar-rift/drop/v1').digest();

/** Tirage de la balise `index` (1, 2, …) d'un ticket : déterministe, dérivé du secret du service — le client ne peut ni le prévoir ni le choisir. */
export function dropDraw(secret: string, ticketId: string, index: number): number {
  const h = createHmac('sha256', dropKey(secret)).update(`${ticketId}|${index}`).digest();
  return h.readUIntBE(0, 6) / 2 ** 48;
}

/** Index (1-based) de la première balise gagnante parmi `beacons` balises collectées, 0 si aucune. Un seul Prisme par partie. */
export function rollDrop(secret: string, ticketId: string, beacons: number): number {
  const n = Math.min(Math.max(0, Math.floor(beacons)), 100_000);
  for (let i = 1; i <= n; i++) if (dropDraw(secret, ticketId, i) < DROPS.prism.chancePerBeacon) return i;
  return 0;
}

// ————————————————————————— service

export interface RewardsDeps {
  db: Db;
  now: () => number;
  allow: (key: string, max: number, windowMs: number) => boolean;
  authenticate: (req: HttpRequest) => PlayerRow | null;
}

export interface Rewards {
  handle(req: HttpRequest): HttpResponse | null;
  /** Clôture les défis quotidiens échus (rejouable : sans effet si tout est déjà clos). Appelée au démarrage, par minuteur et à chaque route du défi. */
  tick(force?: boolean): number;
}

const json = (status: number, body: unknown): HttpResponse => ({ status, body });
const err = (status: number, error: string, message: string): HttpResponse => json(status, { error, message });
const RATE = 'Trop de requêtes : réessayez plus tard.';

const DAILY_MESSAGES: Record<DailyRejectReason, string> = {
  bad_attempt: 'Tentative inconnue : une tentative classée doit être démarrée en ligne.',
  attempt_used: 'Cette tentative a déjà été envoyée.',
  closed: 'Ce défi est clos : les résultats ne sont plus acceptés.',
  late_unproven: 'Soumission tardive refusée : aucun engagement de fin de tentative reçu par le service avant minuit (ou engagement différent du résultat envoyé).',
  too_fast: 'Durée incohérente avec l’heure de début enregistrée par le service.',
  bad_replay: 'Journal des entrées invalide.',
  not_finished: 'La partie rejouée ne se termine pas.',
  inputs_after_end: 'Journal incohérent : entrées après la fin de la partie.',
  divergence: 'Le résultat annoncé ne correspond pas au rejeu du service.',
  rate_limited: RATE,
  excluded: 'Ce profil a été exclu du classement par la modération.',
};

export function createRewards(deps: RewardsDeps): Rewards {
  const { db, now, allow, authenticate } = deps;
  const dt = SIM.dt;

  const q = {
    cycleCurrent: db.prepare('SELECT id, days, absences, last_day, started_day FROM loyalty_cycles WHERE player_id = ? AND current = 1 ORDER BY id DESC LIMIT 1'),
    cycles: db.prepare('SELECT id, days, absences, last_day, current FROM loyalty_cycles WHERE player_id = ? ORDER BY id DESC LIMIT 200'),
    cycle: db.prepare('SELECT id, player_id, days FROM loyalty_cycles WHERE id = ?'),
    endCycles: db.prepare('UPDATE loyalty_cycles SET current = 0 WHERE player_id = ? AND current = 1'),
    newCycle: db.prepare('INSERT INTO loyalty_cycles (player_id, started_day, days, absences, last_day, current) VALUES (?, ?, ?, ?, ?, 1)'),
    updCycle: db.prepare('UPDATE loyalty_cycles SET days = ?, absences = ?, last_day = ? WHERE id = ?'),
    claimedRefs: db.prepare("SELECT ref FROM ledger WHERE player_id = ? AND ref LIKE 'loy:%'"),
    ledgerHas: db.prepare('SELECT amount FROM ledger WHERE player_id = ? AND ref = ?'),
    ledgerAdd: db.prepare('INSERT OR IGNORE INTO ledger (player_id, currency, kind, amount, ref, at, meta) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    playerFlags: db.prepare('SELECT guest, moderation FROM players WHERE id = ?'),
    attempt: db.prepare('SELECT id, player_id, date, started_at, used_at, commit_digest, committed_at FROM daily_attempts WHERE id = ?'),
    commitAttempt: db.prepare('UPDATE daily_attempts SET commit_digest = ?, committed_at = ? WHERE id = ? AND commit_digest IS NULL AND used_at IS NULL'),
    insertAttempt: db.prepare('INSERT INTO daily_attempts (id, player_id, date, started_at) VALUES (?, ?, ?, ?)'),
    useAttempt: db.prepare('UPDATE daily_attempts SET used_at = ? WHERE id = ? AND used_at IS NULL'),
    openAttempts: db.prepare('SELECT COUNT(*) AS n FROM daily_attempts WHERE player_id = ? AND date = ? AND used_at IS NULL'),
    insertDailyRun: db.prepare('INSERT INTO daily_runs (player_id, date, attempt_id, steps, score, flips, client_build, created_at, late) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    dailyBest: db.prepare('SELECT steps, score, achieved_at FROM daily_bests WHERE player_id = ? AND date = ?'),
    upsertDailyBest: db.prepare('INSERT INTO daily_bests (player_id, date, steps, score, run_id, achieved_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(player_id, date) DO UPDATE SET steps = excluded.steps, score = excluded.score, run_id = excluded.run_id, achieved_at = excluded.achieved_at'),
    ranked: db.prepare('SELECT b.player_id, p.nickname, b.steps, b.score, b.achieved_at FROM daily_bests b JOIN players p ON p.id = b.player_id WHERE b.date = ? AND p.moderation < 2 AND p.guest = 0 ORDER BY b.steps DESC, b.score DESC, b.achieved_at ASC, b.player_id ASC'),
    betterCount: db.prepare('SELECT COUNT(*) AS n FROM daily_bests b JOIN players p ON p.id = b.player_id WHERE b.date = ? AND p.moderation < 2 AND p.guest = 0 AND (b.steps > ? OR (b.steps = ? AND b.score > ?))'),
    totalRanked: db.prepare('SELECT COUNT(*) AS n FROM daily_bests b JOIN players p ON p.id = b.player_id WHERE b.date = ? AND p.moderation < 2 AND p.guest = 0'),
    closed: db.prepare('SELECT date FROM daily_closed WHERE date = ?'),
    dueDates: db.prepare('SELECT DISTINCT date FROM daily_bests WHERE date NOT IN (SELECT date FROM daily_closed) ORDER BY date LIMIT 60'),
    insertResult: db.prepare('INSERT OR IGNORE INTO daily_results (date, player_id, rank, steps, score, prisms) VALUES (?, ?, ?, ?, ?, ?)'),
    insertClosed: db.prepare('INSERT OR IGNORE INTO daily_closed (date, closed_at, rewarded) VALUES (?, ?, ?)'),
    results: db.prepare('SELECT date, rank, steps, score, prisms FROM daily_results WHERE player_id = ? AND notified_at IS NULL ORDER BY date'),
    closedRow: db.prepare('SELECT date, rewarded FROM daily_closed WHERE date = ?'),
    resultOf: db.prepare('SELECT rank, prisms FROM daily_results WHERE date = ? AND player_id = ?'),
    ackResult: db.prepare('UPDATE daily_results SET notified_at = ? WHERE player_id = ? AND date = ? AND notified_at IS NULL'),
    ticketStart: db.prepare('SELECT id, player_id, used_at, exp, started_at FROM tickets WHERE id = ?'),
    setTicketStart: db.prepare('UPDATE tickets SET started_at = ? WHERE id = ? AND started_at IS NULL AND used_at IS NULL'),
  };

  const ledger = (playerId: string, currency: string, kind: string, amount: number, ref: string, meta?: Record<string, unknown>): boolean =>
    Number(q.ledgerAdd.run(playerId, currency, kind, amount, ref, now(), meta ? JSON.stringify(meta) : null).changes) === 1;

  // ————————————————————————— calendrier de connexion

  function loyaltyState(me: PlayerRow): LoyaltyState {
    const t = now();
    const today = utcDayNumber(t);
    const claimed = new Set((q.claimedRefs.all(me.id) as unknown as { ref: string }[]).map((r) => r.ref));
    const rows = q.cycles.all(me.id) as unknown as { id: number; days: number; absences: number; last_day: number; current: number }[];
    const cycles: LoyaltyCycleView[] = [];
    let claimable = 0;
    for (const r of rows) {
      const days = LOYALTY.days.map((reward, i) => ({ day: i + 1, reward, unlocked: i + 1 <= r.days, claimed: claimed.has(`loy:${r.id}:${i + 1}`) }));
      const open = days.filter((d) => d.unlocked && !d.claimed).length;
      claimable += open;
      if (r.current === 1 || open > 0) cycles.push({ id: r.id, days, current: r.current === 1, absences: r.absences, complete: r.days >= LOYALTY_LENGTH });
    }
    cycles.sort((a, b) => Number(b.current) - Number(a.current) || b.id - a.id);
    const cur = rows.find((r) => r.current === 1);
    const flags = q.playerFlags.get(me.id) as unknown as { guest: number; moderation: number };
    const inv = inventoryOf(db, me.id);
    return {
      today: dayString(today),
      nextDayAt: (today + 1) * DAY_MS,
      presentToday: !!cur && cur.last_day === today,
      cycles,
      absencesLeft: cur && cur.days < LOYALTY_LENGTH ? Math.max(0, LOYALTY.absencesAllowed - cur.absences) : null,
      claimable,
      canClaimPrisms: flags.guest === 0 && flags.moderation < 2,
      stock: { boost: inv.boost, gel: inv.gel, max: BONUS.maxStock },
    };
  }

  /** Une connexion VALIDE la présence du jour UTC du service (jamais celle annoncée par l'appareil). Idempotent dans la journée. */
  function checkin(me: PlayerRow): HttpResponse {
    if (!allow(`loyalty:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    transaction(db, () => {
      const day = utcDayNumber(now());
      const cur = q.cycleCurrent.get(me.id) as unknown as { id: number; days: number; absences: number; last_day: number } | undefined;
      const out = nextPresence(cur ? { days: cur.days, absences: cur.absences, lastDay: cur.last_day } : null, day);
      if (out.kind === 'same') return;
      if (out.kind === 'advance' && cur) {
        q.updCycle.run(out.next.days, out.next.absences, out.next.lastDay, cur.id);
        return;
      }
      q.endCycles.run(me.id);
      q.newCycle.run(me.id, day, out.next.days, out.next.absences, out.next.lastDay);
    });
    return json(200, loyaltyState(me));
  }

  function loyaltyGet(me: PlayerRow): HttpResponse {
    if (!allow(`loyalty-get:${me.id}`, 240, HOUR)) return err(429, 'rate_limited', RATE);
    return json(200, loyaltyState(me));
  }

  /**
   * Réclamation MANUELLE d'une récompense débloquée : atomique (décision + ligne du registre dans la même transaction), idempotente (clé
   * `loy:<cycle>:<jour>` unique par profil), jamais plus d'une fois. Boost/Gel : refusée tant que le stock est plein (la récompense reste récupérable).
   * Prismes : réservés aux profils avec pseudo ou compte (protection contre la création en série de profils invités).
   */
  function claim(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`loyalty-claim:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    const b = req.body as { cycle?: unknown; day?: unknown } | undefined;
    if (!Number.isInteger(b?.cycle) || !Number.isInteger(b?.day) || (b!.day as number) < 1 || (b!.day as number) > LOYALTY_LENGTH) return err(400, 'bad_request', 'Requête invalide.');
    const cycleId = b!.cycle as number;
    const day = b!.day as number;
    return transaction(db, () => {
      const c = q.cycle.get(cycleId) as unknown as { id: number; player_id: string; days: number } | undefined;
      if (!c || c.player_id !== me.id) return err(400, 'bad_request', 'Récompense inconnue.');
      if (day > c.days) return err(409, 'locked', 'Cette récompense n’est pas encore débloquée.');
      const reward = LOYALTY.days[day - 1];
      const ref = `loy:${cycleId}:${day}`;
      const done = (credited: boolean): HttpResponse =>
        json(200, { cycle: cycleId, day, reward, credited, balance: balancesOf(db, me.id), inventory: inventoryOf(db, me.id), state: loyaltyState(me) } satisfies LoyaltyClaimResponse);
      if (q.ledgerHas.get(me.id, ref)) return done(false);
      if (reward.kind === 'prisms') {
        const f = q.playerFlags.get(me.id) as unknown as { guest: number; moderation: number };
        if (f.guest !== 0 || f.moderation >= 2) return err(403, 'account_required', 'Choisissez un pseudo (menu Classement) ou connectez un compte pour récupérer des Prismes : la récompense reste disponible.');
      }
      if (reward.kind === 'boost' || reward.kind === 'gel') {
        if (inventoryOf(db, me.id)[reward.kind] + reward.amount > BONUS.maxStock) return err(409, 'stock_full', 'Stock plein pour ce bonus : utilisez-en un, la récompense reste disponible.');
      }
      ledger(me.id, reward.kind, 'loyalty', reward.amount, ref, { cycle: cycleId, day });
      return done(true);
    });
  }

  // ————————————————————————— défi quotidien : clôture

  const statusOf = (date: string, t: number): DailyStatus => {
    const end = dayStartMs(date) + DAY_MS;
    return t < end ? 'open' : t < end + DAILY_RANKING.graceMinutes * MIN_MS ? 'grace' : 'final';
  };

  /** Classement avec rangs « compétition » (ex æquo = même rang, le suivant saute), jusqu'au rang `maxRank` inclus ET tous ses ex æquo. */
  function rankedRows(date: string, maxRank: number, maxRows: number): { rank: number; player_id: string; nickname: string; steps: number; score: number }[] {
    const out: { rank: number; player_id: string; nickname: string; steps: number; score: number }[] = [];
    let i = 0;
    let rank = 0;
    let prev: { steps: number; score: number } | null = null;
    for (const r of q.ranked.iterate(date) as Iterable<{ player_id: string; nickname: string; steps: number; score: number }>) {
      i++;
      if (!prev || r.steps !== prev.steps || r.score !== prev.score) rank = i;
      prev = r;
      if (rank > maxRank || out.length >= maxRows) break;
      out.push({ rank, player_id: r.player_id, nickname: r.nickname, steps: r.steps, score: r.score });
    }
    return out;
  }

  let lastTick = 0;
  /**
   * Clôture des défis échus (00 h 15 UTC passées) : Top 10 + tous les ex æquo du 10ᵉ rang figés dans `daily_results`, Prismes crédités au registre
   * (clé `daily:<date>`, unique par profil) dans UNE transaction avec le marqueur `daily_closed`. Rejouable : un défi déjà clos est ignoré, une
   * panne en cours de route n'a rien écrit (transaction) et la clôture reprend au prochain appel.
   */
  function tick(force = false): number {
    const t = now();
    if (!force && t - lastTick < 20_000) return 0;
    lastTick = t;
    let closedCount = 0;
    const dates = (q.dueDates.all() as unknown as { date: string }[]).map((r) => r.date);
    for (const date of dates) {
      if (statusOf(date, t) !== 'final') continue;
      transaction(db, () => {
        if (q.closed.get(date)) return;
        let rewarded = 0;
        for (const r of rankedRows(date, DAILY_RANKING.lastRewardedRank, 10_000)) {
          const prisms = dailyPrizeForRank(r.rank);
          q.insertResult.run(date, r.player_id, r.rank, r.steps, r.score, prisms);
          if (prisms > 0 && ledger(r.player_id, 'prisms', 'daily', prisms, `daily:${date}`, { date, rank: r.rank })) rewarded += prisms;
        }
        q.insertClosed.run(date, t, rewarded);
        closedCount++;
      });
    }
    return closedCount;
  }

  // ————————————————————————— défi quotidien : routes

  function dailyStart(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`daily-start:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    if (me.moderation === 2) return err(403, 'excluded', DAILY_MESSAGES.excluded);
    const date = (req.body as { date?: unknown } | undefined)?.date;
    const t = now();
    const today = dayString(utcDayNumber(t));
    // Seule la journée UTC en cours se joue en classé ; le service enregistre le début (preuve d'horaire)
    if (!validDate(date) || date !== today) return err(400, 'bad_date', 'Seul le défi du jour (UTC) peut être démarré.');
    // Jamais plus de 20 tentatives ouvertes par jour et par joueur (les tentatives abandonnées s'accumulent sinon)
    if ((q.openAttempts.get(me.id, date) as unknown as { n: number }).n >= 20) return err(429, 'rate_limited', RATE);
    const id = randomBytes(16).toString('hex');
    q.insertAttempt.run(id, me.id, date, t);
    return json(200, { attempt: { id, date, startedAt: t } satisfies DailyAttempt });
  }

  function dailyRun(req: HttpRequest, me: PlayerRow): HttpResponse {
    const reject = (reason: DailyRejectReason, status = 422): HttpResponse => json(status, { status: 'rejected', reason, message: DAILY_MESSAGES[reason] } satisfies DailyRunResponse);
    if (!allow(`daily-run:${me.id}`, 40, HOUR) || !allow(`daily-gap:${me.id}`, 1, 3000)) return reject('rate_limited', 429);
    if (me.moderation === 2) return reject('excluded', 403);
    const sub = req.body as { attemptId?: unknown; date?: unknown; replay?: { v?: unknown; flips?: unknown }; claimed?: { time?: unknown; score?: unknown }; client?: { build?: unknown } } | undefined;
    if (!sub || typeof sub.attemptId !== 'string' || !validDate(sub.date) || !sub.replay || sub.replay.v !== 1 || !validFlips(sub.replay.flips) || !sub.claimed) return reject('bad_replay', 400);
    const date = sub.date;
    const t = now();
    const end = dayStartMs(date) + DAY_MS;
    const grace = end + DAILY_RANKING.graceMinutes * MIN_MS;
    const att = q.attempt.get(sub.attemptId) as unknown as { id: string; player_id: string; date: string; started_at: number; used_at: number | null; commit_digest: string | null; committed_at: number | null } | undefined;
    // La tentative appartient au profil (ou à un profil qu'il a absorbé : les lignes sont déplacées à la fusion), à cette date
    if (!att || att.player_id !== me.id || att.date !== date) return reject('bad_attempt');
    if (att.used_at !== null) return reject('attempt_used');
    if (t >= grace || q.closed.get(date)) return reject('closed');
    const late = t >= end;
    if (!allow('replay:global', 30, MIN_MS)) return reject('rate_limited', 429);
    const flips = sub.replay.flips as number[];
    const rep = replayDaily(date, flips);
    const consume = (): boolean => Number((q.useAttempt.run(t, att.id) as unknown as { changes: number }).changes) === 1;
    if (!rep.ok) {
      transaction(db, () => void consume());
      return reject(rep.reason);
    }
    const durMs = rep.steps * dt * 1000;
    // Preuves d'horaire du SERVICE (jamais une heure annoncée par l'appareil) :
    // 1. l'heure de début a été enregistrée par le service ; la durée active rejouée est un minimum du temps écoulé depuis (tolérance 2 s)
    if (t - att.started_at < durMs - 2000) {
      transaction(db, () => void consume());
      return reject('too_fast');
    }
    // 2. soumission tardive (après 00 h 00, grâce de 15 min) : un début horodaté + une durée simulée ne PROUVENT PAS l'heure de fin (pauses, parties
    //    jouées après minuit). Preuve exigée : un ENGAGEMENT reçu et horodaté par le service AVANT minuit, dont l'empreinte (date, score, inversions) est
    //    exactement celle du journal envoyé maintenant, et qui est postérieur au début + la durée active (la tentative ne pouvait pas être finie plus tôt)
    if (late) {
      const proven =
        att.committed_at !== null &&
        att.committed_at < end &&
        att.started_at < end &&
        att.committed_at - att.started_at >= durMs - 2000 &&
        att.commit_digest === sha256Hex(dailyDigestInput(date, rep.score, flips));
      if (!proven) {
        transaction(db, () => void consume());
        return reject('late_unproven');
      }
    }
    const c = sub.claimed;
    if (typeof c.time !== 'number' || typeof c.score !== 'number' || Math.abs(c.time - rep.time) >= dt / 2 || c.score !== rep.score) {
      transaction(db, () => void consume());
      return reject('divergence');
    }
    const out = transaction(db, () => {
      if (!consume()) return null;
      const runId = Number((q.insertDailyRun.run(me.id, date, att.id, rep.steps, rep.score, JSON.stringify(flips), String(sub.client?.build ?? '').slice(0, 40), t, late ? 1 : 0) as unknown as { lastInsertRowid: number | bigint }).lastInsertRowid);
      const prev = q.dailyBest.get(me.id, date) as unknown as { steps: number; score: number } | undefined;
      const better = !prev || rep.steps > prev.steps || (rep.steps === prev.steps && rep.score > prev.score);
      if (better) q.upsertDailyBest.run(me.id, date, rep.steps, rep.score, runId, t);
      const bestSteps = better ? rep.steps : prev!.steps;
      const bestScore = better ? rep.score : prev!.score;
      const rank = (q.betterCount.get(date, bestSteps, bestSteps, bestScore) as unknown as { n: number }).n + 1;
      return { better, rank };
    });
    if (!out) return reject('attempt_used');
    const flags = q.playerFlags.get(me.id) as unknown as { guest: number };
    return json(200, { status: 'accepted', date, time: rep.time, score: rep.score, rank: out.rank, personalBest: out.better, late, state: statusOf(date, t), eligible: flags.guest === 0 } satisfies DailyRunResponse);
  }

  /**
   * ENGAGEMENT d'une tentative terminée : l'empreinte SHA-256 (date, score, inversions) est enregistrée avec l'heure du SERVICE, avant minuit seulement,
   * une seule fois par tentative (la première est conservée : impossible d'en changer). Il ne crédite ni ne classe rien : il sert de preuve de fin
   * pour une soumission tardive.
   */
  function dailyCommit(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`daily-commit:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    const b = req.body as { attemptId?: unknown; digest?: unknown } | undefined;
    if (typeof b?.attemptId !== 'string' || typeof b.digest !== 'string' || !/^[0-9a-f]{64}$/.test(b.digest)) return err(400, 'bad_request', 'Requête invalide.');
    const t = now();
    return transaction(db, () => {
      const att = q.attempt.get(b.attemptId as string) as unknown as { player_id: string; date: string; used_at: number | null; commit_digest: string | null; committed_at: number | null } | undefined;
      if (!att || att.player_id !== me.id) return err(400, 'bad_attempt', 'Tentative inconnue.');
      if (att.commit_digest !== null) return att.commit_digest === b.digest ? json(200, { committedAt: att.committed_at, repeated: true }) : err(409, 'already_committed', 'Un engagement différent existe déjà pour cette tentative.');
      if (t >= dayStartMs(att.date) + DAY_MS) return err(409, 'too_late', 'L’engagement doit être reçu avant minuit (UTC).');
      if (att.used_at !== null) return err(409, 'attempt_used', 'Tentative déjà envoyée.');
      q.commitAttempt.run(b.digest as string, t, b.attemptId as string);
      return json(200, { committedAt: t, repeated: false });
    });
  }

  function dailyBoard(req: HttpRequest): HttpResponse {
    if (!allow(`daily-lb:${req.ip}`, 120, MIN_MS)) return err(429, 'rate_limited', RATE);
    tick();
    const t = now();
    const raw = req.query.get('date');
    const date = raw === null ? dayString(utcDayNumber(t)) : raw;
    if (!validDate(date) || dayStartMs(date) > t) return err(400, 'bad_date', 'Date invalide.');
    const me = authenticate(req);
    const status = statusOf(date, t);
    // Journée échue et pas encore close (le minuteur n'est pas passé) : on la clôt maintenant, le classement définitif ne dépend jamais du minuteur
    if (status === 'final' && !q.closed.get(date)) tick(true);
    const rows = rankedRows(date, Number.MAX_SAFE_INTEGER, DAILY_RANKING.topSize);
    const entries: DailyEntry[] = rows.map((r) => ({ rank: r.rank, nickname: r.nickname, time: r.steps * dt, score: r.score, prisms: dailyPrizeForRank(r.rank), ...(me && r.player_id === me.id ? { you: true } : {}) }));
    const total = (q.totalRanked.get(date) as unknown as { n: number }).n;
    let mine: DailyBoard['me'] = null;
    if (me) {
      const b = q.dailyBest.get(me.id, date) as unknown as { steps: number; score: number } | undefined;
      if (b) {
        const f = q.playerFlags.get(me.id) as unknown as { guest: number; moderation: number };
        const eligible = f.guest === 0 && f.moderation < 2;
        const rank = (q.betterCount.get(date, b.steps, b.steps, b.score) as unknown as { n: number }).n + 1;
        // Définitif : le résultat figé fait foi (les Prismes réellement crédités)
        const frozen = status === 'final' ? (q.resultOf.get(date, me.id) as unknown as { rank: number; prisms: number } | undefined) : undefined;
        mine = { rank: frozen?.rank ?? rank, time: b.steps * dt, score: b.score, prisms: eligible ? frozen?.prisms ?? dailyPrizeForRank(rank) : 0, eligible };
      }
    }
    const end = dayStartMs(date) + DAY_MS;
    return json(200, { date, status, endsAt: end, finalAt: end + DAILY_RANKING.graceMinutes * MIN_MS, entries, total, me: mine } satisfies DailyBoard);
  }

  function dailyNotices(me: PlayerRow): HttpResponse {
    if (!allow(`daily-notices:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    tick(true);
    const rows = q.results.all(me.id) as unknown as { date: string; rank: number; steps: number; score: number; prisms: number }[];
    const notices: DailyNotice[] = rows.map((r) => ({ date: r.date, rank: r.rank, prisms: r.prisms, time: r.steps * dt, score: r.score }));
    return json(200, { notices });
  }

  function dailyAck(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`daily-ack:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    const dates = (req.body as { dates?: unknown } | undefined)?.dates;
    if (!Array.isArray(dates) || dates.length > 60 || !dates.every(validDate)) return err(400, 'bad_request', 'Requête invalide.');
    transaction(db, () => {
      for (const d of dates as string[]) q.ackResult.run(now(), me.id, d);
    });
    return json(200, { ok: true });
  }

  // ————————————————————————— départ d'une partie de Survie en ligne (condition du drop rare)

  /**
   * Enregistre, côté service, qu'une partie de Survie a DÉMARRÉ en ligne avec ce ticket. Sans cet enregistrement (partie entièrement hors ligne, ticket
   * réutilisé ou ancien), aucun tirage de Prisme n'a lieu — jamais de tirage rétroactif. Idempotent : la première heure enregistrée est conservée.
   */
  function ticketStart(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`ticket-start:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    const id = (req.body as { ticketId?: unknown } | undefined)?.ticketId;
    if (typeof id !== 'string' || id.length > 64) return err(400, 'bad_request', 'Requête invalide.');
    const row = q.ticketStart.get(id) as unknown as { id: string; player_id: string; used_at: number | null; exp: number; started_at: number | null } | undefined;
    if (!row || row.player_id !== me.id || row.used_at !== null || Math.floor(now() / 1000) > row.exp) return err(400, 'bad_ticket', 'Ticket inconnu, utilisé ou expiré.');
    if (row.started_at === null) q.setTicketStart.run(now(), id);
    return json(200, { started: true });
  }

  return {
    tick,
    handle(req) {
      const route = `${req.method} ${req.path}`;
      const withAuth = (fn: (me: PlayerRow) => HttpResponse): HttpResponse => {
        const me = authenticate(req);
        return me ? fn(me) : err(401, 'unauthorized', 'Authentification requise.');
      };
      switch (route) {
        case 'POST /api/loyalty/checkin': return withAuth(checkin);
        case 'GET /api/loyalty': return withAuth(loyaltyGet);
        case 'POST /api/loyalty/claim': return withAuth((me) => claim(req, me));
        case 'POST /api/daily/start': return withAuth((me) => (tick(), dailyStart(req, me)));
        case 'POST /api/daily/runs': return withAuth((me) => dailyRun(req, me));
        case 'POST /api/daily/commit': return withAuth((me) => dailyCommit(req, me));
        case 'GET /api/daily/leaderboard': return dailyBoard(req);
        case 'GET /api/daily/notices': return withAuth(dailyNotices);
        case 'POST /api/daily/ack': return withAuth((me) => dailyAck(req, me));
        case 'POST /api/tickets/start': return withAuth((me) => ticketStart(req, me));
        default: return null;
      }
    },
  };
}

