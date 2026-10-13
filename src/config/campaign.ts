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
export const OBJECT_KINDS: Record<ObjectKind, { name: string; plural: string; /** Libellé du compteur affiché en jeu. */ counter: string }> = {
  /** Fragments d'épave (niveau 4). */
  fragment: { name: 'fragment d’épave', plural: 'fragments d’épave', counter: 'Fragments d’épave' },
  /** Balise de la capsule (balise NARRATIVE, distincte des éclats de gameplay) : le téléchargement se fait par passages (niveau 5). */
  blackbox: { name: 'balise de la capsule', plural: 'balises de la capsule', counter: 'Téléchargement' },
  data: { name: 'donnée', plural: 'données', counter: 'Données' },
};

export type Objective =
  /** Survivre `seconds` secondes. */
  | { type: 'survive'; seconds: number; /** Compteur affiché (progression en %) : « Trajet », « Traversée du nuage »… */ label?: string }
  /** Collecter `count` balises (en tout, cycles confondus). */
  | { type: 'beacons'; count: number }
  /**
   * Récupérer `count` objets successifs : un seul visible à la fois, durée limitée, un objet manqué réapparaît.
   * `after` : phase d'approche — les objets n'apparaissent qu'une fois `beacons` éclats récoltés (puis `first` secondes plus tard).
   */
  | { type: 'objects'; kind: ObjectKind; count: number; lifetime: number; first: number; gap: { min: number; max: number }; respawn: number; /** Libellé du compteur (sinon celui du type d'objet). */ counter?: string; after?: { beacons: number; label: string } }
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
    objective: { type: 'beacons', count: 84 },
    objectiveText: 'Récolter 84 éclats',
    limit: 240,
    speed: 0.4,
    script: {
      difficulty: [0.03, 0.2],
      firstWave: 3,
      phases: [phase(0, 240, { shot: 1 }, 1.2)],
      breaths: [[32, 35], [78, 81], [124, 127], [170, 173]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 115, text: 'Terminer en moins de 115 secondes' },
    before: 'n1-before',
    after: 'n1-after',
  },
  {
    id: 2,
    title: 'Une bonne journée',
    summary: 'La récolte est anormalement riche, mais le champ se densifie et les trajectoires deviennent imprévisibles.',
    objective: { type: 'beacons', count: 114 },
    objectiveText: 'Récolter 114 éclats',
    limit: 300,
    speed: 0.45,
    script: {
      difficulty: [0.08, 0.26],
      firstWave: 2.4,
      phases: [phase(0, 70, { shot: 1, diameter: 0.4 }, 1.1), phase(70, 300, { shot: 1, diameter: 0.6, parallel: 0.25 }, 1)],
      breaths: [[46, 49], [100, 103], [155, 158], [210, 213], [262, 265]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'combo', target: 4, text: 'Atteindre le multiplicateur ×4' },
    before: 'n2-before',
    after: 'n2-after',
  },
  {
    id: 3,
    title: 'Tenir',
    summary: 'La première tempête d’astéroïdes ferme le passage. Survivez et sortez de la zone ; rien d’autre ne compte.',
    objective: { type: 'survive', seconds: 150 },
    objectiveText: 'Survivre à la tempête (150 secondes)',
    limit: 150,
    speed: 0.5,
    script: {
      difficulty: [0.14, 0.32],
      firstWave: 2,
      phases: [phase(0, 25, { shot: 1, diameter: 0.7, parallel: 0.4 }), phase(25, 150, { shot: 1, diameter: 0.8, parallel: 0.6, cross: 0.4, convoy: 0.5 }, 0.85)],
      breaths: [[42, 45], [72, 75], [102, 105], [130, 133]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'beacons', target: 70, text: 'Récolter au moins 70 éclats en chemin' },
    before: 'n3-before',
    after: 'n3-after',
  },
  {
    id: 4,
    title: 'Ce que la tempête a laissé',
    summary: 'Le calme revient. Traversez les débris, récoltez ce qui reste et suivez les fragments d’épave.',
    objective: { type: 'objects', kind: 'fragment', count: 6, lifetime: 18, first: 16, gap: { min: 22, max: 30 }, respawn: 3 },
    objectiveText: 'Suivre 6 fragments d’épave',
    limit: 300,
    speed: 0.5,
    script: {
      difficulty: [0.1, 0.34],
      firstWave: 3,
      phases: [phase(0, 300, { shot: 1, fragment: 0.5, diameter: 0.2 }, 1.2)],
      breaths: [[28, 31], [66, 69], [104, 107], [142, 145], [180, 183], [218, 221], [256, 259]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 180, text: 'Terminer en moins de 180 secondes' },
    before: 'n4-before',
    after: 'n4-after',
  },
  {
    id: 5,
    title: 'Douze ans de silence',
    summary: 'Atteignez la capsule à travers les débris, puis restez près de sa balise le temps de télécharger ses données.',
    objective: { type: 'objects', kind: 'blackbox', count: 5, lifetime: 18, first: 8, gap: { min: 18, max: 24 }, respawn: 3, after: { beacons: 100, label: 'Approche de la capsule' } },
    objectiveText: 'Atteindre la capsule (100 éclats), puis télécharger la balise (5 passages)',
    limit: 300,
    speed: 0.5,
    script: {
      difficulty: [0.14, 0.36],
      firstWave: 2.4,
      phases: [phase(0, 300, { shot: 1, diameter: 0.6, parallel: 0.3, cross: 0.2, fragment: 0.4, convoy: 0.2 }, 1.05)],
      breaths: [[34, 37], [70, 73], [106, 109], [142, 145], [178, 181], [214, 217], [250, 253], [284, 287]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 240, text: 'Terminer en moins de 240 secondes' },
    before: 'n5-before',
    after: 'n5-after',
  },
  {
    id: 6,
    title: 'Ceux qui sont partis',
    summary: 'Quittez le champ par la route de Nora : des astéroïdes modérés d’abord, puis des passages resserrés. Ramassez des éclats en chemin, sans obligation de tout prendre.',
    objective: { type: 'survive', seconds: 170, label: 'Route vers la sortie' },
    objectiveText: 'Quitter le champ par la route de Nora (170 secondes)',
    limit: 170,
    speed: 0.55,
    script: {
      difficulty: [0.18, 0.34],
      firstWave: 2.4,
      phases: [phase(0, 70, { shot: 1, diameter: 0.5, parallel: 0.3 }), phase(70, 170, { shot: 1, parallel: 0.6, cross: 0.5, convoy: 0.5, burst: 0.2 }, 0.9)],
      breaths: [[34, 37], [70, 73], [104, 107], [138, 141]],
      lines: [],
      announces: [{ at: 68, text: 'Passages resserrés' }],
    },
    challenge: { kind: 'beacons', target: 100, text: 'Récolter au moins 100 éclats en chemin' },
    before: 'n6-before',
    after: 'n6-after',
  },
  {
    id: 7,
    title: 'Dans le bruit',
    summary: 'Traversez le nuage chargé : les décharges électriques arrivent progressivement et la radio se coupe. Gardez le cap jusqu’à la sortie.',
    objective: { type: 'survive', seconds: 180, label: 'Traversée du nuage' },
    objectiveText: 'Traverser le nuage chargé (180 secondes)',
    limit: 180,
    speed: 0.55,
    script: {
      difficulty: [0.12, 0.26],
      firstWave: 2.8,
      phases: [
        phase(0, 30, { shot: 1, diameter: 0.4 }, 1.15),
        phase(30, 70, { arc: 0.5, shot: 0.8 }, 1.25),
        phase(70, 115, { arc: 0.8, twinArcs: 0.25, shot: 0.5 }, 1.3),
        phase(115, 155, { arc: 0.8, twinArcs: 0.3, chase: 0.12, shot: 0.5 }, 1.3),
        phase(155, 180, { arc: 0.7, twinArcs: 0.3, chase: 0.15, shot: 0.5 }, 1.3),
      ],
      breaths: [[68, 71], [113, 116], [153, 156]],
      lines: [],
      announces: [
        { at: 28, text: 'Nuage chargé : décharges en approche' },
        { at: 72, text: 'Parasites : liaison radio coupée' },
        { at: 150, text: 'Liaison radio rétablie' },
      ],
    },
    challenge: { kind: 'beacons', target: 100, text: 'Récolter au moins 100 éclats dans le nuage' },
    before: 'n7-before',
    after: 'n7-after',
  },
  {
    id: 8,
    title: 'À contre-courant',
    summary: 'Des vagues de trajectoires anormales sont annoncées à l’avance. Relevez les perturbations entre les vagues pour compléter le dossier.',
    objective: { type: 'objects', kind: 'data', count: 6, lifetime: 18, first: 14, gap: { min: 22, max: 30 }, respawn: 3, counter: 'Relevés de perturbation' },
    objectiveText: 'Relever 6 perturbations entre les vagues d’astéroïdes',
    limit: 300,
    speed: 0.55,
    script: {
      difficulty: [0.18, 0.38],
      firstWave: 3,
      phases: [
        phase(0, 45, { shot: 1, diameter: 0.3 }, 1.1),
        phase(45, 80, { convoy: 1.2, echo: 0.6, shot: 0.4 }),
        phase(80, 115, { shot: 1, diameter: 0.3 }, 1.1),
        phase(115, 150, { fragment: 1, convoy: 0.8, echo: 0.6, shot: 0.3 }),
        phase(150, 185, { shot: 1, diameter: 0.3 }, 1.1),
        phase(185, 300, { convoy: 1, fragment: 0.8, echo: 0.8, parallel: 0.4 }, 0.9),
      ],
      breaths: [[80, 83], [150, 153], [232, 235], [270, 273]],
      lines: [],
      announces: [
        { at: 43, text: 'Vague de trajectoires !' },
        { at: 113, text: 'Vague de trajectoires !' },
        { at: 183, text: 'Vague de trajectoires !' },
      ],
    },
    challenge: { kind: 'time', target: 175, text: 'Terminer en moins de 175 secondes' },
    before: 'n8-before',
    after: 'n8-after',
  },
  {
    id: 9,
    title: 'Ne laissez pas repartir',
    summary: 'Longez la haute atmosphère sans plonger : décharges et débris. Suivez les balises de navigation qui guident la route, et renoncez plutôt que de descendre.',
    objective: { type: 'objects', kind: 'data', count: 7, lifetime: 20, first: 12, gap: { min: 24, max: 32 }, respawn: 3, counter: 'Balises de navigation' },
    objectiveText: 'Suivre 7 balises de navigation le long de la bordure atmosphérique',
    limit: 300,
    speed: 0.6,
    script: {
      difficulty: [0.18, 0.34],
      firstWave: 2.8,
      phases: [
        phase(0, 50, { shot: 1, diameter: 0.5, fragment: 0.4 }),
        phase(50, 100, { arc: 0.8, shot: 0.6, fragment: 0.4 }, 1.1),
        phase(100, 160, { arc: 1, twinArcs: 0.4, shot: 0.4, fragment: 0.5 }, 1.15),
        phase(160, 300, { arc: 0.9, twinArcs: 0.4, fragment: 0.5, convoy: 0.3, shot: 0.3 }, 1.15),
      ],
      breaths: [[48, 51], [98, 101], [158, 161], [208, 211], [256, 259]],
      lines: [],
      announces: [{ at: 48, text: 'Haute atmosphère : décharges, restez en altitude' }],
    },
    challenge: { kind: 'time', target: 220, text: 'Terminer en moins de 220 secondes' },
    before: 'n9-before',
    after: 'n9-after',
  },
  {
    id: 10,
    title: 'La Lisière',
    summary: 'Approchez le grand transport à distance, au milieu des débris. Relevez ses points d’inspection (moteurs, coque, accès), puis rejoignez la position de contact.',
    objective: { type: 'objects', kind: 'data', count: 7, lifetime: 18, first: 12, gap: { min: 24, max: 32 }, respawn: 3, counter: 'Relevés d’inspection' },
    objectiveText: 'Relever 7 points d’inspection (moteurs, coque, accès), le dernier au point de contact',
    limit: 300,
    speed: 0.55,
    script: {
      difficulty: [0.2, 0.36],
      firstWave: 2.6,
      phases: [phase(0, 300, { shot: 1, diameter: 0.5, parallel: 0.3, cross: 0.25, fragment: 0.5, convoy: 0.25, burst: 0.15 }, 1.1)],
      breaths: [[34, 37], [72, 75], [110, 113], [148, 151], [186, 189], [224, 227], [262, 265]],
      lines: [],
      announces: [],
    },
    challenge: { kind: 'time', target: 225, text: 'Terminer en moins de 225 secondes' },
    before: 'n10-before',
    after: 'n10-after',
  },
];

/**
 * Clé de progression d'un niveau dans la sauvegarde (`save.campaign.missions`). Volontairement distincte de celles de la première campagne
 * (« Écho-7 », clés « 1 » à « 10 », scènes `m*-before|after`) : d'anciennes missions terminées ne peuvent jamais compter pour la nouvelle histoire.
 */
export const missionKey = (id: number): string => `n${id}`;

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
