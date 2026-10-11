/**
 * Géométrie du rendu du vaisseau : fonctions pures, testées.
 * Repère écran : x vers la droite, y vers le bas ; l'angle d'orbite croît dans le sens horaire à l'écran.
 */

/** Direction du déplacement (vecteur unitaire tangent à l'orbite) pour un vaisseau à l'angle `angle` allant dans le sens `dir`. */
export function heading(angle: number, dir: 1 | -1): { x: number; y: number } {
  return { x: -Math.sin(angle) * dir, y: Math.cos(angle) * dir };
}

/** Direction du réacteur et des traînées : exactement l'opposée du déplacement. */
export function exhaustDirection(angle: number, dir: 1 | -1): { x: number; y: number } {
  const h = heading(angle, dir);
  return { x: -h.x, y: -h.y };
}

/**
 * Rotation Phaser (radians, sens horaire) d'un sprite dont le nez pointe vers le haut de l'image
 * pour qu'il regarde dans la direction (hx, hy).
 */
export function spriteRotation(hx: number, hy: number): number {
  return Math.atan2(hx, -hy);
}
