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
  stars: [0.55, 0.64, 0.74, 0.84, 0.92],
  /** Vitesse de rotation du ciel (multiplicateur de `motion.starSpin`). */
  starSpeed: [0.35, 0.55, 0.85, 1.15, 1.45],
  /** Densité de poussières (fraction du plafond de qualité). */
  dust: [0.4, 0.52, 0.66, 0.82, 1],
  /** Luminosité des nébuleuses (lueurs cyan / violet / magenta). */
  nebula: [0.07, 0.09, 0.11, 0.14, 0.17],
  /** Ouverture de la faille (0 = trait à peine visible, 1 = pleinement ouverte). */
  riftOpen: [0.08, 0.3, 0.6, 0.82, 1],
  /** Luminosité de la faille. */
  riftGlow: [0.14, 0.32, 0.55, 0.75, 0.92],
  /** Réponse aux battements. */
  beatGain: [0.82, 0.88, 0.93, 0.97, 1],
  /** Réponse aux basses. */
  bassGain: [0.78, 0.84, 0.9, 0.96, 1],
  /** Probabilité d'un anneau d'énergie sur un battement fort. */
  ringChance: [0.55, 0.62, 0.7, 0.8, 0.9],
  /** Arcs d'énergie décoratifs (par seconde, hors zone de jeu). */
  arcRate: [0.3, 0.42, 0.6, 0.85, 1.15],
  /** Débris décoratifs (fraction du plafond de qualité). */
  debris: [0.25, 0.35, 0.5, 0.8, 1],
  /** Déformation gravitationnelle du quadrillage (amplitude). */
  gridWarp: [0.35, 0.45, 0.6, 0.82, 1],
  /** Force des ondes sur les passages forts. */
  waveGain: [0.7, 0.78, 0.86, 0.94, 1],
  /** Chaleur des couleurs : 0 = cyan dominant, 1 = violet et magenta très présents. */
  heat: [0, 0.25, 0.5, 0.75, 1],
  /** Fissures lumineuses autour du noyau (probabilité sur un battement fort). */
  fissure: [0.4, 0.45, 0.5, 0.55, 0.6],
  /** Probabilité d'un éclair ramifié sur un battement marqué (en plus du rythme ambiant `arcRate`). */
  boltChance: [0.2, 0.26, 0.32, 0.4, 0.5],
  /** Probabilité d'une onde d'énergie sur un battement très fort (en plus des passages forts, toujours suivis d'une onde). */
  waveChance: [0.2, 0.26, 0.33, 0.4, 0.5],
} as const;

export type StageParam = keyof typeof STAGE_PARAMS;

export const AMBIENCE = {
  /** Durée d'une transition entre deux stades (s) : rien n'apparaît d'un coup. */
  transition: 10,
  /** Au-delà du dernier stade : variations lentes de l'intensité (périodes en s, amplitude relative). */
  apex: { periods: [47, 71, 113], amplitude: 0.12 },

  /**
   * Noyau puis faille (phase 1) : petite sphère lumineuse au centre dès le départ ; vers 4 min 30 (`PHASES.coreGrowFrom`) elle s'ouvre peu à peu en une
   * faille au cœur sombre, contour irrégulier bleu/violet, filaments électriques, fragments aspirés. Rayons et opacités sont bornés : les menaces,
   * le vaisseau et les objets restent toujours au-dessus et lisibles (la faille reste largement à l'intérieur de l'orbite, de rayon 300).
   */
  hole: {
    /** Points du contour (qualité haute ; les niveaux inférieurs en gardent moins). */
    points: 56,
    /** Demi-taille (unités monde) de la sphère au départ, puis de la faille pleinement ouverte. */
    radiusMin: 9,
    radiusMax: 165,
    /** Allongement le long de l'axe de la faille (le contour est comprimé de la racine de cette valeur de l'autre côté). */
    stretch: 1.5,
    /** Amplitude des déformations du contour (fraction du rayon) à pleine ouverture. */
    roughness: 0.3,
    /** Pointes cristallines le long du contour (nombre, longueur relative). */
    spikes: 7,
    spikeLength: 0.26,
    /** Cœur sombre (couleur et opacité maximale). */
    dark: 0x01030b,
    darkAlpha: 0.97,
    /** Opacité maximale des lueurs (halo, bord, sphère de départ). */
    alphaMax: 0.7,
    /** Bord lumineux : trois passes (épaisseur en unités monde, opacité), de la plus large et diffuse à la plus fine et vive. */
    rim: [
      { width: 22, alpha: 0.16 },
      { width: 9, alpha: 0.34 },
      { width: 2.8, alpha: 0.95 },
    ],
  },

  /**
   * Traversée (progression 0–1 des 6 s) : la faille s'agrandit jusqu'à envelopper tout l'écran (`engulfBy`), le décor est aspiré (`pull`),
   * puis le cœur sombre s'efface sous le flash blanc pendant que le tunnel de la phase 2 apparaît.
   */
  transit: {
    engulfBy: 0.52,
    tunnelFrom: 0.4,
    tunnelTo: 0.78,
    /** Force de l'aspiration du décor (étoiles, poussières, fragments) pendant la traversée. */
    pull: 2.6,
  },

  /**
   * Tunnel de la phase 2 : plans de facettes brisées (textures générées par code) qui défilent vers la profondeur avec une rotation lente.
   * Un plan naît petit au centre, grandit (échelle exponentielle = profondeur) puis s'efface en quittant l'écran ; la musique accélère le défilement.
   */
  tunnel: {
    /** Rayon extérieur d'un plan, en demi-diagonales d'écran : de la naissance (loin) à la sortie (proche). */
    scaleMin: 0.05,
    scaleMax: 2.6,
    /** Part du parcours (0–1) consacrée au fondu d'entrée, et début du fondu de sortie. */
    fadeIn: 0.07,
    fadeOut: 0.9,
    /** Parcours complets par seconde (un plan traverse toute la profondeur en ~11 s) et réponse à la musique. */
    speed: 0.09,
    music: { bass: 0.9, build: 0.6, drop: 1.6, intensity: 0.3 },
    /** Rotation (rad/s) : chaque plan tourne à sa vitesse, un sur deux en sens inverse. */
    spin: 0.045,
    /** Opacité maximale d'un plan et opacité du voile de la zone de jeu en phase 2 (le tunnel reste visible sous l'arène). */
    alphaMax: 1,
    veilAlpha: 0.5,
    /** Assombrissement des bords de l'écran (vignette) : profondeur et lisibilité de l'arène. */
    vignette: 0.8,
    /** Dérive du point de fuite (unités monde) : très faible, l'orbite reste centrée. */
    sway: 5,
  },

  /** Grands rubans d'énergie qui ondulent autour de l'arène (hors de la zone de jeu). */
  ribbons: {
    points: 30,
    /** Demi-largeur maximale (unités monde), rayon minimal (au-delà de l'orbite) et opacité maximale. */
    width: 52,
    minRadius: 345,
    alphaMax: 0.3,
  },

  /** Éclairs ramifiés décoratifs (jamais sur l'orbite : le magenta/blanc des secteurs électriques reste réservé aux dangers). */
  bolts: {
    life: [0.14, 0.34],
    /** Le tracé est retiré toutes les `jitter` secondes pendant la vie de l'éclair. */
    jitter: 0.045,
    minRadius: 390,
    /** Les filaments qui jaillissent de la faille (phase 1) ne dépassent pas ce rayon (unités monde) : ils restent à l'intérieur de l'orbite. */
    rimReach: 275,
    alphaMax: 0.85,
  },

  /** Fragments flottants (phase 1 : aspirés par la faille ; phase 2 : entraînés par les courants du tunnel). */
  shards: {
    sizeMin: 4,
    sizeMax: 12,
    alphaMax: 0.55,
    /** En deçà de ce rayon (unités), ils s'effacent : l'arène reste lisible. */
    safeRadius: 300,
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
    /** Étincelles entraînées vers l'avant : vitesse relative (part du rayon par seconde). */
    flow: 0.42,
  },

  /**
   * L'univers 2 « La Faille » : décor violet profond / magenta électrique / bleu lumineux, fortement réactif à la carte musicale du morceau
   * (`config/world2.ts`) — basses, percussions, montées, impacts, passages calmes. Les valeurs ci-dessous REMPLACENT, en fondu (présence du décor), les
   * paramètres de stade interpolés par le temps : l'ambiance suit la musique, pas la durée de survie. Décoratif seulement.
   */
  world2: {
    params: {
      stars: 0.6,
      starSpeed: 0.8,
      dust: 0.8,
      nebula: 0.1,
      riftOpen: 0.85,
      riftGlow: 0.75,
      beatGain: 1,
      bassGain: 1,
      ringChance: 0.8,
      arcRate: 0.75,
      debris: 0.7,
      gridWarp: 0.8,
      waveGain: 1,
      heat: 0.85,
      fissure: 0.6,
      boltChance: 0.5,
      waveChance: 0.45,
    } as Readonly<Record<keyof typeof STAGE_PARAMS, number>>,
    /** Faille centrale : ouverture et rayon de base (0–1 : même échelle que le noyau de la phase 1), vibration du noyau (unités monde, × basses), gain des pulsations. */
    hole: { open: 0.85, core: 0.72, vibrate: 3.2, pulse: 2.6, instability: 0.9, /* part du cœur sombre qui reste visible malgré le tunnel */ darkness: 0.5 },
    /** Part de teinte violette des facettes du tunnel (0 = couleurs d'origine, bleu lumineux). */
    tunnelTint: 0.42,
    /** Percussions : constante de décroissance de l'impulsion (s), force minimale et probabilité d'un éclair ramifié, secousse des fragments. */
    perc: { decay: 0.09, boltFrom: 0.6, boltChance: 0.4, shardKick: 1.2 },
    /** Impact (grand coup de la carte) : arcs maximum déclenchés ; le reste suit les réglages des passages forts. */
    impact: { arcs: 4 },
    /** Passage calme : lissage de l'apaisement (s). */
    calmSmooth: 0.45,
    /** Montée : part de l'instabilité (fissures qui s'étendent, particules plus vives). */
    instability: { build: 0.85, intensity: 0.5, drop: 0.35, smooth: 0.3 },
    /** Sortie : après le dernier coup, la faille se stabilise (éclairs et pulsations s'éteignent) en cette durée (fraction de la transition). */
    stabilize: 0.3,
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
  calm: { low: 0.07, high: 0.17, reaction: 0.56 },
  /** Reprise nette : quand un passage calme se termine, une onde et des éclairs repartent avec la musique. */
  resume: { from: 0.55, to: 0.3 },

  /** Réactions musicales. */
  music: {
    /** Avance visuelle (s) : le pic lumineux tombe sur le battement entendu (une image d'affichage d'avance). */
    lead: 0.034,
    /** Battement « significatif » : force minimale (0–1, voir la carte musicale). */
    beatThreshold: 0.3,
    /** Battement qui lance un anneau d'énergie : force minimale. */
    ringBeat: 0.5,
    /** Battement fort (anneaux, arcs) : force minimale. */
    strongBeat: 0.8,
    /** Décroissance de la pulsation de battement (s, constante de temps) : retombée rapide pour que chaque coup reste distinct. */
    beatDecay: 0.08,
    /** Courbe d'attaque d'un battement (< 1 : les battements moyens frappent presque aussi fort que les plus marqués ; 1 = linéaire). */
    beatCurve: 0.55,
    /** Basses : attaque quasi immédiate et relâchement court (s). */
    bassAttack: 0.012,
    bassRelease: 0.09,
    /** Passage fort : durée de l'impulsion (s). */
    dropDecay: 1.4,
    /** Intensité musicale : lissage (s). */
    intensitySmooth: 0.22,
    /** Montée : lissage (s). */
    buildSmooth: 0.2,
    /** Saut de position au-delà duquel on ne rattrape pas les battements manqués (reprise, changement de morceau). */
    maxCatchUp: 0.25,
    /** Attaque de basse (coup de grosse caisse) entre les battements cartographiés : montée minimale en 0,1 s, niveau minimal, délai entre deux coups (s). */
    hitRise: 0.1,
    hitLevel: 0.3,
    hitGap: 0.16,
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
    ringAlpha: 0.5,
    arcAlpha: 0.55,
    /** Dilatation maximale de la faille sur un passage fort (multiplicateur d'ouverture). */
    dropDilate: 1.35,
    /** Pulsation maximale d'un halo sur un battement (multiplicateur d'échelle). */
    beatScale: 0.09,
    /** Déformation maximale du quadrillage (unités monde). */
    gridWarp: 7,
  },

  /** Effets réduits (option du jeu ou préférence système) : mêmes stades, réactions adoucies, aucun éclair ni déformation. */
  reduced: { reaction: 0.4, motion: 0.4, waves: false, arcs: false, gridWarp: false },

  /** Qualité adaptative : plafonds par niveau ; on descend si les images sont trop lentes, on remonte prudemment. */
  quality: {
    tiers: {
      high: { stars: 220, dust: 150, debris: 12, rings: 6, arcs: 3, nebulae: 3, gridSegments: 128, tunnel: 8, ribbons: 6, bolts: 6, shards: 26, holePoints: 56 },
      medium: { stars: 150, dust: 90, debris: 8, rings: 5, arcs: 2, nebulae: 2, gridSegments: 96, tunnel: 6, ribbons: 5, bolts: 5, shards: 16, holePoints: 44 },
      low: { stars: 90, dust: 45, debris: 4, rings: 4, arcs: 1, nebulae: 2, gridSegments: 64, tunnel: 5, ribbons: 4, bolts: 4, shards: 8, holePoints: 32 },
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
