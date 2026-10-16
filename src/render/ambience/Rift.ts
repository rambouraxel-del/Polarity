import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { AMB_TEX } from './textures';
import type { AmbienceView } from './view';

const NEBULAE = [
  { color: AMBIENCE_COLORS.cyan, angle: 0.9, dist: 0.42, size: 1.25, heat: -1 },
  { color: AMBIENCE_COLORS.violet, angle: 3.6, dist: 0.5, size: 1.4, heat: 0.5 },
  { color: AMBIENCE_COLORS.magenta, angle: 5.3, dist: 0.55, size: 1.1, heat: 1 },
] as const;

/** Orientation de la faille (rad) : fixe, avec un très lent balancement. */
export function riftRotation(s: AmbienceState): number {
  const motion = s.reduced ? AMBIENCE.reduced.motion : 1;
  return AMBIENCE.motion.riftAngle + Math.sin(s.time * 0.05 * motion) * AMBIENCE.motion.riftSway;
}

/**
 * Nébuleuses lointaines (grandes lueurs cyan, violet et magenta, à peine visibles au début) : elles donnent sa couleur à l'espace de la phase 1, dérivent
 * lentement et, pendant la traversée, sont aspirées vers la faille. La faille elle-même est dessinée par `Hole`. Derrière le voile de la zone de jeu.
 */
export class Rift {
  private readonly nebulae: Phaser.GameObjects.Image[];

  constructor(scene: Phaser.Scene, depthNebula: number) {
    this.nebulae = NEBULAE.map((n) => scene.add.image(0, 0, AMB_TEX.glow).setDepth(depthNebula).setBlendMode(Phaser.BlendModes.ADD).setVisible(false).setTint(n.color));
  }

  setVisible(v: boolean): void {
    if (!v) for (const n of this.nebulae) n.setVisible(false);
  }

  draw(s: AmbienceState, v: AmbienceView): void {
    const caps = AMBIENCE.caps;
    const motion = s.reduced ? AMBIENCE.reduced.motion : 1;
    const p = s.p;
    const gp = s.transit > 0 ? Math.min(1, s.transit / AMBIENCE.transit.engulfBy) : 0;
    // Lueur plus vive avec les basses, les montées et les passages forts
    const glowBoost = 0.75 + 0.5 * s.bass + 0.3 * s.build + 0.45 * s.drop + 0.25 * s.intensity;
    NEBULAE.forEach((n, i) => {
      const img = this.nebulae[i];
      // Qualité réduite : moins de grandes lueurs additives (coût de remplissage du GPU sur mobile)
      if (i >= s.quality.nebulae) {
        img.setVisible(false);
        return;
      }
      img.setVisible(true);
      const a = n.angle + s.time * 0.012 * motion * (i % 2 === 0 ? 1 : -1) + 2.2 * gp;
      const d = n.dist * v.halfDiag * (1 - 0.9 * gp);
      img.setPosition(v.cx + Math.cos(a) * d, v.cy + Math.sin(a) * d);
      const size = n.size * v.halfDiag * 2 * (1 + 0.04 * s.bass) * (1 - 0.5 * gp);
      img.setDisplaySize(size, size * 0.8);
      const heatW = n.heat < 0 ? 1 - 0.45 * p.heat : n.heat < 1 ? 0.55 + 0.45 * p.heat : p.heat;
      img.setAlpha(Math.min(caps.nebulaAlpha, p.nebula * heatW * glowBoost) * (1 - gp));
    });
  }
}
