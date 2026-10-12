/**
 * Registre des canevas recolorés des apparences (sans dépendance à Phaser : utilisable par les écrans HTML).
 * Rempli par render/shipTextures.ts au démarrage de la scène ; vide hors navigateur (tests).
 */
const canvases = new Map<string, HTMLCanvasElement>();
const thumbs = new Map<string, string>();

export function setSkinCanvas(id: string, canvas: HTMLCanvasElement): void {
  canvases.set(id, canvas);
  thumbs.delete(id);
}

/** Canevas recoloré d'une apparence (aperçus des menus), ou null s'il n'a pas été généré. */
export function skinCanvas(id: string): HTMLCanvasElement | null {
  return canvases.get(id) ?? null;
}

/** Miniature (URL de données PNG) d'une apparence, mise en cache. Null si le canevas n'existe pas. */
export function skinThumb(id: string): string | null {
  const cached = thumbs.get(id);
  if (cached) return cached;
  const c = canvases.get(id);
  if (!c) return null;
  const url = c.toDataURL('image/png');
  thumbs.set(id, url);
  return url;
}
