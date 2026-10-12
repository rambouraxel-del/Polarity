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
