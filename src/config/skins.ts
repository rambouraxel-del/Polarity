/**
 * Apparences du vaisseau — configuration UNIQUE, purement cosmétique (source : planche 01 « Essentials », src/assets/skins/).
 *
 * Pour modifier le catalogue (prix, méthode d'obtention, disponibilité, ordre) : ne changer QUE `SKIN_CONFIG` ci-dessous ;
 * config/catalog.ts en déduit les articles de la boutique. L'économie définitive viendra plus tard : les valeurs actuelles sont PROVISOIRES
 * (`SKIN_ECONOMY_PROVISIONAL`) et se changent sans toucher au reste du code.
 * Règles (vérifiées par tests/skins.test.ts) :
 * - l'identifiant ne change jamais (il est enregistré dans la sauvegarde) ; un identifiant inconnu retombe sur `DEFAULT_SKIN_ID` ;
 * - aucun paramètre de jeu : la hitbox est celle de config/hitbox.ts, commune à tous, jamais déduite des dimensions ou de la transparence des PNG ;
 * - le gabarit visuel est celui de config/visuals.ts, identique pour tous ;
 * - l'Orbit ne dépend jamais de l'apparence (config/orbit.ts : dépend de la phase de la partie) ;
 * - la couleur du réacteur reste distincte des dangers (corail, orange des astéroïdes, magenta des secteurs) : voir `HAZARD_HUES`.
 * Chaque PNG : 256 × 256, vaisseau centré, nez vers le haut, silhouette ≈ 240 px (même gabarit que l'ancien sprite 128 px : voir VISUAL).
 */

/** Méthode d'obtention : `default` (gratuit, équipé d'emblée), `medals` (Médailles seulement), `shards_or_prisms` (au choix : Éclats OU Prismes), `unavailable`. */
export type SkinAcquisition = 'default' | 'medals' | 'shards_or_prisms' | 'unavailable';

export interface SkinConfig {
  /** Identifiant stable (clé de sauvegarde). */
  id: string;
  name: string;
  /** Chemin de l'image (depuis la racine du projet). */
  image: string;
  /** Niveau de prestige (0 = commun, 1, 2) : information d'affichage, sans effet de jeu. */
  prestige: 0 | 1 | 2;
  acquisition: SkinAcquisition;
  /** Prix en Médailles (acquisition `medals`). */
  priceMedals: number;
  /** Prix en Éclats (acquisition `shards_or_prisms`). */
  priceShards: number;
  /** Prix en Prismes (acquisition `shards_or_prisms`) : monnaie interne premium, jamais d'argent réel ici. */
  pricePrisms: number;
  /** Faux : jamais proposé à l'achat (un skin déjà possédé reste équipable). */
  available: boolean;
  /** Ordre d'affichage (croissant). */
  order: number;
  /** Courte description affichée dans le garage. */
  blurb: string;
}

/** Vrai tant que les prix et méthodes d'obtention ci-dessous sont provisoires (économie définitive à venir). */
export const SKIN_ECONOMY_PROVISIONAL = true;

export const DEFAULT_SKIN_ID = 'tole-brute';

const dir = 'src/assets/skins/';

/** Les dix apparences de la planche 01. Prix et méthodes : PROVISOIRES. */
export const SKIN_CONFIG: SkinConfig[] = [
  { id: 'tole-brute', name: 'Tôle brute', image: `${dir}001-tole-brute.png`, prestige: 0, acquisition: 'default', priceMedals: 0, priceShards: 0, pricePrisms: 0, available: true, order: 1, blurb: 'Tôle brute et rouillée : le vaisseau d’origine.' },
  { id: 'chantier-orbital', name: 'Chantier orbital', image: `${dir}002-chantier-orbital.png`, prestige: 1, acquisition: 'medals', priceMedals: 100, priceShards: 0, pricePrisms: 0, available: true, order: 2, blurb: 'Jaune de chantier et chevrons noirs.' },
  { id: 'carbone-utilitaire', name: 'Carbone utilitaire', image: `${dir}003-carbone-utilitaire.png`, prestige: 1, acquisition: 'medals', priceMedals: 150, priceShards: 0, pricePrisms: 0, available: true, order: 3, blurb: 'Carbone sombre, liserés orange.' },
  { id: 'dipole', name: 'Dipôle', image: `${dir}004-dipole.png`, prestige: 1, acquisition: 'medals', priceMedals: 200, priceShards: 0, pricePrisms: 0, available: true, order: 4, blurb: 'Blanc, bleu d’un côté, rouge de l’autre.' },
  { id: 'circuit', name: 'Circuit', image: `${dir}005-circuit.png`, prestige: 1, acquisition: 'medals', priceMedals: 250, priceShards: 0, pricePrisms: 0, available: true, order: 5, blurb: 'Pistes cyan gravées sur la coque noire.' },
  { id: 'cartographe', name: 'Cartographe', image: `${dir}006-cartographe.png`, prestige: 1, acquisition: 'medals', priceMedals: 300, priceShards: 0, pricePrisms: 0, available: true, order: 6, blurb: 'Coque crème, courbes de relief.' },
  { id: 'long-courrier', name: 'Long-courrier', image: `${dir}007-long-courrier.png`, prestige: 1, acquisition: 'shards_or_prisms', priceMedals: 0, priceShards: 1500, pricePrisms: 60, available: true, order: 7, blurb: 'Coque claire, bandes rouges de convoyeur.' },
  { id: 'basalte', name: 'Basalte', image: `${dir}008-basalte.png`, prestige: 1, acquisition: 'shards_or_prisms', priceMedals: 0, priceShards: 2000, pricePrisms: 80, available: true, order: 8, blurb: 'Plaques de basalte sombre.' },
  { id: 'arcade-84', name: 'Arcade 84', image: `${dir}009-arcade-84.png`, prestige: 1, acquisition: 'shards_or_prisms', priceMedals: 0, priceShards: 3000, pricePrisms: 120, available: true, order: 9, blurb: 'Violet, turquoise et orange rétro.' },
  { id: 'porcelaine', name: 'Porcelaine', image: `${dir}010-porcelaine.png`, prestige: 2, acquisition: 'unavailable', priceMedals: 0, priceShards: 0, pricePrisms: 0, available: false, order: 10, blurb: 'Porcelaine blanche et motifs bleus.' },
];

/** Couleurs des effets dessinés par code (lueur, réacteur, balises, traînée) : communes à toutes les apparences (les PNG portent leurs propres couleurs). */
export interface ThrusterColors {
  /** Cœur de la flamme (clair). */
  core: number;
  /** Halo et étincelles. */
  glow: number;
}

export interface SkinColors {
  /** Teinte de la lueur discrète autour du vaisseau. */
  cockpit: number;
  thruster: ThrusterColors;
  beacon: number;
  trail: number;
}

export const SHIP_FX_COLORS: SkinColors = {
  cockpit: 0x7fc8ff,
  thruster: { core: 0xe8f4ff, glow: 0x4fa8ff },
  beacon: 0xffd84a,
  trail: 0x9ff9ff,
};

/** Couleurs de la coque, des ailes et du cockpit du sprite recoloré (campagne seulement : « La Traverse »). */
export interface ShipColors {
  hull: number;
  wings: number;
  cockpit: number;
}

/** Apparence utilisée par le rendu : image du joueur (PNG) ou, pour la campagne, sprite de base recoloré. */
export interface SkinDef {
  /** Identifiant stable (clé de sauvegarde). */
  id: string;
  name: string;
  /** Chemin de l'image ; null = sprite de base recoloré (campagne). */
  image: string | null;
  /** Recoloration du sprite de base (campagne) ; absente pour les PNG. */
  recolor?: ShipColors;
  prestige: number;
  colors: SkinColors;
}

export const SKINS: SkinDef[] = [...SKIN_CONFIG]
  .sort((a, b) => a.order - b.order)
  .map((c) => ({ id: c.id, name: c.name, image: c.image, prestige: c.prestige, colors: SHIP_FX_COLORS }));

/**
 * Vaisseau de la campagne : la Traverse, vieux vaisseau de travail d'Élias (coque sable usée, ailes bleu-vert, verrière ambre).
 * Volontairement HORS de `SKINS` : ni catalogue, ni boutique, ni équipement ; les cosmétiques de la Survie ne s'y appliquent pas.
 * Réacteur bleu-vert (à plus de 30° des teintes de danger). Sprite de base recoloré (src/assets/sprites/ship.png).
 */
export const CAMPAIGN_SKIN: SkinDef = {
  id: 'traverse', name: 'La Traverse', image: null, prestige: 0,
  recolor: { hull: 0xd6c7a1, wings: 0x3f8f9d, cockpit: 0xffb347 },
  colors: { cockpit: 0xffb347, thruster: { core: 0xe8fffb, glow: 0x4fd6c8 }, beacon: 0xffd84a, trail: 0xa6f0e6 },
};

/** Teintes (degrés) des dangers : projectile corail, astéroïde orange, secteur magenta. Aucun réacteur ne s'en approche. */
export const HAZARD_HUES = [0, 22, 303] as const;
/** Écart de teinte minimal entre un réacteur coloré et un danger. */
export const MIN_HAZARD_HUE_GAP = 30;
/** Saturation en dessous de laquelle une couleur est un blanc/gris : jamais confondue avec un danger. */
export const NEUTRAL_SATURATION = 0.2;

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
