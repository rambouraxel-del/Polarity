/**
 * Économie à TROIS monnaies — tous les réglages sont ici (aucune valeur en dur ailleurs). Aucune conversion automatique entre elles.
 *
 * - Éclats : gagnés en jouant (éclat sur l'orbite en Survie, récompenses de niveau) ; servent aux BONUS (Boost, Gel temporel).
 * - Médailles : gagnées en RÉCLAMANT les succès (config/achievements.ts) ; servent exclusivement aux cosmétiques non premium.
 * - Prismes : monnaie premium (gagnée très rarement ou achetée plus tard) ; vaisseaux et traînées premium, puis secondes chances.
 *   Le solde de Prismes vient UNIQUEMENT du service (jamais d'une donnée locale). Aucun achat réel n'est actif (monetization/payments.ts).
 * Les achats sont cosmétiques ou des bonus d'inventaire : aucun effet sur les hitboxes ni sur les règles de la simulation partagée.
 */

/** Éclat sur l'orbite (Survie). */
export const SHARDS = {
  /** Gain d'une collecte (Éclats). Ni le score ni le combo ne le multiplient. */
  reward: 5,
  /** Durée de disponibilité d'un éclat (s de temps de jeu actif). */
  lifetime: 5,
  /** Délai avant la première apparition (s). */
  firstDelay: { min: 15, max: 25 },
  /** Délai avant l'apparition suivante, après une collecte ou une disparition (s). */
  nextDelay: { min: 15, max: 25 },
  /** Rayon de collecte (unités monde le long de l'orbite) : demi-arc = rayon / rayon de l'orbite. */
  collectRadius: 17,
  /** Écart angulaire minimal (rad) entre l'apparition et le vaisseau : l'éclat n'est jamais offert. */
  minShipGap: 0.6,
  /** Écart angulaire minimal (rad) avec une balise active : l'éclat ne se confond pas avec elles. */
  minBeaconGap: 0.3,
  /** Marge de réaction (s) retranchée à la durée pour vérifier qu'une collecte reste possible après une inversion. */
  reactionMargin: 1.0,
  /** Tirages d'emplacement avant de se rabattre sur un emplacement accessible garanti. */
  attempts: 16,
  /** Modes où les éclats apparaissent. */
  modes: { survival: true, daily: false, level: false },
} as const;

/** Récompenses des niveaux (Éclats). Les bonus de première réussite et d'étoiles ne sont versés qu'une fois. */
export const LEVEL_REWARDS = {
  /** Première réussite d'un niveau. */
  firstClear: 50,
  /** Par étoile obtenue pour la première fois (jamais deux fois la même étoile d'un niveau). */
  perStar: 15,
  /** Chaque réussite suivante du même niveau. */
  repeatClear: 10,
} as const;

/** Soldes initiaux. */
export const WALLET_START = { shards: 0, medals: 0, prisms: 0 } as const;

/**
 * Bonus de Survie (phase 2 : stock, achats et préparation ; les EFFETS en partie arrivent en phase 3).
 * Chaque charge s'achète en Éclats et se conserve entre les parties (jamais supprimée). Un achat crédite l'inventaire sans rien consommer ;
 * la consommation aura lieu lors d'une activation réussie (phase 3).
 */
export type BonusKind = 'boost' | 'gel';

export interface BonusDef {
  id: BonusKind;
  name: string;
  /** Prix d'une charge, en Éclats. */
  price: number;
  blurb: string;
}

export const BONUS_LIST: readonly BonusDef[] = [
  { id: 'boost', name: 'Boost', price: 50, blurb: 'Vitesse du vaisseau +50 % pendant 5 s, recharge 10 s.' },
  { id: 'gel', name: 'Gel temporel', price: 100, blurb: 'Menaces ralenties de 60 % pendant 6 s, recharge 20 s.' },
];

export const BONUS = {
  /** Activations maximales par bonus pendant la première vie d'une partie (ne limite pas le stock). */
  maxActivationsPerRun: 3,
  /** Stock maximal par bonus (borne de sécurité de l'inventaire et de la sauvegarde). */
  maxStock: 99,
  /** Charges achetables d'un coup dans l'interface. */
  quantities: [1, 5] as readonly number[],
  /** Les effets en partie sont-ils actifs ? (phase 3 : oui) Si faux, l'interface le dit honnêtement. */
  activationEnabled: true,
} as const;

export const bonusDef = (id: string): BonusDef | undefined => BONUS_LIST.find((b) => b.id === id);

/** Plafond de sécurité d'un solde (valeurs de sauvegarde aberrantes ramenées à cette limite). */
export const WALLET_MAX = 1_000_000_000;
