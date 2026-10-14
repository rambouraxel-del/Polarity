import Phaser from 'phaser';
import { AMBIENCE, AMBIENCE_COLORS } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { AMB_TEX, RIFT_LENS } from './textures';
import { clamp01, lerpColor, type AmbienceView } from './view';

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
 * La faille cosmique et les nébuleuses qui l'entourent : l'élément central de l'ambiance.
 * Trait à peine perceptible au Vide stellaire, elle s'ouvre stade après stade, pulse sur les battements,
 * s'illumine avec les basses et se dilate sur les passages forts. Dessinée derrière le voile de la zone de jeu.
 */
export class Rift {
  private readonly nebulae: Phaser.GameObjects.Image[];
  private readonly halo: Phaser.GameObjects.Image;
  private readonly rim: Phaser.GameObjects.Image;
  private readonly core: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, depthNebula: number, depthRift: number) {
    const add = (key: string, depth: number): Phaser.GameObjects.Image =>
      scene.add.image(0, 0, key).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.nebulae = NEBULAE.map((n) => add(AMB_TEX.glow, depthNebula).setTint(n.color));
    this.halo = add(AMB_TEX.glow, depthRift);
    this.rim = add(AMB_TEX.riftRim, depthRift + 0.01);
    this.core = add(AMB_TEX.riftCore, depthRift + 0.02);
  }

  setVisible(v: boolean): void {
    for (const n of this.nebulae) n.setVisible(v);
    this.halo.setVisible(v);
    this.rim.setVisible(v);
    this.core.setVisible(v);
  }

  draw(s: AmbienceState, v: AmbienceView): void {
    const caps = AMBIENCE.caps;
    const shape = AMBIENCE.shape;
    const motion = s.reduced ? AMBIENCE.reduced.motion : 1;
    const p = s.p;

    // Nébuleuses : lentes, sur une orbite large ; le violet et le magenta montent avec la « chaleur »
    const glowBoost = 0.75 + 0.5 * s.bass + 0.3 * s.build + 0.45 * s.drop + 0.25 * s.intensity;
    NEBULAE.forEach((n, i) => {
      const img = this.nebulae[i];
      // Qualité réduite : moins de grandes lueurs additives (coût de remplissage du GPU sur mobile)
      if (i >= s.quality.nebulae) {
        img.setVisible(false);
        return;
      }
      img.setVisible(true);
      const a = n.angle + s.time * 0.012 * motion * (i % 2 === 0 ? 1 : -1);
      const d = n.dist * v.halfDiag;
      img.setPosition(v.cx + Math.cos(a) * d, v.cy + Math.sin(a) * d);
      const size = n.size * v.halfDiag * 2 * (1 + 0.04 * s.bass);
      img.setDisplaySize(size, size * 0.8);
      const heatW = n.heat < 0 ? 1 - 0.45 * p.heat : n.heat < 1 ? 0.55 + 0.45 * p.heat : p.heat;
      img.setAlpha(Math.min(caps.nebulaAlpha, p.nebula * heatW * glowBoost));
    });

    const rot = riftRotation(s);
    const len = shape.riftLength * 2 * v.scale;
    const dilate = 1 + (caps.dropDilate - 1) * s.drop;
    const aperture = p.riftOpen * dilate * (1 + caps.beatScale * s.beat + 0.04 * s.bass);
    const glow = p.riftGlow * (0.75 + 0.35 * s.bass + 0.3 * s.beat + 0.4 * s.drop + 0.2 * s.build);

    const tint = lerpColor(AMBIENCE_COLORS.violet, AMBIENCE_COLORS.magenta, p.heat * 0.7 + s.drop * 0.3);
    this.halo.setPosition(v.cx, v.cy).setRotation(rot).setTint(tint);
    this.halo.setDisplaySize(len * 0.9, Math.max(6 * v.dpr, shape.riftWidth * 5 * aperture * v.scale * (1 + caps.beatScale * s.beat)));
    this.halo.setAlpha(Math.min(caps.riftAlpha, glow * 0.55));

    const rimTint = lerpColor(lerpColor(AMBIENCE_COLORS.azure, AMBIENCE_COLORS.violet, p.heat * 0.5), AMBIENCE_COLORS.ice, s.beat * 0.3 + s.drop * 0.25);
    this.rim.setPosition(v.cx, v.cy).setRotation(rot).setTint(rimTint);
    this.rim.setDisplaySize(len, Math.max(3 * v.dpr, (2 * shape.riftWidth * aperture * v.scale) / RIFT_LENS));
    this.rim.setAlpha(Math.min(caps.riftAlpha, glow * (0.55 + 0.45 * clamp01(aperture * 2))));

    this.core.setPosition(v.cx, v.cy).setRotation(rot).setTint(AMBIENCE_COLORS.ice);
    this.core.setDisplaySize(len * 0.82, (10 + 8 * s.beat + 10 * s.drop) * v.dpr);
    this.core.setAlpha(Math.min(caps.riftAlpha, glow * (0.45 + 0.4 * s.beat + 0.4 * s.drop)));
  }
}
