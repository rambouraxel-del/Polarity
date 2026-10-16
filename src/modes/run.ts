import { LEVEL_DURATION } from '../config/balance';
import { SHARDS } from '../config/economy';
import type { MissionDef } from '../config/campaign';
import type { LevelDef } from '../config/levels';
import type { ActiveUpgrades } from '../campaign/simulation';
import type { RunMode } from '../progression/progress';
import { Simulation } from '../sim/simulation';
import { dailySeed } from './daily';
import { levelProfile, survivalProfile } from './profiles';

export interface RunConfig {
  mode: RunMode;
  seed: number;
  level?: LevelDef;
  /** Date UTC du défi quotidien. */
  date?: string;
  /** Campagne : mission et améliorations actives (jamais utilisées par les autres modes). */
  mission?: MissionDef;
  upgrades?: ActiveUpgrades;
  /** Survie : charges de Boost et de Gel achetées disponibles pour la première vie (le rejeu du serveur passe Infinity et vérifie les stocks à part). */
  stock?: { boost: number; gel: number };
  /** Survie : mode choisi au départ. false = « Sans bonus » (aucun pouvoir) ; true/absent = « Avec bonus ». */
  bonus?: boolean;
  /**
   * Partie de TEST (mode développeur, Survie seulement) : vaisseau immortel, obstacles et animations inchangés. Une telle partie n'est jamais comptabilisée
   * (classement, record, gains, succès, cosmétiques) ni envoyée au service ; le rejeu du service ne définit jamais ce champ.
   */
  test?: boolean;
}

/** Les trois modes partagent exactement la même simulation ; seuls la courbe et la durée changent. */
export function createSimulation(cfg: RunConfig): Simulation {
  // La campagne a sa propre simulation (campaign/simulation.ts) : cette fabrique sert aussi au rejeu du serveur et reste inchangée
  if (cfg.mode === 'campaign') throw new Error('Mission de campagne : utiliser CampaignSimulation');
  if (cfg.mode === 'level') {
    if (!cfg.level) throw new Error('Niveau manquant');
    return new Simulation({ seed: cfg.seed, profile: levelProfile(cfg.level), timeLimit: LEVEL_DURATION });
  }
  const seed = cfg.mode === 'daily' && cfg.date ? dailySeed(cfg.date) : cfg.seed;
  // Éclats sur l'orbite : réglage par mode dans config/economy.ts (Survie seulement pour l'instant)
  const shards = cfg.mode === 'daily' ? SHARDS.modes.daily : SHARDS.modes.survival;
  // Pouvoirs : Survie seulement (jamais le défi quotidien, les niveaux ni la campagne)
  return new Simulation({ seed, profile: survivalProfile(shards, cfg.mode === 'survival'), timeLimit: null, powers: cfg.mode === 'survival' ? { stock: cfg.stock, bonus: cfg.bonus } : undefined, invincible: cfg.test === true && cfg.mode === 'survival' });
}
