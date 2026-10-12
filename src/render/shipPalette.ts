import type { ShipColors } from '../config/skins';

/**
 * Recoloration du sprite du vaisseau (fonction pure, testable sans navigateur).
 * Le sprite blanc/argent à cockpit cyan sert de modèle : chaque apparence en dérive une texture de même forme et de même taille.
 * - cockpit : pixels saturés bleu/cyan (verrière et liserés lumineux des ailes) ;
 * - coque et ailes : pixels clairs peu saturés, partagés selon la distance à l'axe (fondu progressif) ;
 * - métal sombre (tuyères, joints) : conservé.
 * Les blancs sont renforcés et le cyan est plus vif, pour toutes les apparences.
 */
export const SHIP_PALETTE = {
  /** Saturation au-delà de laquelle un pixel est « coloré » (cockpit si bleu/cyan). */
  colorSat: 0.28,
  /** Plage de teinte (degrés) du cockpit du modèle. */
  cockpitHue: [165, 255] as const,
  /** Valeur en dessous de laquelle un pixel peu saturé est du métal sombre (conservé). */
  darkValue: 0.3,
  /** Distance à l'axe (fraction de la demi-largeur) où commencent et finissent les ailes : fondu coque → ailes. */
  wingFrom: 0.22,
  wingTo: 0.34,
  /** Renforcement des blancs : gain et décalage sur la luminosité. */
  hullGain: 1.2,
  hullLift: 0.05,
  /** Cockpit : luminosité minimale et gain (cyan plus vif). */
  cockpitBase: 0.62,
  cockpitGain: 0.55,
} as const;

const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Recolore `data` (RGBA, `size` × `size`) en place. Les pixels transparents ne changent pas. */
export function recolorShip(data: Uint8ClampedArray, size: number, colors: ShipColors): void {
  const P = SHIP_PALETTE;
  const hull = rgb(colors.hull);
  const wings = rgb(colors.wings);
  const cockpit = rgb(colors.cockpit);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (data[i + 3] === 0) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      let hue = 0;
      if (max > min) {
        const d = max - min;
        if (max === r) hue = ((g - b) / d) % 6;
        else if (max === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
        hue = (hue * 60 + 360) % 360;
      }
      let out: [number, number, number];
      if (sat > P.colorSat && hue >= P.cockpitHue[0] && hue <= P.cockpitHue[1]) {
        const k = Math.min(1, P.cockpitBase + P.cockpitGain * max);
        out = [cockpit[0] * k, cockpit[1] * k, cockpit[2] * k];
        // Reflets de la verrière : le clair reste clair
        const hi = clamp01((max - 0.85) / 0.15);
        out = [out[0] + (255 - out[0]) * hi * 0.6, out[1] + (255 - out[1]) * hi * 0.6, out[2] + (255 - out[2]) * hi * 0.6];
      } else if (sat <= P.colorSat && max < P.darkValue) {
        out = [data[i], data[i + 1], data[i + 2]];
      } else {
        const wingK = smooth(P.wingFrom, P.wingTo, Math.abs(x + 0.5 - half) / half);
        const shade = clamp01(max * P.hullGain + P.hullLift);
        const tint: [number, number, number] = [
          hull[0] + (wings[0] - hull[0]) * wingK,
          hull[1] + (wings[1] - hull[1]) * wingK,
          hull[2] + (wings[2] - hull[2]) * wingK,
        ];
        out = [tint[0] * shade, tint[1] * shade, tint[2] * shade];
      }
      data[i] = Math.round(out[0]);
      data[i + 1] = Math.round(out[1]);
      data[i + 2] = Math.round(out[2]);
    }
  }
}
