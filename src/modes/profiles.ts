import { LEVEL_DURATION, SURVIVAL } from '../config/balance';
import type { LevelDef } from '../config/levels';
import { clamp } from '../core/math';
import { smoothstep } from '../sim/difficulty';
import type { DifficultyProfile } from '../sim/director';
import type { PatternWeights } from '../sim/patterns';

/** Rampe douce de 0 à 1 entre `from` et `from + span`. */
function ramp(t: number, from: number, span: number): number {
  return smoothstep((t - from) / span);
}

/**
 * Survie : la difficulté monte en continu, d(t) = dMax · (1 − e^(−t/τ)), sans jamais dépasser dMax.
 * Au-delà, ce sont la variété des motifs, le rythme et les respirations qui évoluent.
 */
export function survivalDifficulty(t: number): number {
  return SURVIVAL.dMax * (1 - Math.exp(-Math.max(0, t) / SURVIVAL.tau));
}

export function survivalWeights(t: number): PatternWeights {
  const u = SURVIVAL.unlock;
  const sector = ramp(t, u.sector, 15);
  const dbl = ramp(t, u.doubleProjectile, 20);
  const combo = ramp(t, u.combo, 25);
  const adv = ramp(t, u.advanced, 40);
  // Les motifs simples deviennent moins fréquents sans disparaître : ils servent de respiration.
  const simple = 1 - 0.45 * adv;
  return {
    shot: 1 * simple,
    diameter: 0.5 * simple,
    arc: 0.9 * sector * simple,
    parallel: 0.7 * dbl,
    cross: 0.6 * dbl,
    twinArcs: 0.5 * dbl * sector,
    shotArc: 0.8 * combo,
    chase: 0.6 * combo,
    echo: 0.6 * combo,
    burst: 0.6 * adv,
    pincer: 0.6 * adv,
  };
}

export function survivalIntervalScale(t: number): number {
  // Modulation lente du rythme, introduite après la phase d'apprentissage
  const amp = SURVIVAL.rhythmAmplitude * ramp(t, 60, 60);
  return 1 + amp * Math.sin((2 * Math.PI * t) / SURVIVAL.rhythmPeriod);
}

export function survivalProfile(): DifficultyProfile {
  return {
    difficulty: survivalDifficulty,
    weights: survivalWeights,
    intervalScale: survivalIntervalScale,
    firstWaveDelay: SURVIVAL.firstWaveDelay,
    breaths: true,
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
      if (level.lateWeights) scaleWeights(level.lateWeights, ramp(t, level.lateFrom ?? 30, 10), out);
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
    breaths: false,
    // Plus de nouvelle vague dans la dernière seconde : elles n'auraient pas le temps d'arriver.
    spawnUntil: LEVEL_DURATION - 1,
    respite: false,
  };
}
