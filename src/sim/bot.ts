import { SAFETY, SIM } from '../config/balance';
import { wrapAngle } from '../core/math';
import { hasEscapePath } from './safety';
import type { Simulation } from './simulation';

/**
 * Joueur automatique pour les tests et l'équilibrage. Il connaît parfaitement les menaces annoncées
 * et décide toutes les `decisionStep` secondes. Il est bien plus réactif qu'un humain : ses résultats
 * servent à vérifier la cohérence du générateur, pas à valider l'équilibrage ressenti.
 */
export class Bot {
  private stepsUntilDecision = 0;
  private readonly decisionSteps = Math.round(SAFETY.decisionStep / SIM.dt);

  constructor(private readonly sim: Simulation, private readonly greed = true, private readonly margin = 6) {}

  /** À appeler avant chaque pas de simulation. */
  tick(): void {
    if (this.stepsUntilDecision > 0) {
      this.stepsUntilDecision--;
      return;
    }
    this.stepsUntilDecision = this.decisionSteps - 1;
    const sim = this.sim;
    const base = { angle: sim.angle, time: sim.time, forcedSteps: 1, margin: this.margin };
    const keepOk = hasEscapePath(sim.hazards, { ...base, dir: sim.dir, forcedDir: sim.dir });
    let flipOk: boolean | null = null;
    const flipSafe = (): boolean => {
      if (flipOk === null) {
        const rev = sim.dir === 1 ? -1 : 1;
        flipOk = hasEscapePath(sim.hazards, { ...base, dir: rev, forcedDir: rev });
      }
      return flipOk;
    };
    if (!keepOk) {
      if (flipSafe()) sim.flip();
      return;
    }
    if (this.greed && this.backwardIsBetter() && flipSafe()) sim.flip();
  }

  private backwardIsBetter(): boolean {
    const { angles, active } = this.sim.beacons;
    let fwd = Infinity;
    let back = Infinity;
    const a = this.sim.angle;
    for (let i = 0; i < angles.length; i++) {
      if (!active[i]) continue;
      const df = this.sim.dir === 1 ? wrapAngle(angles[i] - a) : wrapAngle(a - angles[i]);
      const db = 2 * Math.PI - df;
      if (df < fwd) fwd = df;
      if (db < back) back = db;
    }
    return back + 0.4 < fwd;
  }
}

/** Joue une partie complète avec le bot. Renvoie la simulation terminée (ou arrêtée à maxTime). */
export function playWithBot(sim: Simulation, maxTime: number, greed = true): Simulation {
  const bot = new Bot(sim, greed);
  const maxSteps = Math.round(maxTime / SIM.dt);
  for (let i = 0; i < maxSteps && sim.state === 'running'; i++) {
    bot.tick();
    sim.step();
    if (sim.events.length > 512) sim.events.length = 0;
  }
  return sim;
}
