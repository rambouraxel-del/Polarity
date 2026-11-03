import Phaser from 'phaser';
import type { AmbienceState } from '../../ambience/director';
import { AMBIENCE } from '../../config/ambience';
import { NEB_TEX, nebulaJobs } from './nebulaTextures';
import { AMB_TEX } from './textures';
import { clamp01, lerpColor, type AmbienceView } from './view';

/**
 * Décor de l'univers 3 « La Mer nébulaire » — l'immense nébuleuse turquoise des deux références, ENTIÈREMENT dessinée par code (textures procédurales de
 * `nebulaTextures.ts`) : fond de ciel profond, nuages volumétriques en trois plans de parallaxe (lueurs additives + fumée sombre qui creuse la profondeur),
 * tourbillon lumineux autour d'un foyer, planète à anneau et ses rayons, gigantesques monolithes et îlots flottants (trois plans, brume atmosphérique, liseré
 * de lumière, cascades de brume), poussières lumineuses, et l'ÉCLIPSE DES GÉANTS (masse rocheuse, pénombre, dispersion, éclat de la révélation).
 *
 * VERSION 2 — un univers profond et vivant : caméra flottante (parallaxe marquée, chaque plan suit à sa profondeur), tuiles de gaz sans couture qui défilent en
 * sens contraires (les courants se déforment l'un l'autre), nuages qui TRAVERSENT l'écran dans le sens du vent, filaments lumineux, géants de passage (monolithes
 * qui occultent la lumière), ondes de choc sur les impacts, lignes de vitesse de l'apogée. Toute l'animation suit l'ARC VISUEL `s.neb` (début mystérieux → agitation →
 * climax) calculé sur le temps de jeu local : le décor reste vivant sans musique, la musique ne fait qu'amplifier (basses, impacts, montées) et se tait dans
 * les passages calmes.
 *
 * Tout est DERRIÈRE l'orbite, les menaces et le vaisseau (profondeurs < 0,6, sous le voile de la zone de jeu ; seul le foyer lumineux du centre passe au-dessus du
 * voile, comme l'ancien noyau). Les réactions viennent de la carte musicale lue à la position ENTENDUE (`AmbienceState` : basses, percussions, montées, impacts,
 * passages calmes) : rien ne bat sans musique, les passages calmes ralentissent tout. Objets créés une seule fois (pools fixes), aucune allocation par image.
 * Purement décoratif : `Math.random` seul, jamais lu par la simulation.
 */

const D = AMBIENCE.world3.decor;
const C = D.colors;

interface Drifter {
  img: Phaser.GameObjects.Image;
  /** Position de base (fraction de la grande dimension d'écran, depuis le centre de l'arène) et amplitude de la dérive. */
  bx: number;
  by: number;
  ax: number;
  ay: number;
  size: number;
  phase: number;
  /** Vitesse de phase propre (rad/s, avant le plan) et rotation propre. */
  rate: number;
  spin: number;
  rot0: number;
  alpha: number;
  tint: number;
  layer: 0 | 1 | 2;
  /** Plan de profondeur 0–1 (0 = très loin, 1 = proche) : parallaxe, secousse des impacts. */
  depth: number;
  /** Étirement vertical de l'affichage (nuages aplatis). */
  squash: number;
  /** Position perpendiculaire au vent (× u), phase de traversée (0–1) et distance parcourue (u). */
  perp: number;
  pos: number;
  trav: number;
}

interface Passer {
  img: Phaser.GameObjects.Image;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  spin: number;
  depth: number;
  flip: boolean;
  tex: number;
  alpha: number;
  age: number;
}

interface Ring {
  img: Phaser.GameObjects.Image;
  age: number;
  life: number;
  power: number;
}

interface Layer {
  sprite: Phaser.GameObjects.TileSprite;
  x: number;
  y: number;
}

interface Rock {
  img: Phaser.GameObjects.Image;
  glint: Phaser.GameObjects.Image;
  fall: Phaser.GameObjects.Image | null;
  bx: number;
  by: number;
  size: number;
  phase: number;
  rate: number;
  alpha: number;
  haze: number;
  depth: number;
  flip: boolean;
  rot0: number;
}

const MOTES = 70;
const SPAN = 1.6;
/** Cap du vent (rad, écran : y vers le bas) : le gaz monte vers le coin supérieur droit, comme les courants des références. */
const WIND = -0.6;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};
const wrapSpan = (x: number): number => ((((x + SPAN / 2) % SPAN) + SPAN) % SPAN) - SPAN / 2;

export class NebulaDecor {
  private jobs: (() => void)[] = [];
  private built = false;
  private readonly sky: Phaser.GameObjects.Image;
  private readonly far: Drifter[] = [];
  private readonly mid: Drifter[] = [];
  private readonly smoke: Drifter[] = [];
  private readonly near: Drifter[] = [];
  private readonly wisps: Drifter[] = [];
  private readonly layers: Layer[] = [];
  private readonly passers: Passer[] = [];
  private readonly rings: Ring[] = [];
  private edge!: Phaser.GameObjects.Image;
  private readonly rocks: Rock[] = [];
  private readonly rays: Phaser.GameObjects.Image[] = [];
  private swirlA!: Phaser.GameObjects.Image;
  private swirlB!: Phaser.GameObjects.Image;
  private swirlC!: Phaser.GameObjects.Image;
  private swirlCore!: Phaser.GameObjects.Image;
  private foyer!: Phaser.GameObjects.Image;
  private foyerHot!: Phaser.GameObjects.Image;
  private planetGlow!: Phaser.GameObjects.Image;
  private planet!: Phaser.GameObjects.Image;
  private ringBack!: Phaser.GameObjects.Image;
  private ringFront!: Phaser.GameObjects.Image;
  private mass!: Phaser.GameObjects.Image;
  private readonly chunks: Phaser.GameObjects.Image[] = [];
  private burst!: Phaser.GameObjects.Image;
  private readonly motes: Phaser.GameObjects.Graphics;
  private readonly warp: Phaser.GameObjects.Graphics;
  private readonly shade: Phaser.GameObjects.Graphics;
  private readonly moteX = new Float32Array(MOTES);
  private readonly moteY = new Float32Array(MOTES);
  private readonly moteV = new Float32Array(MOTES);
  private readonly moteP = new Float32Array(MOTES);
  private readonly warpA = new Float32Array(40);
  private readonly warpR = new Float32Array(40);
  private readonly warpV = new Float32Array(40);
  private swirlRot = 0;
  /** Horloge d'animation propre (s) : avance avec la musique (montées) et ralentit dans les passages calmes. */
  private clock = 0;
  private visible = false;
  private nextPasser = 3;
  private prevDrop = 0;
  private prevBeat = 0;
  private ringGap = 0;
  private sizeKey = '';
  /** Part de la lumière masquée par les géants de passage (0–1), calculée avant le dessin. */
  private occult = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly depth: number, private readonly coreDepth: number) {
    this.sky = scene.add.image(0, 0, AMB_TEX.glow).setDepth(depth - 0.002).setVisible(false);
    this.shade = scene.add.graphics().setDepth(depth + 0.06).setVisible(false);
    this.motes = scene.add.graphics().setDepth(depth + 0.07).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.warp = scene.add.graphics().setDepth(depth + 0.039).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < MOTES; i++) this.resetMote(i, true);
    for (let i = 0; i < this.warpA.length; i++) this.resetWarp(i, true);
  }

  private resetMote(i: number, anywhere: boolean): void {
    this.moteX[i] = (Math.random() - 0.5) * 1.1;
    this.moteY[i] = anywhere ? (Math.random() - 0.5) * 1.6 : 0.85;
    this.moteV[i] = 0.006 + Math.random() * 0.014;
    this.moteP[i] = Math.random() * 6.28;
  }

  private resetWarp(i: number, anywhere: boolean): void {
    this.warpA[i] = Math.random() * 6.2832;
    this.warpR[i] = anywhere ? 0.12 + Math.random() * 0.9 : 0.12 + Math.random() * 0.05;
    this.warpV[i] = 0.6 + Math.random() * 0.9;
  }

  /** Les textures et les objets existent-ils ? */
  get ready(): boolean {
    return this.built;
  }

  /**
   * Génération progressive : un travail court par appel (à appeler une fois par image pendant l'univers 2) ; `all` termine tout d'un coup (saut direct dans
   * l'univers 3). Quand tout est prêt, les objets sont créés.
   */
  prepare(all = false): void {
    if (this.built) return;
    if (this.jobs.length === 0) this.jobs = nebulaJobs(this.scene);
    do {
      const job = this.jobs.shift();
      if (!job) break;
      job();
    } while (all && this.jobs.length > 0);
    if (this.jobs.length === 0) this.build();
  }

  // ————————————————————————— construction

  private build(): void {
    const scene = this.scene;
    const rnd = mulberry(20241029);
    const add = (key: string, depth: number, blend = Phaser.BlendModes.ADD): Phaser.GameObjects.Image => scene.add.image(0, 0, key).setDepth(depth).setVisible(false).setBlendMode(blend);
    // Fond de ciel : dégradé vertical profond (la nébuleuse est posée dessus)
    if (!scene.textures.exists('n-sky')) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 256;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      const hx = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
      g.addColorStop(0, hx(D.sky.top));
      g.addColorStop(0.5, hx(D.sky.mid));
      g.addColorStop(1, hx(D.sky.bottom));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
      scene.textures.addCanvas('n-sky', c);
    }
    this.sky.setTexture('n-sky');
    const base = this.depth;
    // Tuiles de gaz sans couture (couches de courants) : entre le ciel et les nuages
    D.flow.forEach((f, i) => {
      const t = scene.add.tileSprite(0, 0, 64, 64, NEB_TEX.flow[f.tex]).setDepth(base + 0.004 + i * 0.0006).setVisible(false).setBlendMode(f.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      this.layers.push({ sprite: t, x: rnd() * 256, y: rnd() * 256 });
    });
    const clouds = (list: Drifter[], n: number, layer: 0 | 1 | 2, depth: number, sizeR: [number, number], tints: number[], alpha: number, smoke: boolean, depthNorm: number): void => {
      for (let i = 0; i < n; i++) {
        const img = scene.add.image(0, 0, NEB_TEX.cloud[(i + layer) % NEB_TEX.cloud.length]).setDepth(depth + i * 0.0004).setVisible(false).setBlendMode(smoke ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
        list.push({
          img,
          bx: 0,
          by: 0,
          ax: 0.05 + rnd() * 0.1,
          ay: 0.03 + rnd() * 0.07,
          size: sizeR[0] + rnd() * (sizeR[1] - sizeR[0]),
          phase: rnd() * 6.28,
          rate: (0.6 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1),
          spin: (rnd() - 0.5) * 0.04,
          rot0: rnd() * 6.28,
          alpha: alpha * (0.7 + rnd() * 0.6),
          tint: tints[i % tints.length],
          layer,
          depth: depthNorm,
          squash: 0.7 + rnd() * 0.3,
          // Répartis régulièrement le long du courant (pas de paquets), perpendiculairement au vent : décalés
          perp: (rnd() - 0.5) * 0.9,
          pos: (i + rnd() * 0.7) / n,
          trav: 0,
        });
      }
    };
    clouds(this.far, D.counts.far, 0, base + 0.01, D.cloudSize.far as [number, number], [C.deep, C.violet, C.teal, C.violet], D.alpha.far, false, 0.15);
    clouds(this.smoke, D.counts.smoke, 1, base + 0.02, D.cloudSize.smoke as [number, number], [C.smoke], D.alpha.smoke, true, 0.4);
    clouds(this.mid, D.counts.mid, 1, base + 0.03, D.cloudSize.mid as [number, number], [C.turquoise, C.teal, C.aqua, C.deep], D.alpha.mid, false, 0.5);
    clouds(this.near, D.counts.near, 2, base + 0.05, D.cloudSize.near as [number, number], [C.aqua, C.turquoise, C.ice], D.alpha.near, false, 0.9);
    // Filaments lumineux (courants de gaz) : longs, fins, étirés, traversant l'écran dans le sens du vent
    for (let i = 0; i < D.counts.wisps; i++) {
      const img = scene.add.image(0, 0, NEB_TEX.wisp[i % NEB_TEX.wisp.length]).setDepth(base + 0.037 + i * 0.0003).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.wisps.push({
        img,
        bx: 0,
        by: 0,
        ax: 0.03 + rnd() * 0.05,
        ay: 0.02 + rnd() * 0.04,
        size: D.cloudSize.wisp[0] + rnd() * (D.cloudSize.wisp[1] - D.cloudSize.wisp[0]),
        phase: rnd() * 6.28,
        rate: (0.7 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1),
        spin: 0,
        rot0: WIND + (rnd() - 0.5) * 0.5,
        alpha: D.alpha.wisp * (0.7 + rnd() * 0.6),
        tint: [C.aqua, C.turquoise, C.ice][i % 3],
        layer: 2,
        depth: 0.7,
        squash: 0.34,
        perp: (rnd() - 0.5) * 1.1,
        pos: (i + rnd() * 0.8) / D.counts.wisps,
        trav: 0,
      });
    }
    this.edge = scene.add.image(0, 0, AMB_TEX.vignette).setDepth(base + 0.058).setVisible(false);
    // Tourbillon : trois plans contrarotatifs + foyer lumineux
    this.swirlC = add(NEB_TEX.swirl, base + 0.0075);
    this.swirlA = add(NEB_TEX.swirl, base + 0.008);
    this.swirlB = add(NEB_TEX.swirl, base + 0.009);
    this.swirlCore = add(NEB_TEX.swirl, this.coreDepth + 0.001);
    this.foyer = add(AMB_TEX.glow, this.coreDepth);
    this.foyerHot = add(AMB_TEX.glow, this.coreDepth + 0.002);
    // Planète à anneau et ses rayons
    // (au-dessus de la fumée sombre : la planète reste lumineuse, les nuages additifs passent devant)
    this.planetGlow = add(AMB_TEX.glow, base + 0.0215);
    this.ringBack = add(NEB_TEX.ringBack, base + 0.0218, Phaser.BlendModes.NORMAL);
    this.planet = add(NEB_TEX.planet, base + 0.022, Phaser.BlendModes.NORMAL);
    this.ringFront = add(NEB_TEX.ringFront, base + 0.0222, Phaser.BlendModes.NORMAL);
    for (let i = 0; i < D.counts.rays; i++) this.rays.push(add(NEB_TEX.ray, base + 0.0225).setOrigin(0.5, 0));
    // Ondes de choc des impacts
    for (let i = 0; i < D.tiers.high.rings; i++) this.rings.push({ img: add(NEB_TEX.shock, base + 0.0345), age: 99, life: 1, power: 0 });
    // Géants de passage : monolithes qui traversent le fond
    for (let i = 0; i < D.passers.max + 1; i++) {
      this.passers.push({ img: add(NEB_TEX.rock[i % NEB_TEX.rock.length], base + 0.045, Phaser.BlendModes.NORMAL), active: false, x: 0, y: 0, vx: 0, vy: 0, size: 0, rot: 0, spin: 0, depth: 0.5, flip: false, tex: 0, alpha: 0, age: 0 });
    }
    // Monolithes et îlots : trois plans
    const rock = (plan: 'far' | 'mid' | 'near', depth: number, depthNorm: number, falls: boolean): void => {
      const r = D.rocks[plan];
      r.slots.forEach(([sx, sy], i) => {
        const k = (i * 2 + (plan === 'far' ? 0 : plan === 'mid' ? 1 : 3)) % NEB_TEX.rock.length;
        const img = add(NEB_TEX.rock[k], depth + i * 0.0005, Phaser.BlendModes.NORMAL);
        const glint = add(NEB_TEX.rock[k], depth + i * 0.0005 + 0.0002);
        const fall = falls && k !== 3 ? add(NEB_TEX.streak, depth + i * 0.0005 + 0.0003).setOrigin(0.5, 0) : null;
        this.rocks.push({
          img,
          glint,
          fall,
          bx: sx,
          by: sy,
          size: r.size[0] + rnd() * (r.size[1] - r.size[0]),
          phase: rnd() * 6.28,
          rate: 0.15 + rnd() * 0.2,
          alpha: r.alpha,
          haze: r.haze,
          depth: depthNorm,
          // La lumière vient du centre : les blocs de droite sont retournés
          flip: sx > 0,
          rot0: (rnd() - 0.5) * 0.14,
        });
      });
    };
    rock('far', base + 0.018, 0.25, false);
    rock('mid', base + 0.034, 0.55, true);
    rock('near', base + 0.052, 1, true);
    // Éclipse : masse colossale, morceaux, éclat de la révélation
    this.mass = add(NEB_TEX.rock[0], base + 0.055, Phaser.BlendModes.NORMAL);
    for (let i = 0; i < D.eclipse.chunks; i++) this.chunks.push(add(NEB_TEX.rock[(i % 2) * 2 + 2], base + 0.056, Phaser.BlendModes.NORMAL));
    this.burst = add(AMB_TEX.glow, base + 0.058);
    this.built = true;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (!v) this.hideAll();
  }

  private hideAll(): void {
    this.sky.setVisible(false);
    for (const l of [this.far, this.mid, this.smoke, this.near, this.wisps]) for (const d of l) d.img.setVisible(false);
    for (const r of this.rocks) {
      r.img.setVisible(false);
      r.glint.setVisible(false);
      r.fall?.setVisible(false);
    }
    for (const r of this.rays) r.setVisible(false);
    for (const l of this.layers) l.sprite.setVisible(false);
    for (const p of this.passers) {
      p.img.setVisible(false);
      p.active = false;
    }
    for (const r of this.rings) {
      r.img.setVisible(false);
      r.age = 99;
    }
    if (this.built) {
      for (const o of [this.edge, this.swirlA, this.swirlB, this.swirlC, this.swirlCore, this.foyer, this.foyerHot, this.planetGlow, this.planet, this.ringBack, this.ringFront, this.mass, this.burst, ...this.chunks]) o.setVisible(false);
    }
    this.motes.clear().setVisible(false);
    this.warp.clear().setVisible(false);
    this.shade.clear().setVisible(false);
    this.nextPasser = 3;
    this.occult = 0;
  }

  // ————————————————————————— dessin

  /** Géants de passage : apparition (rythme selon l'arc), déplacement, occultation de la lumière (calcul AVANT le dessin du reste). */
  private updatePassers(s: AmbienceState, dt: number, speed: number, prog: number, max: number): void {
    const P = D.passers;
    const eclApproach = s.eclipse.active && s.eclipse.scatter === 0;
    this.nextPasser -= dt * (0.6 + 0.4 * speed);
    let alive = 0;
    for (const p of this.passers) if (p.active) alive++;
    if (this.nextPasser <= 0 && alive < max && !eclApproach) {
      const p = this.passers.find((q) => !q.active);
      if (p) {
        const depth = 0.2 + Math.random() * 0.8;
        p.active = true;
        p.depth = depth;
        p.size = lerp(P.size[0], P.size[1], depth) * (0.85 + 0.3 * Math.random());
        const spd = lerp(P.speed[0], P.speed[1], depth) * (0.55 + 1.5 * prog);
        const ang = WIND + (Math.random() - 0.5) * 0.9 + (Math.random() < 0.3 ? Math.PI : 0);
        const perp = (Math.random() - 0.5) * 0.85;
        const half = 0.62 + p.size * 0.5;
        // Position en u depuis le centre de l'arène : on part du bord opposé au sens de marche, décalé perpendiculairement
        p.x = -Math.cos(ang) * half - Math.sin(ang) * perp;
        p.y = -Math.sin(ang) * half + Math.cos(ang) * perp;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd;
        p.rot = (Math.random() - 0.5) * 0.6;
        p.spin = (Math.random() - 0.5) * 0.05 * (0.5 + prog);
        p.flip = Math.random() < 0.5;
        p.tex = Math.floor(Math.random() * NEB_TEX.rock.length);
        p.alpha = P.alpha * (0.55 + 0.45 * depth);
        p.age = 0;
        p.img.setTexture(NEB_TEX.rock[p.tex]).setDepth(this.depth + (depth < 0.5 ? 0.0195 : 0.045));
        this.nextPasser = lerp(P.interval[0], P.interval[1], prog) * (0.7 + 0.6 * Math.random());
      }
    }
    let occ = 0;
    for (const p of this.passers) {
      if (!p.active) continue;
      p.age += dt;
      p.x += p.vx * dt * (0.6 + 0.4 * speed);
      p.y += p.vy * dt * (0.6 + 0.4 * speed);
      p.rot += p.spin * dt;
      const ahead = (p.x * p.vx + p.y * p.vy) / (Math.hypot(p.vx, p.vy) || 1);
      if (ahead > 0.62 + p.size * 0.5) p.active = false;
      else if (p.depth > 0.5) {
        const d = Math.hypot(p.x, p.y);
        occ = Math.max(occ, (1 - smooth01(d / (p.size * 0.55 + 0.04))) * p.alpha);
      }
    }
    this.occult = occ;
  }

  /** `amount` : présence du décor (0–1, fondus de transition). */
  draw(s: AmbienceState, v: AmbienceView, dt: number, amount: number): void {
    if (amount <= 0.004) {
      if (this.built) this.hideAll();
      return;
    }
    if (!this.built) this.prepare(true);
    const q = D.tiers[s.tier];
    const React = D.react;
    const reduced = s.reduced;
    const calm = s.calm;
    const prog = s.neb;
    const climax = smooth01((prog - 0.84) / 0.16);
    // Horloge d'animation : la musique accélère (montées, intensité), un passage calme ralentit ; effets réduits = mouvement atténué.
    // L'ARC (`prog`) accélère tout le décor, musique ou non.
    const speed = (reduced ? 0.4 : 1) * (1 + React.build * 1.6 * s.build + 0.5 * s.intensity) * (1 - React.calm * calm);
    this.clock += dt * speed;
    const ck = this.clock;
    const fs = 0.35 + 1.9 * prog;
    const dtm = dt * speed;
    const u = Math.max(v.width, v.height);
    const W = v.width;
    const H = v.height;
    const ecl = s.eclipse;
    // Sortie vers le Monde des vents : le tourbillon accélère, la brume vire à l'ambre et tout est aspiré vers le centre
    const toWinds = s.variant === 'spiral' ? s.worldMix : 0;
    const spinUp = s.variant === 'spiral' && s.transit > 0 ? s.transit * 2.4 : 0;
    const pull = 1 - 0.5 * toWinds;
    const hot = 0xff8a2a;
    const mix = (c: number): number => (toWinds > 0 ? lerpColor(c, hot, toWinds * 0.8) : c);
    const bright = (c: number): number => mix(climax > 0 ? lerpColor(c, C.ice, 0.3 * climax) : c);

    // Géants de passage : déplacement et occultation (avant le calcul de la lumière)
    const maxPass = Math.max(1, Math.round(D.passers.max * q.passers));
    this.updatePassers(s, dt, speed, prog, maxPass);

    // Lumière globale : le début est sombre et mystérieux, l'éclipse l'éteint, la révélation la rallume (au-delà du niveau normal pendant quelques secondes)
    const lum = 0.62 + 0.38 * Math.pow(prog, 0.8);
    const light = clamp01(1 - ecl.dark * 0.95) * (1 + D.eclipse.glow * ecl.glow) * (1 + 0.5 * ecl.flash) * (1 - D.passers.occult * this.occult);
    const pulse = 1 + React.bass * s.bass * 0.5 + React.drop * s.drop * 0.55;
    const k = amount * s.user;
    const kick = reduced ? 0 : React.kick * s.drop * v.scale;

    // Vent et caméra flottante (parallaxe : chaque plan suit à sa profondeur)
    const phi = WIND + 0.22 * Math.sin(ck * 0.021);
    const wx = Math.cos(phi);
    const wy = Math.sin(phi);
    const camA = D.cam.amp * (reduced ? 0.4 : 1) * (0.6 + 0.8 * prog);
    const camX = camA * (Math.sin(ck * D.cam.rate) + 0.45 * Math.sin(ck * D.cam.rate * 2.8 + 1.3));
    const camY = camA * 0.7 * (Math.cos(ck * D.cam.rate * 0.83 + 0.6) + 0.4 * Math.sin(ck * D.cam.rate * 2.3 + 2.1));

    // Fond
    this.sky.setVisible(true).setPosition(W / 2, H / 2).setDisplaySize(W + 4, H + 4).setAlpha(amount * (0.55 + 0.45 * light));

    // Courants : tuiles de gaz qui défilent en sens contraires (les couches se déforment l'une l'autre)
    const key = `${W}x${H}`;
    const nFlow = Math.min(this.layers.length, q.flow);
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i];
      const f = D.flow[i];
      if (i >= nFlow) {
        L.sprite.setVisible(false);
        continue;
      }
      const ts = (f.scale * u) / 256;
      if (this.sizeKey !== key) {
        L.sprite.setSize(W + 4, H + 4).setTileScale(ts * f.stretch, ts);
      }
      const ang = f.dir + 0.12 * Math.sin(ck * 0.03 + i * 1.7);
      const vel = f.speed * fs * u * dtm;
      L.x += (Math.cos(ang) * vel) / (ts * f.stretch);
      L.y += (Math.sin(ang) * vel) / ts;
      const react = f.reactive * (0.5 * s.bass * React.bass * 2 + 0.45 * s.drop + 0.5 * s.build + 0.3 * s.perc);
      let a: number;
      let tint: number;
      if (f.add) {
        a = f.alpha * k * lum * light * (1 + react) * (0.85 + 0.15 * Math.sin(ck * 0.2 + i * 2)) * (1 - 0.4 * calm) * (f.tex === 1 ? 0.5 + 1.0 * prog : 1);
        tint = bright(C[f.color]);
      } else {
        a = f.alpha * k * (1.4 - 0.75 * prog) * (1 + 0.8 * ecl.dark) * (1 + 0.4 * calm);
        tint = mix(C[f.color]);
      }
      L.sprite.setVisible(true).setPosition(W / 2, H / 2).setTint(tint).setAlpha(Math.min(0.75, a));
      L.sprite.tilePositionX = L.x;
      L.sprite.tilePositionY = L.y;
    }
    this.sizeKey = key;

    // Nuages : ils traversent l'écran dans le sens du vent (le plan proche file plus vite), se déforment en respirant
    const place = (d: Drifter, lv: number, cam: number): number => {
      d.trav += dtm * lv * fs;
      const T = wrapSpan(d.pos * SPAN + d.trav);
      const ph = ck * d.rate * (0.06 + 0.11 * d.depth) + d.phase;
      const ox = d.ax * Math.sin(ph) + 0.35 * d.ax * Math.sin(ph * 0.37 + d.phase * 2);
      const oy = d.ay * Math.cos(ph * 0.83) + 0.3 * d.ay * Math.sin(ph * 0.29 + d.phase);
      const pr = d.perp * pull;
      let X = v.cx + ((wx * T - wy * pr) * pull + ox - camX * cam) * u;
      let Y = v.cy + ((wy * T + wx * pr) * pull + oy - camY * cam) * u;
      if (kick > 0) {
        const dx = X - v.cx;
        const dy = Y - v.cy;
        const n = Math.hypot(dx, dy) || 1;
        X += (dx / n) * kick * d.depth * 2;
        Y += (dy / n) * kick * d.depth * 2;
      }
      const sz = d.size * u * (1 + 0.05 * Math.sin(ph * 1.7)) * (1 + 0.04 * s.bass * d.depth);
      // Déformation : la brume s'étire et s'aplatit tour à tour, en tournant lentement
      d.img
        .setVisible(true)
        .setPosition(X, Y)
        .setDisplaySize(sz * (1 + 0.14 * Math.sin(ph * 1.3 + 1)), sz * d.squash * (1 + 0.14 * Math.cos(ph * 1.9)))
        .setRotation(d.rot0 + d.spin * ck + 0.12 * Math.sin(ph * 0.9));
      // Fondu aux extrémités du parcours
      return 1 - smooth01((Math.abs(T) / (SPAN / 2) - 0.6) / 0.4);
    };
    const nFar = Math.max(1, Math.round(this.far.length * q.clouds));
    const nMid = Math.max(1, Math.round(this.mid.length * q.clouds));
    const nNear = Math.max(0, Math.round(this.near.length * q.clouds));
    const nSmoke = Math.max(1, Math.round(this.smoke.length * q.clouds));
    const CD = D.cam.depth;
    for (let i = 0; i < this.far.length; i++) {
      const d = this.far[i];
      if (i >= nFar) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.far, CD.far);
        d.img.setTint(mix(d.tint)).setAlpha(Math.min(0.8, d.alpha * e * k * light * lum * (0.9 + 0.35 * s.bass)));
      }
    }
    for (let i = 0; i < this.smoke.length; i++) {
      const d = this.smoke[i];
      if (i >= nSmoke) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.smoke, CD.smoke);
        // La fumée creuse la profondeur ; épaisse au début (mystère), plus sombre et plus présente dans la pénombre de l'éclipse
        d.img.setTint(mix(d.tint)).setAlpha(Math.min(0.85, d.alpha * e * k * (1.35 - 0.6 * prog) * (1 + 0.8 * ecl.dark) * (1 + 0.5 * calm)));
      }
    }
    for (let i = 0; i < this.mid.length; i++) {
      const d = this.mid[i];
      if (i >= nMid) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.mid, CD.mid);
        d.img.setTint(bright(d.tint)).setAlpha(Math.min(0.7, d.alpha * e * k * light * lum * (0.9 + 0.5 * s.bass + 0.35 * s.build + 0.25 * s.perc)));
      }
    }
    for (let i = 0; i < this.near.length; i++) {
      const d = this.near[i];
      if (i >= nNear) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.near, CD.near);
        d.img.setTint(bright(d.tint)).setAlpha(Math.min(0.5, d.alpha * e * k * light * lum * (0.8 + 0.6 * s.bass + 0.5 * s.build) * (1 - 0.35 * calm)));
      }
    }

    // Filaments lumineux : les courants les plus rapides, qui traversent tout l'écran
    const nWisp = Math.round(this.wisps.length * q.wisps);
    for (let i = 0; i < this.wisps.length; i++) {
      const d = this.wisps[i];
      if (i >= nWisp) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.wisp, CD.wisp);
        d.img.setTint(bright(d.tint)).setAlpha(Math.min(0.6, d.alpha * e * k * light * lum * (0.45 + 0.9 * prog + 0.8 * s.bass + 0.9 * s.build + 0.5 * s.perc) * (1 - 0.5 * calm)));
      }
    }
    // Bords sombres : profondeur et lisibilité (les coins plongent dans le noir bleu, comme dans les références)
    const ed = v.halfDiag * D.edge.size;
    this.edge.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(ed, ed).setAlpha(D.edge.alpha * amount * (1 + 0.5 * ecl.dark) * (1.1 - 0.25 * climax));

    // Tourbillon : rotation lente (de plus en plus vive avec l'arc et les montées), respiration, éclat sur les basses et les impacts
    this.swirlRot += dt * (D.swirl.spin * (reduced ? 0.4 : 1) * (1 + React.build * 1.2 * s.build + 0.6 * s.intensity + 2.2 * prog) * (1 - 0.5 * calm) + spinUp * 0.6);
    const sw = D.swirl.size * u * (1 + 0.04 * Math.sin(ck * 0.35) + 0.05 * s.bass + 0.06 * climax);
    const sa = D.swirl.alpha * k * light * pulse * (0.7 + 0.3 * prog) * (1 + 0.3 * climax);
    this.swirlC.setVisible(true).setPosition(v.cx - camX * u * 0.04, v.cy - camY * u * 0.04).setDisplaySize(sw * 1.3, sw * 1.3).setRotation(-this.swirlRot * 0.55 + 2).setTint(mix(C.violet)).setAlpha(Math.min(0.5, 0.42 * sa * (0.4 + 0.6 * prog)));
    this.swirlA.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(sw, sw).setRotation(this.swirlRot).setTint(bright(C.turquoise)).setAlpha(Math.min(0.85, sa));
    this.swirlB.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(sw * 0.62, sw * 0.62).setRotation(-this.swirlRot * 1.4 + 1).setTint(bright(C.aqua)).setAlpha(Math.min(0.75, sa * 0.8));
    const fo = D.swirl.coreSize * v.scale * (1 + 0.28 * s.bass + 0.3 * s.drop + 0.25 * climax);
    this.foyer.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(fo, fo).setTint(bright(C.turquoise)).setAlpha(Math.min(0.9, D.swirl.coreAlpha * k * (0.45 + 0.55 * light) * (0.55 + 0.45 * prog) * (0.9 + 0.25 * s.beat)));
    this.foyerHot.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(fo * 0.3, fo * 0.3).setTint(mix(C.ice)).setAlpha(Math.min(1, 0.85 * k * (0.5 + 0.5 * light) * (0.6 + 0.4 * prog)));
    this.swirlCore.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(fo * 1.15, fo * 1.15).setRotation(this.swirlRot * 2.2).setTint(mix(C.ice)).setAlpha(Math.min(0.8, 0.5 * k * light * (0.5 + 0.5 * prog)));

    // Ondes de choc : un anneau jaillit du foyer sur chaque impact (et sur les battements forts de l'apogée)
    this.ringGap -= dt;
    const dropHit = s.drop > 0.55 && this.prevDrop <= 0.55;
    const beatHit = climax > 0.4 && s.beat > 0.7 && this.prevBeat <= 0.7;
    this.prevDrop = s.drop;
    this.prevBeat = s.beat;
    if ((dropHit || beatHit) && this.ringGap <= 0 && !reduced) {
      const r = this.rings.find((x) => x.age >= x.life);
      if (r) {
        r.age = 0;
        r.life = D.shock.life * (dropHit ? 1 : 0.75);
        r.power = dropHit ? 1 : 0.55;
        this.ringGap = D.shock.gap;
      }
    }
    const nRings = Math.min(this.rings.length, q.rings);
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.age >= r.life || i >= nRings) {
        r.img.setVisible(false);
        continue;
      }
      r.age += dt;
      const t = r.age / r.life;
      const d = (0.12 + D.shock.speed * r.age) * u * 2;
      r.img.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(d, d).setTint(bright(C.aqua)).setAlpha(Math.min(0.7, D.shock.alpha * r.power * k * (1 - t) ** 1.6 * (0.6 + 0.4 * light)));
    }

    // Planète à anneau et rayons : elle émerge peu à peu de la brume
    const P = D.planet;
    const px = v.cx + (P.x * W - camX * u * D.cam.depth.planet) * pull;
    const py = v.cy + (P.y * H - camY * u * D.cam.depth.planet) * pull;
    const ps = P.size * u;
    const bob = Math.sin(ck * 0.05) * 0.004 * u;
    const reveal = 0.4 + 0.6 * smooth01(prog / 0.45);
    const pa = Math.min(1, P.alpha * k) * (0.35 + 0.65 * light) * reveal;
    this.planetGlow.setVisible(true).setPosition(px, py + bob).setDisplaySize(ps * 3.2, ps * 3.2).setTint(bright(C.turquoise)).setAlpha(Math.min(0.7, P.glow * k * light * lum * (0.8 + 0.4 * s.bass + 0.4 * s.drop + 0.4 * climax)));
    this.ringBack.setVisible(true).setPosition(px, py + bob).setDisplaySize(ps * P.ring, ps * P.ring * 0.31).setRotation(P.tilt).setTint(mix(0xffffff)).setAlpha(pa * 0.8);
    this.planet.setVisible(true).setPosition(px, py + bob).setDisplaySize(ps, ps).setTint(toWinds > 0 ? mix(0xffffff) : 0xffffff).setAlpha(pa);
    this.ringFront.setVisible(true).setPosition(px, py + bob).setDisplaySize(ps * P.ring, ps * P.ring * 0.31).setRotation(P.tilt).setTint(mix(0xffffff)).setAlpha(pa * 0.9);
    const toCore = Math.atan2(v.cy - py, v.cx - px) - Math.PI / 2;
    const nRays = Math.round(this.rays.length * q.rays);
    for (let i = 0; i < this.rays.length; i++) {
      const r = this.rays[i];
      if (i >= nRays) {
        r.setVisible(false);
        continue;
      }
      const off = (i - (this.rays.length - 1) / 2) * 0.2 + 0.04 * Math.sin(ck * 0.07 + i * 2) + 0.05 * Math.sin(ck * 0.19 + i);
      const a = D.rays.alpha * k * light * (0.25 + 0.75 * prog) * (0.45 + 1.3 * s.build + 1.0 * s.drop + 0.6 * s.bass + 0.8 * climax) * (0.7 + 0.3 * Math.sin(ck * 0.3 + i * 1.9));
      r.setVisible(true).setPosition(px, py).setRotation(toCore + off).setDisplaySize(u * 0.22, u * D.rays.length).setTint(bright(C.aqua)).setAlpha(Math.min(0.55, a));
    }

    // Monolithes et îlots : flottement, balancement (plus ample avec l'arc), parallaxe de la caméra, liseré de lumière sur les percussions, brume, cascades
    const nRocks = this.rocks.length;
    const keep = Math.max(1, Math.round(nRocks * q.rocks));
    const agit = 0.7 + 1.3 * prog;
    for (let i = 0; i < nRocks; i++) {
      const r = this.rocks[i];
      if (i >= keep) {
        r.img.setVisible(false);
        r.glint.setVisible(false);
        r.fall?.setVisible(false);
        continue;
      }
      const ph = ck * r.rate * 0.4 + r.phase;
      const par = 0.15 + 1.9 * r.depth * r.depth;
      const x = r.bx * pull + Math.sin(ph * 0.7) * D.rocks.sway * (0.4 + r.depth) * agit - camX * par;
      const y = r.by * pull + Math.sin(ph) * D.rocks.bob * agit - camY * par;
      let X = v.cx + x * W;
      let Y = v.cy + y * H;
      if (kick > 0) {
        const dx = X - v.cx;
        const dy = Y - v.cy;
        const n = Math.hypot(dx, dy) || 1;
        X += (dx / n) * kick * r.depth * 3;
        Y += (dy / n) * kick * r.depth * 3;
      }
      const sz = r.size * u;
      const rot = r.rot0 + Math.sin(ph * 0.6) * 0.03 * agit + spinUp * 0.15 * (i % 2 ? 1 : -1);
      const dark = 1 - ecl.dark * 0.55;
      const shade = lerpColor(0x1a2a30, 0xffffff, dark);
      r.img.setVisible(true).setPosition(X, Y).setDisplaySize(sz, sz * 1.25).setFlipX(r.flip).setRotation(r.flip ? -rot : rot).setTint(mix(shade)).setAlpha(Math.min(1, r.alpha * amount * s.user));
      // Lueur additive : brume atmosphérique (plans lointains) + éclat des percussions et des impacts sur les arêtes
      const gl = r.haze * 0.45 * light + (reduced ? 0 : React.perc * s.perc * 0.55 + 0.25 * s.drop) * (0.4 + 0.6 * r.depth) + 0.12 * climax * r.depth;
      if (gl > 0.01) r.glint.setVisible(true).setPosition(X, Y).setDisplaySize(sz, sz * 1.25).setFlipX(r.flip).setRotation(r.flip ? -rot : rot).setTint(mix(C.haze)).setAlpha(Math.min(0.75, gl * k));
      else r.glint.setVisible(false);
      if (r.fall && q.falls > 0) {
        const fl = sz * 1.25 * 0.78;
        r.fall
          .setVisible(true)
          .setPosition(X + (r.flip ? -1 : 1) * sz * 0.02, Y + sz * 1.25 * 0.38)
          .setDisplaySize(sz * 0.36, fl)
          .setRotation(rot * 0.3)
          .setTint(mix(C.aqua))
          .setAlpha(Math.min(0.5, 0.3 * k * light * (0.7 + 0.5 * s.bass + 0.3 * s.build) * (0.8 + 0.2 * Math.sin(ck * 1.3 + i))));
      } else r.fall?.setVisible(false);
    }

    // Géants de passage : dessin (dissous dans la brume au-dessus de la zone de jeu, pour que les menaces restent lisibles)
    const arenaPx = v.scale * 330;
    for (const p of this.passers) {
      if (!p.active) {
        p.img.setVisible(false);
        continue;
      }
      const X = v.cx + (p.x * pull - camX * (0.15 + 1.6 * p.depth * p.depth)) * u;
      const Y = v.cy + (p.y * pull - camY * (0.15 + 1.6 * p.depth * p.depth)) * u;
      const near = Math.hypot(X - v.cx, Y - v.cy);
      const over = smooth01((near - arenaPx * 0.55) / (arenaPx * 0.7));
      const env = smooth01(p.age / 2.5);
      const sz = p.size * u;
      const hz = 1 - p.depth;
      const shade = lerpColor(0x10242b, 0x4f8d98, hz * 0.7);
      p.img
        .setVisible(true)
        .setPosition(X, Y)
        .setDisplaySize(sz, sz * 1.25)
        .setFlipX(p.flip)
        .setRotation(p.rot)
        .setTint(mix(shade))
        .setAlpha(Math.min(1, p.alpha * (0.35 + 0.65 * over) * env * amount * s.user * (1 - 0.35 * ecl.dark)));
    }

    // Éclipse des géants : la masse glisse devant la lumière, puis se brise sur l'impact ; l'éclat de la révélation éclaire la nébuleuse
    const E = D.eclipse;
    const sh = this.shade;
    sh.clear();
    if (ecl.active && ecl.scatter < 1) {
      const m = ecl.mass;
      const ex = v.cx + (-1.05 + 1.05 * m) * u * pull;
      const ey = v.cy + E.y * u;
      const scatter = ecl.scatter;
      const fade = 1 - clamp01(scatter * 3);
      this.mass
        .setVisible(fade > 0.01)
        .setPosition(ex, ey)
        .setDisplaySize(E.size * u * (1 + 0.5 * scatter), E.size * u * 1.15 * (1 + 0.5 * scatter))
        .setRotation(-0.06 + 0.05 * m)
        .setTint(0x244551)
        .setAlpha(E.alpha * amount * s.user * fade * (0.5 + 0.5 * clamp01(m * 2)));
      for (let i = 0; i < this.chunks.length; i++) {
        const c = this.chunks[i];
        if (scatter <= 0) {
          c.setVisible(false);
          continue;
        }
        const a = (i / this.chunks.length) * 6.283 + 0.4;
        const dist = (0.1 + scatter * (0.55 + 0.1 * (i % 3))) * u;
        c.setVisible(true)
          .setPosition(v.cx + Math.cos(a) * dist, ey + Math.sin(a) * dist)
          .setDisplaySize(u * (0.28 + 0.06 * (i % 3)) * (1 + scatter * 0.3), u * (0.34 + 0.06 * (i % 3)))
          .setRotation(a + scatter * (i % 2 ? 2.2 : -1.8))
          .setFlipX(Math.cos(a) > 0)
          .setTint(0x0d2229)
          .setAlpha(clamp01(1 - scatter * 1.05) * amount * s.user);
      }
      if (ecl.dark > 0.005 && !ecl.scatter) {
        sh.setVisible(true);
        sh.fillStyle(0x01060a, Math.min(0.7, E.shade * ecl.dark * amount));
        sh.fillRect(0, 0, W, H);
      }
    } else {
      this.mass.setVisible(false);
      for (const c of this.chunks) c.setVisible(false);
    }
    if (ecl.flash > 0.01) {
      const b = u * 2.1;
      this.burst.setVisible(true).setPosition(v.cx, v.cy).setDisplaySize(b, b).setTint(mix(C.ice)).setAlpha(Math.min(1, E.flash * ecl.flash * amount * (reduced ? 0.5 : 1)));
    } else this.burst.setVisible(false);

    // Lignes de vitesse de l'apogée : le fond file vers l'extérieur
    const wg = this.warp;
    wg.clear();
    const nWarp = reduced ? 0 : Math.round(Math.min(this.warpA.length, D.warp.lines) * q.warp);
    const warpAmt = smooth01((prog - 0.55) / 0.4) * (1 - 0.7 * calm);
    if (nWarp > 0 && warpAmt > 0.01) {
      wg.setVisible(true);
      for (let i = 0; i < nWarp; i++) {
        this.warpR[i] += (0.05 + this.warpR[i] * 1.5) * this.warpV[i] * (0.5 + warpAmt) * dtm * 0.9;
        if (this.warpR[i] > 1.0) this.resetWarp(i, false);
        const r = this.warpR[i];
        const a = this.warpA[i];
        const len = 0.02 + r * 0.22 * warpAmt;
        const r0 = Math.max(0.1, r - len);
        const al = Math.min(0.6, D.warp.alpha * warpAmt * k * light * smooth01((r - 0.12) / 0.2) * (1 - smooth01((r - 0.8) / 0.2)) * (0.7 + 0.8 * s.build + 0.6 * s.bass));
        wg.lineStyle((0.8 + 1.6 * r) * v.dpr, i % 3 === 0 ? 0xffffff : mix(C.aqua), al);
        wg.lineBetween(v.cx + Math.cos(a) * r0 * u, v.cy + Math.sin(a) * r0 * u, v.cx + Math.cos(a) * r * u, v.cy + Math.sin(a) * r * u);
      }
    } else wg.setVisible(false);

    // Poussières lumineuses : elles suivent le vent, plus vives et plus rapides avec l'arc
    const m = this.motes;
    m.clear();
    m.setVisible(true);
    const n = Math.min(MOTES, Math.round(s.quality.dust * D.motes));
    const mv = (reduced ? 0.4 : 1) * (1 + 0.6 * s.build + 1.2 * prog) * (1 - 0.5 * calm);
    for (let i = 0; i < n; i++) {
      this.moteY[i] += (this.moteV[i] * wy * mv - 0.004 * mv) * dt;
      this.moteX[i] += this.moteV[i] * wx * mv * 1.4 * dt + Math.sin(ck * 0.3 + this.moteP[i]) * 0.0012 * mv;
      if (this.moteY[i] < -0.85 || this.moteX[i] > 0.7) this.resetMote(i, false);
      const tw = 0.55 + 0.45 * Math.sin(ck * 1.7 + this.moteP[i] * 3) + s.perc * 0.6;
      m.fillStyle(i % 4 === 0 ? 0xffffff : 0x9ff7ee, Math.min(0.9, 0.34 * tw * k * (0.5 + 0.5 * light)));
      m.fillCircle(v.cx + (this.moteX[i] - camX * 2) * u, v.cy + (this.moteY[i] - camY * 2) * u, (0.7 + (i % 4) * 0.4) * v.dpr);
    }
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
