/**
 * Paramètres d'équilibrage centralisés.
 * Les valeurs sont des points de départ : à ajuster par des essais de jeu.
 * Unités : distances en « unités monde » (orbite de rayon 300), temps en secondes, angles en radians.
 */

export const SIM = {
  /** Pas de simulation fixe (s). Les résultats ne dépendent pas de la fréquence d'affichage. */
  dt: 1 / 120,
  /** Durée maximale d'une image prise en compte (au-delà, le temps est ignoré : évite la spirale de rattrapage). */
  maxFrameTime: 0.1,
} as const;

export const ARENA = {
  orbitRadius: 300,
  /** Rayon visible minimal à faire tenir à l'écran (orbite + marge). */
  viewRadius: 360,
  /** Distance au centre où naissent / disparaissent les projectiles (hors champ). */
  spawnRadius: 560,
} as const;

export const PLAYER = {
  /** Vitesse angulaire constante (rad/s). Un tour ≈ 3,1 s. */
  angularSpeed: 2.0,
  /** Angle de départ (haut de l'écran ; l'axe y pointe vers le bas). */
  startAngle: -Math.PI / 2,
  startDirection: 1 as 1 | -1,
  /** Taille visuelle du triangle (rayon circonscrit). */
  visualRadius: 11,
  /** Hitbox indulgente, plus petite que le visuel. */
  hitRadius: 7,
} as const;

export const BEACONS = {
  count: 6,
  /** Décalage angulaire de la première balise (le joueur démarre entre deux balises). */
  offset: -Math.PI / 2 + Math.PI / 6,
  visualRadius: 7,
} as const;

export const SCORE = {
  beaconPoints: 100,
  cycleBonus: 500,
  /** Délai max entre deux collectes pour faire progresser le combo. */
  comboWindow: 1.6,
  /** Nombre de collectes rapprochées pour gagner un palier de multiplicateur. */
  collectsPerLevel: 6,
  maxMultiplier: 5,
  /** Après la fenêtre sans collecte, le multiplicateur perd un palier toutes les `comboDecayStep` secondes. */
  comboDecayStep: 1.0,
} as const;

export const RESPITE = {
  /** Retard ajouté à la prochaine vague quand un cycle est complété (Survie). */
  delay: 0.8,
  /** Délai minimal entre deux répits. */
  cooldown: 5,
  /** Cumul maximal de répit sur une même vague en attente. */
  maxPerWave: 1.2,
} as const;

export const PROJECTILE = {
  hitRadius: 8,
  visualRadius: 10,
} as const;

export const SECTOR = {
  /** Réduction indulgente de l'arc dangereux à chaque extrémité (rad). */
  edgeForgiveness: 0.03,
  /** Nombre max de secteurs annoncés ou actifs simultanément. */
  maxSimultaneous: 2,
  /** Couverture angulaire totale maximale des secteurs simultanés (fraction du cercle). */
  maxCoverage: 0.36,
} as const;

/** Paramètres du validateur d'évitement (modèle de joueur prudent). */
export const SAFETY = {
  /** Intervalle entre deux décisions du joueur modélisé. */
  decisionStep: 0.125,
  /** Sous-intervalles de test de collision par décision. */
  subSteps: 4,
  /** Marge de sécurité ajoutée aux hitboxes dans le modèle (unités monde). */
  margin: 10,
  /** Marge temporelle autour de l'activité d'un secteur. */
  timeMargin: 0.06,
  /** Temps pendant lequel le joueur modélisé ne réagit pas encore à une nouvelle vague. */
  reactionTime: 0.25,
  /** Horizon maximal d'analyse. */
  maxHorizon: 6,
  /** Nombre de tentatives de génération avant de reporter la vague. */
  attempts: 8,
  /** Report d'une vague impossible à placer. */
  retryDelay: 0.25,
} as const;

/**
 * Paramètres de difficulté interpolés selon un niveau d ∈ [0, 1].
 * `easy` correspond à d = 0, `hard` à d = 1. Les plafonds sont garantis par construction (d est borné).
 */
export const DIFFICULTY_RANGE = {
  waveInterval: { easy: 2.2, hard: 0.9 },
  projectileWarn: { easy: 1.05, hard: 0.6 },
  sectorWarn: { easy: 1.3, hard: 0.72 },
  projectileSpeed: { easy: 320, hard: 560 },
  sectorActive: { easy: 0.75, hard: 1.0 },
  sectorHalfWidth: { easy: 0.36, hard: 0.5 },
  /** Décalage entre les deux menaces d'une attaque combinée. */
  comboStagger: { easy: 0.75, hard: 0.4 },
  maxHazards: { easy: 2, hard: 6 },
} as const;

/** Limites absolues (filet de sécurité, en plus de d ≤ 1). */
export const CAPS = {
  maxProjectileSpeed: 580,
  minProjectileWarn: 0.55,
  minSectorWarn: 0.65,
  minWaveInterval: 0.85,
  maxActiveHazards: 8,
} as const;

export const SURVIVAL = {
  /** Constante de temps de la courbe d(t) = dMax · (1 − e^(−t/τ)). */
  tau: 170,
  dMax: 0.93,
  /** Vague initiale. */
  firstWaveDelay: 1.6,
  /** Respiration : toutes les N vagues, une pause supplémentaire. */
  breathEvery: { min: 6, max: 9 },
  breathDuration: { min: 1.2, max: 2.0 },
  /** Modulation lente du rythme au-delà de la phase d'apprentissage. */
  rhythmAmplitude: 0.12,
  rhythmPeriod: 37,
  /** Temps (s) de déblocage des familles de motifs. */
  unlock: {
    sector: 18,
    doubleProjectile: 40,
    combo: 70,
    advanced: 130,
  },
} as const;

export const LEVEL_DURATION = 90;

export const UI = {
  /** Protection contre les clics accidentels à l'écran de résultat. */
  resultInputLock: 0.6,
  /** Délai entre la collision et l'affichage du résultat. */
  deathScreenDelay: 0.75,
  /** Compte à rebours de reprise après pause (en secondes, 3 étapes). */
  resumeCountdown: 3,
  resumeStep: 0.55,
} as const;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
