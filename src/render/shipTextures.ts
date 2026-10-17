import Phaser from 'phaser';
import { CAMPAIGN_SKIN, DEFAULT_SKIN_ID, SKINS, type SkinDef } from '../config/skins';
import { recolorShip } from './shipPalette';
import { skinImageUrl } from './skinImages';
import { setSkinCanvas } from './skinSprites';

/**
 * Textures du vaisseau : une par apparence. Les apparences du joueur sont des PNG locaux (config/skins.ts) chargés par la scène ;
 * « La Traverse » (campagne) est dérivée du sprite de base par recoloration (src/render/shipPalette.ts).
 * Les canevas sont aussi utilisés par les aperçus des menus (miniatures et grand aperçu).
 */
export const skinTextureKey = (id: string): string => `ship-${id}`;

/** Sprite de base (campagne) : texture Phaser chargée par GameScene. */
const BASE_TEXTURE = 'ship';

/** Charge les images des apparences du joueur (à appeler dans `preload`). Une image manquante est simplement ignorée (repli sur l'apparence par défaut). */
export function loadSkinImages(scene: Phaser.Scene): void {
  for (const skin of SKINS) {
    const url = skinImageUrl(skin.image);
    if (url) scene.load.image(skinTextureKey(skin.id), url);
  }
}

function toCanvas(src: CanvasImageSource & { width: number; height: number }): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, src.width, src.height);
  return { canvas, ctx };
}

/** Enregistre les canevas des apparences pour les aperçus des menus, et la texture de la Traverse (une fois, au démarrage de la scène). */
export function registerSkinTextures(scene: Phaser.Scene): void {
  for (const skin of SKINS) {
    const key = skinTextureKey(skin.id);
    if (!scene.textures.exists(key)) continue;
    const made = toCanvas(scene.textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number });
    if (made) setSkinCanvas(skin.id, made.canvas);
  }
  // La Traverse : sprite de base recoloré
  if (CAMPAIGN_SKIN.recolor && scene.textures.exists(BASE_TEXTURE)) {
    const made = toCanvas(scene.textures.get(BASE_TEXTURE).getSourceImage() as CanvasImageSource & { width: number; height: number });
    if (made) {
      const { canvas, ctx } = made;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorShip(img.data, canvas.width, CAMPAIGN_SKIN.recolor);
      ctx.putImageData(img, 0, 0);
      setSkinCanvas(CAMPAIGN_SKIN.id, canvas);
      const key = skinTextureKey(CAMPAIGN_SKIN.id);
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
    }
  }
}

/** Texture à utiliser pour une apparence ; si elle est indisponible : celle de l'apparence par défaut, puis le sprite de base. */
export function shipTextureFor(scene: Phaser.Scene, skin: SkinDef): string {
  for (const id of [skin.id, DEFAULT_SKIN_ID]) {
    const key = skinTextureKey(id);
    if (scene.textures.exists(key)) return key;
  }
  return BASE_TEXTURE;
}
