import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { clamp01, lerpColor, type AmbienceView } from './view';

const MAX = AMBIENCE.quality.tiers.high.ribbons;
const PTS = AMBIENCE.ribbons.points;
const COLORS = [AMBIENCE_COLORS.azure, AMBIENCE_COLORS.violet, AMBIENCE_COLORS.ice, AMBIENCE_COLORS.cyan] as const;

interface Ribbon {
  phi: number;
  sweep: number;
  omega: number;
  baseR: number;
  amp: number;
  freq: number;
  speed: number;
  ph: number;
  width: number;
  color: number;
}

/**
 * Grands rubans d'énergie qui ondulent autour de l'arène : bande à largeur variable qui suit un arc, dont le rayon ondule et qui dérive lentement
 * autour du centre. Phase 1 : deux ou trois courants à peine visibles ; phase 2 : tout le jeu de rubans, plus larges et plus vifs, qui gonflent sur
 * les battements. Toujours au-delà de l'orbite (rayon minimal `ribbons.minRadius`), dessinés en additif derrière le voile. Décoratif : `Math.random`.
 */
export class Ribbons {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly rb: Ribbon[] = [];
  private readonly lx = new Float32Array(PTS);
  private readonly ly = new Float32Array(PTS);
  private readonly rx = new Float32Array(PTS);
  private readonly ry = new Float32Array(PTS);
  private time = 0;

  constructor(scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    const cfg = AMBIENCE.ribbons;
    for (let i = 0; i < MAX; i++) {
      const r = (): number => Math.random();
      this.rb.push({
        phi: (i / MAX) * Math.PI * 2 + r() * 0.8,
        sweep: 1.4 + r() * 1.5,
        omega: (0.012 + r() * 0.03) * (i % 2 === 0 ? 1 : -1),
        baseR: cfg.minRadius + 40 + r() * 330 + (i % 3) * 90,
        amp: 40 + r() * 90,
        freq: 1.2 + r() * 1.6,
        speed: 0.25 + r() * 0.5,
        ph: r() * Math.PI * 2,
        width: cfg.width * (0.55 + 0.45 * r()),
        color: COLORS[i % COLORS.length],
      });
    }
  }

  setVisible(v: boolean): void {
    this.g.setVisible(v);
    if (!v) this.g.clear();
  }

  /**
   * @param amount présence des rubans (0–1) : faibles en phase 1, pleins en phase 2
   * @param pull aspiration de la traversée (0–1) : les rubans s'enroulent en spirale vers la faille
   */
  draw(s: AmbienceState, v: AmbienceView, dt: number, amount: number, pull = 0): void {
    const g = this.g;
    g.clear();
    if (amount <= 0.01 || s.user <= 0) return;
    const cfg = AMBIENCE.ribbons;
    const motion = s.reduced ? AMBIENCE.reduced.motion : 1;
    this.time += dt * motion * (1 + 0.5 * s.bass + 0.8 * s.drop + 0.3 * s.build);
    const t = this.time;
    // Nombre de rubans : deux en phase 1, tout le jeu (selon la qualité) en phase 2
    const n = Math.min(MAX, s.quality.ribbons, Math.max(4, Math.round(4 + (MAX - 4) * s.look)));
    const far = v.halfDiag / v.scale;
    const swell = 1 + 0.45 * s.beat + 0.35 * s.bass + 0.5 * s.drop;
    const bright = amount * s.user * (0.55 + 0.7 * Math.min(1, s.beat + 0.5 * s.bass + 0.5 * s.build + 0.7 * s.drop));
    const heat = clamp01(s.p.heat);
    for (let i = 0; i < n; i++) {
      const b = this.rb[i];
      const a0 = b.phi + b.omega * t + 3.4 * pull * (1 + 0.3 * i);
      const rMax = far * 0.95;
      for (let k = 0; k < PTS; k++) {
        const u = k / (PTS - 1);
        const ang = a0 + u * b.sweep + 0.12 * Math.sin(t * 0.21 + i);
        const rad = (1 - 0.88 * pull) * Math.min(rMax, b.baseR + b.amp * Math.sin(b.freq * u * Math.PI * 2 + t * b.speed + b.ph) + 20 * Math.sin(t * 0.4 + k * 0.5 + i));
        const w = b.width * swell * Math.pow(Math.sin(Math.PI * u), 0.9) * (0.75 + 0.25 * Math.sin(t * 0.9 + k * 0.6 + i * 2)) * (0.45 + 0.55 * s.look) * (1 + 0.6 * pull);
        const cx = Math.cos(ang);
        const cy = Math.sin(ang);
        this.lx[k] = v.cx + cx * Math.max(cfg.minRadius * 0.7 * (1 - 0.9 * pull), rad - w) * v.scale;
        this.ly[k] = v.cy + cy * Math.max(cfg.minRadius * 0.7 * (1 - 0.9 * pull), rad - w) * v.scale;
        this.rx[k] = v.cx + cx * (rad + w) * v.scale;
        this.ry[k] = v.cy + cy * (rad + w) * v.scale;
      }
      const col = i % 3 === 1 ? lerpColor(b.color, AMBIENCE_COLORS.violet, heat * 0.6) : b.color;
      const a = Math.min(cfg.alphaMax, cfg.alphaMax * bright);
      // Surface en dégradé : trois bandes emboîtées de plus en plus étroites et vives (cœur lumineux, bords diffus)
      for (let f = 0; f < 3; f++) {
        const k = f === 0 ? 1 : f === 1 ? 0.62 : 0.3;
        g.fillStyle(f === 2 ? lerpColor(col, AMBIENCE_COLORS.ice, 0.45) : col, a * (f === 0 ? 0.3 : f === 1 ? 0.4 : 0.5));
        g.beginPath();
        for (let q = 0; q < PTS; q++) {
          const mx = (this.lx[q] + this.rx[q]) / 2;
          const my = (this.ly[q] + this.ry[q]) / 2;
          const x = mx + (this.lx[q] - mx) * k;
          const y = my + (this.ly[q] - my) * k;
          if (q === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        for (let q = PTS - 1; q >= 0; q--) {
          const mx = (this.lx[q] + this.rx[q]) / 2;
          const my = (this.ly[q] + this.ry[q]) / 2;
          g.lineTo(mx + (this.rx[q] - mx) * k, my + (this.ry[q] - my) * k);
        }
        g.closePath();
        g.fillPath();
      }
      // Impulsion d'énergie qui circule le long du ruban (mouvement entre les battements, plus vif sur la musique)
      const u0 = (t * (0.1 + 0.03 * i) + i * 0.37) % 1;
      const k0 = Math.max(0, Math.floor((u0 - 0.1) * (PTS - 1)));
      const k1 = Math.min(PTS - 1, Math.ceil((u0 + 0.1) * (PTS - 1)));
      if (k1 - k0 >= 2) {
        g.fillStyle(AMBIENCE_COLORS.ice, Math.min(0.7, a * (0.9 + 1.6 * s.beat + 0.8 * s.drop)));
        g.beginPath();
        for (let q = k0; q <= k1; q++) {
          const mx = (this.lx[q] + this.rx[q]) / 2;
          const my = (this.ly[q] + this.ry[q]) / 2;
          const x = mx + (this.lx[q] - mx) * 0.45;
          const y = my + (this.ly[q] - my) * 0.45;
          if (q === k0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        for (let q = k1; q >= k0; q--) {
          const mx = (this.lx[q] + this.rx[q]) / 2;
          const my = (this.ly[q] + this.ry[q]) / 2;
          g.lineTo(mx + (this.rx[q] - mx) * 0.45, my + (this.ry[q] - my) * 0.45);
        }
        g.closePath();
        g.fillPath();
      }
      // Arêtes fines
      g.lineStyle(1.4 * v.dpr, AMBIENCE_COLORS.ice, a * (0.15 + 0.65 * s.look));
      this.line(this.lx, this.ly);
      this.line(this.rx, this.ry);
    }
  }

  private line(xs: Float32Array, ys: Float32Array): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(xs[0], ys[0]);
    for (let k = 1; k < PTS; k++) g.lineTo(xs[k], ys[k]);
    g.strokePath();
  }
}
