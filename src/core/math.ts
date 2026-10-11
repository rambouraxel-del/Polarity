export const TAU = Math.PI * 2;

/** Ramène un angle dans [0, 2π). */
export function wrapAngle(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

/** Différence signée la plus courte b − a, dans (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = wrapAngle(b - a);
  if (d > Math.PI) d -= TAU;
  return d;
}

/**
 * Vrai si l'angle `target` est traversé par un mouvement partant de `from` et parcourant `delta` (signé).
 * Fonctionne dans les deux sens, au passage de zéro et pour des pas importants (|delta| < 2π).
 * Le point de départ est exclu, le point d'arrivée inclus : un passage n'est compté qu'une fois.
 */
export function arcCrosses(from: number, delta: number, target: number): boolean {
  if (delta === 0) return false;
  if (Math.abs(delta) >= TAU) return true;
  if (delta > 0) {
    const d = wrapAngle(target - from);
    return d > 0 && d <= delta;
  }
  const d = wrapAngle(from - target);
  return d > 0 && d <= -delta;
}

/**
 * Vrai si l'intervalle angulaire balayé [a0, a0 + delta] (delta signé) intersecte l'arc [center − half, center + half].
 */
export function sweepOverlapsArc(a0: number, delta: number, center: number, half: number): boolean {
  if (half <= 0) return false;
  if (Math.abs(delta) + 2 * half >= TAU) return true;
  // Intervalle balayé ramené en [start, start + len]
  const start = delta >= 0 ? a0 : a0 + delta;
  const len = Math.abs(delta);
  const arcStart = center - half;
  // Décalage de l'arc relativement au début du balayage
  const off = wrapAngle(arcStart - start);
  // Chevauchement si l'arc commence dans le balayage, ou si le balayage commence dans l'arc
  return off <= len || off >= TAU - 2 * half;
}

/**
 * Distance minimale entre deux points se déplaçant linéairement sur un même intervalle de temps :
 * A va de (ax0, ay0) à (ax1, ay1), B de (bx0, by0) à (bx1, by1).
 */
export function minDistanceLinear(
  ax0: number, ay0: number, ax1: number, ay1: number,
  bx0: number, by0: number, bx1: number, by1: number,
): number {
  const dx0 = ax0 - bx0;
  const dy0 = ay0 - by0;
  const vx = ax1 - ax0 - (bx1 - bx0);
  const vy = ay1 - ay0 - (by1 - by0);
  const vv = vx * vx + vy * vy;
  let s = 0;
  if (vv > 1e-12) {
    s = -(dx0 * vx + dy0 * vy) / vv;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
  }
  const x = dx0 + vx * s;
  const y = dy0 + vy * s;
  return Math.sqrt(x * x + y * y);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
