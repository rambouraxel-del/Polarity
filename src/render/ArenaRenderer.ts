import Phaser from 'phaser';
import { ARENA, BEACONS } from '../config/balance';
import { playerHitRadius, projectileHitRadius } from '../config/hitbox';
import { asteroidMinHalfExtent, asteroidRadius, FX, shipHalfWidth, shipRadius, VISUAL } from '../config/visuals';
import { TAU } from '../core/math';
import type { GameSession } from '../game/session';
import { laserAngle, type Hazard, type LaserHazard, type ProjectileHazard, type SectorHazard } from '../sim/hazards';
import type { Skin } from '../progression/skins';
import { hexNum, THEME } from '../ui/theme';
import { heading, spriteRotation } from './geometry';

/** Couleurs fixes des menaces : jamais reprises par les apparences. */
export const COLORS = {
  background: hexNum(THEME.color.bgDeep),
  grid: hexNum(THEME.color.grid),
  projectile: hexNum(THEME.color.hazardProjectile),
  sector: hexNum(THEME.color.hazardSector),
  danger: 0xffffff,
  gold: hexNum(THEME.color.gold),
};

const R = ARENA.orbitRadius;
const TRAIL_LEN = 10;
const MAX_PARTICLES = FX.maxParticles;
const MAX_POPUPS = 8;
const MAX_RINGS = 4;
/** Clés des textures (chargées par GameScene). */
export const SHIP_TEXTURE = 'ship';
export const ASTEROID_TEXTURES = ['ast1', 'ast2', 'ast3', 'ast4'] as const;
/** Part de la toile du sprite occupée par la plus grande dimension du dessin. */
const CONTENT = VISUAL.spriteContent / VISUAL.spriteCanvas;

/** Hachage entier déterministe → [0, 1) : choix décoratifs liés à l'identifiant d'une menace, sans toucher au RNG du jeu. */
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
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly trailG: Phaser.GameObjects.Graphics;
  private readonly shipG: Phaser.GameObjects.Graphics;
  private readonly fx: Phaser.GameObjects.Graphics;
  private readonly dbg: Phaser.GameObjects.Graphics;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly shipSprite: Phaser.GameObjects.Image;
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
    this.g = scene.add.graphics().setDepth(2);
    this.trailG = scene.add.graphics().setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
    this.shipG = scene.add.graphics().setDepth(4.5).setBlendMode(Phaser.BlendModes.ADD);
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
  }

  /** Taille d'affichage des sprites : la plus grande dimension du dessin = 2 × rayon visuel (+15 %). */
  private applySpriteScale(): void {
    const shipPx = (2 * shipRadius() * this.scale) / CONTENT;
    this.shipSprite.setDisplaySize(shipPx, shipPx);
    const astPx = (2 * asteroidRadius() * this.scale) / CONTENT;
    for (const a of this.asteroidPool) {
      a.img.setDisplaySize(astPx * a.sc, astPx * a.sc);
      a.glow.setDisplaySize(astPx * a.sc * FX.asteroidGlow.grow, astPx * a.sc * FX.asteroidGlow.grow);
    }
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

  private sx(x: number): number {
    return this.cx + this.ox + x * this.scale;
  }

  private sy(y: number): number {
    return this.cy + this.oy + y * this.scale;
  }

  // ————————————————————————————————————————————— dessin principal

  /** Menus : le décor spatial est celui du DOM (ui/space.ts) ; l'arène ne dessine rien. */
  private idle(): void {
    this.g.clear();
    this.trailG.clear();
    this.shipG.clear();
    this.fx.clear();
    this.dbg.clear();
    this.shipSprite.setVisible(false);
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

    const sim = session.sim;
    const extra = session.phase === 'running' ? session.acc : 0;
    const dir: 1 | -1 = sim.dir;
    const angle = sim.angle + (sim.state === 'running' ? dir * sim.omega * extra : 0);
    const t = sim.time + extra;
    // Les émissions de particules s'arrêtent en pause et pendant le compte à rebours
    const emitting = session.phase === 'running';
    this.emitAcc = Math.min(0.1, this.emitAcc + (emitting ? realDt : 0));

    this.drawOrbit(skin);
    this.drawBeacons(sim ? sim.beacons.active : null, sim ? sim.beacons.angles : null, skin, clock);

    let asteroids = 0;
    if (sim) {
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
      this.drawShip(angle, dir, skin, clock, emitting);
    } else {
      this.shipSprite.setVisible(false);
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

  private drawOrbit(skin: Skin): void {
    const g = this.g;
    const x = this.sx(0);
    const y = this.sy(0);
    const r = R * this.scale;
    const s = this.scale;
    g.lineStyle(16 * s, skin.orbit, 0.05);
    g.strokeCircle(x, y, r);
    g.lineStyle(7 * s, skin.orbit, 0.12);
    g.strokeCircle(x, y, r);
    g.lineStyle(Math.max(1.5 * this.dpr, 2.2 * s), skin.orbit, 0.95);
    g.strokeCircle(x, y, r);
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
        g.fillStyle(skin.beacon, 0.18);
        g.fillCircle(x, y, size * 2.1 * pulse);
        // Losange plein
        g.fillStyle(skin.beacon, 1);
        g.fillTriangle(x, y - size * 1.25, x + size, y, x - size, y);
        g.fillTriangle(x, y + size * 1.25, x + size, y, x - size, y);
      } else {
        // Balise éteinte : petit anneau creux
        g.lineStyle(Math.max(1, 1.5 * s), skin.beacon, 0.3);
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
    sprite.setVisible(true).setTint(0xffffff);
    sprite.setPosition(this.sx(px), this.sy(py));
    // La texture pointe vers le haut : rotation instantanée, sans interpolation
    sprite.setRotation(spriteRotation(tx, ty));
    // Les apparences teintent légèrement le vaisseau (la teinte blanche par défaut ne change rien)
    if (skin.ship !== 0xffffff) sprite.setTint(skin.ship);

    // Réacteur : derrière le vaisseau, à l'opposé du déplacement. Purement décoratif.
    const L = shipRadius();
    const th = FX.thruster;
    const flick = this.reducedEffects ? 1 : 1 + th.flicker * Math.sin(clock * 38) * Math.sin(clock * 23 + 1);
    const len = th.length * flick;
    const nx = c; // normale (radiale) : décalage latéral des deux tuyères
    const ny = si;
    const side = shipHalfWidth() * 0.3;
    const g = this.shipG;
    for (const off of [-side, side]) {
      const sx0 = px - tx * L * 0.72 + nx * off;
      const sy0 = py - ty * L * 0.72 + ny * off;
      const ex = sx0 - tx * len;
      const ey = sy0 - ty * len;
      const w = th.width * 0.5;
      // Halo large, flamme, cœur : triangles effilés vers l'arrière
      g.fillStyle(th.glowColor, 0.13);
      g.fillTriangle(this.sx(sx0 + nx * w * 1.5), this.sy(sy0 + ny * w * 1.5), this.sx(sx0 - nx * w * 1.5), this.sy(sy0 - ny * w * 1.5), this.sx(ex), this.sy(ey));
      g.fillStyle(th.glowColor, 0.42);
      g.fillTriangle(this.sx(sx0 + nx * w), this.sy(sy0 + ny * w), this.sx(sx0 - nx * w), this.sy(sy0 - ny * w), this.sx(sx0 - tx * len * 0.8), this.sy(sy0 - ty * len * 0.8));
      g.fillStyle(th.coreColor, 0.85);
      g.fillTriangle(this.sx(sx0 + nx * w * 0.45), this.sy(sy0 + ny * w * 0.45), this.sx(sx0 - nx * w * 0.45), this.sy(sy0 - ny * w * 0.45), this.sx(sx0 - tx * len * 0.5), this.sy(sy0 - ty * len * 0.5));
    }
    // Étincelles : vers l'arrière, courtes
    if (emitting && !this.reducedEffects) {
      const n = Math.floor(this.emitAcc * FX.thrusterSparks.rate);
      for (let i = 0; i < n; i++) {
        const off = (Math.random() < 0.5 ? -side : side) + (Math.random() - 0.5) * 2;
        const k = Math.random();
        this.spawn(
          px - tx * (L * 0.72 + len * 0.6) + nx * off,
          py - ty * (L * 0.72 + len * 0.6) + ny * off,
          -tx * FX.thrusterSparks.speed * (0.6 + k) + nx * (Math.random() - 0.5) * 14,
          -ty * FX.thrusterSparks.speed * (0.6 + k) + ny * (Math.random() - 0.5) * 14,
          FX.thrusterSparks.life * (0.6 + 0.4 * Math.random()),
          i % 3 === 0 ? 0xffffff : th.glowColor,
          1,
          1.1,
        );
      }
      if (n > 0) this.emitAcc = 0;
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
    for (let i = 1; i < this.trailCount; i++) {
      const a0 = this.trail[i - 1];
      const a1 = this.trail[i];
      const k = 1 - i / TRAIL_LEN;
      g.lineStyle(2.5 * s * k, skin.trail, 0.22 * k);
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

  private drawProjectileWarning(h: ProjectileHazard, t: number, clock: number): void {
    if (t < h.warnStart) return;
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

    // Croix aux points où la trajectoire coupe l'orbite (tant qu'ils ne sont pas passés)
    g.lineStyle(Math.max(2.5 * this.dpr, 4 * s), color, 1);
    if (t < h.crossTime1 + 0.05) this.cross(this.sx(R * Math.cos(h.cross1)), this.sy(R * Math.sin(h.cross1)), 11 * s);
    if (t < h.crossTime2 + 0.05) this.cross(this.sx(R * Math.cos(h.cross2)), this.sy(R * Math.sin(h.cross2)), 11 * s);
  }

  /** Astéroïde : sprite tournant, avec traînée et braises derrière lui (opposées au déplacement). Décoratif. */
  private drawAsteroid(h: ProjectileHazard, t: number, slotIndex: number, emitting: boolean, dt: number): void {
    const slot = this.asteroidSlot(slotIndex);
    const x = h.x0 + h.vx * (t - h.launch);
    const y = h.y0 + h.vy * (t - h.launch);
    const speed = Math.hypot(h.vx, h.vy);
    const ux = h.vx / speed;
    const uy = h.vy / speed;
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
