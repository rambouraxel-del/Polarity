import Phaser from 'phaser';
import { ARENA, BEACONS, PLAYER } from '../config/balance';
import { playerHitRadius, projectileHitRadius } from '../config/hitbox';
import { asteroidMinHalfExtent, asteroidRadius, FX, shipHalfWidth, shipRadius, VISUAL } from '../config/visuals';
import { TAU } from '../core/math';
import type { CampaignSimulation } from '../campaign/simulation';
import type { Simulation } from '../sim/simulation';
import type { GameSession } from '../game/session';
import { SHARDS } from '../config/economy';
import { trailById } from '../config/trails';
import { laserAngle, pathX, pathY, projectileX, projectileY, type Hazard, type LaserHazard, type ProjectileHazard, type SectorHazard } from '../sim/hazards';
import { PHASES } from '../config/phases';
import { AMBIENCE } from '../config/ambience';
import { ORBIT, orbitLook } from '../config/orbit';
import type { Skin } from '../progression/skins';
import { shipTextureFor } from './shipTextures';
import { hexNum, THEME } from '../ui/theme';
import { heading, spriteRotation } from './geometry';
import { speedIntensity, speedStreaks, streakTriangle } from './speedLines';
import type { AmbienceState } from '../ambience/director';
import { AmbienceRenderer } from './ambience/AmbienceRenderer';

/** Couleurs fixes des menaces : jamais reprises par les apparences. */
export const COLORS = {
  background: hexNum(THEME.color.bgDeep),
  grid: hexNum(THEME.color.grid),
  projectile: hexNum(THEME.color.hazardProjectile),
  sector: hexNum(THEME.color.hazardSector),
  danger: 0xffffff,
  gold: hexNum(THEME.color.gold),
  shard: hexNum(THEME.color.shard),
  signal: hexNum(THEME.color.signal),
  shield: hexNum(THEME.color.shield),
  cyan: hexNum(THEME.color.cyan),
};

/** Rotation lente (rad) d'un objet de mission. */
const clockSpin = (t: number, speed: number): number => t * speed * TAU * 0.5;

const AMBIENCE_FLASH = AMBIENCE.phase2.flash;
const AMBIENCE_FLASH_FROM = AMBIENCE_FLASH.peak;
const R = ARENA.orbitRadius;
const TRAIL_LEN = 10;
const MAX_PARTICLES = FX.maxParticles;
const MAX_POPUPS = 8;
const MAX_RINGS = 4;
/** Clés des textures (chargées par GameScene). */
export const SHIP_TEXTURE = 'ship';
export const SHARD_TEXTURE = 'shard';
export const ASTEROID_TEXTURES = ['ast1', 'ast2', 'ast3', 'ast4'] as const;
/** Part de la toile du sprite occupée par la plus grande dimension du dessin. */
const CONTENT = VISUAL.spriteContent / VISUAL.spriteCanvas;

/** Le halo couvre l'orbite (rayon 1) jusqu'à ce rayon relatif : la texture est 1,16 fois plus large que l'orbite. */
const ORBIT_GLOW_SPAN = 1.16;

/** Texture du halo de l'orbite : anneau blanc flou (à teinter), centré sur le rayon de l'orbite. */
function orbitGlowTexture(scene: Phaser.Scene): string {
  const key = 'orbit-glow';
  if (scene.textures.exists(key)) return key;
  const size = 512;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const ring = 1 / ORBIT_GLOW_SPAN; // position de l'orbite (fraction du demi-côté)
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(Math.max(0, ring - 0.1), 'rgba(255,255,255,0)');
  grad.addColorStop(ring - 0.03, 'rgba(255,255,255,0.16)');
  grad.addColorStop(ring, 'rgba(255,255,255,0.3)');
  grad.addColorStop(ring + 0.03, 'rgba(255,255,255,0.16)');
  grad.addColorStop(Math.min(1, ring + 0.075), 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** Hachage entier déterministe → [0, 1) : choix décoratifs liés à l'identifiant d'une menace, sans toucher au RNG du jeu. */
/** Mélange linéaire de deux couleurs 0xRRGGBB. */
function lerpColor(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function hash01(n: number, salt: number): number {
  let x = Math.imul(n | 0, 374761393) + Math.imul(salt | 0, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

interface Popup {
  text: Phaser.GameObjects.Text;
  life: number;
  x: number;
  y: number;
}

interface AsteroidSlot {
  img: Phaser.GameObjects.Image;
  /** Contour lumineux : copie teintée de la silhouette, légèrement plus grande, derrière le sprite. */
  glow: Phaser.GameObjects.Image;
  tex: string;
  /** Taille relative appliquée (1 = astéroïde normal, 0,7 = fragment). */
  sc: number;
}

interface Ring {
  x: number;
  y: number;
  t: number;
  life: number;
  radius: number;
  color: number;
}

/**
 * Dessine l'arène : vaisseau et astéroïdes en sprites, tout le reste (orbite, annonces, secteurs, réacteur,
 * traînées, particules, impact) par code. Les sprites ne contiennent aucun effet.
 * Les annonces sont en pointillés et contours ; les dangers actifs sont pleins et épais :
 * la forme porte l'information, pas seulement la couleur.
 */
export class ArenaRenderer {
  private readonly bg: Phaser.GameObjects.Graphics;
  /** Quadrillage fixe de l'arène (remplacé par celui de l'ambiance quand elle est active). */
  private readonly gridG: Phaser.GameObjects.Graphics;
  /** Ambiance évolutive de la Survie (calques derrière l'orbite). */
  private readonly ambienceLayers: AmbienceRenderer;
  /** État d'ambiance de l'image (fourni par App en Survie et au défi quotidien ; null ailleurs : décor fixe inchangé). */
  ambience: AmbienceState | null = null;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly trailG: Phaser.GameObjects.Graphics;
  private readonly shipG: Phaser.GameObjects.Graphics;
  private readonly fx: Phaser.GameObjects.Graphics;
  private readonly dbg: Phaser.GameObjects.Graphics;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly shipSprite: Phaser.GameObjects.Image;
  /** Traînées de vitesse (blanc grisé, alpha normal), derrière le vaisseau et sous le réacteur : jamais de lueur sur la coque. */
  private readonly speedG: Phaser.GameObjects.Graphics;
  /** Liseré sombre : silhouette de la couleur du fond, sous le vaisseau, pour le détacher de l'orbite. */
  private readonly shipRim: Phaser.GameObjects.Image;
  private shipKey: string = SHIP_TEXTURE;
  /** Éclat sur l'orbite : sprite au-dessus du rail, sous les astéroïdes. */
  private readonly shardSprite: Phaser.GameObjects.Image;
  /** Traînée équipée (identifiant) : change la couleur de la traînée lumineuse, jamais la hitbox. */
  trailId = 'auto';
  /** Halo de l'orbite : texture en dégradé radial (pas de traits translucides qui se recouvrent). */
  private readonly orbitGlow: Phaser.GameObjects.Image;
  private readonly asteroidPool: AsteroidSlot[] = [];
  private readonly scene: Phaser.Scene;
  private readonly rings: Ring[] = [];
  private emitAcc = 0;
  /** Divisions d'astéroïdes déjà animées (décoratif, jamais lu par la simulation). */
  private readonly splitDone = new Set<number>();
  /** Affiche les hitboxes et silhouettes (URL ?debug). */
  debug = false;
  private cx = 0;
  private cy = 0;
  private scale = 1;
  private dpr = 1;
  private shake = 0;
  private flashAlpha = 0;
  /** Zoom courant de la caméra de jeu (transmis à l'ambiance pour compenser l'aspiration de la traversée). */
  private camZoom = 1;
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
  /** 0 = étincelle (trait), 1 = point. */
  private readonly pkind = new Uint8Array(MAX_PARTICLES);
  private readonly psize = new Float32Array(MAX_PARTICLES);
  private pnext = 0;
  private readonly popups: Popup[] = [];
  reducedEffects = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Profondeurs : fond < textes < arène/annonces < traînées < astéroïdes < réacteur < vaisseau < effets < flash
    this.bg = scene.add.graphics().setDepth(0);
    this.gridG = scene.add.graphics().setDepth(0.7);
    this.ambienceLayers = new AmbienceRenderer(scene, COLORS.grid, ASTEROID_TEXTURES);
    this.g = scene.add.graphics().setDepth(2);
    this.trailG = scene.add.graphics().setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
    this.shipG = scene.add.graphics().setDepth(4.5).setBlendMode(Phaser.BlendModes.ADD);
    this.speedG = scene.add.graphics().setDepth(4.4);
    this.orbitGlow = scene.add.image(0, 0, orbitGlowTexture(scene)).setDepth(1.9).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.shardSprite = scene.add.image(0, 0, SHARD_TEXTURE).setDepth(3.8).setVisible(false);
    this.shipRim = scene.add.image(0, 0, SHIP_TEXTURE).setDepth(4.7).setVisible(false).setTintFill(COLORS.background).setAlpha(FX.shipRim.alpha);
    this.shipSprite = scene.add.image(0, 0, SHIP_TEXTURE).setDepth(5).setVisible(false);
    this.fx = scene.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    this.flash = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0, 0).setDepth(7);
    this.dbg = scene.add.graphics().setDepth(8);
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
    this.applySpriteScale();
    this.drawBackground(width, height);
    this.ambienceLayers.layout(cx, cy, this.scale, width, height, dpr);
  }

  /** Taille d'affichage des sprites : la plus grande dimension du dessin = 2 × rayon visuel (+15 %). */
  private applySpriteScale(): void {
    this.sizeShip();
    const astPx = (2 * asteroidRadius() * this.scale) / CONTENT;
    for (const a of this.asteroidPool) {
      a.img.setDisplaySize(astPx * a.sc, astPx * a.sc);
      a.glow.setDisplaySize(astPx * a.sc * FX.asteroidGlow.grow, astPx * a.sc * FX.asteroidGlow.grow);
    }
  }

  /**
   * Taille d'affichage du vaisseau (sprite, liseré) : indépendante de la définition de la texture (128 ou 256 px). À rappeler après chaque
   * changement de texture, car Phaser conserve le facteur d'échelle d'une image, pas sa taille d'affichage.
   */
  private sizeShip(): void {
    const shipPx = (2 * shipRadius() * this.scale) / CONTENT;
    this.shipSprite.setDisplaySize(shipPx, shipPx);
    this.shipRim.setDisplaySize(shipPx * FX.shipRim.grow, shipPx * FX.shipRim.grow);
  }

  private asteroidSlot(i: number): AsteroidSlot {
    let slot = this.asteroidPool[i];
    if (!slot) {
      const g = FX.asteroidGlow;
      const glow = this.scene.add.image(0, 0, ASTEROID_TEXTURES[0]).setDepth(3.9).setVisible(false).setTintFill(g.tint).setAlpha(g.alpha).setBlendMode(Phaser.BlendModes.ADD);
      const img = this.scene.add.image(0, 0, ASTEROID_TEXTURES[0]).setDepth(4).setVisible(false);
      const px = (2 * asteroidRadius() * this.scale) / CONTENT;
      img.setDisplaySize(px, px);
      glow.setDisplaySize(px * g.grow, px * g.grow);
      slot = { img, glow, tex: ASTEROID_TEXTURES[0], sc: 1 };
      this.asteroidPool[i] = slot;
    }
    return slot;
  }

  private drawBackground(w: number, h: number): void {
    const g = this.bg;
    g.clear();
    g.fillStyle(COLORS.background, 1);
    g.fillRect(0, 0, w, h);
    this.gridG.clear();
    this.drawGrid(this.gridG, w, h);
  }

  private drawGrid(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
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
  /** Horloge de rendu (s) de l'image courante (effets décoratifs). */
  private clockNow = 0;
  /** Fondu de l'orbite entre la phase 1 (0) et la phase 2 (1) : suit la phase de la partie. */
  private orbitMix = 0;
  /** Voile blanc de la traversée (DOM : reste plein écran malgré le zoom de la caméra). */
  private flashEl: HTMLDivElement | null = null;
  private camKey = '';

  private sx(x: number): number {
    return this.cx + this.ox + x * this.scale;
  }

  private sy(y: number): number {
    return this.cy + this.oy + y * this.scale;
  }

  // ————————————————————————————————————————————— dessin principal

  /** Menus : le décor spatial est celui du DOM (ui/space.ts) ; l'arène ne dessine rien. */
  private idle(): void {
    this.applyCamera(0);
    this.g.clear();
    this.trailG.clear();
    this.shipG.clear();
    this.speedG.clear();
    this.fx.clear();
    this.dbg.clear();
    this.shipSprite.setVisible(false);
    this.shipRim.setVisible(false);
    this.orbitGlow.setVisible(false);
    this.orbitMix = 0;
    this.shardSprite.setVisible(false);
    this.ambienceLayers.setVisible(false);
    this.gridG.setVisible(true);
    for (const a of this.asteroidPool) {
      a.img.setVisible(false);
      a.glow.setVisible(false);
    }
    this.flashAlpha = 0;
    this.flash.setFillStyle(0xffffff, 0);
  }

  draw(session: GameSession | null, skin: Skin, realDt: number, clock: number): void {
    if (!session) {
      this.idle();
      return;
    }
    const g = this.g;
    g.clear();
    this.trailG.clear();
    this.shipG.clear();
    this.speedG.clear();
    this.fx.clear();
    this.dbg.clear();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - realDt * 40 * this.dpr);
      this.ox = (Math.random() - 0.5) * this.shake;
      this.oy = (Math.random() - 0.5) * this.shake;
    } else {
      this.ox = 0;
      this.oy = 0;
    }

    // Caméra d'abord (la traversée l'éloigne) : l'ambiance compense le zoom pour rester plein écran
    this.clockNow = clock;
    const transit = session.transitLeft > 0 ? 1 - session.transitLeft / PHASES.transit : 0;
    this.applyCamera(transit);

    // Ambiance (Survie, défi quotidien) : figée en pause ; ailleurs, décor fixe inchangé
    if (this.ambience) {
      this.ambienceLayers.draw(this.ambience, session.phase === 'paused' ? 0 : realDt, this.camZoom);
      this.gridG.setVisible(false);
    } else {
      this.ambienceLayers.setVisible(false);
      this.gridG.setVisible(true);
    }
    const sim = session.sim;
    const extra = session.phase === 'running' ? session.acc : 0;
    const dir: 1 | -1 = sim.dir;
    const angle = sim.angle + (sim.state === 'running' ? dir * sim.omega * extra : 0);
    const t = sim.time + extra;
    // Les émissions de particules s'arrêtent en pause et pendant le compte à rebours
    const emitting = session.phase === 'running';
    this.emitAcc = Math.min(0.1, this.emitAcc + (emitting ? realDt : 0));

    this.drawOrbit(realDt);
    this.drawBeacons(sim ? sim.beacons.active : null, sim ? sim.beacons.angles : null, skin, clock);
    this.drawShard(sim ? sim.shards?.active ?? null : null, t);
    const camp = session.campaign;
    this.drawMissionObjects(camp, t);

    let asteroids = 0;
    // Traversée : à partir du flash, les menaces de la phase 1 ont été aspirées (la simulation les efface au pas suivant la traversée)
    const swallowed = transit > AMBIENCE_FLASH_FROM;
    if (sim && !swallowed) {
      for (const h of sim.hazards) {
        if (h.kind === 'sector') this.drawSector(h, t, clock);
        else if (h.kind === 'laser') this.drawLaser(h, t, clock);
      }
      for (const h of sim.hazards) {
        if (h.kind !== 'projectile') continue;
        this.drawProjectileWarning(h, t, clock);
        if (h.split && t >= h.split.t && !this.splitDone.has(h.id)) this.splitBurst(h.id, h.split.x, h.split.y);
        if (t >= h.launch && t <= h.end) this.drawAsteroid(h, t, asteroids++, emitting, realDt);
      }
    }
    for (let i = asteroids; i < this.asteroidPool.length; i++) {
      this.asteroidPool[i].img.setVisible(false);
      this.asteroidPool[i].glow.setVisible(false);
    }

    const alive = !sim || sim.state !== 'dead';
    this.updateTrail(angle, realDt);
    if (alive) {
      this.drawTrail(skin);
      if (emitting && sim) this.drawSpeedLines(sim, angle, dir, clock);
      this.drawShip(angle, dir, skin, clock, emitting);
      if (camp) this.drawShield(camp, angle, t, clock);
      else if (sim) this.drawPowers(sim, angle, clock);
    } else {
      this.shipSprite.setVisible(false);
      this.shipRim.setVisible(false);
    }

    this.drawImpacts(realDt);
    this.drawRing(realDt);
    this.updateParticles(realDt);
    this.updatePopups(realDt);
    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - realDt * 1.6);
    }
    this.flash.setFillStyle(0xffffff, this.flashAlpha);
    if (this.debug) this.drawDebug(sim, angle);
  }

  /**
   * Caméra (décorative : le gameplay ne la lit jamais, aucune collision ne dépend de l'écran) : légères impulsions sur les battements et les moments forts,
   * et traversée de la faille — l'arène entière est aspirée (zoom arrière et rotation), voile blanc au pic, puis arrivée en phase 2 (zoom avant qui se pose).
   */
  private applyCamera(transit: number): void {
    const cam = this.scene.cameras.main;
    const key = `${this.cx}|${this.cy}`;
    if (key !== this.camKey) {
      this.camKey = key;
      cam.setBackgroundColor(COLORS.background);
      cam.setOrigin(cam.width > 0 ? this.cx / cam.width : 0.5, cam.height > 0 ? this.cy / cam.height : 0.5);
    }
    const a = this.ambience;
    let zoom = 1;
    let rot = 0;
    let flash = 0;
    if (transit > 0) {
      const F = AMBIENCE_FLASH;
      if (!this.reducedEffects) {
        if (transit < F.peak) {
          const e = Math.pow(transit / F.peak, 2.2);
          zoom = 1 - 0.95 * e;
          rot = 2.6 * e;
        } else {
          const v = Math.min(1, (transit - F.peak) / (1 - F.peak));
          const e = 1 - Math.pow(1 - v, 3);
          zoom = 2.6 - 1.6 * e;
          rot = -1.4 * (1 - e);
        }
      }
      const rise = Math.min(1, Math.max(0, (transit - F.from) / (F.peak - F.from)));
      const fall = Math.min(1, Math.max(0, (transit - F.peak) / (F.to - F.peak)));
      flash = transit < F.peak ? rise * rise * (3 - 2 * rise) : 1 - fall * fall * (3 - 2 * fall);
    } else if (a && !this.reducedEffects) {
      zoom = 1 + (a.phase === 2 ? 0.011 : 0.006) * a.beat + 0.014 * a.drop;
      zoom = Math.min(1.03, zoom);
    }
    this.camZoom = Math.max(0.04, zoom);
    cam.setZoom(this.camZoom);
    cam.setRotation(rot);
    this.setFlash(flash);
  }

  /** Voile blanc plein écran de la traversée (élément DOM créé à la demande, sans interception des touchers). */
  private setFlash(alpha: number): void {
    if (alpha <= 0.001 && !this.flashEl) return;
    if (!this.flashEl) {
      const parent = this.scene.game.canvas.parentElement;
      if (!parent) return;
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      Object.assign(el.style, { position: 'absolute', inset: '0', background: '#ffffff', opacity: '0', pointerEvents: 'none', zIndex: '2' });
      parent.appendChild(el);
      this.flashEl = el;
    }
    this.flashEl.style.opacity = String(Math.max(0, Math.min(1, alpha)));
  }

  /**
   * Orbite : apparence propre à la PHASE de la partie (config/orbit.ts), jamais à l'apparence du vaisseau. Fine et discrète : halo doux (une seule
   * image réutilisée, teinte et opacité mises à jour à chaque image), trait fin, et en phase 2 de petits arcs électriques le long du rail.
   * Le passage de phase est fondu (`orbitMix`) : rien n'est recréé.
   */
  private drawOrbit(realDt: number): void {
    const g = this.g;
    const x = this.sx(0);
    const y = this.sy(0);
    const r = R * this.scale;
    const s = this.scale;
    const phase = this.ambience?.phase ?? 1;
    const target = phase >= 2 ? 1 : 0;
    const step = realDt / ORBIT.blendSeconds;
    this.orbitMix = target > this.orbitMix ? Math.min(target, this.orbitMix + step) : Math.max(target, this.orbitMix - step);
    const a = orbitLook(1);
    const b = orbitLook(2);
    const m = this.orbitMix;
    const mix = (p: number, q: number): number => p + (q - p) * m;
    const color = lerpColor(a.color, b.color, m);
    const breathe = this.reducedEffects ? 0 : mix(a.breathe, b.breathe);
    const hz = mix(a.breatheHz, b.breatheHz);
    const k = 1 + breathe * Math.sin(TAU * hz * this.clockNow);
    const glowPx = 2 * r * ORBIT_GLOW_SPAN;
    this.orbitGlow.setVisible(true).setPosition(x, y).setDisplaySize(glowPx, glowPx).setTint(color).setAlpha(Math.min(1, mix(a.glowAlpha, b.glowAlpha) * k));
    g.lineStyle(Math.max(1 * this.dpr, mix(a.lineWidth, b.lineWidth) * s), color, Math.min(1, mix(a.lineAlpha, b.lineAlpha) * k));
    g.strokeCircle(x, y, r);
    // Phase 2 : l'orbite reste un cercle parfait mais devient électrique (arcs fins qui crépitent le long du rail, plus vifs sur les battements)
    const arcs = mix(a.arcs, b.arcs);
    if (arcs > 0.02 && !this.reducedEffects) {
      const beat = this.ambience?.beat ?? 0;
      const N = 48;
      const t = Math.floor(this.clockNow * 14);
      for (let i = 0; i < N; i++) {
        const h = hash01(i + t * 61, 7);
        if (h > 0.3 + 0.35 * beat) continue;
        const a0 = (i / N) * TAU;
        const a1 = ((i + 1) / N) * TAU;
        g.lineStyle(Math.max(1 * this.dpr, 1.2 * s), b.arcColor, arcs * (0.3 + 0.4 * h + 0.25 * beat));
        const off = (hash01(i + t * 17, 3) - 0.5) * 6 * s;
        g.beginPath();
        g.moveTo(x + Math.cos(a0) * (r + off), y + Math.sin(a0) * (r + off));
        g.lineTo(x + Math.cos((a0 + a1) / 2) * (r - off * 0.6), y + Math.sin((a0 + a1) / 2) * (r - off * 0.6));
        g.lineTo(x + Math.cos(a1) * (r + off * 0.3), y + Math.sin(a1) * (r + off * 0.3));
        g.strokePath();
      }
    }
  }

  /**
   * Éclat : disque sombre local (lisible sur toute couleur d'orbite), halo violet discret, sprite à contour sombre, cœur blanc,
   * anneau qui se vide jusqu'à la disparition et pulsation de plus en plus rapide (temps de jeu : figées en pause).
   */
  private drawShard(shard: { angle: number; spawnedAt: number; expiresAt: number } | null, t: number): void {
    const sprite = this.shardSprite;
    if (!shard) {
      sprite.setVisible(false);
      return;
    }
    const V = FX.shard;
    const g = this.g;
    const s = this.scale;
    const rem = Math.max(0, shard.expiresAt - t);
    const age = Math.max(0, t - shard.spawnedAt);
    const calm = this.reducedEffects;
    const hz = rem > 2 ? V.pulseHz : rem > 1 ? V.warnHz : V.urgentHz;
    const pulse = calm ? 0 : Math.sin(TAU * hz * t);
    const grow = calm ? 1 : 0.35 + 0.65 * Math.min(1, age / V.spawnIn);
    const x = this.sx(R * Math.cos(shard.angle));
    const y = this.sy(R * Math.sin(shard.angle));
    const r = V.radius * s * grow * (1 + 0.07 * pulse);
    // Fond sombre local, puis anneau de temps restant (visible aussi sans animation)
    g.fillStyle(COLORS.background, 0.85);
    g.fillCircle(x, y, r * V.diskGrow);
    const ringR = r * V.ringGrow;
    g.lineStyle(Math.max(1.5 * this.dpr, 2.6 * s), 0x1c1238, 0.9);
    g.strokeCircle(x, y, ringR);
    g.lineStyle(Math.max(1.5 * this.dpr, 2.6 * s), COLORS.shard, 0.95);
    g.beginPath();
    g.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, rem / SHARDS.lifetime), false);
    g.strokePath();
    // Halo violet (additif)
    const halo = this.trailG;
    halo.fillStyle(COLORS.shard, 0.1);
    halo.fillCircle(x, y, r * V.haloGrow);
    halo.fillStyle(COLORS.shard, 0.08);
    halo.fillCircle(x, y, r * V.haloGrow * 0.72);
    // Sprite ; dans la dernière seconde, il clignote doucement
    const alpha = rem > 1 || calm ? 1 : 0.6 + 0.4 * (0.5 + 0.5 * pulse);
    const px = 2 * r * V.spriteGrow;
    sprite.setVisible(true).setPosition(x, y).setDisplaySize(px, px).setAlpha(alpha);
    // Cœur blanc
    this.shipG.fillStyle(0xffffff, 0.55 + 0.15 * pulse);
    this.shipG.fillCircle(x, y, r * 0.26);
    this.shipG.fillStyle(0xffffff, 0.2);
    this.shipG.fillCircle(x, y, r * 0.5);
  }

  /** Objets de mission : forme selon leur nature (triangle, losange, hexagone), halo, anneau du temps restant. Pas de sprite, pas de couleur d'Éclat, de balise ou de danger. */
  private drawMissionObjects(camp: CampaignSimulation | null, t: number): void {
    if (!camp || camp.objects.length === 0) return;
    const V = FX.missionObject;
    const g = this.g;
    const s = this.scale;
    const calm = this.reducedEffects;
    for (const o of camp.objects) {
      const rem = o.expiresAt === null ? Infinity : Math.max(0, o.expiresAt - t);
      const age = Math.max(0, t - o.spawnedAt);
      const hz = rem > V.warnAt ? V.pulseHz : V.urgentHz;
      const pulse = calm ? 0 : Math.sin(TAU * hz * t);
      const grow = calm ? 1 : 0.35 + 0.65 * Math.min(1, age / 0.25);
      const x = this.sx(R * Math.cos(o.angle));
      const y = this.sy(R * Math.sin(o.angle));
      const r = V.radius * s * grow * (1 + 0.06 * pulse);
      g.fillStyle(COLORS.background, 0.85);
      g.fillCircle(x, y, r * 1.35);
      const ringR = r * V.ringGrow;
      if (o.expiresAt !== null) {
        const total = Math.max(0.1, o.expiresAt - o.spawnedAt);
        g.lineStyle(Math.max(1.5 * this.dpr, 2.4 * s), 0x0f2a2a, 0.9);
        g.strokeCircle(x, y, ringR);
        g.lineStyle(Math.max(1.5 * this.dpr, 2.4 * s), COLORS.signal, 0.95);
        g.beginPath();
        g.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, rem / total), false);
        g.strokePath();
      } else {
        // Persistant (boîte noire) : anneau complet pulsé
        g.lineStyle(Math.max(1.5 * this.dpr, 2.4 * s), COLORS.signal, 0.6 + 0.3 * (0.5 + 0.5 * pulse));
        g.strokeCircle(x, y, ringR);
      }
      const halo = this.trailG;
      halo.fillStyle(COLORS.signal, 0.1);
      halo.fillCircle(x, y, r * V.haloGrow);
      halo.fillStyle(COLORS.signal, 0.08);
      halo.fillCircle(x, y, r * V.haloGrow * 0.7);
      // Forme pleine, en rotation lente
      const sides = o.kind === 'fragment' ? 3 : o.kind === 'data' ? 4 : 6;
      const rot = calm ? -Math.PI / 2 : -Math.PI / 2 + clockSpin(t, V.spin);
      const alpha = rem > 1 || calm ? 1 : 0.6 + 0.4 * (0.5 + 0.5 * pulse);
      g.fillStyle(COLORS.signal, alpha);
      g.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = rot + (i * TAU) / sides;
        const px = x + Math.cos(a) * r * 0.85;
        const py = y + Math.sin(a) * r * 0.85;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
      this.shipG.fillStyle(0xffffff, 0.5 + 0.15 * pulse);
      this.shipG.fillCircle(x, y, r * 0.28);
    }
  }

  /**
   * Pouvoirs de la Survie (purement visuel) : anneau doré (Boost), anneau glacé (Gel), anneau du Bouclier (clignote pendant ses 2 dernières secondes),
   * vaisseau clignotant pendant l'invulnérabilité de reprise (sans anneau : distincte du Bouclier). Effets réduits : anneaux fixes, pas de clignotement.
   */
  private drawPowers(sim: Simulation, angle: number, clock: number): void {
    const pw = sim.powers;
    if (!pw.enabled) return;
    const step = sim.stepIndex;
    const x = this.sx(R * Math.cos(angle));
    const y = this.sy(R * Math.sin(angle));
    const r = shipRadius() * this.scale;
    const calm = this.reducedEffects;
    const g = this.shipG;
    const lw = Math.max(1.5 * this.dpr, 2 * this.scale);
    if (pw.boostActive(step)) {
      g.lineStyle(lw, COLORS.gold, calm ? 0.7 : 0.55 + 0.35 * Math.sin(TAU * 6 * clock));
      g.strokeCircle(x, y, r * 1.25);
    }
    if (pw.gelActive(step)) {
      g.lineStyle(lw, COLORS.cyan, 0.85);
      g.strokeCircle(x, y, r * 1.5);
    }
    if (pw.shieldActive(step)) {
      const left = pw.remaining('shield', step, 'active');
      const fading = !calm && left < 2 && Math.sin(TAU * 5 * clock) < 0;
      g.lineStyle(lw * 1.4, COLORS.shield, fading ? 0.3 : 0.9);
      g.strokeCircle(x, y, r * 1.75);
    }
    this.shipSprite.setAlpha(sim.reviveProtected ? (calm ? 0.7 : Math.sin(TAU * 8 * clock) > 0 ? 1 : 0.3) : 1);
  }

  /** Bouclier de secours : anneau discret tant qu'il est chargé ; anneau vif et vaisseau clignotant pendant l'invulnérabilité. */
  private drawShield(camp: CampaignSimulation, angle: number, t: number, clock: number): void {
    const V = FX.shield;
    const charged = camp.shieldCharges > 0;
    const invulnerable = camp.invulnerable;
    if (!charged && !invulnerable) return;
    const x = this.sx(R * Math.cos(angle));
    const y = this.sy(R * Math.sin(angle));
    const r = shipRadius() * V.ringGrow * this.scale;
    const calm = this.reducedEffects;
    const g = this.shipG;
    if (invulnerable) {
      const left = Math.max(0, camp.invulnUntil - t);
      g.lineStyle(Math.max(2 * this.dpr, 3 * this.scale), COLORS.shield, 0.35 + 0.65 * Math.min(1, left));
      g.strokeCircle(x, y, r * 1.12);
      if (!calm) {
        const on = Math.sin(TAU * V.blinkHz * clock) > 0;
        this.shipSprite.setAlpha(on ? 1 : V.blinkAlpha);
      } else {
        this.shipSprite.setAlpha(0.7);
      }
    } else {
      this.shipSprite.setAlpha(1);
      const pulse = calm ? 1 : 0.8 + 0.2 * Math.sin(clock * 3);
      g.lineStyle(Math.max(1.5 * this.dpr, 2 * this.scale), COLORS.shield, V.alpha * pulse);
      g.strokeCircle(x, y, r);
    }
  }

  /** Absorption d'une collision par le bouclier : onde bleue et éclats, sans secousse. */
  shieldBurst(x: number, y: number): void {
    this.rings.push({ x, y, t: 0, life: 0.4, radius: 70, color: COLORS.shield });
    if (this.rings.length > MAX_RINGS) this.rings.splice(0, this.rings.length - MAX_RINGS);
    this.burst(x, y, COLORS.shield, 14, 190, 0.5);
    this.burst(x, y, 0xffffff, 6, 130, 0.35);
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
        g.fillStyle(skin.colors.beacon, 0.18);
        g.fillCircle(x, y, size * 2.1 * pulse);
        // Losange plein
        g.fillStyle(skin.colors.beacon, 1);
        g.fillTriangle(x, y - size * 1.25, x + size, y, x - size, y);
        g.fillTriangle(x, y + size * 1.25, x + size, y, x - size, y);
      } else {
        // Balise éteinte : petit anneau creux
        g.lineStyle(Math.max(1, 1.5 * s), skin.colors.beacon, 0.3);
        g.strokeCircle(x, y, size * 0.6);
      }
    }
  }

  private drawShip(angle: number, dir: 1 | -1, skin: Skin, clock: number, emitting: boolean): void {
    const c = Math.cos(angle);
    const si = Math.sin(angle);
    const px = R * c;
    const py = R * si;
    // Direction du déplacement : le vaisseau pointe toujours vers l'avant, immédiatement après une inversion
    const { x: tx, y: ty } = heading(angle, dir);
    const sprite = this.shipSprite;
    // Texture de l'apparence (modèle classique si elle est indisponible)
    const key = shipTextureFor(this.scene, skin);
    if (key !== this.shipKey) {
      this.shipKey = key;
      sprite.setTexture(key);
      this.shipRim.setTexture(key);
      this.sizeShip();
    }
    sprite.setVisible(true).setAlpha(1);
    sprite.setPosition(this.sx(px), this.sy(py));
    // La texture pointe vers le haut : rotation instantanée, sans interpolation
    sprite.setRotation(spriteRotation(tx, ty));
    this.shipRim.setVisible(true).setPosition(sprite.x, sprite.y).setRotation(sprite.rotation);

    // Réacteur : derrière le vaisseau, à l'opposé du déplacement. Purement décoratif.
    const L = shipRadius();
    const th = FX.thruster;
    const thc = skin.colors.thruster;
    const flick = this.reducedEffects ? 1 : 1 + th.flicker * Math.sin(clock * 38) * Math.sin(clock * 23 + 1);
    const len = th.length * flick;
    const nx = c; // normale (radiale) : décalage latéral des deux tuyères
    const ny = si;
    const side = shipHalfWidth() * th.spread;
    const g = this.shipG;
    for (const off of [-side, side]) {
      const sx0 = px - tx * L * th.start + nx * off;
      const sy0 = py - ty * L * th.start + ny * off;
      const ex = sx0 - tx * len;
      const ey = sy0 - ty * len;
      const w = th.width * 0.5;
      // Halo large, flamme, cœur : triangles effilés vers l'arrière
      g.fillStyle(thc.glow, 0.13);
      g.fillTriangle(this.sx(sx0 + nx * w * 1.5), this.sy(sy0 + ny * w * 1.5), this.sx(sx0 - nx * w * 1.5), this.sy(sy0 - ny * w * 1.5), this.sx(ex), this.sy(ey));
      g.fillStyle(thc.glow, 0.42);
      g.fillTriangle(this.sx(sx0 + nx * w), this.sy(sy0 + ny * w), this.sx(sx0 - nx * w), this.sy(sy0 - ny * w), this.sx(sx0 - tx * len * 0.8), this.sy(sy0 - ty * len * 0.8));
      g.fillStyle(thc.core, 0.85);
      g.fillTriangle(this.sx(sx0 + nx * w * 0.45), this.sy(sy0 + ny * w * 0.45), this.sx(sx0 - nx * w * 0.45), this.sy(sy0 - ny * w * 0.45), this.sx(sx0 - tx * len * 0.5), this.sy(sy0 - ty * len * 0.5));
    }
    // Étincelles : vers l'arrière, courtes
    if (emitting && !this.reducedEffects) {
      const n = Math.floor(this.emitAcc * FX.thrusterSparks.rate);
      for (let i = 0; i < n; i++) {
        const off = (Math.random() < 0.5 ? -side : side) + (Math.random() - 0.5) * 2;
        const k = Math.random();
        this.spawn(
          px - tx * (L * th.start + len * 0.6) + nx * off,
          py - ty * (L * th.start + len * 0.6) + ny * off,
          -tx * FX.thrusterSparks.speed * (0.6 + k) + nx * (Math.random() - 0.5) * 14,
          -ty * FX.thrusterSparks.speed * (0.6 + k) + ny * (Math.random() - 0.5) * 14,
          FX.thrusterSparks.life * (0.6 + 0.4 * Math.random()),
          i % 3 === 0 ? 0xffffff : thc.glow,
          1,
          1.1,
        );
      }
      if (n > 0) this.emitAcc = 0;
    }
  }

  /**
   * Effet de vitesse (purement visuel) : fines traînées effilées derrière la queue du vaisseau, à l'opposé exact de son déplacement réel (même sens
   * que le sprite : immédiat à l'inversion). Intensité selon la vitesse de la simulation (lecture seule). Atténué quand la traînée d'apparence est tracée.
   */
  private drawSpeedLines(sim: Simulation, angle: number, dir: 1 | -1, clock: number): void {
    const g = this.speedG;
    const calm = this.reducedEffects;
    const withTrail = !calm && this.trailCount >= 2;
    const intensity = speedIntensity(sim.omega / PLAYER.angularSpeed);
    const streaks = speedStreaks(intensity, clock, shipHalfWidth(), calm, withTrail);
    const L = shipRadius();
    for (const st of streaks) {
      const q = streakTriangle(angle, dir, R, L, st);
      // Deux couches : corps long et très léger, cœur plus court un peu plus net (effilées, jamais de halo)
      g.fillStyle(FX.speedLines.color, st.alpha * 0.55);
      g.fillTriangle(this.sx(q.x0), this.sy(q.y0), this.sx(q.x1), this.sy(q.y1), this.sx(q.tx), this.sy(q.ty));
      const mx = (q.x0 + q.x1) / 2;
      const my = (q.y0 + q.y1) / 2;
      g.fillStyle(FX.speedLines.color, st.alpha * 0.5);
      g.fillTriangle(
        this.sx(mx + (q.x0 - mx) * 0.5), this.sy(my + (q.y0 - my) * 0.5),
        this.sx(mx + (q.x1 - mx) * 0.5), this.sy(my + (q.y1 - my) * 0.5),
        this.sx(mx + (q.tx - mx) * 0.55), this.sy(my + (q.ty - my) * 0.55),
      );
    }
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

  /** L'inversion est immédiate : l'ancienne traînée (désormais devant le vaisseau) disparaît aussitôt. */
  resetTrail(): void {
    this.trailCount = 0;
  }

  private drawTrail(skin: Skin): void {
    if (this.reducedEffects || this.trailCount < 2) return;
    const g = this.g;
    const s = this.scale;
    const trail = trailById(this.trailId).color ?? skin.colors.trail;
    for (let i = 1; i < this.trailCount; i++) {
      const a0 = this.trail[i - 1];
      const a1 = this.trail[i];
      const k = 1 - i / TRAIL_LEN;
      g.lineStyle(2.5 * s * k, trail, 0.22 * k);
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

  /**
   * Annonce d'un projectile à trajectoire COURBE (grand arc, spirale) : la courbe entière est tracée en pointillés (échantillonnée), jauge qui avance du
   * point d'entrée vers l'orbite, chevrons de sens, repères aux passages sur l'orbite. Mêmes codes visuels que l'annonce d'une trajectoire droite.
   */
  private drawCurveWarning(h: ProjectileHazard, t: number, clock: number): void {
    const path = h.path;
    if (!path) return;
    const g = this.g;
    const s = this.scale;
    const color = COLORS.projectile;
    const dur = h.end - h.launch;
    const N = 56;
    const beat = this.ambience?.beat ?? 0;
    const warning = t < h.launch;
    const pulse = this.reducedEffects ? 0.85 : 0.7 + 0.2 * Math.sin(clock * 12) + 0.1 * beat;
    g.lineStyle(Math.max((warning ? 2 : 1) * this.dpr, (warning ? 3.5 : 2) * s), color, warning ? pulse : 0.22);
    let px = this.sx(pathX(path, 0));
    let py = this.sy(pathY(path, 0));
    for (let i = 1; i <= N; i++) {
      const x = this.sx(pathX(path, (dur * i) / N));
      const y = this.sy(pathY(path, (dur * i) / N));
      if (i % 2 === 0) g.lineBetween(px, py, x, y);
      px = x;
      py = y;
    }
    if (!warning) return;
    // Jauge : un trait plein avance le long de la courbe jusqu'au premier passage sur l'orbite
    const k = (t - h.warnStart) / Math.max(0.001, h.launch - h.warnStart);
    const firstS = Math.max(0.001, Math.min(h.crossTime1, h.crossTime2) - h.launch);
    const upto = Math.min(firstS, firstS * k);
    g.lineStyle(Math.max(2 * this.dpr, 4 * s), color, 0.9);
    g.beginPath();
    g.moveTo(this.sx(pathX(path, 0)), this.sy(pathY(path, 0)));
    const M = 24;
    for (let i = 1; i <= M; i++) g.lineTo(this.sx(pathX(path, (upto * i) / M)), this.sy(pathY(path, (upto * i) / M)));
    g.strokePath();
    // Chevrons de sens le long de la courbe
    g.lineStyle(Math.max(2 * this.dpr, 3.5 * s), color, 0.9);
    for (const f of [0.18, 0.38, 0.58, 0.78]) {
      const sTime = dur * f;
      const x = pathX(path, sTime);
      const y = pathY(path, sTime);
      let ux = pathX(path, sTime + 0.01) - x;
      let uy = pathY(path, sTime + 0.01) - y;
      const n = Math.hypot(ux, uy) || 1;
      ux /= n;
      uy /= n;
      const c = 11;
      g.lineBetween(this.sx(x - ux * c - uy * c), this.sy(y - uy * c + ux * c), this.sx(x), this.sy(y));
      g.lineBetween(this.sx(x - ux * c + uy * c), this.sy(y - uy * c - ux * c), this.sx(x), this.sy(y));
    }
  }

  private drawProjectileWarning(h: ProjectileHazard, t: number, clock: number): void {
    if (t < h.warnStart) return;
    if (h.path) {
      this.drawCurveWarning(h, t, clock);
      this.drawCrossings(h, t);
      return;
    }
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
      // Distance jusqu'au premier passage sur l'orbite (valable aussi pour un fragment qui part de l'intérieur)
      const firstAlong = Math.max(1, (Math.min(h.crossTime1, h.crossTime2) - h.launch) * Math.hypot(h.vx, h.vy));
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

    // Astéroïde fragmenté : repère de division (étoile) à l'endroit où il se scindera
    if (h.split && t < h.split.t) {
      const sp = h.split;
      const c = Math.max(2 * this.dpr, 3 * s);
      g.lineStyle(Math.max(2 * this.dpr, 3 * s), color, 0.95);
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3 + 0.3;
        const dx = Math.cos(a) * 12;
        const dy = Math.sin(a) * 12;
        g.lineBetween(this.sx(sp.x - dx), this.sy(sp.y - dy), this.sx(sp.x + dx), this.sy(sp.y + dy));
      }
      g.strokeCircle(this.sx(sp.x), this.sy(sp.y), 16 * s + c * 0.3);
    }

    this.drawCrossings(h, t);
  }

  /**
   * Repères aux points où la trajectoire coupe l'orbite (tant qu'ils ne sont pas passés) : croix + anneau qui se resserre à l'approche
   * (dernière seconde), pour lire l'instant du passage sans le chercher des yeux.
   */
  private drawCrossings(h: ProjectileHazard, t: number): void {
    const g = this.g;
    const s = this.scale;
    const color = COLORS.projectile;
    g.lineStyle(Math.max(2.5 * this.dpr, 4 * s), color, 1);
    const mark = (ang: number, at: number): void => {
      if (t >= at + 0.05) return;
      const x = this.sx(R * Math.cos(ang));
      const y = this.sy(R * Math.sin(ang));
      this.cross(x, y, 11 * s);
      const lead = at - t;
      if (lead > 0 && lead < 1 && !this.reducedEffects) {
        g.lineStyle(Math.max(1.5 * this.dpr, 2.2 * s), color, 0.55 * (1 - lead));
        g.strokeCircle(x, y, (14 + 22 * lead) * s);
        g.lineStyle(Math.max(2.5 * this.dpr, 4 * s), color, 1);
      }
    };
    mark(h.cross1, h.crossTime1);
    if (h.crossTime2 !== h.crossTime1) mark(h.cross2, h.crossTime2);
  }

  /** Astéroïde : sprite tournant, avec traînée et braises derrière lui (opposées au déplacement). Décoratif. */
  private drawAsteroid(h: ProjectileHazard, t: number, slotIndex: number, emitting: boolean, dt: number): void {
    const slot = this.asteroidSlot(slotIndex);
    const x = projectileX(h, t);
    const y = projectileY(h, t);
    // Direction du déplacement : droite constante, ou tangente de la courbe (grand arc, spirale)
    let ux = h.vx;
    let uy = h.vy;
    if (h.path) {
      ux = projectileX(h, t + 0.01) - x;
      uy = projectileY(h, t + 0.01) - y;
    }
    const speed = Math.hypot(ux, uy) || 1;
    ux /= speed;
    uy /= speed;
    const variant = Math.floor(hash01(h.id, 1) * ASTEROID_TEXTURES.length);
    const tex = ASTEROID_TEXTURES[variant];
    if (slot.tex !== tex) {
      slot.img.setTexture(tex);
      slot.glow.setTexture(tex);
      slot.tex = tex;
    }
    const sc = h.scale ?? 1;
    if (slot.sc !== sc) {
      const px = (2 * asteroidRadius() * this.scale * sc) / CONTENT;
      slot.img.setDisplaySize(px, px);
      slot.glow.setDisplaySize(px * FX.asteroidGlow.grow, px * FX.asteroidGlow.grow);
      slot.sc = sc;
    }
    const spin = (hash01(h.id, 2) - 0.5) * 2.6;
    const rot = hash01(h.id, 3) * TAU + spin * (t - h.launch);
    slot.img.setVisible(true).setPosition(this.sx(x), this.sy(y)).setRotation(rot);
    // Contour lumineux orange : silhouette teintée, légèrement agrandie, juste derrière la roche
    slot.glow.setVisible(true).setPosition(this.sx(x), this.sy(y)).setRotation(rot);

    const r = asteroidRadius() * sc;
    const s = this.scale;
    const tr = FX.asteroidTrail;
    const g = this.trailG;
    // Traînée : triangles effilés vers l'arrière (ADD), courte et discrète
    const len = (this.reducedEffects ? tr.length * 0.6 : tr.length) * (sc < 1 ? 0.8 : 1);
    const tailX = x - ux * len;
    const tailY = y - uy * len;
    const nx = -uy;
    const ny = ux;
    const layers: [number, number, number][] = [
      [tr.layers[0], 0.09, tr.glowColor],
      [tr.layers[1], 0.18, tr.glowColor],
      [tr.layers[2], 0.36, tr.coreColor],
    ];
    for (const [w, a, col] of layers) {
      g.fillStyle(col, a);
      g.fillTriangle(
        this.sx(tailX), this.sy(tailY),
        this.sx(x + nx * r * w), this.sy(y + ny * r * w),
        this.sx(x - nx * r * w), this.sy(y - ny * r * w),
      );
    }
    // Lueur orangée diffuse autour de la roche (le contour net est le sprite teinté ci-dessus)
    g.fillStyle(tr.glowColor, 0.05);
    g.fillCircle(this.sx(x), this.sy(y), r * 1.5 * s);

    if (emitting && !this.reducedEffects) {
      const n = Math.floor(dt * FX.asteroidEmbers.rate + Math.random());
      for (let i = 0; i < n; i++) {
        const lat = (Math.random() - 0.5) * r * 1.2;
        this.spawn(
          x - ux * r * 0.8 + nx * lat, y - uy * r * 0.8 + ny * lat,
          -ux * FX.asteroidEmbers.speed * (0.4 + Math.random()) + nx * (Math.random() - 0.5) * 18,
          -uy * FX.asteroidEmbers.speed * (0.4 + Math.random()) + ny * (Math.random() - 0.5) * 18,
          FX.asteroidEmbers.life * (0.6 + 0.4 * Math.random()),
          Math.random() < 0.5 ? tr.coreColor : tr.glowColor,
          1,
          1.3,
        );
      }
    }
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
    // Alternance lente du motif (6 Hz, sans variation de luminosité globale) : pas de clignotement agressif
    const phase = this.reducedEffects ? 0 : Math.floor(clock * 6);
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

  /**
   * Laser balayeur : annonce = ligne pointillée du centre à l'angle de départ + arc pointillé du secteur balayé
   * (avec chevrons de sens et jauge) ; actif = rayon plein (halo additif) qui pivote ; la zone balayée garde une rémanence.
   */
  private drawLaser(h: LaserHazard, t: number, clock: number): void {
    if (t < h.warnStart) return;
    const g = this.g;
    const s = this.scale;
    const color = COLORS.sector;
    const sign = h.rate >= 0 ? 1 : -1;
    const a0 = h.startAngle;
    const a1 = h.startAngle + sign * h.span;
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const reach = R + 56;
    const cx0 = this.sx(0);
    const cy0 = this.sy(0);
    const tip = (a: number, r: number): [number, number] => [this.sx(r * Math.cos(a)), this.sy(r * Math.sin(a))];
    if (h.rotating) {
      this.drawRotatingBeam(h, t, clock, sign, tip);
      return;
    }
    if (t < h.activeStart) {
      const k = (t - h.warnStart) / Math.max(0.001, h.activeStart - h.warnStart);
      const pulse = this.reducedEffects ? 0.8 : 0.65 + 0.25 * Math.sin(clock * 11);
      g.lineStyle(Math.max(2 * this.dpr, 3.5 * s), color, pulse);
      // Rayon de départ (pointillé) et rayon d'arrivée (plus discret)
      const [sx1, sy1] = tip(a0, reach);
      this.dashedLine(cx0, cy0, sx1, sy1, 12 * s, 10 * s);
      g.lineStyle(Math.max(1.5 * this.dpr, 2.5 * s), color, 0.4);
      const [ex1, ey1] = tip(a1, reach);
      this.dashedLine(cx0, cy0, ex1, ey1, 8 * s, 14 * s);
      // Arc du secteur balayé, pointillé, de part et d'autre de l'orbite
      g.lineStyle(Math.max(2 * this.dpr, 3.5 * s), color, pulse);
      const n = Math.max(4, Math.round(h.span / 0.07));
      for (let i = 0; i < n; i += 2) {
        const b0 = lo + ((hi - lo) * i) / n;
        const b1 = lo + ((hi - lo) * (i + 1)) / n;
        this.arcPath(R + 30, b0, b1);
        this.arcPath(R - 30, b0, b1);
      }
      // Chevrons de sens de balayage
      for (let i = 1; i <= 3; i++) {
        const a = a0 + (sign * h.span * i) / 4;
        const [px, py] = tip(a, R);
        const tx = -Math.sin(a) * sign;
        const ty = Math.cos(a) * sign;
        const nx = Math.cos(a);
        const ny = Math.sin(a);
        const c = 9 * s;
        g.lineBetween(px - tx * c + nx * c, py - ty * c + ny * c, px + tx * c * 0.4, py + ty * c * 0.4);
        g.lineBetween(px - tx * c - nx * c, py - ty * c - ny * c, px + tx * c * 0.4, py + ty * c * 0.4);
      }
      // Jauge : l'arc se remplit jusqu'à l'activation
      g.lineStyle(Math.max(2.5 * this.dpr, 5 * s), color, 0.9);
      this.arcPath(R + 40, lo, lo + (hi - lo) * k);
      // Émetteur au centre
      g.strokeCircle(cx0, cy0, (10 + 4 * k) * s);
      return;
    }
    const ang = laserAngle(h, t);
    const f = this.trailG;
    const wHalf = h.half * R * s;
    // Rémanence : la zone déjà balayée garde une trace sur l'orbite
    const sweptLo = Math.min(a0, ang);
    const sweptHi = Math.max(a0, ang);
    g.lineStyle(Math.max(2 * this.dpr, 5 * s), color, 0.28);
    this.arcPath(R, sweptLo, sweptHi);
    g.lineStyle(Math.max(1.5 * this.dpr, 2.5 * s), color, 0.5);
    this.arcPath(R + 30, lo, hi);
    this.arcPath(R - 30, lo, hi);
    const [tx2, ty2] = tip(ang, reach);
    // Rayon : halo, corps, cœur blanc (additif) ; largeur = hitbox du rayon
    f.lineStyle(wHalf * 4.4, color, 0.14);
    f.lineBetween(cx0, cy0, tx2, ty2);
    f.lineStyle(wHalf * 2.2, color, 0.38);
    f.lineBetween(cx0, cy0, tx2, ty2);
    f.lineStyle(Math.max(1.5 * this.dpr, wHalf * 0.9), 0xffffff, 0.95);
    f.lineBetween(cx0, cy0, tx2, ty2);
    f.fillStyle(color, 0.5);
    f.fillCircle(cx0, cy0, 11 * s);
    f.fillStyle(0xffffff, 0.9);
    f.fillCircle(cx0, cy0, 5 * s);
  }

  /**
   * Faisceau rotatif (phase 2) : annonce = rayon de départ pointillé + chevrons qui tournent autour de l'orbite dans le sens de la rotation + jauge ;
   * actif = rayon plein qui tourne (la rotation peut dépasser un tour : pas de secteur balayé à tracer, un anneau pointillé suffit).
   */
  private drawRotatingBeam(h: LaserHazard, t: number, clock: number, sign: number, tip: (a: number, r: number) => [number, number]): void {
    const g = this.g;
    const s = this.scale;
    const color = COLORS.sector;
    const reach = R + 56;
    const cx0 = this.sx(0);
    const cy0 = this.sy(0);
    if (t < h.activeStart) {
      const k = (t - h.warnStart) / Math.max(0.001, h.activeStart - h.warnStart);
      const pulse = this.reducedEffects ? 0.8 : 0.65 + 0.25 * Math.sin(clock * 11);
      g.lineStyle(Math.max(2 * this.dpr, 3.5 * s), color, pulse);
      const [x1, y1] = tip(h.startAngle, reach);
      this.dashedLine(cx0, cy0, x1, y1, 12 * s, 10 * s);
      // Chevrons de sens de rotation, en avant du rayon de départ, sur l'orbite
      for (let i = 1; i <= 4; i++) {
        const a = h.startAngle + sign * 0.28 * i;
        const [px, py] = tip(a, R);
        const tx = -Math.sin(a) * sign;
        const ty = Math.cos(a) * sign;
        const nx = Math.cos(a);
        const ny = Math.sin(a);
        const c = 9 * s;
        g.lineStyle(Math.max(2 * this.dpr, 3.2 * s), color, 0.95 - 0.15 * i);
        g.lineBetween(px - tx * c + nx * c, py - ty * c + ny * c, px + tx * c * 0.4, py + ty * c * 0.4);
        g.lineBetween(px - tx * c - nx * c, py - ty * c - ny * c, px + tx * c * 0.4, py + ty * c * 0.4);
      }
      g.lineStyle(Math.max(2.5 * this.dpr, 5 * s), color, 0.9);
      this.arcPath(R + 36, h.startAngle, h.startAngle + sign * 1.4 * k);
      g.strokeCircle(cx0, cy0, (10 + 4 * k) * s);
      return;
    }
    const ang = laserAngle(h, t);
    const f = this.trailG;
    const wHalf = h.half * R * s;
    g.lineStyle(Math.max(1.5 * this.dpr, 2.2 * s), color, 0.32);
    this.arcPath(R + 30, ang - sign * 0.9, ang);
    const [tx2, ty2] = tip(ang, reach);
    f.lineStyle(wHalf * 4.4, color, 0.14);
    f.lineBetween(cx0, cy0, tx2, ty2);
    f.lineStyle(wHalf * 2.2, color, 0.38);
    f.lineBetween(cx0, cy0, tx2, ty2);
    f.lineStyle(Math.max(1.5 * this.dpr, wHalf * 0.9), 0xffffff, 0.95);
    f.lineBetween(cx0, cy0, tx2, ty2);
    f.fillStyle(color, 0.5);
    f.fillCircle(cx0, cy0, 11 * s);
    f.fillStyle(0xffffff, 0.9);
    f.fillCircle(cx0, cy0, 5 * s);
  }

  private radial(a: number, half: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.g.lineBetween(this.sx((R - half) * c), this.sy((R - half) * s), this.sx((R + half) * c), this.sy((R + half) * s));
  }

  // ————————————————————————————————————————————— effets

  /** Éclat bref à l'endroit où un astéroïde se divise en deux fragments. */
  private splitBurst(id: number, x: number, y: number): void {
    if (this.splitDone.size > 64) this.splitDone.clear();
    this.splitDone.add(id);
    this.rings.push({ x, y, t: 0, life: 0.3, radius: 26, color: 0xffb347 });
    if (this.rings.length > MAX_RINGS) this.rings.splice(0, this.rings.length - MAX_RINGS);
    this.burst(x, y, 0xffffff, 8, 150, 0.4);
    this.burst(x, y, 0xff8a3d, 10, 130, 0.45);
  }

  /** Ajoute une particule décorative (tampon circulaire : aucune allocation, plafond FX.maxParticles). */
  private spawn(x: number, y: number, vx: number, vy: number, life: number, color: number, kind: 0 | 1, size: number): void {
    const k = this.pnext;
    this.pnext = (this.pnext + 1) % MAX_PARTICLES;
    this.px[k] = x;
    this.py[k] = y;
    this.pvx[k] = vx;
    this.pvy[k] = vy;
    this.plife[k] = life;
    this.pmax[k] = life;
    this.pcol[k] = color;
    this.pkind[k] = kind;
    this.psize[k] = size;
  }

  burst(x: number, y: number, color: number, count: number, speed: number, life: number): void {
    const n = this.reducedEffects ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.6 + Math.random() * 0.4), color, 0, 1);
    }
  }

  private updateParticles(dt: number): void {
    const g = this.fx;
    const s = this.scale;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (this.plife[k] <= 0) continue;
      this.plife[k] -= dt;
      if (this.plife[k] <= 0) continue;
      this.px[k] += this.pvx[k] * dt;
      this.py[k] += this.pvy[k] * dt;
      const damp = this.pkind[k] === 0 ? 0.96 : 0.985;
      this.pvx[k] *= damp;
      this.pvy[k] *= damp;
      const a = this.plife[k] / this.pmax[k];
      if (this.pkind[k] === 0) {
        // Traînée proportionnelle à la vitesse (et non à dt) : même aspect quelle que soit la fréquence d'image
        g.lineStyle(2.5 * s, this.pcol[k], a);
        g.lineBetween(this.sx(this.px[k]), this.sy(this.py[k]), this.sx(this.px[k] - this.pvx[k] * 0.05), this.sy(this.py[k] - this.pvy[k] * 0.05));
      } else {
        g.fillStyle(this.pcol[k], 0.8 * a);
        g.fillCircle(this.sx(this.px[k]), this.sy(this.py[k]), Math.max(0.8 * this.dpr, this.psize[k] * s * (0.5 + 0.5 * a)));
      }
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
    this.ambienceLayers.reset();
    for (const p of this.popups) {
      p.life = 0;
      p.text.setVisible(false);
    }
    this.rings.length = 0;
    this.splitDone.clear();
    this.ringT = -1;
    this.shake = 0;
    this.flashAlpha = 0;
    this.trailCount = 0;
    this.emitAcc = 0;
    this.shipSprite.setVisible(false);
    for (const a of this.asteroidPool) {
      a.img.setVisible(false);
      a.glow.setVisible(false);
    }
  }

  /**
   * Impact bref à l'endroit de la collision : éclair, onde de choc, éclats. Le vaisseau disparaît (géré par draw).
   * Les éclats blancs/cyan viennent du vaisseau, les éclats orange de la roche.
   */
  impact(hitX: number, hitY: number, shipX: number, shipY: number, by: Hazard['kind']): void {
    const i = FX.impact;
    this.rings.push({ x: hitX, y: hitY, t: 0, life: i.ringLife, radius: i.ringRadius, color: by === 'projectile' ? 0xffb347 : 0xff3df0 });
    this.rings.push({ x: hitX, y: hitY, t: -0.05, life: i.ringLife * 0.8, radius: i.ringRadius * 0.6, color: 0xffffff });
    if (this.rings.length > MAX_RINGS) this.rings.splice(0, this.rings.length - MAX_RINGS);
    this.flareT = 0;
    this.flareX = hitX;
    this.flareY = hitY;
    this.burst(hitX, hitY, 0xffffff, 16, 240, 0.55);
    this.burst(shipX, shipY, 0x9ff9ff, 12, 170, 0.5);
    if (by === 'projectile') this.burst(hitX, hitY, 0xff8a3d, 16, 200, 0.6);
    else this.burst(hitX, hitY, 0xff3df0, 14, 200, 0.55);
    if (!this.reducedEffects) {
      this.shake = 10 * this.dpr;
      this.flashAlpha = 0.16;
    }
  }

  private flareT = -1;
  private flareX = 0;
  private flareY = 0;

  private drawImpacts(dt: number): void {
    const g = this.fx;
    const s = this.scale;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.life) {
        this.rings.splice(i, 1);
        continue;
      }
      if (r.t < 0) continue;
      const k = r.t / r.life;
      g.lineStyle(Math.max(1.5 * this.dpr, 4 * s * (1 - k)), r.color, 0.85 * (1 - k));
      g.strokeCircle(this.sx(r.x), this.sy(r.y), (6 + r.radius * k) * s);
    }
    if (this.flareT >= 0) {
      this.flareT += dt;
      const k = this.flareT / FX.impact.flareLife;
      if (k >= 1) this.flareT = -1;
      else {
        g.fillStyle(0xffffff, 0.6 * (1 - k));
        g.fillCircle(this.sx(this.flareX), this.sy(this.flareY), (8 + 14 * k) * s);
        g.fillStyle(0xffb347, 0.5 * (1 - k));
        g.fillCircle(this.sx(this.flareX), this.sy(this.flareY), (14 + 20 * k) * s);
      }
    }
  }

  /** Affichage de contrôle (?debug) : silhouettes (pointillés) et hitboxes (traits pleins). */
  private drawDebug(sim: GameSession['sim'] | null, angle: number): void {
    const g = this.dbg;
    const s = this.scale;
    const lw = Math.max(1, this.dpr);
    const px = R * Math.cos(angle);
    const py = R * Math.sin(angle);
    g.lineStyle(lw, 0xffffff, 0.6);
    g.strokeCircle(this.sx(px), this.sy(py), shipHalfWidth() * s);
    g.lineStyle(lw * 1.5, 0x00ff88, 1);
    g.strokeCircle(this.sx(px), this.sy(py), playerHitRadius() * s);
    if (!sim) return;
    for (const h of sim.hazards) {
      if (h.kind !== 'projectile' || sim.time < h.launch) continue;
      const x = h.x0 + h.vx * (sim.time - h.launch);
      const y = h.y0 + h.vy * (sim.time - h.launch);
      g.lineStyle(lw, 0xffffff, 0.6);
      g.strokeCircle(this.sx(x), this.sy(y), asteroidMinHalfExtent() * s);
      g.lineStyle(lw * 1.5, 0xff3355, 1);
      g.strokeCircle(this.sx(x), this.sy(y), projectileHitRadius() * s);
    }
  }
}
