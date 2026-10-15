import type { SaveData } from '../save/save';

/** Réponse du service à la vérification d'un achat (`POST /api/payments/verify`) — types partagés avec server/payments.ts. */
export interface PurchaseResultDto {
  status: 'credited' | 'already_credited' | 'pending' | 'cancelled' | 'refunded';
  provider: 'apple' | 'google' | 'web';
  productId: string;
  prisms: number;
  balance: { shards: number; medals: number; prisms: number };
}

/**
 * Reflète sur la sauvegarde locale le solde de Prismes CONFIRMÉ par le service. Le jeu ne crédite jamais de Prismes de lui-même : la valeur vient
 * exclusivement de la réponse du service (registre), après vérification de la transaction auprès du fournisseur.
 */
export function applyPurchaseBalance(save: SaveData, balance: { prisms: number }): void {
  save.wallet.prisms = balance.prisms;
  if (save.economy.confirmed) save.economy.confirmed.prisms = balance.prisms;
}
