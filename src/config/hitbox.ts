/**
 * Hitboxes — réglage indépendant de la difficulté et des visuels.
 *
 * Les rayons d'origine (v1.0) sont agrandis de `growth` (par défaut +6,5 %, plage prévue 5–8 %).
 * Les hitboxes restent volontairement en retrait des silhouettes (voir config/visuals.ts).
 * Les visuels s'agrandissent de 15 % indépendamment : modifier l'un ne modifie pas l'autre.
 */
export const HITBOX = {
  /** Rayon d'origine du vaisseau (v1.0). */
  playerBase: 7,
  /** Rayon d'origine d'un projectile (v1.0). */
  projectileBase: 8,
  /** Agrandissement par défaut : +6,5 %. */
  defaultGrowth: 0.065,
  /** Plage recommandée. */
  minGrowth: 0.05,
  maxGrowth: 0.08,
} as const;

let growth: number = HITBOX.defaultGrowth;

export function getHitboxGrowth(): number {
  return growth;
}

/**
 * Modifie l'agrandissement (tests, outils d'équilibrage). Accepte 0 (hitboxes d'origine) jusqu'à 0,25.
 * Renvoie l'ancienne valeur pour pouvoir la restaurer.
 */
export function setHitboxGrowth(g: number): number {
  const prev = growth;
  if (!Number.isFinite(g) || g < 0 || g > 0.25) throw new RangeError(`Agrandissement de hitbox invalide : ${g}`);
  growth = g;
  return prev;
}

export function playerHitRadius(): number {
  return HITBOX.playerBase * (1 + growth);
}

export function projectileHitRadius(): number {
  return HITBOX.projectileBase * (1 + growth);
}
