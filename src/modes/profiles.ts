import { LEVEL_DURATION } from '../config/balance';
import type { LevelDef } from '../config/levels';
import { survivalSpeedFactor } from '../config/playerSpeed';
import { PHASES } from '../config/phases';
import { SURVIVAL, type Ramp } from '../config/survival';
import { clamp } from '../core/math';
import { smoothstep } from '../sim/difficulty';
import type { DifficultyProfile } from '../sim/director';
import type { PatternWeights } from '../sim/patterns';

/** Rampe douce de 0 à 1 entre `from` et `from + span`. */
function ramp(t: number, r: Ramp): number {
  return smoothstep((t - r.from) / r.span);
}

/**
 * Survie : d(t) = dMax · (1 − e^(−t/τ)), sans jamais dépasser dMax.
 * Au-delà, ce sont la variété des motifs, le rythme et les respirations qui évoluent.
 */
export function survivalDifficulty(t: number, tau: number = SURVIVAL.tau): number {
  return SURVIVAL.dMax * (1 - Math.exp(-Math.max(0, t) / tau));
}

/** Motifs « simples » (une seule menace) : ils servent aussi de respiration. */
const SIMPLE = ['shot', 'diameter', 'arc'] as const;

export function survivalWeights(t: number): PatternWeights {
  const u = SURVIVAL.unlock;
  const sector = ramp(t, u.sector);
  const dbl = ramp(t, u.doubles);
  const dbl2 = ramp(t, u.doublesLate);
  const combo = ramp(t, u.combo);
  const adv = ramp(t, u.advanced);
  const boost = 1 + SURVIVAL.comboBoost.extra * ramp(t, SURVIVAL.comboBoost.ramp);
  const simple = 1 - SURVIVAL.simpleFade.amount * ramp(t, SURVIVAL.simpleFade.ramp);
  // Après 3 minutes, les motifs complexes pèsent davantage
  const intense = ramp(t, SURVIVAL.intensify.ramp);
  const complex = 1 + SURVIVAL.intensify.complexBoost * intense;
  const w: PatternWeights = {
    shot: 1 * simple,
    diameter: 0.5 * simple,
    arc: 0.9 * sector * simple,
    parallel: 0.7 * dbl * complex,
    cross: 0.6 * dbl * complex,
    twinArcs: 0.5 * dbl2 * sector * complex,
    echo: 0.6 * dbl2 * complex,
    chase: 0.6 * dbl2 * sector * complex,
    shotArc: 0.8 * combo * boost * complex,
    burst: 0.6 * adv * complex,
    pincer: 0.6 * adv * boost * complex,
    // Nouveaux dangers : introduits progressivement (convoi → astéroïde fragmenté → laser balayeur)
    convoy: 0.7 * ramp(t, u.convoy) * complex,
    fragment: 0.7 * ramp(t, u.fragment) * complex,
    laser: 1.0 * ramp(t, u.laser) * complex,
  };
  for (const id of SIMPLE) w[id] = (w[id] ?? 0) * (1 - 0.25 * intense);
  return w;
}

/** Intervalle entre vagues : modulation lente, plus serré pendant les séquences intenses. */
export function survivalIntervalScale(t: number): number {
  const r = SURVIVAL.rhythm;
  const amp = r.amplitude * ramp(t, r.ramp);
  const tight = 1 - (1 - SURVIVAL.intensify.tightness) * ramp(t, SURVIVAL.intensify.ramp);
  return tight * (1 + amp * Math.sin((2 * Math.PI * t) / r.period));
}

/** Respirations : espacées avant 3 minutes, plus fréquentes mais brèves ensuite. */
export function survivalBreath(t: number) {
  return t < SURVIVAL.intensify.ramp.from ? SURVIVAL.breath : SURVIVAL.intensify;
}

// ————————————————————————————————————————————— Survie à PHASES (mode « Survie » seulement ; le défi quotidien garde les règles ci-dessus)

/** Palier de la phase 1 : niveau de base à l'instant t (montées lissées sur `stages.ramp` s, la montée se TERMINE à l'instant indiqué). */
function stageBase(t: number): number {
  const { levels, ramp: r } = SURVIVAL.stages;
  let d = levels[0][1];
  for (let i = 1; i < levels.length; i++) d += (levels[i][1] - levels[i - 1][1]) * smoothstep((t - (levels[i][0] - r)) / r);
  return d;
}

/**
 * Difficulté de la Survie à phases. Phase 1 : paliers + vague de tension (jamais au-dessus de dMax). Phase 2 : reprend au dernier palier
 * (sans hausse brutale) puis monte lentement vers dMax, plafond jamais dépassé : la phase 2 reste infinie sans configuration impossible.
 */
export function phasedDifficulty(t: number): number {
  const tens = SURVIVAL.stages.tension;
  const wave = tens.amplitude * smoothstep((t - tens.from) / 30) * Math.sin((2 * Math.PI * t) / tens.period);
  if (t < PHASES.phase2At) return clamp(stageBase(t) + wave, 0, SURVIVAL.dMax);
  const p2 = SURVIVAL.phase2;
  const last = stageBase(PHASES.phase2At);
  const rise = (SURVIVAL.dMax - Math.max(last, p2.dStart)) * (1 - Math.exp(-(t - PHASES.phase2At) / p2.tau));
  // La vague de tension s'estompe entre 300 et 330 s : aucune hausse brutale à l'arrivée
  const fade = smoothstep((t - PHASES.phase2At) / 30);
  return clamp(Math.max(last, p2.dStart) + rise + wave * (0.5 + 0.5 * fade), 0, SURVIVAL.dMax);
}

/** Intensité de la phase 2 : 0 à l'entrée, tend vers 1 (rythme, poids des motifs complexes). */
export function phase2Intensity(t: number): number {
  return t < PHASES.phase2At ? 0 : 1 - Math.exp(-(t - PHASES.phase2At) / SURVIVAL.phase2.intensityTau);
}

/** Poids des motifs à phases : phase 1 = ceux de la Survie + tirs en rythme ; phase 2 = nouvelles menaces introduites une à une, puis combinées. */
export function phasedWeights(t: number): PatternWeights {
  const w = survivalWeights(t);
  if (t < PHASES.phase2At) {
    w.beatShots = 0.7 * ramp(t, { from: 50, span: 30 });
    return w;
  }
  const s = t - PHASES.phase2At;
  const u = SURVIVAL.phase2.unlock;
  const k = ramp(s, u.combos);
  const inten = phase2Intensity(t);
  const complex = 1 + 0.35 * inten;
  // Obstacles de la phase 1 : toujours présents, un peu moins pour laisser la place aux nouvelles menaces
  for (const id of Object.keys(w) as (keyof PatternWeights)[]) w[id] = (w[id] ?? 0) * 0.55;
  w.beatShots = 0.6;
  w.arcShot = 1.0 * ramp(s, u.arcShot) * complex;
  w.spiral = 0.9 * ramp(s, u.spiral) * complex;
  w.rotBeam = 0.8 * ramp(s, u.rotBeam) * complex;
  w.sweepBeam = 0.75 * ramp(s, u.sweepBeam) * complex;
  w.altBeams = 0.8 * ramp(s, u.altBeams) * complex;
  w.arcConvoy = 0.7 * ramp(s, u.combos) * complex;
  w.arcSector = 0.8 * k * complex;
  w.spiralArc = 0.8 * k * complex;
  w.beamShot = 0.8 * k * complex;
  return w;
}

/** Rythme : tension, calme avant chaque palier (phase 1), accélération lente et bornée (phase 2). */
export function phasedIntervalScale(t: number): number {
  if (t >= PHASES.phase2At) {
    const p2 = SURVIVAL.phase2;
    return 1 - (1 - p2.tightness) * phase2Intensity(t);
  }
  const base = survivalIntervalScale(t);
  const { levels, calm } = SURVIVAL.stages;
  // Calme : juste avant la montée vers un palier, les vagues s'espacent
  let k = 1;
  for (let i = 1; i < levels.length; i++) {
    const rampStart = levels[i][0] - SURVIVAL.stages.ramp;
    if (t >= rampStart - calm.lead && t < rampStart) k = Math.max(k, 1 + (calm.scale - 1) * smoothstep((t - (rampStart - calm.lead)) / 1.5));
  }
  return base * k;
}

export function phasedBreath(t: number) {
  return t >= PHASES.phase2At ? SURVIVAL.phase2.breath : survivalBreath(t);
}

export function phasedBeatChance(t: number): number {
  const [a, b] = SURVIVAL.beat.chance;
  return t < PHASES.phase2At ? a : b;
}

export function survivalProfile(shards = true, phased = false): DifficultyProfile {
  if (phased) {
    return {
      difficulty: phasedDifficulty,
      weights: phasedWeights,
      intervalScale: phasedIntervalScale,
      speed: survivalSpeedFactor,
      breath: phasedBreath,
      warnScale: SURVIVAL.warnScale,
      events: true,
      shards,
      firstWaveDelay: SURVIVAL.firstWaveDelay,
      spawnUntil: null,
      respite: true,
      phased: true,
      beatChance: phasedBeatChance,
    };
  }
  return {
    difficulty: survivalDifficulty,
    weights: survivalWeights,
    intervalScale: survivalIntervalScale,
    speed: survivalSpeedFactor,
    breath: survivalBreath,
    warnScale: SURVIVAL.warnScale,
    events: true,
    shards,
    firstWaveDelay: SURVIVAL.firstWaveDelay,
    spawnUntil: null,
    respite: true,
  };
}

function scaleWeights(w: PatternWeights, k: number, into: PatternWeights): void {
  for (const key of Object.keys(w) as (keyof PatternWeights)[]) {
    into[key] = (into[key] ?? 0) + (w[key] ?? 0) * k;
  }
}

export function levelProfile(level: LevelDef): DifficultyProfile {
  const pacing = level.pacing;
  return {
    difficulty(t) {
      const x = clamp(t / LEVEL_DURATION, 0, 1);
      // Départ lisible : les 8 premières secondes restent proches de dStart
      const shaped = pacing === 'crescendo' ? x * x : smoothstep(x) * 0.6 + x * 0.4;
      return level.dStart + (level.dEnd - level.dStart) * shaped;
    },
    weights(t) {
      const out: PatternWeights = {};
      scaleWeights(level.weights, 1, out);
      if (level.lateWeights) scaleWeights(level.lateWeights, ramp(t, { from: level.lateFrom ?? 30, span: 10 }), out);
      return out;
    },
    intervalScale(t) {
      if (pacing === 'pulse') {
        // Cycles de 12 s : 7 s serrées puis 5 s aérées
        const phase = t % 12;
        return phase < 7 ? 0.82 : 1.45;
      }
      if (pacing === 'crescendo') return 1.15 - 0.25 * clamp(t / LEVEL_DURATION, 0, 1);
      return 1;
    },
    speed: () => level.speed,
    firstWaveDelay: 1.8,
    // Plus de nouvelle vague dans la dernière seconde : elles n'auraient pas le temps d'arriver.
    spawnUntil: LEVEL_DURATION - 1,
    respite: false,
  };
}
