import { ACHIEVEMENT_CONFIG } from '../config/achievements';
import { CATALOG, catalogItem, type CatalogItem } from '../config/catalog';
import { LEVEL_REWARDS, WALLET_MAX } from '../config/economy';
import type { SaveData } from '../save/save';

/**
 * Règles de l'économie synchronisée — SOURCE UNIQUE partagée par le jeu et le service (même code, même résultat).
 * Les valeurs (plafonds, limites d'import) sont ici ; aucun réglage de monnaie n'est codé ailleurs.
 *
 * Modèle : le solde d'Éclats du SERVEUR est la somme du registre (`ledger`) ; chaque ligne porte une clé d'idempotence (`ref`) unique par profil.
 * Le portefeuille local est provisoire jusqu'à la synchronisation. Les Prismes ne sont JAMAIS crédités à partir de données du client.
 */
export const SYNC_RULES = {
  /**
   * Gains répétables : SEAU À JETONS par installation. Capacité (rafale acceptée à la première synchronisation ou après une longue absence) et
   * rechargement par heure (éclat d'orbite : ≈ 12–20 Éclats par minute de jeu). Le seau se recharge avec le TEMPS, pas avec le nombre de synchronisations :
   * répéter des requêtes ne crée rien.
   */
  earnBucketCap: 3000,
  earnRefillPerHour: 1500,
  /** Installations héritées (anciennes sauvegardes) importables par profil. */
  maxLegacyImports: 3,
  /** Taille maximale d'une sauvegarde envoyée (octets). */
  maxSaveBytes: 256 * 1024,
  /** Achats acceptés par synchronisation. */
  maxPurchasesPerSync: 20,
} as const;

/** Récompense unique (une seule fois par profil, jamais répétée) : clé d'idempotence et montant fixés par la configuration du jeu. */
export interface OneTimeReward {
  ref: string;
  amount: number;
}

export const achievementRef = (id: string): string => `ach:${id}`;
export const levelFirstRef = (level: string): string => `lvl:${level}:first`;
export const levelStarRef = (level: string, k: number): string => `lvl:${level}:star${k}`;
export const importRef = (installId: string): string => `import:${installId}`;
export const earnRef = (installId: string, watermark: number): string => `earn:${installId}:${watermark}`;
export const spendRef = (item: string): string => `spend:${item}`;
/** Médaille d'un succès : une seule ligne par profil et par succès (identifiant historique immuable). */
export const medalRef = (achievementId: string): string => `medal:${achievementId}`;
/** Charges de bonus acquises par une installation jusqu'au compteur `watermark` : `:pay` (débit d'Éclats) et `:grant` (crédit d'inventaire). */
export const bonusRef = (kind: string, installId: string, watermark: number, part: 'pay' | 'grant'): string => `bonus:${kind}:${installId}:${watermark}:${part}`;

/**
 * Récompenses uniques auxquelles une sauvegarde DONNE DROIT : succès versés (`rewarded` ET débloqués) et paliers de niveaux (`paid`).
 * Montants issus de la configuration : le client ne décide d'aucun montant. Ensemble fini (borné) : au pire, la somme de toutes les récompenses du jeu.
 */
export function entitledRewards(save: Pick<SaveData, 'rewarded' | 'achievements' | 'paid'>): OneTimeReward[] {
  const out: OneTimeReward[] = [];
  for (const a of ACHIEVEMENT_CONFIG) {
    if (save.rewarded.includes(a.id) && save.achievements[a.id] !== undefined) out.push({ ref: achievementRef(a.id), amount: a.legacyShards });
  }
  for (const [level, p] of Object.entries(save.paid)) {
    if (!/^\d{1,3}$/.test(level)) continue;
    if (p.first) out.push({ ref: levelFirstRef(level), amount: LEVEL_REWARDS.firstClear });
    for (let k = 1; k <= Math.min(3, Math.max(0, p.stars)); k++) out.push({ ref: levelStarRef(level, k), amount: LEVEL_REWARDS.perStar });
  }
  return out;
}

/** Seau à jetons : contenu après `elapsedMs` de rechargement (jamais au-delà de la capacité). */
export function refillBucket(bucket: number, elapsedMs: number): number {
  const refill = (SYNC_RULES.earnRefillPerHour * Math.max(0, elapsedMs)) / 3_600_000;
  return Math.min(SYNC_RULES.earnBucketCap, Math.max(0, bucket) + Math.floor(refill));
}

export type PurchaseCheck = { ok: true; item: CatalogItem; currency: 'shards' | 'medals'; price: number } | { ok: false; reason: 'unknown' | 'not_purchasable' | 'premium' | 'bad_price' };

/**
 * Vérifie un achat DIFFÉRÉ annoncé par le client (hors ligne ou en attente) : article du catalogue, payable en Éclats ou en Médailles (jamais en
 * Prismes : un article premium n'est débité qu'en ligne, par le service, sur demande directe), prix annoncé = prix du catalogue.
 * Le service débite TOUJOURS le prix du catalogue, jamais le montant annoncé.
 */
export function checkPurchase(itemId: string, paid: number): PurchaseCheck {
  const item = catalogItem(itemId);
  if (!item) return { ok: false, reason: 'unknown' };
  // Achat au choix : la voie différée est celle des Éclats (le prix en Prismes ne se paie qu'en ligne, par le service)
  if (item.acquire.type === 'choice') {
    if (!Number.isInteger(paid) || paid !== item.acquire.shards) return { ok: false, reason: 'bad_price' };
    return { ok: true, item, currency: 'shards', price: item.acquire.shards };
  }
  if (item.acquire.type !== 'price') return { ok: false, reason: 'not_purchasable' };
  if (item.acquire.currency === 'prisms') return { ok: false, reason: 'premium' };
  if (!Number.isInteger(paid) || paid !== item.acquire.amount) return { ok: false, reason: 'bad_price' };
  return { ok: true, item, currency: item.acquire.currency, price: item.acquire.amount };
}

/** Articles réellement accordés par un achat : le pack accorde ses contenus ; un article seul, lui-même. */
export function grantedBy(item: CatalogItem): string[] {
  return item.kind === 'pack' ? [...(item.contents ?? [])] : [item.id];
}

/** Articles payables en Prismes (premium) : jamais acceptés à partir d'une sauvegarde locale. */
export const PREMIUM_ITEMS: ReadonlySet<string> = new Set(CATALOG.filter((i) => i.acquire.type === 'price' && i.acquire.currency === 'prisms').flatMap((i) => [i.id, ...(i.contents ?? [])]));

/** Garde-fou d'un solde. */
export const clampBalance = (n: number): number => Math.max(0, Math.min(WALLET_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
