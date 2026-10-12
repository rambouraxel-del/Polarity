import { CAPS, DIFFICULTY_RANGE, lerp } from '../config/balance';
import { PACE, paceFactor } from '../config/playerSpeed';
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
  laserWarn: number;
  laserRate: number;
  laserSpan: number;
}

type RangeKey = keyof typeof DIFFICULTY_RANGE;

function at(key: RangeKey, d: number): number {
  const r = DIFFICULTY_RANGE[key];
  return lerp(r.easy, r.hard, d);
}

export interface ParamOptions {
  /** Réduction des annonces (1 = inchangé). Les planchers de CAPS s'appliquent toujours. */
  warnScale?: number;
  /** Facteur de vitesse du vaisseau (1 = référence) : allonge annonces, décalages et intervalles quand le vaisseau est lent. */
  speed?: number;
}

/**
 * Paramètres concrets d'une vague pour la difficulté `dRaw`, adaptés à la vitesse réelle du joueur.
 * Un nombre en 3e argument est interprété comme `warnScale` (compatibilité).
 */
export function paramsFor(dRaw: number, out?: DifficultyParams, opts: ParamOptions | number = {}): DifficultyParams {
  const o: ParamOptions = typeof opts === 'number' ? { warnScale: opts } : opts;
  const warnScale = o.warnScale ?? 1;
  const m = o.speed ?? 1;
  const warnK = warnScale * paceFactor(m, PACE.warn);
  const d = clamp(dRaw, 0, 1);
  const p = out ?? ({} as DifficultyParams);
  p.d = d;
  p.waveInterval = Math.max(CAPS.minWaveInterval, at('waveInterval', d) * paceFactor(m, PACE.interval));
  p.projectileWarn = Math.max(CAPS.minProjectileWarn, at('projectileWarn', d) * warnK);
  p.sectorWarn = Math.max(CAPS.minSectorWarn, at('sectorWarn', d) * warnK);
  p.laserWarn = Math.max(CAPS.minLaserWarn, at('laserWarn', d) * warnK);
  p.projectileSpeed = Math.min(CAPS.maxProjectileSpeed, at('projectileSpeed', d));
  p.sectorActive = at('sectorActive', d);
  p.sectorHalfWidth = at('sectorHalfWidth', d) / paceFactor(m, PACE.width);
  p.comboStagger = at('comboStagger', d) * paceFactor(m, PACE.stagger);
  p.maxHazards = Math.min(CAPS.maxActiveHazards, Math.round(at('maxHazards', d)));
  p.laserRate = at('laserRate', d) / paceFactor(m, PACE.beam);
  p.laserSpan = at('laserSpan', d);
  return p;
}

export function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
