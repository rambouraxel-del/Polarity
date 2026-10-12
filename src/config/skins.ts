/**
 * Apparences du vaisseau — configuration extensible, purement cosmétique.
 *
 * Pour ajouter une apparence : ajouter une entrée à `SKINS` (identifiant stable, nom, modèle, couleurs) puis son obtention dans config/catalog.ts.
 * Règles (vérifiées par tests/skins.test.ts) :
 * - les conditions d'obtention (gratuit, succès, achat) sont dans config/catalog.ts ;
 * - l'identifiant ne change jamais (il est enregistré dans la sauvegarde) ;
 * - aucun paramètre de jeu : la hitbox est celle de config/hitbox.ts pour tous les modèles, et tous partagent le même gabarit visuel (config/visuals.ts) ;
 * - la couleur du réacteur reste distincte des dangers (corail, orange des astéroïdes, magenta des secteurs) : voir `HAZARD_HUES`.
 * Si l'identifiant n'existe plus ou si le modèle est indisponible, le jeu revient au modèle « classique ».
 */

/** Modèles de vaisseau disponibles (clé de texture Phaser). Tous : 128 × 128 px, nez vers le haut, même gabarit. */
export const SHIP_MODELS = {
  /** Vaisseau blanc/argent à cockpit cyan (src/assets/sprites/ship.png). */
  classic: { texture: 'ship' },
} as const;

export type ShipModelId = keyof typeof SHIP_MODELS;

/** Couleurs de la coque (fuselage), des ailes (extrémités) et du cockpit (verrière et liserés lumineux). */
export interface ShipColors {
  hull: number;
  wings: number;
  cockpit: number;
}

export interface ThrusterColors {
  /** Cœur de la flamme (clair). */
  core: number;
  /** Halo et étincelles. */
  glow: number;
}

export interface SkinDef {
  /** Identifiant stable (clé de sauvegarde). */
  id: string;
  name: string;
  /** Modèle de vaisseau (clé de SHIP_MODELS). */
  asset: ShipModelId;
  colors: ShipColors & {
    thruster: ThrusterColors;
    orbit: number;
    beacon: number;
    trail: number;
  };
}

/** Teintes (degrés) des dangers : projectile corail, astéroïde orange, secteur magenta. Aucun réacteur ne s'en approche. */
export const HAZARD_HUES = [0, 22, 303] as const;
/** Écart de teinte minimal entre un réacteur coloré et un danger. */
export const MIN_HAZARD_HUE_GAP = 30;
/** Saturation en dessous de laquelle une couleur est un blanc/gris : jamais confondue avec un danger. */
export const NEUTRAL_SATURATION = 0.2;

export const CLASSIC_SKIN_ID = 'classique';

export const SKINS: SkinDef[] = [
  {
    id: 'classique', name: 'Classique', asset: 'classic',
    colors: { hull: 0xffffff, wings: 0xffffff, cockpit: 0x00e5ff, thruster: { core: 0xeafcff, glow: 0x00e5ff }, orbit: 0x00e5ff, beacon: 0xffd84a, trail: 0x9ff9ff },
  },
  {
    id: 'aurore', name: 'Aurore', asset: 'classic',
    colors: { hull: 0xeafff0, wings: 0x5dffa8, cockpit: 0x7dffc0, thruster: { core: 0xeafff4, glow: 0x5dffa8 }, orbit: 0x5dffa8, beacon: 0xffe066, trail: 0xb8ffd6 },
  },
  {
    id: 'menthe', name: 'Menthe', asset: 'classic',
    colors: { hull: 0xffffff, wings: 0x3dffd8, cockpit: 0xfff2a8, thruster: { core: 0xeafffa, glow: 0x3dffd8 }, orbit: 0x3dffd8, beacon: 0xfff2a8, trail: 0xa8fff0 },
  },
  {
    id: 'ambre', name: 'Ambre', asset: 'classic',
    colors: { hull: 0xfff6e0, wings: 0xffb84d, cockpit: 0xffe08a, thruster: { core: 0xfffbe0, glow: 0xf2f04a }, orbit: 0xffb84d, beacon: 0xf4fbff, trail: 0xffd9a0 },
  },
  {
    id: 'glace', name: 'Glace', asset: 'classic',
    colors: { hull: 0xf4faff, wings: 0x8fb8ff, cockpit: 0xb8d4ff, thruster: { core: 0xf0f6ff, glow: 0x8fb8ff }, orbit: 0x8fb8ff, beacon: 0xffe680, trail: 0xc9dcff },
  },
  {
    id: 'solaire', name: 'Solaire', asset: 'classic',
    colors: { hull: 0xfffbe8, wings: 0xffe14d, cockpit: 0xfff7b0, thruster: { core: 0xffffe8, glow: 0xf2f04a }, orbit: 0xffe14d, beacon: 0xffffff, trail: 0xfff0a0 },
  },
  {
    id: 'prisme', name: 'Prisme', asset: 'classic',
    colors: { hull: 0x9ff9ff, wings: 0xb79bff, cockpit: 0xf2f6ff, thruster: { core: 0xf2f6ff, glow: 0x7dd0ff }, orbit: 0xf2f6ff, beacon: 0xffd84a, trail: 0xffffff },
  },
  {
    id: 'spectre', name: 'Spectre', asset: 'classic',
    colors: { hull: 0xe9e1ff, wings: 0x7a4dff, cockpit: 0xc9a8ff, thruster: { core: 0xf3edff, glow: 0x9b6bff }, orbit: 0x9b6bff, beacon: 0xffd84a, trail: 0xc7a8ff },
  },
  {
    id: 'neon', name: 'Néon', asset: 'classic',
    colors: { hull: 0xffffff, wings: 0xff4fd8, cockpit: 0x00e5ff, thruster: { core: 0xeafcff, glow: 0x00e5ff }, orbit: 0x00e5ff, beacon: 0xfff2a8, trail: 0x7df3ff },
  },
];

/**
 * Vaisseau de la campagne : la Traverse, vieux vaisseau de travail d'Élias (coque sable usée, ailes bleu-vert, verrière ambre).
 * Volontairement HORS de `SKINS` : ni catalogue, ni boutique, ni équipement ; les cosmétiques de la Survie ne s'y appliquent pas.
 * Réacteur bleu-vert (à plus de 30° des teintes de danger).
 */
export const CAMPAIGN_SKIN: SkinDef = {
  id: 'traverse', name: 'La Traverse', asset: 'classic',
  colors: { hull: 0xd6c7a1, wings: 0x3f8f9d, cockpit: 0xffb347, thruster: { core: 0xe8fffb, glow: 0x4fd6c8 }, orbit: 0x4fd6c8, beacon: 0xffd84a, trail: 0xa6f0e6 },
};

/** Teinte (0–360) et saturation (0–1) d'une couleur 0xRRGGBB. */
export function hueSat(color: number): { hue: number; sat: number } {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const sat = max === 0 ? 0 : d / max;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, sat };
}

/** Écart minimal (degrés) entre la teinte d'une couleur et celle d'un danger ; Infinity pour un blanc/gris. */
export function hazardHueGap(color: number): number {
  const { hue, sat } = hueSat(color);
  if (sat < NEUTRAL_SATURATION) return Infinity;
  let gap = Infinity;
  for (const h of HAZARD_HUES) {
    const d = Math.abs(hue - h);
    gap = Math.min(gap, Math.min(d, 360 - d));
  }
  return gap;
}
