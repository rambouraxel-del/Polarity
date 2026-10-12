import type { PatternWeights } from '../sim/patterns';

/**
 * Campagne — chapitre 1, « Douze ans de silence » (niveaux 1 à 5 livrés ; la suite est à venir). Toutes les missions, leurs objectifs, leur difficulté, leurs
 * récompenses et les améliorations du hangar sont décrits ICI, en données typées : ajouter un chapitre ou une mission =
 * ajouter des entrées, sans toucher à la simulation.
 *
 * Règles :
 * - Durées = temps de jeu actif (la pause les arrête). Les missions de collecte se terminent dès l'objectif atteint.
 * - La vitesse du vaisseau est réglée PAR MISSION (`speed`, fraction de 2,0 rad/s) : la courbe temporelle de la Survie ne s'applique pas.
 * - Niveaux 1 à 5 : les astéroïdes sont les seuls dangers (aucun secteur électrique ni laser avant les niveaux suivants).
 * - Aucune transmission n'est affichée pendant une esquive : la narration se joue avant et après chaque niveau (config/story.ts).
 * - Les trajectoires sont tirées de la graine de la tentative (reproductibles) ; les phases importantes sont scénarisées
 *   (fenêtres de motifs, respirations) mais toujours validées par le validateur d'évitement du directeur de vagues.
 * - Toutes les missions sont réalisables avec le vaisseau de base ; les améliorations sont exclusives à la campagne.
 */

export type ObjectKind = 'fragment' | 'blackbox' | 'data';

/** Objets narratifs : distincts des Éclats (cristal violet), des balises (losanges dorés) et des dangers. */
export const OBJECT_KINDS: Record<ObjectKind, { name: string; plural: string }> = {
  /** Fragments d'épave (niveau 4). */
  fragment: { name: 'fragment d’épave', plural: 'fragments d’épave' },
  /** Balise de la capsule : le téléchargement se fait en trois passages (niveau 5). */
  blackbox: { name: 'balise de la capsule', plural: 'balises de la capsule' },
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

/** Fenêtre de motifs depuis `from` jusqu'à `to`. */
const phase = (from: number, to: number, weights: PatternWeights, intervalScale = 1): ScriptPhase => ({ from, to, weights, intervalScale });

/**
 * Les cinq premiers niveaux. Choix d'équilibrage (à valider avec de vrais joueurs) : vitesse et difficulté croissent doucement,
 * tous les niveaux sont faisables avec le vaisseau de base (tests de faisabilité par joueur automatique).
 * « Éclats » = les balises de l'orbite, présentées comme les éclats que récolte Élias.
 */
export const MISSIONS: MissionDef[] = [
  {
    id: 1,
    title: 'De quoi rentrer',
    summary: 'Une journée normale : récoltez de quoi payer le circuit de la Traverse, dans un champ peu dense.',
    objective: { type: 'beacons', count: 6 },
    objectiveText: 'Récolter 6 éclats',
    limit: 90,
    speed: 0.45,
    script: {
      difficulty: [0.02, 0.1],
      firstWave: 2.4,
      phases: [phase(0, 90, { shot: 1 })],
      breaths: [[22, 25]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 40, text: 'Terminer en moins de 40 secondes' },
    before: 'n1-before',
    after: 'n1-after',
  },
  {
    id: 2,
    title: 'Une bonne journée',
    summary: 'La récolte est anormalement riche, mais le champ se densifie et les trajectoires deviennent imprévisibles.',
    objective: { type: 'beacons', count: 12 },
    objectiveText: 'Récolter 12 éclats',
    limit: 90,
    speed: 0.5,
    script: {
      difficulty: [0.06, 0.2],
      firstWave: 2.2,
      phases: [phase(0, 40, { shot: 1, diameter: 0.5 }), phase(40, 90, { shot: 1, diameter: 0.8, parallel: 0.4 }, 0.92)],
      breaths: [[28, 31], [55, 58]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'combo', target: 3, text: 'Atteindre le multiplicateur ×3' },
    before: 'n2-before',
    after: 'n2-after',
  },
  {
    id: 3,
    title: 'Tenir',
    summary: 'La première tempête d’astéroïdes ferme le passage. Survivez et sortez de la zone ; rien d’autre ne compte.',
    objective: { type: 'survive', seconds: 60 },
    objectiveText: 'Survivre à la tempête (60 secondes)',
    limit: 60,
    speed: 0.55,
    script: {
      difficulty: [0.14, 0.3],
      firstWave: 2,
      phases: [phase(0, 20, { shot: 1, diameter: 0.7, parallel: 0.4 }), phase(20, 60, { shot: 1, diameter: 0.8, parallel: 0.6, cross: 0.4, convoy: 0.5 }, 0.85)],
      breaths: [[26, 29], [44, 47]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'beacons', target: 6, text: 'Récolter au moins 6 éclats en chemin' },
    before: 'n3-before',
    after: 'n3-after',
  },
  {
    id: 4,
    title: 'Ce que la tempête a laissé',
    summary: 'Le calme revient. Traversez les débris, récoltez ce qui reste et suivez les fragments d’épave.',
    objective: { type: 'objects', kind: 'fragment', count: 3, lifetime: 8, first: 5, gap: { min: 2, max: 3 }, respawn: 1.5 },
    objectiveText: 'Suivre 3 fragments d’épave',
    limit: 90,
    speed: 0.5,
    script: {
      difficulty: [0.1, 0.22],
      firstWave: 3,
      phases: [phase(0, 90, { shot: 1, fragment: 0.7, diameter: 0.3 }, 1.1)],
      breaths: [[14, 17], [34, 37], [56, 59]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 45, text: 'Terminer en moins de 45 secondes' },
    before: 'n4-before',
    after: 'n4-after',
  },
  {
    id: 5,
    title: 'Douze ans de silence',
    summary: 'Atteignez la capsule à travers les débris et restez près de sa balise le temps de télécharger ses données.',
    objective: { type: 'objects', kind: 'blackbox', count: 3, lifetime: 9, first: 6, gap: { min: 2.5, max: 3.5 }, respawn: 1.5 },
    objectiveText: 'Télécharger les données de la balise (3 passages)',
    limit: 90,
    speed: 0.55,
    script: {
      difficulty: [0.14, 0.3],
      firstWave: 2.4,
      phases: [phase(0, 90, { shot: 1, diameter: 0.7, parallel: 0.4, cross: 0.3, fragment: 0.4, convoy: 0.3 })],
      breaths: [[16, 19], [36, 39], [58, 61]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 55, text: 'Terminer en moins de 55 secondes' },
    before: 'n5-before',
    after: 'n5-after',
  },
];

export function missionById(id: number): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** Récompenses en Éclats de campagne (réserve séparée du portefeuille de la Survie et des cosmétiques) : uniques, jamais répétées. */
export const CAMPAIGN_REWARDS = {
  /** Première réussite d'un niveau. */
  firstClear: 30,
  /** Défi secondaire réussi pour la première fois. */
  star: 10,
  /** Réussites suivantes : aucun gain (pas de répétition en boucle). */
  repeat: 0,
} as const;

/** Présentation de l'écran « Hangar » (améliorations). Désactivé pour les niveaux 1 à 5 : le vaisseau reste celui de départ. */
export const HANGAR_ENABLED = false as boolean;

export interface UpgradeDef {
  id: 'shield' | 'collector' | 'stabilizer';
  name: string;
  /** Effet en une phrase (hangar). */
  effect: string;
  price: number;
  /** Mission à terminer pour que l'amélioration soit présentée. */
  unlockAfter: number;
}

/** Améliorations prévues pour la suite de la campagne (données conservées, non proposées tant que le hangar est désactivé). */
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

/** Étoiles : objectif principal et défi secondaire. */
export const STARS_PER_MISSION = 2;

export const CHAPTER = {
  id: 'douze-ans',
  title: 'Douze ans de silence',
  /** Niveaux livrés ; la suite du chapitre est annoncée « à venir ». */
  place: 'Chapitre 1',
  number: 1,
};
