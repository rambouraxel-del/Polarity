import { FX, shipHalfWidth, shipRadius, VISUAL } from '../config/visuals';
import type { Skin } from '../progression/skins';
import { skinCanvas } from '../render/skinSprites';

/**
 * Grand aperçu du vaisseau des menus (canvas 2D) : rotation lente, réacteur animé par code, mêmes proportions de flamme que dans l'arène.
 * Animation réduite (option « Effets réduits » ou préférence du système) : vaisseau fixe, flamme stable.
 * Purement décoratif (Math.random) ; la boucle s'arrête d'elle-même quand le canvas quitte la page.
 */
const SPIN = 0.42; // rad/s : un tour en ≈ 15 s
const MAX_SPARKS = 18;

interface Spark {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  white: boolean;
}

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;

export class ShipPreview {
  private raf = 0;
  private last = 0;
  private readonly sparks: Spark[] = [];
  private drawn = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly skin: Skin,
    private readonly reduced: boolean,
  ) {}

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.canvas.isConnected) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(now / 1000, dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private draw(time: number, dt: number): void {
    const cv = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr));
    const h = Math.max(1, Math.round(cv.clientHeight * dpr));
    // Animation réduite : image fixe, redessinée seulement si la taille change
    const same = cv.width === w && cv.height === h;
    if (this.reduced && this.drawn && same) return;
    if (!same) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext('2d');
    const sprite = skinCanvas(this.skin.id);
    if (!ctx || !sprite) return;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const side = Math.min(w, h);
    const c = this.skin.colors;

    // Halo et anneau d'orbite décoratif
    const halo = ctx.createRadialGradient(cx, cy, side * 0.05, cx, cy, side * 0.5);
    halo.addColorStop(0, rgba(c.cockpit, 0.22));
    halo.addColorStop(1, rgba(c.cockpit, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = Math.max(1.5 * dpr, side * 0.008);
    ctx.strokeStyle = rgba(c.orbit, 0.85);
    ctx.shadowColor = css(c.orbit);
    ctx.shadowBlur = side * 0.04;
    ctx.beginPath();
    ctx.arc(cx, cy, side * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Vaisseau : même proportions que dans l'arène (demi-longueur L, flamme et tuyères relatives à L)
    const shipPx = side * 0.66;
    const L = (shipPx * (VISUAL.spriteContent / VISUAL.spriteCanvas)) / 2;
    const k = L / shipRadius();
    const angle = this.reduced ? 0 : time * SPIN;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Réacteur (derrière : vers le bas du sprite), en additif
    const th = FX.thruster;
    const flick = this.reduced ? 1 : 1 + th.flicker * Math.sin(time * 38) * Math.sin(time * 23 + 1);
    const len = th.length * k * flick;
    const off = shipHalfWidth() * 0.3 * k;
    const w2 = th.width * 0.5 * k;
    const y0 = L * 0.72;
    ctx.globalCompositeOperation = 'lighter';
    for (const x0 of [-off, off]) {
      this.flame(ctx, x0, y0, w2 * 1.5, len, rgba(c.thruster.glow, 0.13));
      this.flame(ctx, x0, y0, w2, len * 0.8, rgba(c.thruster.glow, 0.42));
      this.flame(ctx, x0, y0, w2 * 0.45, len * 0.5, rgba(c.thruster.core, 0.85));
    }
    this.updateSparks(ctx, dt, off, y0 + len * 0.6, k);
    ctx.globalCompositeOperation = 'source-over';

    // Lueur discrète puis sprite
    ctx.globalAlpha = FX.shipGlow.alpha;
    ctx.globalCompositeOperation = 'lighter';
    const gp = shipPx * FX.shipGlow.grow;
    ctx.drawImage(this.tinted(sprite, c.cockpit), -gp / 2, -gp / 2, gp, gp);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sprite, -shipPx / 2, -shipPx / 2, shipPx, shipPx);
    ctx.restore();
    this.drawn = true;
  }

  private flame(ctx: CanvasRenderingContext2D, x: number, y: number, halfW: number, len: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - halfW, y);
    ctx.lineTo(x + halfW, y);
    ctx.lineTo(x, y + len);
    ctx.closePath();
    ctx.fill();
  }

  private updateSparks(ctx: CanvasRenderingContext2D, dt: number, off: number, y: number, k: number): void {
    if (this.reduced) return;
    if (this.sparks.length < MAX_SPARKS && Math.random() < dt * FX.thrusterSparks.rate) {
      this.sparks.push({ x: (Math.random() < 0.5 ? -off : off) + (Math.random() - 0.5) * 3 * k, y, vy: FX.thrusterSparks.speed * k * (0.6 + Math.random()), life: 0, max: FX.thrusterSparks.life * (0.6 + 0.4 * Math.random()), white: Math.random() < 0.33 });
    }
    const glow = this.skin.colors.thruster.glow;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      if (s.life >= s.max) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.y += s.vy * dt;
      ctx.fillStyle = rgba(s.white ? 0xffffff : glow, 1 - s.life / s.max);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.9 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Silhouette teintée d'une couleur (lueur) : mise en cache par apparence. */
  private tinted(sprite: HTMLCanvasElement, color: number): HTMLCanvasElement {
    const key = `${this.skin.id}:${color}`;
    let c = tintCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = sprite.width;
      c.height = sprite.height;
      const t = c.getContext('2d')!;
      t.drawImage(sprite, 0, 0);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = css(color);
      t.fillRect(0, 0, c.width, c.height);
      tintCache.set(key, c);
    }
    return c;
  }
}

const tintCache = new Map<string, HTMLCanvasElement>();
