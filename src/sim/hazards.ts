import { ARENA } from '../config/balance';
import { wrapAngle } from '../core/math';

/**
 * Toutes les menaces sont des fonctions pures du temps : leur état à l'instant t est connu dès leur création.
 * Cela rend la simulation déterministe et permet au validateur d'anticiper exactement leur trajectoire.
 */

export interface ProjectileHazard {
  kind: 'projectile';
  /** Attribué par la simulation (séquentiel, déterministe). */
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
  /** Taille relative (visuel et hitbox) : 1 par défaut, 0,7 pour un fragment. */
  scale?: number;
  /** Astéroïde fragmenté : point et instant de la division (le projectile s'arrête là). */
  split?: { x: number; y: number; t: number };
  /** Vrai pour un fragment issu d'une division. */
  fragment?: boolean;
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

/**
 * Laser balayeur : après l'annonce, un rayon part du centre à l'angle `startAngle` et pivote de `span` radians
 * à la vitesse signée `rate` (rad/s). Il tue le vaisseau dont l'angle croise celui du rayon (± `half`).
 * Le secteur balayé est limité : le reste de l'orbite est la zone de refuge.
 */
export interface LaserHazard {
  kind: 'laser';
  id: number;
  pattern: string;
  warnStart: number;
  activeStart: number;
  end: number;
  threatEnd: number;
  startAngle: number;
  /** Vitesse de balayage signée (rad/s). */
  rate: number;
  /** Étendue balayée (rad, > 0). */
  span: number;
  /** Demi-largeur angulaire du rayon (rad). */
  half: number;
  warned: boolean;
  activated: boolean;
}

export type Hazard = ProjectileHazard | SectorHazard | LaserHazard;


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
    id: 0,
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
    id: 0,
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

/** Fenêtre pendant laquelle la menace peut toucher le vaisseau. */
export function dangerWindow(h: Hazard): { from: number; to: number } {
  return h.kind === 'projectile' ? { from: h.launch, to: h.threatEnd } : { from: h.activeStart, to: h.end };
}

/** Instant où la menace touche l'orbite pour la première fois (référence de lisibilité). */
export function firstOrbitContact(h: Hazard): number {
  return h.kind === 'projectile' ? Math.min(h.crossTime1, h.crossTime2) : h.activeStart;
}

/** Angle du rayon d'un laser à l'instant t (borné à la durée active). */
export function laserAngle(h: LaserHazard, t: number): number {
  const k = t <= h.activeStart ? 0 : t >= h.end ? h.end - h.activeStart : t - h.activeStart;
  return h.startAngle + h.rate * k;
}

/** Part de la circonférence mobilisée par un secteur ou un laser (radians) : sert aux plafonds de couverture. */
export function arcCoverage(h: Hazard): number {
  if (h.kind === 'sector') return 2 * h.half;
  if (h.kind === 'laser') return h.span + 2 * h.half;
  return 0;
}

const R_ORBIT = ARENA.orbitRadius;
/** Distance autour de l'orbite au-delà de laquelle un projectile ne peut plus toucher le vaisseau (hitboxes + marge du validateur). */
const NEAR = 40;

/**
 * Projectile en ligne droite à partir de (x0, y0) au temps `launch`, avec la vitesse (vx, vy).
 * Calcule les points de passage sur l'orbite (devant lui) et la fin de la menace pour une trajectoire quelconque
 * (utilisé par les fragments, qui partent de l'intérieur de l'arène).
 * @param end instant de disparition (sortie de l'arène par défaut ; division pour l'astéroïde fragmenté)
 */
export function makeRayProjectile(
  pattern: string,
  warnStart: number,
  launch: number,
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  opts: { end?: number; scale?: number; fragment?: boolean } = {},
): ProjectileHazard {
  const speed = Math.hypot(vx, vy);
  const ux = vx / speed;
  const uy = vy / speed;
  const b = x0 * ux + y0 * uy;
  const c = x0 * x0 + y0 * y0;
  const root = (radius: number): [number, number] | null => {
    const disc = b * b - c + radius * radius;
    if (disc < 0) return null;
    const r = Math.sqrt(disc);
    return [-b - r, -b + r];
  };
  // Sorties de l'arène visible (rayon de naissance) → fin ; passages sur l'orbite devant le projectile
  const outer = root(ARENA.spawnRadius);
  const cross = root(R_ORBIT);
  const ahead = cross ? cross.filter((s) => s > 0) : [];
  const crossS = ahead.length ? ahead : [0, 0];
  const endS = outer ? Math.max(0, outer[1]) : 0;
  const end = opts.end ?? launch + endS / speed;
  const ang = (s: number): number => wrapAngle(Math.atan2(y0 + uy * s, x0 + ux * s));
  const s1 = crossS[0];
  const s2 = crossS[crossS.length - 1];
  // Dernier instant où le projectile peut encore toucher l'orbite (anneau R ± NEAR), borné par `end`
  const ring = root(R_ORBIT + NEAR);
  const inner = root(R_ORBIT - NEAR);
  let lastS = ring ? Math.max(0, ring[1]) : 0;
  const endSLimit = (end - launch) * speed;
  if (inner && inner[0] > 0 && endSLimit > inner[0]) {
    // La trajectoire s'arrête (division) à l'intérieur du disque central : fin de menace à l'entrée du disque
    const posEnd = Math.hypot(x0 + ux * endSLimit, y0 + uy * endSLimit);
    if (posEnd < R_ORBIT - NEAR) lastS = Math.min(lastS, inner[0]);
  }
  const threatEnd = Math.min(end, launch + lastS / speed);
  return {
    kind: 'projectile',
    id: 0,
    pattern,
    warnStart,
    launch,
    end,
    threatEnd,
    x0,
    y0,
    vx,
    vy,
    cross1: ang(s1),
    cross2: ang(s2),
    crossTime1: launch + s1 / speed,
    crossTime2: launch + s2 / speed,
    warned: false,
    scale: opts.scale ?? 1,
    fragment: opts.fragment,
  };
}

export function makeLaser(
  pattern: string,
  warnStart: number,
  warn: number,
  startAngle: number,
  rate: number,
  span: number,
  half: number,
): LaserHazard {
  const activeStart = warnStart + warn;
  const end = activeStart + span / Math.abs(rate);
  return {
    kind: 'laser',
    id: 0,
    pattern,
    warnStart,
    activeStart,
    end,
    threatEnd: end,
    startAngle: wrapAngle(startAngle),
    rate,
    span,
    half,
    warned: false,
    activated: false,
  };
}
