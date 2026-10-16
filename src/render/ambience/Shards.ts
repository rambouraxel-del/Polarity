import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { AMB_TEX } from './textures';
import { clamp01, lerpColor, type AmbienceView } from './view';

const MAX = AMBIENCE.quality.tiers.high.shards;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Fragments flottants (pool d'images réutilisées, tableaux typés).
 * - Phase 1 : débris sombres aux arêtes bleutées, aspirés en spirale vers la faille de plus en plus vite (ils disparaissent sous son cœur sombre) ;
 *   rares tant que le noyau est une petite sphère, nombreux quand la faille s'ouvre. Pendant la traversée tout est avalé.
 * - Phase 2 : fragments entraînés par les courants du tunnel, qui naissent près du point de fuite et grossissent en passant vers l'avant.
 * Toujours bleu nuit / indigo (jamais l'orange des astéroïdes dangereux) ; ils s'effacent près de l'orbite pour garder l'arène lisible.
 */
export class Shards {
  private readonly img: Phaser.GameObjects.Image[] = [];
  private readonly r = new Float32Array(MAX);
  private readonly a = new Float32Array(MAX);
  private readonly rot = new Float32Array(MAX);
  private readonly spin = new Float32Array(MAX);
  private readonly sp = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly warm = new Float32Array(MAX);
  private mode: 1 | 2 = 1;

  constructor(scene: Phaser.Scene, depth: number) {
    for (let i = 0; i < MAX; i++) {
      this.img.push(scene.add.image(0, 0, AMB_TEX.shards[i % AMB_TEX.shards.length]).setDepth(depth).setVisible(false));
      this.respawn(i, true, 900);
    }
  }

  private respawn(i: number, anywhere: boolean, far: number): void {
    this.a[i] = Math.random() * Math.PI * 2;
    this.r[i] = this.mode === 1 ? (anywhere ? 120 + Math.random() * (far - 120) : far * (0.85 + Math.random() * 0.2)) : anywhere ? 40 + Math.random() * far * 0.9 : 30 + Math.random() * 110;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 1.6;
    this.sp[i] = 0.6 + Math.random() * 0.8;
    this.size[i] = AMBIENCE.shards.sizeMin + Math.random() * (AMBIENCE.shards.sizeMax - AMBIENCE.shards.sizeMin);
    this.warm[i] = Math.random();
  }

  setVisible(v: boolean): void {
    if (!v) for (const i of this.img) i.setVisible(false);
  }

  draw(s: AmbienceState, v: AmbienceView, dt: number, holeRadius: number): void {
    const cfg = AMBIENCE.shards;
    const motion = (s.reduced ? AMBIENCE.reduced.motion : 1) * dt;
    const far = v.halfDiag / v.scale;
    const mode: 1 | 2 = s.look > 0.5 ? 2 : 1;
    if (mode !== this.mode) {
      this.mode = mode;
      for (let i = 0; i < MAX; i++) this.respawn(i, true, far);
    }
    const g = s.transit > 0 ? smooth(s.transit / AMBIENCE.transit.engulfBy) : 0;
    // Nombre de fragments : peu avant l'ouverture de la faille, tous en phase 2
    const target = mode === 2 ? s.quality.shards : Math.min(s.quality.shards, 2 + s.quality.shards * (0.7 * s.core + 0.3 * g));
    const user = s.user;
    const pull = 1 + 4 * s.core * s.core + 3 * s.drop + 2 * s.bass + AMBIENCE.transit.pull * 8 * g * g;
    const safe = cfg.safeRadius;
    for (let i = 0; i < MAX; i++) {
      const im = this.img[i];
      const w = clamp01(target - i);
      if (w <= 0 || user <= 0) {
        im.setVisible(false);
        continue;
      }
      let alpha: number;
      let scale = 1;
      if (mode === 1) {
        // Spirale vers la faille : plus on est près, plus on va vite et plus on tourne
        const r = this.r[i];
        const near = Math.exp(-r / 210);
        this.r[i] -= (16 + 110 * near) * pull * this.sp[i] * motion;
        this.a[i] += (0.05 + 1.4 * near) * (1 + 1.5 * s.core + 2 * g) * this.sp[i] * motion;
        if (this.r[i] < Math.max(18, holeRadius * 0.55)) {
          this.respawn(i, false, far);
          im.setVisible(false);
          continue;
        }
        // S'efface en s'approchant du cœur, rapetisse
        const k = smooth((r - holeRadius * 0.6) / (holeRadius * 0.9 + 40));
        alpha = cfg.alphaMax * k;
        scale = 0.45 + 0.55 * k;
      } else {
        // Phase 2 : naissent près du point de fuite et passent vers l'avant (croissance exponentielle du rayon)
        const rate = (0.3 + 0.45 * s.bass + 0.8 * s.drop + 0.25 * s.build) * this.sp[i];
        this.r[i] += (24 + this.r[i] * rate) * motion;
        this.a[i] += 0.05 * (1 + s.bass) * this.sp[i] * motion;
        if (this.r[i] > far * 1.05) {
          this.respawn(i, false, far);
          im.setVisible(false);
          continue;
        }
        const t = this.r[i] / far;
        alpha = cfg.alphaMax * smooth(t / 0.12) * (1 - smooth((t - 0.82) / 0.2));
        scale = 0.35 + 2.1 * t;
      }
      // Reste lisible au-dessus de l'arène : très atténué à l'intérieur et près de l'orbite
      alpha *= smooth((this.r[i] - safe * 0.55) / (safe * 0.8)) * w * user;
      if (alpha < 0.015) {
        im.setVisible(false);
        continue;
      }
      this.rot[i] += this.spin[i] * motion;
      const x = v.cx + Math.cos(this.a[i]) * this.r[i] * v.scale;
      const y = v.cy + Math.sin(this.a[i]) * this.r[i] * v.scale;
      const px = this.size[i] * 2 * scale * v.scale;
      im.setVisible(true)
        .setPosition(x, y)
        .setRotation(this.rot[i])
        .setDisplaySize(px, px)
        .setAlpha(alpha * (1 + 0.4 * s.beat))
        .setTint(lerpColor(0x6f8cff, lerpColor(AMBIENCE_COLORS.violet, AMBIENCE_COLORS.ice, 0.35), this.warm[i] * (0.3 + 0.5 * s.p.heat)));
    }
  }
}
