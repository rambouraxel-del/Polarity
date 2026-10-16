import type { CatalogItem } from '../config/catalog';
import { PHASE_BONUS, PHASE_REWARD_SKIN } from '../config/phases';
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

/**
 * Prime d'Éclats d'une NOUVELLE phase franchie (config/phases.ts, PHASE_BONUS) : versée UNE fois par partie et par phase (registre `phaseClaims`,
 * clé « identifiant de partie:phase »), jamais pour une reprise ni une partie assistée (l'appelant l'exclut). Gain répétable : il alimente le compteur
 * monotone envoyé au service (seau à jetons) comme les éclats d'orbite. Renvoie le montant versé (0 si déjà versé ou phase sans prime).
 */
export function claimPhaseBonus(save: SaveData, runKey: string, phase: number): number {
  const amount = PHASE_BONUS[phase] ?? 0;
  const key = `${runKey}:${phase}`;
  if (amount <= 0 || !runKey || save.economy.phaseClaims.includes(key)) return 0;
  save.economy.phaseClaims = [...save.economy.phaseClaims, key].slice(-20);
  save.wallet.shards += amount;
  noteEarned(save, amount);
  return amount;
}

/** Apparence exclusive de la première traversée réussie : ajoutée UNE fois à `owned` (jamais retirée ni refacturée). Renvoie vrai si elle vient d'être obtenue. */
export function grantPhaseSkin(save: SaveData): boolean {
  if (save.owned.includes(PHASE_REWARD_SKIN)) return false;
  save.owned = [...save.owned, PHASE_REWARD_SKIN];
  return true;
}
