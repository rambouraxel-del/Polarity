import { LEVELS } from '../config/levels';
import type { SaveData } from '../save/save';
import type { RunSummary } from './progress';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Évalué après chaque partie, une fois la sauvegarde mise à jour. */
  check(save: SaveData, run: RunSummary): boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_cycle', name: 'Premier cycle',
    description: 'Collecter les six balises d’un même cycle.',
    check: (_s, r) => r.cycles >= 1,
  },
  {
    id: 'first_level', name: 'Premier niveau',
    description: 'Terminer le niveau 1.',
    check: (s) => s.levels['1']?.completed === true,
  },
  {
    id: 'survive_60', name: 'Première minute',
    description: 'Survivre 60 secondes en Survie.',
    check: (_s, r) => r.mode === 'survival' && r.time >= 60,
  },
  {
    id: 'max_combo', name: 'Pleine charge',
    description: 'Atteindre le multiplicateur maximal.',
    check: (_s, r) => r.bestMultiplier >= 5,
  },
  {
    id: 'three_stars', name: 'Trois étoiles',
    description: 'Obtenir trois étoiles sur un niveau.',
    check: (s) => Object.values(s.levels).some((l) => l.stars >= 3),
  },
  {
    id: 'daily_30', name: 'Rendez-vous',
    description: 'Survivre 30 secondes au défi quotidien.',
    check: (_s, r) => r.mode === 'daily' && r.time >= 30,
  },
  {
    id: 'survive_300', name: 'Endurance',
    description: 'Survivre 5 minutes en Survie.',
    check: (_s, r) => r.mode === 'survival' && r.time >= 300,
  },
  {
    id: 'cycles_100', name: 'Collectionneur',
    description: 'Compléter 100 cycles au total.',
    check: (s) => s.stats.totalCycles >= 100,
  },
  {
    id: 'all_levels', name: 'Maître de l’orbite',
    description: 'Terminer les 12 niveaux.',
    check: (s) => LEVELS.every((l) => s.levels[String(l.id)]?.completed === true),
  },
];

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
