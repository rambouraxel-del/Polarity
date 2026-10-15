import { ACHIEVEMENT_CONFIG, type AchievementConfig, type MetricKey } from '../config/achievements';
import { WALLET_MAX } from '../config/economy';
import type { SaveData } from '../save/save';
import type { RunSummary } from './progress';

/** Succès : données dans config/achievements.ts ; la progression est calculée ici à partir de la sauvegarde. */
export type AchievementDef = AchievementConfig;
export const ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENT_CONFIG;

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
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
  /** Médailles déjà récupérées. */
  claimed: boolean;
}

export function achievementProgress(save: SaveData, a: AchievementDef): AchievementProgress {
  const earned = save.achievements[a.id] !== undefined;
  const value = metricValue(save, a.metric);
  const shown = earned ? Math.max(value, a.target) : value;
  return { value: Math.min(shown, a.target), target: a.target, ratio: Math.min(1, shown / a.target), earned, claimed: save.medals.claimed.includes(a.id) };
}

/**
 * Débloque les succès dont l'objectif est atteint. Un succès ne verse PLUS rien automatiquement : il devient RÉCLAMABLE (bouton « Récupérer »),
 * et ses Médailles ne sont créditées qu'à la réclamation (une seule fois, registre `medals.claimed`). Aucun cosmétique n'est débloqué directement.
 * Renvoie les succès nouvellement obtenus.
 */
export function unlockAchievements(save: SaveData, run: RunSummary | undefined, now: number): AchievementDef[] {
  const gained: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.achievements[a.id] !== undefined || metricValue(save, a.metric, run) < a.target) continue;
    save.achievements[a.id] = now;
    gained.push(a);
  }
  return gained;
}

/** Au démarrage : succès devenus atteignables grâce à la progression existante (nouveaux objectifs). Aucun versement. */
export function reconcileAchievements(save: SaveData, now = Date.now()): AchievementDef[] {
  return unlockAchievements(save, undefined, now);
}

// ————————————————————————— Médailles : réclamation

/** Succès accompli dont les Médailles n'ont pas encore été récupérées. */
export function isClaimable(save: SaveData, id: string): boolean {
  return save.achievements[id] !== undefined && !save.medals.claimed.includes(id) && achievementById(id) !== undefined;
}

export function claimableAchievements(save: SaveData): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => isClaimable(save, a.id));
}

/** Total de Médailles à récupérer. */
export function claimableMedals(save: SaveData): number {
  return claimableAchievements(save).reduce((t, a) => t + a.medals, 0);
}

export type ClaimResult = { ok: true; achievement: AchievementDef; medals: number; balance: number } | { ok: false; reason: 'unknown' | 'not_earned' | 'already' };

/**
 * Réclame les Médailles d'UN succès : inscription au registre et crédit dans la même modification de la sauvegarde. Une récompense ne peut être
 * réclamée qu'une seule fois (l'identifiant historique du succès est la clé). Le crédit local est provisoire jusqu'à la confirmation du service.
 */
export function claimMedals(save: SaveData, id: string): ClaimResult {
  const a = achievementById(id);
  if (!a) return { ok: false, reason: 'unknown' };
  if (save.achievements[id] === undefined) return { ok: false, reason: 'not_earned' };
  if (save.medals.claimed.includes(id)) return { ok: false, reason: 'already' };
  save.medals.claimed.push(id);
  save.wallet.medals = Math.min(WALLET_MAX, save.wallet.medals + a.medals);
  return { ok: true, achievement: a, medals: a.medals, balance: save.wallet.medals };
}

/** Réclame tous les succès accomplis. Renvoie les réclamations réussies. */
export function claimAllMedals(save: SaveData): { claimed: AchievementDef[]; medals: number } {
  const claimed: AchievementDef[] = [];
  for (const a of claimableAchievements(save)) if (claimMedals(save, a.id).ok) claimed.push(a);
  return { claimed, medals: claimed.reduce((t, a) => t + a.medals, 0) };
}
