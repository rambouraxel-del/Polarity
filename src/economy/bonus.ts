import { BONUS, bonusDef, type BonusKind } from '../config/economy';
import type { SaveData } from '../save/save';
import { spendable } from './funds';

/**
 * Achat de bonus (Boost, Gel temporel) en Éclats : l'achat CRÉDITE l'inventaire, il ne consomme aucune charge (la consommation aura lieu
 * en phase 3, à une activation réussie). Les charges sont conservées entre les parties et ne sont jamais supprimées.
 * Idempotence : chaque achat incrémente un compteur monotone ; le service n'accepte que l'écart avec ce qu'il a déjà traité.
 */
export type BonusFailure = 'unknown' | 'quantity' | 'stock_full' | 'insufficient';

export type BonusResult = { ok: true; kind: BonusKind; quantity: number; spent: number; stock: number; balance: number } | { ok: false; reason: BonusFailure };

export function bonusStock(save: SaveData, kind: BonusKind): number {
  return save.inventory[kind];
}

/** Nombre maximal de charges achetables maintenant (place restante dans l'inventaire et fonds dépensables). */
export function maxAffordable(save: SaveData, kind: BonusKind): number {
  const def = bonusDef(kind);
  if (!def) return 0;
  return Math.max(0, Math.min(BONUS.maxStock - save.inventory[kind], Math.floor(spendable(save, 'shards') / def.price)));
}

export function buyBonus(save: SaveData, kind: string, quantity: number): BonusResult {
  const def = bonusDef(kind);
  if (!def) return { ok: false, reason: 'unknown' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > BONUS.maxStock) return { ok: false, reason: 'quantity' };
  if (save.inventory[def.id] + quantity > BONUS.maxStock) return { ok: false, reason: 'stock_full' };
  const cost = def.price * quantity;
  if (spendable(save, 'shards') < cost) return { ok: false, reason: 'insufficient' };
  // Débit et crédit d'inventaire dans la même modification de la sauvegarde
  save.wallet.shards -= cost;
  save.inventory[def.id] += quantity;
  save.economy.bonusBought[def.id] += quantity;
  return { ok: true, kind: def.id, quantity, spent: cost, stock: save.inventory[def.id], balance: save.wallet.shards };
}

/**
 * Crédite des charges SANS achat dans l'inventaire LOCAL (jeu sans service) : même inventaire, plafonné au stock maximal ; ne touche pas aux
 * compteurs d'achat. Avec un service, l'inventaire est le reflet du registre : une charge offerte (calendrier de connexion futur) doit alors être
 * créditée PAR LE SERVICE (ligne du registre en monnaie `boost` / `gel`, clé unique) ; un crédit purement local serait écrasé à la synchronisation.
 */
export function grantCharges(save: SaveData, kind: BonusKind, quantity: number): number {
  const n = Math.max(0, Math.min(Math.floor(quantity), BONUS.maxStock - save.inventory[kind]));
  save.inventory[kind] += n;
  return n;
}
