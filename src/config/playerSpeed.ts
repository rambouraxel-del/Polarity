/**
 * Vitesse du vaisseau — réglage indépendant de la difficulté, des hitboxes et des visuels.
 *
 * La référence (facteur 1,0) est la vitesse d'avant cette mise à jour : `PLAYER.angularSpeed` = 2,0 rad/s.
 * En Survie et au défi quotidien, la vitesse suit un facteur qui dépend du temps de jeu actif :
 * départ à 40 %, +5 points de pourcentage de la référence toutes les 30 s, plafonné à 100 % (atteint à 6 min).
 * Chaque hausse est lissée sur 2 s et **se termine** à l'instant du palier : 45 % à 30 s, 50 % à 1 min… 100 % à 6 min.
 * Les niveaux ont chacun leur vitesse (champ `speed` de config/levels.ts) et n'utilisent pas cette courbe.
 */
export const PLAYER_SPEED = {
  /** Facteur de départ (40 % de la référence). */
  start: 0.4,
  /** Hausse à chaque palier (5 points de pourcentage de la référence). */
  step: 0.05,
  /** Période des paliers (secondes de jeu actif). */
  every: 30,
  /** Durée du lissage de chaque hausse (s). Elle se termine à l'instant du palier. */
  smooth: 2,
  /** Plafond pour cette version. */
  max: 1.0,
} as const;

/** Vitesse des niveaux par défaut (référence = vitesse d'avant la mise à jour). */
export const LEVEL_SPEED_DEFAULT = 1;

/**
 * Adaptation de l'équilibrage à la vitesse réelle du joueur. Un vaisseau lent met plus de temps à parcourir
 * le même angle : les durées sont allongées par (1 / facteur)^exposant. À pleine vitesse (facteur 1), rien ne change.
 * Les planchers de CAPS ne sont jamais abaissés.
 */
export const PACE = {
  /** Annonces (projectiles, secteurs, lasers). */
  warn: 0.8,
  /** Décalage entre les menaces d'une attaque combinée ou d'un convoi. */
  stagger: 0.8,
  /** Intervalle entre deux vagues. */
  interval: 0.4,
  /** Vitesse de balayage des lasers : divisée par (1 / facteur)^exposant. */
  beam: 0.8,
  /** Largeur des secteurs électriques : réduite par (1 / facteur)^−exposant quand le vaisseau est lent. */
  width: 0.4,
} as const;

function smoothstep(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

const STEPS = Math.round((PLAYER_SPEED.max - PLAYER_SPEED.start) / PLAYER_SPEED.step);

/** Facteur de vitesse (1 = référence) en Survie et au défi quotidien, à l'instant de jeu actif `t`. */
export function survivalSpeedFactor(t: number): number {
  const { start, step, every, smooth, max } = PLAYER_SPEED;
  if (t <= 0) return start;
  const done = Math.floor(t / every); // paliers dont la hausse est terminée
  // Hausse du palier suivant : fenêtre [(done+1)·every − smooth, (done+1)·every]
  const ramp = smoothstep((t - ((done + 1) * every - smooth)) / smooth);
  return Math.min(max, start + step * Math.min(STEPS, done + ramp));
}

/** Facteur d'allongement des durées pour un vaisseau au facteur de vitesse `m` (≥ 1 quand le vaisseau est lent). */
export function paceFactor(m: number, exponent: number): number {
  return Math.pow(1 / Math.max(0.05, Math.min(1, m)), exponent);
}
