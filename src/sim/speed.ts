import { PLAYER } from '../config/balance';

/** Fonction « facteur de vitesse selon le temps de jeu actif » (1 = vitesse de référence). */
export type SpeedFn = (t: number) => number;

/** Vitesse angulaire (rad/s) à l'instant t. */
export function omegaAt(speed: SpeedFn, t: number): number {
  return PLAYER.angularSpeed * speed(t);
}

/** Angle parcouru (rad, toujours positif) entre t0 et t1 si le vaisseau ne change pas de direction. */
export function angularTravel(speed: SpeedFn, t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  const n = Math.max(1, Math.ceil((t1 - t0) / 0.1));
  const h = (t1 - t0) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += speed(t0 + (i + 0.5) * h);
  return PLAYER.angularSpeed * sum * h;
}

/** Instant t' > t auquel le vaisseau a parcouru l'angle `angle` (rad) en partant de t. */
export function timeAfterTravel(speed: SpeedFn, t: number, angle: number): number {
  let dt = angle / omegaAt(speed, t);
  dt = angle / omegaAt(speed, t + dt / 2);
  dt = angle / omegaAt(speed, t + dt / 2);
  return t + dt;
}
