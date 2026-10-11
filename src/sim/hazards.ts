import { ARENA } from '../config/balance';
import { wrapAngle } from '../core/math';

/**
 * Toutes les menaces sont des fonctions pures du temps : leur état à l'instant t est connu dès leur création.
 * Cela rend la simulation déterministe et permet au validateur d'anticiper exactement leur trajectoire.
 */

export interface ProjectileHazard {
  kind: 'projectile';
  id: number;
  /** Motif qui a créé la menace (pour l'affichage d'introduction). */
  pattern: string;
  /** Apparition de l'annonce (ligne pointillée). */
  warnStart: number;
  /** Départ du projectile depuis (x0, y0). */
  launch: number;
  /** Sortie de l'arène : la menace disparaît. */
  end: number;
  /** Après cet instant, le projectile a quitté l'orbite et ne peut plus toucher le joueur. */
  threatEnd: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  /** Angles des points où la trajectoire coupe l'orbite (pour l'annonce). */
  cross1: number;
  cross2: number;
  /** Instants de passage à ces points. */
  crossTime1: number;
  crossTime2: number;
  warned: boolean;
}

export interface SectorHazard {
  kind: 'sector';
  id: number;
  pattern: string;
  warnStart: number;
  activeStart: number;
  /** Fin de l'activité ; la menace disparaît. */
  end: number;
  threatEnd: number;
  center: number;
  half: number;
  warned: boolean;
  activated: boolean;
}

export type Hazard = ProjectileHazard | SectorHazard;

let nextId = 1;

export function resetHazardIds(): void {
  nextId = 1;
}

/**
 * Projectile traversant l'arène en ligne droite et coupant l'orbite aux angles a1 puis a2.
 * Il part du bord hors champ au temps `launch` et sort de l'autre côté.
 */
export function makeChordProjectile(
  pattern: string,
  warnStart: number,
  warn: number,
  speed: number,
  a1: number,
  a2: number,
): ProjectileHazard {
  const R = ARENA.orbitRadius;
  const S = ARENA.spawnRadius;
  const p1x = R * Math.cos(a1);
  const p1y = R * Math.sin(a1);
  const p2x = R * Math.cos(a2);
  const p2y = R * Math.sin(a2);
  let ux = p2x - p1x;
  let uy = p2y - p1y;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  // Projection du centre sur la droite : point le plus proche du centre
  const along1 = p1x * ux + p1y * uy; // abscisse de P1 le long de u (négative)
  const footX = p1x - along1 * ux;
  const footY = p1y - along1 * uy;
  const x0 = footX - S * ux;
  const y0 = footY - S * uy;
  const launch = warnStart + warn;
  const along2 = p2x * ux + p2y * uy;
  const crossTime1 = launch + (S + along1) / speed;
  const crossTime2 = launch + (S + along2) / speed;
  // Fin de menace : le projectile s'éloigne du centre au-delà de l'orbite + hitboxes + marge du validateur
  const outer = R + 40;
  const exitAlong = Math.sqrt(Math.max(0, outer * outer - (footX * footX + footY * footY)));
  const threatEnd = launch + (S + exitAlong) / speed;
  return {
    kind: 'projectile',
    id: nextId++,
    pattern,
    warnStart,
    launch,
    end: launch + (2 * S) / speed,
    threatEnd,
    x0,
    y0,
    vx: ux * speed,
    vy: uy * speed,
    cross1: wrapAngle(a1),
    cross2: wrapAngle(a2),
    crossTime1,
    crossTime2,
    warned: false,
  };
}

export function makeSector(
  pattern: string,
  warnStart: number,
  warn: number,
  active: number,
  center: number,
  half: number,
): SectorHazard {
  const activeStart = warnStart + warn;
  return {
    kind: 'sector',
    id: nextId++,
    pattern,
    warnStart,
    activeStart,
    end: activeStart + active,
    threatEnd: activeStart + active,
    center: wrapAngle(center),
    half,
    warned: false,
    activated: false,
  };
}

/** Position d'un projectile à l'instant t (non borné : extrapole avant le départ). */
export function projectileX(h: ProjectileHazard, t: number): number {
  return h.x0 + h.vx * (t - h.launch);
}

export function projectileY(h: ProjectileHazard, t: number): number {
  return h.y0 + h.vy * (t - h.launch);
}

/** Instant à partir duquel la menace peut tuer. */
export function dangerStart(h: Hazard): number {
  return h.kind === 'projectile' ? h.launch : h.activeStart;
}

/** Instant où la menace touche l'orbite pour la première fois (référence de lisibilité). */
export function firstOrbitContact(h: Hazard): number {
  return h.kind === 'projectile' ? Math.min(h.crossTime1, h.crossTime2) : h.activeStart;
}
