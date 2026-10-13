import type Phaser from 'phaser';
import { AMBIENCE_COLORS } from '../../config/ambience';

/**
 * Textures de l'ambiance, générées UNE fois par code (canvas 2D) puis réutilisées : aucune image à télécharger.
 * Blanches (teintées au rendu) sauf le voile, de la couleur du fond.
 */
export const AMB_TEX = {
  glow: 'amb-glow',
  riftRim: 'amb-rift-rim',
  riftCore: 'amb-rift-core',
  veil: 'amb-veil',
} as const;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Lueur ronde (dégradé radial doux) : nébuleuses, halo de la faille. */
function glow(scene: Phaser.Scene): void {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(AMB_TEX.glow, c);
}

/** Contour de la faille : lentille effilée (deux courbes), lumineuse sur les bords, plus sombre au cœur. */
function riftRim(scene: Phaser.Scene): void {
  const w = 1024;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  const mid = h / 2;
  const half = h * 0.32;
  const lens = (): void => {
    ctx.beginPath();
    ctx.moveTo(8, mid);
    ctx.bezierCurveTo(w * 0.3, mid - half * 1.1, w * 0.7, mid - half * 1.1, w - 8, mid);
    ctx.bezierCurveTo(w * 0.7, mid + half * 1.1, w * 0.3, mid + half * 1.1, 8, mid);
    ctx.closePath();
  };
  // Lueur intérieure (faible) puis bord lumineux en plusieurs passes floues
  ctx.save();
  lens();
  ctx.clip();
  const inner = ctx.createLinearGradient(0, mid - half, 0, mid + half);
  inner.addColorStop(0, 'rgba(255,255,255,0.35)');
  inner.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  inner.addColorStop(1, 'rgba(255,255,255,0.35)');
  ctx.fillStyle = inner;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  for (const [blur, width, alpha] of [
    [26, 10, 0.25],
    [12, 5, 0.5],
    [3, 2, 1],
  ] as const) {
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = blur;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    lens();
    ctx.stroke();
  }
  // Effilement aux extrémités : la faille se perd dans l'espace
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.18, 'rgba(0,0,0,1)');
  fade.addColorStop(0.82, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  scene.textures.addCanvas(AMB_TEX.riftRim, c);
}

/** Filament central de la faille : trait fin, intense au centre, effilé. */
function riftCore(scene: Phaser.Scene): void {
  const w = 1024;
  const h = 32;
  const [c, ctx] = canvas(w, h);
  const along = ctx.createLinearGradient(0, 0, w, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.5, 'rgba(255,255,255,1)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = along;
  ctx.shadowColor = 'rgba(255,255,255,1)';
  ctx.shadowBlur = 8;
  ctx.fillRect(0, h / 2 - 1.5, w, 3);
  scene.textures.addCanvas(AMB_TEX.riftCore, c);
}

/** Voile sombre (couleur du fond) : opaque au centre, transparent au bord — protège la zone de jeu. */
function veil(scene: Phaser.Scene): void {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const col = AMBIENCE_COLORS.veil;
  const rgb = `${(col >> 16) & 255},${(col >> 8) & 255},${col & 255}`;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.62, `rgba(${rgb},0.85)`);
  g.addColorStop(0.85, `rgba(${rgb},0.35)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(AMB_TEX.veil, c);
}

/** Crée les textures une seule fois par scène. */
export function ensureAmbienceTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(AMB_TEX.glow)) return;
  glow(scene);
  riftRim(scene);
  riftCore(scene);
  veil(scene);
}
