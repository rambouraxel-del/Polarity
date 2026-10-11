import { LEVEL_DURATION } from '../config/balance';
import type { LevelDef } from '../config/levels';
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
}

/** Les trois modes partagent exactement la même simulation ; seuls la courbe et la durée changent. */
export function createSimulation(cfg: RunConfig): Simulation {
  if (cfg.mode === 'level') {
    if (!cfg.level) throw new Error('Niveau manquant');
    return new Simulation({ seed: cfg.seed, profile: levelProfile(cfg.level), timeLimit: LEVEL_DURATION });
  }
  const seed = cfg.mode === 'daily' && cfg.date ? dailySeed(cfg.date) : cfg.seed;
  return new Simulation({ seed, profile: survivalProfile(), timeLimit: null });
}
