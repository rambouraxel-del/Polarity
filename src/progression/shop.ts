import { catalogItem, type CatalogItem, type Currency } from '../config/catalog';
import { TRAILS_ENABLED, trailById } from '../config/trails';
import { noteEarned, notePurchase } from '../economy/local';
import { spendable } from '../economy/funds';
import { isUnknownToService } from '../net/serviceState';
import type { SaveData } from '../save/save';

/**
 * Boutique : propriété, état des articles, achats en Médailles, équipement.
 * Un achat débite le solde et enregistre les articles obtenus dans la même modification de la sauvegarde
 * (un seul appel d'écriture ensuite) ; l'état « possédé » empêche tout second débit.
 * Cosmétiques : Médailles (non premium), ou au choix Éclats / Prismes (`choice`) ; les Éclats servent aussi aux bonus (economy/bonus.ts).
 * Les Prismes ne sont JAMAIS débités ni crédités ici : l'achat d'un article premium est une requête au service (account/AccountService.ts).
 */
export type Ownership = Pick<SaveData, 'owned'>;

export function isOwned(own: Ownership, id: string): boolean {
  const item = catalogItem(id);
  if (!item) return false;
  if (item.kind === 'pack') return (item.contents ?? []).every((c) => isOwned(own, c));
  if (item.acquire.type === 'default') return true;
  return own.owned.includes(id);
}

export interface Price {
  currency: Currency;
  amount: number;
}

/** Façons de payer un article : une seule monnaie (`price`), deux au choix (`choice` : Éclats puis Prismes) ou aucune. */
export function priceOptions(item: CatalogItem): Price[] {
  const a = item.acquire;
  if (a.type === 'price') return [{ currency: a.currency, amount: a.amount }];
  if (a.type === 'choice') return [{ currency: 'shards', amount: a.shards }, { currency: 'prisms', amount: a.prisms }];
  return [];
}

/** Prix principal (une seule monnaie, ou la première option d'un achat au choix). */
export function itemPrice(item: CatalogItem): Price | null {
  return priceOptions(item)[0] ?? null;
}

/**
 * Prix réellement demandé pour un article. Un pack dont une partie est déjà possédée est facturé AU PRORATA de ce qu'il reste à obtenir
 * (même remise que le pack complet) : on ne repaie jamais un article déjà possédé. Les autres articles gardent leur prix du catalogue.
 */
export function effectivePrice(own: Ownership, item: CatalogItem, currency?: Currency): Price | null {
  const base = currency ? priceOptions(item).find((p) => p.currency === currency) ?? null : itemPrice(item);
  if (!base || item.kind !== 'pack') return base;
  const parts = (item.contents ?? []).map((id) => catalogItem(id)).filter((c): c is CatalogItem => !!c);
  const priced = (c: CatalogItem): number => {
    const p = priceOptions(c).find((o) => o.currency === base.currency);
    return p ? p.amount : 0;
  };
  const total = parts.reduce((t, c) => t + priced(c), 0);
  const left = parts.filter((c) => !isOwned(own, c.id)).reduce((t, c) => t + priced(c), 0);
  if (total <= 0 || left >= total) return base;
  return { currency: base.currency, amount: Math.max(1, Math.round((base.amount * left) / total)) };
}

export const balanceOf = (save: Pick<SaveData, 'wallet'>, currency: Currency): number => save.wallet[currency];

/**
 * Situation d'un article :
 * - owned : possédé, non équipé ; equipped : possédé et équipé ;
 * - buy : achetable maintenant (fonds dépensables suffisants) ; insufficient : fonds insuffisants ;
 * - soon : article premium alors qu'aucun service de comptes n'est configuré (« Bientôt disponible ») ;
 * - locked : récompense à obtenir en jouant (jamais achetable) ;
 * - unavailable : non proposé pour l'instant (apparence indisponible, catégorie Traînées fermée) ;
 * - stale : le service en ligne ne connaît pas encore cet article (service pas à jour) : achat bloqué, rien n'est débité.
 */
export type ItemState = 'owned' | 'equipped' | 'buy' | 'insufficient' | 'soon' | 'locked' | 'unavailable' | 'stale';

/** Peut-on payer cette option MAINTENANT ? (Prismes : seulement avec un service de comptes et un solde confirmé.) */
export function canPay(save: SaveData, item: CatalogItem, currency: Currency): boolean {
  const p = priceOptions(item).find((o) => o.currency === currency);
  if (!p) return false;
  if (p.currency === 'prisms' && !save.economy.managed) return false;
  const due = effectivePrice(save, item, p.currency) ?? p;
  return spendable(save, due.currency) >= due.amount;
}

export function itemState(save: SaveData, item: CatalogItem): ItemState {
  // Catégorie Traînées fermée : aucune interaction, même pour une traînée déjà possédée
  if (item.kind === 'trail' && !TRAILS_ENABLED) return 'unavailable';
  if (isOwned(save, item.id)) {
    if (item.kind === 'ship' && save.skin === item.id) return 'equipped';
    if (item.kind === 'trail' && save.trail === item.id) return 'equipped';
    return 'owned';
  }
  const a = item.acquire;
  if ((a.type === 'price' || a.type === 'choice') && save.economy.managed && isUnknownToService(item.id)) return 'stale';
  if (a.type === 'price') {
    if (a.currency === 'prisms' && !save.economy.managed) return 'soon';
    return canPay(save, item, a.currency) ? 'buy' : 'insufficient';
  }
  if (a.type === 'choice') return priceOptions(item).some((p) => canPay(save, item, p.currency)) ? 'buy' : 'insufficient';
  if (a.type === 'reward') return 'locked';
  if (a.type === 'unavailable') return 'unavailable';
  return 'owned';
}

export type PurchaseFailure = 'unknown' | 'owned' | 'unavailable' | 'premium' | 'insufficient';

export type PurchaseResult =
  | { ok: true; item: CatalogItem; currency: Currency; spent: number; granted: string[]; balance: number }
  | { ok: false; reason: PurchaseFailure };

/**
 * Achète un cosmétique non premium (Médailles) : vérifie les fonds DÉPENSABLES (solde confirmé, hors gains provisoires quand un service est
 * configuré), débite et enregistre l'obtention ensemble. Un article possédé n'est jamais débité.
 * Article premium (Prismes) : refusé ici (`premium`) — le débit est fait par le service, en ligne.
 */
export function purchase(save: SaveData, id: string, currency?: Currency): PurchaseResult {
  const item = catalogItem(id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (item.kind === 'trail' && !TRAILS_ENABLED) return { ok: false, reason: 'unavailable' };
  if (isOwned(save, id)) return { ok: false, reason: 'owned' };
  const a = item.acquire;
  if (a.type === 'reward' || a.type === 'unavailable') return { ok: false, reason: 'unavailable' };
  if (a.type === 'default') return { ok: false, reason: 'owned' };
  // Service resté sur un ancien catalogue : il annulerait l'achat à la synchronisation (jamais de débit « fantôme »)
  if (save.economy.managed && isUnknownToService(id)) return { ok: false, reason: 'unavailable' };
  // Achat au choix : la monnaie demandée doit faire partie des options (Éclats par défaut)
  const opts = priceOptions(item);
  const cur = currency ?? opts[0].currency;
  const opt = opts.find((p) => p.currency === cur);
  if (!opt) return { ok: false, reason: 'unavailable' };
  if (opt.currency === 'prisms') return { ok: false, reason: save.economy.managed ? 'premium' : 'unavailable' };
  const due = effectivePrice(save, item, opt.currency)?.amount ?? opt.amount;
  if (!Number.isFinite(save.wallet[opt.currency]) || spendable(save, opt.currency) < due) return { ok: false, reason: 'insufficient' };
  const granted = item.kind === 'pack' ? (item.contents ?? []).filter((c) => !isOwned(save, c)) : [id];
  // Débit et obtention : même modification, sans étape intermédiaire
  save.wallet[opt.currency] -= due;
  for (const g of granted) if (!save.owned.includes(g)) save.owned.push(g);
  notePurchase(save, item, due);
  return { ok: true, item, currency: opt.currency, spent: due, granted, balance: save.wallet[opt.currency] };
}

/** Équipe un vaisseau ou une traînée possédé. Renvoie faux si l'article est inconnu, d'un autre type ou non possédé. */
export function equip(save: SaveData, id: string): boolean {
  const item = catalogItem(id);
  if (!item || !isOwned(save, id)) return false;
  if (item.kind === 'ship') save.skin = id;
  else if (item.kind === 'trail' && TRAILS_ENABLED) save.trail = trailById(id).id;
  else return false;
  return true;
}

/** Crédite des Éclats (gains de jeu). Entier positif uniquement. */
export function creditShards(save: SaveData, amount: number): number {
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  save.wallet.shards += n;
  noteEarned(save, n);
  return n;
}
