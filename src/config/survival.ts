/**
 * Difficulté de la Survie et du défi quotidien (même règles) — réglage indépendant des hitboxes.
 * Les plafonds absolus (vitesse maximale, annonces minimales, intervalle minimal, nombre de menaces,
 * secteurs simultanés) restent dans config/balance.ts (CAPS, SECTOR, DIFFICULTY_RANGE) et ne changent pas.
 *
 * Équilibrage v1.1 : la courbe est ~2,5× plus rapide. d(120 s) ≈ ancien d(300 s) ≈ 0,77.
 */

/** Rampe : l'élément apparaît à `from` et atteint son poids plein à `from + span`. */
export interface Ramp {
  from: number;
  span: number;
}

export const SURVIVAL = {
  /** Plafond de difficulté (jamais 1). */
  dMax: 0.93,
  /** Constante de temps de d(t) = dMax · (1 − e^(−t/τ)). v1.0 : 170 s. */
  tau: 68,
  /** Constante de temps de la v1.0, conservée pour comparaison (tests, documentation). */
  legacyTau: 170,
  /** Délai avant la première vague. */
  firstWaveDelay: 1.6,
  /** Annonces réduites de 8 % ; les planchers de CAPS (0,55 s projectile, 0,65 s secteur) restent appliqués. */
  warnScale: 0.92,

  /** Paliers d'introduction des motifs (secondes de temps actif). */
  unlock: {
    /** Arcs électriques. */
    sector: { from: 8, span: 8 } as Ramp,
    /** Premières doubles attaques : doublé, croix. Dès 30 s. */
    doubles: { from: 30, span: 25 } as Ramp,
    /** Autres doubles attaques : arcs jumeaux, écho, poursuite. Dès 45 s. */
    doublesLate: { from: 45, span: 20 } as Ramp,
    /** Combinaisons projectile + secteur : tir + arc. À partir d'une minute. */
    combo: { from: 60, span: 35 } as Ramp,
    /** Motifs avancés : rafale, tenaille. */
    advanced: { from: 90, span: 30 } as Ramp,
    /** Convoi d'astéroïdes (aussi présent dans la pluie de météores). */
    convoy: { from: 38, span: 22 } as Ramp,
    /** Astéroïde fragmenté. */
    fragment: { from: 75, span: 25 } as Ramp,
    /** Laser balayeur. */
    laser: { from: 110, span: 30 } as Ramp,
  },
  /** « Davantage de combinaisons » : poids supplémentaire des combinaisons à partir d'une minute. */
  comboBoost: { ramp: { from: 75, span: 60 } as Ramp, extra: 0.5 },
  /** Les motifs simples deviennent moins fréquents (sans disparaître : ils servent de respiration). */
  simpleFade: { ramp: { from: 80, span: 40 } as Ramp, amount: 0.45 },

  /**
   * Phase 1 (0 → 300 s) : difficulté PAR PALIERS. Chaque palier [instant de fin de la montée, niveau] est atteint en `ramp` secondes (lissé) ;
   * l'accueil est accessible mais très court (le premier palier tombe à 12 s). Une « vague de tension » sinusoïdale s'y ajoute (±amplitude) ;
   * les respirations (breath, intensify) et le calme avant chaque palier laissent souffler.
   */
  stages: {
    levels: [[0, 0.1], [12, 0.28], [35, 0.45], [70, 0.6], [110, 0.72], [160, 0.8], [215, 0.86], [260, 0.9]] as readonly (readonly [number, number])[],
    ramp: 5,
    tension: { amplitude: 0.045, period: 31, from: 30 },
    /** Calme juste avant un palier : les vagues s'espacent (intervalle × `scale`) pendant `lead` secondes. */
    calm: { lead: 7, scale: 1.35 },
  },
  /** Mise en rythme : part des vagues dont le premier contact tombe sur un battement de la grille musicale (phase 1 / phase 2) et écart maximal (s). */
  beat: { chance: [0.35, 0.5] as readonly [number, number], maxShift: 0.6, accentWindow: 1.2 },

  /**
   * Phase 2 (≥ 300 s, infinie) : la difficulté reprend là où la phase 1 l'a laissée (aucune hausse brutale) puis progresse lentement,
   * toujours sous `dMax`. Les nouvelles menaces sont introduites une à une (secondes APRÈS l'entrée en phase 2), puis combinées.
   */
  phase2: {
    dStart: 0.9,
    /** Constante de temps (s) de la hausse lente vers dMax. */
    tau: 420,
    /** Intensité 0 → 1 (rythme des vagues, poids des motifs complexes) : constante de temps (s). */
    intensityTau: 480,
    /** Intervalle entre vagues multiplié par ce facteur à pleine intensité (borné par CAPS.minWaveInterval). */
    tightness: 0.8,
    unlock: {
      arcShot: { from: 4, span: 10 } as Ramp,
      spiral: { from: 50, span: 12 } as Ramp,
      rotBeam: { from: 100, span: 12 } as Ramp,
      sweepBeam: { from: 150, span: 12 } as Ramp,
      altBeams: { from: 200, span: 12 } as Ramp,
      /** Combinaisons de menaces nouvelles + obstacles transformés. */
      combos: { from: 255, span: 40 } as Ramp,
    },
    breath: { every: { min: 4, max: 6 }, duration: { min: 1.1, max: 1.7 } },
  },

  /** Rythme avant l'intensification : une respiration toutes les 6 à 9 vagues. */
  breath: {
    every: { min: 6, max: 9 },
    duration: { min: 1.2, max: 2.0 },
  },
  /** Après 3 minutes : séquences plus serrées, séparées de brèves respirations. */
  intensify: {
    /** Début de l'intensification. */
    ramp: { from: 180, span: 20 } as Ramp,
    /** Séquences de 4 à 6 vagues... */
    every: { min: 4, max: 6 },
    /** ...séparées de respirations brèves. */
    duration: { min: 0.9, max: 1.4 },
    /** Intervalle entre vagues multiplié par ce facteur à pleine intensité (borné par CAPS.minWaveInterval). */
    tightness: 0.82,
    /** Poids supplémentaire des motifs complexes à pleine intensité. */
    complexBoost: 0.3,
  },
  /** Modulation lente du rythme (±12 %), introduite après la phase d'apprentissage. */
  rhythm: { amplitude: 0.12, period: 37, ramp: { from: 40, span: 40 } as Ramp },
} as const;
