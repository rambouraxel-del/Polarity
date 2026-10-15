import { BALANCE_VERSION } from '../src/config/version';
import {
  LIMITS,
  REPLAY_FORMAT,
  REPLAY_FORMAT_POWERS,
  isCategory,
  nicknameKey,
  normalizeNickname,
  validActs,
  validFlips,
  validNickname,
  type BalancesResponse,
  type Category,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type MeResponse,
  type RegisterResponse,
  type ReportRequest,
  type RejectReason,
  type RunResponse,
  type RunSubmission,
  type Ticket,
  type TicketsResponse,
} from '../src/net/protocol';
import { hashToken, newPlayerId, newTicketParts, newToken, parseBearer, signTicket, tokenMatches, verifyTicketSig } from './auth';
import { createAccounts, ASYNC_ROUTES, type AccountsConfig } from './accounts';
import { transaction, type Db } from './db';
import { checkNickname } from './moderation';
import { eraseProfile, guestNickname, inventoryOf } from './profile';
import { replaySurvival } from './verify';
import { createRewards, rollDrop } from './rewards';
import { createPayments, PAYMENT_ASYNC_ROUTES, settleDebt, type PaymentsConfig } from './payments';
import { createAds, ADS_ASYNC_ROUTES } from './ads';
import { DROPS } from '../src/config/rewards';

/**
 * Logique du service de classement, indépendante du transport HTTP (testable sans réseau).
 * Voir docs/CLASSEMENT.md pour le modèle de confiance et les limites contre la triche.
 */
export interface AppConfig {
  /** Secret de signature des tickets (obligatoire en production, jamais envoyé au navigateur). */
  ticketSecret: string;
  /** Horloge (ms Unix) : injectable pour les tests. */
  now?: () => number;
  /** Version d'équilibrage acceptée (celle du code de simulation embarqué). */
  balance?: number;
  /** Mots interdits supplémentaires dans les pseudos (voir server/moderation.ts). */
  blockedWords?: readonly string[];
  /**
   * Plafonds GLOBAUX (toutes adresses et tous joueurs confondus) : un rejeu occupe le processeur du service ; sans plafond global, de nombreux
   * comptes pourraient le saturer malgré les limites par joueur. Défauts : 30 rejeux/minute, 100 inscriptions/heure.
   */
  limits?: { replaysPerMinute?: number; registrationsPerHour?: number };
  /** Comptes, connexions facultatives, synchronisation (économie v3) ; chaque méthode externe reste DÉSACTIVÉE tant qu'elle n'est pas configurée. */
  accounts?: AccountsConfig;
  /** Achats réels de Prismes et publicités récompensées (phase 5) : chaque fournisseur reste DÉSACTIVÉ tant que ses identifiants ne sont pas fournis. */
  payments?: PaymentsConfig;
}

/** Gestionnaire du service : synchrone, sauf les routes qui attendent le réseau (clés des fournisseurs, courriel) exposées par `async`. */
export type App = ((req: HttpRequest) => HttpResponse) & {
  async: (req: HttpRequest) => Promise<HttpResponse> | null;
  /** Clôture des défis quotidiens échus (minuteur du service ; rejouable après une panne). Renvoie le nombre de défis clos. */
  tick: (force?: boolean) => number;
};

export interface HttpRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  /** Corps JSON déjà analysé (undefined si absent ou invalide). */
  body: unknown;
  /** Corps brut (texte) : nécessaire à la vérification des signatures de notifications de paiement. */
  raw?: string;
  /** Chaîne de requête brute (sans « ? ») : nécessaire à la vérification de la signature des confirmations publicitaires. */
  rawQuery?: string;
  ip: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): HttpResponse => ({ status, body });
const err = (status: number, error: string, message: string): HttpResponse => json(status, { error, message });

const REJECT_MESSAGES: Record<RejectReason, string> = {
  unsupported_balance: 'Cette version du jeu n’est plus prise en compte par le classement actuel.',
  bad_ticket: 'Ticket de partie invalide.',
  ticket_expired: 'Ticket de partie expiré.',
  ticket_used: 'Ticket de partie déjà utilisé.',
  bad_replay: 'Journal de la partie invalide.',
  not_finished: 'La partie rejouée ne se termine pas : résultat non validé.',
  inputs_after_end: 'Le journal contient des entrées après la fin de la partie : résultat non validé.',
  divergence: 'Le résultat annoncé ne correspond pas à la partie rejouée : résultat non validé.',
  bad_powers: 'Le journal des pouvoirs (Boost, Gel, Bouclier) est refusé par les règles du jeu : résultat non validé.',
  bonus_unfunded: 'Les charges de bonus utilisées pendant cette partie ne sont pas confirmées par le service : résultat non validé.',
  bonus_sync_required: 'Les achats de bonus de cet appareil ne sont pas encore confirmés : synchronisez, la partie sera ré-essayée.',
  rate_limited: 'Trop de requêtes : réessayez plus tard.',
};

/** Limiteur à fenêtre fixe, en mémoire (suffisant pour un serveur unique ; voir docs). */
class RateLimiter {
  private readonly hits = new Map<string, { start: number; n: number }>();
  constructor(private readonly now: () => number) {}
  /** Vrai si la requête est autorisée. */
  allow(key: string, max: number, windowMs: number): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start >= windowMs) {
      this.hits.set(key, { start: t, n: 1 });
      if (this.hits.size > 50000) this.prune(t, windowMs);
      return true;
    }
    if (h.n >= max) return false;
    h.n++;
    return true;
  }
  private prune(t: number, windowMs: number): void {
    for (const [k, h] of this.hits) if (t - h.start >= windowMs) this.hits.delete(k);
  }
}

export interface PlayerRow {
  id: string;
  nickname: string;
  token_hash: string;
  /** 0 normal ; 1 pseudo masqué par l'opérateur ; 2 exclu du classement. */
  moderation: number;
  /** 1 : pseudo non choisi (profil invité), absent du classement public. */
  guest: number;
  /** Profil fusionné dans un autre (alias) ; null sinon. */
  merged_into: string | null;
}

const NICKNAME_REFUSED = 'Ce pseudo n’est pas autorisé : choisissez-en un autre.';
const isUniqueViolation = (e: unknown): boolean => e instanceof Error && /UNIQUE constraint/i.test(e.message);

export function createApp(db: Db, cfg: AppConfig): App {
  if (!cfg.ticketSecret || cfg.ticketSecret.length < 16) throw new Error('ticketSecret (16 caractères minimum) requis');
  const now = cfg.now ?? Date.now;
  const balance = cfg.balance ?? BALANCE_VERSION;
  const limiter = new RateLimiter(now);
  const HOUR = 3_600_000;
  const maxReplays = cfg.limits?.replaysPerMinute ?? 30;
  const maxRegistrations = cfg.limits?.registrationsPerHour ?? 1000;

  const q = {
    player: db.prepare('SELECT id, nickname, token_hash, moderation, guest, merged_into FROM players WHERE id = ?'),
    session: db.prepare('SELECT player_id, revoked_at FROM sessions WHERE token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?'),
    guestPlayer: db.prepare('INSERT INTO players (id, nickname, nickname_key, token_hash, created_at, guest) VALUES (?, ?, ?, ?, ?, 1)'),
    byNickname: db.prepare('SELECT id, nickname FROM players WHERE nickname_key = ?'),
    nickTaken: db.prepare('SELECT id FROM players WHERE nickname_key = ?'),
    insertPlayer: db.prepare('INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    rename: db.prepare('UPDATE players SET nickname = ?, nickname_key = ? WHERE id = ?'),
    openTickets: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE player_id = ? AND used_at IS NULL AND exp > ?'),
    insertTicket: db.prepare('INSERT INTO tickets (id, player_id, seed, exp, issued_at) VALUES (?, ?, ?, ?, ?)'),
    ticket: db.prepare('SELECT id, player_id, seed, exp, used_at, started_at FROM tickets WHERE id = ?'),
    ledgerDrop: db.prepare("INSERT OR IGNORE INTO ledger (player_id, currency, kind, amount, ref, at, meta) VALUES (?, 'prisms', 'drop', ?, ?, ?, ?)"),
    useTicket: db.prepare('UPDATE tickets SET used_at = ? WHERE id = ? AND used_at IS NULL'),
    insertRun: db.prepare('INSERT INTO runs (player_id, balance, ticket_id, seed, steps, score, flips, client_build, created_at, category, acts, powers, replay_v, drop_prisms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    best: db.prepare('SELECT steps, score, achieved_at FROM bests WHERE player_id = ? AND balance = ? AND category = ?'),
    upsertBest: db.prepare(
      'INSERT INTO bests (player_id, balance, category, steps, score, run_id, achieved_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(player_id, balance, category) DO UPDATE SET steps = excluded.steps, score = excluded.score, run_id = excluded.run_id, achieved_at = excluded.achieved_at',
    ),
    // Les joueurs exclus par l'opérateur (moderation = 2) ne comptent ni au classement ni dans les rangs
    rank: db.prepare(
      'SELECT COUNT(*) + 1 AS rank FROM bests b JOIN players p ON p.id = b.player_id WHERE b.balance = ? AND b.category = ? AND p.moderation < 2 AND p.guest = 0 AND (b.steps > ? OR (b.steps = ? AND b.score > ?) OR (b.steps = ? AND b.score = ? AND b.achieved_at < ?))',
    ),
    total: db.prepare('SELECT COUNT(*) AS n FROM bests b JOIN players p ON p.id = b.player_id WHERE b.balance = ? AND b.category = ? AND p.moderation < 2 AND p.guest = 0'),
    top: db.prepare(
      'SELECT b.player_id, p.nickname, b.steps, b.score, b.achieved_at FROM bests b JOIN players p ON p.id = b.player_id WHERE b.balance = ? AND b.category = ? AND p.moderation < 2 AND p.guest = 0 ORDER BY b.steps DESC, b.score DESC, b.achieved_at ASC LIMIT ?',
    ),
    balances: db.prepare('SELECT b.balance AS balance, COUNT(DISTINCT b.player_id) AS players FROM bests b JOIN players p ON p.id = b.player_id WHERE p.moderation < 2 AND p.guest = 0 GROUP BY b.balance ORDER BY b.balance DESC'),
    installBonus: db.prepare('SELECT player_id, bonus_boost, bonus_gel FROM installs WHERE install_id = ?'),
    ledgerUse: db.prepare("INSERT OR IGNORE INTO ledger (player_id, currency, kind, amount, ref, at, meta) VALUES (?, ?, 'use', ?, ?, ?, ?)"),
    insertReport: db.prepare('INSERT OR IGNORE INTO reports (reporter_id, target_id, target_nickname, reason, created_at) VALUES (?, ?, ?, ?, ?)'),
    log: db.prepare('INSERT INTO moderation_log (at, action, player_id, nickname, note) VALUES (?, ?, NULL, NULL, ?)'),
    ping: db.prepare('SELECT 1 AS ok'),
  };

  const dt = 1 / 120;

  /** Profil effectif d'un profil fusionné (alias) : on suit `merged_into` (4 niveaux au plus). */
  function resolveAlias(r: PlayerRow): PlayerRow | null {
    let cur = r;
    for (let i = 0; i < 4 && cur.merged_into; i++) {
      const next = q.player.get(cur.merged_into) as unknown as PlayerRow | undefined;
      if (!next) return null;
      cur = next;
    }
    return cur.merged_into ? null : cur;
  }

  /**
   * Authentification : « Bearer <identifiant>.<secret> ». Le secret peut être celui d'origine du profil ou celui d'un accès (appareil) ; un profil
   * fusionné reste joignable par ses anciens accès, qui agissent alors sur le profil qui l'a absorbé. Comparaisons en temps constant ; accès révocables.
   */
  function authenticate(req: HttpRequest): PlayerRow | null {
    const b = parseBearer(req.headers.authorization);
    if (!b) return null;
    const row0 = q.player.get(b.playerId) as unknown as PlayerRow | undefined;
    if (!row0) return null;
    const eff = resolveAlias(row0);
    if (!eff) return null;
    if (tokenMatches(b.token, row0.token_hash)) return eff;
    const h = hashToken(b.token);
    const sess = q.session.get(h) as unknown as { player_id: string; revoked_at: number | null } | undefined;
    if (sess && sess.revoked_at === null && (sess.player_id === eff.id || sess.player_id === row0.id)) {
      q.touchSession.run(now(), h);
      return eff;
    }
    return null;
  }

  function rankOf(bal: number, category: Category, steps: number, score: number, at: number): number {
    return (q.rank.get(bal, category, steps, steps, score, steps, score, at) as unknown as { rank: number }).rank;
  }

  /** Classement demandé : « sans bonus » par défaut (les anciens records y figurent). */
  const parseCategory = (req: HttpRequest): Category => {
    const raw = req.query.get('category');
    return isCategory(raw) ? raw : 'plain';
  };

  const parseBalance = (req: HttpRequest): number => {
    const raw = req.query.get('balance');
    const n = raw === null ? balance : Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : balance;
  };

  // ————————————————————————— routes

  function register(req: HttpRequest): HttpResponse {
    if (!limiter.allow(`reg:${req.ip}`, 20, HOUR) || !limiter.allow('reg:global', maxRegistrations, HOUR)) return err(429, 'rate_limited', REJECT_MESSAGES.rate_limited);
    const body = req.body as { nickname?: unknown } | undefined;
    // Sans pseudo : profil INVITÉ créé automatiquement (pseudo « Joueur-xxxxxx », absent du classement public jusqu'au choix d'un pseudo)
    if (body === undefined || body === null || body.nickname === undefined || body.nickname === '') {
      const playerId = newPlayerId();
      const token = newToken();
      for (let attempt = 0; attempt < 4; attempt++) {
        const nick = guestNickname(playerId, attempt);
        try {
          q.guestPlayer.run(playerId, nick, nicknameKey(nick), hashToken(token), now());
          return json(201, { playerId, token, nickname: nick, guest: true } satisfies RegisterResponse & { guest: boolean });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
        }
      }
      return err(500, 'server_error', 'Erreur interne du service.');
    }
    const nick = typeof body.nickname === 'string' ? normalizeNickname(body.nickname) : '';
    if (!validNickname(nick)) return err(400, 'bad_nickname', `Pseudo invalide : ${LIMITS.nickname.min} à ${LIMITS.nickname.max} caractères (lettres latines, chiffres, espace, point, tiret).`);
    if (!checkNickname(nick, cfg.blockedWords).ok) return err(400, 'nickname_refused', NICKNAME_REFUSED);
    const key = nicknameKey(nick);
    if (q.nickTaken.get(key)) return err(409, 'nickname_taken', 'Ce pseudo est déjà pris.');
    const playerId = newPlayerId();
    const token = newToken();
    try {
      q.insertPlayer.run(playerId, nick, key, hashToken(token), now());
    } catch (e) {
      if (isUniqueViolation(e)) return err(409, 'nickname_taken', 'Ce pseudo est déjà pris.');
      throw e;
    }
    const res: RegisterResponse = { playerId, token, nickname: nick };
    return json(201, res);
  }

  function rename(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!limiter.allow(`rename:${me.id}`, 5, HOUR)) return err(429, 'rate_limited', REJECT_MESSAGES.rate_limited);
    // Pseudo masqué ou joueur exclu par l'opérateur : le pseudo ne peut plus être changé par le joueur
    if (me.moderation !== 0) return err(403, 'locked', 'Votre pseudo a été modifié par la modération et ne peut plus être changé.');
    const body = req.body as { nickname?: unknown } | undefined;
    const nick = typeof body?.nickname === 'string' ? normalizeNickname(body.nickname) : '';
    if (!validNickname(nick)) return err(400, 'bad_nickname', `Pseudo invalide : ${LIMITS.nickname.min} à ${LIMITS.nickname.max} caractères.`);
    if (!checkNickname(nick, cfg.blockedWords).ok) return err(400, 'nickname_refused', NICKNAME_REFUSED);
    const key = nicknameKey(nick);
    const other = q.nickTaken.get(key) as { id: string } | undefined;
    if (other && other.id !== me.id) return err(409, 'nickname_taken', 'Ce pseudo est déjà pris.');
    try {
      q.rename.run(nick, key, me.id);
      // Choisir un pseudo fait sortir du statut d'invité : le profil entre au classement public
      db.prepare('UPDATE players SET guest = 0 WHERE id = ?').run(me.id);
    } catch (e) {
      if (isUniqueViolation(e)) return err(409, 'nickname_taken', 'Ce pseudo est déjà pris.');
      throw e;
    }
    return json(200, { playerId: me.id, nickname: nick });
  }

  /** Signalement d'un pseudo offensant par un joueur authentifié : enregistré pour l'opérateur (server/admin.ts), sans effet automatique. */
  function report(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!limiter.allow(`report:${me.id}`, 10, HOUR)) return err(429, 'rate_limited', REJECT_MESSAGES.rate_limited);
    const body = req.body as Partial<ReportRequest> | undefined;
    const nick = typeof body?.nickname === 'string' ? normalizeNickname(body.nickname) : '';
    // Texte libre : borné et débarrassé des caractères de contrôle (jamais interprété)
    const reason = (typeof body?.reason === 'string' ? body.reason : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!validNickname(nick)) return err(400, 'bad_nickname', 'Pseudo à signaler invalide.');
    const target = q.byNickname.get(nicknameKey(nick)) as { id: string; nickname: string } | undefined;
    if (!target) return err(404, 'not_found', 'Aucun joueur ne porte ce pseudo.');
    if (target.id === me.id) return err(400, 'self_report', 'Vous ne pouvez pas vous signaler vous-même.');
    q.insertReport.run(me.id, target.id, target.nickname, reason || 'pseudo offensant', now());
    return json(202, { ok: true, message: 'Signalement enregistré. Merci : il sera examiné par la modération.' });
  }

  /**
   * Suppression par le joueur de TOUTES les données de son profil (pseudo, empreinte du secret, tickets, parties et journaux d'entrées, meilleurs
   * résultats, signalements). Autorisée par la seule possession du secret du profil ; irréversible. Aucune trace nominative n'est conservée.
   */
  function deleteMe(me: PlayerRow): HttpResponse {
    if (!limiter.allow(`delete:${me.id}`, 3, HOUR)) return err(429, 'rate_limited', REJECT_MESSAGES.rate_limited);
    eraseProfile(db, me.id);
    q.log.run(now(), 'suppression_par_le_joueur', null);
    return json(200, { deleted: true });
  }

  function tickets(me: PlayerRow): HttpResponse {
    if (!limiter.allow(`tickets:${me.id}`, 20, HOUR)) return err(429, 'rate_limited', REJECT_MESSAGES.rate_limited);
    const t = Math.floor(now() / 1000);
    const open = (q.openTickets.get(me.id, t) as unknown as { n: number }).n;
    const count = Math.max(0, Math.min(LIMITS.ticketBatch, LIMITS.maxOpenTickets - open));
    const out: Ticket[] = [];
    for (let i = 0; i < count; i++) {
      const { id, seed } = newTicketParts();
      const exp = t + LIMITS.ticketDays * 86400;
      q.insertTicket.run(id, me.id, seed, exp, now());
      out.push({ id, seed, exp, sig: signTicket(cfg.ticketSecret, { id, seed, exp }, me.id) });
    }
    const res: TicketsResponse = { tickets: out };
    return json(200, res);
  }

  function submitRun(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!limiter.allow(`run:${me.id}`, 30, HOUR) || !limiter.allow(`run-gap:${me.id}`, 1, 3000)) return json(429, { status: 'rejected', reason: 'rate_limited', message: REJECT_MESSAGES.rate_limited } satisfies RunResponse);
    const sub = req.body as Partial<RunSubmission> | undefined;
    const reject = (reason: RejectReason, status = 422): HttpResponse => json(status, { status: 'rejected', reason, message: REJECT_MESSAGES[reason] } satisfies RunResponse);
    if (me.moderation === 2) return json(403, { status: 'rejected', reason: 'bad_ticket', message: 'Ce profil a été exclu du classement par la modération.' } satisfies RunResponse);
    // Structure
    if (!sub || typeof sub !== 'object' || !sub.ticket || !sub.replay || !sub.claimed || !sub.client) return reject('bad_replay', 400);
    const t = sub.ticket as Ticket;
    if (typeof t.id !== 'string' || typeof t.sig !== 'string' || !Number.isInteger(t.seed) || !Number.isInteger(t.exp)) return reject('bad_ticket', 400);
    // Format 1 (anciens clients : inversions seulement) ou 2 (inversions + activations de pouvoirs) ; l'ancien format ne contient jamais d'activations
    const fmt = sub.replay.v;
    if ((fmt !== REPLAY_FORMAT && fmt !== REPLAY_FORMAT_POWERS) || !validFlips(sub.replay.flips)) return reject('bad_replay', 400);
    const acts: [number, number][] = fmt === REPLAY_FORMAT_POWERS ? (sub.replay.acts ?? []) : [];
    if (fmt === REPLAY_FORMAT && sub.replay.acts !== undefined && !(Array.isArray(sub.replay.acts) && sub.replay.acts.length === 0)) return reject('bad_replay', 400);
    if (!validActs(acts)) return reject('bad_replay', 400);
    // Version d'équilibrage : seule la version courante peut être rejouée par ce code (les anciennes sont conservées en lecture)
    if (sub.client.balance !== balance) return reject('unsupported_balance');
    // Ticket : signature, propriétaire, expiration, usage unique
    // La signature est liée au profil qui a reçu le ticket : celui-ci, ou un profil fusionné depuis (les parties en attente survivent à une fusion)
    const signers = [me.id, ...(db.prepare('SELECT id FROM players WHERE merged_into = ?').all(me.id) as unknown as { id: string }[]).map((r) => r.id)];
    if (!signers.some((id) => verifyTicketSig(cfg.ticketSecret, t, id))) return reject('bad_ticket');
    const row = q.ticket.get(t.id) as unknown as { id: string; player_id: string; seed: number; exp: number; used_at: number | null; started_at: number | null } | undefined;
    if (!row || row.player_id !== me.id || row.seed !== t.seed || row.exp !== t.exp) return reject('bad_ticket');
    if (row.used_at !== null) return reject('ticket_used');
    if (Math.floor(now() / 1000) > row.exp) return reject('ticket_expired');

    // Budget global de rejeux (calcul coûteux, exécuté dans le processus du service) : refus SANS consommer le ticket, le client réessaiera
    if (!limiter.allow('replay:global', maxReplays, 60_000)) return json(429, { status: 'rejected', reason: 'rate_limited', message: REJECT_MESSAGES.rate_limited } satisfies RunResponse);
    // Rejeu : le résultat est celui du serveur (graine du ticket + entrées du journal)
    const rep = replaySurvival(row.seed, sub.replay.flips, acts);
    const consume = (): boolean => (q.useTicket.run(now(), row.id) as unknown as { changes: number }).changes === 1;
    if (!rep.ok) {
      transaction(db, () => void consume());
      return reject(rep.reason);
    }
    const claimed = sub.claimed as { time?: unknown; score?: unknown };
    const same = typeof claimed.time === 'number' && typeof claimed.score === 'number' && Math.abs(claimed.time - rep.time) < dt / 2 && claimed.score === rep.score;
    if (!same) {
      transaction(db, () => void consume());
      return reject('divergence');
    }
    const category = rep.category;
    const needed = { boost: rep.powers.boost, gel: rep.powers.gel };
    const cl = sub.client as { installId?: unknown; bonusBought?: { boost?: unknown; gel?: unknown } };
    // Tout ou rien : (charges de bonus consommées,) usage du ticket, partie enregistrée, meilleur résultat de la catégorie
    const out = transaction(db, () => {
      if (needed.boost > 0 || needed.gel > 0) {
        // Les charges de bonus utilisées doivent exister dans le registre (achats CONFIRMÉS) : chaque partie classée les consomme, une seule fois
        const inv = inventoryOf(db, me.id);
        if (inv.boost < needed.boost || inv.gel < needed.gel) {
          // Achats de cet appareil pas encore traités par le service → réessayer après synchronisation ; sinon l'achat a été refusé : refus définitif
          const inst = typeof cl.installId === 'string' ? (q.installBonus.get(cl.installId) as unknown as { player_id: string; bonus_boost: number; bonus_gel: number } | undefined) : undefined;
          const doneBoost = inst && inst.player_id === me.id ? inst.bonus_boost : 0;
          const doneGel = inst && inst.player_id === me.id ? inst.bonus_gel : 0;
          const claimedBoost = typeof cl.bonusBought?.boost === 'number' ? cl.bonusBought.boost : 0;
          const claimedGel = typeof cl.bonusBought?.gel === 'number' ? cl.bonusBought.gel : 0;
          if (claimedBoost > doneBoost || claimedGel > doneGel) return { retry: true as const };
          consume();
          return { unfunded: true as const };
        }
      }
      if (!consume()) return null;
      const at = now();
      // Drop rare de Prismes : seulement si la partie a DÉMARRÉ en ligne (heure de début enregistrée par le service, jamais rétroactive) et que la durée
      // rejouée est compatible avec cette heure ; tirage dérivé du secret du service + ticket + index de balise ; un Prisme au plus par partie
      let dropped = 0;
      if (row.started_at !== null && row.started_at <= at && at - row.started_at >= rep.time * 1000 - 2000 && rollDrop(cfg.ticketSecret, row.id, rep.beacons) > 0) dropped = DROPS.prism.amount;
      const runId = Number(
        (q.insertRun.run(me.id, balance, row.id, row.seed, rep.steps, rep.score, JSON.stringify(sub.replay!.flips), String(sub.client!.build ?? '').slice(0, 40), at, category, acts.length > 0 ? JSON.stringify(acts) : null, JSON.stringify(rep.powers), fmt, dropped) as unknown as { lastInsertRowid: number | bigint }).lastInsertRowid,
      );
      if (dropped > 0) {
        q.ledgerDrop.run(me.id, dropped, `drop:${row.id}`, at, JSON.stringify({ run: runId, beacons: rep.beacons }));
        settleDebt(db, me.id, at);
      }
      for (const kind of ['boost', 'gel'] as const) {
        if (needed[kind] > 0) q.ledgerUse.run(me.id, kind, -needed[kind], `use:${row.id}:${kind}`, at, JSON.stringify({ run: runId, category }));
      }
      const prev = q.best.get(me.id, balance, category) as unknown as { steps: number; score: number; achieved_at: number } | undefined;
      const better = !prev || rep.steps > prev.steps || (rep.steps === prev.steps && rep.score > prev.score);
      if (better) q.upsertBest.run(me.id, balance, category, rep.steps, rep.score, runId, at);
      const ref = better || !prev ? { steps: rep.steps, score: rep.score, at } : { steps: prev.steps, score: prev.score, at: prev.achieved_at };
      return { better, rank: rankOf(balance, category, ref.steps, ref.score, ref.at), dropped };
    });
    if (!out) return reject('ticket_used');
    if ('retry' in out) return reject('bonus_sync_required', 409);
    if ('unfunded' in out) return reject('bonus_unfunded');
    const res: RunResponse = { status: 'accepted', time: rep.time, score: rep.score, rank: out.rank, personalBest: out.better, balance, category, powers: rep.powers, ...(out.dropped > 0 ? { drop: { prisms: out.dropped } } : {}) };
    return json(200, res);
  }

  function leaderboard(req: HttpRequest): HttpResponse {
    if (!limiter.allow(`lb:${req.ip}`, 120, 60_000)) return err(429, 'rate_limited', REJECT_MESSAGES.rate_limited);
    const bal = parseBalance(req);
    const category = parseCategory(req);
    const limit = Math.min(LIMITS.topSize, Math.max(1, Math.floor(Number(req.query.get('limit') ?? LIMITS.topSize)) || LIMITS.topSize));
    const me = authenticate(req);
    const rows = q.top.all(bal, category, limit) as unknown as { player_id: string; nickname: string; steps: number; score: number; achieved_at: number }[];
    const entries: LeaderboardEntry[] = rows.map((r, i) => ({ rank: i + 1, nickname: r.nickname, time: r.steps * dt, score: r.score, at: r.achieved_at, ...(me && r.player_id === me.id ? { you: true } : {}) }));
    const total = (q.total.get(bal, category) as unknown as { n: number }).n;
    const res: LeaderboardResponse = { balance: bal, category, currentBalance: balance, entries, total };
    return json(200, res);
  }

  function meRoute(req: HttpRequest, me: PlayerRow): HttpResponse {
    const bal = parseBalance(req);
    const category = parseCategory(req);
    const bestOf = (c: Category): MeResponse['best'] => {
      const b = q.best.get(me.id, bal, c) as unknown as { steps: number; score: number; achieved_at: number } | undefined;
      return b ? { time: b.steps * dt, score: b.score, rank: rankOf(bal, c, b.steps, b.score, b.achieved_at) } : null;
    };
    const total = (q.total.get(bal, category) as unknown as { n: number }).n;
    const bests = { plain: bestOf('plain'), bonus: bestOf('bonus') };
    const res: MeResponse = { playerId: me.id, nickname: me.nickname, balance: bal, best: bests[category], total, category, bests };
    return json(200, res);
  }

  function balances(): HttpResponse {
    const rows = q.balances.all() as unknown as { balance: number; players: number }[];
    const res: BalancesResponse = { current: balance, versions: rows };
    return json(200, res);
  }

  const rewards = createRewards({ db, now, allow: (k, m, w) => limiter.allow(k, m, w), authenticate });
  // Reprise après une panne : les défis quotidiens échus pendant l'arrêt sont clos dès le démarrage
  rewards.tick(true);
  const payments = createPayments({ db, now, secret: cfg.ticketSecret, allow: (k, m, w) => limiter.allow(k, m, w), authenticate, cfg: cfg.payments ?? {} });
  const ads = createAds({ db, now, secret: cfg.ticketSecret, allow: (k, m, w) => limiter.allow(k, m, w), authenticate, cfg: cfg.payments?.ads, fetch: cfg.payments?.fetch });
  const accounts = createAccounts({ db, now, allow: (k, m, w) => limiter.allow(k, m, w), authenticate, cfg: cfg.accounts ?? {} });

  const handler = (req: HttpRequest): HttpResponse => {
    const route = `${req.method} ${req.path}`;
    try {
      if (ASYNC_ROUTES.has(route) || PAYMENT_ASYNC_ROUTES.has(route) || ADS_ASYNC_ROUTES.has(route)) return err(500, 'use_async', 'Route asynchrone : utilisez le gestionnaire async.');
      const acct = accounts.handle(req);
      if (acct) return acct;
      const rw = rewards.handle(req);
      if (rw) return rw;
      const pay = payments.handle(req) ?? ads.handle(req);
      if (pay) return pay;
      switch (route) {
        case 'GET /api/health': {
          q.ping.get(); // la base répond-elle ? (sinon 500 : le contrôle de santé échoue)
          return json(200, { ok: true, balance });
        }
        case 'GET /api/leaderboard': return leaderboard(req);
        case 'GET /api/balances': return balances();
        case 'POST /api/register': return register(req);
        default: break;
      }
      // Routes authentifiées
      if (route === 'GET /api/me' || route === 'PATCH /api/me' || route === 'DELETE /api/me' || route === 'POST /api/report' || route === 'POST /api/tickets' || route === 'POST /api/runs') {
        const me = authenticate(req);
        if (!me) return err(401, 'unauthorized', 'Authentification requise.');
        if (route === 'GET /api/me') return meRoute(req, me);
        if (route === 'PATCH /api/me') return rename(req, me);
        if (route === 'DELETE /api/me') return deleteMe(me);
        if (route === 'POST /api/report') return report(req, me);
        if (route === 'POST /api/tickets') return tickets(me);
        return submitRun(req, me);
      }
      return err(404, 'not_found', 'Route inconnue.');
    } catch (e) {
      // Aucun détail interne n'est renvoyé au client
      console.error('Erreur serveur :', e);
      return err(500, 'server_error', 'Erreur interne du service.');
    }
  };

  const app = handler as App;
  app.tick = (force) => rewards.tick(force);
  app.async = (req) => {
    try {
      const p = accounts.handleAsync(req) ?? payments.handleAsync(req) ?? ads.handleAsync(req);
      if (!p) return null;
      return p.catch((e) => {
        console.error('Erreur serveur :', e);
        return err(500, 'server_error', 'Erreur interne du service.');
      });
    } catch (e) {
      console.error('Erreur serveur :', e);
      return Promise.resolve(err(500, 'server_error', 'Erreur interne du service.'));
    }
  };
  return app;
}
