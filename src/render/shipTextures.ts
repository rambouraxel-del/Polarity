import Phaser from 'phaser';
import { CAMPAIGN_SKIN, SHIP_MODELS, SKINS, type SkinDef } from '../config/skins';
import { recolorShip } from './shipPalette';
import { setSkinCanvas } from './skinSprites';

/**
 * Textures du vaisseau : une par apparence, dérivée du sprite de base par recoloration (src/render/shipPalette.ts).
 * Les canevas sont aussi utilisés par les aperçus des menus (miniatures et grand aperçu).
 */
export const skinTextureKey = (id: string): string => `ship-${id}`;

/** Génère les textures de toutes les apparences (une fois, au démarrage de la scène). */
export function registerSkinTextures(scene: Phaser.Scene): void {
  for (const skin of [...SKINS, CAMPAIGN_SKIN]) {
    const model = SHIP_MODELS[skin.asset];
    if (!model || !scene.textures.exists(model.texture)) continue;
    const src = scene.textures.get(model.texture).getSourceImage() as CanvasImageSource & { width: number; height: number };
    const size = src.width;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    ctx.drawImage(src, 0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    recolorShip(img.data, size, skin.colors);
    ctx.putImageData(img, 0, 0);
    setSkinCanvas(skin.id, canvas);
    const key = skinTextureKey(skin.id);
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
  }
}

/** Texture à utiliser pour une apparence ; si elle est indisponible, le sprite de base (modèle classique). */
export function shipTextureFor(scene: Phaser.Scene, skin: SkinDef): string {
  const key = skinTextureKey(skin.id);
  if (scene.textures.exists(key)) return key;
  const model = SHIP_MODELS[skin.asset] ?? SHIP_MODELS.classic;
  return scene.textures.exists(model.texture) ? model.texture : SHIP_MODELS.classic.texture;
}
