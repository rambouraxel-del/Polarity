import ast1 from '../assets/sprites/ast1.png';
import ast2 from '../assets/sprites/ast2.png';
import ast3 from '../assets/sprites/ast3.png';
import ast4 from '../assets/sprites/ast4.png';
import { Rng } from '../core/rng';
import { hexRgbTriplet, THEME } from './theme';

/**
 * Fond spatial des menus, dessiné par le code (canvas 2D) : dégradé bleu nuit, nébuleuse et planète lointaine très
 * discrètes, étoiles qui scintillent doucement, quelques astéroïdes qui dérivent lentement (sprites existants).
 *
 * - Affiché dans les menus seulement : pendant une partie le décor reste sobre (l'arène n'est pas modifiée).
 * - Coût maîtrisé : calques fixes pré-dessinés, dessin limité à 30 images/s, résolution plafonnée à ×1,5, arrêt quand masqué.
 * - Effets réduits (option ou préférence système) : image fixe, sans scintillement ni dérive.
 * Les positions viennent d'un générateur à graine fixe : le décor est identique à chaque lancement.
 */
interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  rgb: string;
  alpha: number;
}

interface Drifter {
  img: HTMLImageElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
}

const FRAME_INTERVAL = 1 / 30;

export class SpaceBackground {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly layer = document.createElement('canvas');
  private stars: Star[] = [];
  private drifters: Drifter[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private time = 0;
  private acc = 0;
  private visible = false;
  private reduced = false;
  private dirty = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    canvas.classList.add('hidden');
    const urls = [ast1, ast2, ast3, ast4];
    const rng = new Rng(20261012);
    for (let i = 0; i < 4; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => (this.dirty = true);
      img.src = urls[i];
      this.drifters.push({
        img,
        x: rng.range(0.05, 0.95),
        y: rng.range(0.1, 0.9),
        vx: rng.range(-0.012, 0.012),
        vy: rng.range(-0.008, 0.008),
        rot: rng.range(0, Math.PI * 2),
        vr: rng.range(-0.12, 0.12),
        size: rng.range(26, 46),
      });
    }
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    this.dirty = true;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.canvas.classList.toggle('hidden', !visible);
    this.dirty = true;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = Math.min(dpr, 1.5);
    this.w = Math.max(1, Math.round(cssW * this.dpr));
    this.h = Math.max(1, Math.round(cssH * this.dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.layer.width = this.w;
    this.layer.height = this.h;
    this.buildStars();
    this.drawLayer();
    this.dirty = true;
  }

  private buildStars(): void {
    const rng = new Rng(7731);
    const count = Math.round(Math.min(170, Math.max(70, (this.w * this.h) / (9000 * this.dpr * this.dpr))));
    const gold = hexRgbTriplet(THEME.color.gold).split(' ').join(',');
    const cyan = hexRgbTriplet(THEME.color.cyan).split(' ').join(',');
    this.stars = [];
    for (let i = 0; i < count; i++) {
      const k = rng.next();
      this.stars.push({
        x: rng.next() * this.w,
        y: rng.next() * this.h,
        r: (0.5 + rng.next() * 1.0) * this.dpr * (k > 0.93 ? 1.4 : 1),
        phase: rng.next() * Math.PI * 2,
        speed: 0.4 + rng.next() * 1.1,
        rgb: k > 0.97 ? gold : k > 0.9 ? cyan : '220,235,255',
        alpha: 0.35 + rng.next() * 0.5,
      });
    }
  }

  /** Calque fixe : dégradé, nébuleuse, planète lointaine. */
  private drawLayer(): void {
    const g = this.layer.getContext('2d');
    if (!g) return;
    const { w, h } = this;
    const c = THEME.color;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, c.nightDeep);
    grad.addColorStop(0.55, c.night);
    grad.addColorStop(1, c.bgDeep);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const nebula = hexRgbTriplet(c.nebula).split(' ').join(',');
    const cyan = hexRgbTriplet(c.cyan).split(' ').join(',');
    const glow = (x: number, y: number, r: number, rgb: string, a: number): void => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${rgb},${a})`);
      rg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    };
    glow(w * 0.18, h * 0.22, Math.max(w, h) * 0.55, nebula, 0.16);
    glow(w * 0.85, h * 0.62, Math.max(w, h) * 0.5, cyan, 0.06);
    // Planète lointaine, en bas à gauche : disque sombre bleuté et fin liseré d'atmosphère
    const pr = Math.min(w, h) * 0.62;
    const px = -pr * 0.18;
    const py = h + pr * 0.42;
    const planet = hexRgbTriplet(c.planet).split(' ').join(',');
    const pg = g.createRadialGradient(px + pr * 0.35, py - pr * 0.45, pr * 0.1, px, py, pr);
    pg.addColorStop(0, `rgba(${planet},0.55)`);
    pg.addColorStop(0.75, `rgba(${planet},0.18)`);
    pg.addColorStop(1, `rgba(${planet},0.04)`);
    g.fillStyle = pg;
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(${cyan},0.22)`;
    g.lineWidth = Math.max(1, this.dpr * 1.2);
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.stroke();
  }

  /** À appeler à chaque image de l'application (dt en secondes). */
  update(dt: number): void {
    if (!this.visible || !this.ctx || this.w === 0) return;
    if (this.reduced) {
      // Image fixe : redessinée seulement si nécessaire
      if (this.dirty) this.draw(0);
      return;
    }
    this.time += dt;
    this.acc += dt;
    if (this.acc < FRAME_INTERVAL && !this.dirty) return;
    this.acc = 0;
    this.draw(this.time);
  }

  private draw(t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.dirty = false;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.layer, 0, 0);
    for (const s of this.stars) {
      const twinkle = this.reduced ? 1 : 0.65 + 0.35 * Math.sin(t * s.speed + s.phase);
      ctx.fillStyle = `rgba(${s.rgb},${(s.alpha * twinkle).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Astéroïdes lointains : très transparents, dérive lente (immobiles en effets réduits)
    for (const d of this.drifters) {
      if (!d.img.complete || d.img.naturalWidth === 0) continue;
      const k = this.reduced ? 0 : t;
      const x = (((d.x + d.vx * k) % 1) + 1) % 1;
      const y = (((d.y + d.vy * k) % 1) + 1) % 1;
      const size = d.size * this.dpr;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.translate(x * this.w, y * this.h);
      ctx.rotate(d.rot + d.vr * k);
      ctx.drawImage(d.img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
