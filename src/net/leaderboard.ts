import { REPLAY_FORMAT, validNickname, normalizeNickname, type BalancesResponse, type LeaderboardResponse, type MeResponse, type RegisterResponse, type RejectReason, type Replay, type RunResponse, type RunSubmission, type Ticket, type TicketsResponse } from './protocol';
import type { KeyValueStore } from '../save/save';

/**
 * Client du classement mondial (navigateur). Le jeu reste entièrement jouable hors ligne :
 * - sans service configuré (VITE_LEADERBOARD_URL absent), le classement est simplement indisponible ;
 * - hors connexion, un résultat éligible est conservé « en attente » et envoyé plus tard ;
 * - un résultat n'est classé que si le serveur l'a validé par rejeu (voir docs/CLASSEMENT.md).
 * L'identité (identifiant + secret) et les tickets sont stockés à part de la sauvegarde de progression.
 */
export const IDENTITY_KEY = 'polarite.classement.identite';
export const TICKETS_KEY = 'polarite.classement.tickets';
export const PENDING_KEY = 'polarite.classement.attente';

/** URL du service, fixée à la construction du jeu (variable d'environnement publique : aucune clé secrète). */
export const LEADERBOARD_URL: string = ((import.meta.env?.VITE_LEADERBOARD_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export interface Identity {
  playerId: string;
  token: string;
  nickname: string;
}

export type PendingStatus = 'pending' | 'accepted' | 'rejected';

/** Résultat de Survie éligible, conservé localement jusqu'à sa validation par le serveur. */
export interface PendingRun {
  /** Identifiant du ticket (unique par partie). */
  id: string;
  submission: RunSubmission;
  createdAt: number;
  status: PendingStatus;
  attempts: number;
  /** Motif du dernier échec réseau (statut « en attente »). */
  lastError?: string;
  reason?: RejectReason;
  message?: string;
  result?: { time: number; score: number; rank: number; personalBest: boolean };
}

export type NetResult<T> = { ok: true; data: T } | { ok: false; kind: 'offline' | 'unauthorized' | 'http'; status: number; message: string; reason?: RejectReason };

export interface ClientOptions {
  baseUrl: string;
  store: KeyValueStore;
  fetchFn?: typeof fetch;
  balance: number;
  build: string;
  now?: () => number;
  /** Durée maximale d'une requête (ms). */
  timeoutMs?: number;
}

const MAX_PENDING = 20;
const MIN_TICKETS = 2;

export class LeaderboardClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private flushing: Promise<PendingRun[]> | null = null;

  constructor(private readonly o: ClientOptions) {
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
    this.now = o.now ?? Date.now;
  }

  get configured(): boolean {
    return this.o.baseUrl.length > 0;
  }

  get balance(): number {
    return this.o.balance;
  }

  // ————————————————————————— stockage local

  private read<T>(key: string, fallback: T): T {
    const raw = this.o.store.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: unknown): void {
    this.o.store.set(key, JSON.stringify(value));
  }

  identity(): Identity | null {
    const id = this.read<Partial<Identity> | null>(IDENTITY_KEY, null);
    return id && typeof id.playerId === 'string' && typeof id.token === 'string' && typeof id.nickname === 'string' ? (id as Identity) : null;
  }

  pending(): PendingRun[] {
    const list = this.read<PendingRun[]>(PENDING_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  private savePending(list: PendingRun[]): void {
    this.write(PENDING_KEY, list.slice(-MAX_PENDING));
  }

  private tickets(): Ticket[] {
    const t = this.read<Ticket[]>(TICKETS_KEY, []);
    const nowS = Math.floor(this.now() / 1000);
    return Array.isArray(t) ? t.filter((x) => x && typeof x.id === 'string' && x.exp > nowS) : [];
  }

  /** Tickets de partie disponibles hors ligne (graines attribuées par le serveur). */
  ticketCount(): number {
    return this.tickets().length;
  }

  /** Retire un ticket pour une nouvelle partie de Survie ; null si aucun (la partie reste locale). */
  takeTicket(): Ticket | null {
    if (!this.configured || !this.identity()) return null;
    const list = this.tickets();
    const t = list.shift() ?? null;
    this.write(TICKETS_KEY, list);
    return t;
  }

  // ————————————————————————— réseau

  private async request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean; query?: string } = {}): Promise<NetResult<T>> {
    if (!this.configured) return { ok: false, kind: 'offline', status: 0, message: 'Service de classement non configuré.' };
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.auth) {
      const id = this.identity();
      if (!id) return { ok: false, kind: 'unauthorized', status: 401, message: 'Aucun profil.' };
      headers.Authorization = `Bearer ${id.playerId}.${id.token}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 10000);
    try {
      const res = await this.fetchFn(`${this.o.baseUrl}${path}${opts.query ? `?${opts.query}` : ''}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.ok) return { ok: true, data: data as T };
      const body = data as { message?: string; reason?: RejectReason } | null;
      return { ok: false, kind: res.status === 401 ? 'unauthorized' : 'http', status: res.status, message: body?.message ?? `Erreur ${res.status}`, reason: body?.reason };
    } catch {
      return { ok: false, kind: 'offline', status: 0, message: 'Service injoignable (hors ligne ?).' };
    } finally {
      clearTimeout(timer);
    }
  }

  async register(nickname: string): Promise<NetResult<Identity>> {
    const nick = normalizeNickname(nickname);
    if (!validNickname(nick)) return { ok: false, kind: 'http', status: 400, message: 'Pseudo invalide : 3 à 16 caractères (lettres, chiffres, espace, point, tiret).' };
    const res = await this.request<RegisterResponse>('POST', '/api/register', { body: { nickname: nick } });
    if (!res.ok) return res;
    const id: Identity = { playerId: res.data.playerId, token: res.data.token, nickname: res.data.nickname };
    this.write(IDENTITY_KEY, id);
    return { ok: true, data: id };
  }

  async rename(nickname: string): Promise<NetResult<Identity>> {
    const nick = normalizeNickname(nickname);
    if (!validNickname(nick)) return { ok: false, kind: 'http', status: 400, message: 'Pseudo invalide : 3 à 16 caractères (lettres, chiffres, espace, point, tiret).' };
    const res = await this.request<{ nickname: string }>('PATCH', '/api/me', { body: { nickname: nick }, auth: true });
    if (!res.ok) return res;
    const id = this.identity();
    if (!id) return { ok: false, kind: 'unauthorized', status: 401, message: 'Aucun profil.' };
    const next = { ...id, nickname: res.data.nickname };
    this.write(IDENTITY_KEY, next);
    return { ok: true, data: next };
  }

  top(balance?: number): Promise<NetResult<LeaderboardResponse>> {
    return this.request('GET', '/api/leaderboard', { auth: !!this.identity(), query: balance ? `balance=${balance}` : '' });
  }

  me(balance?: number): Promise<NetResult<MeResponse>> {
    return this.request('GET', '/api/me', { auth: true, query: balance ? `balance=${balance}` : '' });
  }

  balances(): Promise<NetResult<BalancesResponse>> {
    return this.request('GET', '/api/balances');
  }

  /** Demande des tickets au serveur quand il en reste peu (silencieux : échec réseau sans conséquence). */
  async ensureTickets(): Promise<void> {
    if (!this.configured || !this.identity() || this.tickets().length >= MIN_TICKETS) return;
    const res = await this.request<TicketsResponse>('POST', '/api/tickets', { auth: true });
    if (res.ok && Array.isArray(res.data.tickets)) this.write(TICKETS_KEY, [...this.tickets(), ...res.data.tickets]);
  }

  // ————————————————————————— parties

  /** Enregistre une partie de Survie éligible : conservée localement jusqu'à validation par le serveur. */
  recordRun(ticket: Ticket, flips: readonly number[], claimed: { time: number; score: number }): PendingRun {
    const replay: Replay = { v: REPLAY_FORMAT, flips: [...flips] };
    const run: PendingRun = {
      id: ticket.id,
      submission: { ticket, replay, claimed, client: { balance: this.o.balance, build: this.o.build } },
      createdAt: this.now(),
      status: 'pending',
      attempts: 0,
    };
    this.savePending([...this.pending().filter((p) => p.id !== run.id), run]);
    return run;
  }

  /** Envoie les résultats en attente, un par un. Les échecs réseau les laissent en attente ; un refus du serveur les marque « non validés ». */
  flush(): Promise<PendingRun[]> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<PendingRun[]> {
    if (!this.configured || !this.identity()) return this.pending();
    for (const run of this.pending().filter((p) => p.status === 'pending')) {
      const res = await this.request<RunResponse>('POST', '/api/runs', { body: run.submission, auth: true });
      const list = this.pending();
      const cur = list.find((p) => p.id === run.id);
      if (!cur) continue;
      cur.attempts++;
      if (res.ok && res.data.status === 'accepted') {
        cur.status = 'accepted';
        cur.result = { time: res.data.time, score: res.data.score, rank: res.data.rank, personalBest: res.data.personalBest };
        delete cur.lastError;
      } else if (!res.ok && res.kind === 'http' && res.status === 422) {
        // Refus définitif du serveur : le résultat n'est pas validé
        cur.status = 'rejected';
        cur.reason = res.reason;
        cur.message = res.message;
      } else if (!res.ok && res.kind === 'http' && res.status === 400) {
        cur.status = 'rejected';
        cur.message = res.message;
      } else if (!res.ok) {
        // Hors ligne, limite de débit ou authentification : on réessaiera
        cur.lastError = res.kind === 'offline' ? 'Hors ligne' : res.message;
        this.savePending(list);
        if (res.kind === 'offline' || res.kind === 'unauthorized') break;
        continue;
      }
      this.savePending(list);
    }
    return this.pending();
  }

  /** Supprime les résultats déjà traités (validés ou refusés) de la liste locale. */
  clearDone(): void {
    this.savePending(this.pending().filter((p) => p.status === 'pending'));
  }
}
