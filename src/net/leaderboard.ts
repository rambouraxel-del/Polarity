import { setServiceIncompatible } from './serviceState';
import { REPLAY_FORMAT_POWERS, validNickname, normalizeNickname, type BalancesResponse, type Category, type LeaderboardResponse, type MeResponse, type RegisterResponse, type RejectReason, type Replay, type RunResponse, type RunSubmission, type Ticket, type TicketsResponse } from './protocol';
import { sha256Hex } from '../core/sha256';
import { dailyDigestInput, type DailyAttempt, type DailyBoard, type DailyNoticesResponse, type DailyRunResponse, type DailyRunSubmission, type DailyRejectReason, type LoyaltyClaimResponse, type LoyaltyState } from './rewardsProtocol';
import type { KeyValueStore } from '../save/save';
import { sanitizeBaseUrl } from './baseUrl';

export { sanitizeBaseUrl };

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
export const PENDING_DAILY_KEY = 'polarite.classement.quotidien';

/** URL du service, fixée à la construction du jeu (variable d'environnement publique : aucune clé secrète). */
export const LEADERBOARD_URL: string = sanitizeBaseUrl(import.meta.env?.VITE_LEADERBOARD_URL as string | undefined);

export interface Identity {
  playerId: string;
  token: string;
  nickname: string;
  /** Profil invité : pseudo non choisi (absent du classement public tant qu'un pseudo n'est pas choisi). */
  guest?: boolean;
  /** Anciens profils invités fusionnés dans celui-ci (fusion confirmée par le service) : leurs résultats en attente restent envoyables. */
  aliases?: string[];
}

export type PendingStatus = 'pending' | 'accepted' | 'rejected';

/** Résultat de Survie éligible, conservé localement jusqu'à sa validation par le serveur. */
export interface PendingRun {
  /** Identifiant du ticket (unique par partie). */
  id: string;
  /**
   * Profil qui a reçu le ticket et joué la partie : le résultat n'est JAMAIS envoyé avec l'identité d'un autre profil (le ticket est signé pour ce
   * profil). Conservé après déconnexion ; envoyé quand ce profil se reconnecte. Absent : ancienne entrée, rattachée au profil de l'appareil à la lecture.
   */
  owner?: string;
  submission: RunSubmission;
  createdAt: number;
  status: PendingStatus;
  attempts: number;
  /** Motif du dernier échec réseau (statut « en attente »). */
  lastError?: string;
  reason?: RejectReason;
  message?: string;
  result?: { time: number; score: number; rank: number; personalBest: boolean; category?: Category; /** Drop rare : Prisme crédité par le service à la validation. */ drop?: { prisms: number }; /** Le joueur a déjà vu l'animation du drop. */ dropSeen?: boolean };
  /** Charges de Boost/Gel consommées pendant cette partie : déduites de l'inventaire local tant que le service ne l'a pas validée (voir economy/reconcile.ts). */
  bonusUse?: { boost: number; gel: number };
  /** Le service demande de synchroniser d'abord les achats de bonus (la partie reste en attente, ticket conservé). */
  needsSync?: boolean;
}

/** Tentative du Défi quotidien terminée, conservée jusqu'à sa validation par le service. */
export interface PendingDaily {
  /** Identifiant de la tentative (donné par le service au démarrage). */
  id: string;
  owner?: string;
  date: string;
  submission: DailyRunSubmission;
  createdAt: number;
  status: PendingStatus;
  attempts: number;
  lastError?: string;
  /** Empreinte d'engagement de la tentative (SHA-256) ; `committed` : le service l'a reçue et horodatée. */
  digest?: string;
  committed?: boolean;
  reason?: DailyRejectReason;
  message?: string;
  result?: { time: number; score: number; rank: number; personalBest: boolean; late: boolean; state: 'open' | 'grace' | 'final'; eligible: boolean };
}

export type NetResult<T> = { ok: true; data: T } | { ok: false; kind: 'offline' | 'unauthorized' | 'http' | 'incompatible'; status: number; message: string; reason?: RejectReason; /** Corps de l'erreur renvoyé par le service (ex. conflit de compte à confirmer). */ body?: unknown };

/** Message affiché quand le service répond mais ne connaît pas les fonctions de cette version du jeu (serveur pas encore mis à jour) : ce n'est PAS une absence de connexion. */
export const INCOMPATIBLE_MESSAGE =
  'Le service en ligne n’est pas encore à jour pour cette version du jeu : Médailles, calendrier de connexion et Défi quotidien seront disponibles dès sa mise à jour. Votre progression est conservée sur cet appareil, rien n’est perdu.';

/** Routes déjà présentes dans les anciens services (classement) : elles continuent de fonctionner même si le service n'est pas à jour. */
const LEGACY_PATHS = new Set(['/api/health', '/api/leaderboard', '/api/me', '/api/balances', '/api/tickets', '/api/runs', '/api/report']);
const INCOMPATIBLE_RETRY_MS = 5 * 60_000;

export interface ClientOptions {
  baseUrl: string;
  store: KeyValueStore;
  fetchFn?: typeof fetch;
  balance: number;
  build: string;
  now?: () => number;
  /** Durée maximale d'une requête (ms). */
  timeoutMs?: number;
  /** Installation et compteur d'achats de bonus à joindre à une partie (le service s'en sert seulement pour décider « réessayer » ou « refus définitif »). */
  clientInfo?: () => { installId?: string; bonusBought?: { boost: number; gel: number } };
}

/** Résultats en attente conservés PAR profil (le plus récent remplace le plus ancien au-delà). */
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

  /** Tous les résultats en attente de cet appareil (tous profils confondus). Les anciennes entrées sans propriétaire sont rattachées au profil actuel. */
  pending(): PendingRun[] {
    const raw = this.read<PendingRun[]>(PENDING_KEY, []);
    const list = Array.isArray(raw) ? raw.filter((p) => p && typeof p.id === 'string') : [];
    const id = this.identity();
    if (id && list.some((p) => !p.owner)) {
      for (const p of list) if (!p.owner) p.owner = id.playerId;
      this.write(PENDING_KEY, list);
    }
    return list;
  }

  /** Identifiants que le profil actuel représente : lui-même et les profils invités fusionnés dans lui. */
  private ownerIds(): Set<string> {
    const id = this.identity();
    return new Set(id ? [id.playerId, ...(id.aliases ?? [])] : []);
  }

  /** Résultats du profil actuel (affichés et envoyés). */
  pendingOwn(): PendingRun[] {
    const mine = this.ownerIds();
    return this.pending().filter((p) => !!p.owner && mine.has(p.owner));
  }

  /** Résultats d'un AUTRE profil de cet appareil : conservés, envoyés quand ce profil se reconnecte. */
  pendingForeign(): PendingRun[] {
    const mine = this.ownerIds();
    return this.pending().filter((p) => !p.owner || !mine.has(p.owner));
  }

  /** Enregistre la liste en gardant au plus `MAX_PENDING` entrées par propriétaire. */
  private savePending(list: PendingRun[]): void {
    const kept: PendingRun[] = [];
    const count = new Map<string, number>();
    for (const p of [...list].reverse()) {
      const k = p.owner ?? '';
      const n = count.get(k) ?? 0;
      if (n >= MAX_PENDING) continue;
      count.set(k, n + 1);
      kept.unshift(p);
    }
    if (kept.length === 0) this.o.store.remove(PENDING_KEY);
    else this.write(PENDING_KEY, kept);
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

  /** Heure (ms) à laquelle le service a répondu « route inconnue » à une route récente : on cesse alors de l'interroger (5 min) au lieu de répéter des requêtes vouées à l'échec. */
  private incompatibleAt = 0;

  /** Vrai si le service a montré qu'il n'est pas à jour pour cette version du jeu (réponse « route inconnue » ou inscription invité refusée). */
  isServiceIncompatible(): boolean {
    return this.incompatibleAt > 0 && this.now() - this.incompatibleAt < INCOMPATIBLE_RETRY_MS;
  }

  private incompatible<T>(): NetResult<T> {
    setServiceIncompatible(true);
    return { ok: false, kind: 'incompatible', status: 0, message: INCOMPATIBLE_MESSAGE };
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean; query?: string } = {}): Promise<NetResult<T>> {
    if (!this.configured) return { ok: false, kind: 'offline', status: 0, message: 'Service de classement non configuré.' };
    const legacyRoute = LEGACY_PATHS.has(path) || (path === '/api/register' && typeof (opts.body as { nickname?: unknown } | undefined)?.nickname === 'string');
    if (!legacyRoute && this.isServiceIncompatible()) return this.incompatible();
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
      if (res.ok) {
        if (!legacyRoute) {
          this.incompatibleAt = 0;
          setServiceIncompatible(false);
        }
        return { ok: true, data: data as T };
      }
      const body = data as { message?: string; reason?: RejectReason; error?: string } | null;
      // Un service d'avant l'économie v3 répond « route inconnue » (404) aux routes récentes : serveur à mettre à jour, pas une absence de connexion
      if (!legacyRoute && res.status === 404 && body?.error === 'not_found') {
        this.incompatibleAt = this.now();
        return this.incompatible();
      }
      return { ok: false, kind: res.status === 401 ? 'unauthorized' : 'http', status: res.status, message: body?.message ?? `Erreur ${res.status}`, reason: body?.reason, body: data };
    } catch {
      return { ok: false, kind: 'offline', status: 0, message: 'Service injoignable (hors ligne ?).' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Requête brute vers le service (comptes, synchronisation) : mêmes règles que le classement (https, délai, aucun secret hors de l'en-tête). */
  api<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean; query?: string } = {}): Promise<NetResult<T>> {
    return this.request<T>(method, path, opts);
  }

  /**
   * Remplace l'identité de cet appareil (connexion, fusion). Les tickets de l'ancien profil ne valent plus : ils sont écartés.
   * `mergedFrom` : profil invité que le service vient de fusionner dans celui-ci — ses résultats en attente deviennent envoyables.
   * Les résultats en attente ne sont jamais supprimés ni réattribués.
   */
  adoptIdentity(id: Identity, opts: { mergedFrom?: string } = {}): void {
    const prev = this.identity();
    const aliases = new Set<string>(id.aliases ?? (prev && prev.playerId === id.playerId ? prev.aliases ?? [] : []));
    if (opts.mergedFrom && opts.mergedFrom !== id.playerId) {
      aliases.add(opts.mergedFrom);
      for (const a of this.aliasesOf(opts.mergedFrom)) aliases.add(a);
    }
    this.pending(); // rattache d'abord les anciennes entrées sans propriétaire à l'ancien profil
    this.write(TICKETS_KEY, []);
    this.write(IDENTITY_KEY, { ...id, aliases: aliases.size > 0 ? [...aliases] : undefined });
  }

  private aliasesOf(playerId: string): string[] {
    const prev = this.identity();
    return prev && prev.playerId === playerId ? prev.aliases ?? [] : [];
  }

  /** Profil invité créé automatiquement, sans saisie : disponible tout de suite pour la synchronisation. Sans effet si un profil existe déjà. */
  async registerGuest(): Promise<NetResult<Identity>> {
    const existing = this.identity();
    if (existing) return { ok: true, data: existing };
    const res = await this.request<RegisterResponse & { guest?: boolean }>('POST', '/api/register', { body: {} });
    // Un ancien service exige un pseudo à l'inscription (le profil invité n'existe pas encore chez lui)
    if (!res.ok && res.kind === 'http' && res.status === 400 && (res.body as { error?: string } | undefined)?.error === 'bad_nickname') {
      this.incompatibleAt = this.now();
      return this.incompatible();
    }
    if (!res.ok) return res;
    this.incompatibleAt = 0;
    setServiceIncompatible(false);
    const id: Identity = { playerId: res.data.playerId, token: res.data.token, nickname: res.data.nickname, guest: res.data.guest !== false };
    this.adoptIdentity(id);
    return { ok: true, data: id };
  }

  async register(nickname: string): Promise<NetResult<Identity>> {
    const nick = normalizeNickname(nickname);
    if (!validNickname(nick)) return { ok: false, kind: 'http', status: 400, message: 'Pseudo invalide : 3 à 16 caractères (lettres, chiffres, espace, point, tiret).' };
    const res = await this.request<RegisterResponse>('POST', '/api/register', { body: { nickname: nick } });
    if (!res.ok) return res;
    const id: Identity = { playerId: res.data.playerId, token: res.data.token, nickname: res.data.nickname };
    // Les tickets sont liés au profil qui les a reçus : ceux d'un ancien profil seraient refusés par le serveur
    this.adoptIdentity(id);
    return { ok: true, data: id };
  }

  async rename(nickname: string): Promise<NetResult<Identity>> {
    const nick = normalizeNickname(nickname);
    if (!validNickname(nick)) return { ok: false, kind: 'http', status: 400, message: 'Pseudo invalide : 3 à 16 caractères (lettres, chiffres, espace, point, tiret).' };
    const res = await this.request<{ nickname: string }>('PATCH', '/api/me', { body: { nickname: nick }, auth: true });
    if (!res.ok) return res;
    const id = this.identity();
    if (!id) return { ok: false, kind: 'unauthorized', status: 401, message: 'Aucun profil.' };
    const next: Identity = { playerId: id.playerId, token: id.token, nickname: res.data.nickname, guest: false };
    this.write(IDENTITY_KEY, next);
    return { ok: true, data: next };
  }

  /**
   * Oublie l'identité de cet appareil (secret, tickets). Par défaut (`keep`, déconnexion) les résultats classés en attente sont CONSERVÉS, rattachés
   * à leur profil, et envoyés quand ce profil se reconnecte. `drop` : le profil n'existe plus (supprimé, inconnu du service) — ses résultats
   * en attente, qui ne pourront jamais être validés, sont retirés ; ceux des autres profils restent.
   */
  forgetProfile(mode: 'keep' | 'drop' = 'keep'): void {
    if (mode === 'drop') {
      const mine = this.ownerIds();
      this.savePending(this.pending().filter((p) => !p.owner || !mine.has(p.owner)));
    } else {
      this.pending(); // rattache les anciennes entrées sans propriétaire avant d'oublier l'identité
    }
    this.o.store.remove(IDENTITY_KEY);
    this.o.store.remove(TICKETS_KEY);
  }

  /**
   * Suppression du profil : le serveur efface pseudo, parties, journaux et records (irréversible). Le profil local n'est oublié que si le serveur
   * confirme (ou ne le connaît déjà plus) ; hors ligne, rien n'est perdu et la demande peut être refaite.
   */
  async deleteProfile(): Promise<NetResult<{ deleted: boolean }>> {
    const res = await this.request<{ deleted: boolean }>('DELETE', '/api/me', { auth: true });
    if (res.ok || (!res.ok && res.kind === 'unauthorized')) {
      this.forgetProfile('drop');
      return { ok: true, data: { deleted: true } };
    }
    return res;
  }

  /** Signale un pseudo offensant (examiné par l'opérateur ; aucun effet automatique). */
  report(nickname: string): Promise<NetResult<{ ok: boolean; message: string }>> {
    const nick = normalizeNickname(nickname);
    if (!validNickname(nick)) return Promise.resolve({ ok: false, kind: 'http', status: 400, message: 'Pseudo invalide.' });
    return this.request('POST', '/api/report', { body: { nickname: nick }, auth: true });
  }

  private query(balance: number | undefined, category: Category): string {
    return [balance ? `balance=${balance}` : '', `category=${category}`].filter(Boolean).join('&');
  }

  /** Classement mondial d'une catégorie (« sans bonus » par défaut). */
  top(balance?: number, category: Category = 'plain'): Promise<NetResult<LeaderboardResponse>> {
    return this.request('GET', '/api/leaderboard', { auth: !!this.identity(), query: this.query(balance, category) });
  }

  me(balance?: number, category: Category = 'plain'): Promise<NetResult<MeResponse>> {
    return this.request('GET', '/api/me', { auth: true, query: this.query(balance, category) });
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
  recordRun(ticket: Ticket, log: { flips: readonly number[]; acts: readonly (readonly [number, number])[] }, claimed: { time: number; score: number }, bonusUse: { boost: number; gel: number } = { boost: 0, gel: 0 }): PendingRun | null {
    // Le ticket est signé pour le profil qui l'a reçu : le résultat lui est rattaché définitivement
    const owner = this.identity()?.playerId;
    if (!owner) return null;
    const replay: Replay = { v: REPLAY_FORMAT_POWERS, flips: [...log.flips], acts: log.acts.map((a) => [a[0], a[1]] as [number, number]) };
    const run: PendingRun = {
      id: ticket.id,
      owner,
      submission: { ticket, replay, claimed, client: { balance: this.o.balance, build: this.o.build, ...this.o.clientInfo?.() } },
      bonusUse: bonusUse.boost + bonusUse.gel > 0 ? bonusUse : undefined,
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
    if (!this.configured || !this.identity()) return this.pendingOwn();
    // Seuls les résultats du profil connecté sont envoyés (jamais ceux d'un autre profil de l'appareil)
    for (const run of this.pendingOwn().filter((p) => p.status === 'pending')) {
      const res = await this.request<RunResponse>('POST', '/api/runs', { body: run.submission, auth: true });
      const list = this.pending();
      const cur = list.find((p) => p.id === run.id);
      if (!cur) continue;
      cur.attempts++;
      if (res.ok && res.data.status === 'accepted') {
        cur.status = 'accepted';
        cur.result = { time: res.data.time, score: res.data.score, rank: res.data.rank, personalBest: res.data.personalBest, category: res.data.category, ...(res.data.drop ? { drop: res.data.drop } : {}) };
        delete cur.lastError;
        delete cur.needsSync;
      } else if (!res.ok && res.kind === 'http' && res.status === 422) {
        // Refus définitif du serveur : le résultat n'est pas validé
        cur.status = 'rejected';
        cur.reason = res.reason;
        cur.message = res.message;
      } else if (!res.ok && res.kind === 'http' && res.status === 400) {
        cur.status = 'rejected';
        cur.message = res.message;
      } else if (!res.ok && res.kind === 'http' && res.status === 409 && res.reason === 'bonus_sync_required') {
        // Les achats de bonus de cette partie ne sont pas encore traités par le service : la partie reste en attente (ticket conservé)
        cur.needsSync = true;
        cur.lastError = 'Achats de bonus à synchroniser';
        this.savePending(list);
        continue;
      } else if (!res.ok) {
        // Hors ligne, limite de débit ou authentification : on réessaiera
        cur.lastError = res.kind === 'offline' ? 'Hors ligne' : res.message;
        this.savePending(list);
        // Hors ligne, profil non reconnu ou limite de débit : inutile d'insister sur les résultats suivants
        if (res.kind === 'offline' || res.kind === 'unauthorized' || res.status === 429) break;
        continue;
      }
      this.savePending(list);
    }
    return this.pendingOwn();
  }

  /** Parties acceptées avec un drop rare de Prismes dont l'animation n'a pas encore été montrée (retour en ligne tardif, application rouverte). */
  unseenDrops(): PendingRun[] {
    return this.pendingOwn().filter((p) => p.status === 'accepted' && !!p.result?.drop && !p.result.dropSeen);
  }

  markDropSeen(id: string): void {
    const list = this.pending();
    const cur = list.find((p) => p.id === id);
    if (!cur?.result) return;
    cur.result.dropSeen = true;
    this.savePending(list);
  }

  // ————————————————————————— récompenses gratuites (phase 4) : calendrier, défi quotidien mondial, démarrage de partie

  /** Valide la présence du jour (heure du SERVICE) et renvoie le calendrier. */
  loyaltyCheckin(): Promise<NetResult<LoyaltyState>> {
    return this.request('POST', '/api/loyalty/checkin', { auth: true, body: {} });
  }

  loyaltyClaim(cycle: number, day: number): Promise<NetResult<LoyaltyClaimResponse>> {
    return this.request('POST', '/api/loyalty/claim', { auth: true, body: { cycle, day } });
  }

  /** Enregistre côté service le démarrage EN LIGNE d'une partie de Survie (condition du drop rare) ; silencieux hors ligne. */
  async startTicket(ticketId: string): Promise<boolean> {
    if (!this.configured || !this.identity()) return false;
    const res = await this.request<{ started: boolean }>('POST', '/api/tickets/start', { auth: true, body: { ticketId } });
    return res.ok;
  }

  dailyStart(date: string): Promise<NetResult<{ attempt: DailyAttempt }>> {
    return this.request('POST', '/api/daily/start', { auth: true, body: { date } });
  }

  dailyBoard(date?: string): Promise<NetResult<DailyBoard>> {
    return this.request('GET', '/api/daily/leaderboard', { auth: !!this.identity(), query: date ? `date=${date}` : '' });
  }

  dailyNotices(): Promise<NetResult<DailyNoticesResponse>> {
    return this.request('GET', '/api/daily/notices', { auth: true });
  }

  dailyAck(dates: string[]): Promise<NetResult<{ ok: boolean }>> {
    return this.request('POST', '/api/daily/ack', { auth: true, body: { dates } });
  }

  /** Tentatives du Défi quotidien terminées, conservées jusqu'à leur validation par le service (le jeu reste jouable hors ligne). */
  pendingDaily(): PendingDaily[] {
    const raw = this.read<PendingDaily[]>(PENDING_DAILY_KEY, []);
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.id === 'string') : [];
  }

  private savePendingDaily(list: PendingDaily[]): void {
    const kept = list.slice(-10);
    if (kept.length === 0) this.o.store.remove(PENDING_DAILY_KEY);
    else this.write(PENDING_DAILY_KEY, kept);
  }

  /** Conserve une tentative terminée du Défi quotidien (démarrée en ligne : le service en connaît l'heure de début). */
  recordDaily(attempt: DailyAttempt, flips: readonly number[], claimed: { time: number; score: number }): PendingDaily | null {
    const owner = this.identity()?.playerId;
    if (!owner) return null;
    const submission: DailyRunSubmission = { attemptId: attempt.id, date: attempt.date, replay: { v: 1, flips: [...flips] }, claimed, client: { build: this.o.build } };
    const run: PendingDaily = { id: attempt.id, owner, date: attempt.date, submission, createdAt: this.now(), status: 'pending', attempts: 0, digest: sha256Hex(dailyDigestInput(attempt.date, claimed.score, flips)) };
    this.savePendingDaily([...this.pendingDaily().filter((p) => p.id !== run.id), run]);
    return run;
  }

  /** Envoie les tentatives du Défi en attente. Échec réseau : on réessaie ; refus du service : définitif (message du service). */
  async flushDaily(): Promise<PendingDaily[]> {
    if (!this.configured || !this.identity()) return this.pendingDaily();
    const mine = this.ownerIds();
    for (const run of this.pendingDaily().filter((p) => p.status === 'pending' && !!p.owner && mine.has(p.owner))) {
      // 1. Engagement horodaté par le service dès que possible (preuve de fin avant minuit si le journal complet arrive après) ; échec réseau : non bloquant
      if (run.digest && !run.committed) {
        const c = await this.request<{ committedAt: number }>('POST', '/api/daily/commit', { auth: true, body: { attemptId: run.id, digest: run.digest } });
        if (c.ok || (!c.ok && c.kind === 'http' && c.status === 409)) {
          const l = this.pendingDaily();
          const e = l.find((p) => p.id === run.id);
          if (e && c.ok) {
            e.committed = true;
            this.savePendingDaily(l);
          }
        }
      }
      const res = await this.request<DailyRunResponse>('POST', '/api/daily/runs', { auth: true, body: run.submission });
      const list = this.pendingDaily();
      const cur = list.find((p) => p.id === run.id);
      if (!cur) continue;
      cur.attempts++;
      if (res.ok && res.data.status === 'accepted') {
        cur.status = 'accepted';
        cur.result = { time: res.data.time, score: res.data.score, rank: res.data.rank, personalBest: res.data.personalBest, late: res.data.late, state: res.data.state, eligible: res.data.eligible };
        delete cur.lastError;
      } else if (!res.ok && res.kind === 'http' && (res.status === 422 || res.status === 400 || res.status === 403)) {
        cur.status = 'rejected';
        cur.reason = res.reason as unknown as DailyRejectReason | undefined;
        cur.message = res.message;
      } else if (!res.ok) {
        cur.lastError = res.kind === 'offline' ? 'Hors ligne' : res.message;
        this.savePendingDaily(list);
        if (res.kind === 'offline' || res.kind === 'unauthorized' || res.status === 429) break;
        continue;
      }
      this.savePendingDaily(list);
    }
    return this.pendingDaily();
  }

  /** Supprime les tentatives du Défi déjà traitées (acceptées ou refusées). */
  clearDailyDone(): void {
    this.savePendingDaily(this.pendingDaily().filter((p) => p.status === 'pending'));
  }

  /** Charges de bonus consommées par les parties du profil actuel encore en attente de validation. */
  pendingBonusUse(): { boost: number; gel: number } {
    const out = { boost: 0, gel: 0 };
    for (const p of this.pendingOwn()) {
      if (p.status !== 'pending' || !p.bonusUse) continue;
      out.boost += p.bonusUse.boost;
      out.gel += p.bonusUse.gel;
    }
    return out;
  }

  /** Supprime les résultats déjà traités (validés ou refusés) du profil actuel ; ceux des autres profils ne sont pas touchés. */
  clearDone(): void {
    const mine = this.ownerIds();
    this.savePending(this.pending().filter((p) => p.status === 'pending' || !p.owner || !mine.has(p.owner)));
  }
}
