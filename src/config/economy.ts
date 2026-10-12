/**
 * Économie à deux monnaies — tous les réglages sont ici (aucune valeur en dur ailleurs).
 *
 * - Éclats : gagnés en jouant (éclat sur l'orbite en Survie, récompenses de niveau), dépensés en cosmétiques.
 * - Prismes : monnaie premium, solde séparé (0 au départ), jamais collectée sur l'orbite. Aucun achat réel n'est actif
 *   dans cette version (voir monetization/payments.ts).
 * Tous les achats sont cosmétiques : mêmes vitesses et mêmes hitboxes dans tous les modes.
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
export const WALLET_START = { shards: 0, prisms: 0 } as const;

/** Plafond de sécurité d'un solde (valeurs de sauvegarde aberrantes ramenées à cette limite). */
export const WALLET_MAX = 1_000_000_000;

/**
 * Apparences qui se débloquaient par un succès avant la v1.5 (sauvegarde < 3) : celles déjà obtenues sont conservées.
 * Les apparences qui restent exclusives aux succès sont décrites dans config/catalog.ts.
 */
export const LEGACY_SKIN_ACHIEVEMENTS: Record<string, string> = {
  aurore: 'first_cycle',
  menthe: 'first_level',
  ambre: 'survive_60',
  glace: 'max_combo',
  solaire: 'survive_300',
  prisme: 'all_levels',
};
