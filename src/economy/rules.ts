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
  /** Gains répétables acceptés par heure écoulée depuis la dernière synchronisation (éclat d'orbite : ≈ 12–20 par minute de jeu). */
  maxEarnPerHour: 1500,
  /** Marge ajoutée à chaque synchronisation (une partie très riche juste avant). */
  earnBurst: 500,
  /** Fenêtre d'accumulation : au-delà, le plafond ne grandit plus (une longue absence n'autorise pas un gain illimité). */
  maxWindowHours: 48,
  /** Première synchronisation d'une installation : fenêtre minimale (heures). */
  minWindowHours: 1,
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

/**
 * Récompenses uniques auxquelles une sauvegarde DONNE DROIT : succès versés (`rewarded` ET débloqués) et paliers de niveaux (`paid`).
 * Montants issus de la configuration : le client ne décide d'aucun montant. Ensemble fini (borné) : au pire, la somme de toutes les récompenses du jeu.
 */
export function entitledRewards(save: Pick<SaveData, 'rewarded' | 'achievements' | 'paid'>): OneTimeReward[] {
  const out: OneTimeReward[] = [];
  for (const a of ACHIEVEMENT_CONFIG) {
    if (save.rewarded.includes(a.id) && save.achievements[a.id] !== undefined) out.push({ ref: achievementRef(a.id), amount: a.shards });
  }
  for (const [level, p] of Object.entries(save.paid)) {
    if (!/^\d{1,3}$/.test(level)) continue;
    if (p.first) out.push({ ref: levelFirstRef(level), amount: LEVEL_REWARDS.firstClear });
    for (let k = 1; k <= Math.min(3, Math.max(0, p.stars)); k++) out.push({ ref: levelStarRef(level, k), amount: LEVEL_REWARDS.perStar });
  }
  return out;
}

/** Plafond de gains répétables acceptables, selon le temps écoulé depuis la dernière synchronisation de cette installation. */
export function earnAllowance(elapsedMs: number): number {
  const hours = Math.min(SYNC_RULES.maxWindowHours, Math.max(SYNC_RULES.minWindowHours, elapsedMs / 3_600_000));
  return Math.floor(SYNC_RULES.maxEarnPerHour * hours + SYNC_RULES.earnBurst);
}

export type PurchaseCheck = { ok: true; item: CatalogItem } | { ok: false; reason: 'unknown' | 'not_purchasable' | 'premium' | 'bad_price' };

/**
 * Vérifie un achat annoncé par le client : article du catalogue, payable en Éclats (jamais en Prismes : premium = serveur seulement),
 * prix payé = prix du catalogue ; pour un pack, entre 1 et le prix du pack (prorata de ce qui restait à obtenir).
 */
export function checkPurchase(itemId: string, paid: number): PurchaseCheck {
  const item = catalogItem(itemId);
  if (!item) return { ok: false, reason: 'unknown' };
  if (item.acquire.type !== 'price') return { ok: false, reason: 'not_purchasable' };
  if (item.acquire.currency !== 'shards') return { ok: false, reason: 'premium' };
  if (!Number.isInteger(paid) || paid < 1 || paid > item.acquire.amount) return { ok: false, reason: 'bad_price' };
  if (item.kind !== 'pack' && paid !== item.acquire.amount) return { ok: false, reason: 'bad_price' };
  return { ok: true, item };
}

/** Articles réellement accordés par un achat : le pack accorde ses contenus ; un article seul, lui-même. */
export function grantedBy(item: CatalogItem): string[] {
  return item.kind === 'pack' ? [...(item.contents ?? [])] : [item.id];
}

/** Articles payables en Prismes (premium) : jamais acceptés à partir d'une sauvegarde locale. */
export const PREMIUM_ITEMS: ReadonlySet<string> = new Set(CATALOG.filter((i) => i.acquire.type === 'price' && i.acquire.currency === 'prisms').flatMap((i) => [i.id, ...(i.contents ?? [])]));

/** Garde-fou d'un solde. */
export const clampBalance = (n: number): number => Math.max(0, Math.min(WALLET_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
