import { CLOUDS, CURRENTS, WORLD_LIST, WORLDS, worldIndexAt, worldStart, type FieldKind } from '../config/worlds';
import { W3_WAVE_AT, W3_WELLS, W3_WELL_AT } from '../config/world3';
import { Rng } from '../core/rng';
import { angleDiff, wrapAngle } from '../core/math';

/**
 * Champs de vitesse des univers (mécaniques environnementales) : facteur multiplicatif de la vitesse de base du vaisseau selon sa POSITION sur
 * l'orbite, le temps actif et son sens de déplacement. Fonctions PURES de la graine et du temps : la simulation, le validateur d'évitement et le
 * service (rejeu) obtiennent exactement les mêmes valeurs. Aucun champ n'est mortel : il change seulement la vitesse, toujours progressivement
 * (fondus spatiaux et temporels), jamais de saut angulaire.
 */
export interface SpeedField {
  /** Facteur (1 = neutre) à l'angle `angle` (rad), à l'instant actif `t`, pour un vaisseau allant dans le sens `dir`. */
  factor(angle: number, t: number, dir: 1 | -1): number;
}

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** Appartenance (0–1) d'un angle à une zone centrée en `c`, de demi-largeur `half`, avec un fondu de largeur `edge` vers l'extérieur. */
export function zoneMembership(angle: number, c: number, half: number, edge: number): number {
  const d = Math.abs(wrapAngle(angle - c));
  return 1 - smooth((d - (half - edge)) / edge);
}

/**
 * Appartenance (0–1) SYMÉTRIQUE d'un angle à une zone centrée en `c` (de part et d'autre, ± `half`), fondu de largeur `edge` vers l'extérieur. Utilisée par la Mer
 * nébulaire (brumes, ondes de pression, puits). NB : `zoneMembership` ci-dessus (conservée à l'identique pour les tourbillons du Monde des vents) ne couvre que
 * le côté « angle > centre » de la zone ; ici la zone est bien centrée sur son centre, comme son dessin.
 */
export function zoneMembershipSym(angle: number, c: number, half: number, edge: number): number {
  const d = Math.abs(angleDiff(c, angle));
  return 1 - smooth((d - (half - edge)) / edge);
}

export interface Cloud {
  start: number;
  end: number;
  a0: number;
  drift: number;
  half: number;
}

export interface PressureWave {
  warnAt: number;
  start: number;
  end: number;
  a0: number;
  sign: 1 | -1;
}

/** Puits gravitationnel (Mer nébulaire) : anomalie autour d'un bloc flottant, vitesse selon le sens de déplacement. */
export interface GravityWell {
  warnAt: number;
  start: number;
  end: number;
  angle: number;
  /** Sens de rotation du puits : +1 = angles croissants. Aller dans ce sens = plus vite, à contre-sens = plus lent. */
  spin: 1 | -1;
}

export interface Vortex {
  warnAt: number;
  start: number;
  end: number;
  angle: number;
  /** Sens du tourbillon : +1 = sens des angles croissants (horaire à l'écran), −1 = inverse. */
  spin: 1 | -1;
}

export interface CloudView {
  center: number;
  half: number;
  presence: number;
}

export interface CurrentsView {
  /** Centre de l'hémisphère RAPIDE (rad). */
  fastCenter: number;
  /** Annonce d'inversion en cours (0 = aucune, 1 = échange imminent). */
  warning: number;
  /** Échange en cours (0–1, 0 hors échange). */
  swapping: number;
  /** Secondes avant la prochaine inversion (Infinity s'il n'y en a pas). */
  nextIn: number;
}

/** Index (0-based) de l'univers dont la mécanique est `kind` (−1 si absente). */
const worldOf = (kind: FieldKind): number => WORLD_LIST.findIndex((w) => w.field === kind);

/**
 * Champ des univers : nuages et ondes (Mer nébulaire), hémisphères, inversions et tourbillons (Monde des vents). Calendriers tirés d'un générateur
 * DÉDIÉ dérivé de la graine (indépendant des vagues et des actions du joueur), générés dans l'ordre et à la demande (le dernier univers est infini).
 */
export class WorldsField implements SpeedField {
  readonly clouds: Cloud[] = [];
  readonly waves: PressureWave[] = [];
  readonly wells: GravityWell[] = [];
  private readonly inversions: number[] = [];
  private readonly vortices: Vortex[] = [];
  private readonly invRng: Rng;
  private readonly vortexRng: Rng;
  private nextInversion: number;
  private nextVortex: number;
  private readonly cloudsWorld = worldOf('clouds');
  private readonly currentsWorld = worldOf('currents');

  constructor(seed: number) {
    const base = Math.imul(seed ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
    this.invRng = new Rng((base ^ 0x3c6ef372) >>> 0);
    this.vortexRng = new Rng((base ^ 0xa54ff53a) >>> 0);
    if (this.cloudsWorld >= 0) this.buildClouds(new Rng((base ^ 0x510e527f) >>> 0));
    const cs = this.currentsWorld >= 0 ? worldStart(this.currentsWorld) : Infinity;
    this.nextInversion = cs + CURRENTS.inversion.first;
    this.nextVortex = cs + CURRENTS.vortex.first;
  }

  /**
   * Brumes, ondes de pression et puits gravitationnels de la Mer nébulaire (univers fini : calendrier complet dès la création). Les nappes viennent du
   * générateur dédié ; les ondes et les puits ont leurs INSTANTS dans la carte musicale (config/world3.ts), seuls leurs angles et sens sont tirés.
   */
  private buildClouds(rng: Rng): void {
    const ws = worldStart(this.cloudsWorld);
    const we = this.cloudsWorld >= WORLD_LIST.length - 1 ? ws + 3600 : ws + WORLDS.span;
    for (let slot = 0; slot < CLOUDS.slots; slot++) {
      let t = ws + (CLOUDS.firstAt[slot] ?? 3 + 6 * slot);
      const until = Math.min(we, ws + (CLOUDS.until[slot] ?? WORLDS.span));
      // Emplacements répartis autour du cercle (jamais tous du même côté)
      let a = (slot / CLOUDS.slots) * Math.PI * 2 + rng.range(-0.5, 0.5);
      while (t < until) {
        const life = rng.range(CLOUDS.life.min, CLOUDS.life.max);
        const drift = rng.sign() * rng.range(CLOUDS.drift.min, CLOUDS.drift.max);
        this.clouds.push({ start: t, end: Math.min(until, t + life), a0: wrapAngle(a), drift, half: rng.range(CLOUDS.half.min, CLOUDS.half.max) });
        a += drift * life + rng.range(0.9, 2.2) * rng.sign();
        t += life + rng.range(CLOUDS.gap.min, CLOUDS.gap.max);
      }
    }
    const w = CLOUDS.wave;
    const turn = (w.turns * Math.PI * 2) / w.speed;
    for (const at of W3_WAVE_AT) {
      const start = ws + at;
      this.waves.push({ warnAt: start - w.warn, start, end: start + turn, a0: rng.range(0, Math.PI * 2), sign: rng.sign() as 1 | -1 });
    }
    for (const at of W3_WELL_AT) {
      const start = ws + at;
      const life = rng.range(W3_WELLS.life.min, W3_WELLS.life.max);
      this.wells.push({ warnAt: start - W3_WELLS.warn, start, end: Math.min(we, start + life), angle: rng.range(0, Math.PI * 2), spin: rng.sign() as 1 | -1 });
    }
  }

  /** Instants des inversions de courant jusqu'à `t` (générés dans l'ordre). */
  private inversionsUntil(t: number): number[] {
    while (this.nextInversion <= t + 10) {
      this.inversions.push(this.nextInversion);
      const iv = CURRENTS.inversion;
      this.nextInversion += iv.swap + this.invRng.range(iv.every.min, iv.every.max);
    }
    return this.inversions;
  }

  /** Tourbillons annoncés jusqu'à `t` (générés dans l'ordre ; deux tourbillons ne se chevauchent jamais). */
  vorticesUntil(t: number): Vortex[] {
    const v = CURRENTS.vortex;
    while (this.nextVortex <= t + 10) {
      const life = this.vortexRng.range(v.life.min, v.life.max);
      const warnAt = this.nextVortex;
      const start = warnAt + v.warn;
      this.vortices.push({ warnAt, start, end: start + life, angle: this.vortexRng.range(0, Math.PI * 2), spin: this.vortexRng.sign() as 1 | -1 });
      this.nextVortex = start + life + this.vortexRng.range(v.every.min, v.every.max);
    }
    return this.vortices;
  }

  /** Mécanique de l'univers à l'instant `t`. */
  kindAt(t: number): FieldKind {
    return WORLD_LIST[worldIndexAt(t)].field;
  }

  factor(angle: number, t: number, dir: 1 | -1): number {
    const kind = this.kindAt(t);
    if (kind === 'none') return 1;
    let f = kind === 'clouds' ? this.cloudsFactor(angle, t, dir) : this.currentsFactor(angle, t, dir);
    const c = kind === 'clouds' ? CLOUDS.clamp : CURRENTS.clamp;
    if (f < c.min) f = c.min;
    else if (f > c.max) f = c.max;
    return f;
  }

  // ————————————————————————— Mer nébulaire

  private cloudPresence(c: Cloud, t: number): number {
    if (t <= c.start || t >= c.end) return 0;
    return Math.min(smooth((t - c.start) / CLOUDS.fade), smooth((c.end - t) / CLOUDS.fade));
  }

  private cloudsFactor(angle: number, t: number, dir: 1 | -1): number {
    let f = 1;
    for (const c of this.clouds) {
      if (t <= c.start || t >= c.end) continue;
      const m = zoneMembershipSym(angle, c.a0 + c.drift * (t - c.start), c.half, CLOUDS.edge);
      if (m > 0) f *= 1 - (1 - CLOUDS.factor) * m * this.cloudPresence(c, t);
    }
    const w = CLOUDS.wave;
    for (const p of this.waves) {
      if (t < p.start || t > p.end) continue;
      const fade = Math.min(smooth((t - p.start) / 0.5), smooth((p.end - t) / 0.5));
      const m = zoneMembershipSym(angle, p.a0 + p.sign * w.speed * (t - p.start), w.half, w.edge);
      if (m > 0) f *= 1 - (1 - w.factor) * m * fade;
    }
    const q = W3_WELLS;
    for (const x of this.wells) {
      if (t < x.start || t > x.end) continue;
      const presence = Math.min(smooth((t - x.start) / 0.6), smooth((x.end - t) / 0.8));
      const m = zoneMembershipSym(angle, x.angle, q.half, q.edge) * presence;
      if (m > 0) f *= 1 + ((dir === x.spin ? q.with : q.against) - 1) * m;
    }
    return f;
  }

  /** Nuages visibles à l'instant `t` (rendu et outils). */
  cloudsAt(t: number, out: CloudView[] = []): CloudView[] {
    out.length = 0;
    for (const c of this.clouds) {
      const p = this.cloudPresence(c, t);
      if (p > 0) out.push({ center: wrapAngle(c.a0 + c.drift * (t - c.start)), half: c.half, presence: p });
    }
    return out;
  }

  /** Ondes de pression : annonce (0–1 avant le départ) ou front actif (angle). */
  wavesAt(t: number, out: { angle: number; warn: number; active: boolean; sign: 1 | -1 }[] = []): { angle: number; warn: number; active: boolean; sign: 1 | -1 }[] {
    out.length = 0;
    const w = CLOUDS.wave;
    for (const p of this.waves) {
      if (t < p.warnAt || t > p.end) continue;
      if (t < p.start) out.push({ angle: p.a0, warn: (t - p.warnAt) / w.warn, active: false, sign: p.sign });
      else out.push({ angle: wrapAngle(p.a0 + p.sign * w.speed * (t - p.start)), warn: 1, active: true, sign: p.sign });
    }
    return out;
  }

  /** Puits gravitationnels visibles (annoncés ou actifs) à l'instant `t`. */
  wellsAt(t: number, out: { angle: number; spin: 1 | -1; warn: number; presence: number }[] = []): { angle: number; spin: 1 | -1; warn: number; presence: number }[] {
    out.length = 0;
    for (const x of this.wells) {
      if (t < x.warnAt || t > x.end) continue;
      const warn = t < x.start ? (t - x.warnAt) / (x.start - x.warnAt) : 1;
      const presence = t < x.start ? 0 : Math.min(smooth((t - x.start) / 0.6), smooth((x.end - t) / 0.8));
      out.push({ angle: x.angle, spin: x.spin, warn, presence });
    }
    return out;
  }

  // ————————————————————————— Monde des vents

  /** Centre de l'hémisphère rapide à l'instant `t` (dérive lente + demi-tours des inversions, lissés). */
  fastCenter(t: number): number {
    const cs = worldStart(Math.max(0, this.currentsWorld));
    let phi = CURRENTS.fastCenter + CURRENTS.drift * Math.max(0, t - cs);
    for (const at of this.inversionsUntil(t)) {
      if (at > t) break;
      phi += Math.PI * smooth((t - at) / CURRENTS.inversion.swap);
    }
    return phi;
  }

  private currentsFactor(angle: number, t: number, dir: 1 | -1): number {
    const s = Math.sin(CURRENTS.edge);
    const c = Math.cos(angle - this.fastCenter(t));
    const fast = smooth((c + s) / (2 * s));
    let f = CURRENTS.slow + (CURRENTS.fast - CURRENTS.slow) * fast;
    const v = CURRENTS.vortex;
    for (const x of this.vorticesUntil(t)) {
      if (x.warnAt > t) break;
      if (t < x.start || t > x.end) continue;
      const presence = Math.min(smooth((t - x.start) / 0.6), smooth((x.end - t) / 0.6));
      const m = zoneMembership(angle, x.angle, v.half, v.edge) * presence;
      if (m > 0) f *= 1 + ((dir === x.spin ? v.with : v.against) - 1) * m;
    }
    return f;
  }

  /** État des courants (rendu, outils). */
  currentsAt(t: number): CurrentsView {
    const iv = CURRENTS.inversion;
    let warning = 0;
    let swapping = 0;
    let nextIn = Infinity;
    for (const at of this.inversionsUntil(t)) {
      if (t >= at && t < at + iv.swap) swapping = (t - at) / iv.swap;
      if (at > t) {
        nextIn = at - t;
        if (nextIn <= iv.warn) warning = 1 - nextIn / iv.warn;
        break;
      }
    }
    return { fastCenter: wrapAngle(this.fastCenter(t)), warning, swapping, nextIn };
  }

  /** Tourbillons visibles (annoncés ou actifs) à l'instant `t`. */
  vorticesAt(t: number, out: { angle: number; spin: 1 | -1; warn: number; presence: number }[] = []): { angle: number; spin: 1 | -1; warn: number; presence: number }[] {
    out.length = 0;
    for (const x of this.vorticesUntil(t)) {
      if (x.warnAt > t) break;
      if (t > x.end) continue;
      const warn = t < x.start ? (t - x.warnAt) / (x.start - x.warnAt) : 1;
      const presence = t < x.start ? 0 : Math.min(smooth((t - x.start) / 0.6), smooth((x.end - t) / 0.6));
      out.push({ angle: x.angle, spin: x.spin, warn, presence });
    }
    return out;
  }
}
