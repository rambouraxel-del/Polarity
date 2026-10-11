/**
 * Sauvegarde locale versionnée.
 * Une sauvegarde absente, corrompue ou un stockage indisponible ne bloque jamais le jeu :
 * on retombe sur des valeurs par défaut (et la donnée corrompue est mise de côté, pas effacée).
 */

import { BALANCE_VERSION } from '../config/version';

/**
 * Versions du format :
 *  1 — v1.0 : records de Survie / défi sans notion d'équilibrage.
 *  2 — v1.1 : records rattachés à une version d'équilibrage (`balance`) ; les records d'un ancien équilibrage
 *      sont rangés dans `archive` (jamais comparés ni supprimés). Niveaux, étoiles, succès, apparences et
 *      options sont inchangés.
 */
export const SAVE_VERSION = 2;
export const SAVE_KEY = 'polarite.save';
export const CORRUPT_KEY = 'polarite.save.corrompue';
/** Copie de la sauvegarde telle qu'elle était avant migration (clé : préfixe + version d'origine). */
export const BACKUP_PREFIX = 'polarite.save.avant-v';
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
  skin: string;
  options: Options;
  /** Familles de menaces déjà présentées en Survie. */
  seenIntros: string[];
  stats: { totalCycles: number; totalRuns: number };
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
    options: { muted: false, volume: 0.7, reducedEffects: false, tutorialSeen: false },
    seenIntros: [],
    stats: { totalCycles: 0, totalRuns: 0 },
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
    };
  }
  return out;
}

/** Migration des anciens formats. La validation champ par champ (sanitize) fait ensuite le tri. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = typeof raw.version === 'number' ? raw.version : 0;
  const out: Record<string, unknown> = { ...raw, version: SAVE_VERSION };
  // Avant la v2, les records n'avaient pas de notion d'équilibrage : ils appartiennent à l'équilibrage 1.
  if (v < 2) out.balance = 1;
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
  for (const key of [SAVE_KEY, CORRUPT_KEY, `${BACKUP_PREFIX}1`, `${BACKUP_PREFIX}0`]) store.remove(key);
}
