import Phaser from 'phaser';
import type { AmbienceState } from '../../ambience/director';
import { WORLD_LIST, type WorldPalette } from '../../config/worlds';
import { AMB_TEX } from './textures';
import { lerpColor, type AmbienceView } from './view';

/**
 * Décors des univers 3 et 4 (voyage des univers) — DERRIÈRE l'orbite, les menaces et le vaisseau (profondeurs < 0,6, sous le voile de la zone de jeu).
 *   - Mer nébulaire : nappes de gaz en trois couches (parallaxe, dérive très lente), sphère gazeuse centrale, poussières flottantes, bulles d'ombre ;
 *   - Monde des vents : vortex en arrière-plan (deux spirales contrarotatives), courants de particules qui s'enroulent, œil incandescent.
 * Textures générées une fois (canvas), objets créés une fois (pools fixes) : aucune allocation par image. Purement décoratif (`Math.random` seul).
 */

export const WORLD_TEX = {
  gas: ['w-gas-a', 'w-gas-b', 'w-gas-c'],
  spiral: 'w-spiral',
} as const;

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

/** Nappe de gaz : amas de lueurs douces irrégulières (blanc, teinté au rendu). */
function gasTexture(scene: Phaser.Scene, key: string, seed: number): void {
  if (scene.textures.exists(key)) return;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const rnd = seeded(seed);
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.7) * size * 0.28;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d * 0.7;
    const r = size * (0.12 + rnd() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const k = 0.06 + rnd() * 0.08;
    g.addColorStop(0, `rgba(255,255,255,${k})`);
    g.addColorStop(0.6, `rgba(255,255,255,${k * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  scene.textures.addCanvas(key, c);
}

/** Spirale : trois bras logarithmiques doux (blanc, teinté au rendu). */
function spiralTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(WORLD_TEX.spiral)) return;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    const base = (arm * Math.PI * 2) / 3;
    for (let i = 0; i < 260; i++) {
      const u = i / 260;
      const r = 18 + u * (size / 2 - 22);
      const th = base + Math.log(r / 18) * 1.25;
      const x = cx + Math.cos(th) * r;
      const y = cx + Math.sin(th) * r;
      const fade = Math.sin(Math.PI * Math.min(1, u * 1.15));
      const w = 6 + 26 * u;
      const g = ctx.createRadialGradient(x, y, 0, x, y, w);
      g.addColorStop(0, `rgba(255,255,255,${0.05 * fade})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - w, y - w, w * 2, w * 2);
    }
  }
  scene.textures.addCanvas(WORLD_TEX.spiral, c);
}

export function ensureWorldTextures(scene: Phaser.Scene): void {
  WORLD_TEX.gas.forEach((k, i) => gasTexture(scene, k, 9001 + i * 131));
  spiralTexture(scene);
}

/** Couleur de palette de l'univers affiché, fondue vers la destination pendant la traversée. */
export function worldColor(s: AmbienceState, key: keyof WorldPalette): number {
  const a = WORLD_LIST[Math.max(0, s.world - 1)]?.palette[key] ?? 0xffffff;
  const b = WORLD_LIST[Math.max(0, s.worldTo - 1)]?.palette[key] ?? a;
  return lerpColor(a, b, s.worldMix);
}

interface Puff {
  img: Phaser.GameObjects.Image;
  layer: number;
  angle: number;
  dist: number;
  size: number;
  spin: number;
  drift: number;
  phase: number;
}

const PUFFS = [6, 5, 4] as const;
const PUFF_COLORS = [0x1e6b8a, 0x2fd9d0, 0xb8fff0] as const;
const PUFF_ALPHA = [0.42, 0.28, 0.15] as const;
const MOTES = 60;
const STREAMS = 72;

export class WorldDecor {
  private readonly puffs: Puff[] = [];
  private readonly gasCore: Phaser.GameObjects.Image;
  private readonly gasSwirl: Phaser.GameObjects.Image;
  private readonly gasRim: Phaser.GameObjects.Graphics;
  private readonly motes: Phaser.GameObjects.Graphics;
  private readonly shade: Phaser.GameObjects.Graphics;
  private readonly moteX = new Float32Array(MOTES);
  private readonly moteY = new Float32Array(MOTES);
  private readonly moteV = new Float32Array(MOTES);
  private readonly spirals: Phaser.GameObjects.Image[];
  private readonly eye: Phaser.GameObjects.Image;
  private readonly eyeHot: Phaser.GameObjects.Image;
  private readonly streams: Phaser.GameObjects.Graphics;
  private readonly sTh = new Float32Array(STREAMS);
  private readonly sR = new Float32Array(STREAMS);
  private readonly sK = new Float32Array(STREAMS);
  private spiralRot = [0, 0];
  private visible = false;

  /** @param depth décor (nappes, spirales, courants) ; @param coreDepth noyaux (sphère gazeuse, œil), au-dessus du voile de la zone de jeu */
  constructor(scene: Phaser.Scene, depth: number, coreDepth: number) {
    ensureWorldTextures(scene);
    for (let layer = 0; layer < PUFFS.length; layer++) {
      for (let i = 0; i < PUFFS[layer]; i++) {
        const img = scene.add.image(0, 0, WORLD_TEX.gas[(i + layer) % WORLD_TEX.gas.length]).setDepth(depth + layer * 0.01).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
        this.puffs.push({
          img,
          layer,
          angle: Math.random() * Math.PI * 2,
          dist: 0.35 + Math.random() * (0.55 + layer * 0.25),
          size: (1.1 - layer * 0.22) * (0.8 + Math.random() * 0.5),
          spin: (Math.random() - 0.5) * 0.02,
          drift: (0.004 + Math.random() * 0.006) * (layer + 1) * (Math.random() < 0.5 ? -1 : 1),
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    this.shade = scene.add.graphics().setDepth(depth + 0.05).setVisible(false);
    this.motes = scene.add.graphics().setDepth(depth + 0.06).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.gasCore = scene.add.image(0, 0, AMB_TEX.glow).setDepth(coreDepth).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.gasSwirl = scene.add.image(0, 0, WORLD_TEX.gas[0]).setDepth(coreDepth + 0.001).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.gasRim = scene.add.graphics().setDepth(coreDepth + 0.002).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < MOTES; i++) this.resetMote(i, true);
    this.spirals = [0, 1].map((i) => scene.add.image(0, 0, WORLD_TEX.spiral).setDepth(depth + 0.02 + i * 0.005).setVisible(false).setBlendMode(Phaser.BlendModes.ADD));
    this.streams = scene.add.graphics().setDepth(depth + 0.08).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.eye = scene.add.image(0, 0, AMB_TEX.glow).setDepth(coreDepth).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.eyeHot = scene.add.image(0, 0, AMB_TEX.glow).setDepth(coreDepth + 0.001).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < STREAMS; i++) this.resetStream(i, true);
  }

  private resetMote(i: number, anywhere: boolean): void {
    this.moteX[i] = (Math.random() - 0.5) * 2.2;
    this.moteY[i] = anywhere ? (Math.random() - 0.5) * 2.2 : 1.15;
    this.moteV[i] = 0.004 + Math.random() * 0.012;
  }

  private resetStream(i: number, anywhere: boolean): void {
    this.sTh[i] = Math.random() * Math.PI * 2;
    this.sR[i] = anywhere ? 0.15 + Math.random() * 1.0 : 1.05 + Math.random() * 0.2;
    this.sK[i] = 0.6 + Math.random() * 0.8;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (!v) this.hideAll();
  }

  private hideAll(): void {
    for (const p of this.puffs) p.img.setVisible(false);
    this.gasCore.setVisible(false);
    this.gasSwirl.setVisible(false);
    this.gasRim.clear().setVisible(false);
    this.motes.clear().setVisible(false);
    this.shade.clear().setVisible(false);
    for (const sp of this.spirals) sp.setVisible(false);
    this.streams.clear().setVisible(false);
    this.eye.setVisible(false);
    this.eyeHot.setVisible(false);
  }

  draw(s: AmbienceState, v: AmbienceView, dt: number): void {
    if (s.world === 0 || s.user <= 0) {
      this.hideAll();
      return;
    }
    this.drawNebula(s, v, dt, s.amt[2]);
    this.drawWinds(s, v, dt, s.amt[3]);
  }

  // ————————————————————————— Mer nébulaire

  private drawNebula(s: AmbienceState, v: AmbienceView, dt: number, amount: number): void {
    if (amount <= 0.004) {
      for (const p of this.puffs) p.img.setVisible(false);
      this.gasCore.setVisible(false);
      this.gasSwirl.setVisible(false);
      this.gasRim.clear();
      this.motes.clear();
      this.shade.clear();
      return;
    }
    const motion = s.reduced ? 0.4 : 1;
    // Transition vers les vents : les nappes sont entraînées dans une spirale orange (rotation et aspiration)
    const toWinds = s.variant === 'spiral' ? s.worldMix : 0;
    const swirl = s.variant === 'spiral' && s.transit > 0 ? s.transit * 2.4 : 0;
    const hot = 0xff8a2a;
    const nPuffs = s.quality.nebulae >= 3 ? this.puffs.length : s.quality.nebulae === 2 ? 11 : 7;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if (i >= nPuffs) {
        p.img.setVisible(false);
        continue;
      }
      p.angle += (p.drift + swirl * 0.6 * (1 + p.layer * 0.4)) * motion * dt;
      const breathe = 1 + 0.05 * Math.sin(s.time * 0.21 + p.phase);
      const pull = 1 - 0.55 * toWinds;
      const d = p.dist * v.halfDiag * pull;
      const x = v.cx + Math.cos(p.angle) * d;
      const y = v.cy + Math.sin(p.angle) * d * 0.85;
      const size = p.size * v.halfDiag * 1.5 * breathe;
      const col = lerpColor(PUFF_COLORS[p.layer], hot, toWinds * 0.85);
      p.img
        .setVisible(true)
        .setPosition(x, y)
        .setDisplaySize(size, size * 0.8)
        .setRotation(p.angle * 0.3 + p.spin * s.time)
        .setTint(col)
        .setAlpha(Math.min(0.9, PUFF_ALPHA[p.layer] * amount * s.user * (1 + 0.25 * s.p.heat)));
    }
    // Bulle d'ombre : voile sombre sur le DÉCOR seulement (sous l'orbite, les menaces et leurs annonces)
    const sh = this.shade;
    sh.clear();
    if (s.shadow > 0.01) {
      sh.setVisible(true);
      sh.fillStyle(0x01070c, Math.min(0.7, 0.55 * s.shadow * amount));
      sh.fillRect(0, 0, v.width, v.height);
    }
    // Sphère gazeuse centrale : lueur turquoise, nappe qui tourne, liseré doux qui respire
    const coreSize = 230 * v.scale * (1 + 0.04 * Math.sin(s.time * 0.6));
    this.gasCore.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(coreSize, coreSize).setTint(lerpColor(0x5ff2e2, hot, toWinds)).setAlpha(Math.min(0.85, 0.7 * amount * s.user));
    this.gasSwirl
      .setVisible(true)
      .setPosition(v.cx, v.cy)
      .setDisplaySize(coreSize * 0.95, coreSize * 0.95)
      .setRotation(s.time * 0.12 * motion + swirl)
      .setTint(lerpColor(0xb8fff0, hot, toWinds))
      .setAlpha(Math.min(0.8, 0.9 * amount * s.user));
    const rim = this.gasRim;
    rim.clear();
    rim.setVisible(true);
    const rr = 52 * v.scale * (1 + 0.05 * Math.sin(s.time * 0.8));
    rim.lineStyle(Math.max(1.5 * v.dpr, 3 * v.scale), lerpColor(0xd8fff8, hot, toWinds), 0.35 * amount * s.user);
    rim.strokeCircle(v.cx, v.cy, rr);
    rim.lineStyle(Math.max(1 * v.dpr, 1.5 * v.scale), 0xffffff, 0.25 * amount * s.user);
    rim.strokeEllipse(v.cx, v.cy, rr * 2.3, rr * 0.9);
    // Poussières flottantes très lentes (jamais confondues avec les dangers : points minuscules, sans contour)
    const m = this.motes;
    m.clear();
    m.setVisible(true);
    const n = Math.min(MOTES, Math.round(s.quality.dust * 0.4));
    for (let i = 0; i < n; i++) {
      this.moteY[i] -= this.moteV[i] * motion * dt;
      this.moteX[i] += Math.sin(s.time * 0.3 + i) * 0.0015 * motion;
      if (this.moteY[i] < -1.15) this.resetMote(i, false);
      const x = v.cx + this.moteX[i] * v.halfDiag;
      const y = v.cy + this.moteY[i] * v.halfDiag;
      m.fillStyle(i % 3 === 0 ? 0xffffff : 0x9ff7ee, 0.35 * amount * s.user);
      m.fillCircle(x, y, (0.8 + (i % 4) * 0.4) * v.dpr);
    }
  }

  // ————————————————————————— Monde des vents

  private drawWinds(s: AmbienceState, v: AmbienceView, dt: number, amount: number): void {
    if (amount <= 0.004) {
      for (const sp of this.spirals) sp.setVisible(false);
      this.streams.clear();
      this.eye.setVisible(false);
      this.eyeHot.setVisible(false);
      return;
    }
    const motion = s.reduced ? 0.4 : 1;
    const gust = 1 + 0.35 * Math.sin(s.time * 0.37) * Math.sin(s.time * 0.11 + 1);
    this.spiralRot[0] += 0.11 * gust * motion * dt;
    this.spiralRot[1] -= 0.06 * gust * motion * dt;
    const sizes = [1.7, 2.6];
    const tints = [0xff7a1a, 0xffb347];
    const alphas = [0.8, 0.48];
    for (let i = 0; i < 2; i++) {
      const sz = sizes[i] * v.halfDiag * (1 + 0.03 * Math.sin(s.time * 0.5 + i));
      this.spirals[i]
        .setVisible(true)
        .setPosition(v.cx, v.cy)
        .setDisplaySize(sz, sz)
        .setRotation(this.spiralRot[i])
        .setTint(tints[i])
        .setAlpha(Math.min(0.85, alphas[i] * amount * s.user));
    }
    // Courants : particules qui s'enroulent vers l'œil (traits courts dans le sens du courant)
    const g = this.streams;
    g.clear();
    g.setVisible(true);
    const n = Math.min(STREAMS, Math.round(s.quality.dust * 0.5));
    for (let i = 0; i < n; i++) {
      const r = this.sR[i];
      const w = 0.32 * this.sK[i] * gust / Math.max(0.25, Math.sqrt(r));
      this.sTh[i] += w * motion * dt;
      this.sR[i] -= 0.035 * this.sK[i] * motion * dt;
      if (this.sR[i] < 0.12) this.resetStream(i, false);
      const rp = r * v.halfDiag;
      const x = v.cx + Math.cos(this.sTh[i]) * rp;
      const y = v.cy + Math.sin(this.sTh[i]) * rp;
      const back = this.sTh[i] - 0.06 * this.sK[i];
      const rb = (r + 0.012) * v.halfDiag;
      const col = i % 4 === 0 ? 0xffe2a8 : 0xff9a3a;
      g.lineStyle(Math.max(1 * v.dpr, (1 + this.sK[i]) * v.dpr), col, Math.min(0.7, (0.25 + 0.35 * (1 - r)) * amount * s.user));
      g.lineBetween(v.cx + Math.cos(back) * rb, v.cy + Math.sin(back) * rb, x, y);
    }
    // Œil incandescent
    const pulse = 1 + 0.06 * Math.sin(s.time * 1.3) * gust;
    const eye = 320 * v.scale * pulse;
    this.eye.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(eye, eye).setTint(0xff7a1a).setAlpha(Math.min(0.9, 0.75 * amount * s.user));
    this.eyeHot.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(eye * 0.32, eye * 0.32).setTint(0xffe2a8).setAlpha(Math.min(1, 0.9 * amount * s.user));
  }
}
