/**
 * Effet de vitesse du vaisseau : fonctions PURES (rendu seulement). Lit la vitesse de la simulation, ne la modifie jamais ; aucun tirage aléatoire,
 * aucune dépendance au gameplay. Les traînées partent derrière la queue du vaisseau, à l'opposé exact du déplacement.
 */
import { FX } from '../config/visuals';
import { exhaustDirection } from './geometry';

const S = FX.speedLines;

export interface Streak {
  /** Décalage latéral (unités monde, positif = côté de la normale radiale). */
  lateral: number;
  /** Longueur (unités monde). */
  length: number;
  alpha: number;
  /** Largeur à la base (unités monde). */
  width: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Intensité 0..1 selon le facteur de vitesse (1 = vitesse de référence), progressive et lissée. */
export function speedIntensity(speedFactor: number): number {
  const k = clamp01((speedFactor - S.factorMin) / (S.factorMax - S.factorMin));
  return k * k * (3 - 2 * k);
}

/**
 * Traînées à tracer. `calm` (effets réduits) : pas de variation. `withTrail` : la traînée lumineuse d'apparence est tracée, l'effet s'atténue et
 * la traînée centrale (qu'elle recouvrirait) est omise.
 */
export function speedStreaks(intensity: number, clock: number, halfWidth: number, calm: boolean, withTrail: boolean): Streak[] {
  const k = clamp01(intensity);
  const base = S.length.min + (S.length.max - S.length.min) * k;
  const baseAlpha = (S.alpha.min + (S.alpha.max - S.alpha.min) * k) * (withTrail ? S.withTrail : 1) * (calm ? 0.8 : 1);
  const out: Streak[] = [];
  const make = (lateral: number, phase: number, lenK: number, alphaK: number): void => {
    const w = calm ? 0 : Math.sin(clock * S.wobble.rate + phase);
    out.push({
      lateral,
      length: base * lenK * (1 + S.wobble.length * w),
      alpha: baseAlpha * alphaK * (1 + S.wobble.alpha * (calm ? 0 : Math.sin(clock * S.wobble.rate * 0.7 + phase * 1.7))),
      width: S.width,
    });
  };
  make(-S.lateral * halfWidth, 0, 1, 1);
  make(S.lateral * halfWidth, 2.1, 1, 1);
  if (k >= S.third.from && !withTrail) make(0, 4.2, S.third.length, S.third.alpha);
  return out;
}

/** Sommets d'une traînée : base (deux points, derrière la queue) et pointe. `angle`/`dir` : position et sens du déplacement réels. */
export function streakTriangle(
  angle: number,
  dir: 1 | -1,
  orbitRadius: number,
  shipRadius: number,
  s: Streak,
): { x0: number; y0: number; x1: number; y1: number; tx: number; ty: number } {
  const e = exhaustDirection(angle, dir); // opposé du déplacement
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const px = orbitRadius * nx;
  const py = orbitRadius * ny;
  const bx = px + e.x * shipRadius * S.startBehind + nx * s.lateral;
  const by = py + e.y * shipRadius * S.startBehind + ny * s.lateral;
  const hw = s.width * 0.5;
  return { x0: bx + nx * hw, y0: by + ny * hw, x1: bx - nx * hw, y1: by - ny * hw, tx: bx + e.x * s.length, ty: by + e.y * s.length };
}
