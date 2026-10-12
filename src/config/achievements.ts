/**
 * Succès — objectifs et récompenses centralisés (source unique).
 *
 * - Chaque succès mesure une grandeur (`metric`) et se débloque quand elle atteint `target`. Les objectifs sont progressifs
 *   (durées de survie, cycles, événements, étoiles, Éclats collectés au total) et **ne demandent jamais de dépenser** :
 *   « Éclats collectés » compte les gains, pas le solde.
 * - Chaque succès rapporte des Éclats (`shards`), versés une seule fois (registre `rewarded` de la sauvegarde).
 * - Certains succès débloquent en plus un cosmétique : ce lien est décrit au catalogue (config/catalog.ts, obtention « succès »).
 * Les identifiants sont enregistrés dans la sauvegarde : ne jamais les changer ni les réutiliser.
 */
export type AchievementCategory = 'discovery' | 'survival' | 'levels' | 'collection' | 'mastery';

export const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; label: string }[] = [
  { id: 'discovery', label: 'Découverte' },
  { id: 'survival', label: 'Survie' },
  { id: 'levels', label: 'Niveaux' },
  { id: 'collection', label: 'Collectes' },
  { id: 'mastery', label: 'Maîtrise' },
];

/** Grandeurs mesurées (calculées dans progression/achievements.ts). */
export type MetricKey =
  | 'totalCycles' // cycles complets (six balises) au total
  | 'levelsCompleted' // niveaux réussis
  | 'totalStars' // étoiles obtenues, tous niveaux
  | 'threeStarLevels' // niveaux terminés avec trois étoiles
  | 'survivalRuns' // parties de Survie jouées
  | 'bestSurvival' // meilleur temps de survie (s), anciens équilibrages compris
  | 'bestDaily' // meilleur temps au défi quotidien (s)
  | 'totalEvents' // événements (pluie de météores, tempête électrique) traversés au total
  | 'totalShards' // Éclats collectés sur l'orbite au total (gains, pas solde)
  | 'bestScore' // meilleur score en une partie
  | 'maxMultiplier'; // multiplicateur le plus élevé atteint

export interface AchievementConfig {
  id: string;
  category: AchievementCategory;
  name: string;
  description: string;
  metric: MetricKey;
  target: number;
  /** Éclats versés (une seule fois). */
  shards: number;
}

export const ACHIEVEMENT_CONFIG: AchievementConfig[] = [
  // Découverte
  { id: 'first_cycle', category: 'discovery', name: 'Premier cycle', description: 'Collecter les six balises d’un même cycle.', metric: 'totalCycles', target: 1, shards: 10 },
  { id: 'first_level', category: 'discovery', name: 'Premier niveau', description: 'Terminer le niveau 1.', metric: 'levelsCompleted', target: 1, shards: 20 },
  { id: 'first_survival', category: 'discovery', name: 'Premier vol', description: 'Jouer une partie de Survie.', metric: 'survivalRuns', target: 1, shards: 10 },
  { id: 'first_event', category: 'discovery', name: 'Dans la tempête', description: 'Traverser un événement (pluie de météores ou tempête électrique).', metric: 'totalEvents', target: 1, shards: 20 },
  { id: 'daily_30', category: 'discovery', name: 'Rendez-vous', description: 'Survivre 30 secondes au défi quotidien.', metric: 'bestDaily', target: 30, shards: 25 },
  // Survie
  { id: 'survive_60', category: 'survival', name: 'Première minute', description: 'Survivre 60 secondes en Survie.', metric: 'bestSurvival', target: 60, shards: 25 },
  { id: 'survive_120', category: 'survival', name: 'Deux minutes', description: 'Survivre 2 minutes en Survie.', metric: 'bestSurvival', target: 120, shards: 40 },
  { id: 'survive_180', category: 'survival', name: 'Trois minutes', description: 'Survivre 3 minutes en Survie.', metric: 'bestSurvival', target: 180, shards: 60 },
  { id: 'survive_300', category: 'survival', name: 'Endurance', description: 'Survivre 5 minutes en Survie.', metric: 'bestSurvival', target: 300, shards: 100 },
  { id: 'survive_480', category: 'survival', name: 'Longue traversée', description: 'Survivre 8 minutes en Survie.', metric: 'bestSurvival', target: 480, shards: 150 },
  { id: 'survive_600', category: 'survival', name: 'Dix minutes', description: 'Survivre 10 minutes en Survie.', metric: 'bestSurvival', target: 600, shards: 250 },
  // Niveaux
  { id: 'levels_3', category: 'levels', name: 'Échauffement', description: 'Terminer 3 niveaux.', metric: 'levelsCompleted', target: 3, shards: 30 },
  { id: 'levels_6', category: 'levels', name: 'À mi-parcours', description: 'Terminer 6 niveaux.', metric: 'levelsCompleted', target: 6, shards: 50 },
  { id: 'three_stars', category: 'levels', name: 'Trois étoiles', description: 'Obtenir trois étoiles sur un niveau.', metric: 'threeStarLevels', target: 1, shards: 40 },
  { id: 'stars_18', category: 'levels', name: 'Constellation', description: 'Obtenir 18 étoiles au total.', metric: 'totalStars', target: 18, shards: 60 },
  { id: 'all_levels', category: 'levels', name: 'Maître de l’orbite', description: 'Terminer les 12 niveaux.', metric: 'levelsCompleted', target: 12, shards: 150 },
  { id: 'stars_36', category: 'levels', name: 'Ciel complet', description: 'Obtenir les 36 étoiles des 12 niveaux.', metric: 'totalStars', target: 36, shards: 200 },
  // Collectes
  { id: 'cycles_10', category: 'collection', name: 'Habitué', description: 'Compléter 10 cycles au total.', metric: 'totalCycles', target: 10, shards: 20 },
  { id: 'cycles_100', category: 'collection', name: 'Collectionneur', description: 'Compléter 100 cycles au total.', metric: 'totalCycles', target: 100, shards: 60 },
  { id: 'cycles_500', category: 'collection', name: 'Infatigable', description: 'Compléter 500 cycles au total.', metric: 'totalCycles', target: 500, shards: 150 },
  { id: 'shards_50', category: 'collection', name: 'Premières lueurs', description: 'Collecter 50 Éclats sur l’orbite au total.', metric: 'totalShards', target: 50, shards: 20 },
  { id: 'shards_250', category: 'collection', name: 'Chasseur d’éclats', description: 'Collecter 250 Éclats sur l’orbite au total.', metric: 'totalShards', target: 250, shards: 50 },
  { id: 'shards_1000', category: 'collection', name: 'Mine de cristal', description: 'Collecter 1 000 Éclats sur l’orbite au total.', metric: 'totalShards', target: 1000, shards: 150 },
  // Maîtrise
  { id: 'max_combo', category: 'mastery', name: 'Pleine charge', description: 'Atteindre le multiplicateur maximal.', metric: 'maxMultiplier', target: 5, shards: 40 },
  { id: 'score_100k', category: 'mastery', name: 'Haut score', description: 'Atteindre 100 000 points en une partie.', metric: 'bestScore', target: 100000, shards: 80 },
  { id: 'events_10', category: 'mastery', name: 'Dompteur de tempêtes', description: 'Traverser 10 événements au total.', metric: 'totalEvents', target: 10, shards: 60 },
  { id: 'events_30', category: 'mastery', name: 'Maître des éléments', description: 'Traverser 30 événements au total.', metric: 'totalEvents', target: 30, shards: 150 },
];
