import { ARENA } from '../config/balance';
import { ALT_BEAMS, ARC_SHOT, CONVOY, FRAGMENT, LASER, ROT_BEAM, SPIRAL, SWEEP_BEAM } from '../config/hazards';
import { beatPeriodAt, nextBeat } from '../config/phases';
import { TAU } from '../core/math';
import type { Rng } from '../core/rng';
import type { DifficultyParams } from './difficulty';
import { makeArcProjectile, makeChordProjectile, makeLaser, makeRayProjectile, makeSector, makeSpiralProjectile, shiftHazard, firstOrbitContact, type Hazard } from './hazards';
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
  | 'laser'
  // Phase 1 et 2 : tirs dont les passages sur l'orbite tombent sur des battements consécutifs de la musique
  | 'beatShots'
  // Phase 2
  | 'arcShot'
  | 'arcConvoy'
  | 'spiral'
  | 'rotBeam'
  | 'sweepBeam'
  | 'altBeams'
  | 'arcSector'
  | 'spiralArc'
  | 'beamShot';

export type Family = 'projectile' | 'sector' | 'combo' | 'fragment' | 'convoy' | 'laser' | 'rhythm' | 'bigarc' | 'spiral' | 'rotbeam' | 'sweepbeam' | 'altbeams';

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
  beatShots: {
    id: 'beatShots', family: 'rhythm', name: 'Tirs en rythme', cost: 1.9,
    build(ctx) {
      const { rng, p } = ctx;
      const n = rng.int(3, 4);
      const sweep = ctx.playerDir * rng.range(0.55, 0.9);
      const base = aimAngle(ctx, crossingTime(ctx, ctx.now)) - sweep;
      const out: Hazard[] = [];
      let from = ctx.now;
      for (let i = 0; i < n; i++) {
        const h = shotThrough(ctx, 'beatShots', ctx.now, base + i * sweep, rng.range(1.7, 2.5));
        // Le passage sur l'orbite tombe sur un battement ; les tirs suivants tombent sur les battements suivants
        const target = nextBeat(Math.max(from, firstOrbitContact(h)));
        shiftHazard(h, target - firstOrbitContact(h));
        from = target + 0.2 * beatPeriodAt(target);
        out.push(h);
      }
      void p;
      return out;
    },
  },
  arcShot: {
    id: 'arcShot', family: 'bigarc', name: 'Grand arc', cost: 1.4,
    build(ctx) {
      const h = bigArc(ctx, 'arcShot', ctx.now, 0);
      return h ? [h] : [shotThrough(ctx, 'arcShot', ctx.now, aimAngle(ctx, crossingTime(ctx, ctx.now)))];
    },
  },
  arcConvoy: {
    id: 'arcConvoy', family: 'bigarc', name: 'Convoi en arc', cost: 1.9,
    build(ctx) {
      const { rng, p } = ctx;
      const n = rng.int(CONVOY.count.min, CONVOY.count.max);
      const stagger = Math.max(CONVOY.minStagger, p.comboStagger * rng.range(CONVOY.stagger.min, CONVOY.stagger.max));
      const first = bigArc(ctx, 'arcConvoy', ctx.now, 0);
      if (!first || !first.path) return [shotThrough(ctx, 'arcConvoy', ctx.now, aimAngle(ctx, crossingTime(ctx, ctx.now)))];
      // Même courbe, mêmes vitesses : les astéroïdes se suivent à `stagger` secondes d'intervalle
      const out: Hazard[] = [first];
      for (let i = 1; i < n; i++) {
        const c = { ...first, path: { ...first.path }, warned: false };
        shiftHazard(c, i * stagger);
        out.push(c);
      }
      return out;
    },
  },
  spiral: {
    id: 'spiral', family: 'spiral', name: 'Spirale', cost: 1.8,
    build(ctx) {
      return spiralArms(ctx, 'spiral', ctx.now);
    },
  },
  rotBeam: {
    id: 'rotBeam', family: 'rotbeam', name: 'Faisceau rotatif', cost: 2.1,
    build(ctx) {
      return rotatingBeams(ctx, 'rotBeam', ctx.now);
    },
  },
  sweepBeam: {
    id: 'sweepBeam', family: 'sweepbeam', name: 'Faisceau balayeur', cost: 2,
    build(ctx) {
      const { rng } = ctx;
      const ws = ctx.now;
      const warn = Math.max(CAPS_LASER_WARN, SWEEP_BEAM.warn * (ctx.p.laserWarn / 1.15) ** 0.5);
      const span = rng.range(SWEEP_BEAM.span.min, SWEEP_BEAM.span.max);
      const rate = rng.range(SWEEP_BEAM.rate.min, SWEEP_BEAM.rate.max) / paceBeam(ctx);
      const sign = rng.sign();
      const center = predict(ctx, ws + warn) + rng.range(-1.1, 1.1);
      return [makeLaser('sweepBeam', ws, warn, center - (sign * span) / 2, sign * rate, span, SWEEP_BEAM.half)];
    },
  },
  altBeams: {
    id: 'altBeams', family: 'altbeams', name: 'Faisceaux alternés', cost: 2.2,
    build(ctx) {
      return alternatingBeams(ctx, 'altBeams', ctx.now);
    },
  },
  arcSector: {
    id: 'arcSector', family: 'combo', name: 'Grand arc + arc électrique', cost: 2,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const arc = bigArc(ctx, 'arcSector', ws + p.comboStagger, 0);
      if (!arc) return PATTERNS.shotArc.build(ctx);
      const center = rng.next() < 0.5 ? ctx.playerAngle : predict(ctx, ws + p.sectorWarn);
      return [makeSector('arcSector', ws, p.sectorWarn, p.sectorActive, center, p.sectorHalfWidth), arc];
    },
  },
  spiralArc: {
    id: 'spiralArc', family: 'combo', name: 'Spirale + arc électrique', cost: 2.2,
    build(ctx) {
      const { p } = ctx;
      const ws = ctx.now;
      const sp = spiralArms(ctx, 'spiralArc', ws + p.comboStagger, 1);
      const side = ctx.rng.sign();
      const center = predict(ctx, ws + p.sectorWarn) + side * ctx.rng.range(1.0, 1.8);
      return [makeSector('spiralArc', ws, p.sectorWarn, p.sectorActive, center, p.sectorHalfWidth * 0.9), ...sp];
    },
  },
  beamShot: {
    id: 'beamShot', family: 'combo', name: 'Faisceau + tir', cost: 2.3,
    build(ctx) {
      const { rng, p } = ctx;
      const ws = ctx.now;
      const beams = rotatingBeams(ctx, 'beamShot', ws, 1);
      const aim = predict(ctx, ws + p.projectileWarn + approachTime(p.projectileSpeed)) + rng.range(-0.6, 0.6);
      return [...beams, shotThrough(ctx, 'beamShot', ws + p.comboStagger * 2, aim, rng.range(1.8, 2.6))];
    },
  },
};

// ————————————————————————————————————————————— menaces de la phase 2 (constructions)

const CAPS_LASER_WARN = 0.9;

/** Vitesse du vaisseau → rotation des faisceaux : même adaptation que le laser de la phase 1 (le vaisseau lent tolère des faisceaux plus lents). */
function paceBeam(ctx: PatternContext): number {
  const m = ctx.speed(ctx.now);
  return m >= 1 ? 1 : Math.pow(1 / m, 0.8);
}

/** Grand arc : part d'un côté, plonge vers le centre au niveau de l'angle visé et ressort de l'autre côté. `stagger` retarde le départ. */
function bigArc(ctx: PatternContext, pattern: string, warnStart: number, stagger: number): (Hazard & { kind: 'projectile' }) | null {
  const { rng, p } = ctx;
  const speed = p.projectileSpeed * ARC_SHOT.speedScale;
  const warn = p.projectileWarn + ARC_SHOT.extraWarn;
  const aimA = aimAngle(ctx, warnStart + warn + approachTime(speed));
  const depth = rng.range(ARC_SHOT.depth.min, ARC_SHOT.depth.max);
  const spread = rng.range(ARC_SHOT.spread.min, ARC_SHOT.spread.max);
  const asym = rng.range(0.8, 1.2);
  const side = rng.sign();
  const a0 = aimA - side * spread;
  const a2 = aimA + side * spread * asym;
  const h = makeArcProjectile(
    pattern, warnStart + stagger, warn, speed,
    [S * Math.cos(a0), S * Math.sin(a0)],
    [depth * Math.cos(aimA), depth * Math.sin(aimA)],
    [S * Math.cos(a2), S * Math.sin(a2)],
  );
  return h;
}

/** Spirale à 1 à 3 bras : chaque bras est un projectile qui tourne en entrant (ou en sortant) ; les bras partent à quelques dixièmes d'intervalle. */
function spiralArms(ctx: PatternContext, pattern: string, warnStart: number, maxArms: number = SPIRAL.arms.max): Hazard[] {
  const { rng, p } = ctx;
  const speed = p.projectileSpeed * SPIRAL.speedScale;
  const warn = p.projectileWarn + SPIRAL.extraWarn;
  const arms = rng.int(SPIRAL.arms.min, Math.min(maxArms, SPIRAL.arms.max));
  const spin = rng.sign() * rng.range(SPIRAL.spin.min, SPIRAL.spin.max);
  const outward = rng.next() < SPIRAL.outwardShare;
  const r0 = outward ? 30 : S;
  const vr = outward ? speed : -speed;
  const tc = (R - r0) / vr; // durée jusqu'à l'orbite
  const aim = predict(ctx, warnStart + warn + tc) + rng.range(-0.5, 0.5);
  const base = aim - spin * tc;
  const stagger = rng.range(SPIRAL.armStagger.min, SPIRAL.armStagger.max);
  const out: Hazard[] = [];
  for (let k = 0; k < arms; k++) {
    out.push(makeSpiralProjectile(pattern, warnStart + k * stagger, warn, r0, vr, base + (k * TAU) / arms, spin));
  }
  return out;
}

/** Faisceaux rotatifs : un rayon (ou deux, opposés) qui tourne pendant quelques secondes, bien plus lentement que le vaisseau. */
function rotatingBeams(ctx: PatternContext, pattern: string, warnStart: number, maxBeams = 2): Hazard[] {
  const { rng, p } = ctx;
  const ws = warnStart;
  const warn = Math.max(CAPS_LASER_WARN, ROT_BEAM.warn * Math.min(1.2, (p.laserWarn / 1.15) ** 0.5));
  const rate = (rng.range(ROT_BEAM.rate.min, ROT_BEAM.rate.max) / paceBeam(ctx)) * rng.sign();
  const dur = rng.range(ROT_BEAM.duration.min, ROT_BEAM.duration.max);
  const span = Math.abs(rate) * dur;
  const start = predict(ctx, ws + warn) + rng.sign() * rng.range(1.3, 2.4);
  const n = maxBeams >= 2 && rng.next() < ROT_BEAM.twinShare ? 2 : 1;
  const out: Hazard[] = [];
  for (let i = 0; i < n; i++) {
    const b = makeLaser(pattern, ws, warn, start + (i * Math.PI), rate, span, ROT_BEAM.half);
    b.rotating = true;
    b.coverage = ROT_BEAM.coverage;
    out.push(b);
  }
  return out;
}

/**
 * Faisceaux alternés : 2 directions annoncées d'emblée, activées l'une après l'autre sur les battements de la musique (grille de rythme :
 * mêmes instants pour tous, son coupé ou non). Chaque étape est un secteur très fin actif pendant un battement.
 */
function alternatingBeams(ctx: PatternContext, pattern: string, warnStart: number): Hazard[] {
  const { rng, p } = ctx;
  const ws = warnStart;
  const b = beatPeriodAt(ws) * ALT_BEAMS.beatsPerStep;
  const first = nextBeat(ws + Math.max(ALT_BEAMS.warn, p.sectorWarn));
  const steps = rng.int(ALT_BEAMS.steps.min, ALT_BEAMS.steps.max);
  const sep = rng.range(ALT_BEAMS.spread.min, ALT_BEAMS.spread.max) * rng.sign();
  const c0 = predict(ctx, first) + rng.range(-0.8, 0.8);
  const dirs = [c0, c0 + sep];
  const out: Hazard[] = [];
  for (let i = 0; i < steps; i++) {
    const at = first + i * b;
    out.push(makeSector(pattern, ws, at - ws, b * 0.92, dirs[i % 2], ALT_BEAMS.half));
  }
  return out;
}

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

export const FAMILY_INTRO: Record<Family, string> = {
  projectile: 'Projectile : la ligne pointillée annonce sa trajectoire, les croix montrent où il coupe l’orbite.',
  sector: 'Secteur électrique : quittez ou traversez la zone pointillée avant qu’elle ne s’allume.',
  combo: 'Attaque combinée : esquivez la première menace en anticipant la seconde.',
  fragment: 'Astéroïde fragmenté : après avoir traversé l’orbite il se divise ; les trajectoires des deux fragments sont annoncées.',
  convoy: 'Convoi : plusieurs astéroïdes suivent la même trajectoire, l’un après l’autre. Anticipez les suivants.',
  laser: 'Laser balayeur : un rayon pivote sur la zone annoncée. Rejoignez la zone de refuge, en dehors de l’arc.',
  rhythm: 'Tirs en rythme : les passages sur l’orbite tombent sur les battements de la musique.',
  bigarc: 'Grand arc : le projectile décrit une courbe ; la trajectoire entière est tracée.',
  spiral: 'Spirale : un ou plusieurs projectiles tournent en entrant (ou en sortant) ; suivez le tracé.',
  rotbeam: 'Faisceau rotatif : un rayon tourne lentement, bien moins vite que votre vaisseau. Gardez vos distances.',
  sweepbeam: 'Faisceau balayeur : un rayon balaie une large zone annoncée ; la zone de refuge est de l’autre côté.',
  altbeams: 'Faisceaux alternés : les directions annoncées s’allument l’une après l’autre, sur le rythme.',
};

export type PatternWeights = Partial<Record<PatternId, number>>;
