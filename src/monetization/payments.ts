import { nativePlugin } from '../platform/plugins';
import { nativePlatform } from '../platform/native';

/**
 * Paiements réels (Prismes) — côté JEU. Le jeu ne décide JAMAIS d'un crédit : il demande à la boutique de la plateforme (via un plugin natif) d'exécuter
 * l'achat, puis transmet seulement l'identifiant de la transaction au SERVICE (`POST /api/payments/verify`) qui la vérifie auprès du fournisseur et
 * crédite les Prismes (voir server/payments.ts). Tant que le service n'a pas répondu « crédité », aucun succès n'est affiché.
 *
 * - Sans plugin natif de facturation (web, application sans le plugin) : `NullPaymentProvider` (rien d'actif, aucun bouton « Acheter »).
 * - Le plugin natif attendu s'appelle `PolarRiftBilling` (contrat ci-dessous) : StoreKit 2 (iOS) / Google Play Billing (Android).
 * Voir docs/MONETISATION.md.
 */
export interface PremiumProduct {
  productId: string;
  /** Prismes accordés (lot de monnaie) ou identifiant d'article, selon le produit. */
  prisms?: number;
  itemId?: string;
}

export type PurchaseOutcome =
  | { status: 'unavailable' }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }
  /** Transaction validée côté serveur/fournisseur : l'identifiant empêche un second crédit. */
  | { status: 'verified'; transactionId: string; productId: string };

/** Justificatif renvoyé par la boutique de la plateforme (à transmettre au service ; jamais une preuve de paiement par lui-même). */
export interface StoreReceipt {
  provider: 'apple' | 'google';
  productId: string;
  /** Apple : identifiant de transaction. */
  transactionId?: string;
  /** Google Play : jeton d'achat. */
  purchaseToken?: string;
}

export type StorePurchaseResult =
  | { status: 'purchased'; receipt: StoreReceipt }
  /** Paiement différé (contrôle parental, paiement en espèces…) : rien n'est crédité tant que le fournisseur ne le finalise pas. */
  | { status: 'pending'; receipt?: StoreReceipt }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export interface PaymentProvider {
  /** Vrai seulement si un fournisseur réel est configuré ET joignable. */
  isAvailable(): boolean;
  listProducts(): Promise<PremiumProduct[]>;
  purchase(productId: string): Promise<PurchaseOutcome>;
  /** Plateforme de facturation (null : aucune). */
  readonly store?: 'apple' | 'google' | null;
  /** Achat réel avec le jeton de liaison au compte fourni par le service (appAccountToken / obfuscatedAccountId). */
  buy?(productId: string, accountToken: string): Promise<StorePurchaseResult>;
  /** Transactions non terminées ou retrouvées (restauration). */
  pending?(): Promise<StoreReceipt[]>;
  /** Termine la transaction côté boutique APRÈS crédit confirmé par le service. */
  finish?(receipt: StoreReceipt): Promise<void>;
}

/** Fournisseur par défaut : aucun paiement. */
export class NullPaymentProvider implements PaymentProvider {
  readonly store = null;
  isAvailable(): boolean {
    return false;
  }
  async listProducts(): Promise<PremiumProduct[]> {
    return [];
  }
  async purchase(): Promise<PurchaseOutcome> {
    return { status: 'unavailable' };
  }
}

/** Contrat du plugin natif `PolarRiftBilling` (à implémenter côté application ; voir docs/MONETISATION.md). */
export interface BillingPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  purchase(o: { productId: string; accountToken: string }): Promise<{ status: 'purchased' | 'pending' | 'cancelled' | 'failed'; transactionId?: string; purchaseToken?: string; message?: string }>;
  pendingPurchases(): Promise<{ items: { productId: string; transactionId?: string; purchaseToken?: string }[] }>;
  finish(o: { transactionId?: string; purchaseToken?: string }): Promise<void>;
}

/** Fournisseur adossé au plugin natif (iOS : StoreKit, Android : Google Play Billing). N'est « disponible » qu'après confirmation du plugin. */
export class NativePaymentProvider implements PaymentProvider {
  private ready = false;
  readonly store: 'apple' | 'google';

  constructor(private readonly plugin: BillingPlugin, platform: 'ios' | 'android') {
    this.store = platform === 'ios' ? 'apple' : 'google';
  }

  /** Interroge le plugin (boutique joignable, achats autorisés sur l'appareil). */
  async init(): Promise<boolean> {
    try {
      this.ready = (await this.plugin.isAvailable()).available === true;
    } catch {
      this.ready = false;
    }
    return this.ready;
  }

  isAvailable(): boolean {
    return this.ready;
  }

  async listProducts(): Promise<PremiumProduct[]> {
    return [];
  }

  async purchase(): Promise<PurchaseOutcome> {
    return { status: 'unavailable' }; // l'achat passe par buy() (jeton de compte obligatoire)
  }

  private receipt(productId: string, r: { transactionId?: string; purchaseToken?: string }): StoreReceipt | undefined {
    if (this.store === 'apple' && r.transactionId) return { provider: 'apple', productId, transactionId: String(r.transactionId) };
    if (this.store === 'google' && r.purchaseToken) return { provider: 'google', productId, purchaseToken: String(r.purchaseToken) };
    return undefined;
  }

  async buy(productId: string, accountToken: string): Promise<StorePurchaseResult> {
    if (!this.ready) return { status: 'failed', message: 'Boutique indisponible sur cet appareil.' };
    try {
      const r = await this.plugin.purchase({ productId, accountToken });
      if (r.status === 'cancelled') return { status: 'cancelled' };
      if (r.status === 'failed') return { status: 'failed', message: r.message ?? 'Achat échoué.' };
      const receipt = this.receipt(productId, r);
      if (r.status === 'pending') return { status: 'pending', receipt };
      return receipt ? { status: 'purchased', receipt } : { status: 'failed', message: 'Justificatif d’achat manquant.' };
    } catch (e) {
      return { status: 'failed', message: e instanceof Error ? e.message : 'Achat échoué.' };
    }
  }

  async pending(): Promise<StoreReceipt[]> {
    if (!this.ready) return [];
    try {
      const { items } = await this.plugin.pendingPurchases();
      return items.map((i) => this.receipt(i.productId, i)).filter((r): r is StoreReceipt => !!r);
    } catch {
      return [];
    }
  }

  async finish(receipt: StoreReceipt): Promise<void> {
    try {
      await this.plugin.finish({ transactionId: receipt.transactionId, purchaseToken: receipt.purchaseToken });
    } catch {
      /* la transaction restera « non terminée » : elle sera revérifiée (idempotent) à la prochaine restauration */
    }
  }
}

let provider: PaymentProvider = new NullPaymentProvider();

export function getPaymentProvider(): PaymentProvider {
  return provider;
}

/** Point d'injection (plugin natif au démarrage, et tests). */
export function setPaymentProvider(p: PaymentProvider): void {
  provider = p;
}

/**
 * Branche le plugin natif de facturation s'il existe (application iOS / Android embarquant `PolarRiftBilling`). Sans plugin : rien ne change
 * (aucun achat). Renvoie vrai si la boutique de la plateforme est utilisable.
 */
export async function initNativePayments(): Promise<boolean> {
  const platform = nativePlatform();
  const plugin = nativePlugin<BillingPlugin>('PolarRiftBilling');
  if (!platform || !plugin) return false;
  const p = new NativePaymentProvider(plugin, platform);
  const ok = await p.init();
  if (ok) setPaymentProvider(p);
  return ok;
}

/** Les achats premium ne sont proposés que si un fournisseur réel est disponible. */
export const premiumAvailable = (): boolean => provider.isAvailable();
