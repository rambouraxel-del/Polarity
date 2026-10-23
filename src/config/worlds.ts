import type { PatternWeights } from '../sim/patterns';

/**
 * VOYAGE À TRAVERS LES UNIVERS (refonte de la Survie, en cours de validation) — SOURCE UNIQUE des réglages.
 *
 * Chaque univers dure exactement `WORLDS.span` secondes de survie ACTIVE ; entre deux univers, une transition cinématique de `WORLDS.transition`
 * secondes HORS temps de jeu (la session gèle la simulation : aucun pas, aucune collision, aucune collecte, aucun score, aucun bonus ni recharge,
 * commandes refusées). Le dernier univers défini se prolonge (difficulté plafonnée) jusqu'à l'ajout du suivant : jamais d'univers vide ni de fin
 * arbitraire. Ajouter un univers = ajouter une entrée à `WORLDS.list` (+ ses motifs, son décor et sa transition) sans toucher aux précédents.
 *
 * ISOLATION : ce mode n'est lancé QUE comme partie de test (mode développeur) ; il ne touche ni à la Survie officielle (BALANCE_VERSION 4), ni au
 * défi quotidien, ni aux classements, ni aux récompenses. `WORLDS_BALANCE_VERSION` est la version proposée pour une future activation officielle
 * (rejeu du service à mettre à jour d'abord ; voir docs/UNIVERS.md).
 *
 * Reproductibilité : tout ce qui touche au gameplay (calendrier, champs de vitesse, motifs, grilles de rythme) est une fonction de la graine et du
 * temps actif. Le gameplay ne lit JAMAIS l'audio.
 */

export type WorldId = 'origin' | 'between' | 'nebula' | 'winds';
/** Mécanique environnementale d'un univers (champ de vitesse sur l'orbite, purement déterministe). */
export type FieldKind = 'none' | 'clouds' | 'currents';
/** Variante de la transition d'ENTRÉE dans un univers. */
export type TransitionVariant = 'rift' | 'mist' | 'spiral';

export interface WorldPalette {
  /** Fond du ciel (bord de l'écran) et lueur des nébuleuses. */
  sky: number;
  /** Couleur dominante, secondaire et d'accent du décor. */
  primary: number;
  secondary: number;
  accent: number;
  /** Noyau central. */
  core: number;
  /** Orbite (trait et halo) : toujours à plus de 30° de teinte des couleurs des dangers de l'univers. */
  orbit: number;
}

export interface WorldDef {
  id: WorldId;
  /** 1, 2, 3… */
  index: number;
  name: string;
  /** Une ligne, affichée à l'arrivée. */
  tagline: string;
  palette: WorldPalette;
  /** Vitesse de base du vaisseau (facteur de la référence, 1 = 2 rad/s) : début → fin de l'univers. */
  speed: { from: number; to: number };
  /** Difficulté d ∈ [0, 1] (config/balance.ts DIFFICULTY_RANGE) : paliers [temps LOCAL, niveau], lissés. */
  difficulty: readonly (readonly [number, number])[];
  /** Intervalle entre vagues multiplié par ce facteur (1 = normal). */
  interval: number;
  field: FieldKind;
  /** Événements (pluie de météores, tempête électrique) : seulement dans l'univers d'origine. */
  events: boolean;
  /** Part des vagues calées sur un battement (0 = aucune : jamais de faux battements sans musique). */
  beatChance: number;
  transition: { variant: TransitionVariant; from: number; to: number };
  /** Poids des motifs au temps LOCAL t (0 → span). */
  weights(t: number): PatternWeights;
}

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};
/** Rampe douce de 0 à 1 entre `from` et `from + span` (temps local). */
export const ramp = (t: number, from: number, span: number): number => smooth((t - from) / span);

export const WORLDS = {
  /** Durée de chaque univers (s de survie active). */
  span: 120,
  /** Transition cinématique entre deux univers (s, hors temps de jeu). */
  transition: 4,
  /** Plus aucune nouvelle vague dans les dernières secondes d'un univers : l'approche de la faille reste sûre. */
  quietBefore: 3.5,
  /** Délai avant la première vague du nouvel univers (s de jeu actif). */
  firstWaveDelay: 2.4,
  /** Plafond global de la vitesse de base (la courbe ne croît pas indéfiniment). */
  speedCap: 0.95,
  /** Prolongement du dernier univers : difficulté plafonnée, oscillation lente et bornée. */
  extension: { dMax: 0.84, rise: 300, tension: 0.03, period: 41, speed: 0.88 },
  /**
   * Chronologie de la transition (fractions de la durée) : ouverture (faille), aspiration (le vaisseau quitte VISUELLEMENT l'orbite ; ses
   * coordonnées de jeu ne changent pas), traversée (tunnel, lignes de vitesse, changement de palette), émergence (nouveau monde, orbite reconstituée).
   */
  timeline: { open: 0.3, pull: 0.55, cross: 0.8 },
} as const;

/** Version d'équilibrage PROPOSÉE pour une activation officielle (non utilisée tant que le service ne sait pas rejouer ce mode). */
export const WORLDS_BALANCE_VERSION = 5;

/** Primes provisoires de franchissement (Éclats) : NON versées (parties de test) ; montants à valider avant toute activation. */
export const WORLD_BONUS_PROPOSAL: Readonly<Record<number, number>> = { 2: 60, 3: 90, 4: 120 };

// ————————————————————————————————————————————— mécaniques environnementales (champs de vitesse)

/** Mer nébulaire : nuages de ralentissement sur l'orbite et ondes de pression. Non mortels : ils changent la vitesse du vaisseau. */
export const CLOUDS = {
  /** Facteur de vitesse au cœur d'un nuage. */
  factor: 0.55,
  /** Demi-largeur angulaire d'un nuage (rad) et largeur du fondu d'entrée/sortie (rad) : interpolation douce, jamais de saut. */
  half: { min: 0.32, max: 0.55 },
  edge: 0.16,
  /** Dérive lente le long du cercle (rad/s, signe tiré). */
  drift: { min: 0.025, max: 0.07 },
  /** Emplacements simultanés ; chaque nuage vit `life` s, apparaît et s'efface en `fade` s, puis l'emplacement se repose `gap` s. */
  slots: 3,
  life: { min: 26, max: 40 },
  fade: 3,
  gap: { min: 3, max: 9 },
  /** Décalage d'apparition du premier nuage de chaque emplacement (s locales). */
  firstAt: [3, 9, 15] as readonly number[],
  /** Ondes de pression : annonce (s), vitesse angulaire du front (rad/s), demi-largeur (rad), facteur, intervalle (s). */
  wave: { warn: 2.4, speed: 1.15, half: 0.3, edge: 0.12, factor: 0.62, turns: 1, every: { min: 15, max: 22 }, first: 24 },
  /** Bulles d'ombre (décor seulement : jamais les dangers ni leurs annonces) : intervalle, durée, opacité maximale du voile. */
  shadow: { every: { min: 16, max: 24 }, duration: { min: 5, max: 8 }, alpha: 0.55, first: 30 },
} as const;

/** Monde des vents : hémisphères de vitesse, inversions de courant, tourbillons. */
export const CURRENTS = {
  /** Facteurs des deux hémisphères (hypothèse de jeu à valider : 120 % / 50 % de la vitesse de référence locale). */
  fast: 1.2,
  slow: 0.5,
  /** Largeur de la frontière (rad) : le vaisseau accélère ou ralentit progressivement en la franchissant. */
  edge: 0.22,
  /** Centre initial de l'hémisphère rapide (rad, π = gauche de l'écran) et dérive lente de la frontière (rad/s). */
  fastCenter: Math.PI,
  drift: 0.035,
  /** Inversions de courant : la frontière tourne d'un demi-tour (échange des hémisphères) en `swap` s, après `warn` s d'annonce. */
  inversion: { first: 28, every: { min: 26, max: 38 }, warn: 3.5, swap: 1.6 },
  /** Tourbillons : zone de l'orbite (demi-largeur, fondu) où l'on va plus vite dans le sens du tourbillon et plus lentement à contre-sens. */
  vortex: { first: 12, every: { min: 11, max: 17 }, warn: 2.2, life: { min: 6, max: 8.5 }, half: 0.34, edge: 0.14, with: 1.35, against: 0.68 },
  /** Bornes du facteur total d'un champ (filet de sécurité). */
  clamp: { min: 0.38, max: 1.5 },
} as const;

// ————————————————————————————————————————————— les univers

export const WORLD_LIST: readonly WorldDef[] = [
  {
    id: 'origin',
    index: 1,
    name: 'L’Orbite originelle',
    tagline: 'Là où le voyage commence.',
    palette: { sky: 0x050a1f, primary: 0x2f8cff, secondary: 0x58e1ff, accent: 0xbfefff, core: 0xd6f2ff, orbit: 0x5f9fe0 },
    speed: { from: 0.45, to: 0.72 },
    difficulty: [[0, 0.12], [20, 0.26], [60, 0.46], [95, 0.6], [115, 0.66]],
    interval: 1,
    field: 'none',
    events: true,
    beatChance: 0.35,
    transition: { variant: 'rift', from: 0x2f8cff, to: 0xa04bff },
    weights(t) {
      const sector = ramp(t, 10, 10);
      const dbl = ramp(t, 22, 18);
      const late = ramp(t, 42, 18);
      const combo = ramp(t, 60, 25);
      const adv = ramp(t, 88, 20);
      const simple = 1 - 0.4 * ramp(t, 60, 40);
      return {
        shot: 1 * simple,
        diameter: 0.5 * simple,
        arc: 0.9 * sector * simple,
        parallel: 0.7 * dbl,
        cross: 0.6 * dbl,
        convoy: 0.7 * ramp(t, 34, 20),
        echo: 0.6 * late,
        twinArcs: 0.45 * late * sector,
        chase: 0.5 * late * sector,
        fragment: 0.7 * ramp(t, 60, 20),
        shotArc: 0.8 * combo,
        burst: 0.6 * adv,
        pincer: 0.5 * adv,
        beatShots: 0.6 * ramp(t, 48, 25),
      };
    },
  },
  {
    id: 'between',
    index: 2,
    name: 'L’Entre-deux',
    tagline: 'L’énergie se déchire.',
    palette: { sky: 0x0b0420, primary: 0x8a3dff, secondary: 0xd04bff, accent: 0x3d6bff, core: 0x1a0638, orbit: 0x8a82ff },
    speed: { from: 0.8, to: 0.92 },
    difficulty: [[0, 0.52], [30, 0.6], [70, 0.68], [110, 0.75]],
    interval: 0.95,
    field: 'none',
    events: false,
    beatChance: 0.5,
    transition: { variant: 'mist', from: 0x8a3dff, to: 0x3fe0d0 },
    weights(t) {
      const combos = ramp(t, 80, 25);
      return {
        riftOrb: 1.0 * ramp(t, 0, 8),
        surgeArc: 0.9 * ramp(t, 6, 10),
        spiral: 0.85 * ramp(t, 16, 12),
        altBeams: 0.8 * ramp(t, 34, 12),
        orbPair: 0.7 * ramp(t, 45, 15),
        rotBeam: 0.7 * ramp(t, 58, 12),
        spiralArc: 0.7 * combos,
        beamShot: 0.6 * combos,
        surgeOrb: 0.7 * combos,
      };
    },
  },
  {
    id: 'nebula',
    index: 3,
    name: 'La Mer nébulaire',
    tagline: 'Le silence a une profondeur.',
    palette: { sky: 0x02141c, primary: 0x2fd9d0, secondary: 0x1e6b8a, accent: 0xb8fff0, core: 0x9ff7ee, orbit: 0x8fe7ff },
    speed: { from: 0.68, to: 0.76 },
    difficulty: [[0, 0.5], [40, 0.6], [80, 0.68], [115, 0.74]],
    interval: 1.05,
    field: 'clouds',
    events: false,
    beatChance: 0,
    transition: { variant: 'spiral', from: 0x2fd9d0, to: 0xff8a2a },
    weights(t) {
      return {
        gasMass: 1.0 * ramp(t, 0, 8),
        nebulaDebris: 0.9 * ramp(t, 8, 10),
        gasDrift: 0.8 * ramp(t, 22, 12),
        debrisVolley: 0.75 * ramp(t, 40, 14),
        massDebris: 0.75 * ramp(t, 64, 16),
        gasPair: 0.6 * ramp(t, 86, 16),
      };
    },
  },
  {
    id: 'winds',
    index: 4,
    name: 'Le Monde des vents',
    tagline: 'Tout ce qui flotte est emporté.',
    palette: { sky: 0x1a0702, primary: 0xff7a1a, secondary: 0xffb347, accent: 0xffe2a8, core: 0xffc06a, orbit: 0xffd9a0 },
    speed: { from: 0.82, to: 0.88 },
    difficulty: [[0, 0.56], [40, 0.65], [80, 0.72], [115, 0.78]],
    interval: 1,
    field: 'currents',
    events: false,
    beatChance: 0,
    transition: { variant: 'spiral', from: 0xff8a2a, to: 0xff5a1a },
    weights(t) {
      const combos = ramp(t, 70, 20);
      return {
        windShards: 1.0 * ramp(t, 0, 8),
        gust: 0.85 * ramp(t, 10, 12),
        emberStream: 0.8 * ramp(t, 24, 12),
        windWall: 0.6 * ramp(t, 48, 14),
        gustShards: 0.7 * combos,
        emberSpiral: 0.6 * ramp(t, 90, 15),
      };
    },
  },
];

export const WORLD_COUNT = WORLD_LIST.length;

// ————————————————————————————————————————————— calendrier

/** Indice (0-based) de l'univers au temps de survie actif `t` ; le dernier se prolonge. */
export function worldIndexAt(t: number): number {
  if (t < 0) return 0;
  return Math.min(WORLD_COUNT - 1, Math.floor(t / WORLDS.span + 1e-9));
}

/** Définition de l'univers au temps `t`. */
export function worldAt(t: number): WorldDef {
  return WORLD_LIST[worldIndexAt(t)];
}

/** Début (s actives) de l'univers d'indice 0-based `i`. */
export const worldStart = (i: number): number => i * WORLDS.span;

/** Temps LOCAL dans l'univers courant (le dernier n'est pas borné). */
export function localTime(t: number): number {
  return t - worldStart(worldIndexAt(t));
}

/** Prochaine frontière d'univers après `t` (Infinity s'il n'y en a plus). */
export function nextBoundary(t: number): number {
  const i = worldIndexAt(t);
  return i >= WORLD_COUNT - 1 ? Infinity : worldStart(i + 1);
}

/** Pas de simulation (120 Hz) auquel commence l'univers d'indice 0-based `i`. */
export const worldStartStep = (i: number): number => Math.round(worldStart(i) * 120);

// ————————————————————————————————————————————— dangers propres aux univers (toujours vérifiés par le validateur d'évitement)

export const WORLD_HAZARDS = {
  /** L'Entre-deux — arcs électriques mouvants : la largeur respire (×halfTo) et le centre dérive (rad/s) dès l'annonce. */
  surgeArc: { halfFrom: { min: 0.7, max: 0.95 }, halfTo: { min: 0.5, max: 1.35 }, drift: { min: 0.16, max: 0.34 }, extraActive: 0.45, extraWarn: 0.15 },
  /** Orbes de faille : grands arcs d'énergie, un peu plus lents que les astéroïdes, taille 0,9. */
  riftOrb: { speedScale: 0.84, extraWarn: 0.3, scale: 0.9, pairStagger: { min: 0.55, max: 0.9 } },
  /** Mer nébulaire — masses gazeuses : grandes, lentes, longuement annoncées. */
  gasMass: { speedScale: 0.42, scale: 2.1, extraWarn: 0.5, pairStagger: { min: 0.9, max: 1.4 } },
  /** Masses à la dérive : la même masse sur une grande courbe. */
  gasDrift: { speedScale: 0.56, scale: 1.85, extraWarn: 0.55 },
  /** Débris nébulaires : petits, translucides, ondulants. */
  debris: { speedScale: 0.55, scale: 0.62, amp: { min: 14, max: 30 }, k: { min: 2.2, max: 3.6 }, count: { min: 2, max: 3 }, stagger: { min: 0.35, max: 0.6 }, extraWarn: 0.3 },
  /** Monde des vents — fragments emportés par les courants (spirales entrantes). */
  windShard: { speedScale: 0.74, spin: { min: 1.0, max: 1.6 }, count: { min: 2, max: 3 }, stagger: { min: 0.18, max: 0.3 }, scale: 0.8, extraWarn: 0.3 },
  /** Courant de braises : convoi sur une courbe. */
  emberStream: { count: { min: 3, max: 4 }, stagger: { min: 0.38, max: 0.55 } },
  /** Vagues de vent : fronts qui tournent lentement autour de l'arène (bien moins vite que le vaisseau). */
  gust: { rate: { min: 0.26, max: 0.42 }, duration: { min: 3.4, max: 4.8 }, half: 0.06, warn: 1.6, coverage: 1.0 },
  /** Durée de vol maximale d'un danger courbe des univers (s) : au-delà, repli sur une trajectoire droite (jamais de danger qui longe l'orbite). */
  maxCurveFlight: 5.5,
  /** Plafonds des secteurs et faisceaux simultanés par univers. */
  caps: { maxSectors: 5, maxCoverage: 0.48 },
} as const;
