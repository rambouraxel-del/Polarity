import { THEME, hexNum } from '../ui/theme';

/**
 * Ambiance visuelle évolutive de la Survie (et du défi quotidien, qui en suit les règles) — SOURCE UNIQUE des réglages.
 *
 * Purement décorative : aucun effet sur la simulation, les collisions, la difficulté, les scores ni les monnaies.
 * Jamais appliquée à la Campagne ni aux Défis classiques. Voir docs/AMBIANCE.md.
 *
 * - Les stades dépendent du temps de survie ACTIF (la pause l'arrête) ; transitions progressives (`transition`).
 * - Les réactions musicales viennent de la carte `src/data/polar-rift-music-map.json` (analyse hors ligne des morceaux,
 *   `scripts/analyze-music.py`) lue à la position de lecture réelle : battements, basses, intensité, montées, passages forts.
 * - Tout ce qui se règle (intensités, couleurs, durées, seuils, plafonds, qualité) est ici.
 */

/** Modes de jeu concernés. */
export const AMBIENCE_MODES = ['survival', 'daily'] as const;

/** L'ambiance s'applique-t-elle à ce mode de jeu ? (Survie et défi quotidien ; jamais la Campagne ni les Défis classiques.) */
export const ambienceApplies = (mode: string): boolean => (AMBIENCE_MODES as readonly string[]).includes(mode);

/** Palette : noir profond, cyan électrique, violet, magenta (distincts des couleurs des dangers). */
export const AMBIENCE_COLORS = {
  cyan: hexNum(THEME.color.cyan),
  violet: 0x7a4dff,
  /** Magenta : nébuleuses lointaines seulement (jamais en traits : trop proche du magenta des secteurs électriques). */
  magenta: 0xd04bff,
  /** Bord de la faille : bleu azur, distinct du cyan de l'orbite. */
  azure: 0x3d8bff,
  ice: 0xbfefff,
  white: 0xffffff,
  /** Voile sombre derrière la zone de jeu (couleur du fond de l'arène). */
  veil: hexNum(THEME.color.bgDeep),
  /** Débris décoratifs : silhouettes bleu nuit, jamais orange (les astéroïdes dangereux le sont). */
  debris: 0x2a3a78,
} as const;

/** Les cinq stades : nom et seuil de début (s de survie active). */
export const STAGES = [
  { name: 'Vide stellaire', from: 0 },
  { name: 'Activation', from: 60 },
  { name: 'Rupture', from: 120 },
  { name: 'Surcharge', from: 180 },
  { name: 'Apogée', from: 240 },
] as const;

/**
 * Paramètres par stade (index 0 à 4), interpolés en continu pendant les transitions.
 * Toutes les valeurs sont des fractions 0–1 (ou des multiplicateurs quand c'est indiqué).
 */
export const STAGE_PARAMS = {
  /** Luminosité des étoiles. */
  stars: [0.5, 0.6, 0.72, 0.82, 0.92],
  /** Vitesse de rotation du ciel (multiplicateur de `motion.starSpin`). */
  starSpeed: [0.35, 0.55, 0.85, 1.15, 1.45],
  /** Densité de poussières (fraction du plafond de qualité). */
  dust: [0.06, 0.3, 0.55, 0.8, 1],
  /** Luminosité des nébuleuses (lueurs cyan / violet / magenta). */
  nebula: [0.03, 0.1, 0.17, 0.23, 0.3],
  /** Ouverture de la faille (0 = trait à peine visible, 1 = pleinement ouverte). */
  riftOpen: [0.08, 0.3, 0.6, 0.82, 1],
  /** Luminosité de la faille. */
  riftGlow: [0.14, 0.32, 0.55, 0.75, 0.92],
  /** Réponse aux battements. */
  beatGain: [0.6, 0.72, 0.85, 0.94, 1],
  /** Réponse aux basses. */
  bassGain: [0.5, 0.62, 0.78, 0.9, 1],
  /** Probabilité d'un anneau d'énergie sur un battement fort. */
  ringChance: [0.05, 0.1, 0.2, 0.3, 0.4],
  /** Arcs d'énergie décoratifs (par seconde, hors zone de jeu). */
  arcRate: [0, 0.05, 0.14, 0.32, 0.55],
  /** Débris décoratifs (fraction du plafond de qualité). */
  debris: [0, 0, 0.15, 0.7, 1],
  /** Déformation gravitationnelle du quadrillage (amplitude). */
  gridWarp: [0, 0, 0.18, 0.6, 1],
  /** Force des ondes sur les passages forts. */
  waveGain: [0.45, 0.6, 0.8, 0.92, 1],
  /** Chaleur des couleurs : 0 = cyan dominant, 1 = violet et magenta très présents. */
  heat: [0, 0.25, 0.5, 0.75, 1],
  /** Fissures lumineuses autour du noyau (probabilité sur un battement fort). */
  fissure: [0.05, 0.12, 0.25, 0.4, 0.6],
} as const;

export type StageParam = keyof typeof STAGE_PARAMS;

export const AMBIENCE = {
  /** Durée d'une transition entre deux stades (s) : rien n'apparaît d'un coup. */
  transition: 10,
  /** Au-delà du dernier stade : variations lentes de l'intensité (périodes en s, amplitude relative). */
  apex: { periods: [47, 71, 113], amplitude: 0.12 },

  /**
   * Noyau central (phase 1) : petite sphère lumineuse au centre dès le départ ; vers 4 min 30 (`PHASES.coreGrowFrom`) elle devient peu à peu une faille
   * jusqu'à la traversée. Rayons et opacités sont bornés : les menaces, le vaisseau et les objets restent toujours au-dessus et lisibles.
   */
  core: {
    /** Rayon de la petite sphère (unités monde) au départ, puis à pleine ouverture. */
    radiusMin: 10,
    radiusMax: 46,
    /** Demi-longueur des rayons de la faille à pleine ouverture (unités monde, < orbite). */
    slitLength: 210,
    /** Opacité maximale du noyau et de la faille. */
    alphaMax: 0.55,
  },

  /** Phase 2 : univers sombre, fracturé, électrique. Le fondu entre les deux apparences se fait pendant la traversée, sous le flash. */
  phase2: {
    /** Voile du ciel : les étoiles et nébuleuses de la phase 1 sont atténuées de cette part. */
    dimSky: 0.55,
    /** Couleurs : fissures et arcs électriques (bleu électrique, blanc-bleu) ; jamais le corail, l'orange ni le magenta des dangers. */
    crack: 0x6f8bff,
    spark: 0xd8e4ff,
    /** Secondes de la traversée avant le flash (progression 0–1 de la traversée) : début, pic et fin du flash blanc. */
    flash: { from: 0.58, peak: 0.7, to: 0.86 },
  },

  /** Moments forts PRÉPARÉS (instants de survie active, indépendants de l'audio) : s'ajoutent aux réactions issues de l'analyse musicale. */
  script: [
    { at: 60, wave: 0.55, fissure: 0.4 },
    { at: 120, wave: 0.7, fissure: 0.6 },
    { at: 180, wave: 0.8, fissure: 0.8 },
    { at: 240, wave: 0.9, fissure: 1 },
    { at: 270, wave: 0.8, fissure: 1 },
    { at: 285, wave: 0.9, fissure: 1 },
    { at: 295, wave: 1, fissure: 1 },
  ] as readonly { at: number; wave: number; fissure: number }[],

  /** Passages calmes de la musique : sous ce niveau d'intensité l'ambiance se calme (réactions réduites, fissures et arcs rares). */
  calm: { low: 0.2, high: 0.5, reaction: 0.55 },

  /** Réactions musicales. */
  music: {
    /** Avance visuelle (s) : le pic lumineux tombe sur le battement entendu (une image d'affichage d'avance). */
    lead: 0.016,
    /** Battement « significatif » : force minimale (0–1, voir la carte musicale). */
    beatThreshold: 0.35,
    /** Battement fort (anneaux, arcs) : force minimale. */
    strongBeat: 0.8,
    /** Décroissance de la pulsation de battement (s, constante de temps) : retombée rapide pour que chaque coup reste distinct. */
    beatDecay: 0.1,
    /** Courbe d'attaque d'un battement (< 1 : les battements moyens frappent presque aussi fort que les plus marqués ; 1 = linéaire). */
    beatCurve: 0.65,
    /** Basses : attaque quasi immédiate et relâchement court (s). */
    bassAttack: 0.012,
    bassRelease: 0.12,
    /** Passage fort : durée de l'impulsion (s). */
    dropDecay: 1.4,
    /** Intensité musicale : lissage (s). */
    intensitySmooth: 0.4,
    /** Montée : lissage (s). */
    buildSmooth: 0.3,
    /** Saut de position au-delà duquel on ne rattrape pas les battements manqués (reprise, changement de morceau). */
    maxCatchUp: 0.25,
  },

  /** Mouvements (unités monde = orbite de rayon 300 ; angles en rad/s). */
  motion: {
    /** Rotation du ciel autour de la faille (3 profondeurs : lointaine, moyenne, proche). */
    starSpin: [0.004, 0.009, 0.017],
    /** Spirale des poussières vers la faille. */
    dustSwirl: 0.05,
    dustInfall: 6,
    /** Débris : vitesse angulaire et dérive. */
    debrisSpin: [0.012, 0.025],
    /** Angle de la faille (rad) et sa lente rotation. */
    riftAngle: -0.62,
    riftSway: 0.04,
  },

  /** Géométrie (unités monde, orbite = 300). */
  shape: {
    /** Demi-longueur de la faille (la faille dépasse largement l'orbite). */
    riftLength: 760,
    /** Demi-épaisseur de la faille pleinement ouverte. */
    riftWidth: 70,
    /** Rayon du voile sombre qui protège la zone de jeu (au-delà de l'orbite). */
    veilRadius: 410,
    /** Part du rayon du voile entièrement opaque (au-delà de l'orbite et des marges des menaces) ; le fondu occupe le reste. */
    veilSolid: 0.8,
    /** Les arcs décoratifs restent hors de la zone de jeu (au-delà de ce rayon). */
    arcMinRadius: 420,
    /** Rayon de départ et d'arrivée des anneaux et ondes. */
    ringFrom: 40,
    ringTo: 900,
  },

  /** Lisibilité : plafonds absolus, quel que soit le stade ou la musique. */
  caps: {
    /** Opacité maximale du voile au centre (protège les menaces et le vaisseau). */
    veilAlpha: 0.9,
    /** Opacité maximale de la faille, des nébuleuses, des anneaux. */
    riftAlpha: 0.75,
    nebulaAlpha: 0.32,
    ringAlpha: 0.32,
    arcAlpha: 0.55,
    /** Dilatation maximale de la faille sur un passage fort (multiplicateur d'ouverture). */
    dropDilate: 1.35,
    /** Pulsation maximale d'un halo sur un battement (multiplicateur d'échelle). */
    beatScale: 0.09,
    /** Déformation maximale du quadrillage (unités monde). */
    gridWarp: 7,
  },

  /** Effets réduits (option du jeu ou préférence système) : mêmes stades, réactions adoucies, aucun éclair ni déformation. */
  reduced: { reaction: 0.25, motion: 0.3, waves: false, arcs: false, gridWarp: false },

  /** Qualité adaptative : plafonds par niveau ; on descend si les images sont trop lentes, on remonte prudemment. */
  quality: {
    tiers: {
      high: { stars: 220, dust: 150, debris: 12, rings: 6, arcs: 3, nebulae: 3, gridSegments: 128 },
      medium: { stars: 150, dust: 90, debris: 8, rings: 4, arcs: 2, nebulae: 2, gridSegments: 96 },
      low: { stars: 90, dust: 45, debris: 4, rings: 2, arcs: 1, nebulae: 1, gridSegments: 64 },
    },
    /** Durée d'image moyenne (s) au-delà de laquelle on descend d'un niveau, et durée d'observation (s). */
    slowFrame: 1 / 45,
    slowFor: 3,
    /** Durée d'image moyenne en dessous de laquelle on remonte, après une observation plus longue (s). */
    fastFrame: 1 / 56,
    fastFor: 20,
  },
} as const;

export type QualityTier = keyof typeof AMBIENCE.quality.tiers;
export type QualitySpec = (typeof AMBIENCE.quality.tiers)[QualityTier];
