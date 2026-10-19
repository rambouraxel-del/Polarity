/**
 * Visuels — réglage indépendant des hitboxes et de la difficulté.
 * Unités : unités monde (orbite de rayon 300). Les sprites sont dans src/assets/sprites.
 */
export const VISUAL = {
  /** Agrandissement des visuels (vaisseau et astéroïdes) par rapport à la v1.0 : +15 %. */
  scale: 1.15,
  /** Lisibilité : vaisseau +45 % (v1.1.x), +20 % (v1.4) puis +25 % (refonte cosmétique), astéroïdes +35 % par rapport à la taille v1.1 (+15 %). Sans effet sur les hitboxes. */
  shipScale: 1.45 * 1.2 * 1.25,
  asteroidScale: 1.35,
  /** Demi-longueur du vaisseau en v1.0. */
  shipBaseRadius: 11,
  /** Rayon d'un astéroïde en v1.0. */
  asteroidBaseRadius: 10,
  /** Rapports des sprites (canevas 128 px / 120 px de contenu pour les astéroïdes et la Traverse ; PNG des apparences : 256 px / 240 px, même rapport). */
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
  /** Les couleurs du réacteur viennent de l'apparence (config/skins.ts). */
  /** `start` : naissance de la flamme, en fraction de la demi-longueur (au bout des tuyères du PNG) ; `spread` : écart latéral des deux tuyères, en fraction de la demi-largeur. */
  thruster: { length: 17, width: 8, flicker: 0.12, start: 0.86, spread: 0.43 },
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
  asteroidGlow: { tint: 0xff7a2e, alpha: 0.6, grow: 1.16 },
  /**
   * Effet de vitesse du vaisseau (remplace l'ancienne lueur permanente) : deux fines traînées courtes, effilées, derrière le vaisseau ; une troisième,
   * plus courte, aux vitesses élevées. Aucun effet devant le vaisseau ni sur la coque. Purement décoratif : lit la vitesse de la simulation, ne la modifie jamais.
   * `factorMin`/`factorMax` : facteurs de vitesse (1 = référence) où l'intensité passe de 0 à 1 ; longueurs en unités monde ; `lateral` en fraction de la demi-largeur.
   */
  speedLines: {
    color: 0xdde2e8,
    factorMin: 0.3,
    factorMax: 1.0,
    /** Départ des traînées derrière le vaisseau (fraction de la demi-longueur) : au-delà de la queue, jamais sur la coque. */
    startBehind: 1.02,
    length: { min: 12, max: 34 },
    width: 2.4,
    alpha: { min: 0.1, max: 0.3 },
    /** Variation de longueur et d'opacité (fraction) et vitesse de la variation (rad/s). */
    wobble: { length: 0.18, alpha: 0.25, rate: 9 },
    lateral: 0.78,
    /** Troisième traînée (centrale, plus courte) : seuil d'intensité et rapport de longueur. */
    third: { from: 0.6, length: 0.6, alpha: 0.7 },
    /** Facteur d'opacité quand la traînée lumineuse d'apparence est tracée : évite la superposition excessive. */
    withTrail: 0.65,
  },
  /** Liseré sombre sous le vaisseau (fond de l'arène, alpha normal) : le détache de l'orbite lumineuse et des menaces. */
  shipRim: { alpha: 0.7, grow: 1.12 },
  asteroidEmbers: { rate: 14, life: 0.4, speed: 22 },
  /** Éclat sur l'orbite : taille et effets (purement visuels ; la zone de collecte est dans config/economy.ts). */
  shard: { radius: 28, spriteGrow: 1.3, diskGrow: 1.35, ringGrow: 1.5, haloGrow: 2.1, spawnIn: 0.25, pulseHz: 1.2, warnHz: 3, urgentHz: 6 },
  /** Objets de mission (campagne) : taille, halo et clignotement final (purement visuels ; la zone de collecte est dans config/campaign.ts). */
  missionObject: { radius: 24, haloGrow: 2, ringGrow: 1.45, spin: 0.9, pulseHz: 1.4, urgentHz: 5, warnAt: 2 },
  /** Bouclier de secours : anneau autour du vaisseau, clignotement du vaisseau pendant l'invulnérabilité. */
  shield: { ringGrow: 1.5, alpha: 0.5, blinkHz: 9, blinkAlpha: 0.45 },
  /** Impact : durée de l'onde de choc (s) et rayon final. */
  impact: { ringLife: 0.32, ringRadius: 46, flareLife: 0.16 },
  /** Nombre maximal de particules simultanées (plafond mobile). */
  maxParticles: 140,
} as const;
