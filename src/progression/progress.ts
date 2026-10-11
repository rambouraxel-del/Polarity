import { LEVELS, levelById, type LevelDef } from '../config/levels';
import { pruneDaily, type SaveData } from '../save/save';
import { ACHIEVEMENTS, type AchievementDef } from './achievements';

export type RunMode = 'level' | 'survival' | 'daily';

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
  /** Nouveaux succès. */
  achievements: AchievementDef[];
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
    achievements: [],
  };
  save.stats.totalRuns++;
  save.stats.totalCycles += run.cycles;

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
      const next = run.levelId + 1;
      if (wasNextLocked && LEVELS.some((l) => l.id === next)) report.unlockedLevel = next;
    }
  } else if (run.mode === 'survival') {
    const rec = save.survival;
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

  for (const a of ACHIEVEMENTS) {
    if (save.achievements[a.id] !== undefined) continue;
    if (a.check(save, run)) {
      save.achievements[a.id] = now;
      report.achievements.push(a);
    }
  }
  return report;
}
