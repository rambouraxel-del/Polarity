import { PLAYER, SAFETY } from '../config/balance';
import { hazardHits } from './collision';
import type { Hazard } from './hazards';

/**
 * Validateur d'évitement.
 *
 * Modèle de joueur : il prend une décision (continuer ou inverser) toutes les `decisionStep` secondes,
 * avance à vitesse constante, et utilise une hitbox élargie d'une marge de sécurité.
 * On calcule l'ensemble des positions atteignables sans collision, pas à pas, jusqu'à ce que
 * toutes les menaces connues aient disparu. S'il reste au moins une position, un trajet existe.
 *
 * Ce n'est pas une preuve absolue de jouabilité pour un humain (réflexes, précision), mais cela
 * écarte les combinaisons manifestement inévitables pour un joueur réactif et prudent.
 */

export interface EscapeQuery {
  angle: number;
  dir: 1 | -1;
  time: number;
  /** Nombre de décisions initiales imposées dans `forcedDir` (temps de réaction). */
  forcedSteps: number;
  forcedDir: 1 | -1;
  margin?: number;
  horizon?: number;
}

const MAX_STEPS = Math.ceil(SAFETY.maxHorizon / SAFETY.decisionStep) + 2;
const SIZE = 2 * MAX_STEPS + 3;
let cur = new Uint8Array(SIZE);
let nxt = new Uint8Array(SIZE);
const relevant: Hazard[] = [];

export function hasEscapePath(hazards: readonly Hazard[], q: EscapeQuery): boolean {
  const ds = SAFETY.decisionStep;
  const sub = SAFETY.subSteps;
  const margin = q.margin ?? SAFETY.margin;
  const unit = PLAYER.angularSpeed * ds;
  // Horizon : fin de la dernière menace dangereuse
  let lastEnd = q.time;
  for (const h of hazards) if (h.threatEnd > lastEnd) lastEnd = h.threatEnd;
  const horizon = Math.min(q.horizon ?? SAFETY.maxHorizon, SAFETY.maxHorizon, lastEnd - q.time);
  if (horizon <= 0) return true;
  const steps = Math.min(MAX_STEPS, Math.ceil(horizon / ds));
  const center = MAX_STEPS + 1;

  cur.fill(0);
  cur[center] = 1;
  let lo = center;
  let hi = center;

  for (let k = 0; k < steps; k++) {
    const t0 = q.time + k * ds;
    const t1 = t0 + ds;
    relevant.length = 0;
    for (const h of hazards) {
      const ds0 = h.kind === 'projectile' ? h.launch : h.activeStart - SAFETY.timeMargin;
      const de = h.kind === 'projectile' ? h.threatEnd : h.end + SAFETY.timeMargin;
      if (de >= t0 && ds0 <= t1) relevant.push(h);
    }
    nxt.fill(0);
    let any = false;
    let nlo = SIZE;
    let nhi = -1;
    for (let i = lo; i <= hi; i++) {
      if (!cur[i]) continue;
      const a = q.angle + (i - center) * unit;
      for (let s = -1; s <= 1; s += 2) {
        if (k < q.forcedSteps && s !== q.forcedDir) continue;
        const j = i + s;
        if (nxt[j]) continue;
        if (transitionSafe(a, s * unit, t0, ds, sub, margin)) {
          nxt[j] = 1;
          any = true;
          if (j < nlo) nlo = j;
          if (j > nhi) nhi = j;
        }
      }
    }
    if (!any) return false;
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
    lo = nlo;
    hi = nhi;
  }
  return true;
}

function transitionSafe(a: number, delta: number, t0: number, ds: number, sub: number, margin: number): boolean {
  if (relevant.length === 0) return true;
  const sd = delta / sub;
  const st = ds / sub;
  for (let j = 0; j < sub; j++) {
    const sa = a + sd * j;
    const s0 = t0 + st * j;
    for (const h of relevant) {
      if (hazardHits(h, sa, sd, s0, s0 + st, PLAYER.hitRadius, margin, SAFETY.timeMargin)) return false;
    }
  }
  return true;
}
