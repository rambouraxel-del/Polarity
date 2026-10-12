/**
 * Visuels — réglage indépendant des hitboxes et de la difficulté.
 * Unités : unités monde (orbite de rayon 300). Les sprites sont dans src/assets/sprites.
 */
export const VISUAL = {
  /** Agrandissement des visuels (vaisseau et astéroïdes) par rapport à la v1.0 : +15 %. */
  scale: 1.15,
  /** Lisibilité (v1.1.x) : vaisseau +45 % et astéroïdes +35 % par rapport à la taille v1.1 (+15 %). Sans effet sur les hitboxes. */
  shipScale: 1.45,
  asteroidScale: 1.35,
  /** Demi-longueur du vaisseau en v1.0. */
  shipBaseRadius: 11,
  /** Rayon d'un astéroïde en v1.0. */
  asteroidBaseRadius: 10,
  /** Les textures font 128 px de côté ; leur plus grande dimension en occupe 120 (voir scripts/process-sprites.py). */
  spriteCanvas: 128,
  spriteContent: 120,
  /** Rapport largeur / longueur du vaisseau (99 / 120). */
  shipWidthRatio: 99 / 120,
  /** Plus petite dimension relative d'une silhouette d'astéroïde (94 / 120 pour la plus aplatie). */
  asteroidMinExtent: 94 / 120,
} as const;

/** Demi-longueur visuelle du vaisseau. */
export const shipRadius = (): number => VISUAL.shipBaseRadius * VISUAL.scale * VISUAL.shipScale;
/** Rayon visuel d'un astéroïde (moitié de sa plus grande dimension). */
export const asteroidRadius = (): number => VISUAL.asteroidBaseRadius * VISUAL.scale * VISUAL.asteroidScale;
/** Demi-largeur visuelle du vaisseau. */
export const shipHalfWidth = (): number => shipRadius() * VISUAL.shipWidthRatio;
/** Demi-dimension la plus courte d'une silhouette d'astéroïde. */
export const asteroidMinHalfExtent = (): number => asteroidRadius() * VISUAL.asteroidMinExtent;

/** Effets décoratifs : purement visuels, sans lien avec les collisions. */
export const FX = {
  /** Flamme du vaisseau, derrière lui (opposée au déplacement). */
  thruster: { length: 14, width: 6.5, flicker: 0.12, coreColor: 0xeafcff, glowColor: 0x00e5ff },
  /** Particules du réacteur : débit (par seconde) et durée de vie. */
  thrusterSparks: { rate: 26, life: 0.32, speed: 38 },
  /** Traînée d'astéroïde : longueur (unités monde). */
  asteroidTrail: {
    length: 52,
    coreColor: 0xffb347,
    glowColor: 0xff5b2e,
    /** Demi-largeur des trois couches, en fraction du rayon de l'astéroïde (v1.1 : 0,95 / 0,6 / 0,28). */
    layers: [1.0, 0.68, 0.36],
  },
  /** Contour lumineux orange de l'astéroïde : silhouette remplie d'orange (additif), un peu plus grande, derrière le sprite. */
  asteroidGlow: { tint: 0xff7a2e, alpha: 0.45, grow: 1.16 },
  asteroidEmbers: { rate: 14, life: 0.4, speed: 22 },
  /** Impact : durée de l'onde de choc (s) et rayon final. */
  impact: { ringLife: 0.32, ringRadius: 46, flareLife: 0.16 },
  /** Nombre maximal de particules simultanées (plafond mobile). */
  maxParticles: 140,
} as const;
