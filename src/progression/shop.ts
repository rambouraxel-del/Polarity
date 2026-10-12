import { catalogItem, type CatalogItem, type Currency } from '../config/catalog';
import { trailById } from '../config/trails';
import { premiumAvailable } from '../monetization/payments';
import type { SaveData } from '../save/save';

/**
 * Boutique : propriété, état des articles, achats en Éclats, équipement.
 * Un achat débite le solde et enregistre les articles obtenus dans la même modification de la sauvegarde
 * (un seul appel d'écriture ensuite) ; l'état « possédé » empêche tout second débit.
 * Les Prismes ne sont jamais débités ni crédités ici : aucun paiement n'est actif dans cette version.
 */
export type Ownership = Pick<SaveData, 'achievements' | 'owned'>;

export function isOwned(own: Ownership, id: string): boolean {
  const item = catalogItem(id);
  if (!item) return false;
  if (item.kind === 'pack') return (item.contents ?? []).every((c) => isOwned(own, c));
  const a = item.acquire;
  if (a.type === 'default') return true;
  if (a.type === 'achievement' && own.achievements[a.id] !== undefined) return true;
  return own.owned.includes(id);
}

export function itemPrice(item: CatalogItem): { currency: Currency; amount: number } | null {
  return item.acquire.type === 'price' ? { currency: item.acquire.currency, amount: item.acquire.amount } : null;
}

export const balanceOf = (save: Pick<SaveData, 'wallet'>, currency: Currency): number => save.wallet[currency];

/**
 * Situation d'un article :
 * - owned : possédé, non équipé ; equipped : possédé et équipé ;
 * - buy : achetable avec le solde actuel ; insufficient : solde insuffisant ;
 * - achievement : exclusivité d'un succès non obtenu ; soon : article premium (Prismes), « Bientôt disponible ».
 */
export type ItemState = 'owned' | 'equipped' | 'buy' | 'insufficient' | 'achievement' | 'soon';

export function itemState(save: SaveData, item: CatalogItem): ItemState {
  if (isOwned(save, item.id)) {
    if (item.kind === 'ship' && save.skin === item.id) return 'equipped';
    if (item.kind === 'trail' && save.trail === item.id) return 'equipped';
    return 'owned';
  }
  const a = item.acquire;
  if (a.type === 'achievement') return 'achievement';
  if (a.type === 'price') {
    if (a.currency === 'prisms' && !premiumAvailable()) return 'soon';
    return balanceOf(save, a.currency) >= a.amount ? 'buy' : 'insufficient';
  }
  return 'owned';
}

export type PurchaseFailure = 'unknown' | 'owned' | 'achievement' | 'unavailable' | 'insufficient';

export type PurchaseResult =
  | { ok: true; item: CatalogItem; spent: number; granted: string[]; balance: number }
  | { ok: false; reason: PurchaseFailure };

/** Achète un article en Éclats : vérifie le solde, débite et enregistre l'obtention ensemble. Un article possédé n'est jamais débité. */
export function purchase(save: SaveData, id: string): PurchaseResult {
  const item = catalogItem(id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (isOwned(save, id)) return { ok: false, reason: 'owned' };
  const a = item.acquire;
  if (a.type === 'achievement') return { ok: false, reason: 'achievement' };
  if (a.type !== 'price') return { ok: false, reason: 'owned' };
  // Prismes : aucun paiement actif, jamais de débit local
  if (a.currency !== 'shards') return { ok: false, reason: 'unavailable' };
  if (save.wallet.shards < a.amount) return { ok: false, reason: 'insufficient' };
  const granted = item.kind === 'pack' ? (item.contents ?? []).filter((c) => !isOwned(save, c)) : [id];
  // Débit et obtention : même modification, sans étape intermédiaire
  save.wallet.shards -= a.amount;
  for (const g of granted) if (!save.owned.includes(g)) save.owned.push(g);
  return { ok: true, item, spent: a.amount, granted, balance: save.wallet.shards };
}

/** Équipe un vaisseau ou une traînée possédé. Renvoie faux si l'article est inconnu, d'un autre type ou non possédé. */
export function equip(save: SaveData, id: string): boolean {
  const item = catalogItem(id);
  if (!item || !isOwned(save, id)) return false;
  if (item.kind === 'ship') save.skin = id;
  else if (item.kind === 'trail') save.trail = trailById(id).id;
  else return false;
  return true;
}

/** Crédite des Éclats (gains de jeu). Entier positif uniquement. */
export function creditShards(save: SaveData, amount: number): number {
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  save.wallet.shards += n;
  return n;
}
