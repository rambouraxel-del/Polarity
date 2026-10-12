/**
 * Paiements réels (Prismes) — INTERFACE POUR UNE FUTURE INTÉGRATION. Rien n'est actif dans cette version.
 *
 * Règles de conception :
 * - Aucun crédit de Prismes n'est possible depuis le jeu : seuls des justificatifs **validés côté serveur ou fournisseur**
 *   pourront créditer le solde (la sauvegarde locale est modifiable par le joueur : elle ne protège pas une monnaie payante).
 * - Chaque transaction a un identifiant unique (`transactionId`) ; le serveur refuse tout crédit répété du même identifiant
 *   (idempotence) et renvoie le solde de référence.
 * - Le client n'affiche « Acheter » pour un article premium que si `isAvailable()` est vrai ; sinon « Bientôt disponible ».
 * Voir docs/ECONOMIE.md.
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

export interface PaymentProvider {
  /** Vrai seulement si un fournisseur réel est configuré ET joignable. */
  isAvailable(): boolean;
  listProducts(): Promise<PremiumProduct[]>;
  purchase(productId: string): Promise<PurchaseOutcome>;
}

/** Fournisseur par défaut : aucun paiement. */
export class NullPaymentProvider implements PaymentProvider {
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

let provider: PaymentProvider = new NullPaymentProvider();

export function getPaymentProvider(): PaymentProvider {
  return provider;
}

/** Point d'injection pour une future intégration (et pour les tests). */
export function setPaymentProvider(p: PaymentProvider): void {
  provider = p;
}

/** Les achats premium ne sont proposés que si un fournisseur réel est disponible. */
export const premiumAvailable = (): boolean => provider.isAvailable();
