import Phaser from 'phaser';
import { AMBIENCE } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { AMB_TEX } from './textures';
import { clamp01, lerpColor, type AmbienceView } from './view';

const MAX = AMBIENCE.quality.tiers.high.tunnel;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Tunnel de la phase 2 : plans de facettes brisées qui défilent vers la profondeur (échelle exponentielle), chacun avec sa rotation,
 * un sur deux en sens inverse. Un plan naît petit près du point de fuite, grandit, puis s'efface en quittant l'écran ; les plans voisins
 * se recouvrent (les facettes sombres occultent ceux du fond). Le défilement accélère avec les basses, les montées et les passages forts.
 * Les profondeurs ne sont recalculées que lorsqu'un plan boucle (pas de tri d'affichage à chaque image). Décoratif uniquement.
 */
export class Tunnel {
  private readonly layers: Phaser.GameObjects.Image[] = [];
  private readonly angle = new Float64Array(MAX);
  private readonly dir = new Float32Array(MAX);
  private readonly spinMul = new Float32Array(MAX);
  private readonly lastT = new Float32Array(MAX);
  private base = 0;
  private count = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    for (let i = 0; i < MAX; i++) {
      this.layers.push(scene.add.image(0, 0, AMB_TEX.tunnel[i % AMB_TEX.tunnel.length]).setDepth(depth + i * 0.001).setVisible(false));
      this.angle[i] = Math.random() * Math.PI * 2;
      this.dir[i] = i % 2 === 0 ? 1 : -1;
      this.spinMul[i] = 0.6 + ((i * 37) % 7) / 7;
    }
  }

  setVisible(v: boolean): void {
    if (!v) for (const l of this.layers) l.setVisible(false);
  }

  /** Plans du fond d'abord : profondeur croissante avec la progression (appelé seulement quand un plan boucle ou que leur nombre change). */
  private sortDepths(): void {
    const order = Array.from({ length: this.count }, (_, i) => i).sort((a, b) => this.lastT[a] - this.lastT[b]);
    order.forEach((idx, rank) => this.layers[idx].setDepth(this.depth + rank * 0.01));
  }

  /** @param amount visibilité du tunnel (0–1) : fondu pendant la traversée */
  /** @param tint couleur de l'univers de destination (voyage des univers) ; @param tintMix part de cette teinte (0 = couleurs d'origine) */
  draw(s: AmbienceState, v: AmbienceView, dt: number, amount: number, tint = 0, tintMix = 0): void {
    const n = Math.min(MAX, s.quality.tunnel);
    if (amount <= 0.004 || s.user <= 0) {
      for (const l of this.layers) l.setVisible(false);
      return;
    }
    const cfg = AMBIENCE.tunnel;
    const motion = s.reduced ? AMBIENCE.reduced.motion : 1;
    const m = cfg.music;
    const w2 = s.world === 2 ? s.amt[1] : 0;
    const boost = (1 + m.bass * s.bass + m.build * s.build + m.drop * s.drop + m.intensity * s.intensity + 0.5 * s.instab * w2) * (1 - 0.6 * s.calm * w2);
    this.base = (this.base + cfg.speed * boost * motion * dt) % 1;
    let resort = n !== this.count;
    this.count = n;
    const ratio = cfg.scaleMax / cfg.scaleMin;
    const pulse = 0.84 + 0.16 * Math.min(1, s.beat + 0.4 * s.bass + 0.5 * s.drop);
    const warm = clamp01(s.p.heat * 0.5 + s.drop * 0.3 + s.build * 0.2);
    const aMax = cfg.alphaMax * amount * s.user;
    for (let i = 0; i < MAX; i++) {
      const img = this.layers[i];
      if (i >= n) {
        img.setVisible(false);
        continue;
      }
      const t = (this.base + i / n) % 1;
      if (t < this.lastT[i]) resort = true;
      this.lastT[i] = t;
      const fadeIn = smooth(t / cfg.fadeIn);
      const fadeOut = 1 - smooth((t - cfg.fadeOut) / (1 - cfg.fadeOut));
      const alpha = aMax * fadeIn * fadeOut * pulse * (0.78 + 0.22 * Math.sqrt(t));
      if (alpha < 0.01) {
        img.setVisible(false);
        continue;
      }
      this.angle[i] += this.dir[i] * cfg.spin * this.spinMul[i] * (1 + 0.8 * s.bass + 0.8 * s.drop) * motion * dt;
      const k = cfg.scaleMin * Math.pow(ratio, t);
      const size = 2 * k * v.halfDiag;
      // Point de fuite : très légère dérive, plus marquée pour les plans lointains (perspective)
      const sway = cfg.sway * v.scale * (1 - t) * Math.sin(s.time * 0.17 + i * 0.9);
      const swayY = cfg.sway * v.scale * (1 - t) * Math.cos(s.time * 0.13 + i * 1.3);
      img
        .setVisible(true)
        .setPosition(v.cx + sway, v.cy + swayY)
        .setDisplaySize(size, size)
        .setRotation(this.angle[i] + this.dir[i] * 0.4 * t)
        .setAlpha(Math.min(1, alpha))
        .setTint(lerpColor(lerpColor(lerpColor(0x8fa6ff, 0xffffff, t), 0xd0c0ff, warm), tint, tintMix * (1 - 0.5 * t)));
    }
    if (resort) this.sortDepths();
  }
}
