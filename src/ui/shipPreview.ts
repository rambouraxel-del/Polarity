import { orbitLook } from '../config/orbit';
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
    /** Couleur de traînée à prévisualiser (mode orbite) ; null = vaisseau seul au centre. */
    private readonly trail: number | null = null,
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
    // Orbite : celle de la phase 1 (config/orbit.ts), jamais liée à l'apparence présentée
    const orbit = orbitLook(1);
    ctx.lineWidth = Math.max(1 * dpr, side * 0.005);
    ctx.strokeStyle = rgba(orbit.color, Math.min(1, orbit.lineAlpha + 0.15));
    ctx.shadowColor = css(orbit.color);
    ctx.shadowBlur = side * 0.025;
    ctx.beginPath();
    ctx.arc(cx, cy, side * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.save();
    if (this.trail === null) {
      // Vaisseau au centre, rotation lente
      ctx.translate(cx, cy);
      ctx.rotate(this.reduced ? 0 : time * SPIN);
      this.drawShip(ctx, sprite, side * 0.66, time, dt);
    } else {
      // Aperçu d'une traînée : le vaisseau parcourt l'orbite (immobile en animation réduite), traînée lumineuse derrière lui
      const ringR = side * 0.36;
      const theta = this.reduced ? -0.9 : time * 0.9;
      this.drawTrailArc(ctx, cx, cy, ringR, theta, side, dpr);
      const px = cx + ringR * Math.cos(theta);
      const py = cy + ringR * Math.sin(theta);
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(-Math.sin(theta), -Math.cos(theta)));
      this.drawShip(ctx, sprite, side * 0.27, time, dt);
    }
    ctx.restore();
    this.drawn = true;
  }

  /** Traînée lumineuse : segments d'orbite derrière le vaisseau, de plus en plus fins et transparents. */
  private drawTrailArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, theta: number, side: number, dpr: number): void {
    const color = this.trail ?? this.skin.colors.trail;
    const n = 26;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const k = 1 - i / n;
      const a0 = theta - i * 0.04;
      const a1 = theta - (i + 1) * 0.04;
      ctx.strokeStyle = rgba(color, 0.18 + 0.7 * k * k);
      ctx.lineWidth = Math.max(1.5 * dpr, side * 0.03 * (0.25 + 0.75 * k));
      ctx.beginPath();
      ctx.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
      ctx.lineTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Vaisseau au point courant du repère (nez vers le haut) : réacteur animé derrière, lueur discrète puis sprite. */
  private drawShip(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, shipPx: number, time: number, dt: number): void {
    const c = this.skin.colors;
    const L = (shipPx * (VISUAL.spriteContent / VISUAL.spriteCanvas)) / 2;
    const k = L / shipRadius();
    const th = FX.thruster;
    const flick = this.reduced ? 1 : 1 + th.flicker * Math.sin(time * 38) * Math.sin(time * 23 + 1);
    const len = th.length * k * flick;
    const off = shipHalfWidth() * th.spread * k;
    const w2 = th.width * 0.5 * k;
    const y0 = L * th.start;
    ctx.globalCompositeOperation = 'lighter';
    for (const x0 of [-off, off]) {
      this.flame(ctx, x0, y0, w2 * 1.5, len, rgba(c.thruster.glow, 0.13));
      this.flame(ctx, x0, y0, w2, len * 0.8, rgba(c.thruster.glow, 0.42));
      this.flame(ctx, x0, y0, w2 * 0.45, len * 0.5, rgba(c.thruster.core, 0.85));
    }
    this.updateSparks(ctx, dt, off, y0 + len * 0.6, k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = FX.shipGlow.alpha;
    ctx.globalCompositeOperation = 'lighter';
    const gp = shipPx * FX.shipGlow.grow;
    ctx.drawImage(this.tinted(sprite, c.cockpit), -gp / 2, -gp / 2, gp, gp);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sprite, -shipPx / 2, -shipPx / 2, shipPx, shipPx);
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
