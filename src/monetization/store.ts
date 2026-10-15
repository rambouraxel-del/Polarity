import { PRISM_PACKS, packById, type PrismPack } from '../config/monetization';
import { applyPurchaseBalance, type PurchaseResultDto } from '../economy/purchases';
import type { NetResult } from '../net/leaderboard';
import type { SaveData } from '../save/save';
import { getPaymentProvider, type StoreReceipt } from './payments';

/**
 * Achats de Prismes — orchestration côté jeu. Règles : compte connecté obligatoire (contrôlé aussi par le service) ; achat → justificatif de la boutique
 * → VÉRIFICATION PAR LE SERVICE → seulement alors crédit et message de réussite ; transaction non confirmée (coupure) : jamais terminée côté boutique,
 * revérifiée plus tard (idempotent) par `recover()` / « Restaurer mes achats ». Aucune donnée de paiement ne transite par le jeu (le paiement est fait
 * dans la fenêtre de la plateforme).
 */
export interface StoreConfig {
  packs: { id: string; name: string; prisms: number; priceCents: number; productId: string }[];
  providers: { apple: boolean; google: boolean; web: boolean };
  ads: { enabled: boolean };
}

export type PurchaseStatus = 'idle' | 'preparing' | 'purchasing' | 'verifying' | 'pending' | 'success' | 'cancelled' | 'error' | 'restoring' | 'restored';
export interface PurchaseState {
  status: PurchaseStatus;
  packId?: string;
  message?: string;
}

export interface StoreAvailability {
  mode: 'native' | 'web' | 'none';
  canBuy: boolean;
  /** Pourquoi l'achat est impossible (null si possible). */
  reason: string | null;
  /** Action proposée pour lever l'obstacle. */
  fix?: 'account';
}

export interface StoreHost {
  configured: boolean;
  api<T>(method: string, path: string, opts?: { body?: unknown; auth?: boolean }): Promise<NetResult<T>>;
  hasIdentity(): boolean;
  /** Le profil est-il un COMPTE connecté ? (null : profil pas encore chargé). */
  isAccount(): boolean | null;
  commit(mutate: (save: SaveData) => void): void;
}

const msgOf = (r: Extract<NetResult<unknown>, { ok: false }>): string => (r.kind === 'offline' ? 'Connexion requise : le service doit confirmer l’achat.' : r.message);

export class StoreService {
  config: StoreConfig | null = null;
  state: PurchaseState = { status: 'idle' };
  private busy = false;

  constructor(private readonly host: StoreHost, private readonly onChange: () => void = () => undefined) {}

  private set(state: PurchaseState): void {
    this.state = state;
    this.onChange();
  }

  async loadConfig(): Promise<void> {
    if (!this.host.configured) return;
    const res = await this.host.api<StoreConfig>('GET', '/api/payments/config');
    if (res.ok) this.config = res.data;
    this.onChange();
  }

  availability(): StoreAvailability {
    const none = (reason: string): StoreAvailability => ({ mode: 'none', canBuy: false, reason });
    if (!this.host.configured) return none('Le service en ligne n’est pas disponible dans cette version : les achats sont désactivés.');
    if (!this.config) return none('Vérification de la disponibilité des achats…');
    const provider = getPaymentProvider();
    let mode: StoreAvailability['mode'] = 'none';
    if (provider.isAvailable() && provider.buy && provider.store) {
      if (!this.config.providers[provider.store]) return none('Achats indisponibles : le fournisseur de paiement de cette plateforme n’est pas encore activé sur le service.');
      mode = 'native';
    } else if (this.config.providers.web && !provider.isAvailable()) {
      mode = 'web';
    }
    if (mode === 'none') return none('Les achats de Prismes ne sont pas disponibles sur cette plateforme dans cette version.');
    const acct = this.host.isAccount();
    if (acct === false || !this.host.hasIdentity()) return { mode, canBuy: false, reason: 'Un compte connecté est nécessaire pour acheter (le jeu reste gratuit et complet sans achat).', fix: 'account' };
    return { mode, canBuy: true, reason: null };
  }

  private verifyBody(r: StoreReceipt): Record<string, unknown> {
    return { provider: r.provider, productId: r.productId, transactionId: r.transactionId, purchaseToken: r.purchaseToken };
  }

  /** Achat d'un pack. Le succès n'est annoncé qu'après la réponse « crédité » du service. */
  async buy(packId: string): Promise<PurchaseState> {
    const pack: PrismPack | undefined = packById(packId);
    const av = this.availability();
    if (!pack || !av.canBuy || this.busy) return this.state;
    this.busy = true;
    try {
      if (av.mode === 'web') return await this.buyWeb(pack);
      const provider = getPaymentProvider();
      this.set({ status: 'preparing', packId });
      const prep = await this.host.api<{ apple: { appAccountToken: string }; google: { obfuscatedAccountId: string } }>('GET', '/api/payments/prepare', { auth: true });
      if (!prep.ok) return this.set({ status: 'error', packId, message: msgOf(prep) }), this.state;
      const token = provider.store === 'apple' ? prep.data.apple.appAccountToken : prep.data.google.obfuscatedAccountId;
      this.set({ status: 'purchasing', packId });
      const bought = await provider.buy!(pack.productId, token);
      if (bought.status === 'cancelled') return this.set({ status: 'cancelled', packId, message: 'Achat annulé : rien n’a été débité ni crédité.' }), this.state;
      if (bought.status === 'failed') return this.set({ status: 'error', packId, message: bought.message }), this.state;
      if (bought.status === 'pending' && !bought.receipt) return this.set({ status: 'pending', packId, message: 'Paiement en attente de finalisation par votre boutique : aucun Prisme n’est crédité pour l’instant.' }), this.state;
      return await this.verify(bought.receipt!, packId, bought.status === 'pending');
    } finally {
      this.busy = false;
    }
  }

  private async verify(receipt: StoreReceipt, packId: string | undefined, pendingHint: boolean): Promise<PurchaseState> {
    this.set({ status: 'verifying', packId, message: 'Confirmation par le service…' });
    const res = await this.host.api<PurchaseResultDto>('POST', '/api/payments/verify', { auth: true, body: this.verifyBody(receipt) });
    if (!res.ok) {
      // Transaction NON terminée côté boutique : elle sera revérifiée (aucune perte, aucun double crédit)
      const text = res.kind === 'offline' ? 'Paiement effectué mais pas encore confirmé par le service : vos Prismes seront crédités dès que la connexion revient (ou via « Restaurer mes achats »).' : msgOf(res);
      return this.set({ status: 'error', packId, message: text }), this.state;
    }
    const r = res.data;
    if (r.status === 'credited' || r.status === 'already_credited') {
      this.host.commit((s) => applyPurchaseBalance(s, r.balance));
      await getPaymentProvider().finish?.(receipt);
      const text = r.status === 'credited' ? `${r.prisms} Prismes crédités, confirmés par le service.` : 'Cet achat était déjà crédité : rien n’a été ajouté.';
      return this.set({ status: 'success', packId, message: text }), this.state;
    }
    if (r.status === 'pending' || pendingHint) return this.set({ status: 'pending', packId, message: 'Paiement en attente de finalisation par le fournisseur : vos Prismes seront crédités dès qu’il sera confirmé.' }), this.state;
    return this.set({ status: 'error', packId, message: r.status === 'refunded' ? 'Cet achat a été remboursé : aucun Prisme n’est crédité.' : 'Achat annulé : rien n’a été crédité.' }), this.state;
  }

  private async buyWeb(pack: PrismPack): Promise<PurchaseState> {
    this.set({ status: 'preparing', packId: pack.id });
    const res = await this.host.api<{ url: string }>('POST', '/api/payments/web/checkout', { auth: true, body: { productId: pack.productId } });
    if (!res.ok) return this.set({ status: 'error', packId: pack.id, message: msgOf(res) }), this.state;
    this.set({ status: 'purchasing', packId: pack.id, message: 'Redirection vers la page de paiement sécurisée du prestataire…' });
    globalThis.location?.assign?.(res.data.url);
    return this.state;
  }

  /** Revérifie auprès du service les transactions non terminées / retrouvées par la boutique (idempotent). `silent` : au démarrage, sans message si rien à faire. */
  async restore(silent = false): Promise<PurchaseState> {
    const provider = getPaymentProvider();
    if (this.busy || !provider.pending || !this.host.hasIdentity()) return this.state;
    if (this.host.isAccount() === false) return this.state;
    this.busy = true;
    try {
      const receipts = await provider.pending();
      if (receipts.length === 0) {
        if (!silent) this.set({ status: 'restored', message: 'Aucun achat à restaurer sur cet appareil.' });
        return this.state;
      }
      if (!silent) this.set({ status: 'restoring', message: 'Restauration en cours…' });
      const res = await this.host.api<{ results: ({ status?: string; prisms?: number; error?: string })[]; balance: { shards: number; medals: number; prisms: number } }>('POST', '/api/payments/restore', { auth: true, body: { items: receipts.slice(0, 20).map((r) => this.verifyBody(r)) } });
      if (!res.ok) {
        if (!silent) this.set({ status: 'error', message: msgOf(res) });
        return this.state;
      }
      let credited = 0;
      for (const [i, r] of res.data.results.entries()) {
        if (r.status === 'credited' || r.status === 'already_credited' || r.status === 'refunded' || r.status === 'cancelled') await provider.finish?.(receipts[i]);
        if (r.status === 'credited') credited += r.prisms ?? 0;
      }
      this.host.commit((s) => applyPurchaseBalance(s, res.data.balance));
      if (credited > 0 || !silent) this.set({ status: 'restored', message: credited > 0 ? `${credited} Prismes restaurés, confirmés par le service.` : 'Vos achats sont déjà à jour : rien à restaurer.' });
      return this.state;
    } finally {
      this.busy = false;
    }
  }

  reset(): void {
    if (!this.busy) this.set({ status: 'idle' });
  }
}

export { PRISM_PACKS };
