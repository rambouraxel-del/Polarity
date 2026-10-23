import { SECTOR } from '../config/balance';
import { SURVIVAL } from '../config/survival';
import { WORLD_HAZARDS, WORLD_LIST, WORLDS, localTime, nextBoundary, worldIndexAt, worldStart, type WorldDef } from '../config/worlds';
import { WORLDS_RHYTHM } from '../config/worldMusic';
import { clamp } from '../core/math';
import { smoothstep } from '../sim/difficulty';
import type { DifficultyProfile } from '../sim/director';
import { WorldsField } from '../sim/field';
import type { PatternWeights } from '../sim/patterns';

/**
 * Profil de difficulté du VOYAGE DES UNIVERS (config/worlds.ts). Équilibrage ISOLÉ : il ne modifie aucune règle de la Survie officielle,
 * du défi quotidien, des niveaux ni de la campagne. Chaque univers a sa vitesse de base, ses paliers de difficulté, ses motifs et sa mécanique ;
 * la difficulté vient surtout des situations, pas d'une vitesse toujours croissante (plafond global `WORLDS.speedCap`).
 */

const LAST = WORLD_LIST.length - 1;
const lastEnd = (): number => worldStart(LAST) + WORLDS.span;

/** Niveau lissé d'une suite de paliers [temps local, niveau] (montées sur 5 s, terminées à l'instant indiqué). */
function staged(levels: WorldDef['difficulty'], t: number): number {
  let d = levels[0][1];
  for (let i = 1; i < levels.length; i++) d += (levels[i][1] - levels[i - 1][1]) * smoothstep((t - (levels[i][0] - 5)) / 5);
  return d;
}

/** Difficulté : paliers de l'univers courant ; au-delà du dernier univers, montée lente et oscillation bornée sous `extension.dMax`. */
export function worldsDifficulty(t: number): number {
  const i = worldIndexAt(t);
  const w = WORLD_LIST[i];
  const local = localTime(t);
  const d = staged(w.difficulty, Math.min(local, WORLDS.span));
  if (i < LAST || t < lastEnd()) return d;
  const ext = WORLDS.extension;
  const over = t - lastEnd();
  const rise = (ext.dMax - d) * (1 - Math.exp(-over / ext.rise));
  return clamp(d + rise + ext.tension * Math.sin((2 * Math.PI * over) / ext.period), 0, ext.dMax);
}

/** Vitesse de base (facteur de la référence) : propre à chaque univers, plafonnée ; elle ne croît plus après le dernier univers. */
export function worldsSpeed(t: number): number {
  const i = worldIndexAt(t);
  const w = WORLD_LIST[i];
  const local = Math.min(localTime(t), WORLDS.span);
  let v = w.speed.from + (w.speed.to - w.speed.from) * smoothstep(local / (WORLDS.span * 0.85));
  if (i === LAST && t >= lastEnd()) v = WORLDS.extension.speed;
  return Math.min(WORLDS.speedCap, v);
}

export function worldsWeights(t: number): PatternWeights {
  const w = WORLD_LIST[worldIndexAt(t)];
  return w.weights(Math.min(localTime(t), WORLDS.span + 60));
}

/** Rythme des vagues : propre à l'univers, modulation lente après la phase d'installation, plus serré en fin d'univers. */
export function worldsIntervalScale(t: number): number {
  const w = WORLD_LIST[worldIndexAt(t)];
  const local = localTime(t);
  const mod = 1 + 0.1 * smoothstep((local - 30) / 20) * Math.sin((2 * Math.PI * local) / 33);
  const tight = 1 - 0.12 * smoothstep((local - 70) / 30);
  return w.interval * mod * tight;
}

export function worldsBreath(t: number) {
  return localTime(t) < 60 ? SURVIVAL.breath : SURVIVAL.intensify;
}

/** Aucune nouvelle vague à l'approche d'une faille. */
export function worldsQuiet(t: number): boolean {
  const b = nextBoundary(t);
  return Number.isFinite(b) && t >= b - WORLDS.quietBefore;
}

export function worldsProfile(shards = true): DifficultyProfile {
  return {
    difficulty: worldsDifficulty,
    weights: worldsWeights,
    intervalScale: worldsIntervalScale,
    speed: worldsSpeed,
    breath: worldsBreath,
    warnScale: SURVIVAL.warnScale,
    events: true,
    shards,
    firstWaveDelay: SURVIVAL.firstWaveDelay,
    spawnUntil: null,
    respite: true,
    worlds: true,
    quiet: worldsQuiet,
    caps: (t) => (worldIndexAt(t) === 0 ? { maxSectors: SECTOR.maxSimultaneous, maxCoverage: SECTOR.maxCoverage } : WORLD_HAZARDS.caps),
    createField: (seed) => new WorldsField(seed),
    rhythm: WORLDS_RHYTHM,
    beatChance: (t) => WORLD_LIST[worldIndexAt(t)].beatChance,
    worldEvents: (t) => WORLD_LIST[worldIndexAt(t)].events,
    eventFits: (start, end) => WORLD_LIST[worldIndexAt(start)].events && end < nextBoundary(start) - WORLDS.quietBefore,
  };
}
