import { LEVEL_DURATION } from '../config/balance';
import type { LevelDef } from '../config/levels';
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

export function survivalProfile(): DifficultyProfile {
  return {
    difficulty: survivalDifficulty,
    weights: survivalWeights,
    intervalScale: survivalIntervalScale,
    breath: survivalBreath,
    warnScale: SURVIVAL.warnScale,
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
    firstWaveDelay: 1.8,
    // Plus de nouvelle vague dans la dernière seconde : elles n'auraient pas le temps d'arriver.
    spawnUntil: LEVEL_DURATION - 1,
    respite: false,
  };
}
