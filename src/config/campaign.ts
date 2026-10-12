import type { PatternWeights } from '../sim/patterns';

/**
 * Campagne — chapitre 1 « Le signal impossible » (Écho-7). Toutes les missions, leurs objectifs, leur difficulté, leurs
 * récompenses et les améliorations du hangar sont décrits ICI, en données typées : ajouter un chapitre ou une mission =
 * ajouter des entrées, sans toucher à la simulation.
 *
 * Règles :
 * - Durées = temps de jeu actif (la pause les arrête). Les missions de collecte se terminent dès l'objectif atteint.
 * - La vitesse du vaisseau est réglée PAR MISSION (`speed`, fraction de 2,0 rad/s) : la courbe temporelle de la Survie ne s'applique pas.
 * - Les trajectoires sont tirées de la graine de la tentative (reproductibles) ; les phases importantes sont scénarisées
 *   (fenêtres de motifs, respirations) mais toujours validées par le validateur d'évitement du directeur de vagues.
 * - Toutes les missions sont réalisables avec le vaisseau de base ; les améliorations sont exclusives à la campagne.
 */

export type ObjectKind = 'fragment' | 'blackbox' | 'data';

/** Objets narratifs : distincts des Éclats (cristal violet), des balises (losanges dorés) et des dangers. */
export const OBJECT_KINDS: Record<ObjectKind, { name: string; plural: string }> = {
  fragment: { name: 'fragment de coordonnées', plural: 'fragments' },
  blackbox: { name: 'boîte noire', plural: 'boîtes noires' },
  data: { name: 'donnée', plural: 'données' },
};

export type Objective =
  /** Survivre `seconds` secondes. */
  | { type: 'survive'; seconds: number }
  /** Collecter `count` balises (en tout, cycles confondus). */
  | { type: 'beacons'; count: number }
  /** Récupérer `count` objets successifs : un seul visible à la fois, durée limitée, un objet manqué réapparaît. */
  | { type: 'objects'; kind: ObjectKind; count: number; lifetime: number; first: number; gap: { min: number; max: number }; respawn: number }
  /** Compléter `count` cycles de balises (verrous désactivés). */
  | { type: 'cycles'; count: number }
  /** Compléter `cycles` cycles, puis récupérer l'objet qui apparaît alors (persistant jusqu'à sa collecte). */
  | { type: 'cyclesThenObject'; cycles: number; kind: ObjectKind };

/** Défi secondaire (2e étoile). */
export type Challenge =
  | { kind: 'time'; target: number; text: string }
  | { kind: 'beacons'; target: number; text: string }
  | { kind: 'combo'; target: number; text: string }
  | { kind: 'cycles'; target: number; text: string };

export interface ScriptPhase {
  from: number;
  to: number;
  weights: PatternWeights;
  /** Multiplicateur de l'intervalle entre vagues (1 = normal). */
  intervalScale?: number;
}

export interface MissionScript {
  /** Difficulté d ∈ [0, 1] au début et à la fin de la limite de temps (interpolée). */
  difficulty: [number, number];
  /** Délai avant la première vague (s). */
  firstWave: number;
  /** Motifs par fenêtre de temps (la dernière fenêtre s'étend jusqu'à la fin). */
  phases: ScriptPhase[];
  /** Motifs selon le nombre de cycles complétés (missions à phases : la phase suit la progression). Prioritaire sur `phases`. */
  phaseByCycles?: PatternWeights[];
  /** Respirations : aucune nouvelle vague entre ces deux instants. */
  breaths: [number, number][];
  /** Calme (s) à chaque changement de phase par cycles. */
  phaseCalm?: number;
  /** Courtes transmissions affichées en partie, uniquement à des moments sûrs (sans menace nouvelle). */
  lines: { at: number; text: string }[];
  /** Événements scénarisés annoncés en partie (bandeau 2 s avant, cosmétique : les motifs viennent des fenêtres `phases`). */
  announces: { at: number; text: string }[];
  /** Séquences (missions de tempête) : bornes des séquences électriques, pour le compteur affiché. */
  sequences?: [number, number][];
}

export interface MissionDef {
  id: number;
  title: string;
  /** Résumé court (carte et fiche). */
  summary: string;
  objective: Objective;
  /** Libellé de l'objectif principal. */
  objectiveText: string;
  /** Durée maximale (s) ; atteinte sans objectif = échec (sauf « survivre »). */
  limit: number;
  /** Vitesse du vaisseau : fraction de 2,0 rad/s. */
  speed: number;
  script: MissionScript;
  challenge: Challenge;
  /** Séquence racontée avant la mission (1re fois seulement) et après sa réussite (1re fois). */
  before?: string;
  after: string;
}

const NONE: PatternWeights = {};

/** Fenêtre de motifs depuis `from` jusqu'à `to`. */
const phase = (from: number, to: number, weights: PatternWeights, intervalScale = 1): ScriptPhase => ({ from, to, weights, intervalScale });

export const MISSIONS: MissionDef[] = [
  {
    id: 1,
    title: 'Réveil en orbite',
    summary: 'NOVA redémarre. Évitez les astéroïdes le temps qu’elle comprenne où vous êtes.',
    objective: { type: 'survive', seconds: 45 },
    objectiveText: 'Survivre 45 secondes',
    limit: 45,
    speed: 0.45,
    script: {
      difficulty: [0.03, 0.14],
      firstWave: 2.2,
      phases: [phase(0, 45, { shot: 1, diameter: 0.3 })],
      breaths: [[18, 21]],
      lines: [{ at: 19, text: 'NOVA : « Systèmes à 60 %… continuez. »' }],
      announces: [],
    },
    challenge: { kind: 'beacons', target: 12, text: 'Collecter au moins 12 balises' },
    before: 'm1-before',
    after: 'm1-after',
  },
  {
    id: 2,
    title: 'Remettre le relais en ligne',
    summary: 'Le relais abandonné réagit à vos balises. Rétablissez la liaison avant qu’elle ne se coupe.',
    objective: { type: 'beacons', count: 6 },
    objectiveText: 'Collecter les six balises en moins de 60 secondes',
    limit: 60,
    speed: 0.5,
    script: {
      difficulty: [0.06, 0.18],
      firstWave: 2,
      phases: [phase(0, 60, { shot: 1, diameter: 0.4 })],
      breaths: [[25, 28]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 25, text: 'Terminer en moins de 25 secondes' },
    after: 'm2-after',
  },
  {
    id: 3,
    title: 'Des coordonnées effacées',
    summary: 'Des fragments de coordonnées apparaissent un à un sur l’orbite. Récupérez-les avant qu’ils ne s’effacent.',
    objective: { type: 'objects', kind: 'fragment', count: 3, lifetime: 7, first: 4, gap: { min: 1.5, max: 2.5 }, respawn: 1.5 },
    objectiveText: 'Récupérer 3 fragments de coordonnées',
    limit: 90,
    speed: 0.5,
    script: {
      difficulty: [0.08, 0.2],
      firstWave: 2.5,
      phases: [phase(0, 90, { shot: 1, diameter: 0.5 })],
      breaths: [[12, 14.5], [30, 33]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 35, text: 'Terminer en moins de 35 secondes' },
    before: 'm3-before',
    after: 'm3-after',
  },
  {
    id: 4,
    title: 'Le passage des convois',
    summary: 'Des convois d’astéroïdes traversent l’orbite. Anticipez le suivant avant d’éviter le premier.',
    objective: { type: 'survive', seconds: 60 },
    objectiveText: 'Survivre 60 secondes',
    limit: 60,
    speed: 0.55,
    script: {
      difficulty: [0.14, 0.3],
      firstWave: 2.2,
      phases: [phase(0, 60, { convoy: 1.4, shot: 0.5 })],
      breaths: [[20, 23], [40, 43]],
      lines: [{ at: 21, text: 'NOVA : « Ils arrivent par vagues… restez attentif. »' }],
      announces: [],
    },
    challenge: { kind: 'combo', target: 3, text: 'Atteindre le multiplicateur ×3' },
    after: 'm4-after',
  },
  {
    id: 5,
    title: 'La boîte noire',
    summary: 'Complétez deux cycles de balises : la boîte noire du relais se révélera sur l’orbite.',
    objective: { type: 'cyclesThenObject', cycles: 2, kind: 'blackbox' },
    objectiveText: 'Compléter 2 cycles puis récupérer la boîte noire',
    limit: 90,
    speed: 0.55,
    script: {
      difficulty: [0.16, 0.3],
      firstWave: 2.4,
      phases: [phase(0, 90, { shot: 1, diameter: 0.5, arc: 0.35 })],
      breaths: [[16, 19], [36, 39]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 50, text: 'Terminer en moins de 50 secondes' },
    before: 'm5-before',
    after: 'm5-after',
  },
  {
    id: 6,
    title: 'Tempête ionique',
    summary: 'Trois séquences de secteurs électriques balaient l’orbite. Quittez les zones avant qu’elles ne s’allument.',
    objective: { type: 'survive', seconds: 75 },
    objectiveText: 'Survivre aux 3 séquences électriques (75 s)',
    limit: 75,
    speed: 0.6,
    script: {
      difficulty: [0.2, 0.38],
      firstWave: 2.5,
      phases: [
        phase(0, 10, { shot: 1, diameter: 0.3 }),
        phase(10, 22, { arc: 1, twinArcs: 0.6, chase: 0.4, shot: 0.25 }, 0.9),
        phase(22, 32, { shot: 0.8, diameter: 0.3 }),
        phase(32, 44, { arc: 1, twinArcs: 0.7, chase: 0.5, shot: 0.25 }, 0.85),
        phase(44, 54, { shot: 0.8, diameter: 0.3 }),
        phase(54, 66, { arc: 1, twinArcs: 0.8, chase: 0.6, shot: 0.25 }, 0.8),
        phase(66, 75, { shot: 0.6 }),
      ],
      breaths: [[22, 24.5], [44, 46.5], [66, 69]],
      lines: [
        { at: 23, text: 'NOVA : « Première séquence franchie. »' },
        { at: 45, text: 'NOVA : « Encore une. Le signal se renforce. »' },
        { at: 67, text: 'NOVA : « Plus qu’à tenir jusqu’au bout. »' },
      ],
      announces: [
        { at: 8, text: 'Séquence électrique 1/3' },
        { at: 30, text: 'Séquence électrique 2/3' },
        { at: 52, text: 'Séquence électrique 3/3' },
      ],
      sequences: [[10, 22], [32, 44], [54, 66]],
    },
    challenge: { kind: 'beacons', target: 14, text: 'Collecter au moins 14 balises' },
    after: 'm6-after',
  },
  {
    id: 7,
    title: 'Débris instables',
    summary: 'Des astéroïdes se fragmentent près de l’orbite. Récupérez trois données au milieu des éclats.',
    objective: { type: 'objects', kind: 'data', count: 3, lifetime: 8, first: 5, gap: { min: 2, max: 3 }, respawn: 1.5 },
    objectiveText: 'Récupérer 3 données',
    limit: 90,
    speed: 0.6,
    script: {
      difficulty: [0.24, 0.4],
      firstWave: 2.5,
      phases: [phase(0, 90, { fragment: 1, shot: 0.6, diameter: 0.3 })],
      breaths: [[14, 17], [34, 37]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 55, text: 'Terminer en moins de 55 secondes' },
    after: 'm7-after',
  },
  {
    id: 8,
    title: 'Les défenses d’Écho-7',
    summary: 'Trois verrous protègent la station : chacun cède après un cycle complet. Attention au laser balayeur.',
    objective: { type: 'cycles', count: 3 },
    objectiveText: 'Désactiver 3 verrous (1 cycle complet chacun)',
    limit: 90,
    speed: 0.65,
    script: {
      difficulty: [0.28, 0.46],
      firstWave: 2.5,
      phases: [phase(0, 12, { shot: 1, diameter: 0.4 }), phase(12, 90, { laser: 1, shot: 0.8, arc: 0.3 })],
      breaths: [[10, 12.5], [30, 33], [52, 55]],
      lines: [{ at: 11, text: 'NOVA : « Laser balayeur détecté. Restez hors du faisceau. »' }],
      announces: [],
    },
    challenge: { kind: 'time', target: 55, text: 'Terminer en moins de 55 secondes' },
    before: 'm8-before',
    after: 'm8-after',
  },
  {
    id: 9,
    title: 'Une voix derrière la porte',
    summary: 'Tenez 90 secondes : la voix vous guide à travers deux événements, avec des moments de répit.',
    objective: { type: 'survive', seconds: 90 },
    objectiveText: 'Survivre 90 secondes',
    limit: 90,
    speed: 0.7,
    script: {
      difficulty: [0.32, 0.5],
      firstWave: 2.4,
      phases: [
        phase(0, 25, { shot: 1, diameter: 0.5, parallel: 0.4, arc: 0.4 }),
        phase(25, 37, { shot: 1, diameter: 0.6, convoy: 1.5 }, 0.85), // pluie de météores
        phase(37, 55, { shot: 1, diameter: 0.5, arc: 0.5, parallel: 0.4 }),
        phase(55, 67, { arc: 1, twinArcs: 0.7, chase: 0.6, shot: 0.3 }, 0.8), // tempête électrique
        phase(67, 90, { shot: 0.9, diameter: 0.4, laser: 0.4 }),
      ],
      breaths: [[37, 40], [67, 70], [80, 82]],
      lines: [
        { at: 38.5, text: '« …pas par là… accès secondaire… »' },
        { at: 68.5, text: 'NOVA : « La voix veut nous guider. »' },
      ],
      announces: [
        { at: 23, text: 'Pluie de météores !' },
        { at: 53, text: 'Tempête électrique !' },
      ],
    },
    challenge: { kind: 'cycles', target: 5, text: 'Compléter au moins 5 cycles' },
    after: 'm9-after',
  },
  {
    id: 10,
    title: 'Ouvrir le sas',
    summary: 'Trois verrous, trois phases : astéroïdes, électricité, puis combinaison. Le troisième ouvre le sas.',
    objective: { type: 'cycles', count: 3 },
    objectiveText: 'Désactiver 3 verrous (1 cycle par phase)',
    limit: 90,
    speed: 0.7,
    script: {
      difficulty: [0.36, 0.52],
      firstWave: 2.4,
      phases: [phase(0, 90, NONE)],
      phaseByCycles: [
        { shot: 1, diameter: 0.6, convoy: 0.5 },
        { arc: 1, twinArcs: 0.6, chase: 0.4, shot: 0.3 },
        { shotArc: 1, pincer: 0.5, parallel: 0.6, cross: 0.5, burst: 0.3, shot: 0.4 },
      ],
      breaths: [],
      phaseCalm: 2.5,
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 55, text: 'Terminer en moins de 55 secondes' },
    before: 'm10-before',
    after: 'm10-after',
  },
];

export function missionById(id: number): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** Récompenses (Éclats) : bonus uniques à la première réussite et par étoile secondaire nouvelle ; montant réduit aux répétitions. */
export const CAMPAIGN_REWARDS = {
  firstClear: 30,
  /** Dernière mission du chapitre. */
  finalFirstClear: 60,
  /** Par étoile secondaire nouvellement obtenue (défi, et « sans bouclier »). */
  star: 10,
  /** Réussites suivantes (aucun bonus unique répété). */
  repeat: 5,
} as const;

export interface UpgradeDef {
  id: 'shield' | 'collector' | 'stabilizer';
  name: string;
  /** Effet en une phrase (hangar). */
  effect: string;
  price: number;
  /** Mission à terminer pour que l'amélioration soit présentée. */
  unlockAfter: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'shield', name: 'Bouclier de secours', effect: 'Absorbe une collision par mission, puis ≈ 1 s d’invulnérabilité.', price: 100, unlockAfter: 3 },
  { id: 'collector', name: 'Collecteur amélioré', effect: 'Collecte des balises et des objets de mission un peu plus tolérante.', price: 75, unlockAfter: 5 },
  { id: 'stabilizer', name: 'Stabilisateur orbital', effect: '+0,4 s de répit après les cycles qui en accordent déjà un.', price: 75, unlockAfter: 5 },
];

export function upgradeById(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

/** Effets des améliorations — exclusifs à la campagne (jamais appliqués en Survie, au défi quotidien ni aux défis classiques). */
export const UPGRADE_EFFECTS = {
  shield: {
    /** Collisions absorbées par tentative (rechargé à chaque tentative). */
    charges: 1,
    /** Invulnérabilité après l'absorption (s) ; une collision pendant cette durée ne consomme rien. */
    invulnerable: 1.0,
  },
  collector: {
    /** Demi-arc de collecte supplémentaire pour les balises (rad ≈ 15 unités à l'orbite). */
    beaconArc: 0.05,
    /** Multiplicateur du rayon de collecte des objets de mission. */
    objectScale: 1.5,
  },
  stabilizer: {
    /** Répit supplémentaire (s), borné par RESPITE.maxPerWave (config/balance.ts). */
    extraRespite: 0.4,
  },
} as const;

/** Objets de mission. */
export const MISSION_OBJECTS = {
  /** Demi-arc de collecte de base (rad ≈ 22 unités à l'orbite). */
  radius: 0.075,
  /** Écarts angulaires minimaux à l'apparition : vaisseau et balises actives. */
  minShipGap: 0.6,
  minBeaconGap: 0.3,
  /** Marge de réaction (s) pour la vérification d'accessibilité après une inversion. */
  reactionMargin: 0.9,
  attempts: 16,
} as const;

/** Étoiles : objectif principal, défi secondaire, « sans bouclier ». */
export const STARS_PER_MISSION = 3;

export const CHAPTER = {
  id: 'echo7',
  title: 'Le signal impossible',
  place: 'Écho-7',
  number: 1,
};

/** Cosmétique débloqué en terminant le chapitre (catalogue : config/catalog.ts). */
export const CHAPTER_REWARD_COSMETIC = 'echo';
