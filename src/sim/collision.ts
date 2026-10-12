import { ARENA, SECTOR } from '../config/balance';
import { projectileHitRadius } from '../config/hitbox';
import { minDistanceLinear, sweepOverlapsArc } from '../core/math';
import { laserAngle, type Hazard, type LaserHazard, type ProjectileHazard, type SectorHazard } from './hazards';

/**
 * Détection continue : le joueur se déplace de l'angle a0 à a0 + delta pendant [t0, t1].
 * Sur des intervalles courts, son déplacement sur l'arc est assimilé à une corde ; le projectile
 * est linéaire. On calcule la distance minimale exacte entre ces deux mouvements : un projectile
 * rapide ne peut pas « sauter » par-dessus la hitbox entre deux images.
 */
export function projectileHits(
  h: ProjectileHazard,
  a0: number,
  delta: number,
  t0: number,
  t1: number,
  playerRadius: number,
  extraMargin = 0,
): boolean {
  const s0 = t0 > h.launch ? t0 : h.launch;
  const s1 = t1 < h.end ? t1 : h.end;
  if (s1 < s0) return false;
  const span = t1 - t0;
  const f0 = span > 0 ? (s0 - t0) / span : 0;
  const f1 = span > 0 ? (s1 - t0) / span : 1;
  const R = ARENA.orbitRadius;
  const pa0 = a0 + delta * f0;
  const pa1 = a0 + delta * f1;
  const px0 = R * Math.cos(pa0);
  const py0 = R * Math.sin(pa0);
  const px1 = R * Math.cos(pa1);
  const py1 = R * Math.sin(pa1);
  const bx0 = h.x0 + h.vx * (s0 - h.launch);
  const by0 = h.y0 + h.vy * (s0 - h.launch);
  const bx1 = h.x0 + h.vx * (s1 - h.launch);
  const by1 = h.y0 + h.vy * (s1 - h.launch);
  const dist = minDistanceLinear(px0, py0, px1, py1, bx0, by0, bx1, by1);
  return dist < playerRadius + projectileHitRadius() * (h.scale ?? 1) + extraMargin;
}

export function sectorHits(
  h: SectorHazard,
  a0: number,
  delta: number,
  t0: number,
  t1: number,
  playerRadius: number,
  extraMargin = 0,
  timeMargin = 0,
): boolean {
  const start = h.activeStart - timeMargin;
  const end = h.end + timeMargin;
  const s0 = t0 > start ? t0 : start;
  const s1 = t1 < end ? t1 : end;
  if (s1 < s0) return false;
  const span = t1 - t0;
  const f0 = span > 0 ? (s0 - t0) / span : 0;
  const f1 = span > 0 ? (s1 - t0) / span : 1;
  const sa = a0 + delta * f0;
  const sd = delta * (f1 - f0);
  const half = h.half - SECTOR.edgeForgiveness + (playerRadius + extraMargin) / ARENA.orbitRadius;
  return sweepOverlapsArc(sa, sd, h.center, half);
}

/**
 * Laser balayeur : le vaisseau et le rayon bougent tous deux à vitesse angulaire constante pendant le pas ;
 * leur écart angulaire varie linéairement : on teste si ce balayage relatif traverse la largeur du rayon.
 * Un rayon très rapide ne peut donc pas « sauter » par-dessus le vaisseau entre deux pas.
 */
export function laserHits(
  h: LaserHazard,
  a0: number,
  delta: number,
  t0: number,
  t1: number,
  playerRadius: number,
  extraMargin = 0,
  timeMargin = 0,
): boolean {
  const start = h.activeStart - timeMargin;
  const end = h.end + timeMargin;
  const s0 = t0 > start ? t0 : start;
  const s1 = t1 < end ? t1 : end;
  if (s1 < s0) return false;
  const span = t1 - t0;
  const f0 = span > 0 ? (s0 - t0) / span : 0;
  const f1 = span > 0 ? (s1 - t0) / span : 1;
  const pa0 = a0 + delta * f0;
  const pd = delta * (f1 - f0);
  const b0 = laserAngle(h, s0);
  const b1 = laserAngle(h, s1);
  const half = h.half + (playerRadius + extraMargin) / ARENA.orbitRadius;
  // Écart angulaire relatif au rayon : de (pa0 − b0), variation pd − (b1 − b0)
  return sweepOverlapsArc(pa0 - b0, pd - (b1 - b0), 0, half);
}

export function hazardHits(
  h: Hazard,
  a0: number,
  delta: number,
  t0: number,
  t1: number,
  playerRadius: number,
  extraMargin = 0,
  timeMargin = 0,
): boolean {
  if (h.kind === 'projectile') return projectileHits(h, a0, delta, t0, t1, playerRadius, extraMargin);
  if (h.kind === 'laser') return laserHits(h, a0, delta, t0, t1, playerRadius, extraMargin, timeMargin);
  return sectorHits(h, a0, delta, t0, t1, playerRadius, extraMargin, timeMargin);
}
