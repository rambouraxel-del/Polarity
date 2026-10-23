import { PLAYER, SAFETY } from '../config/balance';
import { playerHitRadius } from '../config/hitbox';
import { hazardHits } from './collision';
import { dangerWindow, type Hazard } from './hazards';
import { omegaAt, timeAfterTravel, type SpeedFn } from './speed';
import type { SpeedField } from './field';

/**
 * Validateur d'évitement.
 *
 * Modèle de joueur : il décide (continuer ou inverser) à intervalles d'**angle** constants, calés sur la vitesse réelle
 * du vaisseau à l'instant de la requête (≈ une décision toutes les `decisionStep` secondes), avance à la vitesse réelle
 * (variable en Survie), et utilise une hitbox élargie d'une marge de sécurité. Toutes les positions atteignables
 * restent ainsi sur un même réseau d'angles ; les durées des pas suivent le profil de vitesse.
 * On calcule l'ensemble des positions atteignables sans collision, pas à pas, jusqu'à ce que toutes les menaces
 * connues aient disparu. S'il reste au moins une position, un trajet existe.
 *
 * Ce n'est pas une preuve absolue de jouabilité pour un humain (réflexes, précision), mais cela écarte les
 * combinaisons manifestement inévitables pour un joueur réactif et prudent, quelle que soit la vitesse du vaisseau.
 */

export interface EscapeQuery {
  angle: number;
  dir: 1 | -1;
  time: number;
  /** Durée (s) pendant laquelle la direction est imposée (temps de réaction) : `forcedDir`. */
  forcedTime: number;
  forcedDir: 1 | -1;
  /** Facteur de vitesse du vaisseau selon le temps de jeu actif. */
  speed: SpeedFn;
  margin?: number;
  horizon?: number;
  /**
   * Univers : champ de vitesse selon la position (nuages, hémisphères, tourbillons). Présent = modèle à pas de TEMPS constants (les positions ne sont
   * plus sur un réseau d'angles régulier) ; absent = modèle historique, strictement inchangé.
   */
  field?: SpeedField;
}

/** Une marge de pas supplémentaire : la vitesse peut augmenter pendant l'horizon (pas plus courts). */
const MAX_STEPS = Math.ceil((SAFETY.maxHorizon / SAFETY.decisionStep) * 1.6) + 2;
const SIZE = 2 * MAX_STEPS + 3;
let cur = new Uint8Array(SIZE);
let nxt = new Uint8Array(SIZE);
const relevant: Hazard[] = [];
const stepTimes = new Float64Array(MAX_STEPS + 2);

export function hasEscapePath(hazards: readonly Hazard[], q: EscapeQuery): boolean {
  if (q.field) return hasEscapePathField(hazards, q, q.field);
  const ds = SAFETY.decisionStep;
  const sub = SAFETY.subSteps;
  const margin = q.margin ?? SAFETY.margin;
  // Pas du réseau : angle parcouru en `decisionStep` secondes à la vitesse de l'instant
  const unit = omegaAt(q.speed, q.time) * ds;
  // Horizon : fin de la dernière menace dangereuse
  let lastEnd = q.time;
  for (const h of hazards) {
    const w = dangerWindow(h);
    if (w.to > lastEnd) lastEnd = w.to;
  }
  const endTime = q.time + Math.min(q.horizon ?? SAFETY.maxHorizon, SAFETY.maxHorizon, lastEnd - q.time);
  if (endTime <= q.time) return true;

  // Instants des pas : chaque pas parcourt exactement `unit` radians
  stepTimes[0] = q.time;
  let steps = 0;
  while (steps < MAX_STEPS && stepTimes[steps] < endTime) {
    stepTimes[steps + 1] = timeAfterTravel(q.speed, stepTimes[steps], unit);
    steps++;
  }
  const center = MAX_STEPS + 1;

  cur.fill(0);
  cur[center] = 1;
  let lo = center;
  let hi = center;
  const forcedUntil = q.time + q.forcedTime - 1e-9;

  for (let k = 0; k < steps; k++) {
    const t0 = stepTimes[k];
    const t1 = stepTimes[k + 1];
    relevant.length = 0;
    for (const h of hazards) {
      const w = dangerWindow(h);
      if (w.to + SAFETY.timeMargin >= t0 && w.from - SAFETY.timeMargin <= t1) relevant.push(h);
    }
    nxt.fill(0);
    let any = false;
    let nlo = SIZE;
    let nhi = -1;
    const forced = t0 < forcedUntil;
    for (let i = lo; i <= hi; i++) {
      if (!cur[i]) continue;
      const a = q.angle + (i - center) * unit;
      for (let s = -1; s <= 1; s += 2) {
        if (forced && s !== q.forcedDir) continue;
        const j = i + s;
        if (nxt[j]) continue;
        if (transitionSafe(a, s * unit, t0, t1 - t0, sub, margin)) {
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

function transitionSafe(a: number, delta: number, t0: number, dt: number, sub: number, margin: number): boolean {
  if (relevant.length === 0) return true;
  const sd = delta / sub;
  const st = dt / sub;
  const pr = playerHitRadius();
  for (let j = 0; j < sub; j++) {
    const sa = a + sd * j;
    const s0 = t0 + st * j;
    for (const h of relevant) {
      if (hazardHits(h, sa, sd, s0, s0 + st, pr, margin, SAFETY.timeMargin)) return false;
    }
  }
  return true;
}

/**
 * Modèle à champ de vitesse : les positions atteignables sont regroupées par cases d'angle de `FIELD_BIN_UNIT` × (angle parcouru en une décision à
 * la vitesse de base), comme le réseau du modèle historique (dont les positions d'un même pas sont espacées de 2 unités). Sous-pas : 3.
 */
const FIELD_BIN_UNIT = 0.6;
const FIELD_SUB = 3;
const FIELD_MAX_STATES = 200;
let fieldCur = new Float64Array(FIELD_MAX_STATES);
let fieldNxt = new Float64Array(FIELD_MAX_STATES);
const fieldSeen = new Set<number>();

/**
 * Validateur à vitesse VARIABLE selon la position : le joueur modélisé décide toutes les `decisionStep` secondes (continuer ou inverser) ; chaque
 * décision est intégrée en sous-pas avec la vitesse réelle (courbe de temps × champ à sa position, dans son sens), et testée par la même détection
 * continue que la simulation. Les positions atteignables sont regroupées par cases d'angle (`FIELD_BIN`) pour rester bornées.
 */
function hasEscapePathField(hazards: readonly Hazard[], q: EscapeQuery, field: SpeedField): boolean {
  const ds = SAFETY.decisionStep;
  const sub = FIELD_SUB;
  const margin = q.margin ?? SAFETY.margin;
  let lastEnd = q.time;
  for (const h of hazards) {
    const w = dangerWindow(h);
    if (w.to > lastEnd) lastEnd = w.to;
  }
  const endTime = q.time + Math.min(q.horizon ?? SAFETY.maxHorizon, SAFETY.maxHorizon, lastEnd - q.time);
  if (endTime <= q.time) return true;
  const pr = playerHitRadius();
  const bin = Math.max(0.04, FIELD_BIN_UNIT * omegaAt(q.speed, q.time) * ds);
  const forcedUntil = q.time + q.forcedTime - 1e-9;
  let n = 1;
  fieldCur[0] = q.angle;
  for (let t0 = q.time; t0 < endTime; t0 += ds) {
    const t1 = t0 + ds;
    relevant.length = 0;
    for (const h of hazards) {
      const w = dangerWindow(h);
      if (w.to + SAFETY.timeMargin >= t0 && w.from - SAFETY.timeMargin <= t1) relevant.push(h);
    }
    const forced = t0 < forcedUntil;
    fieldSeen.clear();
    let m = 0;
    const st = ds / sub;
    for (let i = 0; i < n; i++) {
      for (let s = -1; s <= 1; s += 2) {
        if (forced && s !== q.forcedDir) continue;
        let a = fieldCur[i];
        let ok = true;
        for (let j = 0; j < sub && ok; j++) {
          const s0 = t0 + st * j;
          const mid = s0 + st / 2;
          // Même estimation que la simulation : facteur du champ à mi-sous-pas
          const base = s * omegaAt(q.speed, mid) * st;
          const sd = base * field.factor(a + base * 0.5, mid, s as 1 | -1);
          for (const h of relevant) {
            if (hazardHits(h, a, sd, s0, s0 + st, pr, margin, SAFETY.timeMargin)) {
              ok = false;
              break;
            }
          }
          a += sd;
        }
        if (!ok) continue;
        const key = Math.round(a / bin);
        if (fieldSeen.has(key)) continue;
        fieldSeen.add(key);
        if (m < FIELD_MAX_STATES) fieldNxt[m++] = a;
      }
    }
    if (m === 0) return false;
    const tmp = fieldCur;
    fieldCur = fieldNxt;
    fieldNxt = tmp;
    n = m;
  }
  return true;
}

/** Vitesse angulaire de référence (rad/s), exposée pour les outils. */
export const REFERENCE_OMEGA = PLAYER.angularSpeed;
