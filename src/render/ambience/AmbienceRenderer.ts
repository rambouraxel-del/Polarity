import Phaser from 'phaser';
import { AMBIENCE } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { Effects } from './Effects';
import { Particles } from './Particles';
import { Rift, riftRotation } from './Rift';
import { StarField } from './StarField';
import { AMB_TEX, ensureAmbienceTextures } from './textures';
import type { AmbienceView } from './view';

/**
 * Ambiance visuelle de la Survie : assemble les calques, du plus lointain au plus proche, tous DERRIÈRE l'orbite,
 * les menaces et le vaisseau (profondeurs < 1,9 ; voir ArenaRenderer) :
 *   nébuleuses (0,1) → étoiles en parallaxe (0,15) → faille (0,2) → débris (0,3) → poussières (0,35)
 *   → anneaux, ondes, arcs (0,4) → voile sombre de la zone de jeu (0,6) → quadrillage (0,7).
 * Le rendu ne décide de rien : il dessine l'état produit par `AmbienceDirector`.
 */
export class AmbienceRenderer {
  private readonly stars: StarField;
  private readonly rift: Rift;
  private readonly particles: Particles;
  private readonly effects: Effects;
  private readonly veil: Phaser.GameObjects.Image;
  private visible = false;
  private readonly view: AmbienceView = { cx: 0, cy: 0, scale: 1, dpr: 1, width: 1, height: 1, halfDiag: 1 };

  constructor(scene: Phaser.Scene, gridColor: number, debrisTextures: readonly string[]) {
    ensureAmbienceTextures(scene);
    this.rift = new Rift(scene, 0.1, 0.2);
    this.stars = new StarField(scene, 0.15);
    this.particles = new Particles(scene, 0.3, 0.35, debrisTextures);
    this.effects = new Effects(scene, 0.4, 0.7, gridColor);
    this.veil = scene.add.image(0, 0, AMB_TEX.veil).setDepth(0.6).setVisible(false);
  }

  layout(cx: number, cy: number, scale: number, width: number, height: number, dpr: number): void {
    const v = this.view;
    v.cx = cx;
    v.cy = cy;
    v.scale = scale;
    v.dpr = dpr;
    v.width = width;
    v.height = height;
    // Distance du centre de l'arène au coin le plus éloigné
    v.halfDiag = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
  }

  get active(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.stars.setVisible(v);
    this.rift.setVisible(v);
    this.particles.setVisible(v);
    this.effects.setVisible(v);
    this.veil.setVisible(v);
    if (!v) this.effects.clear();
  }

  /** Nouvelle partie : plus d'anneau ni d'arc en vol. */
  reset(): void {
    this.effects.clear();
  }

  /** @param dt pas d'animation (0 en pause : tout se fige) */
  draw(s: AmbienceState, dt: number): void {
    this.setVisible(true);
    const v = this.view;
    this.rift.draw(s, v);
    this.stars.draw(s, v, dt);
    this.particles.draw(s, v, dt);
    this.effects.draw(s, v, dt, riftRotation(s));
    // Voile : plus l'ambiance est lumineuse, plus la zone de jeu est protégée (plafonné)
    const d = AMBIENCE.shape.veilRadius * 2 * v.scale;
    this.veil.setPosition(v.cx, v.cy).setDisplaySize(d, d);
    this.veil.setAlpha(AMBIENCE.caps.veilAlpha * Math.min(1, 0.55 + (0.45 * s.stage) / 4 + s.drop * 0.1));
  }
}
