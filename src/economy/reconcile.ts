import { catalogItem } from '../config/catalog';
import type { MigrateBody, SyncBody, SyncResponse } from '../net/accountProtocol';
import type { SaveData } from '../save/save';
import { mergeSaves } from './merge';
import { grantedBy } from './rules';

/**
 * Construction des requêtes de synchronisation et ALIGNEMENT de la sauvegarde locale sur la réponse du serveur — fonctions pures, testées.
 * Le serveur est la source de vérité des monnaies ; le portefeuille local reste provisoire (gains et dépenses faits hors ligne).
 */

/** Sauvegarde envoyée : sans les préférences de l'appareil (options) ni données inutiles au serveur. */
function payload(save: SaveData): Record<string, unknown> {
  const out = structuredClone(save) as unknown as Record<string, unknown>;
  delete out.options;
  delete out.rewardNotice;
  return out;
}

/** Achats faits localement et pas encore reconnus par le serveur. */
export function unconfirmedPurchases(save: SaveData): Record<string, number> {
  const confirmed = new Set(save.economy.confirmedPurchases);
  return Object.fromEntries(Object.entries(save.economy.purchases).filter(([id]) => !confirmed.has(id)));
}

export function buildSyncBody(save: SaveData): SyncBody {
  return { installId: save.economy.installId, earned: save.economy.earned, purchases: unconfirmedPurchases(save), save: payload(save) };
}

export function buildMigrateBody(save: SaveData): MigrateBody {
  return { installId: save.economy.installId, save: payload(save) };
}

/** Ce qui attend encore une synchronisation (affiché dans l'écran Compte). */
export function pendingSummary(save: SaveData): { earned: number; purchases: number; legacy: boolean } {
  return {
    earned: Math.max(0, save.economy.earned - save.economy.confirmedEarned),
    purchases: Object.keys(unconfirmedPurchases(save)).length,
    legacy: !!save.economy.legacy && !save.economy.legacy.imported,
  };
}

/** Champs de progression repris de la fusion (jamais les options, le portefeuille ni le bloc de comptabilité). */
const CONTENT_KEYS = ['levels', 'survival', 'daily', 'archive', 'achievements', 'rewarded', 'owned', 'paid', 'seenIntros', 'stats', 'campaign', 'balanceNoticeSeen', 'skin', 'trail'] as const;

/**
 * Aligne la sauvegarde LOCALE (modifiée sur place) sur la réponse du serveur :
 * - achats refusés : article retiré (sauf si le serveur le possède), aucun débit conservé ;
 * - achats reconnus : marqués confirmés ; filigrane des gains mis à jour ;
 * - progression : fusion (union / meilleur / maximum) avec la sauvegarde du serveur ;
 * - portefeuille : solde du serveur + ce qui a changé localement PENDANT la requête (`sentWallet` = solde au moment de l'envoi) ; Prismes = solde du serveur.
 */
export function applySyncResult(local: SaveData, res: SyncResponse, sentWallet: number, opts: { wallet?: boolean } = {}): void {
  const serverOwned = new Set(res.save.owned);
  for (const r of res.rejected) {
    const item = catalogItem(r.item);
    if (item) for (const g of grantedBy(item)) if (!serverOwned.has(g)) local.owned = local.owned.filter((id) => id !== g);
    delete local.economy.purchases[r.item];
    local.economy.confirmedPurchases = local.economy.confirmedPurchases.filter((id) => id !== r.item);
  }
  for (const a of res.acknowledged) {
    delete local.economy.purchases[a.item];
    if (!local.economy.confirmedPurchases.includes(a.item)) local.economy.confirmedPurchases.push(a.item);
  }
  local.economy.confirmedPurchases = local.economy.confirmedPurchases.slice(-100);
  local.economy.confirmedEarned = Math.min(local.economy.earned, Math.max(local.economy.confirmedEarned, res.watermark));

  const merged = mergeSaves(local, res.save);
  const target = local as unknown as Record<string, unknown>;
  const source = merged as unknown as Record<string, unknown>;
  for (const k of CONTENT_KEYS) target[k] = source[k];

  // Migration héritée : le portefeuille est aligné par la synchronisation qui suit (jamais de solde provisoirement plus bas)
  if (opts.wallet === false) return;
  const delta = local.wallet.shards - sentWallet;
  local.wallet.shards = Math.max(0, res.balance.shards + delta);
  local.wallet.prisms = res.balance.prisms;
}
