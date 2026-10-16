import { ARENA } from '../config/balance';
import { wrapAngle } from '../core/math';

/**
 * Toutes les menaces sont des fonctions pures du temps : leur état à l'instant t est connu dès leur création.
 * Cela rend la simulation déterministe et permet au validateur d'anticiper exactement leur trajectoire.
 */

/**
 * Trajectoire courbe (phase 2) : position = fonction pure de s = t − launch.
 * - `arc` : grand arc de cercle (centre (cx, cy), rayon rho, angle de départ a0, vitesse angulaire signée w).
 * - `spiral` : spirale autour du centre de l'arène (rayon r0 + vr·s, angle a0 + w·s) ; vr < 0 : vers le centre, vr > 0 : vers l'extérieur.
 */
export type ProjectilePath =
  | { type: 'arc'; cx: number; cy: number; rho: number; a0: number; w: number }
  | { type: 'spiral'; r0: number; vr: number; a0: number; w: number };

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
  /** Trajectoire courbe (phase 2) ; absente = ligne droite (x0, y0, vx, vy). */
  path?: ProjectilePath;
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
  /** Faisceau rotatif (phase 2) : peut tourner plus d'un tour ; l'annonce montre le rayon et son sens plutôt qu'un secteur. */
  rotating?: boolean;
  /** Couverture comptée pour les plafonds (rad) à la place de `span + 2·half` (faisceau rotatif). */
  coverage?: number;
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

/** Position sur une trajectoire courbe à l'instant s = t − launch. */
export function pathX(p: ProjectilePath, s: number): number {
  if (p.type === 'arc') return p.cx + p.rho * Math.cos(p.a0 + p.w * s);
  return (p.r0 + p.vr * s) * Math.cos(p.a0 + p.w * s);
}

export function pathY(p: ProjectilePath, s: number): number {
  if (p.type === 'arc') return p.cy + p.rho * Math.sin(p.a0 + p.w * s);
  return (p.r0 + p.vr * s) * Math.sin(p.a0 + p.w * s);
}

/** Position d'un projectile à l'instant t (non borné : extrapole avant le départ). */
export function projectileX(h: ProjectileHazard, t: number): number {
  return h.path ? pathX(h.path, t - h.launch) : h.x0 + h.vx * (t - h.launch);
}

export function projectileY(h: ProjectileHazard, t: number): number {
  return h.path ? pathY(h.path, t - h.launch) : h.y0 + h.vy * (t - h.launch);
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
  if (h.kind === 'laser') return h.coverage ?? h.span + 2 * h.half;
  return 0;
}

/**
 * Retarde la frise temporelle d'un danger de `d` secondes (Gel temporel : à chaque pas gelé, les dangers perdent (1 − vitesse effective) · dt).
 * Un danger étant une fonction pure du temps, retarder tous ses instants le ralentit exactement, sans toucher à l'horloge de la partie ni à la
 * détection continue des collisions. Les dangers déjà annoncés, actifs ou à venir sont tous concernés.
 */
export function shiftHazard(h: Hazard, d: number): void {
  h.warnStart += d;
  h.end += d;
  h.threatEnd += d;
  if (h.kind === 'projectile') {
    h.launch += d;
    h.crossTime1 += d;
    h.crossTime2 += d;
    if (h.split) h.split = { x: h.split.x, y: h.split.y, t: h.split.t + d };
  } else {
    h.activeStart += d;
  }
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

/**
 * Projectile sur une trajectoire courbe (phase 2). Les passages sur l'orbite et la fin de menace sont calculés par échantillonnage de la
 * trajectoire (pas de 1/240 s) à la création : la fonction reste pure et déterministe.
 * @param duration durée de vol (s) ; le projectile disparaît à `launch + duration`.
 */
export function makeCurveProjectile(
  pattern: string,
  warnStart: number,
  warn: number,
  path: ProjectilePath,
  duration: number,
  scale = 1,
): ProjectileHazard {
  const launch = warnStart + warn;
  const STEP = 1 / 240;
  const n = Math.max(2, Math.ceil(duration / STEP));
  let s1 = -1;
  let s2 = -1;
  let lastNear = -1;
  let prevSide = 0;
  let nearest = 0;
  let nearestD = Infinity;
  for (let i = 0; i <= n; i++) {
    const s = Math.min(duration, i * STEP);
    const x = pathX(path, s);
    const y = pathY(path, s);
    const r = Math.hypot(x, y);
    const side = r >= R_ORBIT ? 1 : -1;
    if (i > 0 && side !== prevSide) {
      if (s1 < 0) s1 = s;
      s2 = s;
    }
    prevSide = side;
    if (Math.abs(r - R_ORBIT) <= NEAR) lastNear = s;
    if (Math.abs(r - R_ORBIT) < nearestD) {
      nearestD = Math.abs(r - R_ORBIT);
      nearest = s;
    }
  }
  if (s1 < 0) {
    s1 = nearest;
    s2 = nearest;
  }
  const ang = (s: number): number => wrapAngle(Math.atan2(pathY(path, s), pathX(path, s)));
  const e = 1 / 240;
  const x0 = pathX(path, 0);
  const y0 = pathY(path, 0);
  return {
    kind: 'projectile',
    id: 0,
    pattern,
    warnStart,
    launch,
    end: launch + duration,
    threatEnd: launch + Math.max(0, lastNear),
    x0,
    y0,
    vx: (pathX(path, e) - x0) / e,
    vy: (pathY(path, e) - y0) / e,
    cross1: ang(s1),
    cross2: ang(s2),
    crossTime1: launch + s1,
    crossTime2: launch + s2,
    warned: false,
    scale,
    path,
  };
}

/** Cercle passant par trois points (centre et rayon) ; null si les points sont presque alignés. */
export function circleThrough(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): { cx: number; cy: number; rho: number } | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { cx: ux, cy: uy, rho: Math.hypot(ax - ux, ay - uy) };
}

/**
 * Grand arc : projectile qui part du point P0 (hors champ), passe par M (près de l'orbite) et sort en P2 (hors champ), à la vitesse
 * de parcours `speed` (unités/s le long de la courbe). Repli sur une ligne droite si les trois points sont presque alignés.
 */
export function makeArcProjectile(
  pattern: string,
  warnStart: number,
  warn: number,
  speed: number,
  p0: readonly [number, number],
  m: readonly [number, number],
  p2: readonly [number, number],
): ProjectileHazard | null {
  const c = circleThrough(p0[0], p0[1], m[0], m[1], p2[0], p2[1]);
  if (!c || c.rho > 4000) return null;
  const a0 = Math.atan2(p0[1] - c.cy, p0[0] - c.cx);
  const aM = Math.atan2(m[1] - c.cy, m[0] - c.cx);
  const a2 = Math.atan2(p2[1] - c.cy, p2[0] - c.cx);
  const d0m = wrapAngle(aM - a0);
  const dm2 = wrapAngle(a2 - aM);
  // Les trois points doivent se parcourir dans le même sens
  if (d0m * dm2 <= 0) return null;
  const dir = d0m > 0 ? 1 : -1;
  const sweep = Math.abs(d0m) + Math.abs(dm2);
  const w = (dir * speed) / c.rho;
  const duration = (sweep * c.rho) / speed;
  return makeCurveProjectile(pattern, warnStart, warn, { type: 'arc', cx: c.cx, cy: c.cy, rho: c.rho, a0, w }, duration);
}

/** Spirale (phase 2) : part du rayon `r0` à l'angle `a0`, vitesse radiale `vr`, vitesse angulaire `w` ; s'arrête à `rEnd` (ou à l'arène). */
export function makeSpiralProjectile(
  pattern: string,
  warnStart: number,
  warn: number,
  r0: number,
  vr: number,
  a0: number,
  w: number,
  rEnd?: number,
): ProjectileHazard {
  const inward = vr < 0;
  const stop = rEnd ?? (inward ? 70 : ARENA.spawnRadius);
  const duration = Math.abs(stop - r0) / Math.abs(vr);
  return makeCurveProjectile(pattern, warnStart, warn, { type: 'spiral', r0, vr, a0, w }, duration);
}
