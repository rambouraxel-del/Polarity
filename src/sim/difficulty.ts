import { CAPS, DIFFICULTY_RANGE, lerp } from '../config/balance';
import { clamp } from '../core/math';

/** Paramètres concrets d'une vague, dérivés d'un niveau de difficulté d ∈ [0, 1]. */
export interface DifficultyParams {
  d: number;
  waveInterval: number;
  projectileWarn: number;
  sectorWarn: number;
  projectileSpeed: number;
  sectorActive: number;
  sectorHalfWidth: number;
  comboStagger: number;
  maxHazards: number;
}

type RangeKey = keyof typeof DIFFICULTY_RANGE;

function at(key: RangeKey, d: number): number {
  const r = DIFFICULTY_RANGE[key];
  return lerp(r.easy, r.hard, d);
}

/**
 * @param warnScale réduction des annonces (1 = inchangé) ; les planchers de CAPS s'appliquent toujours.
 */
export function paramsFor(dRaw: number, out?: DifficultyParams, warnScale = 1): DifficultyParams {
  const d = clamp(dRaw, 0, 1);
  const p = out ?? ({} as DifficultyParams);
  p.d = d;
  p.waveInterval = Math.max(CAPS.minWaveInterval, at('waveInterval', d));
  p.projectileWarn = Math.max(CAPS.minProjectileWarn, at('projectileWarn', d) * warnScale);
  p.sectorWarn = Math.max(CAPS.minSectorWarn, at('sectorWarn', d) * warnScale);
  p.projectileSpeed = Math.min(CAPS.maxProjectileSpeed, at('projectileSpeed', d));
  p.sectorActive = at('sectorActive', d);
  p.sectorHalfWidth = at('sectorHalfWidth', d);
  p.comboStagger = at('comboStagger', d);
  p.maxHazards = Math.min(CAPS.maxActiveHazards, Math.round(at('maxHazards', d)));
  return p;
}

export function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
