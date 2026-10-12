/**
 * Protocole du classement mondial (Survie) — types et règles partagés entre le jeu (navigateur) et le serveur (server/).
 *
 * Principe : le navigateur n'envoie JAMAIS un résultat « à croire ». Il envoie la graine (reçue du serveur dans un ticket signé)
 * et le journal de ses entrées (pas de simulation de chaque inversion). Le serveur REJOUE la partie avec le même code de simulation,
 * calcule lui-même la durée et le score, et ignore les valeurs annoncées par le client (comparées seulement pour détecter une divergence).
 * Voir docs/CLASSEMENT.md.
 */

/** Version du format de rejeu. */
export const REPLAY_FORMAT = 1;

export const LIMITS = {
  nickname: { min: 3, max: 16 },
  /** Inversions maximales d'une partie (≈ 4 par seconde pendant 80 minutes). */
  maxFlips: 20000,
  /** Durée maximale rejouée (pas de simulation à 120 Hz) : 1 heure. */
  maxSteps: 120 * 3600,
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
  v: typeof REPLAY_FORMAT;
  /** Pas de simulation auxquels une inversion a été appliquée (croissants ; un pas peut apparaître plusieurs fois). */
  flips: number[];
}

export interface RunSubmission {
  ticket: Ticket;
  replay: Replay;
  /** Valeurs annoncées par le client : jamais utilisées pour le classement. */
  claimed: { time: number; score: number };
  client: { balance: number; build: string };
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

export type RejectReason =
  | 'unsupported_balance'
  | 'bad_ticket'
  | 'ticket_expired'
  | 'ticket_used'
  | 'bad_replay'
  | 'not_finished'
  | 'inputs_after_end'
  | 'divergence'
  | 'rate_limited';

export type RunResponse =
  | { status: 'accepted'; time: number; score: number; rank: number; personalBest: boolean; balance: number }
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
  best: { time: number; score: number; rank: number } | null;
  total: number;
}

export interface BalancesResponse {
  current: number;
  versions: { balance: number; players: number }[];
}

export interface ErrorResponse {
  error: string;
  message: string;
}

/** Pseudo normalisé : espaces fusionnés et rognés. */
export function normalizeNickname(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Lettres (accents compris), chiffres, espace, tiret, point et tiret bas ; 3 à 16 caractères. */
export function validNickname(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const n = normalizeNickname(raw);
  if (n !== raw) return false;
  if (n.length < LIMITS.nickname.min || n.length > LIMITS.nickname.max) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(n);
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
