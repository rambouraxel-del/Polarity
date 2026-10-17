/**
 * Images des apparences (PNG locaux) : URL résolues par Vite à partir du chemin déclaré dans config/skins.ts (`SkinConfig.image`).
 * Un chemin sans fichier correspondant renvoie null : le rendu retombe alors sur l'apparence par défaut.
 */
const FILES = import.meta.glob('../assets/skins/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byPath = new Map<string, string>(Object.entries(FILES).map(([k, url]) => [k.replace(/^(\.\.\/)+/, 'src/'), url]));

/** URL de l'image d'une apparence (chemin tel que déclaré dans la configuration), ou null si elle n'existe pas. */
export function skinImageUrl(path: string | null): string | null {
  return path ? byPath.get(path) ?? null : null;
}
