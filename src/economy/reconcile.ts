import { catalogItem } from '../config/catalog';
import { BONUS } from '../config/economy';
import { DEFAULT_TRAIL_ID } from '../config/trails';
import type { MigrateBody, PremiumPurchaseResponse, SyncBody, SyncResponse } from '../net/accountProtocol';
import type { SaveData } from '../save/save';
import { mergeSaves } from './merge';
import { PREMIUM_ITEMS, grantedBy } from './rules';

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
  return {
    installId: save.economy.installId,
    earned: save.economy.earned,
    purchases: unconfirmedPurchases(save),
    claims: [...save.medals.claimed],
    bonusBought: { ...save.economy.bonusBought },
    save: payload(save),
  };
}

export function buildMigrateBody(save: SaveData): MigrateBody {
  return { installId: save.economy.installId, save: payload(save) };
}

/** Ce qui attend encore une synchronisation (affiché dans l'écran Compte). */
export function pendingSummary(save: SaveData): { earned: number; purchases: number; legacy: boolean; claims: number; charges: number } {
  const confirmed = new Set(save.economy.confirmedClaims);
  return {
    earned: Math.max(0, save.economy.earned - save.economy.confirmedEarned),
    purchases: Object.keys(unconfirmedPurchases(save)).length,
    legacy: !!save.economy.legacy && !save.economy.legacy.imported,
    claims: save.medals.claimed.filter((id) => !confirmed.has(id)).length,
    charges: Math.max(0, save.economy.bonusBought.boost - save.economy.bonusProcessed.boost) + Math.max(0, save.economy.bonusBought.gel - save.economy.bonusProcessed.gel),
  };
}

/** Champs de progression repris de la fusion (jamais les options, le portefeuille ni le bloc de comptabilité). */
const CONTENT_KEYS = ['levels', 'survival', 'daily', 'archive', 'achievements', 'rewarded', 'owned', 'paid', 'seenIntros', 'stats', 'campaign', 'balanceNoticeSeen', 'skin', 'trail'] as const;

/**
 * Aligne la sauvegarde LOCALE (modifiée sur place) sur la réponse du serveur. `sent` = INSTANTANÉ de la sauvegarde au moment de l'envoi (pas la
 * sauvegarde vivante) : ce qui a changé localement PENDANT la requête est conservé.
 * - achats refusés : article retiré (sauf si le serveur le possède), aucun débit conservé ; achats reconnus : marqués confirmés ;
 * - Médailles : registre = celui du serveur + réclamations faites pendant la requête ; une réclamation refusée est retirée ;
 * - bonus : inventaire = celui du serveur + achats faits pendant la requête (les charges refusées disparaissent) ; compteurs traités = ceux du serveur ;
 * - progression : fusion (union / meilleur / maximum) ; soldes confirmés mémorisés ;
 * - portefeuille : solde du serveur + écart local depuis l'envoi ; Prismes = solde du serveur (jamais créés localement).
 */
export function applySyncResult(local: SaveData, res: SyncResponse, sent: SaveData, opts: { wallet?: boolean } = {}): void {
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

  // Migration héritée : aucune réclamation n'a été envoyée, la réponse ne dit rien des Médailles ; le portefeuille est aligné par la
  // synchronisation qui suit (jamais de solde provisoirement plus bas)
  local.economy.confirmed = { shards: res.balance.shards, medals: res.balance.medals, prisms: res.balance.prisms };
  if (opts.wallet === false) return;

  // Articles premium : le service seul les accorde (achat de Prismes vérifié). Un article premium que le service ne reconnaît pas — modification
  // locale de la sauvegarde — est retiré (jamais un moyen de contourner le paiement).
  for (const id of PREMIUM_ITEMS) if (!serverOwned.has(id)) local.owned = local.owned.filter((x) => x !== id);
  if (PREMIUM_ITEMS.has(local.skin) && !serverOwned.has(local.skin)) local.skin = 'classique';
  if (PREMIUM_ITEMS.has(local.trail) && !serverOwned.has(local.trail)) local.trail = DEFAULT_TRAIL_ID;

  // Médailles : le service fait foi pour ce qui a été envoyé ; les réclamations faites depuis l'envoi sont conservées
  const sentClaims = new Set(sent.medals.claimed);
  const sinceSent = local.medals.claimed.filter((id) => !sentClaims.has(id));
  local.medals.claimed = [...new Set([...res.claimed, ...sinceSent])];
  local.economy.confirmedClaims = [...res.claimed];

  local.economy.bonusProcessed = { boost: Math.min(res.bonus.boost, local.economy.bonusBought.boost), gel: Math.min(res.bonus.gel, local.economy.bonusBought.gel) };
  local.inventory = {
    boost: clamp(res.inventory.boost + (local.inventory.boost - sent.inventory.boost)),
    gel: clamp(res.inventory.gel + (local.inventory.gel - sent.inventory.gel)),
  };
  local.wallet.shards = Math.max(0, res.balance.shards + (local.wallet.shards - sent.wallet.shards));
  local.wallet.medals = Math.max(0, res.balance.medals + (local.wallet.medals - sent.wallet.medals));
  local.wallet.prisms = res.balance.prisms;
}

const clamp = (n: number): number => Math.max(0, Math.min(BONUS.maxStock, Math.floor(n)));

/**
 * Achat premium confirmé par le service : possession et soldes du service ; jamais de débit calculé localement.
 */
export function applyPremiumPurchase(local: SaveData, res: PremiumPurchaseResponse): void {
  for (const id of res.owned) if (!local.owned.includes(id)) local.owned.push(id);
  local.wallet.prisms = res.balance.prisms;
  if (local.economy.confirmed) local.economy.confirmed.prisms = res.balance.prisms;
}
