import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { clamp01, type AmbienceView } from './view';

const MAX_DUST = AMBIENCE.quality.tiers.high.dust;
const MAX_DEBRIS = AMBIENCE.quality.tiers.high.debris;
const DUST_COLORS = [AMBIENCE_COLORS.ice, AMBIENCE_COLORS.cyan, AMBIENCE_COLORS.violet] as const;

/**
 * Poussières cosmiques (pool fixe, tableaux typés) qui spiralent lentement vers la faille, et débris décoratifs
 * (pool d'images) à plusieurs profondeurs, toujours HORS de la zone de jeu, sombres et petits : jamais confondus
 * avec les astéroïdes dangereux (orange, lumineux). La densité varie en continu (fondu par particule) : rien n'apparaît d'un coup.
 */
export class Particles {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly r = new Float32Array(MAX_DUST);
  private readonly a = new Float32Array(MAX_DUST);
  private readonly sp = new Float32Array(MAX_DUST);
  private readonly size = new Float32Array(MAX_DUST);
  private readonly col = new Uint8Array(MAX_DUST);
  private readonly debris: Phaser.GameObjects.Image[] = [];
  private readonly dR = new Float32Array(MAX_DEBRIS);
  private readonly dA = new Float32Array(MAX_DEBRIS);
  private readonly dRot = new Float32Array(MAX_DEBRIS);
  private readonly dSize = new Float32Array(MAX_DEBRIS);
  private farR = 900;

  constructor(scene: Phaser.Scene, depthDebris: number, depthDust: number, debrisTextures: readonly string[]) {
    this.g = scene.add.graphics().setDepth(depthDust).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    for (let i = 0; i < MAX_DUST; i++) this.spawn(i, true);
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const img = scene.add.image(0, 0, debrisTextures[i % debrisTextures.length]).setDepth(depthDebris).setVisible(false).setTint(AMBIENCE_COLORS.debris);
      this.debris.push(img);
      this.dA[i] = Math.random() * Math.PI * 2;
      this.dRot[i] = Math.random() * Math.PI * 2;
      // Deux profondeurs : lointains (petits, sombres) et proches
      this.dSize[i] = i % 2 === 0 ? 3 + Math.random() * 2 : 5 + Math.random() * 3;
      this.dR[i] = Math.random();
    }
  }

  private spawn(i: number, anywhere: boolean): void {
    const min = 60;
    this.r[i] = anywhere ? min + Math.random() * (this.farR - min) : this.farR * (0.8 + Math.random() * 0.25);
    this.a[i] = Math.random() * Math.PI * 2;
    this.sp[i] = 0.5 + Math.random();
    this.size[i] = 0.8 + Math.random() * 1.4;
    this.col[i] = Math.floor(Math.random() * DUST_COLORS.length);
  }

  setVisible(v: boolean): void {
    this.g.setVisible(v);
    if (!v) {
      this.g.clear();
      for (const d of this.debris) d.setVisible(false);
    }
  }

  draw(s: AmbienceState, v: AmbienceView, dt: number): void {
    this.farR = v.halfDiag / v.scale;
    const motion = (s.reduced ? AMBIENCE.reduced.motion : 1) * dt;
    const m = AMBIENCE.motion;
    const g = this.g;
    g.clear();

    // Poussières : densité continue (fondu par indice), spirale vers la faille, éclat sur les battements
    const count = s.quality.dust * s.p.dust;
    const n = Math.min(MAX_DUST, Math.ceil(count));
    const infall = m.dustInfall * (1 + s.intensity + s.build + s.drop * 3);
    const bright = 0.35 * (0.6 + 0.9 * s.beat + 0.4 * s.build + 0.5 * s.drop);
    for (let i = 0; i < n; i++) {
      const r = this.r[i];
      this.a[i] += m.dustSwirl * (1 + s.bass) * Math.sqrt(300 / Math.max(60, r)) * this.sp[i] * motion;
      this.r[i] -= infall * this.sp[i] * motion;
      if (this.r[i] < 40) this.spawn(i, false);
      const x = v.cx + Math.cos(this.a[i]) * this.r[i] * v.scale;
      const y = v.cy + Math.sin(this.a[i]) * this.r[i] * v.scale;
      if (x < 0 || y < 0 || x > v.width || y > v.height) continue;
      const alpha = clamp01(bright * clamp01(count - i));
      if (alpha < 0.02) continue;
      const sz = this.size[i] * v.dpr;
      g.fillStyle(DUST_COLORS[this.col[i]], alpha);
      g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }

    // Débris : hors de la zone de jeu (au-delà du voile), en orbite lente
    const dCount = s.quality.debris * s.p.debris;
    const minR = AMBIENCE.shape.veilRadius + 30;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const img = this.debris[i];
      const w = clamp01(dCount - i);
      if (w <= 0) {
        img.setVisible(false);
        continue;
      }
      const far = i % 2 === 0;
      this.dA[i] += m.debrisSpin[far ? 0 : 1] * motion * (1 + s.drop);
      this.dRot[i] += (far ? 0.1 : 0.2) * motion;
      const r = minR + this.dR[i] * Math.max(0, this.farR - minR);
      const x = v.cx + Math.cos(this.dA[i]) * r * v.scale;
      const y = v.cy + Math.sin(this.dA[i]) * r * v.scale;
      const px = this.dSize[i] * 2 * v.scale;
      img.setPosition(x, y).setRotation(this.dRot[i]).setDisplaySize(px, px);
      img.setAlpha(w * (far ? 0.22 : 0.32) * (1 + 0.3 * s.drop));
      img.setVisible(true);
    }
  }
}
