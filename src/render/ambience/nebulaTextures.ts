import Phaser from 'phaser';

/**
 * Textures PROCÉDURALES de l'univers 3 « La Mer nébulaire » (aucune image importée, aucun fond généré) : nuages volumétriques, tourbillon de la nébuleuse,
 * monolithes et îlots rocheux facettés, planète à anneau, traînées lumineuses. Tout est dessiné une seule fois par canvas 2D, de façon DÉTERMINISTE (graine fixe),
 * puis assemblé par `NebulaDecor`. La génération est découpée en travaux courts (`nebulaJobs`) pour ne jamais bloquer une image : le jeu les exécute un par image
 * pendant l'univers 2, ou tous d'un coup si l'on saute directement dans l'univers 3 (mode développeur).
 */

export const NEB_TEX = {
  cloud: ['n-cloud-a', 'n-cloud-b', 'n-cloud-c', 'n-cloud-d'],
  wisp: ['n-wisp-a', 'n-wisp-b'],
  swirl: 'n-swirl',
  rock: ['n-rock-a', 'n-rock-b', 'n-rock-c', 'n-rock-d', 'n-rock-e'],
  planet: 'n-planet',
  ringBack: 'n-ring-back',
  ringFront: 'n-ring-front',
  streak: 'n-streak',
  ray: 'n-ray',
} as const;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** Bruit de valeur périodique (grille `n` × `n`), interpolé en douceur : brique de base du bruit fractal. */
class Lattice {
  private readonly v: Float32Array;
  constructor(private readonly n: number, seed: number) {
    const r = rng(seed);
    this.v = new Float32Array(n * n);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }
  at(x: number, y: number): number {
    const n = this.n;
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const fx = smooth(x - xf);
    const fy = smooth(y - yf);
    const x0 = ((xf % n) + n) % n;
    const y0 = ((yf % n) + n) % n;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    const a = this.v[y0 * n + x0];
    const b = this.v[y0 * n + x1];
    const c = this.v[y1 * n + x0];
    const d = this.v[y1 * n + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
}

/** Bruit fractal (fBm) avec déformation de domaine : volutes de gaz. Valeurs 0–1. */
function fbm(l: Lattice, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * l.at(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

// ————————————————————————————————————————————— nuages volumétriques

/** Nuage : densité fractale déformée, bords fondus, veines plus claires ; blanc + alpha (teinté au rendu). */
function cloudTexture(scene: Phaser.Scene, key: string, seed: number, stretch: number): void {
  if (scene.textures.exists(key)) return;
  const size = 256;
  const { c, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const L = new Lattice(32, seed);
  const L2 = new Lattice(32, seed ^ 0x9e3779b9);
  const k = 3.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Déformation de domaine : les volutes s'enroulent
      const wx = fbm(L2, u * 2.2 + 3.1, v * 2.2 * stretch + 1.7, 3) - 0.5;
      const wy = fbm(L2, u * 2.2 + 7.7, v * 2.2 * stretch + 5.3, 3) - 0.5;
      const d = fbm(L, u * k + wx * 1.9, v * k * stretch + wy * 1.9, 5);
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const fall = 1 - smooth(Math.sqrt(dx * dx + dy * dy * 1.15) * 1.02);
      let a = smooth((d - 0.4) * 3.3) * fall;
      // Veines : crêtes plus lumineuses dans le nuage
      const ridge = 1 - Math.abs(2 * fbm(L2, u * 5 + wx * 2, v * 5 * stretch + wy * 2, 4) - 1);
      a *= 0.4 + 1.0 * ridge * ridge;
      a = Math.min(1, a);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, c);
}

/** Filaments de gaz (courants lumineux) : bruit étiré le long d'un axe, crêtes fines ; blanc + alpha (teinté au rendu). */
function wispTexture(scene: Phaser.Scene, key: string, seed: number): void {
  if (scene.textures.exists(key)) return;
  const W = 384;
  const H = 192;
  const { c, ctx } = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const L = new Lattice(32, seed);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const wy = (fbm(L, u * 1.6 + 2, v * 3.2, 3) - 0.5) * 0.9;
      // Filaments étirés dans le sens de la largeur : crêtes fines (1 − |2n − 1|), modulées par une enveloppe lente
      const n = fbm(L, u * 2.2 + 4.1, v * 10 + wy * 6, 4);
      const ridge = Math.pow(1 - Math.abs(2 * n - 1), 3.2);
      const env = fbm(L, u * 1.4 + 9, v * 2.1 + 3, 3);
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const fall = (1 - smooth(Math.abs(dx) * 1.0)) * (1 - smooth(Math.abs(dy) * 1.05));
      const a = Math.min(1, ridge * smooth((env - 0.3) * 3) * fall * 1.5);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, c);
}

// ————————————————————————————————————————————— tourbillon de la nébuleuse

/** Spirale de gaz (bras fractals enroulés autour d'un foyer lumineux) : référence 1 (tourbillon turquoise aspirant vers un point brillant). */
function swirlTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(NEB_TEX.swirl)) return;
  const size = 384;
  const { c, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const L = new Lattice(32, 4242);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) * 2;
      const dy = (y / size - 0.5) * 2;
      const r = Math.sqrt(dx * dx + dy * dy);
      const th = Math.atan2(dy, dx);
      const turb = fbm(L, dx * 2.6 + 5, dy * 2.6 + 9, 4) - 0.5;
      // Trois bras logarithmiques ; la turbulence les déchire en filaments
      const arm = 0.5 + 0.5 * Math.cos(3 * (th - 1.65 * Math.log(r + 0.07)) + 5.0 * turb);
      const filaments = fbm(L, th * 3.0 + r * 9, r * 14, 3);
      let a = Math.pow(arm, 2.2) * (0.35 + 0.9 * filaments) * Math.exp(-r * 1.55) * smooth(r / 0.05);
      a *= 1 - smooth((r - 0.82) / 0.18);
      // Foyer : cœur très lumineux au centre
      a += 0.9 * Math.exp(-r * r * 85);
      a = Math.min(1, a);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(NEB_TEX.swirl, c);
}

// ————————————————————————————————————————————— monolithes et îlots rocheux

type Pt = readonly [number, number];

/** Silhouettes (coordonnées 0–1 dans la texture, de haut en bas) : dalle, îlot, éboulis, aiguille, double pilier. */
function rockOutline(kind: number, r: () => number): Pt[] {
  const j = (v: number, a = 0.03): number => v + (r() - 0.5) * 2 * a;
  switch (kind) {
    case 0: // grande dalle verticale (monolithe), sommet tronqué
      return [[j(0.3), j(0.06)], [j(0.56), j(0.03)], [j(0.74), j(0.1)], [j(0.7), j(0.38)], [j(0.77), j(0.62)], [j(0.62), j(0.9)], [j(0.46), j(0.97)], [j(0.3), j(0.78)], [j(0.24), j(0.46)]];
    case 1: // îlot : dessus plat, dessous en pointe
      return [[j(0.06), j(0.22)], [j(0.3), j(0.15)], [j(0.62), j(0.14)], [j(0.94), j(0.24)], [j(0.84), j(0.4)], [j(0.7), j(0.62)], [j(0.56), j(0.9)], [j(0.46), j(0.98)], [j(0.34), j(0.7)], [j(0.2), j(0.46)]];
    case 2: // éboulis anguleux
      return [[j(0.14), j(0.3)], [j(0.34), j(0.1)], [j(0.62), j(0.16)], [j(0.88), j(0.34)], [j(0.9), j(0.62)], [j(0.7), j(0.86)], [j(0.42), j(0.9)], [j(0.16), j(0.7)]];
    case 3: // aiguille
      return [[j(0.5), j(0.02)], [j(0.64), j(0.3)], [j(0.7), j(0.6)], [j(0.6), j(0.92)], [j(0.44), j(0.97)], [j(0.34), j(0.62)], [j(0.38), j(0.28)]];
    default: // double pilier
      return [[j(0.12), j(0.18)], [j(0.3), j(0.1)], [j(0.42), j(0.34)], [j(0.55), j(0.04)], [j(0.76), j(0.12)], [j(0.84), j(0.5)], [j(0.7), j(0.92)], [j(0.5), j(0.7)], [j(0.32), j(0.96)], [j(0.14), j(0.6)]];
  }
}

/**
 * Roche fracturée, éclairée par la DROITE (la lumière vient du centre de la nébuleuse : le rendu retourne la texture pour les blocs de droite), colorée (pas
 * teintée au rendu). Silhouette anguleuse remplie, puis surface calculée pixel par pixel : cellules de Voronoï (cassures de la pierre, chacune avec sa propre
 * orientation donc son propre éclairage), strates fractales, arêtes sombres entre les cellules, liseré lumineux là où la silhouette regarde la lumière, usure
 * plus claire en haut, brume lumineuse au pied (la roche émerge du gaz).
 */
function rockTexture(scene: Phaser.Scene, key: string, seed: number, kind: number): void {
  if (scene.textures.exists(key)) return;
  const W = 256;
  const H = 320;
  const { c, ctx } = makeCanvas(W, H);
  const r = rng(seed);
  const pts = rockOutline(kind, r).map(([x, y]) => [x * W, y * H] as Pt);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  const img = ctx.getImageData(0, 0, W, H);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4 + 3];
  // Masque adouci (deux passes de flou) : bords sans escalier ni liseré crénelé une fois la texture agrandie
  const soft = new Float32Array(W * H);
  const tmp = new Float32Array(W * H);
  for (let i = 0; i < soft.length; i++) soft[i] = mask[i] / 255;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += soft[y * W + Math.min(W - 1, Math.max(0, x + k))];
      tmp[y * W + x] = sum / 5;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x];
      soft[y * W + x] = sum / 5;
    }
  }
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? 0 : soft[y * W + x]);
  // Cellules : points tirés dans la boîte de la silhouette, chacun avec une normale (angle) et une teinte propres
  const N = 26;
  const sx = new Float32Array(N);
  const sy = new Float32Array(N);
  const nrm = new Float32Array(N);
  const tone = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    sx[i] = r() * W;
    sy[i] = r() * H;
    nrm[i] = r() * Math.PI * 2;
    tone[i] = 0.75 + r() * 0.5;
  }
  const L = new Lattice(32, seed ^ 0x51ed270b);
  const lightX = 0.9;
  const lightY = -0.42;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sm = soft[y * W + x];
      const m = Math.round(255 * smooth((sm - 0.3) / 0.4));
      const i = (y * W + x) * 4;
      if (m === 0) {
        img.data[i + 3] = 0;
        continue;
      }
      let d1 = 1e9;
      let d2 = 1e9;
      let k = 0;
      for (let q = 0; q < N; q++) {
        const dx = x - sx[q];
        const dy = (y - sy[q]) * 0.8;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          k = q;
        } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1); // petit près des arêtes entre cellules
      // Éclairage de la cellule : sa normale contre la lumière, plus un peu de relief fractal
      const lit = 0.5 + 0.5 * (Math.cos(nrm[k]) * lightX + Math.sin(nrm[k]) * lightY);
      const strata = fbm(L, x / 30, y / 9, 3) - 0.5;
      const grain = fbm(L, x / 3 + 11, y / 3 + 5, 2) - 0.5;
      let t = (0.1 + 0.34 * lit * lit) * tone[k] * (1 + 0.5 * strata + 0.3 * grain);
      // Arêtes entre les cellules : fine ligne sombre puis léger liseré clair du côté éclairé
      t *= 0.72 + 0.28 * smooth(edge / 4);
      if (edge < 1.2 && lit > 0.6) t += 0.08;
      // Dégradé vertical : plus clair en haut (usure), plus sombre vers le bas
      t *= 1.18 - 0.55 * (y / H);
      // Liseré de silhouette doux : fort là où le vide est du côté de la lumière (différence de masque adouci)
      const rim = Math.max(0, Math.min(1, (sm - at(Math.round(x + lightX * 7), Math.round(y + lightY * 7))) * 2.6)) * smooth((sm - 0.2) / 0.5);
      let R = 4 + 54 * t;
      let G = 15 + 112 * t;
      let B = 22 + 128 * t;
      if (rim > 0) {
        R += 40 * rim;
        G += 150 * rim;
        B += 140 * rim;
      }
      // Brume lumineuse au pied
      const mist = smooth((y / H - 0.64) / 0.36);
      R += (60 - R) * mist * 0.6;
      G += (205 - G) * mist * 0.6;
      B += (210 - B) * mist * 0.6;
      img.data[i] = Math.max(0, Math.min(255, R));
      img.data[i + 1] = Math.max(0, Math.min(255, G));
      img.data[i + 2] = Math.max(0, Math.min(255, B));
      img.data[i + 3] = m;
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, c);
}

// ————————————————————————————————————————————— planète à anneau

function planetTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(NEB_TEX.planet)) return;
  const S = 256;
  const { c, ctx } = makeCanvas(S, S);
  const r = S * 0.38;
  const cx = S / 2;
  const cy = S / 2;
  // Atmosphère
  const halo = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, S / 2);
  halo.addColorStop(0, 'rgba(120,255,240,0.55)');
  halo.addColorStop(1, 'rgba(120,255,240,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, S, S);
  // Disque : dégradé de lumière (en haut à gauche, face à la source), turquoise vif
  const disk = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.08, cx, cy, r);
  disk.addColorStop(0, '#f0fffd');
  disk.addColorStop(0.28, '#8ff6ec');
  disk.addColorStop(0.62, '#2bb7c0');
  disk.addColorStop(1, '#0b5468');
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Bandes et tempêtes
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const L = new Lattice(32, 777);
  for (let y = -r; y < r; y += 2) {
    const n = fbm(L, y / 16, 3.3, 3);
    const half = Math.sqrt(Math.max(0, r * r - y * y));
    ctx.fillStyle = `rgba(${n > 0.5 ? '230,255,250' : '6,60,78'},${0.05 + 0.3 * Math.abs(n - 0.5)})`;
    ctx.fillRect(cx - half, cy + y, half * 2, 2);
  }
  // Tourbillon de tempête
  const storm = ctx.createRadialGradient(cx + r * 0.25, cy + r * 0.2, 0, cx + r * 0.25, cy + r * 0.2, r * 0.3);
  storm.addColorStop(0, 'rgba(240,255,252,0.5)');
  storm.addColorStop(1, 'rgba(240,255,252,0)');
  ctx.fillStyle = storm;
  ctx.fillRect(0, 0, S, S);
  // Terminateur : l'ombre gagne le bas droit, sans noircir le disque
  const shade = ctx.createRadialGradient(cx - r * 0.5, cy - r * 0.5, r * 0.7, cx + r * 0.25, cy + r * 0.25, r * 1.3);
  shade.addColorStop(0, 'rgba(0,18,28,0)');
  shade.addColorStop(1, 'rgba(0,18,28,0.5)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();
  scene.textures.addCanvas(NEB_TEX.planet, c);
}

/** Anneau en deux moitiés (derrière / devant la planète) : ellipse inclinée, bandes concentriques. */
function ringTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(NEB_TEX.ringBack)) return;
  const W = 512;
  const H = 160;
  for (const back of [true, false]) {
    const { c, ctx } = makeCanvas(W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, back ? 0 : H / 2, W, H / 2);
    ctx.clip();
    for (let k = 0; k < 14; k++) {
      const t = k / 13;
      const rx = W * (0.3 + 0.2 * t);
      const ry = H * (0.28 + 0.2 * t);
      const a = 0.1 + 0.4 * Math.sin(Math.PI * t) * (0.6 + 0.4 * ((k * 7) % 3) / 2);
      ctx.strokeStyle = `rgba(190,255,246,${a})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    scene.textures.addCanvas(back ? NEB_TEX.ringBack : NEB_TEX.ringFront, c);
  }
}

// ————————————————————————————————————————————— traînées et rayons

/** Traînée verticale (cascade lumineuse sous un îlot) et rayon (faisceau de lumière) : blanc + alpha. */
function streakTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(NEB_TEX.streak)) {
    const { c, ctx } = makeCanvas(48, 256);
    const img = ctx.createImageData(48, 256);
    const L = new Lattice(32, 99);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 48; x++) {
        const u = (x / 48 - 0.5) * 2;
        const across = Math.exp(-u * u * 3.2);
        const along = smooth(y / 28) * (1 - smooth((y - 120) / 136));
        const f = 0.45 + 0.9 * fbm(L, x / 5, y / 26, 3);
        const a = Math.min(1, across * along * f);
        const i = (y * 48 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    scene.textures.addCanvas(NEB_TEX.streak, c);
  }
  if (!scene.textures.exists(NEB_TEX.ray)) {
    const { c, ctx } = makeCanvas(64, 512);
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    // Largeur : s'évase de la source vers le bas
    for (let y = 0; y < 512; y += 2) {
      const half = 2 + (y / 512) * 30;
      const gx = ctx.createLinearGradient(32 - half, 0, 32 + half, 0);
      gx.addColorStop(0, 'rgba(255,255,255,0)');
      gx.addColorStop(0.5, `rgba(255,255,255,${(0.9 * (1 - y / 512)) ** 1.4 * 0.7})`);
      gx.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gx;
      ctx.fillRect(32 - half, y, half * 2, 2);
    }
    void g;
    scene.textures.addCanvas(NEB_TEX.ray, c);
  }
}

/** Travaux de génération, dans l'ordre : chacun est court (quelques dizaines de ms). */
export function nebulaJobs(scene: Phaser.Scene): (() => void)[] {
  const jobs: (() => void)[] = [];
  NEB_TEX.cloud.forEach((k, i) => jobs.push(() => cloudTexture(scene, k, 1301 + i * 977, i % 2 ? 0.7 : 1.15)));
  NEB_TEX.wisp.forEach((k, i) => jobs.push(() => wispTexture(scene, k, 8801 + i * 421)));
  jobs.push(() => swirlTexture(scene));
  NEB_TEX.rock.forEach((k, i) => jobs.push(() => rockTexture(scene, k, 5501 + i * 313, i)));
  jobs.push(() => planetTexture(scene));
  jobs.push(() => ringTextures(scene));
  jobs.push(() => streakTextures(scene));
  return jobs;
}
