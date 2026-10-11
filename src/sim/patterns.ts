import { ARENA, PLAYER } from '../config/balance';
import { TAU } from '../core/math';
import type { Rng } from '../core/rng';
import type { DifficultyParams } from './difficulty';
import { makeChordProjectile, makeSector, type Hazard } from './hazards';

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
  | 'echo';

export type Family = 'projectile' | 'sector' | 'combo';

export interface PatternContext {
  now: number;
  rng: Rng;
  p: DifficultyParams;
  playerAngle: number;
  playerDir: 1 | -1;
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
const W = PLAYER.angularSpeed;

/** Angle prévu du joueur à l'instant t s'il ne change pas de direction. */
function predict(ctx: PatternContext, t: number): number {
  return ctx.playerAngle + ctx.playerDir * W * (t - ctx.now);
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
};

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

export const FAMILY_INTRO: Record<Family, string> = {
  projectile: 'Projectile : la ligne pointillée annonce sa trajectoire, les croix montrent où il coupe l’orbite.',
  sector: 'Secteur électrique : quittez ou traversez la zone pointillée avant qu’elle ne s’allume.',
  combo: 'Attaque combinée : esquivez la première menace en anticipant la seconde.',
};

export type PatternWeights = Partial<Record<PatternId, number>>;
