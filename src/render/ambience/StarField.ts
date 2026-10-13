import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { clamp01, type AmbienceView } from './view';

const MAX = AMBIENCE.quality.tiers.high.stars;
/** Trois profondeurs : taille, luminosité et réponse au battement croissantes vers l'avant. */
const LAYER_SIZE = [0.8, 1.3, 2] as const;
const LAYER_ALPHA = [0.45, 0.7, 0.95] as const;
const LAYER_BEAT = [0.15, 0.35, 0.6] as const;
const PALETTE = [AMBIENCE_COLORS.white, AMBIENCE_COLORS.ice, AMBIENCE_COLORS.cyan, AMBIENCE_COLORS.violet] as const;

/**
 * Ciel étoilé en parallaxe : trois couches qui tournent lentement autour de la faille, chacune à sa vitesse.
 * Positions tirées une fois (décoratif) ; dessin par petits carrés (aucune allocation par image).
 */
export class StarField {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly rRel = new Float32Array(MAX);
  private readonly theta = new Float32Array(MAX);
  private readonly tw = new Float32Array(MAX);
  private readonly twSpeed = new Float32Array(MAX);
  private readonly col = new Uint8Array(MAX);
  private readonly phi = new Float64Array(3);

  constructor(scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    for (let i = 0; i < MAX; i++) {
      this.rRel[i] = 0.06 + Math.sqrt(Math.random()) * 1.1;
      this.theta[i] = Math.random() * Math.PI * 2;
      this.tw[i] = Math.random() * Math.PI * 2;
      this.twSpeed[i] = 0.4 + Math.random() * 1.6;
      const c = Math.random();
      this.col[i] = c < 0.45 ? 0 : c < 0.75 ? 1 : c < 0.9 ? 2 : 3;
    }
  }

  setVisible(v: boolean): void {
    this.g.setVisible(v);
    if (!v) this.g.clear();
  }

  draw(s: AmbienceState, v: AmbienceView, dt: number): void {
    const g = this.g;
    g.clear();
    const motion = s.reduced ? AMBIENCE.reduced.motion : 1;
    const spin = AMBIENCE.motion.starSpin;
    for (let l = 0; l < 3; l++) this.phi[l] += spin[l] * s.p.starSpeed * (1 + s.drop * 0.8) * motion * dt;
    const n = Math.min(MAX, s.quality.stars);
    const base = s.p.stars;
    for (let i = 0; i < n; i++) {
      const layer = i % 3;
      const a = this.theta[i] + this.phi[layer];
      const r = this.rRel[i] * v.halfDiag;
      const x = v.cx + Math.cos(a) * r;
      const y = v.cy + Math.sin(a) * r;
      if (x < -4 || y < -4 || x > v.width + 4 || y > v.height + 4) continue;
      const twinkle = 0.65 + 0.35 * Math.sin(this.tw[i] + s.time * this.twSpeed[i] * motion);
      // Couleurs chaudes (violet) plus présentes avec le stade
      const c = this.col[i];
      const heat = c === 3 ? 0.3 + 0.7 * s.p.heat : 1;
      const alpha = clamp01(base * LAYER_ALPHA[layer] * twinkle * heat * (1 + s.beat * LAYER_BEAT[layer] + s.bass * 0.15));
      if (alpha < 0.02) continue;
      const size = LAYER_SIZE[layer] * v.dpr * (1 + s.beat * 0.25 * (layer === 2 ? 1 : 0));
      g.fillStyle(PALETTE[c], alpha);
      g.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
}
