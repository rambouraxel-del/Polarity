import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { clamp01, lerpColor, type AmbienceView } from './view';

const MAX = AMBIENCE.quality.tiers.high.bolts;
const MAIN = 17;
const BRANCHES = 3;
const BRANCH_POINTS = 8;

interface Bolt {
  active: boolean;
  age: number;
  life: number;
  strength: number;
  jitterT: number;
  /** Extrémités (unités monde, repère de l'arène). */
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  /** Tracé : ligne brisée principale et branches (unités monde). */
  main: Float32Array;
  br: Float32Array;
  nBr: number;
}

/** Faille de la phase 1 vue par les éclairs : de là partent les filaments électriques. */
export interface HoleShape {
  radius: number;
  rot: number;
  stretchX: number;
  stretchY: number;
}

/**
 * Éclairs ramifiés décoratifs (pool fixe, tableaux typés) : tracé brisé à ramifications, apparition rapide, tracé retiré plusieurs fois pendant la vie
 * de l'éclair (variations), scintillement puis extinction courte. Phase 1 : filaments qui jaillissent du bord de la faille. Phase 2 : arcs qui sautent
 * entre les structures du tunnel, toujours hors de la zone de jeu. Bleu azur / violet / blanc glacé : jamais le magenta-blanc des secteurs électriques
 * ni le corail et l'orange des dangers, et jamais sur l'orbite. Décoratif : `Math.random`.
 */
export class Bolts {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly bolts: Bolt[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    for (let i = 0; i < MAX; i++) {
      this.bolts.push({ active: false, age: 0, life: 0, strength: 0, jitterT: 0, sx: 0, sy: 0, ex: 0, ey: 0, main: new Float32Array(MAIN * 2), br: new Float32Array(BRANCHES * BRANCH_POINTS * 2), nBr: 0 });
    }
  }

  setVisible(v: boolean): void {
    this.g.setVisible(v);
    if (!v) this.g.clear();
  }

  clear(): void {
    for (const b of this.bolts) b.active = false;
    this.g.clear();
  }

  private slot(limit: number): Bolt | null {
    let used = 0;
    for (const b of this.bolts) if (b.active) used++;
    if (used >= limit) return null;
    const b = this.bolts.find((x) => !x.active) ?? null;
    if (!b) return null;
    const life = AMBIENCE.bolts.life;
    b.active = true;
    b.age = 0;
    b.life = life[0] + Math.random() * (life[1] - life[0]);
    b.jitterT = 0;
    return b;
  }

  /** Filament jailli du bord de la faille, vers l'extérieur. */
  spawnFromRim(strength: number, hole: HoleShape, limit: number): void {
    const b = this.slot(limit);
    if (!b) return;
    b.strength = strength;
    const a = Math.random() * Math.PI * 2;
    const lx = Math.cos(a) * hole.radius * hole.stretchX;
    const ly = Math.sin(a) * hole.radius * hole.stretchY;
    const cr = Math.cos(hole.rot);
    const sr = Math.sin(hole.rot);
    b.sx = lx * cr - ly * sr;
    b.sy = lx * sr + ly * cr;
    const out = Math.atan2(b.sy, b.sx) + (Math.random() - 0.5) * 1.0;
    let len = 70 + 190 * strength * (0.6 + 0.4 * Math.random());
    let ex = b.sx + Math.cos(out) * len;
    let ey = b.sy + Math.sin(out) * len;
    // Les filaments restent à l'intérieur de l'orbite (rayon 300) : le centre de l'arène est un décor, jamais un obstacle visuel sur le rail
    const reach = Math.hypot(ex, ey);
    if (reach > AMBIENCE.bolts.rimReach) {
      const k = AMBIENCE.bolts.rimReach / reach;
      len *= k;
      ex = b.sx + (ex - b.sx) * k;
      ey = b.sy + (ey - b.sy) * k;
    }
    b.ex = ex;
    b.ey = ey;
    this.generate(b);
  }

  /** Arc qui saute d'une structure à l'autre, hors de la zone de jeu (`farUnits` = rayon visible en unités monde). */
  spawnBetweenStructures(strength: number, farUnits: number, limit: number): void {
    const b = this.slot(limit);
    if (!b) return;
    b.strength = strength;
    const min = AMBIENCE.bolts.minRadius;
    const a = Math.random() * Math.PI * 2;
    const r0 = min + Math.random() * Math.max(40, farUnits * 0.85 - min);
    const a1 = a + (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.32);
    const r1 = Math.max(min, r0 * (0.72 + Math.random() * 0.6));
    b.sx = Math.cos(a) * r0;
    b.sy = Math.sin(a) * r0;
    b.ex = Math.cos(a1) * r1;
    b.ey = Math.sin(a1) * r1;
    this.generate(b);
  }

  /** (Re)trace l'éclair entre ses extrémités : marche aléatoire corrélée, puis quelques branches. */
  private generate(b: Bolt): void {
    const dx = b.ex - b.sx;
    const dy = b.ey - b.sy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    let off = 0;
    for (let i = 0; i < MAIN; i++) {
      const t = i / (MAIN - 1);
      off = off * 0.55 + (Math.random() - 0.5) * len * 0.2;
      const w = Math.pow(Math.sin(Math.PI * t), 0.5);
      b.main[i * 2] = b.sx + dx * t + nx * off * w;
      b.main[i * 2 + 1] = b.sy + dy * t + ny * off * w;
    }
    const base = Math.atan2(dy, dx);
    b.nBr = 0;
    for (let k = 0; k < BRANCHES; k++) {
      if (Math.random() < 0.25) continue;
      const idx = 2 + Math.floor(Math.random() * (MAIN - 5));
      let x = b.main[idx * 2];
      let y = b.main[idx * 2 + 1];
      let ang = base + (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.7);
      const step = (len * (0.14 + Math.random() * 0.2)) / (BRANCH_POINTS - 1);
      const o = b.nBr * BRANCH_POINTS * 2;
      for (let i = 0; i < BRANCH_POINTS; i++) {
        b.br[o + i * 2] = x;
        b.br[o + i * 2 + 1] = y;
        ang += (Math.random() - 0.5) * 0.7;
        x += Math.cos(ang) * step;
        y += Math.sin(ang) * step;
      }
      b.nBr++;
    }
  }

  private stroke(arr: Float32Array, offset: number, count: number, v: AmbienceView): void {
    const g = this.g;
    g.beginPath();
    for (let i = 0; i < count; i++) {
      const x = v.cx + arr[offset + i * 2] * v.scale;
      const y = v.cy + arr[offset + i * 2 + 1] * v.scale;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /** @param spawnRim apparition d'un filament depuis la faille (force 0 = aucun) ; @param hole forme courante de la faille */
  draw(s: AmbienceState, v: AmbienceView, dt: number, hole: HoleShape, rimOpen: number): void {
    const cfg = AMBIENCE.bolts;
    const g = this.g;
    g.clear();
    const limit = s.quality.bolts;
    if (!s.reduced && s.user > 0 && dt > 0) {
      if (s.spawnFissure > 0 && rimOpen > 0.2 && s.look < 0.5 && s.transit === 0) {
        this.spawnFromRim(clamp01(s.spawnFissure), hole, limit);
        if (s.spawnFissure > 0.85) this.spawnFromRim(clamp01(s.spawnFissure * 0.8), hole, limit);
      }
      const far = v.halfDiag / v.scale;
      for (let i = 0; i < s.spawnArcs; i++) this.spawnBetweenStructures(0.6 + 0.4 * Math.random() + 0.3 * s.drop, far, limit);
    }
    if (s.reduced || s.user <= 0) {
      for (const b of this.bolts) b.active = false;
      return;
    }
    const heat = clamp01(s.p.heat);
    const glowCol = lerpColor(AMBIENCE_COLORS.azure, AMBIENCE_COLORS.violet, heat * 0.6 + 0.3 * s.drop);
    const coreCol = lerpColor(AMBIENCE_COLORS.ice, AMBIENCE_COLORS.white, 0.3 + 0.5 * s.drop);
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) {
        b.active = false;
        continue;
      }
      b.jitterT += dt;
      if (b.jitterT > cfg.jitter) {
        b.jitterT = 0;
        this.generate(b);
      }
      const k = b.age / b.life;
      // Attaque immédiate, scintillement, extinction courte
      const flick = Math.sin(b.age * 95) > -0.25 ? 1 : 0.45;
      const alpha = Math.min(cfg.alphaMax, b.strength * Math.pow(1 - k, 0.8) * flick * (0.7 + 0.4 * s.drop) * s.user);
      if (alpha < 0.02) continue;
      if (s.tier !== 'low') {
        g.lineStyle(7 * v.dpr, glowCol, alpha * 0.28);
        this.stroke(b.main, 0, MAIN, v);
        g.lineStyle(4 * v.dpr, glowCol, alpha * 0.22);
        for (let r = 0; r < b.nBr; r++) this.stroke(b.br, r * BRANCH_POINTS * 2, BRANCH_POINTS, v);
      }
      g.lineStyle(1.9 * v.dpr, coreCol, alpha);
      this.stroke(b.main, 0, MAIN, v);
      g.lineStyle(1.2 * v.dpr, coreCol, alpha * 0.85);
      for (let r = 0; r < b.nBr; r++) this.stroke(b.br, r * BRANCH_POINTS * 2, BRANCH_POINTS, v);
    }
  }
}
