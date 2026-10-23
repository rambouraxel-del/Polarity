/**
 * Orbite (le rail circulaire du vaisseau) — apparence PAR PHASE de la partie, source unique.
 *
 * L'Orbit ne dépend d'aucune apparence du vaisseau ni du garage : seulement de la phase en cours (Survie : phase 1 puis 2 ; les autres modes
 * restent en phase 1). Purement décoratif : aucune lecture par la simulation ; l'orbite reste un cercle parfait (rayon `ARENA.orbitRadius`).
 * Plus fin, plus discret et moins lumineux que l'ancien rail pour ne jamais gêner la lecture du vaisseau, des obstacles et des polarités.
 * Pour une nouvelle phase : ajouter une entrée à `ORBIT.phases` ; une phase inconnue prend la plus proche inférieure.
 */
export interface OrbitLook {
  /** Couleur du trait et du halo (à plus de 30° de teinte des dangers : corail, orange, magenta). */
  color: number;
  /** Opacité du trait (0–1). */
  lineAlpha: number;
  /** Épaisseur du trait en unités monde (minimum d'un pixel d'écran appliqué au rendu). */
  lineWidth: number;
  /** Opacité du halo doux autour du rail (0–1) : « intensité lumineuse ». */
  glowAlpha: number;
  /** Respiration : amplitude relative de l'opacité (0 = aucune) et fréquence (Hz). Supprimée en effets réduits. */
  breathe: number;
  breatheHz: number;
  /** Arcs électriques le long du rail (0 = aucun, 1 = tout l'effet de la phase 2). Supprimés en effets réduits. */
  arcs: number;
  arcColor: number;
}

export const ORBIT = {
  /** Durée (s) du fondu d'une phase à l'autre : l'orbite se met à jour toute seule, sans recréer d'objet. */
  blendSeconds: 0.9,
  phases: {
    /** Phase 1 : rail fin bleu acier, très sobre, respiration lente. */
    1: { color: 0x5f9fe0, lineAlpha: 0.5, lineWidth: 1.6, glowAlpha: 0.3, breathe: 0.08, breatheHz: 0.25, arcs: 0, arcColor: 0xd8e4ff },
    /** Phase 2 : rail violet-bleu un peu plus présent, crépitement électrique discret. */
    2: { color: 0x8a82ff, lineAlpha: 0.75, lineWidth: 1.6, glowAlpha: 0.4, breathe: 0.1, breatheHz: 0.5, arcs: 0.8, arcColor: 0xd8e4ff },
  } as Readonly<Record<number, OrbitLook>>,
} as const;

/** Apparence de l'orbite d'une phase (phase inconnue : la plus proche inférieure, au moins la phase 1). */
export function orbitLook(phase: number): OrbitLook {
  const keys = Object.keys(ORBIT.phases).map(Number).sort((a, b) => a - b);
  let k = keys[0];
  for (const key of keys) if (key <= phase) k = key;
  return ORBIT.phases[k];
}

/**
 * Voyage des univers : apparence de l'orbite par UNIVERS (fondue pendant la traversée). Univers 1 et 2 = phases 1 et 2 ; 3 et 4 : couleurs propres,
 * toujours à plus de 30° de teinte des couleurs des dangers (corail, magenta).
 */
export const WORLD_ORBITS: Readonly<Record<number, OrbitLook>> = {
  1: ORBIT.phases[1],
  2: ORBIT.phases[2],
  3: { color: 0x8fe7ff, lineAlpha: 0.6, lineWidth: 1.7, glowAlpha: 0.42, breathe: 0.14, breatheHz: 0.18, arcs: 0, arcColor: 0xd8fff8 },
  4: { color: 0xffd9a0, lineAlpha: 0.62, lineWidth: 1.7, glowAlpha: 0.36, breathe: 0.1, breatheHz: 0.4, arcs: 0, arcColor: 0xfff0d0 },
};

export function worldOrbitLook(world: number): OrbitLook {
  return WORLD_ORBITS[world] ?? WORLD_ORBITS[1];
}
