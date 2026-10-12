import { ARENA } from '../config/balance';
import { CONVOY, FRAGMENT, LASER } from '../config/hazards';
import { TAU } from '../core/math';
import type { Rng } from '../core/rng';
import type { DifficultyParams } from './difficulty';
import { makeChordProjectile, makeLaser, makeRayProjectile, makeSector, type Hazard } from './hazards';
import { angularTravel, type SpeedFn } from './speed';

export type PatternId =
  | 'shot'
  | 'diameter'
  | 'parallel'
  | 'cross'
  | 'burst'
  | 'arc'
  | 'twinArcs'
  | 'chase'
  | 'shotArc'
  | 'pincer'
  | 'echo'
  | 'fragment'
  | 'convoy'
  | 'laser';

export type Family = 'projectile' | 'sector' | 'combo' | 'fragment' | 'convoy' | 'laser';

export interface PatternContext {
  now: number;
  rng: Rng;
  p: DifficultyParams;
  playerAngle: number;
  playerDir: 1 | -1;
  /** Facteur de vitesse du vaisseau selon le temps (pour prévoir sa position). */
  speed: SpeedFn;
}

export interface PatternDef {
  id: PatternId;
  family: Family;
  name: string;
  /** Multiplicateur de l'intervalle avant la vague suivante (motifs lourds = plus de temps). */
  cost: number;
  build(ctx: PatternContext): Hazard[];
}

const R = ARENA.orbitRadius;
const S = ARENA.spawnRadius;

/** Angle prévu du joueur à l'instant t s'il ne change pas de direction. */
function predict(ctx: PatternContext, t: number): number {
  return ctx.playerAngle + ctx.playerDir * angularTravel(ctx.speed, ctx.now, t);
}

/** Estimation du temps entre le départ d'un projectile et son premier passage sur l'orbite. */
function approachTime(speed: number): number {
  return (S - 0.75 * R) / speed;
}

/** Angle visé : position prévue, actuelle, ou légèrement décalée. */
function aimAngle(ctx: PatternContext, t: number): number {
  const r = ctx.rng.next();
  if (r < 0.55) return predict(ctx, t) + ctx.rng.range(-0.15, 0.15);
  if (r < 0.8) return ctx.playerAngle + ctx.rng.range(-0.2, 0.2);
  return predict(ctx, t) + ctx.rng.range(-0.9, 0.9);
}

/** Projectile sur une droite de direction phi, à distance signée b du centre. */
function lineProjectile(
  pattern: string, warnStart: number, warn: number, speed: number, phi: number, b: number,
): Hazard {
  const ux = Math.cos(phi);
  const uy = Math.sin(phi);
  const nx = -uy;
  const ny = ux;
  const h = Math.sqrt(Math.max(0, R * R - b * b));
  const a1 = Math.atan2(b * ny - h * uy, b * nx - h * ux);
  const a2 = Math.atan2(b * ny + h * uy, b * nx + h * ux);
  return makeChordProjectile(pattern, warnStart, warn, speed, a1, a2);
}

function shotThrough(ctx: PatternContext, pattern: string, warnStart: number, angle: number, spread?: number): Hazard {
  const { rng, p } = ctx;
  const sep = spread ?? rng.range(1.3, 2.7);
  const other = angle + rng.sign() * sep;
  // Une fois sur trois, l'angle visé est le second point de passage
  return rng.next() < 0.33
    ? makeChordProjectile(pattern, warnStart, p.projectileWarn, p.projectileSpeed, other, angle)
    : makeChordProjectile(pattern, warnStart, p.projectileWarn, p.projectileSpeed, angle, other);
}

function crossingTime(ctx: PatternContext, warnStart: number): number {
  return warnStart + ctx.p.projectileWarn + approachTime(ctx.p.projectileSpeed);
}

export const PATTERNS: Record<PatternId, PatternDef> = {
  shot: {
    id: 'shot', family: 'projectile', name: 'Tir', cost: 1,
    build(ctx) {
      const ws = ctx.now;
      return [shotThrough(ctx, 'shot', ws, aimAngle(ctx, crossingTime(ctx, ws)))];
    },
  },
  diameter: {
    id: 'diameter', family: 'projectile', name: 'Tir diamétral', cost: 1.1,
    build(ctx) {
      const ws = ctx.now;
      const a = aimAngle(ctx, crossingTime(ctx, ws));
      return [makeChordProjectile('diameter', ws, ctx.p.projectileWarn, ctx.p.projectileSpeed, a, a + Math.PI)];
    },
  },
  parallel: {
    id: 'parallel', family: 'projectile', name: 'Doublé', cost: 1.4,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const gap = rng.range(0.5, 0.68) * R;
      const b1 = rng.range(-0.8 * R, 0.8 * R - gap);
      const phi = rng.range(0, TAU);
      return [
        lineProjectile('parallel', ws, p.projectileWarn, p.projectileSpeed, phi, b1),
        lineProjectile('parallel', ws, p.projectileWarn, p.projectileSpeed, phi, b1 + gap),
      ];
    },
  },
  cross: {
    id: 'cross', family: 'projectile', name: 'Croix', cost: 1.5,
    build(ctx) {
      const { rng } = ctx;
      const ws = ctx.now;
      const a = aimAngle(ctx, crossingTime(ctx, ws));
      const b = a + rng.sign() * rng.range(0.9, 1.5);
      return [
        shotThrough(ctx, 'cross', ws, a),
        shotThrough(ctx, 'cross', ws + rng.range(0, 0.2), b),
      ];
    },
  },
  burst: {
    id: 'burst', family: 'projectile', name: 'Rafale', cost: 1.8,
    build(ctx) {
      const { rng, p, playerDir } = ctx;
      const gap = p.comboStagger * 0.75;
      const sweep = playerDir * rng.range(0.45, 0.65);
      const base = aimAngle(ctx, crossingTime(ctx, ctx.now)) - sweep;
      const out: Hazard[] = [];
      for (let i = 0; i < 3; i++) {
        out.push(shotThrough(ctx, 'burst', ctx.now + i * gap, base + i * sweep, rng.range(1.6, 2.4)));
      }
      return out;
    },
  },
  arc: {
    id: 'arc', family: 'sector', name: 'Arc électrique', cost: 1,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const act = ws + p.sectorWarn;
      const r = rng.next();
      const center = r < 0.4 ? ctx.playerAngle : r < 0.8 ? predict(ctx, act) : predict(ctx, act) + rng.range(-1, 1);
      return [makeSector('arc', ws, p.sectorWarn, p.sectorActive, center, p.sectorHalfWidth)];
    },
  },
  twinArcs: {
    id: 'twinArcs', family: 'sector', name: 'Arcs jumeaux', cost: 1.3,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const half = p.sectorHalfWidth * 0.85;
      const c = predict(ctx, ws + p.sectorWarn) + rng.range(-0.5, 0.5);
      return [
        makeSector('twinArcs', ws, p.sectorWarn, p.sectorActive, c, half),
        makeSector('twinArcs', ws, p.sectorWarn, p.sectorActive, c + Math.PI, half),
      ];
    },
  },
  chase: {
    id: 'chase', family: 'sector', name: 'Poursuite', cost: 1.6,
    build(ctx) {
      const { p, playerDir } = ctx;
      const ws = ctx.now;
      const half = p.sectorHalfWidth * 0.8;
      const c1 = ctx.playerAngle;
      const c2 = c1 + playerDir * (2 * half + 0.35);
      return [
        makeSector('chase', ws, p.sectorWarn, p.sectorActive, c1, half),
        makeSector('chase', ws + p.comboStagger, p.sectorWarn, p.sectorActive, c2, half),
      ];
    },
  },
  shotArc: {
    id: 'shotArc', family: 'combo', name: 'Tir + arc', cost: 1.7,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const center = rng.next() < 0.5 ? ctx.playerAngle : predict(ctx, ws + p.sectorWarn);
      const sector = makeSector('shotArc', ws, p.sectorWarn, p.sectorActive, center, p.sectorHalfWidth);
      // Le tir coupe l'orbite d'un côté de la zone électrique : il faut choisir sa sortie.
      const side = rng.sign();
      const shotAngle = center + side * (p.sectorHalfWidth + rng.range(0.35, 0.7));
      const shot = shotThrough(ctx, 'shotArc', ws + p.comboStagger, shotAngle, rng.range(1.8, 2.6));
      return [sector, shot];
    },
  },
  pincer: {
    id: 'pincer', family: 'combo', name: 'Tenaille', cost: 2,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const half = p.sectorHalfWidth * 0.8;
      const spread = rng.range(1.35, 1.65);
      const c = ctx.playerAngle;
      const s1 = makeSector('pincer', ws, p.sectorWarn, p.sectorActive + 0.3, c - spread, half);
      const s2 = makeSector('pincer', ws, p.sectorWarn, p.sectorActive + 0.3, c + spread, half);
      const shot = shotThrough(ctx, 'pincer', ws + p.comboStagger, c + rng.range(-0.3, 0.3), rng.range(2.4, 3.0));
      return [s1, s2, shot];
    },
  },
  echo: {
    id: 'echo', family: 'combo', name: 'Écho', cost: 1.7,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const a1 = aimAngle(ctx, crossingTime(ctx, ws));
      const a2 = a1 + rng.sign() * rng.range(1.6, 2.6);
      return [
        makeChordProjectile('echo', ws, p.projectileWarn, p.projectileSpeed, a1, a2),
        makeChordProjectile('echo', ws + p.comboStagger * 1.5, p.projectileWarn, p.projectileSpeed, a2, a1),
      ];
    },
  },
  fragment: {
    id: 'fragment', family: 'fragment', name: 'Astéroïde fragmenté', cost: 2,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const speed = p.projectileSpeed;
      const warn = p.projectileWarn + FRAGMENT.extraWarn;
      const a1 = aimAngle(ctx, ws + warn + approachTime(speed));
      const a2 = a1 + rng.sign() * rng.range(FRAGMENT.sep.min, FRAGMENT.sep.max);
      // Trajectoire de l'astéroïde : corde de l'orbite entre a1 (entrée) et a2 ; division près du milieu, donc près du centre
      const p1x = R * Math.cos(a1);
      const p1y = R * Math.sin(a1);
      let ux = R * Math.cos(a2) - p1x;
      let uy = R * Math.sin(a2) - p1y;
      const chord = Math.hypot(ux, uy);
      ux /= chord;
      uy /= chord;
      const along1 = p1x * ux + p1y * uy;
      const x0 = p1x - along1 * ux - S * ux;
      const y0 = p1y - along1 * uy - S * uy;
      const launch = ws + warn;
      const phi = 0.5 + rng.range(-FRAGMENT.splitJitter, FRAGMENT.splitJitter);
      const sx = p1x + ux * chord * phi;
      const sy = p1y + uy * chord * phi;
      const splitS = (sx - x0) * ux + (sy - y0) * uy;
      const tSplit = launch + splitS / speed;
      const main = makeRayProjectile('fragment', ws, launch, x0, y0, ux * speed, uy * speed, { end: tSplit });
      // L'astéroïde ne revient jamais sur l'orbite : un seul point de passage (l'entrée)
      main.cross2 = main.cross1;
      main.crossTime2 = main.crossTime1;
      main.split = { x: sx, y: sy, t: tSplit };
      const out: Hazard[] = [main];
      const psi = Math.atan2(uy, ux);
      const spread = rng.range(FRAGMENT.spread.min, FRAGMENT.spread.max);
      for (const side of [-1, 1]) {
        const dx = Math.cos(psi + side * spread);
        const dy = Math.sin(psi + side * spread);
        // Distance jusqu'à l'orbite : impose un délai minimal de réaction avant le passage du fragment
        const b = sx * dx + sy * dy;
        const exit = -b + Math.sqrt(Math.max(0, b * b - (sx * sx + sy * sy) + R * R));
        const fs = Math.max(FRAGMENT.minSpeed, Math.min(speed * FRAGMENT.speedScale, exit / FRAGMENT.minLead));
        out.push(makeRayProjectile('fragment', ws, tSplit, sx, sy, dx * fs, dy * fs, { scale: FRAGMENT.scale, fragment: true }));
      }
      return out;
    },
  },
  convoy: {
    id: 'convoy', family: 'convoy', name: 'Convoi d’astéroïdes', cost: 1.7,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const n = rng.int(CONVOY.count.min, CONVOY.count.max);
      const stagger = Math.max(CONVOY.minStagger, p.comboStagger * rng.range(CONVOY.stagger.min, CONVOY.stagger.max));
      const a1 = aimAngle(ctx, crossingTime(ctx, ws));
      const a2 = a1 + rng.sign() * rng.range(1.6, 2.7);
      const out: Hazard[] = [];
      // Même trajectoire, même vitesse : les astéroïdes se suivent à `stagger` secondes d'intervalle
      for (let i = 0; i < n; i++) {
        out.push(makeChordProjectile('convoy', ws, p.projectileWarn + i * stagger, p.projectileSpeed, a1, a2));
      }
      return out;
    },
  },
  laser: {
    id: 'laser', family: 'laser', name: 'Laser balayeur', cost: 1.9,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const span = p.laserSpan * (1 + rng.range(-LASER.spanJitter, LASER.spanJitter));
      // Secteur limité : le reste de l'orbite est la zone de refuge (au moins LASER.minRefuge)
      const swept = Math.min(span, TAU - LASER.minRefuge - 2 * LASER.half);
      const sign = rng.sign();
      const center = predict(ctx, ws + p.laserWarn) + rng.range(-LASER.aimJitter, LASER.aimJitter);
      return [makeLaser('laser', ws, p.laserWarn, center - (sign * swept) / 2, sign * p.laserRate, swept, LASER.half)];
    },
  },
};

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

export const FAMILY_INTRO: Record<Family, string> = {
  projectile: 'Projectile : la ligne pointillée annonce sa trajectoire, les croix montrent où il coupe l’orbite.',
  sector: 'Secteur électrique : quittez ou traversez la zone pointillée avant qu’elle ne s’allume.',
  combo: 'Attaque combinée : esquivez la première menace en anticipant la seconde.',
  fragment: 'Astéroïde fragmenté : après avoir traversé l’orbite il se divise ; les trajectoires des deux fragments sont annoncées.',
  convoy: 'Convoi : plusieurs astéroïdes suivent la même trajectoire, l’un après l’autre. Anticipez les suivants.',
  laser: 'Laser balayeur : un rayon pivote sur la zone annoncée. Rejoignez la zone de refuge, en dehors de l’arc.',
};

export type PatternWeights = Partial<Record<PatternId, number>>;
