/**
 * Protocole du classement mondial (Survie) — types et règles partagés entre le jeu (navigateur) et le serveur (server/).
 *
 * Principe : le navigateur n'envoie JAMAIS un résultat « à croire ». Il envoie la graine (reçue du serveur dans un ticket signé)
 * et le journal de ses entrées (pas de simulation de chaque inversion). Le serveur REJOUE la partie avec le même code de simulation,
 * calcule lui-même la durée et le score, et ignore les valeurs annoncées par le client (comparées seulement pour détecter une divergence).
 * Voir docs/CLASSEMENT.md.
 */

/**
 * Formats de rejeu. 1 = inversions seulement (anciens clients : toujours acceptés, parties SANS bonus) ; 2 = inversions + activations de pouvoirs
 * (Boost, Gel, Bouclier) en pas de simulation. Le journal d'une partie ne couvre que la PREMIÈRE vie (la tentative classée).
 */
export const REPLAY_FORMAT = 1;
export const REPLAY_FORMAT_POWERS = 2;
export type ReplayFormat = typeof REPLAY_FORMAT | typeof REPLAY_FORMAT_POWERS;

/**
 * Catégorie de classement, DÉDUITE PAR LE SERVICE des activations qu'il a rejouées (jamais d'un indicateur du client) :
 * `plain` = aucune activation réussie de Boost, Gel ou Bouclier pendant la première vie ; `bonus` = au moins une.
 */
export type Category = 'plain' | 'bonus';
export const CATEGORIES: readonly Category[] = ['plain', 'bonus'];
export const isCategory = (v: unknown): v is Category => v === 'plain' || v === 'bonus';

export const LIMITS = {
  nickname: { min: 3, max: 16 },
  /** Inversions maximales d'une partie (≈ 4 par seconde pendant 80 minutes). */
  maxFlips: 20000,
  /** Durée maximale rejouée (pas de simulation à 120 Hz) : 1 heure. */
  maxSteps: 120 * 3600,
  /** Activations de pouvoirs maximales d'une première vie (3 Boost + 3 Gel + Boucliers : une charge toutes les 18 balises). */
  maxActs: 400,
  /** Taille maximale d'un corps de requête (octets). */
  maxBodyBytes: 256 * 1024,
  /** Tickets demandés en une fois et tickets non utilisés conservés par joueur. */
  ticketBatch: 5,
  maxOpenTickets: 10,
  /** Validité d'un ticket (jours). */
  ticketDays: 7,
  /** Lignes du classement public. */
  topSize: 100,
} as const;

/** Ticket de partie : graine attribuée par le serveur, liée à un joueur, à usage unique, signée (HMAC). */
export interface Ticket {
  id: string;
  seed: number;
  /** Expiration (secondes Unix). */
  exp: number;
  sig: string;
}

export interface Replay {
  v: ReplayFormat;
  /** Pas de simulation auxquels une inversion a été appliquée (croissants ; un pas peut apparaître plusieurs fois). */
  flips: number[];
  /** Format 2 : activations RÉUSSIES de pouvoirs [pas, code] (0 Boost, 1 Gel, 2 Bouclier), dans l'ordre. Le service les rejoue et les juge. */
  acts?: [number, number][];
}

export interface RunSubmission {
  ticket: Ticket;
  replay: Replay;
  /** Valeurs annoncées par le client : jamais utilisées pour le classement. */
  claimed: { time: number; score: number };
  client: {
    balance: number;
    build: string;
    /** Installation et compteur d'achats de bonus au moment de la partie : servent SEULEMENT à décider « réessayer après synchronisation » ou « refus définitif ». */
    installId?: string;
    bonusBought?: { boost: number; gel: number };
  };
}

export interface RegisterRequest {
  nickname: string;
}

export interface RegisterResponse {
  playerId: string;
  /** Secret d'authentification, remis une seule fois : le serveur n'en garde qu'une empreinte. */
  token: string;
  nickname: string;
}

export interface TicketsResponse {
  tickets: Ticket[];
}

export interface ReportRequest {
  /** Pseudo signalé, tel qu'affiché au classement. */
  nickname: string;
  reason?: string;
}

export type RejectReason =
  | 'unsupported_balance'
  | 'bad_ticket'
  | 'ticket_expired'
  | 'ticket_used'
  | 'bad_replay'
  | 'not_finished'
  | 'inputs_after_end'
  | 'divergence'
  | 'bad_powers'
  | 'bonus_unfunded'
  | 'bonus_sync_required'
  | 'rate_limited';

export type RunResponse =
  | { status: 'accepted'; time: number; score: number; rank: number; personalBest: boolean; balance: number; category: Category; powers?: { boost: number; gel: number; shield: number } }
  | { status: 'rejected'; reason: RejectReason; message: string };

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  /** Durée de survie (s). */
  time: number;
  score: number;
  /** Date (ms Unix). */
  at: number;
  /** Vrai pour la ligne du joueur authentifié. */
  you?: boolean;
}

export interface LeaderboardResponse {
  balance: number;
  /** Classement affiché : sans bonus (anciens records inclus) ou avec bonus. */
  category: Category;
  /** Version d'équilibrage du serveur (celle qui accepte de nouveaux résultats). */
  currentBalance: number;
  entries: LeaderboardEntry[];
  /** Nombre de joueurs classés pour cette version. */
  total: number;
}

export interface MeResponse {
  playerId: string;
  nickname: string;
  balance: number;
  /** Meilleur résultat de la catégorie demandée. */
  best: { time: number; score: number; rank: number } | null;
  total: number;
  category: Category;
  /** Meilleur résultat dans chaque catégorie (un record distinct par catégorie). */
  bests: Record<Category, { time: number; score: number; rank: number } | null>;
}

export interface BalancesResponse {
  current: number;
  versions: { balance: number; players: number }[];
}

export interface ErrorResponse {
  error: string;
  message: string;
}

/** Pseudo normalisé : forme NFC (é en un seul caractère), espaces fusionnés et rognés. */
export function normalizeNickname(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Lettres latines (accents compris), chiffres, espace, tiret, point et tiret bas ; 3 à 16 caractères.
 * Alphabet latin seulement : pas de lettres cyrilliques ou grecques identiques à des lettres latines (usurpation de pseudo).
 */
export function validNickname(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const n = normalizeNickname(raw);
  if (n !== raw) return false;
  if (n.length < LIMITS.nickname.min || n.length > LIMITS.nickname.max) return false;
  return /^[\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N} ._-]*$/u.test(n);
}

/** Clé de comparaison d'unicité (insensible à la casse et aux accents). */
export function nicknameKey(n: string): string {
  return normalizeNickname(n).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Les inversions forment-elles un journal plausible ? (entiers ≥ 0, croissants, bornés). */
export function validFlips(flips: unknown): flips is number[] {
  if (!Array.isArray(flips) || flips.length > LIMITS.maxFlips) return false;
  let prev = 0;
  for (const f of flips) {
    if (!Number.isInteger(f) || f < prev || f >= LIMITS.maxSteps) return false;
    prev = f;
  }
  return true;
}

/** Les activations forment-elles un journal plausible ? ([pas, code] croissants, codes 0 à 2, bornés). */
export function validActs(acts: unknown): acts is [number, number][] {
  if (!Array.isArray(acts) || acts.length > LIMITS.maxActs) return false;
  let prev = 0;
  for (const a of acts) {
    if (!Array.isArray(a) || a.length !== 2) return false;
    const [step, code] = a as [unknown, unknown];
    if (!Number.isInteger(step) || (step as number) < prev || (step as number) >= LIMITS.maxSteps) return false;
    if (code !== 0 && code !== 1 && code !== 2) return false;
    prev = step as number;
  }
  return true;
}
