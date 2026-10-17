import { catalogItem, type Currency } from '../config/catalog';
import { BONUS_LIST, type BonusKind } from '../config/economy';
import type { SaveData } from '../save/save';

/**
 * Fonds DÉPENSABLES : séparation entre solde CONFIRMÉ par le service et gains PROVISOIRES.
 *
 * - Sans service configuré (`economy.managed` faux) : jeu purement local, tout le portefeuille est dépensable.
 * - Avec un service : un achat n'est financé que par le solde confirmé lors de la dernière synchronisation (plus le solde hérité d'une ancienne
 *   sauvegarde, que l'import acceptera), moins les dépenses déjà faites et pas encore confirmées. Les gains obtenus depuis (Éclats d'orbite,
 *   Médailles réclamées hors ligne) ne se dépensent qu'une fois confirmés : le service refuserait sinon un financement qu'il ne peut pas vérifier.
 * - Les Prismes ne se dépensent jamais localement : leur débit est fait par le service, en ligne.
 */

/** Éclats engagés dans des achats de bonus pas encore traités par le service. */
export function pendingBonusCost(save: SaveData): number {
  let total = 0;
  for (const b of BONUS_LIST) total += pendingCharges(save, b.id) * b.price;
  return total;
}

/** Charges achetées et pas encore traitées par le service (provisoires), plafonnées au stock réel. */
export function pendingCharges(save: SaveData, kind: BonusKind): number {
  const waiting = Math.max(0, save.economy.bonusBought[kind] - save.economy.bonusProcessed[kind]);
  return Math.min(waiting, save.inventory[kind]);
}

/** Montants en Médailles ou en Éclats de cosmétiques achetés et pas encore confirmés. */
function pendingItemCost(save: SaveData, currency: Currency): number {
  const confirmed = new Set(save.economy.confirmedPurchases);
  let total = 0;
  for (const [id, paid] of Object.entries(save.economy.purchases)) {
    if (confirmed.has(id)) continue;
    const a = catalogItem(id)?.acquire;
    if ((a?.type === 'price' && a.currency === currency) || (a?.type === 'choice' && currency === 'shards')) total += paid;
  }
  return total;
}

/** Fonds que l'on peut dépenser MAINTENANT dans cette monnaie (voir règles ci-dessus). */
export function spendable(save: SaveData, currency: Currency): number {
  const wallet = save.wallet[currency];
  if (currency === 'prisms') return save.economy.managed ? Math.min(wallet, save.economy.confirmed?.prisms ?? 0) : 0;
  if (!save.economy.managed) return wallet;
  const conf = save.economy.confirmed;
  const inherited = currency === 'shards' && save.economy.legacy && !save.economy.legacy.imported ? save.economy.legacy.shards : 0;
  const base = (conf?.[currency] ?? 0) + inherited;
  const pending = pendingItemCost(save, currency) + (currency === 'shards' ? pendingBonusCost(save) : 0);
  return Math.max(0, Math.min(wallet, base - pending));
}

/** Gains non confirmés (information affichée au joueur) : ce qui est dans le portefeuille mais pas encore dépensable. */
export function provisional(save: SaveData, currency: Currency): number {
  return Math.max(0, save.wallet[currency] - spendable(save, currency));
}

/**
 * Provenance des charges de bonus : confirmées par le service, ou provisoires (achetées hors ligne, en attente de confirmation). Conservée pour la
 * validation ultérieure des parties classées : une charge provisoire refusée est retirée de l'inventaire à la synchronisation.
 */
export function chargeProvenance(save: SaveData): Record<BonusKind, { confirmed: number; provisional: number }> {
  const one = (kind: BonusKind): { confirmed: number; provisional: number } => {
    const provisionalCount = pendingCharges(save, kind);
    return { confirmed: Math.max(0, save.inventory[kind] - provisionalCount), provisional: provisionalCount };
  };
  return { boost: one('boost'), gel: one('gel') };
}
