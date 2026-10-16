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
  private flow = false;

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
    this.r[i] = this.flow ? (anywhere ? 30 + Math.random() * (this.farR - 30) : 30 + Math.random() * 120) : anywhere ? min + Math.random() * (this.farR - min) : this.farR * (0.8 + Math.random() * 0.25);
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

    // Poussières : densité continue (fondu par indice). Phase 1 : spirale vers la faille, aspirée de plus en plus fort (traversée comprise).
    // Phase 2 : étincelles entraînées vers l'avant par les courants du tunnel (traînées qui s'allongent avec la vitesse).
    const count = s.quality.dust * s.p.dust;
    const n = Math.min(MAX_DUST, Math.ceil(count));
    const gp = s.transit > 0 ? Math.min(1, s.transit / AMBIENCE.transit.engulfBy) : 0;
    const infall = m.dustInfall * (1 + s.intensity + s.build + s.drop * 3 + 2.2 * s.core + AMBIENCE.transit.pull * 14 * gp * gp);
    const bright = 0.35 * (0.6 + 0.9 * s.beat + 0.4 * s.build + 0.5 * s.drop) * (1 + 2.2 * gp);
    const flow = s.look > 0.5;
    if (flow !== this.flow) {
      this.flow = flow;
      for (let i = 0; i < MAX_DUST; i++) this.spawn(i, true);
    }
    const out = AMBIENCE.phase2.flow * (1 + 1.1 * s.bass + 1.6 * s.drop + 0.6 * s.build);
    const user = s.user;
    for (let i = 0; i < n; i++) {
      const r = this.r[i];
      this.a[i] += m.dustSwirl * (1 + s.bass + 2 * gp) * Math.sqrt(300 / Math.max(60, r)) * this.sp[i] * motion;
      if (flow) {
        this.r[i] += (14 + r * out) * this.sp[i] * motion;
        if (this.r[i] > this.farR * 1.02) this.spawn(i, false);
      } else {
        this.r[i] -= infall * this.sp[i] * motion;
        if (this.r[i] < 40) this.spawn(i, false);
      }
      const rr = this.r[i];
      const x = v.cx + Math.cos(this.a[i]) * rr * v.scale;
      const y = v.cy + Math.sin(this.a[i]) * rr * v.scale;
      let alpha = bright * clamp01(count - i);
      if (flow) alpha *= Math.min(1, rr / 160) * (1 - clamp01((rr / this.farR - 0.85) / 0.2)) * user;
      if (alpha < 0.02) continue;
      const sz = this.size[i] * v.dpr;
      g.fillStyle(DUST_COLORS[this.col[i]], clamp01(alpha));
      if (flow && motion > 0) {
        // Traînée : triangle étiré à l'opposé du déplacement (vers le point de fuite)
        const len = Math.min(70 * v.dpr, sz * 2 + (rr / this.farR) * (10 + 90 * out) * v.dpr);
        const ux = Math.cos(this.a[i]);
        const uy = Math.sin(this.a[i]);
        g.fillTriangle(x + ux * sz, y + uy * sz, x - ux * len - uy * sz * 0.5, y - uy * len + ux * sz * 0.5, x - ux * len + uy * sz * 0.5, y - uy * len - ux * sz * 0.5);
      } else if (gp > 0.08 && motion > 0) {
        // Aspiration : traînée vers l'extérieur, en arrière de la spirale
        const len = Math.min(90 * v.dpr, sz * 2 + 60 * gp * v.dpr);
        const ux = Math.cos(this.a[i]);
        const uy = Math.sin(this.a[i]);
        const tx = ux + 0.6 * uy;
        const ty = uy - 0.6 * ux;
        g.fillTriangle(x, y, x + tx * len - uy * sz * 0.5, y + ty * len + ux * sz * 0.5, x + tx * len + uy * sz * 0.5, y + ty * len - ux * sz * 0.5);
      } else {
        g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
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
      const r = (minR + this.dR[i] * Math.max(0, this.farR - minR)) * (1 - 0.94 * gp * gp);
      const x = v.cx + Math.cos(this.dA[i]) * r * v.scale;
      const y = v.cy + Math.sin(this.dA[i]) * r * v.scale;
      const px = this.dSize[i] * 2 * v.scale;
      img.setPosition(x, y).setRotation(this.dRot[i]).setDisplaySize(px, px);
      img.setAlpha(w * (far ? 0.22 : 0.32) * (1 + 0.3 * s.drop));
      img.setVisible(true);
    }
  }
}
