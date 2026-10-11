import Phaser from 'phaser';
import { ARENA, BEACONS, PLAYER, PROJECTILE } from '../config/balance';
import { TAU } from '../core/math';
import type { GameSession } from '../game/session';
import type { ProjectileHazard, SectorHazard } from '../sim/hazards';
import type { Skin } from '../progression/skins';

/** Couleurs fixes des menaces : jamais reprises par les apparences. */
export const COLORS = {
  background: 0x070b1f,
  grid: 0x16204a,
  projectile: 0xff6b6b,
  sector: 0xff3df0,
  danger: 0xffffff,
  gold: 0xffd84a,
};

const R = ARENA.orbitRadius;
const TRAIL_LEN = 24;
const MAX_PARTICLES = 160;
const MAX_POPUPS = 8;

interface Popup {
  text: Phaser.GameObjects.Text;
  life: number;
  x: number;
  y: number;
}

/**
 * Dessine l'arène avec les primitives Phaser (aucune image).
 * Les annonces sont en pointillés et contours ; les dangers actifs sont pleins et épais :
 * la forme porte l'information, pas seulement la couleur.
 */
export class ArenaRenderer {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly fx: Phaser.GameObjects.Graphics;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private cx = 0;
  private cy = 0;
  private scale = 1;
  private dpr = 1;
  private shake = 0;
  private flashAlpha = 0;
  private ringT = -1;
  private ringColor = 0xffffff;
  private readonly trail = new Float32Array(TRAIL_LEN);
  private trailCount = 0;
  private trailTimer = 0;
  // Particules décoratives (Math.random : n'influence jamais le gameplay)
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pvx = new Float32Array(MAX_PARTICLES);
  private readonly pvy = new Float32Array(MAX_PARTICLES);
  private readonly plife = new Float32Array(MAX_PARTICLES);
  private readonly pmax = new Float32Array(MAX_PARTICLES);
  private readonly pcol = new Uint32Array(MAX_PARTICLES);
  private pnext = 0;
  private readonly popups: Popup[] = [];
  private idleAngle: number = PLAYER.startAngle;
  reducedEffects = false;

  constructor(scene: Phaser.Scene) {
    // Profondeurs : fond < textes flottants < arène et menaces < effets < flash
    this.bg = scene.add.graphics().setDepth(0);
    this.g = scene.add.graphics().setDepth(2);
    this.fx = scene.add.graphics().setDepth(3);
    this.flash = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0, 0).setDepth(4);
    for (let i = 0; i < MAX_POPUPS; i++) {
      const text = scene.add
        .text(0, 0, '', { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontStyle: 'bold', color: '#ffe680' })
        .setOrigin(0.5)
        .setDepth(1)
        .setVisible(false);
      this.popups.push({ text, life: 0, x: 0, y: 0 });
    }
  }

  /** Place l'arène : centre et échelle en pixels du canvas. */
  layout(cx: number, cy: number, radiusPx: number, width: number, height: number, dpr: number): void {
    this.cx = cx;
    this.cy = cy;
    this.dpr = dpr;
    this.scale = radiusPx / ARENA.viewRadius;
    this.flash.setSize(width, height);
    for (const p of this.popups) p.text.setFontSize(Math.round(15 * dpr));
    this.drawBackground(width, height);
  }

  private drawBackground(w: number, h: number): void {
    const g = this.bg;
    g.clear();
    g.fillStyle(COLORS.background, 1);
    g.fillRect(0, 0, w, h);
    // Anneaux concentriques discrets
    g.lineStyle(1 * this.dpr, COLORS.grid, 0.8);
    for (let r = 80; r < 900; r += 110) g.strokeCircle(this.cx, this.cy, r * this.scale);
    // Rayons très légers
    g.lineStyle(1 * this.dpr, COLORS.grid, 0.35);
    const far = Math.hypot(w, h);
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      g.lineBetween(this.cx, this.cy, this.cx + Math.cos(a) * far, this.cy + Math.sin(a) * far);
    }
  }

  private ox = 0;
  private oy = 0;

  private sx(x: number): number {
    return this.cx + this.ox + x * this.scale;
  }

  private sy(y: number): number {
    return this.cy + this.oy + y * this.scale;
  }

  // ————————————————————————————————————————————— dessin principal

  draw(session: GameSession | null, skin: Skin, realDt: number, clock: number): void {
    const g = this.g;
    g.clear();
    this.fx.clear();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - realDt * 40 * this.dpr);
      this.ox = (Math.random() - 0.5) * this.shake;
      this.oy = (Math.random() - 0.5) * this.shake;
    } else {
      this.ox = 0;
      this.oy = 0;
    }

    const sim = session?.sim ?? null;
    let angle: number;
    let dir: 1 | -1;
    let t: number;
    if (sim && session) {
      const extra = session.phase === 'running' ? session.acc : 0;
      dir = sim.dir;
      angle = sim.angle + (sim.state === 'running' ? dir * PLAYER.angularSpeed * extra : 0);
      t = sim.time + extra;
    } else {
      // Menu : le vaisseau tourne tranquillement
      this.idleAngle += realDt * 0.7;
      angle = this.idleAngle;
      dir = 1;
      t = clock;
    }

    this.drawOrbit(skin);
    this.drawBeacons(sim ? sim.beacons.active : null, sim ? sim.beacons.angles : null, skin, clock);

    if (sim) {
      for (const h of sim.hazards) if (h.kind === 'sector') this.drawSector(h, t, clock);
      for (const h of sim.hazards) if (h.kind === 'projectile') this.drawProjectile(h, t, clock);
    }

    const alive = !sim || sim.state !== 'dead';
    this.updateTrail(angle, realDt);
    if (alive) {
      this.drawTrail(skin);
      this.drawShip(angle, dir, skin);
    }

    this.drawRing(realDt);
    this.updateParticles(realDt);
    this.updatePopups(realDt);
    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - realDt * 1.2);
    }
    this.flash.setFillStyle(0xffffff, this.flashAlpha);
  }

  private drawOrbit(skin: Skin): void {
    const g = this.g;
    const x = this.sx(0);
    const y = this.sy(0);
    const r = R * this.scale;
    const s = this.scale;
    g.lineStyle(16 * s, skin.orbit, 0.05);
    g.strokeCircle(x, y, r);
    g.lineStyle(7 * s, skin.orbit, 0.12);
    g.strokeCircle(x, y, r);
    g.lineStyle(Math.max(1.5 * this.dpr, 2.2 * s), skin.orbit, 0.95);
    g.strokeCircle(x, y, r);
  }

  private drawBeacons(active: readonly boolean[] | null, angles: readonly number[] | null, skin: Skin, clock: number): void {
    const g = this.g;
    const s = this.scale;
    const size = BEACONS.visualRadius * s;
    for (let i = 0; i < BEACONS.count; i++) {
      const a = angles ? angles[i] : BEACONS.offset + (i * TAU) / BEACONS.count;
      const on = active ? active[i] : true;
      const x = this.sx(R * Math.cos(a));
      const y = this.sy(R * Math.sin(a));
      if (on) {
        const pulse = this.reducedEffects ? 1 : 1 + 0.15 * Math.sin(clock * 4 + i);
        g.fillStyle(skin.beacon, 0.18);
        g.fillCircle(x, y, size * 2.1 * pulse);
        // Losange plein
        g.fillStyle(skin.beacon, 1);
        g.fillTriangle(x, y - size * 1.25, x + size, y, x - size, y);
        g.fillTriangle(x, y + size * 1.25, x + size, y, x - size, y);
      } else {
        // Balise éteinte : petit anneau creux
        g.lineStyle(Math.max(1, 1.5 * s), skin.beacon, 0.3);
        g.strokeCircle(x, y, size * 0.6);
      }
    }
  }

  private drawShip(angle: number, dir: 1 | -1, skin: Skin): void {
    const g = this.g;
    const s = this.scale;
    const c = Math.cos(angle);
    const si = Math.sin(angle);
    const px = R * c;
    const py = R * si;
    // Tangente dans le sens du mouvement et normale radiale
    const tx = -si * dir;
    const ty = c * dir;
    const v = PLAYER.visualRadius;
    const tipX = px + tx * v * 1.25;
    const tipY = py + ty * v * 1.25;
    const bx = px - tx * v * 0.75;
    const by = py - ty * v * 0.75;
    const w = v * 0.85;
    g.fillStyle(skin.ship, 0.14);
    g.fillCircle(this.sx(px), this.sy(py), v * 2.2 * s);
    g.fillStyle(skin.ship, 1);
    g.fillTriangle(
      this.sx(tipX), this.sy(tipY),
      this.sx(bx + c * w), this.sy(by + si * w),
      this.sx(bx - c * w), this.sy(by - si * w),
    );
  }

  private updateTrail(angle: number, realDt: number): void {
    this.trailTimer += realDt;
    if (this.trailTimer >= 1 / 60) {
      this.trailTimer = 0;
      for (let i = TRAIL_LEN - 1; i > 0; i--) this.trail[i] = this.trail[i - 1];
      this.trail[0] = angle;
      if (this.trailCount < TRAIL_LEN) this.trailCount++;
    }
  }

  resetTrail(): void {
    this.trailCount = 0;
  }

  private drawTrail(skin: Skin): void {
    if (this.reducedEffects || this.trailCount < 2) return;
    const g = this.g;
    const s = this.scale;
    for (let i = 1; i < this.trailCount; i++) {
      const a0 = this.trail[i - 1];
      const a1 = this.trail[i];
      const k = 1 - i / TRAIL_LEN;
      g.lineStyle(4 * s * k, skin.trail, 0.35 * k);
      g.lineBetween(this.sx(R * Math.cos(a0)), this.sy(R * Math.sin(a0)), this.sx(R * Math.cos(a1)), this.sy(R * Math.sin(a1)));
    }
  }

  private dashedLine(x0: number, y0: number, x1: number, y1: number, dash: number, gap: number): void {
    const g = this.g;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return;
    const ux = dx / len;
    const uy = dy / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.lineBetween(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e);
    }
  }

  private cross(x: number, y: number, size: number): void {
    this.g.lineBetween(x - size, y - size, x + size, y + size);
    this.g.lineBetween(x - size, y + size, x + size, y - size);
  }

  private drawProjectile(h: ProjectileHazard, t: number, clock: number): void {
    if (t < h.warnStart) return;
    const g = this.g;
    const s = this.scale;
    const L = ARENA.spawnRadius * 2;
    const len = Math.hypot(h.vx, h.vy);
    const ux = h.vx / len;
    const uy = h.vy / len;
    const ax = this.sx(h.x0);
    const ay = this.sy(h.y0);
    const bx = this.sx(h.x0 + ux * L);
    const by = this.sy(h.y0 + uy * L);
    const color = COLORS.projectile;

    if (t < h.launch) {
      // Annonce : ligne pointillée, chevrons de direction, croix aux points de passage, jauge de remplissage
      const k = (t - h.warnStart) / Math.max(0.001, h.launch - h.warnStart);
      const pulse = this.reducedEffects ? 0.85 : 0.7 + 0.2 * Math.sin(clock * 12);
      g.lineStyle(Math.max(2 * this.dpr, 3.5 * s), color, pulse);
      this.dashedLine(ax, ay, bx, by, 14 * s, 12 * s);
      // Jauge : un trait plein avance du point d'entrée vers l'orbite
      const firstAlong = ARENA.spawnRadius - Math.sqrt(Math.max(0, R * R - this.footDist2(h)));
      g.lineStyle(Math.max(2 * this.dpr, 4 * s), color, 0.9);
      g.lineBetween(ax, ay, ax + (bx - ax) * (firstAlong / L) * k, ay + (by - ay) * (firstAlong / L) * k);
      // Chevrons
      g.lineStyle(Math.max(2 * this.dpr, 3.5 * s), color, 0.9);
      const nx = -uy;
      const ny = ux;
      for (let d = 80; d < L; d += 150) {
        const cxw = h.x0 + ux * d;
        const cyw = h.y0 + uy * d;
        const c = 11;
        g.lineBetween(this.sx(cxw - ux * c + nx * c), this.sy(cyw - uy * c + ny * c), this.sx(cxw), this.sy(cyw));
        g.lineBetween(this.sx(cxw - ux * c - nx * c), this.sy(cyw - uy * c - ny * c), this.sx(cxw), this.sy(cyw));
      }
    } else {
      // Trajectoire restante, très atténuée
      g.lineStyle(Math.max(1 * this.dpr, 2 * s), color, 0.22);
      this.dashedLine(ax, ay, bx, by, 14 * s, 12 * s);
    }

    // Croix aux points où la trajectoire coupe l'orbite (tant qu'ils ne sont pas passés)
    g.lineStyle(Math.max(2.5 * this.dpr, 4 * s), color, 1);
    if (t < h.crossTime1 + 0.05) this.cross(this.sx(R * Math.cos(h.cross1)), this.sy(R * Math.sin(h.cross1)), 11 * s);
    if (t < h.crossTime2 + 0.05) this.cross(this.sx(R * Math.cos(h.cross2)), this.sy(R * Math.sin(h.cross2)), 11 * s);

    if (t >= h.launch) {
      const x = h.x0 + h.vx * (t - h.launch);
      const y = h.y0 + h.vy * (t - h.launch);
      const r = PROJECTILE.visualRadius;
      // Traînée
      g.lineStyle(r * 1.2 * s, color, 0.35);
      g.lineBetween(this.sx(x - ux * 46), this.sy(y - uy * 46), this.sx(x), this.sy(y));
      g.fillStyle(color, 0.25);
      g.fillCircle(this.sx(x), this.sy(y), r * 2 * s);
      g.fillStyle(color, 1);
      g.fillCircle(this.sx(x), this.sy(y), r * s);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(this.sx(x), this.sy(y), r * 0.45 * s);
    }
  }

  private footDist2(h: ProjectileHazard): number {
    // Distance² du centre à la trajectoire
    const len = Math.hypot(h.vx, h.vy);
    const ux = h.vx / len;
    const uy = h.vy / len;
    const along = -(h.x0 * ux + h.y0 * uy);
    const fx = h.x0 + ux * along;
    const fy = h.y0 + uy * along;
    return fx * fx + fy * fy;
  }

  private arcPath(radius: number, a0: number, a1: number): void {
    const g = this.g;
    g.beginPath();
    g.arc(this.sx(0), this.sy(0), radius * this.scale, a0, a1, false);
    g.strokePath();
  }

  private drawSector(h: SectorHazard, t: number, clock: number): void {
    if (t < h.warnStart) return;
    const g = this.g;
    const s = this.scale;
    const a0 = h.center - h.half;
    const a1 = h.center + h.half;
    const color = COLORS.sector;
    if (t < h.activeStart) {
      // Annonce : contours pointillés de part et d'autre de l'orbite + jauge qui se remplit
      const k = (t - h.warnStart) / Math.max(0.001, h.activeStart - h.warnStart);
      const pulse = this.reducedEffects ? 0.7 : 0.55 + 0.25 * Math.sin(clock * 10);
      g.lineStyle(Math.max(1.5 * this.dpr, 2.5 * s), color, pulse);
      const span = a1 - a0;
      const n = Math.max(3, Math.round(span / 0.07));
      for (let i = 0; i < n; i += 2) {
        const b0 = a0 + (span * i) / n;
        const b1 = a0 + (span * (i + 1)) / n;
        this.arcPath(R + 16, b0, b1);
        this.arcPath(R - 16, b0, b1);
      }
      // Bords radiaux
      this.radial(a0, 22);
      this.radial(a1, 22);
      g.lineStyle(Math.max(2 * this.dpr, 4 * s), color, 0.9);
      this.arcPath(R + 26, a0, a0 + span * k);
      return;
    }
    // Actif : bande pleine épaisse + éclair en zigzag + bords épais
    g.lineStyle(30 * s, color, 0.28);
    this.arcPath(R, a0, a1);
    g.lineStyle(Math.max(2 * this.dpr, 3.5 * s), 0xffffff, 0.95);
    const span = a1 - a0;
    const n = Math.max(6, Math.round(span / 0.05));
    const phase = this.reducedEffects ? 0 : Math.floor(clock * 20);
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + (span * i) / n;
      const off = ((i + phase) % 2 === 0 ? 1 : -1) * 10;
      const x = this.sx((R + off) * Math.cos(a));
      const y = this.sy((R + off) * Math.sin(a));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
    g.lineStyle(Math.max(2 * this.dpr, 5 * s), color, 1);
    this.arcPath(R + 17, a0, a1);
    this.arcPath(R - 17, a0, a1);
    this.radial(a0, 24);
    this.radial(a1, 24);
  }

  private radial(a: number, half: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.g.lineBetween(this.sx((R - half) * c), this.sy((R - half) * s), this.sx((R + half) * c), this.sy((R + half) * s));
  }

  // ————————————————————————————————————————————— effets

  burst(x: number, y: number, color: number, count: number, speed: number, life: number): void {
    const n = this.reducedEffects ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const k = this.pnext;
      this.pnext = (this.pnext + 1) % MAX_PARTICLES;
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.px[k] = x;
      this.py[k] = y;
      this.pvx[k] = Math.cos(a) * v;
      this.pvy[k] = Math.sin(a) * v;
      this.plife[k] = life * (0.6 + Math.random() * 0.4);
      this.pmax[k] = this.plife[k];
      this.pcol[k] = color;
    }
  }

  private updateParticles(dt: number): void {
    const g = this.fx;
    const s = this.scale;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (this.plife[k] <= 0) continue;
      this.plife[k] -= dt;
      if (this.plife[k] <= 0) continue;
      const x0 = this.px[k];
      const y0 = this.py[k];
      this.px[k] += this.pvx[k] * dt;
      this.py[k] += this.pvy[k] * dt;
      this.pvx[k] *= 0.96;
      this.pvy[k] *= 0.96;
      const a = this.plife[k] / this.pmax[k];
      g.lineStyle(2.5 * s, this.pcol[k], a);
      g.lineBetween(this.sx(x0), this.sy(y0), this.sx(this.px[k] + (this.px[k] - x0) * 2), this.sy(this.py[k] + (this.py[k] - y0) * 2));
    }
  }

  ring(color: number): void {
    this.ringT = 0;
    this.ringColor = color;
  }

  private drawRing(dt: number): void {
    if (this.ringT < 0) return;
    this.ringT += dt;
    const k = this.ringT / 0.6;
    if (k >= 1) {
      this.ringT = -1;
      return;
    }
    this.fx.lineStyle(4 * this.scale * (1 - k), this.ringColor, 0.6 * (1 - k));
    this.fx.strokeCircle(this.sx(0), this.sy(0), R * this.scale * (1 + k * 0.25));
  }

  popup(x: number, y: number, label: string, color = '#ffe680'): void {
    let best = this.popups[0];
    for (const p of this.popups) if (p.life < best.life) best = p;
    best.life = 0.9;
    // Le texte est poussé vers l'intérieur de l'orbite pour ne pas masquer les menaces extérieures
    best.x = x * 0.82;
    best.y = y * 0.82;
    best.text.setText(label).setColor(color).setVisible(true).setAlpha(0.85);
  }

  private updatePopups(dt: number): void {
    for (const p of this.popups) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.text.setVisible(false);
        continue;
      }
      p.y -= dt * 30;
      p.text.setPosition(this.sx(p.x), this.sy(p.y)).setAlpha(Math.min(0.85, p.life * 2.5));
    }
  }

  clearEffects(): void {
    this.plife.fill(0);
    for (const p of this.popups) {
      p.life = 0;
      p.text.setVisible(false);
    }
    this.ringT = -1;
    this.shake = 0;
    this.flashAlpha = 0;
    this.trailCount = 0;
  }

  hit(x: number, y: number): void {
    this.burst(x, y, 0xffffff, 26, 260, 0.8);
    this.burst(x, y, COLORS.projectile, 18, 200, 0.7);
    if (!this.reducedEffects) {
      this.shake = 14 * this.dpr;
      this.flashAlpha = 0.22;
    }
  }
}
