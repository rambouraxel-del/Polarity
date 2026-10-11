import type { DifficultyProfile } from '../src/sim/director';
import { Simulation } from '../src/sim/simulation';

/** Profil sans aucune vague : pour tester le déplacement et les balises isolément. */
export const emptyProfile: DifficultyProfile = {
  difficulty: () => 0,
  weights: () => ({}),
  intervalScale: () => 1,
  firstWaveDelay: 1e9,
  spawnUntil: null,
  respite: true,
};

export function quietSim(timeLimit: number | null = null): Simulation {
  return new Simulation({ seed: 1, profile: emptyProfile, timeLimit });
}
