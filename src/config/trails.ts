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

/**
 * Catégorie Traînées fermée pour l'instant (« Indisponible pour l'instant ») : ni achat, ni équipement, ni aperçu interactif, et la traînée
 * affichée en jeu est toujours la traînée par défaut. Les données (définitions, prix, traînées déjà possédées, identifiant enregistré dans la
 * sauvegarde) sont CONSERVÉES : passer cette valeur à `true` rouvre la catégorie telle qu'elle était.
 */
export const TRAILS_ENABLED = false;

export const TRAILS: TrailDef[] = [
  { id: 'auto', name: 'Assortie', color: null },
  { id: 'emeraude', name: 'Émeraude', color: 0x5dffa8 },
  { id: 'glacier', name: 'Glacier', color: 0x8fd8ff },
  { id: 'ultraviolet', name: 'Ultraviolet', color: 0xa98bff },
  { id: 'nebuleuse', name: 'Nébuleuse', color: 0x7aa8ff },
  { id: 'citron', name: 'Citron', color: 0xe4ff5d },
  { id: 'boreale', name: 'Boréale', color: 0x3dffd8 },
];

/** Traînée réellement affichée : la traînée par défaut tant que la catégorie est fermée. */
export function activeTrailId(id: string): string {
  return TRAILS_ENABLED ? trailById(id).id : DEFAULT_TRAIL_ID;
}

export function trailById(id: string): TrailDef {
  return TRAILS.find((t) => t.id === id) ?? TRAILS[0];
}
