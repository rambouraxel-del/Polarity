import type { MissionReport } from '../campaign/simulation';
import { LEVEL_REWARDS } from '../config/economy';
import { noteEarned } from '../economy/local';
import { LEVELS, levelById, type LevelDef } from '../config/levels';
import { pruneDaily, type SaveData } from '../save/save';
import { unlockAchievements, type AchievementDef } from './achievements';

/** `campaign` : missions de la campagne (progression propre, voir campaign/progress.ts ; jamais envoyées au classement). */
export type RunMode = 'level' | 'survival' | 'daily' | 'campaign';

export interface RunSummary {
  mode: RunMode;
  levelId?: number;
  /** Date UTC du défi (AAAA-MM-JJ). */
  date?: string;
  /** Temps actif (s). */
  time: number;
  score: number;
  cycles: number;
  bestMultiplier: number;
  outcome: 'dead' | 'complete';
  /** Éclats collectés sur l'orbite pendant la partie (déjà crédités et sauvegardés à chaque collecte). */
  shards?: number;
  /** Événements (pluie de météores, tempête électrique) traversés pendant la partie. */
  events?: number;
  /** Campagne : mission jouée et bilan détaillé (voir campaign/progress.ts). */
  missionId?: number;
  report?: MissionReport;
}

/** Récompenses d'un niveau réussi (Éclats). */
export interface LevelReward {
  /** Bonus de première réussite (une seule fois par niveau). */
  firstClear: number;
  /** Étoiles obtenues pour la première fois, et leur récompense. */
  newStars: number;
  starReward: number;
  /** Réussite d'un niveau déjà réussi. */
  repeatClear: number;
  total: number;
}

export interface RunReport {
  run: RunSummary;
  /** Niveaux */
  stars: number;
  previousStars: number;
  previousBestScore: number;
  newBestScore: boolean;
  unlockedLevel: number | null;
  /** Survie et défi */
  previousBestTime: number;
  newRecord: boolean;
  /** Meilleur temps sous un ancien équilibrage (0 si aucun) : affiché à titre indicatif, jamais comparé. */
  legacyBestTime: number;
  /** Nouveaux succès (chacun rapporte des Éclats, versés une seule fois à ce moment-là). */
  achievements: AchievementDef[];
  /** Total des Éclats versés par ces succès. */
  achievementShards: number;
  /** Éclats collectés sur l'orbite (Survie) : déjà crédités pendant la partie. */
  orbitShards: number;
  /** Récompenses de niveau créditées à la fin de cette partie, ou null. */
  levelReward: LevelReward | null;
  /** Solde d'Éclats après cette partie (affiché tel quel : jamais recrédité à l'ouverture de l'écran). */
  shardsBalance: number;
}

/** Meilleur record de Survie obtenu sous un ancien équilibrage (non comparable aux records actuels), ou null. */
export function legacySurvivalBest(save: SaveData): { version: number; time: number; score: number } | null {
  let best: { version: number; time: number; score: number } | null = null;
  for (const [k, rec] of Object.entries(save.archive)) {
    if (rec.survival.bestTime <= 0) continue;
    if (!best || beatsRecord(rec.survival.bestTime, rec.survival.bestScore, best.time, best.score)) {
      best = { version: Number(k), time: rec.survival.bestTime, score: rec.survival.bestScore };
    }
  }
  return best;
}

/** Résultats du défi quotidien sous un ancien équilibrage, du plus récent au plus ancien. */
export function legacyDailyList(save: SaveData, limit = 5): { date: string; time: number; score: number }[] {
  const all: { date: string; time: number; score: number }[] = [];
  for (const rec of Object.values(save.archive)) {
    for (const [date, r] of Object.entries(rec.daily)) all.push({ date, time: r.bestTime, score: r.bestScore });
  }
  return all.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
}

export function hasLegacyRecords(save: SaveData): boolean {
  return legacySurvivalBest(save) !== null || legacyDailyList(save, 1).length > 0;
}

/** Le niveau 1 est toujours ouvert ; le niveau n s'ouvre quand le niveau n − 1 est réussi. */
export function isLevelUnlocked(save: SaveData, id: number): boolean {
  if (id <= 1) return true;
  return save.levels[String(id - 1)]?.completed === true;
}

export function starsFor(level: LevelDef, score: number): number {
  let s = 0;
  for (const t of level.stars) if (score >= t) s++;
  return s;
}

/** Vrai si (time, score) bat (bestTime, bestScore) : temps d'abord, score en départage. */
export function beatsRecord(time: number, score: number, bestTime: number, bestScore: number): boolean {
  const eps = 1e-6;
  if (time > bestTime + eps) return true;
  return Math.abs(time - bestTime) <= eps && score > bestScore;
}

/**
 * Verse les récompenses d'un niveau réussi : première réussite (une fois), nouvelles étoiles (jamais deux fois la même),
 * réussites suivantes. Le registre `save.paid` empêche tout second versement ; il est mis à jour avec le crédit.
 */
function payLevelReward(save: SaveData, key: string, starsNow: number): LevelReward {
  const paid = save.paid[key] ?? { first: false, stars: 0 };
  const firstClear = paid.first ? 0 : LEVEL_REWARDS.firstClear;
  const repeatClear = paid.first ? LEVEL_REWARDS.repeatClear : 0;
  const newStars = Math.max(0, starsNow - paid.stars);
  const starReward = newStars * LEVEL_REWARDS.perStar;
  const total = firstClear + starReward + repeatClear;
  save.paid[key] = { first: true, stars: Math.max(paid.stars, starsNow) };
  save.wallet.shards += total;
  // Seules les réussites répétées sont des gains répétables ; première réussite et étoiles sont des récompenses uniques (registre `paid`)
  noteEarned(save, repeatClear);
  return { firstClear, newStars, starReward, repeatClear, total };
}

/** Applique le résultat d'une partie à la sauvegarde (une seule fois par partie). */
export function applyRun(save: SaveData, run: RunSummary, now = Date.now()): RunReport {
  const report: RunReport = {
    run,
    stars: 0,
    previousStars: 0,
    previousBestScore: 0,
    newBestScore: false,
    unlockedLevel: null,
    previousBestTime: 0,
    newRecord: false,
    legacyBestTime: 0,
    achievements: [],
    achievementShards: 0,
    orbitShards: Math.max(0, Math.floor(run.shards ?? 0)),
    levelReward: null,
    shardsBalance: 0,
  };
  save.stats.totalRuns++;
  save.stats.totalCycles += run.cycles;
  save.stats.totalShards += Math.max(0, Math.floor(run.shards ?? 0));
  save.stats.totalEvents += Math.max(0, Math.floor(run.events ?? 0));
  save.stats.bestScore = Math.max(save.stats.bestScore, Math.floor(run.score));
  save.stats.bestMultiplier = Math.max(save.stats.bestMultiplier, run.bestMultiplier);

  if (run.mode === 'level' && run.levelId !== undefined) {
    const level = levelById(run.levelId);
    const key = String(run.levelId);
    const rec = save.levels[key] ?? { completed: false, bestScore: 0, stars: 0 };
    report.previousStars = rec.stars;
    report.previousBestScore = rec.bestScore;
    if (run.outcome === 'complete' && level) {
      const wasNextLocked = !isLevelUnlocked(save, run.levelId + 1);
      rec.completed = true;
      report.stars = starsFor(level, run.score);
      if (report.stars > rec.stars) rec.stars = report.stars;
      if (run.score > rec.bestScore) {
        rec.bestScore = run.score;
        report.newBestScore = true;
      }
      save.levels[key] = rec;
      report.levelReward = payLevelReward(save, key, rec.stars);
      const next = run.levelId + 1;
      if (wasNextLocked && LEVELS.some((l) => l.id === next)) report.unlockedLevel = next;
    }
  } else if (run.mode === 'survival') {
    const rec = save.survival;
    report.legacyBestTime = legacySurvivalBest(save)?.time ?? 0;
    report.previousBestTime = rec.bestTime;
    report.previousBestScore = rec.bestScore;
    rec.runs++;
    if (beatsRecord(run.time, run.score, rec.bestTime, rec.bestScore)) {
      rec.bestTime = run.time;
      rec.bestScore = run.score;
      report.newRecord = true;
    }
  } else if (run.mode === 'daily' && run.date) {
    const rec = save.daily[run.date] ?? { bestTime: 0, bestScore: 0, runs: 0 };
    for (const old of Object.values(save.archive)) report.legacyBestTime = Math.max(report.legacyBestTime, old.daily[run.date]?.bestTime ?? 0);
    report.previousBestTime = rec.bestTime;
    report.previousBestScore = rec.bestScore;
    rec.runs++;
    if (beatsRecord(run.time, run.score, rec.bestTime, rec.bestScore)) {
      rec.bestTime = run.time;
      rec.bestScore = run.score;
      report.newRecord = true;
    }
    save.daily[run.date] = rec;
    pruneDaily(save.daily);
  }

  // Succès : déblocage et récompense en Éclats, une seule fois chacun
  report.achievements = unlockAchievements(save, run, now);
  report.achievementShards = report.achievements.reduce((t, a) => t + a.shards, 0);
  report.shardsBalance = save.wallet.shards;
  return report;
}
