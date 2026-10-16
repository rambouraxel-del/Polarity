import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { AMB_TEX } from './textures';
import { clamp01, lerpColor, type AmbienceView } from './view';

const MAX_FISSURES = 10;
const FISSURE_POINTS = 8;
/** Fissures du réseau de la phase 2 : rayons issus du centre (angle, longueur relative), générés une fois (graine fixe, décoratif). */
const NETWORK = Array.from({ length: 9 }, (_, i) => {
  const h = (n: number): number => {
    const x = Math.sin((i + 1) * 91.7 + n * 37.1) * 43758.5453;
    return x - Math.floor(x);
  };
  const a = (i / 9) * Math.PI * 2 + (h(1) - 0.5) * 0.5;
  const pts: number[] = [];
  let ang = a;
  let r = 0;
  for (let k = 0; k < 14; k++) {
    r += 0.07 + h(k + 2) * 0.1;
    ang += (h(k + 20) - 0.5) * 0.28;
    pts.push(ang, r);
  }
  return pts;
});

interface Fissure {
  active: boolean;
  age: number;
  life: number;
  strength: number;
  pts: Float32Array;
}

/**
 * Noyau central, fissures lumineuses et réseau fracturé de la phase 2.
 * - Phase 1 : petite sphère au centre dès le départ ; de 4 min 30 à 5 min elle s'étire en faille. Des fissures jaillissent sur les battements forts et les
 *   moments forts préparés.
 * - Phase 2 : foyer de fissures et réseau de cassures bleu électrique qui s'allument sur les battements.
 * Dessiné AU-DESSUS du voile mais sous l'orbite, les menaces et le vaisseau ; opacités plafonnées (config/ambience.ts : core.alphaMax).
 * Décoratif : aucune lecture par la simulation, `Math.random` pour les formes.
 */
export class Core {
  private readonly glow: Phaser.GameObjects.Image;
  private readonly slit: Phaser.GameObjects.Image;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly fissures: Fissure[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    this.glow = scene.add.image(0, 0, AMB_TEX.glow).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.slit = scene.add.image(0, 0, AMB_TEX.riftCore).setDepth(depth + 0.01).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.g = scene.add.graphics().setDepth(depth + 0.02).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    for (let i = 0; i < MAX_FISSURES; i++) this.fissures.push({ active: false, age: 0, life: 0, strength: 0, pts: new Float32Array(FISSURE_POINTS * 2) });
  }

  setVisible(v: boolean): void {
    this.glow.setVisible(v);
    this.slit.setVisible(v);
    this.g.setVisible(v);
    if (!v) this.clear();
  }

  clear(): void {
    for (const f of this.fissures) f.active = false;
    this.g.clear();
  }

  /** Une fissure : ligne brisée qui part du bord du noyau vers l'extérieur (repère de l'arène, unités monde). */
  private spawn(strength: number, rand: () => number): void {
    const f = this.fissures.find((x) => !x.active);
    if (!f) return;
    f.active = true;
    f.age = 0;
    f.life = 0.35 + 0.45 * strength;
    f.strength = strength;
    const a0 = rand() * Math.PI * 2;
    const len = 150 + 280 * strength * (0.6 + 0.4 * rand());
    let ang = a0;
    for (let i = 0; i < FISSURE_POINTS; i++) {
      const r = 22 + (i / (FISSURE_POINTS - 1)) * len;
      ang += (rand() - 0.5) * 0.22;
      f.pts[i * 2] = Math.cos(ang) * r;
      f.pts[i * 2 + 1] = Math.sin(ang) * r;
    }
  }

  draw(s: AmbienceState, v: AmbienceView, dt: number, rand: () => number = Math.random): void {
    const cfg = AMBIENCE.core;
    const g = this.g;
    g.clear();
    const calm = 1 - 0.35 * s.calm;
    const reduced = s.reduced;
    const phase2 = s.look;
    // Noyau : petite sphère qui bat avec la musique ; la faille s'ouvre (étirement le long de son axe) en fin de phase 1
    const base = cfg.radiusMin + (cfg.radiusMax - cfg.radiusMin) * s.core;
    const pulse = 1 + 0.35 * s.beat + 0.2 * s.bass + 0.3 * s.drop;
    const radius = base * pulse * v.scale;
    const tint = lerpColor(lerpColor(AMBIENCE_COLORS.cyan, AMBIENCE_COLORS.ice, 0.4 + 0.4 * s.beat), AMBIENCE.phase2.crack, phase2);
    const alpha = Math.min(cfg.alphaMax, (0.22 + 0.5 * s.core + 0.2 * s.beat + 0.2 * s.drop) * calm * (s.transit > 0 ? 1 : 1));
    this.glow.setPosition(v.cx, v.cy).setTint(tint).setAlpha(alpha).setDisplaySize(radius * 5.2, radius * 5.2);
    // Faille : fuseau lumineux (texture du cœur de la faille), long et fin
    const slitLen = (cfg.slitLength * 2 * v.scale) * clamp01(s.core * 1.2);
    const slitW = Math.max(3 * v.dpr, radius * 0.9 * (1 - 0.45 * s.core));
    this.slit.setVisible(s.core > 0.02).setPosition(v.cx, v.cy).setRotation(-0.62).setTint(lerpColor(AMBIENCE_COLORS.ice, AMBIENCE.phase2.spark, phase2));
    this.slit.setDisplaySize(Math.max(slitW * 2, slitLen), slitW).setAlpha(Math.min(cfg.alphaMax, alpha * (0.5 + 0.5 * s.core)));

    if (reduced) return;
    // Fissures : jaillissent sur les battements forts (probabilité de la partition) et les moments forts préparés
    if (dt > 0 && s.spawnFissure > 0) {
      this.spawn(clamp01(s.spawnFissure), rand);
      if (s.spawnFissure > 0.85) this.spawn(clamp01(s.spawnFissure * 0.8), rand);
    }
    const col = lerpColor(AMBIENCE_COLORS.azure, AMBIENCE.phase2.crack, phase2);
    const hot = lerpColor(AMBIENCE_COLORS.ice, AMBIENCE.phase2.spark, phase2);
    for (const f of this.fissures) {
      if (!f.active) continue;
      if (dt > 0) f.age += dt;
      if (f.age >= f.life) {
        f.active = false;
        continue;
      }
      const k = 1 - f.age / f.life;
      // Attaque immédiate, retombée rapide ; la fissure grandit pendant le premier quart de sa vie
      const grow = Math.min(1, f.age / (f.life * 0.25));
      const n = Math.max(2, Math.round(FISSURE_POINTS * grow));
      g.lineStyle(Math.max(1.5 * v.dpr, 2.4 * v.scale), col, Math.min(0.55, 0.5 * k * f.strength + 0.08));
      g.beginPath();
      g.moveTo(v.cx + f.pts[0] * v.scale, v.cy + f.pts[1] * v.scale);
      for (let i = 1; i < n; i++) g.lineTo(v.cx + f.pts[i * 2] * v.scale, v.cy + f.pts[i * 2 + 1] * v.scale);
      g.strokePath();
      g.lineStyle(Math.max(1 * v.dpr, 1.1 * v.scale), hot, Math.min(0.7, 0.7 * k));
      g.beginPath();
      g.moveTo(v.cx + f.pts[0] * v.scale, v.cy + f.pts[1] * v.scale);
      for (let i = 1; i < n; i++) g.lineTo(v.cx + f.pts[i * 2] * v.scale, v.cy + f.pts[i * 2 + 1] * v.scale);
      g.strokePath();
    }
    // Phase 2 : réseau de cassures bleu électrique issu du centre, qui s'allume sur les battements (hors zone de jeu : opacités basses)
    if (phase2 > 0.01) {
      const a = (0.1 + 0.28 * s.beat + 0.1 * s.bass + 0.12 * s.drop) * phase2 * (1 - 0.5 * s.calm);
      g.lineStyle(Math.max(1 * v.dpr, 1.6 * v.scale), AMBIENCE.phase2.crack, Math.min(0.5, a));
      for (const poly of NETWORK) {
        g.beginPath();
        for (let i = 0; i < poly.length; i += 2) {
          const r = poly[i + 1] * 760;
          const x = v.cx + Math.cos(poly[i]) * r * v.scale;
          const y = v.cy + Math.sin(poly[i]) * r * v.scale;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokePath();
      }
    }
  }
}
