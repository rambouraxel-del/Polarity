import { SIM } from '../src/config/balance';
import { POWER_BY_CODE } from '../src/config/powers';
import { createSimulation } from '../src/modes/run';
import { LIMITS, type Category } from '../src/net/protocol';

/**
 * Validation d'une partie de Survie par REJEU : même code de simulation que le jeu, même graine, mêmes entrées (inversions ET activations de
 * pouvoirs, en pas de simulation). Le résultat (durée, score, catégorie) est celui calculé ici ; aucune valeur du client n'est crue.
 *
 * Le rejeu s'arrête à la PREMIÈRE mort : la tentative classée est indépendante des reprises ultérieures. Le service rejoue avec des charges
 * illimitées (le stock du joueur est vérifié à part, dans le registre) : chaque activation est jugée par la simulation (recharge, durée,
 * exclusivité Boost/Gel, plafond de 3, jauge du Bouclier). Une activation que la simulation refuserait prouve un journal falsifié.
 */
export type ReplayResult =
  | {
      ok: true;
      steps: number;
      time: number;
      score: number;
      cycles: number;
      flips: number;
      /** Activations réussies pendant la première vie (charges consommées et Boucliers). */
      powers: { boost: number; gel: number; shield: number };
      category: Category;
      /** Balises collectées pendant la première vie (le drop rare de Prismes est tiré une fois par balise). */
      beacons: number;
    }
  | { ok: false; reason: 'bad_replay' | 'not_finished' | 'inputs_after_end' | 'bad_powers' };

export function replaySurvival(seed: number, flips: readonly number[], acts: readonly (readonly [number, number])[] = [], maxSteps: number = LIMITS.maxSteps, declared?: Category): ReplayResult {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return { ok: false, reason: 'bad_replay' };
  const sim = createSimulation({ mode: 'survival', seed, stock: { boost: Infinity, gel: Infinity }, bonus: declared !== 'plain' });
  let next = 0;
  let nextAct = 0;
  for (let step = 0; step < maxSteps && sim.state === 'running'; step++) {
    // Les entrées d'un pas sont demandées juste avant ce pas, comme dans le jeu (appliquées au début du pas : inversions puis pouvoirs)
    while (next < flips.length && flips[next] === step) {
      sim.flip();
      next++;
    }
    while (nextAct < acts.length && acts[nextAct][0] === step) {
      sim.power(POWER_BY_CODE[acts[nextAct][1]]);
      nextAct++;
    }
    sim.step();
    sim.events.length = 0;
    // Une activation refusée par les règles : le client n'aurait jamais pu la journaliser
    if (sim.powers.rejected > 0) return { ok: false, reason: 'bad_powers' };
  }
  if (sim.state !== 'dead') return { ok: false, reason: 'not_finished' };
  // Une entrée après la mort (ou sautée) n'a pas pu être jouée : journal incohérent
  if (next !== flips.length || nextAct !== acts.length) return { ok: false, reason: 'inputs_after_end' };
  const powers = { ...sim.powers.used };
  // Mode déclaré au départ : « Sans bonus » a interdit tout pouvoir pendant le rejeu ; sinon (ancien client) déduction par les activations
  const category: Category = declared ?? (powers.boost + powers.gel + powers.shield > 0 ? 'bonus' : 'plain');
  return { ok: true, steps: sim.stepIndex, time: sim.stepIndex * SIM.dt, score: sim.scoring.score, cycles: sim.scoring.cycles, flips: flips.length, powers, category, beacons: sim.scoring.beacons };
}

/**
 * Rejeu d'une tentative du DÉFI QUOTIDIEN : graine dérivée de la date UTC, mêmes règles que le jeu, AUCUN pouvoir (le Défi n'en a jamais).
 * Résultat = durée (pas de simulation) et score recalculés ; rien de ce qu'annonce le client n'est cru.
 */
export type DailyReplayResult = { ok: true; steps: number; time: number; score: number } | { ok: false; reason: 'bad_replay' | 'not_finished' | 'inputs_after_end' };

export function replayDaily(date: string, flips: readonly number[], maxSteps: number = LIMITS.maxSteps): DailyReplayResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'bad_replay' };
  const sim = createSimulation({ mode: 'daily', seed: 0, date });
  let next = 0;
  for (let step = 0; step < maxSteps && sim.state === 'running'; step++) {
    while (next < flips.length && flips[next] === step) {
      sim.flip();
      next++;
    }
    sim.step();
    sim.events.length = 0;
  }
  if (sim.state !== 'dead') return { ok: false, reason: 'not_finished' };
  if (next !== flips.length) return { ok: false, reason: 'inputs_after_end' };
  return { ok: true, steps: sim.stepIndex, time: sim.stepIndex * SIM.dt, score: sim.scoring.score };
}
