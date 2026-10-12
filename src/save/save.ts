/**
 * Sauvegarde locale versionnée.
 * Une sauvegarde absente, corrompue ou un stockage indisponible ne bloque jamais le jeu :
 * on retombe sur des valeurs par défaut (et la donnée corrompue est mise de côté, pas effacée).
 */

import { ACHIEVEMENT_CONFIG } from '../config/achievements';
import { LEGACY_SKIN_ACHIEVEMENTS, WALLET_MAX, WALLET_START } from '../config/economy';
import { DEFAULT_TRAIL_ID } from '../config/trails';
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
 */
export const SAVE_VERSION = 4;
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
  volume: number;
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
  shards: number;
  prisms: number;
}

/** Récompenses de niveau déjà versées : bonus de première réussite, et nombre d'étoiles déjà rémunérées. */
export interface LevelPayout {
  first: boolean;
  stars: number;
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
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    balance: BALANCE_VERSION,
    levels: {},
    survival: { bestTime: 0, bestScore: 0, runs: 0 },
    daily: {},
    archive: {},
    balanceNoticeSeen: BALANCE_VERSION,
    achievements: {},
    skin: 'classique',
    trail: DEFAULT_TRAIL_ID,
    wallet: { ...WALLET_START },
    owned: [],
    paid: {},
    options: { muted: false, volume: 0.7, reducedEffects: false, tutorialSeen: false },
    seenIntros: [],
    stats: { totalCycles: 0, totalRuns: 0, totalShards: 0, totalEvents: 0, bestScore: 0, bestMultiplier: 0 },
    rewarded: [],
    rewardNotice: null,
  };
}

/** Stockage du navigateur, protégé : toute erreur (mode privé, quota, refus) est absorbée. */
export class BrowserStore implements KeyValueStore {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* stockage indisponible : la partie continue sans sauvegarde */
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
  // Avant la v4 : succès sans récompense. Les succès déjà obtenus sont récompensés UNE fois à la migration.
  if (v < 4) {
    const ach = isObj(raw.achievements) ? raw.achievements : {};
    const earned = ACHIEVEMENT_CONFIG.filter((a) => typeof ach[a.id] === 'number');
    const total = earned.reduce((t, a) => t + a.shards, 0);
    const w = isObj(out.wallet) ? out.wallet : { ...WALLET_START };
    out.wallet = { ...w, shards: Math.floor(num(w.shards, 0, 0, WALLET_MAX)) + total };
    out.rewarded = earned.map((a) => a.id);
    out.rewardNotice = earned.length > 0 ? { shards: total, count: earned.length } : null;
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

export function writeSave(store: KeyValueStore, data: SaveData): void {
  try {
    store.set(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* ignoré */
  }
}

/** Effacement explicite et confirmé : supprime aussi les copies de sauvegarde conservées lors des migrations. */
export function eraseAll(store: KeyValueStore): void {
  const keys = [SAVE_KEY, CORRUPT_KEY, `${BACKUP_PREFIX}3`, `${BACKUP_PREFIX}2`, `${BACKUP_PREFIX}1`, `${BACKUP_PREFIX}0`];
  for (let b = 1; b <= 20; b++) keys.push(`${BALANCE_BACKUP_PREFIX}${b}`);
  for (const key of keys) store.remove(key);
}
