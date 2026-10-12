/**
 * Traînées : couleur de la traînée lumineuse derrière le vaisseau (cosmétique, sans effet de jeu).
 * `auto` suit la couleur de l'apparence équipée. Une traînée colorée reste à plus de 30° de teinte des dangers
 * (corail, orange, magenta) — vérifié par tests/economy.test.ts. Les identifiants sont enregistrés dans la sauvegarde.
 */
export interface TrailDef {
  id: string;
  name: string;
  /** Couleur de la traînée ; null = couleur de l'apparence. */
  color: number | null;
}

export const DEFAULT_TRAIL_ID = 'auto';

export const TRAILS: TrailDef[] = [
  { id: 'auto', name: 'Assortie', color: null },
  { id: 'emeraude', name: 'Émeraude', color: 0x5dffa8 },
  { id: 'glacier', name: 'Glacier', color: 0x8fd8ff },
  { id: 'ultraviolet', name: 'Ultraviolet', color: 0xa98bff },
  { id: 'nebuleuse', name: 'Nébuleuse', color: 0x7aa8ff },
  { id: 'citron', name: 'Citron', color: 0xe4ff5d },
  { id: 'boreale', name: 'Boréale', color: 0x3dffd8 },
];

export function trailById(id: string): TrailDef {
  return TRAILS.find((t) => t.id === id) ?? TRAILS[0];
}
