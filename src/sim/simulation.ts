import { ARENA, PLAYER, SIM } from '../config/balance';
import { playerHitRadius, projectileHitRadius } from '../config/hitbox';
import { wrapAngle } from '../core/math';
import { Rng } from '../core/rng';
import { BeaconRing } from './beacons';
import { hazardHits } from './collision';
import type { EventKind } from '../config/events';
import { Director, type DifficultyProfile, type DirectorEvent } from './director';
import { projectileX, projectileY, type Hazard } from './hazards';
import { PATTERNS, type Family, type PatternId } from './patterns';
import { Scoring } from './scoring';
import { omegaAt, type SpeedFn } from './speed';

export type SimEvent =
  | { type: 'flip' }
  | { type: 'collect'; index: number; points: number; multiplier: number }
  | { type: 'cycle'; points: number; respite: number }
  | { type: 'multiplier'; value: number; up: boolean }
  | { type: 'warn'; kind: Hazard['kind']; family: Family }
  | { type: 'activate' }
  /** Transition du calendrier d'événements (annonce 2 s avant, début, fin, reprise après la respiration). */
  | { type: 'event'; stage: DirectorEvent['stage']; kind: EventKind }
  /** (x, y) : position du vaisseau ; (hitX, hitY) : point de contact avec la menace. */
  | { type: 'death'; x: number; y: number; hitX: number; hitY: number; by: Hazard['kind'] }
  | { type: 'complete' };

export type SimState = 'running' | 'dead' | 'complete';

export interface SimOptions {
  seed: number;
  profile: DifficultyProfile;
  /** Durée de la partie (Niveaux) ou null (Survie : illimitée). */
  timeLimit: number | null;
  /** Pour les tests : aucune collision. */
  invincible?: boolean;
}

/**
 * Simulation de gameplay, indépendante du rendu.
 * Avance par pas fixes de SIM.dt ; le temps actif est stepIndex · dt (pas de dérive flottante).
 *
 * Règle de fin de niveau (déterministe) : dans un pas donné, la collision est évaluée AVANT la fin
 * du chronomètre. Une collision survenant pendant le dernier pas est donc un échec ; le niveau est
 * réussi seulement si le pas qui atteint la durée limite s'achève sans collision.
 */
export class Simulation {
  readonly rng: Rng;
  readonly director: Director;
  readonly beacons = new BeaconRing();
  readonly scoring = new Scoring();
  readonly hazards: Hazard[] = [];
  readonly events: SimEvent[] = [];
  readonly timeLimit: number | null;
  private readonly limitSteps: number;
  /** Outil de test et de démonstration : sans collision. */
  invincible: boolean;
  /** Facteur de vitesse du vaisseau selon le temps de jeu actif (courbe de Survie, ou vitesse du niveau). */
  readonly speedFn: SpeedFn;

  state: SimState = 'running';
  stepIndex = 0;
  angle: number = PLAYER.startAngle;
  dir: 1 | -1 = PLAYER.startDirection;
  flips = 0;
  private pendingFlips = 0;
  private hazardCount = 0;
  /** Familles déjà vues pendant cette partie. */
  readonly seenFamilies = new Set<Family>();

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.director = new Director(opts.profile, this.rng, opts.seed);
    this.speedFn = opts.profile.speed;
    this.timeLimit = opts.timeLimit;
    this.limitSteps = opts.timeLimit === null ? Infinity : Math.round(opts.timeLimit / SIM.dt);
    this.invincible = opts.invincible ?? false;
  }

  get time(): number {
    return this.stepIndex * SIM.dt;
  }

  /** Inversion demandée : appliquée au début du prochain pas. Sans coût ni délai. */
  flip(): void {
    if (this.state !== 'running') return;
    this.pendingFlips++;
  }

  step(): void {
    if (this.state !== 'running') return;
    const dt = SIM.dt;
    const t0 = this.time;

    // 1. Inversions en attente (chaque action inverse exactement une fois)
    while (this.pendingFlips > 0) {
      this.pendingFlips--;
      this.dir = this.dir === 1 ? -1 : 1;
      this.flips++;
      this.events.push({ type: 'flip' });
    }

    // 2. Nouvelle vague éventuelle (un seul directeur : normal, annonce, événement ou respiration)
    const added = this.director.update(t0, this);
    const pend = this.director.pendingEvents;
    for (let i = 0; i < pend.length; i++) this.events.push({ type: 'event', stage: pend[i].stage, kind: pend[i].kind });
    pend.length = 0;
    if (added) {
      for (const h of added) {
        h.id = ++this.hazardCount;
        this.hazards.push(h);
      }
    }

    // 3. Annonces et activations (événements pour le son et l'affichage)
    for (const h of this.hazards) {
      if (!h.warned && t0 >= h.warnStart) {
        h.warned = true;
        const family = PATTERNS[h.pattern as keyof typeof PATTERNS]?.family ?? 'projectile';
        this.seenFamilies.add(family);
        this.events.push({ type: 'warn', kind: h.kind, family });
      }
      if (h.kind !== 'projectile' && !h.activated && t0 >= h.activeStart) {
        h.activated = true;
        this.events.push({ type: 'activate' });
      }
    }

    // 4. Déplacement
    const from = this.angle;
    // Vitesse réelle à cet instant (courbe progressive en Survie) : la direction seule change à l'inversion
    const delta = this.dir * omegaAt(this.speedFn, t0 + dt / 2) * dt;
    const t1 = t0 + dt;

    // 5. Collision continue sur [t0, t1] (évaluée avant tout le reste)
    if (!this.invincible) {
      for (const h of this.hazards) {
        if (hazardHits(h, from, delta, t0, t1, playerHitRadius())) {
          this.angle = from + delta;
          this.stepIndex++;
          this.die(h, t1);
          return;
        }
      }
    }
    this.angle = from + delta;

    // 6. Balises
    this.beacons.sweep(from, delta, this.onCollect, this.onCycle);

    // 7. Temps et combo
    this.stepIndex++;
    if (this.scoring.update(dt)) {
      this.events.push({ type: 'multiplier', value: this.scoring.multiplier, up: false });
    }

    // 8. Nettoyage des menaces terminées
    const now = this.time;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      if (this.hazards[i].end < now) this.hazards.splice(i, 1);
    }

    // 9. Fin de niveau
    if (this.stepIndex >= this.limitSteps) {
      this.state = 'complete';
      this.events.push({ type: 'complete' });
    }

    // Garde l'angle borné pour la précision sur de très longues parties
    if (this.stepIndex % 1024 === 0) this.angle = wrapAngle(this.angle);
  }

  /** Ajoute un motif tout de suite, sans validation d'évitement (outil de démonstration `?demo` et tests). */
  injectPattern(id: PatternId): Hazard[] {
    const added = this.director.buildPattern(id, this.time, this);
    for (const h of added) {
      h.id = ++this.hazardCount;
      this.hazards.push(h);
    }
    return added;
  }

  /** Avance de plusieurs pas (tests et outils). */
  advance(seconds: number): void {
    const n = Math.round(seconds / SIM.dt);
    for (let i = 0; i < n && this.state === 'running'; i++) this.step();
  }

  playerX(): number {
    return ARENA.orbitRadius * Math.cos(this.angle);
  }

  playerY(): number {
    return ARENA.orbitRadius * Math.sin(this.angle);
  }

  /** Vitesse angulaire actuelle du vaisseau (rad/s, toujours positive). */
  get omega(): number {
    return omegaAt(this.speedFn, this.time);
  }

  get playerAngle(): number {
    return this.angle;
  }

  get playerDir(): 1 | -1 {
    return this.dir;
  }

  private die(h: Hazard, t: number): void {
    if (this.state !== 'running') return;
    this.state = 'dead';
    this.pendingFlips = 0;
    const x = this.playerX();
    const y = this.playerY();
    let hitX = x;
    let hitY = y;
    if (h.kind === 'projectile') {
      // Contact : sur le segment entre les centres, à la frontière des deux hitboxes
      const bx = projectileX(h, Math.min(t, h.end));
      const by = projectileY(h, Math.min(t, h.end));
      const pr = playerHitRadius();
      const k = pr / (pr + projectileHitRadius());
      hitX = x + (bx - x) * k;
      hitY = y + (by - y) * k;
    }
    this.events.push({ type: 'death', x, y, hitX, hitY, by: h.kind });
  }

  private readonly onCollect = (index: number): void => {
    const before = this.scoring.multiplier;
    const points = this.scoring.collect();
    this.events.push({ type: 'collect', index, points, multiplier: this.scoring.multiplier });
    if (this.scoring.multiplier > before) {
      this.events.push({ type: 'multiplier', value: this.scoring.multiplier, up: true });
    }
  };

  private readonly onCycle = (): void => {
    const points = this.scoring.cycle();
    const respite = this.director.onCycleComplete(this.time);
    this.events.push({ type: 'cycle', points, respite });
  };
}
