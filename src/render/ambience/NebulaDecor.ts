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
 * VERSION 3 — un VOL continu : tout défile le long d'un cap (le vaisseau traverse l'espace), cinq plans (arrière-plan, lointain, milieu, proche, AVANT-PLAN) aux vitesses
 * étagées, blocs rocheux OPAQUES qui masquent réellement planète, nébuleuse et blocs situés derrière eux, planète en dérive, débris nets et lignes de vitesse.
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
const F = D.flight;

type Plane = 'far' | 'mid' | 'near' | 'fore';
const PLANES: Plane[] = ['far', 'mid', 'near', 'fore'];

/** Nuage, fumée ou filament de gaz : défile le long du cap (`s` = distance parcourue depuis son entrée, en u), perpendiculairement décalé de `lane`. */
interface Drifter {
  img: Phaser.GameObjects.Image;
  size: number;
  phase: number;
  rate: number;
  spin: number;
  rot0: number;
  alpha: number;
  tint: number;
  /** Plan de profondeur 0–1 (0 = très loin, 1 = proche) : parallaxe de la caméra, secousse des impacts. */
  depth: number;
  squash: number;
  ax: number;
  ay: number;
  lane: number;
  s: number;
}

/** Bloc rocheux opaque d'un plan : défile le long du cap, se retire par le bas et revient par le haut sous une autre forme. */
interface Rock {
  img: Phaser.GameObjects.Image;
  glint: Phaser.GameObjects.Image;
  fall: Phaser.GameObjects.Image | null;
  plane: Plane;
  /** Rang dans son plan (les niveaux de qualité gardent les premiers). */
  idx: number;
  lane: number;
  s: number;
  size: number;
  phase: number;
  rate: number;
  spin: number;
  rot: number;
  flip: boolean;
  tex: number;
  hasFall: boolean;
}

/** Petite pierre nette. */
interface Debris {
  img: Phaser.GameObjects.Image;
  lane: number;
  s: number;
  z: number;
  size: number;
  spin: number;
  rot: number;
  tex: number;
  fore: boolean;
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

const MOTES = 70;
const STREAKS = 48;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

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
  private readonly rings: Ring[] = [];
  private readonly rocks: Rock[] = [];
  private readonly debris: Debris[] = [];
  private edge!: Phaser.GameObjects.Image;
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
  private readonly streakG: Phaser.GameObjects.Graphics;
  private readonly shade: Phaser.GameObjects.Graphics;
  private readonly moteX = new Float32Array(MOTES);
  private readonly moteY = new Float32Array(MOTES);
  private readonly moteV = new Float32Array(MOTES);
  private readonly moteP = new Float32Array(MOTES);
  private readonly stLane = new Float32Array(STREAKS);
  private readonly stS = new Float32Array(STREAKS);
  private readonly stZ = new Float32Array(STREAKS);
  private swirlRot = 0;
  /** Planète : distance parcourue le long du cap (u), couloir latéral (u), inclinaison de l'anneau. */
  private planetS = 0;
  private planetLane = -0.17;
  private planetTilt: number = D.planet.tilt;
  /** Horloge d'animation propre (s) : avance avec la musique (montées) et ralentit dans les passages calmes. */
  private clock = 0;
  private visible = false;
  private prevDrop = 0;
  private prevBeat = 0;
  private ringGap = 0;
  private sizeKey = '';

  constructor(private readonly scene: Phaser.Scene, private readonly depth: number, private readonly coreDepth: number) {
    this.sky = scene.add.image(0, 0, AMB_TEX.glow).setDepth(depth - 0.002).setVisible(false);
    this.shade = scene.add.graphics().setDepth(depth + 0.06).setVisible(false);
    this.motes = scene.add.graphics().setDepth(depth + 0.07).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.streakG = scene.add.graphics().setDepth(depth + 0.039).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < MOTES; i++) this.resetMote(i, true);
    for (let i = 0; i < STREAKS; i++) {
      this.stLane[i] = (Math.random() - 0.5) * 1.1;
      this.stS[i] = Math.random() * 1.8;
      this.stZ[i] = Math.random();
    }
  }

  private resetMote(i: number, anywhere: boolean): void {
    this.moteX[i] = (Math.random() - 0.5) * 1.1;
    this.moteY[i] = anywhere ? (Math.random() - 0.5) * 1.6 : -0.85;
    this.moteV[i] = 0.02 + Math.random() * 0.05;
    this.moteP[i] = Math.random() * 6.28;
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
    // ARRIÈRE-PLAN : tuiles de gaz sans couture (entre le ciel et les nuages)
    D.flow.forEach((f, i) => {
      const t = scene.add.tileSprite(0, 0, 64, 64, NEB_TEX.flow[f.tex]).setDepth(base + 0.004 + i * 0.0006).setVisible(false).setBlendMode(f.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      this.layers.push({ sprite: t, x: rnd() * 256, y: rnd() * 256 });
    });
    const clouds = (list: Drifter[], n: number, depth: number, sizeR: [number, number], tints: number[], alpha: number, smoke: boolean, depthNorm: number): void => {
      for (let i = 0; i < n; i++) {
        const img = scene.add.image(0, 0, NEB_TEX.cloud[(i + list.length) % NEB_TEX.cloud.length]).setDepth(depth + i * 0.0004).setVisible(false).setBlendMode(smoke ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
        list.push({
          img,
          size: sizeR[0] + rnd() * (sizeR[1] - sizeR[0]),
          phase: rnd() * 6.28,
          rate: (0.6 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1),
          spin: (rnd() - 0.5) * 0.04,
          rot0: rnd() * 6.28,
          alpha: alpha * (0.7 + rnd() * 0.6),
          tint: tints[i % tints.length],
          depth: depthNorm,
          squash: 0.7 + rnd() * 0.3,
          ax: 0.03 + rnd() * 0.06,
          ay: 0.02 + rnd() * 0.04,
          lane: (rnd() - 0.5) * 0.8,
          // Répartis régulièrement le long du cap (pas de paquets)
          s: ((i + rnd() * 0.7) / n) * 1.8,
        });
      }
    };
    // LOINTAIN : nuages profonds ; MILIEU : fumée, nuages turquoise, filaments ; PROCHE : nuages clairs
    clouds(this.far, D.counts.far, base + 0.01, D.cloudSize.far as [number, number], [C.deep, C.violet, C.teal, C.violet], D.alpha.far, false, 0.15);
    clouds(this.smoke, D.counts.smoke, base + 0.02, D.cloudSize.smoke as [number, number], [C.smoke], D.alpha.smoke, true, 0.4);
    clouds(this.mid, D.counts.mid, base + 0.03, D.cloudSize.mid as [number, number], [C.turquoise, C.teal, C.aqua, C.deep], D.alpha.mid, false, 0.5);
    clouds(this.near, D.counts.near, base + 0.05, D.cloudSize.near as [number, number], [C.aqua, C.turquoise, C.ice], D.alpha.near, false, 0.9);
    for (let i = 0; i < D.counts.wisps; i++) {
      const img = scene.add.image(0, 0, NEB_TEX.wisp[i % NEB_TEX.wisp.length]).setDepth(base + 0.037 + i * 0.0003).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.wisps.push({
        img,
        size: D.cloudSize.wisp[0] + rnd() * (D.cloudSize.wisp[1] - D.cloudSize.wisp[0]),
        phase: rnd() * 6.28,
        rate: (0.7 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1),
        spin: 0,
        rot0: (rnd() - 0.5) * 0.3,
        alpha: D.alpha.wisp * (0.7 + rnd() * 0.6),
        tint: [C.aqua, C.turquoise, C.ice][i % 3],
        depth: 0.7,
        squash: 0.34,
        ax: 0.02 + rnd() * 0.03,
        ay: 0.01 + rnd() * 0.02,
        lane: (rnd() - 0.5) * 0.9,
        s: ((i + rnd() * 0.8) / D.counts.wisps) * 1.8,
      });
    }
    this.edge = scene.add.image(0, 0, AMB_TEX.vignette).setDepth(base + 0.058).setVisible(false);
    // Tourbillon : trois plans contrarotatifs + foyer lumineux (le centre de l'arène : il ne défile pas)
    this.swirlC = add(NEB_TEX.swirl, base + 0.0075);
    this.swirlA = add(NEB_TEX.swirl, base + 0.008);
    this.swirlB = add(NEB_TEX.swirl, base + 0.009);
    this.swirlCore = add(NEB_TEX.swirl, this.coreDepth + 0.001);
    this.foyer = add(AMB_TEX.glow, this.coreDepth);
    this.foyerHot = add(AMB_TEX.glow, this.coreDepth + 0.002);
    // Planète à anneau et ses rayons (LOINTAIN, derrière les blocs du milieu, du proche et de l'avant-plan : ils la masquent réellement)
    this.planetGlow = add(AMB_TEX.glow, base + 0.0215);
    this.ringBack = add(NEB_TEX.ringBack, base + 0.0218, Phaser.BlendModes.NORMAL);
    this.planet = add(NEB_TEX.planet, base + 0.022, Phaser.BlendModes.NORMAL);
    this.ringFront = add(NEB_TEX.ringFront, base + 0.0222, Phaser.BlendModes.NORMAL);
    for (let i = 0; i < D.counts.rays; i++) this.rays.push(add(NEB_TEX.ray, base + 0.0225).setOrigin(0.5, 0));
    // Ondes de choc des impacts
    for (let i = 0; i < D.tiers.high.rings; i++) this.rings.push({ img: add(NEB_TEX.shock, base + 0.0345), age: 99, life: 1, power: 0 });
    // Blocs rocheux OPAQUES, quatre plans
    const depthOf: Record<Plane, number> = { far: base + 0.018, mid: base + 0.034, near: base + 0.052, fore: base + 0.0555 };
    for (const plane of PLANES) {
      const R = D.rocks[plane];
      for (let i = 0; i < R.count; i++) {
        const tex = i === 0 && plane === 'fore' ? 0 : Math.floor(rnd() * NEB_TEX.rock.length);
        const img = add(NEB_TEX.rock[tex], depthOf[plane] + i * 0.0005, Phaser.BlendModes.NORMAL);
        const glint = add(NEB_TEX.rock[tex], depthOf[plane] + i * 0.0005 + 0.0002);
        const fall = plane === 'far' ? null : add(NEB_TEX.streak, depthOf[plane] + i * 0.0005 + 0.0003).setOrigin(0.5, 0);
        const r: Rock = { img, glint, fall, plane, idx: i, lane: 0, s: 0, size: 0, phase: rnd() * 6.28, rate: 0.15 + rnd() * 0.2, spin: 0, rot: 0, flip: false, tex, hasFall: false };
        this.rollRock(r, rnd, true, i);
        this.rocks.push(r);
      }
    }
    // Débris nets : une moitié au premier plan, l'autre au milieu
    for (let i = 0; i < D.debris.count; i++) {
      const fore = rnd() < D.debris.near;
      const img = add(NEB_TEX.debris[i % NEB_TEX.debris.length], fore ? base + 0.0558 : base + 0.04, Phaser.BlendModes.NORMAL);
      const d: Debris = { img, lane: 0, s: rnd() * 1.8, z: fore ? 0.55 + rnd() * 0.45 : rnd() * 0.55, size: 0, spin: 0, rot: 0, tex: i % NEB_TEX.debris.length, fore };
      this.rollDebris(d, rnd);
      this.debris.push(d);
    }
    // Éclipse : masse colossale, morceaux, éclat de la révélation
    this.mass = add(NEB_TEX.rock[0], base + 0.0553, Phaser.BlendModes.NORMAL);
    for (let i = 0; i < D.eclipse.chunks; i++) this.chunks.push(add(NEB_TEX.rock[(i % 2) * 2 + 2], base + 0.056, Phaser.BlendModes.NORMAL));
    this.burst = add(AMB_TEX.glow, base + 0.058);
    this.built = true;
  }

  /** Tire la forme, la taille et le couloir d'un bloc (à la création et à chaque retour par le haut). `first` : position de départ répartie sur tout le trajet. */
  private rollRock(r: Rock, rnd: () => number, first: boolean, i: number): void {
    const R = D.rocks[r.plane];
    r.size = R.size[0] + rnd() * (R.size[1] - R.size[0]);
    // Couloir : alterne gauche/droite (les plans proches restent hors de la zone de jeu), un peu au hasard
    const side = (i + (first ? 0 : Math.floor(rnd() * 3))) % 2 === 0 ? 1 : -1;
    r.lane = side * (R.lane[0] + rnd() * (R.lane[1] - R.lane[0]));
    r.flip = r.lane > 0;
    r.spin = (rnd() - 0.5) * 2 * D.rocks.spin;
    r.rot = (rnd() - 0.5) * 0.3;
    if (!first) {
      r.tex = Math.floor(rnd() * NEB_TEX.rock.length);
      if (r.plane === 'fore' && r.tex === 3) r.tex = 0;
      r.img.setTexture(NEB_TEX.rock[r.tex]);
      r.glint.setTexture(NEB_TEX.rock[r.tex]);
    }
    r.hasFall = r.tex !== 3;
    r.s = first ? ((i + rnd() * 0.6) / D.rocks[r.plane].count) * 1.8 : 0;
  }

  private rollDebris(d: Debris, rnd: () => number): void {
    d.z = d.fore ? 0.55 + rnd() * 0.45 : rnd() * 0.55;
    d.size = lerp(D.debris.size[0], D.debris.size[1], d.z);
    d.spin = (rnd() - 0.5) * 2.2;
    d.rot = rnd() * 6.28;
    d.tex = Math.floor(rnd() * NEB_TEX.debris.length);
    d.img.setTexture(NEB_TEX.debris[d.tex]);
    // Les plus proches évitent le disque de l'arène : petites et rapides, elles ne doivent pas se confondre avec une menace
    const side = rnd() < 0.5 ? 1 : -1;
    d.lane = d.z > 0.5 ? side * (0.2 + rnd() * 0.3) : (rnd() - 0.5) * 0.9;
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
    for (const d of this.debris) d.img.setVisible(false);
    for (const r of this.rays) r.setVisible(false);
    for (const l of this.layers) l.sprite.setVisible(false);
    for (const r of this.rings) {
      r.img.setVisible(false);
      r.age = 99;
    }
    if (this.built) {
      for (const o of [this.edge, this.swirlA, this.swirlB, this.swirlC, this.swirlCore, this.foyer, this.foyerHot, this.planetGlow, this.planet, this.ringBack, this.ringFront, this.mass, this.burst, ...this.chunks]) o.setVisible(false);
    }
    this.motes.clear().setVisible(false);
    this.streakG.clear().setVisible(false);
    this.shade.clear().setVisible(false);
  }

  // ————————————————————————— dessin

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
    // L'ARC (`prog`) accélère tout le décor, musique ou non ; les impacts donnent un coup d'accélérateur.
    const speed = (reduced ? 0.4 : 1) * (1 + React.build * 1.6 * s.build + 0.5 * s.intensity) * (1 - React.calm * calm);
    this.clock += dt * speed;
    const ck = this.clock;
    const fs = F.base + F.gain * prog;
    const dtm = dt * speed * (1 + (reduced ? 0 : 0.8 * s.drop));
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

    // Lumière globale : le début est sombre et mystérieux, l'éclipse l'éteint, la révélation la rallume (au-delà du niveau normal pendant quelques secondes)
    const lum = 0.62 + 0.38 * Math.pow(prog, 0.8);
    const light = clamp01(1 - ecl.dark * 0.95) * (1 + D.eclipse.glow * ecl.glow) * (1 + 0.5 * ecl.flash);
    const pulse = 1 + React.bass * s.bass * 0.5 + React.drop * s.drop * 0.55;
    const k = amount * s.user;
    const kick = reduced ? 0 : React.kick * s.drop * v.scale;

    // Cap du vol : (fx, fy) = sens du défilement, (px, py) = perpendiculaire (couloirs) ; longueur du trajet visible le long du cap (u)
    const phi = F.heading + F.sway * Math.sin(ck * 0.031);
    const fx = Math.cos(phi);
    const fy = Math.sin(phi);
    const px = -fy;
    const py = fx;
    const span = (Math.abs(fx) * W + Math.abs(fy) * H) / u;
    // Caméra flottante (parallaxe : chaque plan la suit à sa profondeur)
    const camA = D.cam.amp * (reduced ? 0.4 : 1) * (0.6 + 0.8 * prog);
    const camX = camA * (Math.sin(ck * D.cam.rate) + 0.45 * Math.sin(ck * D.cam.rate * 2.8 + 1.3));
    const camY = camA * 0.7 * (Math.cos(ck * D.cam.rate * 0.83 + 0.6) + 0.4 * Math.sin(ck * D.cam.rate * 2.3 + 2.1));

    // Fond
    this.sky.setVisible(true).setPosition(W / 2, H / 2).setDisplaySize(W + 4, H + 4).setAlpha(amount * (0.55 + 0.45 * light));

    // ARRIÈRE-PLAN : tuiles de gaz qui défilent le long du cap à des vitesses différentes (les couches se glissent les unes sur les autres)
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
      if (this.sizeKey !== key) L.sprite.setSize(W + 4, H + 4).setTileScale(ts, ts * f.stretch);
      const ang = phi + f.dir;
      const vel = f.speed * fs * u * dtm;
      // Le contenu avance dans le sens du cap : la position de la tuile recule
      L.x -= (Math.cos(ang) * vel) / ts;
      L.y -= (Math.sin(ang) * vel) / (ts * f.stretch);
      const react = f.reactive * (0.5 * s.bass * React.bass * 2 + 0.45 * s.drop + 0.5 * s.build + 0.3 * s.perc);
      let a: number;
      let tint: number;
      if (f.add) {
        a = f.alpha * k * lum * light * (1 + react) * (0.85 + 0.15 * Math.sin(ck * 0.2 + i * 2)) * (1 - 0.4 * calm) * (f.tex === 1 ? 0.55 + 1.0 * prog : 1);
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

    // Nuages et filaments : ils défilent le long du cap (le plan proche file plus vite), se déforment en respirant
    const place = (d: Drifter, lv: number, cam: number, align: boolean): number => {
      const len = span + d.size * 1.2;
      d.s += dtm * lv * fs;
      if (d.s > len) d.s -= len;
      const T = d.s - len / 2;
      const ph = ck * d.rate * (0.06 + 0.11 * d.depth) + d.phase;
      const ox = d.ax * Math.sin(ph) + 0.35 * d.ax * Math.sin(ph * 0.37 + d.phase * 2);
      const oy = d.ay * Math.cos(ph * 0.83) + 0.3 * d.ay * Math.sin(ph * 0.29 + d.phase);
      const pr = d.lane * pull;
      let X = v.cx + ((fx * T + px * pr) * pull + ox - camX * cam) * u;
      let Y = v.cy + ((fy * T + py * pr) * pull + oy - camY * cam) * u;
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
        .setRotation(align ? phi + d.rot0 : d.rot0 + d.spin * ck + 0.12 * Math.sin(ph * 0.9));
      // Fondu aux extrémités du parcours
      return 1 - smooth01((Math.abs(T) / (len / 2) - 0.6) / 0.4);
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
        const e = place(d, D.drift.far, CD.far, false);
        d.img.setTint(mix(d.tint)).setAlpha(Math.min(0.8, d.alpha * e * k * light * lum * (0.9 + 0.35 * s.bass)));
      }
    }
    for (let i = 0; i < this.smoke.length; i++) {
      const d = this.smoke[i];
      if (i >= nSmoke) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.smoke, CD.smoke, false);
        // La fumée creuse la profondeur ; épaisse au début (mystère), plus sombre et plus présente dans la pénombre de l'éclipse
        d.img.setTint(mix(d.tint)).setAlpha(Math.min(0.85, d.alpha * e * k * (1.35 - 0.6 * prog) * (1 + 0.8 * ecl.dark) * (1 + 0.5 * calm)));
      }
    }
    for (let i = 0; i < this.mid.length; i++) {
      const d = this.mid[i];
      if (i >= nMid) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.mid, CD.mid, false);
        d.img.setTint(bright(d.tint)).setAlpha(Math.min(0.7, d.alpha * e * k * light * lum * (0.9 + 0.5 * s.bass + 0.35 * s.build + 0.25 * s.perc)));
      }
    }
    for (let i = 0; i < this.near.length; i++) {
      const d = this.near[i];
      if (i >= nNear) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.near, CD.near, false);
        d.img.setTint(bright(d.tint)).setAlpha(Math.min(0.5, d.alpha * e * k * light * lum * (0.8 + 0.6 * s.bass + 0.5 * s.build) * (1 - 0.35 * calm)));
      }
    }
    const nWisp = Math.round(this.wisps.length * q.wisps);
    for (let i = 0; i < this.wisps.length; i++) {
      const d = this.wisps[i];
      if (i >= nWisp) d.img.setVisible(false);
      else {
        const e = place(d, D.drift.wisp, CD.wisp, true);
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

    // LOINTAIN : la planète à anneau DÉRIVE le long du cap, traverse l'écran puis revient par l'autre bord (elle émerge peu à peu de la brume)
    const P = D.planet;
    const ps = P.size * u;
    const plen = span + (ps * P.ring * 0.7) / u + 0.3;
    this.planetS += dtm * P.speed * fs;
    if (this.planetS > plen) {
      this.planetS -= plen;
      const side = Math.random() < 0.5 ? 1 : -1;
      this.planetLane = side * (0.14 + Math.random() * 0.12);
      this.planetTilt = P.tilt + (Math.random() - 0.5) * 0.5;
    }
    // Départ : en haut, côté droit (comme dans les références) ; l'instant 0 de l'horloge place la planète à 28 % du trajet
    const pT = ((this.planetS + plen * 0.28) % plen) - plen / 2;
    const pLane = this.planetLane * pull;
    const px0 = v.cx + ((fx * pT + px * pLane) * pull - camX * CD.planet) * u;
    const py0 = v.cy + ((fy * pT + py * pLane) * pull - camY * CD.planet) * u;
    const bob = Math.sin(ck * 0.05) * 0.004 * u;
    const reveal = 0.4 + 0.6 * smooth01(prog / 0.45);
    const pa = Math.min(1, P.alpha * k) * (0.35 + 0.65 * light) * reveal;
    this.planetGlow.setVisible(true).setPosition(px0, py0 + bob).setDisplaySize(ps * 3.2, ps * 3.2).setTint(bright(C.turquoise)).setAlpha(Math.min(0.7, P.glow * k * light * lum * (0.8 + 0.4 * s.bass + 0.4 * s.drop + 0.4 * climax)));
    this.ringBack.setVisible(true).setPosition(px0, py0 + bob).setDisplaySize(ps * P.ring, ps * P.ring * 0.31).setRotation(this.planetTilt + 0.03 * Math.sin(ck * 0.1)).setTint(mix(0xffffff)).setAlpha(pa * 0.8);
    this.planet.setVisible(true).setPosition(px0, py0 + bob).setDisplaySize(ps, ps).setRotation(ck * 0.012).setTint(toWinds > 0 ? mix(0xffffff) : 0xffffff).setAlpha(pa);
    this.ringFront.setVisible(true).setPosition(px0, py0 + bob).setDisplaySize(ps * P.ring, ps * P.ring * 0.31).setRotation(this.planetTilt + 0.03 * Math.sin(ck * 0.1)).setTint(mix(0xffffff)).setAlpha(pa * 0.9);
    const toCore = Math.atan2(v.cy - py0, v.cx - px0) - Math.PI / 2;
    const nRays = Math.round(this.rays.length * q.rays);
    for (let i = 0; i < this.rays.length; i++) {
      const r = this.rays[i];
      if (i >= nRays) {
        r.setVisible(false);
        continue;
      }
      const off = (i - (this.rays.length - 1) / 2) * 0.2 + 0.04 * Math.sin(ck * 0.07 + i * 2) + 0.05 * Math.sin(ck * 0.19 + i);
      const a = D.rays.alpha * k * light * (0.25 + 0.75 * prog) * (0.45 + 1.3 * s.build + 1.0 * s.drop + 0.6 * s.bass + 0.8 * climax) * (0.7 + 0.3 * Math.sin(ck * 0.3 + i * 1.9));
      r.setVisible(true).setPosition(px0, py0).setRotation(toCore + off).setDisplaySize(u * 0.22, u * D.rays.length).setTint(bright(C.aqua)).setAlpha(Math.min(0.55, a));
    }

    // Blocs rocheux OPAQUES en quatre plans : ils défilent le long du cap, du lointain (lent, pâli) à l'avant-plan (énorme, très rapide) ; ceux du dessus
    // masquent réellement tout ce qui est derrière eux (la brume atmosphérique n'éclaircit que les plans lointains, par une lueur additive)
    const keepPlane: Record<Plane, number> = {
      far: Math.max(1, Math.round(D.rocks.far.count * q.rocks)),
      mid: Math.max(1, Math.round(D.rocks.mid.count * q.rocks)),
      near: Math.max(1, Math.round(D.rocks.near.count * q.rocks)),
      fore: Math.max(1, Math.round(D.rocks.fore.count * q.fore * (0.5 + 0.5 * prog))),
    };
    const rnd = Math.random;
    for (const r of this.rocks) {
      if (r.idx >= keepPlane[r.plane]) {
        r.img.setVisible(false);
        r.glint.setVisible(false);
        r.fall?.setVisible(false);
        continue;
      }
      const R = D.rocks[r.plane];
      const len = span + r.size * 1.25 + 0.1;
      r.s += dtm * R.speed * fs;
      if (r.s > len) {
        r.s -= len;
        this.rollRock(r, rnd, false, r.idx);
      }
      const T = r.s - len / 2;
      const ph = ck * r.rate * 0.4 + r.phase;
      const par = 0.15 + 1.9 * R.depth * R.depth;
      // Flottement latéral et roulis lents ; perspective : le bloc grossit en approchant du bas de l'écran (plans proches)
      const lat = r.lane + Math.sin(ph) * D.rocks.bob * (0.5 + R.depth);
      let X = v.cx + ((fx * T + px * lat) * pull - camX * par) * u;
      let Y = v.cy + ((fy * T + py * lat) * pull - camY * par) * u;
      if (kick > 0) {
        const dx = X - v.cx;
        const dy = Y - v.cy;
        const n = Math.hypot(dx, dy) || 1;
        X += (dx / n) * kick * R.depth * 3;
        Y += (dy / n) * kick * R.depth * 3;
      }
      const persp = 1 + F.perspective * R.depth * (T / (len / 2)) * 0.6;
      const sz = r.size * u * persp;
      r.rot += r.spin * dtm;
      const rot = r.rot + Math.sin(ph * 0.6) * 0.03 + spinUp * 0.15 * (r.idx % 2 ? 1 : -1);
      const edgeFade = 1 - smooth01((Math.abs(T) / (len / 2) - 0.97) / 0.03);
      const dark = 1 - ecl.dark * 0.55;
      const shade = lerpColor(0x1a2a30, 0xffffff, dark);
      // Opaque : aucune transparence (ni tenue de plan, ni brume) sur le bloc lui-même
      r.img.setVisible(true).setPosition(X, Y).setDisplaySize(sz, sz * 1.25).setFlipX(r.flip).setRotation(r.flip ? -rot : rot).setTint(mix(shade)).setAlpha(Math.min(1, amount * s.user * edgeFade * 1.6));
      // Lueur additive : brume atmosphérique (plans lointains) + éclat des percussions et des impacts sur les arêtes
      const gl = R.haze * 0.45 * light + (reduced ? 0 : React.perc * s.perc * 0.55 + 0.25 * s.drop) * (0.4 + 0.6 * R.depth) + 0.12 * climax * R.depth;
      if (gl > 0.01) r.glint.setVisible(true).setPosition(X, Y).setDisplaySize(sz, sz * 1.25).setFlipX(r.flip).setRotation(r.flip ? -rot : rot).setTint(mix(C.haze)).setAlpha(Math.min(0.75, gl * k * edgeFade));
      else r.glint.setVisible(false);
      if (r.fall && r.hasFall && q.falls > 0) {
        const fl = sz * 1.25 * 0.78;
        r.fall
          .setVisible(true)
          .setPosition(X + (r.flip ? -1 : 1) * sz * 0.02, Y + sz * 1.25 * 0.38)
          .setDisplaySize(sz * 0.36, fl)
          .setRotation(rot * 0.3)
          .setTint(mix(C.aqua))
          .setAlpha(Math.min(0.5, 0.3 * k * light * edgeFade * (0.7 + 0.5 * s.bass + 0.3 * s.build) * (0.8 + 0.2 * Math.sin(ck * 1.3 + r.idx))));
      } else r.fall?.setVisible(false);
    }

    // Débris NETS : petites pierres opaques qui filent le long du cap (les plus proches sont les plus grosses et les plus rapides)
    const nDeb = Math.round(this.debris.length * q.debris * (0.5 + 0.5 * prog));
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (i >= nDeb) {
        d.img.setVisible(false);
        continue;
      }
      const len = span + 0.2;
      d.s += dtm * lerp(D.debris.speed[0], D.debris.speed[1], d.z * d.z) * fs;
      if (d.s > len) {
        d.s -= len;
        this.rollDebris(d, Math.random);
      }
      const T = d.s - len / 2;
      const par = 0.3 + 1.6 * d.z;
      const persp = 0.8 + 0.4 * (d.s / len);
      d.rot += d.spin * dtm;
      d.img
        .setVisible(true)
        .setPosition(v.cx + ((fx * T + px * d.lane) * pull - camX * par) * u, v.cy + ((fy * T + py * d.lane) * pull - camY * par) * u)
        .setDisplaySize(d.size * u * persp, d.size * u * persp)
        .setRotation(d.rot)
        .setTint(mix(lerpColor(d.fore ? 0xdcecee : 0xb0ccd0, 0xffffff, light)))
        .setAlpha(Math.min(1, amount * s.user * 1.6));
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

    // Lignes de vitesse : poussière d'étoiles qui file le long du cap (discrètes au début, longues et nombreuses à l'apogée)
    const sg = this.streakG;
    sg.clear();
    const ST = D.streaks;
    const nSt = Math.round(Math.min(STREAKS, ST.lines) * q.warp * (0.35 + 0.65 * prog));
    if (nSt > 0 && !reduced) {
      sg.setVisible(true);
      const slen = span + 0.2;
      for (let i = 0; i < nSt; i++) {
        const z = this.stZ[i];
        const vel = lerp(ST.speed[0], ST.speed[1], z * z) * fs;
        this.stS[i] += dtm * vel;
        if (this.stS[i] > slen) {
          this.stS[i] -= slen;
          this.stLane[i] = (Math.random() - 0.5) * (span * 0.9 + 0.3);
          this.stZ[i] = Math.random();
        }
        const T = this.stS[i] - slen / 2;
        const len = (0.012 + ST.length * z * z) * (0.45 + 0.55 * Math.min(1, fs / 2.3)) * (1 + 0.8 * s.drop);
        const lane = this.stLane[i] * pull;
        const hx = v.cx + (fx * T + px * lane - camX * (0.3 + 1.4 * z)) * u;
        const hy = v.cy + (fy * T + py * lane - camY * (0.3 + 1.4 * z)) * u;
        const env = smooth01((1 - Math.abs(T) / (slen / 2)) * 5);
        const al = Math.min(0.6, ST.alpha * k * light * env * (0.25 + 0.75 * z) * (0.6 + 0.6 * prog + 0.5 * s.build));
        sg.lineStyle((0.7 + 1.5 * z) * v.dpr, z > 0.7 ? 0xffffff : mix(C.aqua), al);
        sg.lineBetween(hx, hy, hx - fx * len * u, hy - fy * len * u);
      }
    } else sg.setVisible(false);

    // Poussières lumineuses : elles suivent le cap, plus vives et plus rapides avec l'arc
    const m = this.motes;
    m.clear();
    m.setVisible(true);
    const n = Math.min(MOTES, Math.round(s.quality.dust * D.motes));
    const mv = (reduced ? 0.4 : 1) * (1 + 0.6 * s.build) * (1 - 0.5 * calm) * fs;
    for (let i = 0; i < n; i++) {
      this.moteY[i] += this.moteV[i] * fy * mv * dt * 4;
      this.moteX[i] += this.moteV[i] * fx * mv * dt * 4 + Math.sin(ck * 0.3 + this.moteP[i]) * 0.0006;
      if (this.moteY[i] > 0.85) this.resetMote(i, false);
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
