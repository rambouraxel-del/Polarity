/**
 * Pouvoirs de la Survie (économie v3, phase 3) — TOUS les réglages sont ici ; la simulation (sim/powers.ts) les convertit en pas de simulation.
 * Les durées et les recharges sont du TEMPS DE JEU ACTIF (la pause les suspend) ; la recharge commence dès l'activation.
 *
 * - Boost : vitesse du vaisseau × 1,5 (sur la vitesse réelle courante : la courbe de difficulté reprend sa valeur à la fin).
 * - Gel temporel : les dangers avancent à 40 % de leur vitesse (ralentis de 60 %). Boost et Gel ne fonctionnent jamais ensemble.
 * - Bouclier : gratuit, chargé par 18 balises (une charge stockée au plus), activation manuelle, absorbe UN impact, 8 s au plus.
 * - Première vie : charges achetées (une par activation réussie), 3 activations au plus par bonus (BONUS.maxActivationsPerRun).
 *   Après une reprise : Boost et Gel gratuits et illimités (mêmes recharges), Bouclier inchangé.
 * - Reprise : sécurisée (dangers écartés), 3 s d'invulnérabilité clignotante ; deuxième vie : publicité récompensée ou 5 Prismes ;
 *   troisième vie : 10 Prismes ; jamais de quatrième vie ; les vies 2 et 3 ne sont jamais classées.
 */
export type PowerKind = 'boost' | 'gel' | 'shield';

export const POWERS = {
  boost: {
    /** Multiplicateur de la vitesse réelle courante. */
    multiplier: 1.5,
    duration: 5,
    cooldown: 10,
  },
  gel: {
    /** Vitesse effective des dangers pendant le Gel (0,4 = ralentis de 60 %). */
    dangerSpeed: 0.4,
    duration: 6,
    cooldown: 20,
  },
  shield: {
    /** Balises à collecter pour une charge. */
    beacons: 18,
    /** Durée maximale de protection (s). */
    duration: 8,
  },
} as const;

/** Reprise après la première mort. */
export const REVIVE = {
  /** Nombre de vies au maximum (première + deux reprises). */
  maxLives: 3,
  /** Invulnérabilité accordée à chaque reprise (s). */
  invulnerability: 3,
  /** Coût en Prismes de la reprise qui ouvre la vie 2 et la vie 3 (la publicité n'est possible que pour la vie 2). */
  prisms: { 2: 5, 3: 10 } as Record<number, number>,
  /** Seule la vie 2 peut s'obtenir en regardant une publicité récompensée. */
  adLives: [2] as readonly number[],
} as const;

/** Codes compacts des pouvoirs dans le journal de rejeu (protocole v2). */
export const POWER_CODES: Record<PowerKind, number> = { boost: 0, gel: 1, shield: 2 };
export const POWER_KINDS: readonly PowerKind[] = ['boost', 'gel', 'shield'];
export const POWER_BY_CODE: readonly PowerKind[] = ['boost', 'gel', 'shield'];
