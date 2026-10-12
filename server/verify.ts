import { SIM } from '../src/config/balance';
import { createSimulation } from '../src/modes/run';
import { LIMITS } from '../src/net/protocol';

/**
 * Validation d'une partie de Survie par REJEU : même code de simulation que le jeu, même graine, mêmes entrées.
 * Le résultat (durée, score) est celui calculé ici ; aucune valeur du client n'est crue.
 */
export type ReplayResult =
  | { ok: true; steps: number; time: number; score: number; cycles: number; flips: number }
  | { ok: false; reason: 'bad_replay' | 'not_finished' | 'inputs_after_end' };

export function replaySurvival(seed: number, flips: readonly number[], maxSteps: number = LIMITS.maxSteps): ReplayResult {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return { ok: false, reason: 'bad_replay' };
  const sim = createSimulation({ mode: 'survival', seed });
  let next = 0;
  for (let step = 0; step < maxSteps && sim.state === 'running'; step++) {
    // Les inversions d'un pas sont demandées juste avant ce pas, comme dans le jeu (appliquées au début du pas)
    while (next < flips.length && flips[next] === step) {
      sim.flip();
      next++;
    }
    sim.step();
    sim.events.length = 0;
  }
  if (sim.state !== 'dead') return { ok: false, reason: 'not_finished' };
  // Une inversion après la mort (ou sautée) n'a pas pu être jouée : journal incohérent
  if (next !== flips.length) return { ok: false, reason: 'inputs_after_end' };
  return { ok: true, steps: sim.stepIndex, time: sim.stepIndex * SIM.dt, score: sim.scoring.score, cycles: sim.scoring.cycles, flips: flips.length };
}
