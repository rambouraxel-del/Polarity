import type Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';

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

/** Petit générateur à graine fixe : la fissure a le même aspect à chaque lancement (décoratif, sans lien avec le gameplay). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit fractal 1D (somme d'octaves de bruit de valeur) : bords dentelés d'une fissure. */
function fractal(rand: () => number, octaves: number): (u: number) => number {
  const tables = Array.from({ length: octaves }, (_, o) => Array.from({ length: 4 << (o + 1) }, () => rand() * 2 - 1));
  return (u) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    tables.forEach((t) => {
      const x = u * (t.length - 1);
      const i = Math.min(t.length - 2, Math.floor(x));
      const f = x - i;
      const k = f * f * (3 - 2 * f);
      sum += amp * (t[i] * (1 - k) + t[i + 1] * k);
      norm += amp;
      amp *= 0.55;
    });
    return sum / norm;
  };
}

/** Hauteur de la lentille (fraction de la hauteur de la texture) : sert au dimensionnement dans Rift.ts. */
export const RIFT_LENS = 0.5;

/**
 * Contour de la faille : fissure irrégulière (colonne vertébrale sinueuse, bords dentelés indépendants, quelques
 * ramifications), bord lumineux en trois passes floues, intérieur plus sombre, extrémités effilées.
 */
function riftRim(scene: Phaser.Scene): void {
  const w = 1024;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  const rand = seeded(20241);
  const mid = h / 2;
  const half = (h * RIFT_LENS) / 2;
  const N = 220;
  const spineNoise = fractal(rand, 3);
  const topNoise = fractal(rand, 5);
  const botNoise = fractal(rand, 5);
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = 8 + u * (w - 16);
    const spine = mid + spineNoise(u) * 14;
    const hw = half * Math.pow(Math.sin(Math.PI * u), 0.8);
    top.push([x, spine - hw * (1 + 0.28 * topNoise(u))]);
    bot.push([x, spine + hw * (1 + 0.28 * botNoise(u))]);
  }
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (const [x, y] of top) ctx.lineTo(x, y);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
  };
  // Intérieur : lueur faible, plus sombre au cœur
  ctx.save();
  trace();
  ctx.clip();
  const inner = ctx.createLinearGradient(0, mid - half, 0, mid + half);
  inner.addColorStop(0, 'rgba(255,255,255,0.4)');
  inner.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  inner.addColorStop(1, 'rgba(255,255,255,0.4)');
  ctx.fillStyle = inner;
  ctx.fillRect(0, 0, w, h);
  // Filaments d'énergie à l'intérieur
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 5; k++) {
    const off = (rand() - 0.5) * half * 1.1;
    const ph = rand() * 6;
    ctx.beginPath();
    for (let i = 0; i <= N; i += 2) {
      const u = i / N;
      const y = mid + spineNoise(u) * 14 + off * Math.sin(Math.PI * u) + Math.sin(u * 14 + ph) * 4;
      if (i === 0) ctx.moveTo(8 + u * (w - 16), y);
      else ctx.lineTo(8 + u * (w - 16), y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // Bords lumineux (trois passes floues) + ramifications
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineJoin = 'round';
  const edge = (): void => {
    for (const side of [top, bot]) {
      ctx.beginPath();
      side.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
  };
  const branches: [number, number, number, number][] = [];
  for (let k = 0; k < 7; k++) {
    const i = 30 + Math.floor(rand() * (N - 60));
    const sideTop = rand() < 0.5;
    const [x, y] = (sideTop ? top : bot)[i];
    const dir = (sideTop ? -1 : 1) * (0.5 + rand() * 0.8);
    const len = 22 + rand() * 24;
    branches.push([x, y, x + (rand() < 0.5 ? -1 : 1) * len * 0.8, y + dir * len]);
  }
  for (const [blur, width, alpha] of [
    [26, 9, 0.25],
    [11, 4.5, 0.5],
    [3, 1.8, 1],
  ] as const) {
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = blur;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    edge();
    ctx.lineWidth = width * 0.6;
    for (const [x0, y0, x1, y1] of branches) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo((x0 + x1) / 2 + (rand() - 0.5) * 6, (y0 + y1) / 2 + (rand() - 0.5) * 6);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  // Effilement aux extrémités : la faille se perd dans l'espace
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.16, 'rgba(0,0,0,1)');
  fade.addColorStop(0.84, 'rgba(0,0,0,1)');
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
  const solid = AMBIENCE.shape.veilSolid;
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(solid, `rgba(${rgb},1)`);
  g.addColorStop(solid + (1 - solid) * 0.5, `rgba(${rgb},0.4)`);
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
