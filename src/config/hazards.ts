/**
 * Paramètres des nouveaux dangers (v1.2) : astéroïde fragmenté, convoi d'astéroïdes, laser balayeur.
 * Les durées d'annonce, les décalages et la vitesse de balayage sont ensuite adaptés à la vitesse réelle du
 * vaisseau (config/playerSpeed.ts, PACE) ; les planchers de CAPS (config/balance.ts) ne sont jamais abaissés.
 */
export const FRAGMENT = {
  /** Écart angulaire entre les deux points de passage de la corde (rad) : proche d'un diamètre, la division se fait près du centre. */
  sep: { min: 2.6, max: 3.1 },
  /** Position de la division le long de la corde (fraction, autour du milieu) : jitter ±. */
  splitJitter: 0.06,
  /** Écart angulaire de chaque fragment par rapport à la trajectoire de l'astéroïde (rad). */
  spread: { min: 0.35, max: 0.6 },
  /** Vitesse des fragments par rapport à l'astéroïde d'origine. */
  speedScale: 0.85,
  /** Taille des fragments (visuel et hitbox) par rapport à un astéroïde. */
  scale: 0.7,
  /** Délai minimal (s) entre la division et le premier passage d'un fragment sur l'orbite. */
  minLead: 0.45,
  /** Vitesse minimale d'un fragment (unités/s) quand le délai minimal est imposé. */
  minSpeed: 140,
  /** Annonce supplémentaire (s) : les trajectoires des fragments sont visibles dès le début. */
  extraWarn: 0.2,
} as const;

export const CONVOY = {
  /** Nombre d'astéroïdes : 2 ou 3. */
  count: { min: 2, max: 3 },
  /** Décalage de départ entre deux astéroïdes (× comboStagger de la difficulté, adapté à la vitesse du vaisseau). */
  stagger: { min: 0.95, max: 1.2 },
  /** Décalage minimal absolu (s). */
  minStagger: 0.32,
} as const;

export const LASER = {
  /** Demi-largeur angulaire du rayon (rad) ≈ 9 unités à l'orbite ; la hitbox du vaisseau s'y ajoute. */
  half: 0.03,
  /** Variation de l'étendue balayée (fraction). */
  spanJitter: 0.1,
  /** Décalage du centre du secteur par rapport à la position prévue du joueur (rad). */
  aimJitter: 0.8,
  /** Zone de refuge minimale hors secteur balayé (rad), vérifiée avant la validation d'évitement. */
  minRefuge: 2.4,
} as const;

/**
 * Menaces de la PHASE 2 (≥ 300 s de survie active). Toutes les durées d'annonce et vitesses restent bornées par CAPS (config/balance.ts) et
 * adaptées à la vitesse du vaisseau comme les menaces de la phase 1 ; chaque vague est vérifiée par le validateur d'évitement.
 */
export const ARC_SHOT = {
  /** Rayon (unités) du point le plus profond du grand arc : il plonge vers le centre. */
  depth: { min: 110, max: 240 },
  /** Ouverture angulaire de l'arc autour de l'angle visé (rad) : points d'entrée et de sortie hors champ. */
  spread: { min: 1.15, max: 1.8 },
  /** Vitesse de parcours par rapport à celle des projectiles droits. */
  speedScale: 0.92,
  /** Annonce supplémentaire (s) : la courbe entière est tracée. */
  extraWarn: 0.2,
} as const;

export const SPIRAL = {
  /** Nombre de bras (projectiles sur la même spirale, décalés d'un tour fractionné). */
  arms: { min: 1, max: 3 },
  /** Vitesse angulaire (rad/s) de la spirale. */
  spin: { min: 0.95, max: 1.6 },
  /** Vitesse radiale par rapport à celle des projectiles droits. */
  speedScale: 0.78,
  /** Décalage de départ entre deux bras (s). */
  armStagger: { min: 0.12, max: 0.24 },
  extraWarn: 0.25,
  /** Part des spirales qui partent du centre vers l'extérieur (les autres entrent depuis le bord). */
  outwardShare: 0.35,
} as const;

export const ROT_BEAM = {
  /** Vitesse de rotation (rad/s) : toujours nettement inférieure à celle du vaisseau (≥ 1,8 rad/s en phase 2), sinon il serait inévitable. */
  rate: { min: 0.55, max: 0.9 },
  /** Durée de rotation (s) : l'horizon du validateur est de 6 s. */
  duration: { min: 3.4, max: 4.8 },
  half: 0.045,
  warn: 1.45,
  /** Part des vagues avec deux faisceaux opposés. */
  twinShare: 0.4,
  /** Couverture comptée pour les plafonds (rad). */
  coverage: 0.9,
} as const;

export const SWEEP_BEAM = {
  rate: { min: 1.25, max: 1.7 },
  span: { min: 2.5, max: 3.3 },
  half: 0.04,
  warn: 1.5,
} as const;

export const ALT_BEAMS = {
  half: 0.055,
  /** Étapes (une direction active à la fois) et battements par étape. */
  steps: { min: 4, max: 6 },
  beatsPerStep: 1,
  /** Écart angulaire entre les directions annoncées (rad). */
  spread: { min: 1.9, max: 2.7 },
  warn: 1.25,
} as const;

/** Plafonds de la phase 2 (secteurs et faisceaux annoncés ou actifs en même temps, couverture angulaire). */
export const PHASE2_CAPS = {
  maxSectors: 6,
  maxCoverage: 0.5,
} as const;
