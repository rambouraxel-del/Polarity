import { applySyncResult, buildMigrateBody, buildSyncBody, pendingSummary } from '../economy/reconcile';
import { ensureInstallId } from '../economy/ids';
import type { AuthResponse, ConflictResponse, EmailRequestResponse, NonceResponse, ProfileResponse, ProviderId, ProvidersResponse, SyncResponse } from '../net/accountProtocol';
import type { Identity, LeaderboardClient, NetResult } from '../net/leaderboard';
import type { KeyValueStore, SaveData } from '../save/save';
import { availability, type Availability } from './providers';

/**
 * Service de COMPTE du jeu : profil invité automatique, connexion facultative (Google / Apple / lien magique), fusion confirmée, synchronisation et
 * migration des anciennes sauvegardes — avec fonctionnement HORS LIGNE (les gains et achats restent provisoires, envoyés plus tard).
 * Le jeu reste entièrement jouable sans service, sans réseau et sans compte : rien ici n'est bloquant.
 * Voir docs/COMPTES.md.
 */
export const ACCOUNT_KEY = 'polarite.compte';
const MIN_SYNC_INTERVAL_MS = 10_000;
const SYNC_DELAY_MS = 45_000;

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'ok' | 'offline' | 'error' | 'disabled';
  lastAt: number | null;
  message: string | null;
}

/** Preuve de connexion gardée en mémoire pendant une demande de fusion (jamais stockée). */
type Proof = { kind: 'oidc'; provider: 'google' | 'apple'; idToken: string; nonce: string } | { kind: 'email'; requestId: string; code: string };

export interface AccountState {
  configured: boolean;
  identity: { nickname: string; guest: boolean } | null;
  profile: ProfileResponse | null;
  providers: ProvidersResponse | null;
  providersLoaded: boolean;
  email: { stage: 'idle' | 'code'; address: string; requestId: string | null };
  conflict: ConflictResponse | null;
  message: { kind: 'ok' | 'error'; text: string } | null;
  sync: SyncStatus;
  pending: { earned: number; purchases: number; legacy: boolean };
  busy: boolean;
}

export interface AccountHost {
  lb: LeaderboardClient;
  store: KeyValueStore;
  getSave(): SaveData;
  /** Modifie la sauvegarde puis l'enregistre (une écriture) et rafraîchit l'affichage. */
  commit(mutate: (save: SaveData) => void): void;
  /** Une partie est en cours : la synchronisation attend (aucune requête pendant le jeu). */
  isPlaying(): boolean;
  onChange(): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export class AccountService {
  private proof: Proof | null = null;
  private running: Promise<void> | null = null;
  private timer: unknown = null;
  private lastRunAt = 0;
  readonly state: AccountState;

  constructor(private readonly h: AccountHost) {
    const saved = this.readMeta();
    this.state = {
      configured: h.lb.configured,
      identity: null,
      profile: null,
      providers: null,
      providersLoaded: false,
      email: { stage: 'idle', address: '', requestId: null },
      conflict: null,
      message: null,
      sync: { status: h.lb.configured ? 'idle' : 'disabled', lastAt: saved.lastSyncAt, message: null },
      pending: pendingSummary(h.getSave()),
      busy: false,
    };
    this.refreshIdentity();
  }

  private now(): number {
    return (this.h.now ?? Date.now)();
  }

  private readMeta(): { lastSyncAt: number | null } {
    try {
      const raw = JSON.parse(this.h.store.get(ACCOUNT_KEY) ?? 'null') as { lastSyncAt?: unknown } | null;
      return { lastSyncAt: typeof raw?.lastSyncAt === 'number' ? raw.lastSyncAt : null };
    } catch {
      return { lastSyncAt: null };
    }
  }

  private writeMeta(): void {
    this.h.store.set(ACCOUNT_KEY, JSON.stringify({ lastSyncAt: this.state.sync.lastAt }));
  }

  private refreshIdentity(): void {
    const id = this.h.lb.identity();
    this.state.identity = id ? { nickname: id.nickname, guest: id.guest === true } : null;
    this.state.pending = pendingSummary(this.h.getSave());
  }

  private notify(): void {
    this.refreshIdentity();
    this.h.onChange();
  }

  private say(kind: 'ok' | 'error', text: string): void {
    this.state.message = { kind, text };
  }

  // ————————————————————————— démarrage, fournisseurs, profil

  /** Au démarrage : identifiant d'installation, profil invité, lien magique éventuel, première synchronisation. Silencieux hors ligne. */
  async start(search: string = typeof location !== 'undefined' ? location.search : ''): Promise<void> {
    this.h.commit((s) => void ensureInstallId(s));
    if (!this.h.lb.configured) return;
    const magic = parseMagicParam(search);
    if (magic) await this.emailVerify(magic.requestId, magic.code, false);
    await this.syncNow();
  }

  async loadProviders(): Promise<void> {
    if (!this.h.lb.configured) return;
    const res = await this.h.lb.api<ProvidersResponse>('GET', '/api/auth/providers');
    this.state.providers = res.ok ? res.data : null;
    this.state.providersLoaded = true;
    this.notify();
  }

  availability(): Availability[] {
    return availability(this.state.providers, { native: typeof globalThis !== 'undefined' && !!(globalThis as { Capacitor?: unknown }).Capacitor && this.isNative(), plugin: this.hasPlugin(), online: this.state.sync.status !== 'offline' });
  }

  private isNative(): boolean {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  }

  private hasPlugin(): boolean {
    return !!(globalThis as { Capacitor?: { Plugins?: { SocialLogin?: unknown } } }).Capacitor?.Plugins?.SocialLogin;
  }

  async loadProfile(): Promise<void> {
    if (!this.h.lb.identity()) return;
    const res = await this.h.lb.api<ProfileResponse>('GET', '/api/profile', { auth: true });
    this.state.profile = res.ok ? res.data : null;
    if (!res.ok && res.kind === 'unauthorized') this.say('error', 'Le service ne reconnaît plus ce profil (supprimé ou service réinitialisé). Vos données locales sont intactes.');
    this.notify();
  }

  /** Nonce à usage unique délivré par le service (anti-rejeu des jetons de connexion). */
  async fetchNonce(): Promise<string | null> {
    const res = await this.h.lb.api<NonceResponse>('POST', '/api/auth/nonce', { body: {} });
    return res.ok ? res.data.nonce : null;
  }

  // ————————————————————————— connexion

  private async busy<T>(fn: () => Promise<T>): Promise<T> {
    this.state.busy = true;
    this.h.onChange();
    try {
      return await fn();
    } finally {
      this.state.busy = false;
      this.notify();
    }
  }

  /** Traite la réponse d'une connexion : nouvel accès, conflit à confirmer, erreur. Renvoie vrai si la connexion a abouti. */
  private async handleAuth(res: NetResult<AuthResponse>): Promise<boolean> {
    if (res.ok) {
      this.state.conflict = null;
      this.proof = null;
      const a = res.data;
      if (a.token) {
        const id: Identity = { playerId: a.playerId, token: a.token, nickname: a.nickname, guest: a.guest };
        this.h.lb.adoptIdentity(id);
      } else {
        const cur = this.h.lb.identity();
        if (cur) this.h.lb.adoptIdentity({ ...cur, nickname: a.nickname, guest: a.guest });
      }
      this.say('ok', a.merged ? `Progression de cet appareil fusionnée dans le compte « ${a.nickname} ».` : a.created ? 'Compte créé et connecté.' : 'Connexion réussie.');
      await this.loadProfile();
      void this.syncNow(true);
      return true;
    }
    this.say('error', res.message);
    return false;
  }

  /** Connexion par jeton d'identité (Google ou Apple) obtenu du fournisseur. */
  async loginOidc(provider: 'google' | 'apple', idToken: string, nonce: string, merge = false): Promise<boolean> {
    return this.busy(async () => {
      const proof: Proof = { kind: 'oidc', provider, idToken, nonce };
      const res = await this.h.lb.api<AuthResponse>('POST', `/api/auth/${provider}`, { auth: !!this.h.lb.identity(), body: { idToken, nonce, merge } });
      return this.finishAuth(res, proof);
    });
  }

  async emailRequest(address: string): Promise<boolean> {
    return this.busy(async () => {
      const res = await this.h.lb.api<EmailRequestResponse>('POST', '/api/auth/email/request', { body: { email: address } });
      if (!res.ok) {
        this.say('error', res.message);
        return false;
      }
      this.state.email = { stage: 'code', address, requestId: res.data.requestId };
      this.say('ok', 'Si l’adresse est valide, un message vient d’être envoyé (code valable 15 minutes).');
      return true;
    });
  }

  async emailVerify(requestId: string, code: string, merge: boolean): Promise<boolean> {
    return this.busy(async () => {
      const proof: Proof = { kind: 'email', requestId, code };
      const res = await this.h.lb.api<AuthResponse>('POST', '/api/auth/email/verify', { auth: !!this.h.lb.identity(), body: { requestId, code, merge } });
      const ok = await this.finishAuth(res, proof);
      if (ok) this.state.email = { stage: 'idle', address: '', requestId: null };
      return ok;
    });
  }

  private async finishAuth(res: NetResult<AuthResponse>, proof: Proof): Promise<boolean> {
    if (!res.ok && res.status === 409 && (res.body as { error?: string } | undefined)?.error === 'identity_conflict') {
      // Le compte existe déjà : la fusion de cet appareil dans ce compte doit être CONFIRMÉE par le joueur (même preuve, `merge: true`)
      this.state.conflict = res.body as ConflictResponse;
      this.proof = proof;
      this.say('error', this.state.conflict.message);
      return false;
    }
    return this.handleAuth(res);
  }

  /** Fusion confirmée par le joueur : même preuve, `merge: true`. */
  async confirmMerge(): Promise<boolean> {
    const p = this.proof;
    if (!p) return false;
    return p.kind === 'oidc' ? this.loginOidc(p.provider, p.idToken, p.nonce, true) : this.emailVerify(p.requestId, p.code, true);
  }

  cancelMerge(): void {
    this.proof = null;
    this.state.conflict = null;
    this.h.onChange();
  }

  async logout(): Promise<void> {
    await this.busy(async () => {
      if (this.h.lb.identity()) await this.h.lb.api('POST', '/api/auth/logout', { auth: true, body: {} });
      this.h.lb.forgetProfile();
      this.state.profile = null;
      this.say('ok', 'Déconnecté de cet appareil. Votre progression locale est conservée ; un nouveau profil invité sera créé.');
    });
  }

  async unlink(provider: ProviderId): Promise<void> {
    await this.busy(async () => {
      const res = await this.h.lb.api('POST', '/api/auth/unlink', { auth: true, body: { provider } });
      this.say(res.ok ? 'ok' : 'error', res.ok ? 'Méthode de connexion retirée.' : res.message);
      await this.loadProfile();
    });
  }

  // ————————————————————————— synchronisation (hors ligne tolérée)

  /** Programme une synchronisation différée (regroupe les écritures fréquentes). */
  scheduleSync(): void {
    if (!this.h.lb.configured || this.timer !== null) return;
    const set = this.h.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      void this.syncNow();
    }, SYNC_DELAY_MS);
  }

  syncNow(force = false): Promise<void> {
    if (this.running) return this.running;
    if (!this.h.lb.configured) return Promise.resolve();
    if (!force && this.now() - this.lastRunAt < MIN_SYNC_INTERVAL_MS) return Promise.resolve();
    if (this.h.isPlaying()) {
      this.scheduleSync();
      return Promise.resolve();
    }
    this.running = this.doSync().finally(() => {
      this.running = null;
      this.lastRunAt = this.now();
    });
    return this.running;
  }

  private setSync(status: SyncStatus['status'], message: string | null): void {
    this.state.sync = { status, lastAt: status === 'ok' ? this.now() : this.state.sync.lastAt, message };
    if (status === 'ok') this.writeMeta();
    this.notify();
  }

  private async doSync(): Promise<void> {
    const lb = this.h.lb;
    this.setSync('syncing', null);
    this.h.commit((s) => void ensureInstallId(s));
    // Profil invité automatique (sans saisie) : créé dès qu'une connexion au service est possible
    if (!lb.identity()) {
      const g = await lb.registerGuest();
      if (!g.ok) return this.fail(g);
    }
    // 1. Migration exceptionnelle de l'ancienne sauvegarde (une seule fois ; idempotente côté serveur)
    const legacy = this.h.getSave().economy.legacy;
    if (legacy && !legacy.imported) {
      const sent = this.h.getSave();
      const res = await lb.api<SyncResponse>('POST', '/api/migrate', { auth: true, body: buildMigrateBody(sent) });
      if (!res.ok) return this.fail(res);
      this.h.commit((s) => {
        if (s.economy.legacy) s.economy.legacy.imported = true;
        applySyncResult(s, res.data, sent.wallet.shards, { wallet: false });
      });
    }
    // 2. Synchronisation : gains, achats, progression
    const sent = this.h.getSave();
    const res = await lb.api<SyncResponse>('POST', '/api/sync', { auth: true, body: buildSyncBody(sent) });
    if (!res.ok) return this.fail(res);
    this.h.commit((s) => applySyncResult(s, res.data, sent.wallet.shards));
    const refused = res.data.rejected.length;
    this.setSync('ok', refused > 0 ? `${refused} achat${refused > 1 ? 's' : ''} non confirmé${refused > 1 ? 's' : ''} par le service (solde ou prix) : annulé${refused > 1 ? 's' : ''}, aucun Éclat perdu.` : res.data.capped ? 'Une partie de vos gains sera confirmée aux prochaines synchronisations.' : null);
  }

  private fail(res: Extract<NetResult<unknown>, { ok: false }>): void {
    if (res.kind === 'offline') return this.setSync('offline', 'Hors connexion : vos gains et achats restent enregistrés sur cet appareil et seront envoyés plus tard.');
    if (res.kind === 'unauthorized') return this.setSync('error', 'Le service ne reconnaît plus ce profil. Vos données locales sont intactes.');
    this.setSync('error', res.message);
  }
}

/** `?magic=<identifiant>.<code>` : lien reçu par courriel (le paramètre est retiré de l'adresse après lecture). */
export function parseMagicParam(search: string): { requestId: string; code: string } | null {
  const m = /[?&]magic=([0-9a-f]{32})\.([A-Za-z0-9]{8})(?:&|$)/.exec(search);
  return m ? { requestId: m[1], code: m[2].toUpperCase() } : null;
}
