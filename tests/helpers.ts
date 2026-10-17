import { CATALOG, type CatalogItem } from '../src/config/catalog';
import type { DifficultyProfile } from '../src/sim/director';
import { Simulation } from '../src/sim/simulation';

/** Profil sans aucune vague : pour tester le déplacement et les balises isolément. */
export const emptyProfile: DifficultyProfile = {
  difficulty: () => 0,
  weights: () => ({}),
  intervalScale: () => 1,
  speed: () => 1,
  firstWaveDelay: 1e9,
  spawnUntil: null,
  respite: true,
};

export function quietSim(timeLimit: number | null = null): Simulation {
  return new Simulation({ seed: 1, profile: emptyProfile, timeLimit });
}

/**
 * Pack factice (le catalogue actuel ne contient plus aucun pack, mais la logique de pack reste dans le code) : prix en Prismes,
 * contenus = articles « au choix ». À retirer (valeur renvoyée) en `afterEach` / `finally`.
 */
export const TEST_PACK_ID = 'pack-test';
export function addTestPack(amount = 100, contents: string[] = ['long-courrier', 'basalte']): () => void {
  const pack: CatalogItem = { id: TEST_PACK_ID, kind: 'pack', name: 'Pack test', blurb: 'Pack factice (tests).', acquire: { type: 'price', currency: 'prisms', amount }, contents };
  CATALOG.push(pack);
  return () => {
    const i = CATALOG.indexOf(pack);
    if (i >= 0) CATALOG.splice(i, 1);
  };
}
