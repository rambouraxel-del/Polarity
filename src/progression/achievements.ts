import { ACHIEVEMENT_CONFIG, type AchievementConfig, type MetricKey } from '../config/achievements';
import { CATALOG, type CatalogItem } from '../config/catalog';
import type { SaveData } from '../save/save';
import type { RunSummary } from './progress';

/** Succès : données dans config/achievements.ts ; la progression est calculée ici à partir de la sauvegarde. */
export type AchievementDef = AchievementConfig;
export const ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENT_CONFIG;

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Cosmétiques débloqués par un succès (lien décrit au catalogue). */
export function achievementCosmetics(id: string): CatalogItem[] {
  return CATALOG.filter((i) => i.acquire.type === 'achievement' && i.acquire.id === id);
}

const levels = (save: SaveData) => Object.values(save.levels);

/** Valeur courante de chaque grandeur ; `run` (facultatif) prend en compte la partie qui vient de se terminer. */
export function metricValue(save: SaveData, key: MetricKey, run?: RunSummary): number {
  switch (key) {
    case 'totalCycles': return save.stats.totalCycles;
    case 'levelsCompleted': return levels(save).filter((l) => l.completed).length;
    case 'totalStars': return levels(save).reduce((t, l) => t + l.stars, 0);
    case 'threeStarLevels': return levels(save).filter((l) => l.stars >= 3).length;
    case 'survivalRuns': return save.survival.runs + Object.values(save.archive).reduce((t, a) => t + a.survival.runs, 0);
    case 'bestSurvival': {
      let best = Math.max(save.survival.bestTime, ...Object.values(save.archive).map((a) => a.survival.bestTime));
      if (run?.mode === 'survival') best = Math.max(best, run.time);
      return best;
    }
    case 'bestDaily': {
      let best = 0;
      for (const d of Object.values(save.daily)) best = Math.max(best, d.bestTime);
      for (const a of Object.values(save.archive)) for (const d of Object.values(a.daily)) best = Math.max(best, d.bestTime);
      if (run?.mode === 'daily') best = Math.max(best, run.time);
      return best;
    }
    case 'totalEvents': return save.stats.totalEvents;
    case 'totalShards': return save.stats.totalShards;
    case 'bestScore': return save.stats.bestScore;
    case 'maxMultiplier': return save.stats.bestMultiplier;
  }
}

export interface AchievementProgress {
  value: number;
  target: number;
  /** Fraction accomplie, entre 0 et 1. */
  ratio: number;
  earned: boolean;
  /** Récompense déjà versée. */
  rewarded: boolean;
}

export function achievementProgress(save: SaveData, a: AchievementDef): AchievementProgress {
  const earned = save.achievements[a.id] !== undefined;
  const value = metricValue(save, a.metric);
  const shown = earned ? Math.max(value, a.target) : value;
  return { value: Math.min(shown, a.target), target: a.target, ratio: Math.min(1, shown / a.target), earned, rewarded: save.rewarded.includes(a.id) };
}

/**
 * Débloque les succès dont l'objectif est atteint et verse chaque récompense **une seule fois** (registre `save.rewarded`).
 * Renvoie les succès nouvellement obtenus. Un succès déjà obtenu n'est jamais re-versé.
 */
export function unlockAchievements(save: SaveData, run: RunSummary | undefined, now: number): AchievementDef[] {
  const gained: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.achievements[a.id] !== undefined || metricValue(save, a.metric, run) < a.target) continue;
    // Déblocage et versement dans la même modification de la sauvegarde (une seule écriture ensuite).
    // Le registre `rewarded` est la garantie finale : un identifiant déjà versé n'est jamais re-versé ni re-notifié,
    // même si la sauvegarde est incohérente (succès effacé à la main, copie ancienne…).
    save.achievements[a.id] = now;
    if (save.rewarded.includes(a.id)) continue;
    save.rewarded.push(a.id);
    save.wallet.shards += a.shards;
    gained.push(a);
  }
  return gained;
}

/**
 * Au démarrage : succès devenus atteignables grâce à la progression existante (nouveaux objectifs).
 * Les gains sont mémorisés dans `save.rewardNotice` pour une notification à l'accueil.
 */
export function reconcileAchievements(save: SaveData, now = Date.now()): AchievementDef[] {
  const gained = unlockAchievements(save, undefined, now);
  if (gained.length > 0) addRewardNotice(save, gained);
  return gained;
}

export function addRewardNotice(save: SaveData, gained: readonly AchievementDef[]): void {
  const shards = gained.reduce((t, a) => t + a.shards, 0);
  const old = save.rewardNotice ?? { shards: 0, count: 0 };
  save.rewardNotice = { shards: old.shards + shards, count: old.count + gained.length };
}
