import type Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';

/**
 * Textures de l'ambiance, générées UNE fois par code (canvas 2D) puis réutilisées : aucune image à télécharger.
 * Blanches (teintées au rendu) sauf le voile (couleur du fond) et les plans du tunnel (facettes colorées).
 */
export const AMB_TEX = {
  glow: 'amb-glow',
  veil: 'amb-veil',
  vignette: 'amb-vignette',
  tunnel: ['amb-tunnel-a', 'amb-tunnel-b'],
  shards: ['amb-shard-a', 'amb-shard-b', 'amb-shard-c'],
} as const;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Lueur ronde (dégradé radial doux) : nébuleuses, halos, sphère centrale. */
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

/** Petit générateur à graine fixe : les plans du tunnel ont le même aspect à chaque lancement (décoratif, sans lien avec le gameplay). */
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

/** Couleurs des arêtes lumineuses (bleu électrique surtout, glace, violet) : jamais de magenta, de corail ni d'orange (réservés aux dangers). */
const EDGE_COLORS: readonly [number, number, number][] = [
  [70, 140, 255],
  [70, 140, 255],
  [70, 140, 255],
  [190, 232, 255],
  [190, 232, 255],
  [140, 104, 255],
];

/**
 * Un plan du tunnel : anneau de grandes facettes triangulaires brisées (maillage polaire dont les sommets sont décalés au hasard, quelques facettes
 * manquantes). Trois familles de faces : sombres (presque noires, bleu nuit), éclairées en bleu électrique et éclairées en violet, chacune avec un
 * dégradé qui donne du volume. Arêtes lumineuses (halo en trois passes sans flou coûteux) ; les arêtes des « bandes » (cercles du maillage) sont plus
 * souvent allumées que les rayons. Fondu doux au bord intérieur (point de fuite) et extérieur.
 */
function tunnelRing(scene: Phaser.Scene, key: string, seed: number): void {
  const size = 1024;
  const [c, ctx] = canvas(size, size);
  const rand = seeded(seed);
  const mid = size / 2;
  const R = size / 2 - 6;
  const SEG = 14;
  const levels = [0.2, 0.35, 0.54, 0.76, 1];
  const grid: [number, number][][] = levels.map((lv, j) =>
    Array.from({ length: SEG }, (_, i) => {
      const a = ((i + (rand() - 0.5) * 0.7 + (j % 2) * 0.3) / SEG) * Math.PI * 2;
      const r = lv * R * (1 + (rand() - 0.5) * (j === 0 ? 0.08 : j === levels.length - 1 ? 0.05 : 0.22));
      return [mid + Math.cos(a) * r, mid + Math.sin(a) * r] as [number, number];
    }),
  );
  type Pt = [number, number];
  const tris: { t: [Pt, Pt, Pt]; band: boolean[] }[] = [];
  for (let j = 0; j < levels.length - 1; j++) {
    for (let i = 0; i < SEG; i++) {
      if (rand() < 0.07) continue; // facette manquante : on voit plus loin
      const n = (i + 1) % SEG;
      const a = grid[j][i];
      const b = grid[j][n];
      const cc = grid[j + 1][n];
      const d = grid[j + 1][i];
      if (rand() < 0.5) tris.push({ t: [a, b, cc], band: [true, false, false] }, { t: [a, cc, d], band: [false, true, true] });
      else tris.push({ t: [a, b, d], band: [true, false, false] }, { t: [b, cc, d], band: [false, true, true] });
    }
  }
  // Faces : sombres, bleu électrique ou violet, avec dégradé du sommet le plus lumineux vers le plus sombre
  ctx.lineJoin = 'round';
  for (const { t } of tris) {
    const k = rand();
    let c0: string;
    let c1: string;
    if (k < 0.34) {
      c0 = `rgba(${22 + Math.floor(rand() * 20)},${64 + Math.floor(rand() * 30)},${225 + Math.floor(rand() * 30)},0.92)`;
      c1 = 'rgba(8,20,96,0.96)';
    } else if (k < 0.44) {
      c0 = `rgba(${84 + Math.floor(rand() * 24)},${48 + Math.floor(rand() * 20)},${210 + Math.floor(rand() * 40)},0.9)`;
      c1 = 'rgba(22,12,76,0.96)';
    } else {
      const m = rand();
      c0 = `rgba(${6 + Math.floor(m * 10)},${12 + Math.floor(m * 20)},${44 + Math.floor(m * 40)},0.97)`;
      c1 = 'rgba(2,5,22,0.98)';
    }
    const which = Math.floor(rand() * 3);
    const o = t[which];
    const mx = (t[0][0] + t[1][0] + t[2][0]) / 3;
    const my = (t[0][1] + t[1][1] + t[2][1]) / 3;
    const g = ctx.createLinearGradient(o[0], o[1], mx - (o[0] - mx) * 0.6, my - (o[1] - my) * 0.6);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(t[0][0], t[0][1]);
    ctx.lineTo(t[1][0], t[1][1]);
    ctx.lineTo(t[2][0], t[2][1]);
    ctx.closePath();
    ctx.fill();
  }
  // Arêtes lumineuses : trois passes (large et faible, moyenne, fine et vive)
  const passes: [number, number][] = [
    [18, 0.07],
    [8, 0.2],
    [2.8, 0.95],
  ];
  const lit: { a: Pt; b: Pt; col: readonly [number, number, number]; w: number }[] = [];
  for (const { t, band } of tris) {
    for (let e = 0; e < 3; e++) {
      if (rand() > (band[e] ? 0.86 : 0.5)) continue;
      lit.push({ a: t[e], b: t[(e + 1) % 3], col: EDGE_COLORS[Math.floor(rand() * EDGE_COLORS.length)], w: 0.6 + rand() * 0.9 });
    }
  }
  ctx.lineCap = 'round';
  for (const [width, alpha] of passes) {
    for (const e of lit) {
      ctx.strokeStyle = `rgba(${e.col[0]},${e.col[1]},${e.col[2]},${alpha})`;
      ctx.lineWidth = width * e.w;
      ctx.beginPath();
      ctx.moveTo(e.a[0], e.a[1]);
      ctx.lineTo(e.b[0], e.b[1]);
      ctx.stroke();
    }
  }
  // Fondu doux : bord intérieur (vers le point de fuite) et bord extérieur
  ctx.globalCompositeOperation = 'destination-in';
  const m = ctx.createRadialGradient(mid, mid, 0, mid, mid, R);
  m.addColorStop(0, 'rgba(0,0,0,0)');
  m.addColorStop(0.18, 'rgba(0,0,0,0)');
  m.addColorStop(0.3, 'rgba(0,0,0,1)');
  m.addColorStop(0.94, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = m;
  ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(key, c);
}

/** Fragment : polygone irrégulier sombre aux arêtes lumineuses (teinté au rendu). */
function shard(scene: Phaser.Scene, key: string, seed: number): void {
  const size = 96;
  const [c, ctx] = canvas(size, size);
  const rand = seeded(seed);
  const n = 5 + Math.floor(rand() * 2);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const r = size * (0.2 + 0.2 * rand()) * (i % 2 === 0 ? 1.25 : 0.8);
    pts.push([size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r]);
  }
  const trace = (): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, 'rgba(90,120,230,0.95)');
  g.addColorStop(1, 'rgba(20,30,90,0.95)');
  ctx.fillStyle = g;
  trace();
  ctx.fill();
  ctx.lineJoin = 'round';
  for (const [w, a] of [
    [5, 0.25],
    [1.8, 0.95],
  ] as const) {
    ctx.strokeStyle = `rgba(210,235,255,${a})`;
    ctx.lineWidth = w;
    trace();
    ctx.stroke();
  }
  scene.textures.addCanvas(key, c);
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

/** Vignette : transparente au centre, sombre sur les bords et dans les coins (phase 2). */
function vignette(scene: Phaser.Scene): void {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  const col = AMBIENCE_COLORS.veil;
  const rgb = `${(col >> 16) & 255},${(col >> 8) & 255},${col & 255}`;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(0.5, `rgba(${rgb},0)`);
  g.addColorStop(0.78, `rgba(${rgb},0.45)`);
  g.addColorStop(1, `rgba(${rgb},1)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(AMB_TEX.vignette, c);
}

/** Crée les textures une seule fois par scène. */
export function ensureAmbienceTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(AMB_TEX.glow)) return;
  glow(scene);
  veil(scene);
  vignette(scene);
  AMB_TEX.shards.forEach((k, i) => shard(scene, k, 700 + i * 31));
  AMB_TEX.tunnel.forEach((k, i) => tunnelRing(scene, k, 20241 + i * 977));
}
