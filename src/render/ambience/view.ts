/** Repère d'affichage partagé par les calques de l'ambiance (pixels du canvas). */
export interface AmbienceView {
  /** Centre de l'arène (= centre de la faille). */
  cx: number;
  cy: number;
  /** Pixels par unité monde (orbite de rayon 300). */
  scale: number;
  dpr: number;
  width: number;
  height: number;
  /** Demi-diagonale de l'écran (px). */
  halfDiag: number;
}

export const lerpColor = (a: number, b: number, t: number): number => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
