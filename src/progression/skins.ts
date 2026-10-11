/**
 * Apparences : purement cosmétiques, aucune statistique.
 * Les couleurs des menaces (corail, magenta) ne changent jamais, et aucune apparence ne les utilise.
 */
export interface Skin {
  id: string;
  name: string;
  /** Succès qui débloque l'apparence (null = disponible d'emblée). */
  unlock: string | null;
  ship: number;
  orbit: number;
  beacon: number;
  trail: number;
}

export const SKINS: Skin[] = [
  { id: 'classique', name: 'Classique', unlock: null, ship: 0xffffff, orbit: 0x39f3ff, beacon: 0xffd84a, trail: 0x9ff9ff },
  { id: 'aurore', name: 'Aurore', unlock: 'first_cycle', ship: 0xeafff0, orbit: 0x5dffa8, beacon: 0xffe066, trail: 0xb8ffd6 },
  { id: 'menthe', name: 'Menthe', unlock: 'first_level', ship: 0xffffff, orbit: 0x3dffd8, beacon: 0xfff2a8, trail: 0xa8fff0 },
  { id: 'ambre', name: 'Ambre', unlock: 'survive_60', ship: 0xfff6e0, orbit: 0xffb84d, beacon: 0xf4fbff, trail: 0xffd9a0 },
  { id: 'glace', name: 'Glace', unlock: 'max_combo', ship: 0xffffff, orbit: 0x8fb8ff, beacon: 0xffe680, trail: 0xc9dcff },
  { id: 'solaire', name: 'Solaire', unlock: 'survive_300', ship: 0xfffbe8, orbit: 0xffe14d, beacon: 0xffffff, trail: 0xfff0a0 },
  { id: 'prisme', name: 'Prisme', unlock: 'all_levels', ship: 0x9ff9ff, orbit: 0xf2f6ff, beacon: 0xffd84a, trail: 0xffffff },
];

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function isSkinUnlocked(skin: Skin, achievements: Record<string, number>): boolean {
  return skin.unlock === null || achievements[skin.unlock] !== undefined;
}
