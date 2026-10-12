import { ARENA } from '../config/balance';
import { SHARDS } from '../config/economy';
import { angleDiff, sweepOverlapsArc, TAU, wrapAngle } from '../core/math';
import { Rng } from '../core/rng';
import { timeAfterTravel, type SpeedFn } from './speed';

/**
 * Éclat sur l'orbite (Survie) : un seul à la fois, disponible SHARDS.lifetime secondes de temps de jeu actif, puis
 * nouvelle apparition SHARDS.nextDelay après sa collecte ou sa disparition.
 *
 * - Tirages : générateur dédié dérivé de la graine : le directeur de vagues, les événements et la difficulté ne changent pas.
 * - Temps : uniquement le temps de simulation (la pause l'arrête, ainsi que l'expiration et les animations qui en dépendent).
 * - Emplacement : jamais près du vaisseau, jamais sur une balise active, et toujours accessible avec la vitesse réelle du
 *   vaisseau après une inversion (marge de réaction comprise). Cela ne garantit pas une collecte sans risque.
 */
export interface ActiveShard {
  id: number;
  angle: number;
  spawnedAt: number;
  expiresAt: number;
}

export type ShardEvent =
  | { type: 'shard-spawn'; id: number; angle: number }
  | { type: 'shard-collect'; id: number; amount: number; angle: number }
  | { type: 'shard-expire'; id: number; angle: number };

export interface ShardWorld {
  /** Angle et direction du vaisseau à l'instant de l'appel (après son déplacement). */
  angle: number;
  dir: 1 | -1;
  /** Balises : seules les actives comptent pour l'écart minimal. */
  beacons: { readonly angles: readonly number[]; readonly active: readonly boolean[] };
  speed: SpeedFn;
}

const range = (rng: Rng, r: { min: number; max: number }): number => rng.range(r.min, r.max);

/** Demi-arc de collecte (rad). */
export const shardHalfArc = (): number => SHARDS.collectRadius / ARENA.orbitRadius;

/**
 * Vrai si l'éclat placé à `target`, apparu à l'instant `now`, peut encore être atteint : soit en continuant dans le sens actuel,
 * soit après une inversion immédiate (durée retranchée de la marge de réaction), avec la vitesse réelle du vaisseau.
 */
export function shardReachable(target: number, angle: number, dir: 1 | -1, now: number, speed: SpeedFn): boolean {
  const half = shardHalfArc();
  const ahead = wrapAngle((target - angle) * dir);
  const behind = TAU - ahead;
  const time = (rad: number): number => timeAfterTravel(speed, now, Math.max(0, rad - half)) - now;
  return time(ahead) <= SHARDS.lifetime || time(behind) <= SHARDS.lifetime - SHARDS.reactionMargin;
}

export class ShardSpawner {
  active: ActiveShard | null = null;
  /** Instant de la prochaine apparition (Infinity pendant qu'un éclat est présent). */
  nextAt: number;
  /** Éclats collectés pendant cette partie, et gain total (Éclats). */
  collected = 0;
  income = 0;
  /** Éclats apparus sans être collectés. */
  missed = 0;
  private counter = 0;
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(Math.imul(seed ^ 0x51ed270b, 0x2545f491) >>> 0);
    this.nextAt = range(this.rng, SHARDS.firstDelay);
  }

  /** Temps de jeu restant avant la disparition (0 s'il n'y a pas d'éclat). */
  remaining(now: number): number {
    return this.active ? Math.max(0, this.active.expiresAt - now) : 0;
  }

  /**
   * Un pas de simulation : le vaisseau a parcouru [from, from + delta] et le temps est maintenant `now`.
   * Collecte, disparition ou apparition ; les événements sont ajoutés à `out`.
   */
  step(now: number, from: number, delta: number, world: ShardWorld, out: ShardEvent[]): void {
    const a = this.active;
    if (a) {
      if (sweepOverlapsArc(from, delta, a.angle, shardHalfArc())) {
        this.active = null;
        this.collected++;
        this.income += SHARDS.reward;
        this.nextAt = now + range(this.rng, SHARDS.nextDelay);
        out.push({ type: 'shard-collect', id: a.id, amount: SHARDS.reward, angle: a.angle });
      } else if (now >= a.expiresAt) {
        this.active = null;
        this.missed++;
        this.nextAt = now + range(this.rng, SHARDS.nextDelay);
        out.push({ type: 'shard-expire', id: a.id, angle: a.angle });
      }
      return;
    }
    if (now >= this.nextAt) {
      const angle = this.pickAngle(now, world);
      this.active = { id: ++this.counter, angle, spawnedAt: now, expiresAt: now + SHARDS.lifetime };
      this.nextAt = Infinity;
      out.push({ type: 'shard-spawn', id: this.counter, angle });
    }
  }

  /** Emplacement aléatoire respectant les écarts et l'accessibilité ; repli : devant le vaisseau, à portée garantie. */
  private pickAngle(now: number, w: ShardWorld): number {
    for (let i = 0; i < SHARDS.attempts; i++) {
      const angle = wrapAngle(this.rng.range(0, TAU));
      if (Math.abs(angleDiff(w.angle, angle)) < SHARDS.minShipGap) continue;
      if (w.beacons.angles.some((b, k) => w.beacons.active[k] && Math.abs(angleDiff(b, angle)) < SHARDS.minBeaconGap)) continue;
      if (!shardReachable(angle, w.angle, w.dir, now, w.speed)) continue;
      return angle;
    }
    // Repli : sur la trajectoire du vaisseau, assez loin pour ne pas être offert, assez près pour rester accessible
    const dist = SHARDS.minShipGap + 0.4 + this.rng.range(0, 0.8);
    return wrapAngle(w.angle + w.dir * dist);
  }
}
