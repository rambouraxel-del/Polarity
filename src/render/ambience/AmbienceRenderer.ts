import Phaser from 'phaser';
import { AMBIENCE } from '../../config/ambience';
import type { AmbienceState } from '../../ambience/director';
import { Bolts } from './Bolts';
import { Effects } from './Effects';
import { Hole } from './Hole';
import { Particles } from './Particles';
import { Ribbons } from './Ribbons';
import { Rift } from './Rift';
import { Shards } from './Shards';
import { StarField } from './StarField';
import { AMB_TEX, ensureAmbienceTextures } from './textures';
import { Tunnel } from './Tunnel';
import { clamp01, type AmbienceView } from './view';

const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Ambiance visuelle de la Survie : assemble les calques, du plus lointain au plus proche, tous DERRIÈRE l'orbite,
 * les menaces et le vaisseau (profondeurs < 1,9 ; voir ArenaRenderer) :
 *   nébuleuses (0,1) → étoiles en parallaxe (0,15) → tunnel de la phase 2 (0,22–0,3) → débris (0,3) → rubans d'énergie (0,31) → poussières / étincelles (0,35)
 *   → anneaux et ondes (0,4) → vignette (0,5) → voile sombre de la zone de jeu (0,6) → fragments (0,64) → faille : halo, cœur sombre, liseré, sphère (0,65–0,68)
 *   → éclairs (0,69) → quadrillage (0,7).
 * Le rendu ne décide de rien : il dessine l'état produit par `AmbienceDirector`. Pendant la traversée la caméra de jeu s'éloigne (zoom < 1) ; l'ambiance
 * compense ce zoom pour rester plein écran (le décor « avale » l'arène au lieu de rétrécir avec elle).
 */
export class AmbienceRenderer {
  private readonly stars: StarField;
  private readonly rift: Rift;
  private readonly particles: Particles;
  private readonly effects: Effects;
  private readonly tunnel: Tunnel;
  private readonly ribbons: Ribbons;
  private readonly shards: Shards;
  private readonly hole: Hole;
  private readonly bolts: Bolts;
  private readonly veil: Phaser.GameObjects.Image;
  private readonly vignette: Phaser.GameObjects.Image;
  private visible = false;
  /** Repère de l'écran (sans compensation du zoom de la caméra). */
  private readonly screen: AmbienceView = { cx: 0, cy: 0, scale: 1, dpr: 1, width: 1, height: 1, halfDiag: 1 };
  private readonly view: AmbienceView = { cx: 0, cy: 0, scale: 1, dpr: 1, width: 1, height: 1, halfDiag: 1 };

  constructor(scene: Phaser.Scene, gridColor: number, debrisTextures: readonly string[]) {
    ensureAmbienceTextures(scene);
    this.rift = new Rift(scene, 0.1);
    this.stars = new StarField(scene, 0.15);
    this.tunnel = new Tunnel(scene, 0.22);
    this.particles = new Particles(scene, 0.3, 0.35, debrisTextures);
    this.ribbons = new Ribbons(scene, 0.31);
    this.effects = new Effects(scene, 0.4, 0.7, gridColor);
    this.vignette = scene.add.image(0, 0, AMB_TEX.vignette).setDepth(0.5).setVisible(false);
    this.veil = scene.add.image(0, 0, AMB_TEX.veil).setDepth(0.6).setVisible(false);
    this.shards = new Shards(scene, 0.64);
    // Faille : au-dessus du voile (visible au centre), sous l'orbite, les menaces et le vaisseau
    this.hole = new Hole(scene, 0.65);
    this.bolts = new Bolts(scene, 0.69);
  }

  layout(cx: number, cy: number, scale: number, width: number, height: number, dpr: number): void {
    const v = this.screen;
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
    this.tunnel.setVisible(v);
    this.ribbons.setVisible(v);
    this.shards.setVisible(v);
    this.hole.setVisible(v);
    this.bolts.setVisible(v);
    this.veil.setVisible(v);
    this.vignette.setVisible(v);
    if (!v) {
      this.effects.clear();
      this.bolts.clear();
    }
  }

  /** Nouvelle partie : plus d'anneau ni d'éclair en vol. */
  reset(): void {
    this.effects.clear();
    this.bolts.clear();
  }

  /**
   * @param dt pas d'animation (0 en pause : tout se fige)
   * @param zoom zoom courant de la caméra de jeu (< 1 pendant l'aspiration de la traversée) : compensé pour que l'ambiance reste plein écran
   */
  draw(s: AmbienceState, dt: number, zoom = 1): void {
    this.setVisible(true);
    const comp = zoom < 1 ? 1 / Math.max(0.04, zoom) : 1;
    const b = this.screen;
    const v = this.view;
    v.cx = b.cx;
    v.cy = b.cy;
    v.scale = b.scale * comp;
    v.dpr = b.dpr * comp;
    v.width = b.width * comp;
    v.height = b.height * comp;
    v.halfDiag = b.halfDiag * comp;

    const tr = AMBIENCE.transit;
    const g = s.transit > 0 ? smooth(s.transit / tr.engulfBy) : 0;
    // Le tunnel apparaît pendant l'engloutissement (sous le cœur sombre de la faille), puis occupe tout l'écran
    const tunnelAmount = s.phase === 2 ? 1 : s.transit > 0 ? smooth((s.transit - tr.tunnelFrom) / (tr.tunnelTo - tr.tunnelFrom)) : 0;
    // Rubans : quelques courants à peine visibles en phase 1 (un peu plus présents avec le stade), pleins en phase 2
    const ribbonAmount = clamp01((0.55 + 0.2 * (s.stage / 4)) * (1 + 1.4 * g) * (1 - s.look) + s.look);

    this.rift.draw(s, v);
    this.stars.draw(s, v, dt);
    this.tunnel.draw(s, v, dt, tunnelAmount);
    this.ribbons.draw(s, v, dt, ribbonAmount, Math.pow(g, 1.6) * (1 - s.look));
    this.particles.draw(s, v, dt);
    this.effects.draw(s, v, dt);
    this.shards.draw(s, v, dt, this.hole.radius);
    this.hole.draw(s, v, tunnelAmount);
    this.bolts.draw(s, v, dt, this.hole);

    // Voile : plus l'ambiance est lumineuse, plus la zone de jeu est protégée (plafonné) ; en phase 2 il s'allège pour laisser voir le tunnel sous l'arène
    const d = AMBIENCE.shape.veilRadius * 2 * v.scale;
    this.veil.setPosition(v.cx, v.cy).setDisplaySize(d, d);
    const protect = AMBIENCE.caps.veilAlpha * Math.min(1, 0.55 + (0.45 * s.stage) / 4 + s.drop * 0.1);
    const veilA = protect + (AMBIENCE.tunnel.veilAlpha - protect) * tunnelAmount;
    this.veil.setAlpha(veilA);
    // Vignette de la phase 2 : bords et coins sombres (profondeur, lisibilité de l'arène)
    const vd = v.halfDiag * 2.04;
    this.vignette.setPosition(v.cx, v.cy).setDisplaySize(vd, vd).setAlpha(AMBIENCE.tunnel.vignette * tunnelAmount * s.user);
  }
}
