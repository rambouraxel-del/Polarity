import { ARENA, PLAYER, SIM } from '../config/balance';
import { playerHitRadius, projectileHitRadius } from '../config/hitbox';
import { wrapAngle } from '../core/math';
import { Rng } from '../core/rng';
import { BeaconRing } from './beacons';
import { hazardHits } from './collision';
import { Director, type DifficultyProfile } from './director';
import { projectileX, projectileY, type Hazard } from './hazards';
import { PATTERNS, type Family } from './patterns';
import { Scoring } from './scoring';

export type SimEvent =
  | { type: 'flip' }
  | { type: 'collect'; index: number; points: number; multiplier: number }
  | { type: 'cycle'; points: number; respite: number }
  | { type: 'multiplier'; value: number; up: boolean }
  | { type: 'warn'; kind: Hazard['kind']; family: Family }
  | { type: 'activate' }
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
  private readonly invincible: boolean;

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
    this.director = new Director(opts.profile, this.rng);
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

    // 2. Nouvelle vague éventuelle
    const added = this.director.update(t0, this);
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
      if (h.kind === 'sector' && !h.activated && t0 >= h.activeStart) {
        h.activated = true;
        this.events.push({ type: 'activate' });
      }
    }

    // 4. Déplacement
    const from = this.angle;
    const delta = this.dir * PLAYER.angularSpeed * dt;
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
