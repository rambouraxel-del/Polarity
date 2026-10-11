/**
 * Sauvegarde locale versionnée.
 * Une sauvegarde absente, corrompue ou un stockage indisponible ne bloque jamais le jeu :
 * on retombe sur des valeurs par défaut (et la donnée corrompue est mise de côté, pas effacée).
 */

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'polarite.save';
export const CORRUPT_KEY = 'polarite.save.corrompue';
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

export interface SaveData {
  version: number;
  levels: Record<string, LevelRecord>;
  survival: RunRecord;
  daily: Record<string, RunRecord>;
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
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    levels: {},
    survival: { bestTime: 0, bestScore: 0, runs: 0 },
    daily: {},
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
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  if (isObj(raw.daily)) {
    for (const [k, v] of Object.entries(raw.daily)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out.daily[k] = sanitizeRun(v);
    }
    pruneDaily(out.daily);
  }
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

/** Migration des anciens formats (aucun pour l'instant : la version 1 est la première). */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = typeof raw.version === 'number' ? raw.version : 0;
  if (v < 1) {
    // Format sans version : tenté tel quel, la validation fait le tri.
  }
  return { ...raw, version: SAVE_VERSION };
}

export function pruneDaily(daily: Record<string, RunRecord>): void {
  const keys = Object.keys(daily).sort();
  for (let i = 0; i < keys.length - DAILY_KEEP; i++) delete daily[keys[i]];
}

export interface LoadResult {
  data: SaveData;
  status: 'new' | 'ok' | 'corrupt' | 'future';
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
  return { data: sanitize(migrate(parsed)), status: 'ok' };
}

export function writeSave(store: KeyValueStore, data: SaveData): void {
  try {
    store.set(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* ignoré */
  }
}
