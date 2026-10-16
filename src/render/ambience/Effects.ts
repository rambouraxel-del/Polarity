import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { clamp01, lerpColor, type AmbienceView } from './view';

const MAX_RINGS = AMBIENCE.quality.tiers.high.rings;
/** Vitesse d'expansion (unités monde/s) : anneau de battement, onde de passage fort. */
const RING_SPEED = 300;
const WAVE_SPEED = 460;
/** Largeur (unités monde) de la bosse que l'onde imprime au quadrillage. */
const WAVE_BAND = 45;

/** Quadrillage de l'arène (identique au décor fixe : 8 cercles, 12 rayons). */
const GRID_RINGS = [80, 190, 300, 410, 520, 630, 740, 850];
const GRID_RAYS = 12;
const RAY_POINTS = 10;

interface RingSlot {
  active: boolean;
  r: number;
  strength: number;
  wave: boolean;
}

/**
 * Effets rythmiques : anneaux d'énergie (battements forts), ondes (passages forts)
 * et quadrillage de l'arène légèrement déformé par la gravité de la faille et par les ondes qui le traversent.
 * Pools fixes, aucun flash plein écran, aucun tremblement : tout reste derrière le vaisseau et les menaces.
 */
export class Effects {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly grid: Phaser.GameObjects.Graphics;
  private readonly rings: RingSlot[] = [];
  private readonly gridColor: number;

  constructor(scene: Phaser.Scene, depthFx: number, depthGrid: number, gridColor: number) {
    this.g = scene.add.graphics().setDepth(depthFx).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.grid = scene.add.graphics().setDepth(depthGrid).setVisible(false);
    this.gridColor = gridColor;
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ active: false, r: 0, strength: 0, wave: false });
  }

  setVisible(v: boolean): void {
    this.g.setVisible(v);
    this.grid.setVisible(v);
    if (!v) {
      this.g.clear();
      this.grid.clear();
    }
  }

  /** Nouvelle partie : plus aucun effet en cours. */
  clear(): void {
    for (const r of this.rings) r.active = false;
  }

  private spawnRing(strength: number, wave: boolean, limit: number): void {
    let slot: RingSlot | null = null;
    let used = 0;
    for (const r of this.rings) if (r.active) used++;
    for (const r of this.rings) {
      if (!r.active && used < limit) {
        slot = r;
        break;
      }
    }
    // Pool plein : une onde remplace l'anneau le plus avancé ; un anneau ordinaire est simplement ignoré
    if (!slot && wave) {
      for (const r of this.rings) if (r.active && !r.wave && (!slot || r.r > slot.r)) slot = r;
    }
    if (!slot) return;
    slot.active = true;
    slot.r = AMBIENCE.shape.ringFrom;
    slot.strength = strength;
    slot.wave = wave;
  }

  draw(s: AmbienceState, v: AmbienceView, dt: number): void {
    const caps = AMBIENCE.caps;
    if (s.spawnWave > 0) this.spawnRing(s.spawnWave, true, s.quality.rings);
    if (s.spawnRing > 0) this.spawnRing(s.spawnRing, false, s.quality.rings);

    const g = this.g;
    g.clear();
    // Violet seulement dans les traits : le magenta est réservé aux secteurs électriques (danger)
    const heatColor = lerpColor(AMBIENCE_COLORS.azure, AMBIENCE_COLORS.violet, s.p.heat);

    // Anneaux et ondes
    const span = AMBIENCE.shape.ringTo - AMBIENCE.shape.ringFrom;
    for (const r of this.rings) {
      if (!r.active) continue;
      r.r += (r.wave ? WAVE_SPEED : RING_SPEED) * dt;
      const k = (r.r - AMBIENCE.shape.ringFrom) / span;
      if (k >= 1) {
        r.active = false;
        continue;
      }
      const fade = Math.pow(1 - k, 1.3);
      const rad = r.r * v.scale;
      if (r.wave) {
        const a = Math.min(caps.ringAlpha * 1.25, r.strength * 0.5 * fade);
        g.lineStyle(10 * v.dpr, heatColor, a * 0.3);
        g.strokeCircle(v.cx, v.cy, rad);
        g.lineStyle(2.5 * v.dpr, AMBIENCE_COLORS.ice, a);
        g.strokeCircle(v.cx, v.cy, rad);
      } else {
        const a = Math.min(caps.ringAlpha, r.strength * 0.4 * fade);
        g.lineStyle(5 * v.dpr, AMBIENCE_COLORS.cyan, a * 0.3);
        g.strokeCircle(v.cx, v.cy, rad);
        g.lineStyle(1.4 * v.dpr, AMBIENCE_COLORS.cyan, a);
        g.strokeCircle(v.cx, v.cy, rad);
      }
    }

    this.drawGrid(s, v);
  }

  /** Déformation radiale du quadrillage au rayon ρ (unités monde) et à l'angle θ : ondulation sur les basses, bosse au passage d'une onde. */
  private warp(s: AmbienceState, rho: number, theta: number): number {
    if (s.reduced && !AMBIENCE.reduced.gridWarp) return 0;
    const caps = AMBIENCE.caps;
    const span = AMBIENCE.shape.ringTo - AMBIENCE.shape.ringFrom;
    let off = s.p.gridWarp * caps.gridWarp * (0.35 + s.bass) * Math.sin(theta * 3 + s.time * 1.3 + rho * 0.012) * Math.exp(-rho / 600);
    for (const r of this.rings) {
      if (!r.active || !r.wave) continue;
      const d = (rho - r.r) / WAVE_BAND;
      if (d > -3 && d < 3) off += caps.gridWarp * 1.4 * r.strength * Math.exp(-d * d) * (1 - (r.r - AMBIENCE.shape.ringFrom) / span);
    }
    return off;
  }

  /** Quadrillage : mêmes cercles et rayons que le décor fixe ; teinté et déformé avec mesure. */
  private drawGrid(s: AmbienceState, v: AmbienceView): void {
    const g = this.grid;
    g.clear();
    const seg = s.quality.gridSegments;
    const color = lerpColor(this.gridColor, AMBIENCE_COLORS.violet, clamp01(0.12 * s.p.heat + 0.3 * s.drop + 0.15 * s.beat));
    const boost = 1 + 0.25 * s.beat + 0.3 * s.drop;
    // Phase 2 : le quadrillage s'estompe (le tunnel est le décor)
    const fade = 0.62 * (1 - 0.6 * s.look);
    g.lineStyle(1 * v.dpr, color, Math.min(1, 0.8 * boost * fade));
    for (const rho of GRID_RINGS) {
      g.beginPath();
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const rr = (rho + this.warp(s, rho, th)) * v.scale;
        const x = v.cx + Math.cos(th) * rr;
        const y = v.cy + Math.sin(th) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    // Rayons : légère torsion gravitationnelle près de la faille
    const twist = s.reduced ? 0 : s.p.gridWarp * 0.07 * Math.sin(s.time * 0.21) + s.drop * 0.04;
    const far = (v.halfDiag * 1.05) / v.scale;
    g.lineStyle(1 * v.dpr, color, Math.min(1, 0.35 * boost * fade));
    for (let k = 0; k < GRID_RAYS; k++) {
      const a0 = (k * Math.PI * 2) / GRID_RAYS;
      g.beginPath();
      for (let i = 0; i <= RAY_POINTS; i++) {
        const rho = (i / RAY_POINTS) * far;
        const th = a0 + twist * Math.exp(-rho / 260);
        const x = v.cx + Math.cos(th) * rho * v.scale;
        const y = v.cy + Math.sin(th) * rho * v.scale;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
  }
}
