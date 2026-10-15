/**
 * Sauvegarde locale versionnée.
 * Une sauvegarde absente, corrompue ou un stockage indisponible ne bloque jamais le jeu :
 * on retombe sur des valeurs par défaut (et la donnée corrompue est mise de côté, pas effacée).
 */

import { ACHIEVEMENT_CONFIG } from '../config/achievements';
import { LEGACY_ACHIEVEMENT_ITEMS } from '../config/catalog';
import { MISSIONS, UPGRADES, missionKey } from '../config/campaign';
import { BONUS, LEGACY_SKIN_ACHIEVEMENTS, WALLET_MAX, WALLET_START } from '../config/economy';
import { LOYALTY, LOYALTY_LENGTH } from '../config/rewards';
import { DEFAULT_TRAIL_ID } from '../config/trails';
import type { LoyaltyState } from '../net/rewardsProtocol';
import { BALANCE_VERSION } from '../config/version';

/**
 * Versions du format :
 *  1 — v1.0 : records de Survie / défi sans notion d'équilibrage.
 *  2 — v1.1 : records rattachés à une version d'équilibrage (`balance`) ; les records d'un ancien équilibrage
 *      sont rangés dans `archive` (jamais comparés ni supprimés). Niveaux, étoiles, succès, apparences et
 *      options sont inchangés.
 *  3 — v1.5 : économie (soldes d'Éclats et de Prismes, cosmétiques possédés, traînée équipée, récompenses de niveau déjà
 *      versées). Migration : soldes à 0, cosmétiques déjà obtenus conservés, récompenses historiques marquées comme
 *      traitées (aucun crédit rétroactif).
 *  4 — v1.6 : succès récompensés (registre `rewarded`, notification `rewardNotice`) et statistiques cumulées (Éclats collectés,
 *      événements traversés, meilleur score, meilleur multiplicateur). Migration : les succès déjà obtenus sont récompensés une
 *      seule fois (Éclats ajoutés au solde, notification à l'accueil).
 *  5 — première campagne (10 missions « Écho-7 » ; jamais diffusée au-delà de la branche de développement).
 *  7 — économie v3 (comptes, synchronisation) : bloc `economy` (identifiant d'installation, compteur monotone des gains répétables, achats à
 *      confirmer, solde HÉRITÉ à importer). Migration : toute sauvegarde ≤ 6 reçoit `economy.legacy` (solde au moment de la migration) afin d'être
 *      importée INTÉGRALEMENT, une seule fois, à la première synchronisation ; la copie `polarite.save.avant-v6` est conservée. Rien d'autre ne change.
 *  6 — campagne « Douze ans de silence » (niveaux 1 à 5) : étoiles, réserve d'Éclats de campagne SÉPARÉE du portefeuille, scènes vues,
 *      améliorations prévues pour la suite. Migration : champ `campaign` remis à neuf (le contenu de la v5 ne correspond plus à l'histoire ;
 *      copie `polarite.save.avant-v5` conservée) ; tout le reste (records, monnaies, succès, cosmétiques, identité du classement) est inchangé.
 *  8 — économie v3, phase 2 : TROIS monnaies (Éclats, Médailles, Prismes), réclamation des succès (registre distinct `medals.claimed`, identifiants
 *      immuables des succès), inventaire de bonus (`inventory`) et leur comptabilité de synchronisation. Migration : les cosmétiques que les succès
 *      débloquaient directement (glace, solaire, prisme, citron, boréale) passent dans `owned` pour les succès DÉJÀ obtenus (acquis conservés, jamais
 *      re-facturés) ; les succès déjà accomplis restent réclamables rétroactivement (aucune Médaille n'est créditée sans réclamation) ; le registre
 *      `rewarded` (anciens Éclats déjà versés) et le portefeuille d'Éclats sont inchangés (aucun second versement). Nouveaux joueurs : aucun
 *      cosmétique direct par succès.
 */
export const SAVE_VERSION = 10;
export const SAVE_KEY = 'polarite.save';
export const CORRUPT_KEY = 'polarite.save.corrompue';
/** Copie de la sauvegarde telle qu'elle était avant migration (clé : préfixe + version d'origine). */
export const BACKUP_PREFIX = 'polarite.save.avant-v';
/** Copie avant changement d'équilibrage (clé : préfixe + version d'équilibrage d'origine). */
export const BALANCE_BACKUP_PREFIX = 'polarite.save.avant-eq';
/** Nombre de dates conservées pour le défi quotidien. */
export const DAILY_KEEP = 30;

export interface LevelRecord {
  completed: boolean;
  bestScore: number;
  stars: number;
}

export interface RunRecord {
  /** Meilleur temps de survie (s). */
  bestTime: number;
  /** Score associé au meilleur temps (départage les égalités). */
  bestScore: number;
  runs: number;
}

export interface Options {
  muted: boolean;
  /** Volume général (musique et effets sonores). */
  volume: number;
  /** Mixage relatif (0–1, 1 = niveau d'origine) de la musique et des effets sonores. */
  musicVolume: number;
  sfxVolume: number;
  /** Intensité de l'ambiance visuelle de la Survie (0–1, 1 = complète ; 0 = ciel étoilé seul). Décoratif. */
  visualIntensity: number;
  reducedEffects: boolean;
  tutorialSeen: boolean;
}

/** Records de Survie et de défi obtenus sous un ancien équilibrage. */
export interface ArchivedRecords {
  survival: RunRecord;
  daily: Record<string, RunRecord>;
}

/** Soldes des deux monnaies (entiers positifs). Les Prismes ne sont jamais crédités par le jeu local. */
export interface Wallet {
  /** Éclats : gagnés en jouant ; servent aux bonus. */
  shards: number;
  /** Médailles : gagnées en réclamant les succès ; servent aux cosmétiques non premium. */
  medals: number;
  /** Prismes : reflet du solde du service (jamais créés ni débités localement). */
  prisms: number;
}

/** Médailles de succès déjà RÉCLAMÉES (identifiants historiques immuables) : registre distinct de `rewarded` (anciens Éclats). */
export interface MedalsSave {
  claimed: string[];
}

/** Charges de bonus possédées (conservées entre les parties). Effets en partie : phase 3. */
export interface Inventory {
  boost: number;
  gel: number;
}

/** Récompenses de niveau déjà versées : bonus de première réussite, et nombre d'étoiles déjà rémunérées. */
export interface LevelPayout {
  first: boolean;
  stars: number;
}

/** Progression d'un niveau de campagne. Les étoiles ne se perdent jamais ; chaque passage à vrai est rémunéré une seule fois. */
export interface MissionRecord {
  /** Objectif principal atteint au moins une fois (1re étoile, niveau suivant débloqué). */
  main: boolean;
  /** Défi propre au niveau réussi (2e étoile). */
  challenge: boolean;
  /** Réussites au total. */
  clears: number;
  /** Meilleur temps de réussite (s), 0 si aucune. */
  bestTime: number;
}

/** Données de la campagne (hors cosmétiques et monnaies, qui restent dans les champs communs). */
export interface CampaignSave {
  missions: Record<string, MissionRecord>;
  /** Scènes déjà vues (config/story.ts) : jouées automatiquement une seule fois, toujours relisibles. */
  seen: string[];
  /** Réserve d'Éclats de campagne : SÉPARÉE du portefeuille de la Survie et des cosmétiques (jamais convertie). */
  reserve: number;
  /** Améliorations prévues pour la suite (hangar désactivé pour les niveaux 1 à 5). */
  upgrades: { owned: string[]; enabled: string[] };
  /** Tous les niveaux livrés sont terminés (« Suite du chapitre à venir »). */
  chapterComplete: boolean;
}

export function defaultCampaign(): CampaignSave {
  return { missions: {}, seen: [], reserve: 0, upgrades: { owned: [], enabled: [] }, chapterComplete: false };
}

/**
 * Comptabilité locale des Éclats pour la synchronisation avec le serveur (économie v3). Le portefeuille local est PROVISOIRE : le serveur reste la
 * source de vérité (voir src/economy/rules.ts). Rien ici ne crée de Prismes.
 */
export interface EconomySave {
  /** Identifiant de cette installation (jamais réutilisé après un effacement de la progression) ; vide tant que le jeu ne l'a pas attribué. */
  installId: string;
  /** Gains répétables cumulés depuis la v7 (éclat d'orbite, réussites répétées) : compteur monotone. Les récompenses uniques n'y figurent pas. */
  earned: number;
  /** Part de `earned` déjà acceptée par le serveur (filigrane). */
  confirmedEarned: number;
  /** Achats en Éclats faits depuis la v7 : article → prix payé. */
  purchases: Record<string, number>;
  /** Achats déjà reconnus par le serveur. */
  confirmedPurchases: string[];
  /** Solde d'une sauvegarde d'avant les comptes, à importer une seule fois (null : rien à importer). */
  legacy: { shards: number; imported: boolean } | null;
  /**
   * Derniers soldes CONFIRMÉS par le service (null : jamais synchronisé). Avec un service configuré, seuls ces soldes (moins les dépenses encore à
   * confirmer) financent un achat hors ligne : les gains provisoires ne se dépensent qu'après confirmation.
   */
  confirmed: { shards: number; medals: number; prisms: number } | null;
  /** Médailles déjà confirmées par le service (réclamées localement = provisoires jusqu'ici). */
  confirmedClaims: string[];
  /**
   * Un service de comptes est configuré dans cette version : les achats hors ligne ne peuvent être financés que par des soldes CONFIRMÉS.
   * Sans service (jeu purement local), tout le portefeuille local est dépensable. Renseigné par l'application à chaque démarrage.
   */
  managed: boolean;
  /** Charges de bonus achetées depuis la v8 : compteurs monotones par bonus (idempotence côté service). */
  bonusBought: Inventory;
  /** Part de `bonusBought` déjà traitée par le service (acceptée ou refusée). L'écart = charges PROVISOIRES (achetées hors ligne). */
  bonusProcessed: Inventory;
  /**
   * Charges consommées par des activations (compteur monotone). Les charges d'une partie classée envoyée avec son ticket en sont retirées (le service les
   * consomme par le rejeu) ; le reste est DÉCLARÉ au service à la synchronisation (parties non classées ou abandonnées).
   */
  bonusUsed: Inventory;
  /** Part de `bonusUsed` consommée par la partie EN COURS (pas encore tranchée : envoyée avec son ticket ou déclarée). Jamais envoyée telle quelle. */
  liveUse: Inventory;
}

export function defaultEconomy(): EconomySave {
  return {
    installId: '',
    earned: 0,
    confirmedEarned: 0,
    purchases: {},
    confirmedPurchases: [],
    legacy: null,
    confirmed: null,
    confirmedClaims: [],
    managed: false,
    bonusBought: { boost: 0, gel: 0 },
    bonusProcessed: { boost: 0, gel: 0 },
    bonusUsed: { boost: 0, gel: 0 },
    liveUse: { boost: 0, gel: 0 },
  };
}

export interface SaveData {
  version: number;
  /** Version d'équilibrage à laquelle appartiennent `survival` et `daily`. */
  balance: number;
  levels: Record<string, LevelRecord>;
  /** Records de Survie sous l'équilibrage actuel. */
  survival: RunRecord;
  /** Records du défi quotidien, par date UTC, sous l'équilibrage actuel. */
  daily: Record<string, RunRecord>;
  /** Records de Survie « avec bonus » (Boost, Gel ou Bouclier activés pendant la première vie), sous l'équilibrage actuel. Distincts de `survival` (sans bonus). */
  survivalBonus: RunRecord;
  /** Anciens équilibrages, par numéro de version : conservés à titre indicatif, non comparables. */
  archive: Record<string, ArchivedRecords>;
  /** Dernière version d'équilibrage dont le joueur a lu l'information. */
  balanceNoticeSeen: number;
  achievements: Record<string, number>;
  /** Apparence de vaisseau équipée. */
  skin: string;
  /** Traînée équipée. */
  trail: string;
  wallet: Wallet;
  /** Médailles de succès réclamées. */
  medals: MedalsSave;
  /** Charges de bonus possédées. */
  inventory: Inventory;
  /** Cosmétiques possédés (achetés ou conservés d'une version précédente), hors articles gratuits et exclusivités de succès. */
  owned: string[];
  /** Récompenses de niveau déjà versées, par niveau. */
  paid: Record<string, LevelPayout>;
  options: Options;
  /** Familles de menaces déjà présentées en Survie. */
  seenIntros: string[];
  stats: Stats;
  /** Succès dont la récompense a déjà été versée (jamais deux fois). */
  rewarded: string[];
  /** Récompenses de succès à notifier à l'accueil (rattrapage de migration, nouveaux objectifs déjà atteints) ; null une fois lue. */
  rewardNotice: { shards: number; count: number } | null;
  /** Calendrier de connexion (phase 4) : affichage seulement ; les jours, absences et récompenses appartiennent au SERVICE. */
  loyalty: LoyaltySave;
  /** Campagne. */
  campaign: CampaignSave;
  /** Comptabilité de synchronisation (économie v3). */
  economy: EconomySave;
}

/** Statistiques cumulées (servent aux objectifs des succès). */
export interface Stats {
  totalCycles: number;
  totalRuns: number;
  /** Éclats collectés sur l'orbite au total (gains, jamais le solde). */
  totalShards: number;
  /** Événements traversés au total. */
  totalEvents: number;
  bestScore: number;
  bestMultiplier: number;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Vrai si le stockage a refusé une écriture (navigation privée, quota plein, accès bloqué) : la progression n'est alors PAS conservée. */
  readonly failed?: boolean;
}

export interface LoyaltySave {
  /** Dernier jour UTC (AAAA-MM-JJ) où le calendrier s'est ouvert tout seul (une fois par jour). */
  shownDay: string;
  /** Dernier jour (horloge de l'appareil) où le jeu a été ouvert HORS LIGNE : présence provisoire, jamais créditée sans validation du service ce même jour. */
  localDay: string;
  /** Dernier état connu du service (affichage hors ligne). */
  snapshot: LoyaltyState | null;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    balance: BALANCE_VERSION,
    levels: {},
    survival: { bestTime: 0, bestScore: 0, runs: 0 },
    survivalBonus: { bestTime: 0, bestScore: 0, runs: 0 },
    daily: {},
    archive: {},
    balanceNoticeSeen: BALANCE_VERSION,
    achievements: {},
    skin: 'classique',
    trail: DEFAULT_TRAIL_ID,
    wallet: { ...WALLET_START },
    medals: { claimed: [] },
    inventory: { boost: 0, gel: 0 },
    owned: [],
    paid: {},
    options: { muted: false, volume: 0.7, musicVolume: 1, sfxVolume: 1, visualIntensity: 1, reducedEffects: false, tutorialSeen: false },
    seenIntros: [],
    stats: { totalCycles: 0, totalRuns: 0, totalShards: 0, totalEvents: 0, bestScore: 0, bestMultiplier: 0 },
    rewarded: [],
    rewardNotice: null,
    loyalty: { shownDay: '', localDay: '', snapshot: null },
    campaign: defaultCampaign(),
    economy: defaultEconomy(),
  };
}

/** Stockage du navigateur, protégé : toute erreur (mode privé, quota, refus) est absorbée. */
export class BrowserStore implements KeyValueStore {
  failed = false;

  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      if (!globalThis.localStorage) throw new Error('stockage absent');
      globalThis.localStorage.setItem(key, value);
      this.failed = false;
    } catch {
      /* stockage indisponible : la partie continue sans sauvegarde, mais le jeu le signale (`failed`) */
      this.failed = true;
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignoré */
    }
  }
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizeDaily(raw: Record<string, unknown>): Record<string, RunRecord> {
  const daily: Record<string, RunRecord> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) daily[k] = sanitizeRun(v);
  }
  pruneDaily(daily);
  return daily;
}

function sanitizeRun(v: unknown): RunRecord {
  const o = isObj(v) ? v : {};
  return {
    bestTime: num(o.bestTime, 0, 0),
    bestScore: Math.floor(num(o.bestScore, 0, 0)),
    runs: Math.floor(num(o.runs, 0, 0)),
  };
}

/** Valide champ par champ : les parties valides d'une sauvegarde abîmée sont conservées. */
export function sanitize(raw: unknown): SaveData {
  const def = defaultSave();
  if (!isObj(raw)) return def;
  const out = def;

  if (isObj(raw.levels)) {
    for (const [k, v] of Object.entries(raw.levels)) {
      if (!/^\d+$/.test(k) || !isObj(v)) continue;
      out.levels[k] = {
        completed: bool(v.completed, false),
        bestScore: Math.floor(num(v.bestScore, 0, 0)),
        stars: Math.floor(num(v.stars, 0, 0, 3)),
      };
    }
  }
  out.survival = sanitizeRun(raw.survival);
  out.survivalBonus = sanitizeRun(raw.survivalBonus);
  if (isObj(raw.daily)) out.daily = sanitizeDaily(raw.daily);
  if (isObj(raw.archive)) {
    for (const [k, v] of Object.entries(raw.archive)) {
      if (!/^\d+$/.test(k) || !isObj(v)) continue;
      out.archive[k] = { survival: sanitizeRun(v.survival), daily: isObj(v.daily) ? sanitizeDaily(v.daily) : {} };
    }
  }
  out.balanceNoticeSeen = Math.floor(num(raw.balanceNoticeSeen, BALANCE_VERSION, 0));
  // Records d'un ancien équilibrage : rangés à part, les records de l'équilibrage actuel repartent de zéro.
  const balance = Math.floor(num(raw.balance, BALANCE_VERSION, 1));
  if (balance < BALANCE_VERSION) {
    const key = String(balance);
    if (!out.archive[key]) out.archive[key] = { survival: out.survival, daily: out.daily };
    out.survival = defaultSave().survival;
    out.survivalBonus = defaultSave().survivalBonus;
    out.daily = {};
    out.balanceNoticeSeen = Math.min(out.balanceNoticeSeen, balance);
  }
  out.balance = BALANCE_VERSION;
  if (isObj(raw.achievements)) {
    for (const [k, v] of Object.entries(raw.achievements)) {
      if (typeof v === 'number' && Number.isFinite(v)) out.achievements[k] = v;
    }
  }
  if (typeof raw.skin === 'string' && raw.skin.length < 40) out.skin = raw.skin;
  if (typeof raw.trail === 'string' && raw.trail.length < 40) out.trail = raw.trail;
  if (isObj(raw.wallet)) {
    out.wallet = {
      shards: Math.floor(num(raw.wallet.shards, WALLET_START.shards, 0, WALLET_MAX)),
      medals: Math.floor(num(raw.wallet.medals, WALLET_START.medals, 0, WALLET_MAX)),
      prisms: Math.floor(num(raw.wallet.prisms, WALLET_START.prisms, 0, WALLET_MAX)),
    };
  }
  if (Array.isArray(raw.owned)) {
    const ids = raw.owned.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 40);
    out.owned = [...new Set(ids)].slice(0, 200);
  }
  if (isObj(raw.paid)) {
    for (const [k, v] of Object.entries(raw.paid)) {
      if (!/^\d+$/.test(k) || !isObj(v)) continue;
      out.paid[k] = { first: bool(v.first, false), stars: Math.floor(num(v.stars, 0, 0, 3)) };
    }
  }
  if (isObj(raw.options)) {
    const o = raw.options;
    out.options = {
      muted: bool(o.muted, def.options.muted),
      volume: num(o.volume, def.options.volume, 0, 1),
      musicVolume: num(o.musicVolume, def.options.musicVolume, 0, 1),
      sfxVolume: num(o.sfxVolume, def.options.sfxVolume, 0, 1),
      visualIntensity: num(o.visualIntensity, def.options.visualIntensity, 0, 1),
      reducedEffects: bool(o.reducedEffects, def.options.reducedEffects),
      tutorialSeen: bool(o.tutorialSeen, def.options.tutorialSeen),
    };
  }
  if (Array.isArray(raw.seenIntros)) {
    out.seenIntros = raw.seenIntros.filter((s): s is string => typeof s === 'string').slice(0, 20);
  }
  if (isObj(raw.stats)) {
    out.stats = {
      totalCycles: Math.floor(num(raw.stats.totalCycles, 0, 0)),
      totalRuns: Math.floor(num(raw.stats.totalRuns, 0, 0)),
      totalShards: Math.floor(num(raw.stats.totalShards, 0, 0)),
      totalEvents: Math.floor(num(raw.stats.totalEvents, 0, 0)),
      bestScore: Math.floor(num(raw.stats.bestScore, 0, 0)),
      bestMultiplier: Math.floor(num(raw.stats.bestMultiplier, 0, 0, 99)),
    };
  }
  if (Array.isArray(raw.rewarded)) {
    out.rewarded = [...new Set(raw.rewarded.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 40))].slice(0, 200);
  }
  if (isObj(raw.rewardNotice)) {
    const shards = Math.floor(num(raw.rewardNotice.shards, 0, 0, WALLET_MAX));
    const count = Math.floor(num(raw.rewardNotice.count, 0, 0, 999));
    out.rewardNotice = shards > 0 || count > 0 ? { shards, count } : null;
  }
  if (isObj(raw.medals) && Array.isArray(raw.medals.claimed)) {
    const known = new Set(ACHIEVEMENT_CONFIG.map((a) => a.id));
    out.medals.claimed = [...new Set(raw.medals.claimed.filter((s): s is string => typeof s === 'string' && known.has(s)))];
  }
  if (isObj(raw.inventory)) out.inventory = sanitizeCounts(raw.inventory, BONUS.maxStock);
  if (isObj(raw.campaign)) out.campaign = sanitizeCampaign(raw.campaign);
  if (isObj(raw.economy)) out.economy = sanitizeEconomy(raw.economy);
  if (isObj(raw.loyalty)) {
    out.loyalty = {
      shownDay: dateText(raw.loyalty.shownDay),
      localDay: dateText(raw.loyalty.localDay),
      snapshot: sanitizeLoyaltySnapshot(raw.loyalty.snapshot),
    };
  }
  return out;
}

function sanitizeEconomy(raw: Record<string, unknown>): EconomySave {
  const out = defaultEconomy();
  if (typeof raw.installId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw.installId)) out.installId = raw.installId;
  out.earned = Math.floor(num(raw.earned, 0, 0, 1e12));
  out.confirmedEarned = Math.min(out.earned, Math.floor(num(raw.confirmedEarned, 0, 0, 1e12)));
  if (isObj(raw.purchases)) {
    for (const [k, v] of Object.entries(raw.purchases).slice(0, 100)) {
      if (k.length > 0 && k.length < 40 && typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= WALLET_MAX) out.purchases[k] = Math.floor(v);
    }
  }
  if (Array.isArray(raw.confirmedPurchases)) {
    out.confirmedPurchases = [...new Set(raw.confirmedPurchases.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 40))].slice(0, 100);
  }
  if (isObj(raw.legacy)) out.legacy = { shards: Math.floor(num(raw.legacy.shards, 0, 0, WALLET_MAX)), imported: bool(raw.legacy.imported, false) };
  if (isObj(raw.confirmed)) {
    out.confirmed = {
      shards: Math.floor(num(raw.confirmed.shards, 0, 0, WALLET_MAX)),
      medals: Math.floor(num(raw.confirmed.medals, 0, 0, WALLET_MAX)),
      prisms: Math.floor(num(raw.confirmed.prisms, 0, 0, WALLET_MAX)),
    };
  }
  if (Array.isArray(raw.confirmedClaims)) {
    const known = new Set(ACHIEVEMENT_CONFIG.map((a) => a.id));
    out.confirmedClaims = [...new Set(raw.confirmedClaims.filter((x): x is string => typeof x === 'string' && known.has(x)))];
  }
  out.managed = bool(raw.managed, false);
  if (isObj(raw.bonusBought)) out.bonusBought = sanitizeCounts(raw.bonusBought, 1e9);
  if (isObj(raw.bonusProcessed)) out.bonusProcessed = sanitizeCounts(raw.bonusProcessed, 1e9);
  // Une charge ne peut pas avoir été traitée sans avoir été achetée
  out.bonusProcessed.boost = Math.min(out.bonusProcessed.boost, out.bonusBought.boost);
  out.bonusProcessed.gel = Math.min(out.bonusProcessed.gel, out.bonusBought.gel);
  if (isObj(raw.bonusUsed)) out.bonusUsed = sanitizeCounts(raw.bonusUsed, 1e9);
  // Une partie en cours au moment d'une fermeture brutale est abandonnée : ses charges consommées sont déclarées comme un usage non classé
  out.liveUse = { boost: 0, gel: 0 };
  return out;
}

const dateText = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/** Dernier état du calendrier connu du service : forme et bornes vérifiées (les récompenses viennent de la configuration, jamais de la sauvegarde). */
function sanitizeLoyaltySnapshot(raw: unknown): LoyaltyState | null {
  if (!isObj(raw) || !Array.isArray(raw.cycles)) return null;
  const today = dateText(raw.today);
  if (!today) return null;
  const cycles: LoyaltyState['cycles'] = [];
  for (const c of raw.cycles.slice(0, 30)) {
    if (!isObj(c) || !Array.isArray(c.days) || c.days.length !== LOYALTY_LENGTH) continue;
    const days = c.days.map((d, i) => ({ day: i + 1, reward: LOYALTY.days[i], unlocked: isObj(d) && d.unlocked === true, claimed: isObj(d) && d.claimed === true }));
    cycles.push({ id: Math.floor(num(c.id, 0, 0, 1e12)), days, current: c.current === true, absences: Math.floor(num(c.absences, 0, 0, 99)), complete: c.complete === true });
  }
  const st = isObj(raw.stock) ? raw.stock : {};
  return {
    today,
    nextDayAt: Math.floor(num(raw.nextDayAt, 0, 0, 1e15)),
    presentToday: raw.presentToday === true,
    cycles,
    absencesLeft: raw.absencesLeft === null ? null : Math.floor(num(raw.absencesLeft, 0, 0, 9)),
    claimable: Math.floor(num(raw.claimable, 0, 0, 9999)),
    canClaimPrisms: raw.canClaimPrisms === true,
    stock: { boost: Math.floor(num(st.boost, 0, 0, 9999)), gel: Math.floor(num(st.gel, 0, 0, 9999)), max: BONUS.maxStock },
  };
}

function sanitizeCounts(raw: Record<string, unknown>, max: number): Inventory {
  return { boost: Math.floor(num(raw.boost, 0, 0, max)), gel: Math.floor(num(raw.gel, 0, 0, max)) };
}

function sanitizeCampaign(raw: Record<string, unknown>): CampaignSave {
  const out = defaultCampaign();
  if (isObj(raw.missions)) {
    // Seules les clés de la nouvelle histoire (n1…) sont reconnues : les anciennes clés « 1 »…« 10 » de la première campagne sont ignorées
    const known = new Set(MISSIONS.map((m) => missionKey(m.id)));
    for (const [k, v] of Object.entries(raw.missions)) {
      if (!known.has(k) || !isObj(v)) continue;
      const main = bool(v.main, false);
      out.missions[k] = {
        main,
        // L'étoile secondaire n'a de sens qu'avec l'objectif principal
        challenge: main && bool(v.challenge, false),
        clears: Math.floor(num(v.clears, main ? 1 : 0, 0, 1e6)),
        bestTime: num(v.bestTime, 0, 0, 1e4),
      };
    }
  }
  if (Array.isArray(raw.seen)) {
    out.seen = [...new Set(raw.seen.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 40))].slice(0, 100);
  }
  if (isObj(raw.upgrades)) {
    const ids = new Set<string>(UPGRADES.map((u) => u.id));
    const pick = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && ids.has(s)))] : []);
    out.upgrades.owned = pick(raw.upgrades.owned);
    // On ne peut activer qu'une amélioration possédée
    out.upgrades.enabled = pick(raw.upgrades.enabled).filter((id) => out.upgrades.owned.includes(id));
  }
  out.reserve = Math.floor(num(raw.reserve, 0, 0, WALLET_MAX));
  // Le chapitre n'est terminé que si toutes les missions livrées sont réussies (une sauvegarde faite avec moins de niveaux n'est pas « terminée »)
  out.chapterComplete = bool(raw.chapterComplete, false) && MISSIONS.every((m) => out.missions[missionKey(m.id)]?.main === true);
  return out;
}

/** Migration des anciens formats. La validation champ par champ (sanitize) fait ensuite le tri. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = typeof raw.version === 'number' ? raw.version : 0;
  const out: Record<string, unknown> = { ...raw, version: SAVE_VERSION };
  // Avant la v2, les records n'avaient pas de notion d'équilibrage : ils appartiennent à l'équilibrage 1.
  if (v < 2) out.balance = 1;
  // Avant la v3 : pas d'économie. Soldes à 0 ; cosmétiques déjà obtenus conservés ; récompenses de niveau historiques
  // marquées comme déjà versées (aucun crédit rétroactif).
  if (v < 3) {
    const ach = isObj(raw.achievements) ? raw.achievements : {};
    const owned = Object.entries(LEGACY_SKIN_ACHIEVEMENTS)
      .filter(([, achievement]) => typeof ach[achievement] === 'number')
      .map(([id]) => id);
    out.owned = owned;
    out.wallet = { ...WALLET_START };
    out.trail = DEFAULT_TRAIL_ID;
    const paid: Record<string, LevelPayout> = {};
    if (isObj(raw.levels)) {
      for (const [k, lv] of Object.entries(raw.levels)) {
        if (!isObj(lv)) continue;
        paid[k] = { first: lv.completed === true, stars: Math.floor(num(lv.stars, 0, 0, 3)) };
      }
    }
    out.paid = paid;
  }
  // Avant la v6 : la campagne « Écho-7 » (v5) ne correspond plus à l'histoire : champ remis à neuf (copie avant-v5 conservée).
  if (v < 6) delete out.campaign;
  // Avant la v4 : succès sans récompense. Les succès déjà obtenus sont récompensés UNE fois à la migration.
  if (v < 4) {
    const ach = isObj(raw.achievements) ? raw.achievements : {};
    const earned = ACHIEVEMENT_CONFIG.filter((a) => typeof ach[a.id] === 'number');
    const total = earned.reduce((t, a) => t + a.legacyShards, 0);
    const w = isObj(out.wallet) ? out.wallet : { ...WALLET_START };
    out.wallet = { ...w, shards: Math.floor(num(w.shards, 0, 0, WALLET_MAX)) + total };
    out.rewarded = earned.map((a) => a.id);
    out.rewardNotice = earned.length > 0 ? { shards: total, count: earned.length } : null;
  }
  // Avant la v7 : pas de comptes. Le solde (après toutes les migrations ci-dessus) est mémorisé pour être importé INTÉGRALEMENT, une seule fois, à la
  // première synchronisation. Une sauvegarde déjà au format 7 ne reçoit jamais de nouvel import (idempotence).
  if (v < 7) {
    const w = isObj(out.wallet) ? out.wallet : { ...WALLET_START };
    const eco = isObj(out.economy) ? out.economy : {};
    out.economy = { ...eco, legacy: { shards: Math.floor(num(w.shards, 0, 0, WALLET_MAX)), imported: false } };
  }
  // Avant la v8 : trois monnaies. Les cosmétiques que les succès débloquaient directement sont conservés pour les succès DÉJÀ obtenus (passent dans
  // `owned`). Aucune Médaille n'est créditée ici : elles se réclament (rétroactivement) ; `rewarded` et le solde d'Éclats ne bougent pas.
  if (v < 8) {
    const ach = isObj(raw.achievements) ? raw.achievements : {};
    const owned = Array.isArray(out.owned) ? out.owned.filter((x): x is string => typeof x === 'string') : Array.isArray(raw.owned) ? raw.owned.filter((x): x is string => typeof x === 'string') : [];
    for (const [item, achievement] of Object.entries(LEGACY_ACHIEVEMENT_ITEMS)) {
      if (typeof ach[achievement] === 'number' && !owned.includes(item)) owned.push(item);
    }
    out.owned = owned;
  }
  return out;
}

export function pruneDaily(daily: Record<string, RunRecord>): void {
  const keys = Object.keys(daily).sort();
  for (let i = 0; i < keys.length - DAILY_KEEP; i++) delete daily[keys[i]];
}

export interface LoadResult {
  data: SaveData;
  status: 'new' | 'ok' | 'migrated' | 'corrupt' | 'future';
}

export function loadSave(store: KeyValueStore): LoadResult {
  const text = store.get(SAVE_KEY);
  if (text === null) return { data: defaultSave(), status: 'new' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    store.set(CORRUPT_KEY, text);
    return { data: defaultSave(), status: 'corrupt' };
  }
  if (!isObj(parsed)) {
    store.set(CORRUPT_KEY, text);
    return { data: defaultSave(), status: 'corrupt' };
  }
  if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) {
    // Sauvegarde d'une version plus récente du jeu : on lit ce qui est compatible sans écraser l'original.
    store.set(CORRUPT_KEY, text);
    return { data: sanitize(parsed), status: 'future' };
  }
  const version = typeof parsed.version === 'number' ? parsed.version : 0;
  if (version < SAVE_VERSION) {
    // Copie de sauvegarde avant migration (une seule fois, jamais écrasée)
    const backupKey = `${BACKUP_PREFIX}${version}`;
    if (store.get(backupKey) === null) store.set(backupKey, text);
    // Un ancien format peut aussi porter des records d'un ancien équilibrage : copie dédiée, comme avant
    const oldBalance = typeof parsed.balance === 'number' ? Math.floor(parsed.balance) : 1;
    if (oldBalance < BALANCE_VERSION) {
      const balanceKey = `${BALANCE_BACKUP_PREFIX}${oldBalance}`;
      if (store.get(balanceKey) === null) store.set(balanceKey, text);
    }
    return { data: sanitize(migrate(parsed)), status: 'migrated' };
  }
  // Même format, mais records d'un ancien équilibrage : copie de sécurité avant de les ranger à part
  const balance = typeof parsed.balance === 'number' ? Math.floor(parsed.balance) : BALANCE_VERSION;
  if (balance < BALANCE_VERSION) {
    const backupKey = `${BALANCE_BACKUP_PREFIX}${balance}`;
    if (store.get(backupKey) === null) store.set(backupKey, text);
    return { data: sanitize(migrate(parsed)), status: 'migrated' };
  }
  return { data: sanitize(migrate(parsed)), status: 'ok' };
}

/**
 * Lit une sauvegarde écrite par un AUTRE onglet (événement `storage`) : même validation et mêmes migrations que le chargement, sans copie
 * ni effet de bord. Renvoie null si le texte est illisible ou vient d'une version plus récente (on garde alors la progression en mémoire).
 */
export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObj(parsed)) return null;
    if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) return null;
    return sanitize(migrate(parsed));
  } catch {
    return null;
  }
}

export function writeSave(store: KeyValueStore, data: SaveData): void {
  try {
    store.set(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* ignoré */
  }
}

/** Effacement explicite et confirmé : supprime aussi les copies de sauvegarde conservées lors des migrations. */
export function eraseAll(store: KeyValueStore): void {
  const keys = [SAVE_KEY, CORRUPT_KEY];
  for (let v = 0; v <= SAVE_VERSION; v++) keys.push(`${BACKUP_PREFIX}${v}`);
  for (let b = 1; b <= 20; b++) keys.push(`${BALANCE_BACKUP_PREFIX}${b}`);
  for (const key of keys) store.remove(key);
}

/**
 * Effacement confirmé de la progression : supprime la sauvegarde et ses copies, repart d'une progression neuve en CONSERVANT les préférences
 * (son, effets réduits, intensité visuelle, astuce vue). Les autres clés du jeu (profil du classement mondial) ne sont pas touchées.
 */
export function resetProgress(store: KeyValueStore, current: SaveData): SaveData {
  eraseAll(store);
  const fresh = defaultSave();
  fresh.options = { ...current.options };
  writeSave(store, fresh);
  return fresh;
}
