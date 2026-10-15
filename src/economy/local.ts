import type { CatalogItem } from '../config/catalog';
import type { SaveData } from '../save/save';

/**
 * Points d'enregistrement de la comptabilité LOCALE (économie v3). Appelés au moment même du crédit ou de l'achat, dans la même modification
 * de la sauvegarde. Aucun gain en Prismes n'existe ici.
 */

/** Gain répétable (éclat d'orbite, réussite répétée d'un niveau) : alimente le compteur monotone envoyé au serveur. */
export function noteEarned(save: SaveData, amount: number): void {
  const n = Math.floor(amount);
  if (Number.isFinite(n) && n > 0) save.economy.earned += n;
}

/** Achat en Éclats : mémorisé (article → prix payé) jusqu'à sa confirmation par le serveur. */
export function notePurchase(save: SaveData, item: CatalogItem, paid: number): void {
  save.economy.purchases[item.id] = Math.max(1, Math.floor(paid));
  save.economy.confirmedPurchases = save.economy.confirmedPurchases.filter((id) => id !== item.id);
}
