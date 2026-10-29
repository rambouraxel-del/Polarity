import Phaser from 'phaser';
import type { AmbienceState } from '../../ambience/director';
import { WORLD_LIST, type WorldPalette } from '../../config/worlds';
import { NebulaDecor } from './NebulaDecor';
import { AMB_TEX } from './textures';
import { lerpColor, type AmbienceView } from './view';

/**
 * Décors des univers 3 et 4 (voyage des univers) — DERRIÈRE l'orbite, les menaces et le vaisseau (profondeurs < 0,6, sous le voile de la zone de jeu).
 *   - Mer nébulaire : `NebulaDecor` (nébuleuse volumétrique, monolithes flottants, planète à anneau, éclipse ; textures procédurales, réagit à la musique) ;
 *   - Monde des vents : vortex en arrière-plan (deux spirales contrarotatives), courants de particules qui s'enroulent, œil incandescent.
 * Textures générées une fois (canvas), objets créés une fois (pools fixes) : aucune allocation par image. Purement décoratif (`Math.random` seul).
 */

export const WORLD_TEX = {
  spiral: 'w-spiral',
} as const;

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
  spiralTexture(scene);
}

/** Couleur de palette de l'univers affiché, fondue vers la destination pendant la traversée. */
export function worldColor(s: AmbienceState, key: keyof WorldPalette): number {
  const a = WORLD_LIST[Math.max(0, s.world - 1)]?.palette[key] ?? 0xffffff;
  const b = WORLD_LIST[Math.max(0, s.worldTo - 1)]?.palette[key] ?? a;
  return lerpColor(a, b, s.worldMix);
}

const STREAMS = 72;
/** Intervalle (s d'animation) entre deux travaux de génération des textures de la Mer nébulaire. */
const PREPARE_EVERY = 0.08;

export class WorldDecor {
  private readonly nebula: NebulaDecor;
  private readonly spirals: Phaser.GameObjects.Image[];
  private readonly eye: Phaser.GameObjects.Image;
  private readonly eyeHot: Phaser.GameObjects.Image;
  private readonly streams: Phaser.GameObjects.Graphics;
  private readonly sTh = new Float32Array(STREAMS);
  private readonly sR = new Float32Array(STREAMS);
  private readonly sK = new Float32Array(STREAMS);
  private spiralRot = [0, 0];
  private visible = false;
  private prep = 0;

  /** @param depth décor (nébuleuse, spirales, courants) ; @param coreDepth noyaux (foyer de la nébuleuse, œil), au-dessus du voile de la zone de jeu */
  constructor(scene: Phaser.Scene, depth: number, coreDepth: number) {
    ensureWorldTextures(scene);
    this.nebula = new NebulaDecor(scene, depth, coreDepth);
    this.spirals = [0, 1].map((i) => scene.add.image(0, 0, WORLD_TEX.spiral).setDepth(depth + 0.02 + i * 0.005).setVisible(false).setBlendMode(Phaser.BlendModes.ADD));
    this.streams = scene.add.graphics().setDepth(depth + 0.08).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.eye = scene.add.image(0, 0, AMB_TEX.glow).setDepth(coreDepth).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.eyeHot = scene.add.image(0, 0, AMB_TEX.glow).setDepth(coreDepth + 0.001).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < STREAMS; i++) this.resetStream(i, true);
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
    this.nebula.setVisible(false);
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
    // Les textures de la Mer nébulaire sont générées une par image pendant l'univers 2 (jamais d'à-coup à l'entrée) ; en entrant directement (saut de test) : d'un coup
    if (!this.nebula.ready && s.world >= 2) {
      if (s.amt[2] > 0) this.nebula.prepare(true);
      else {
        // Un court travail toutes les 0,08 s d'animation (≈ 30 s en tout pendant La Faille) : aucun à-coup, rien pendant une pause
        this.prep += dt;
        if (this.prep >= PREPARE_EVERY) {
          this.prep = 0;
          this.nebula.prepare();
        }
      }
    }
    this.nebula.setVisible(true);
    this.nebula.draw(s, v, dt, s.amt[2]);
    this.drawWinds(s, v, dt, s.amt[3]);
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
