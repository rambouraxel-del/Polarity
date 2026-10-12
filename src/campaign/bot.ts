import { SAFETY, SIM } from '../config/balance';
import { wrapAngle } from '../core/math';
import { hasEscapePath } from '../sim/safety';
import type { CampaignSimulation } from './simulation';

/**
 * Joueur automatique de campagne (tests de faisabilité). Même principe que `Bot` (évitement garanti par le validateur),
 * avec en plus une cible : les balises, ou l'objet de mission quand il y en a un. Il est plus vif qu'un humain :
 * il prouve qu'une solution existe, il ne valide pas l'équilibrage ressenti.
 */
export class MissionBot {
  private stepsUntilDecision = 0;
  private readonly decisionSteps: number;

  constructor(
    private readonly sim: CampaignSimulation,
    private readonly margin = 6,
    decisionTime: number = SAFETY.decisionStep,
    private readonly reaction = 1e-6,
  ) {
    this.decisionSteps = Math.max(1, Math.round(decisionTime / SIM.dt));
  }

  tick(): void {
    if (this.stepsUntilDecision > 0) {
      this.stepsUntilDecision--;
      return;
    }
    this.stepsUntilDecision = this.decisionSteps - 1;
    const sim = this.sim;
    const base = { angle: sim.angle, time: sim.time, forcedTime: this.reaction, speed: sim.speedFn, margin: this.margin };
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
    if (this.backwardIsBetter() && flipSafe()) sim.flip();
  }

  /** Angles visés : l'objet de mission s'il existe, sinon les balises actives. */
  private targets(): number[] {
    const sim = this.sim;
    if (sim.objects.length > 0) return sim.objects.map((o) => o.angle);
    const { angles, active } = sim.beacons;
    return angles.filter((_, i) => active[i]);
  }

  private backwardIsBetter(): boolean {
    const a = this.sim.angle;
    let fwd = Infinity;
    let back = Infinity;
    for (const t of this.targets()) {
      const df = this.sim.dir === 1 ? wrapAngle(t - a) : wrapAngle(a - t);
      const db = 2 * Math.PI - df;
      if (df < fwd) fwd = df;
      if (db < back) back = db;
    }
    return back + 0.4 < fwd;
  }
}

/** Joue une mission complète. Renvoie la simulation (terminée, ou arrêtée à `maxTime`). */
export function playMission(sim: CampaignSimulation, maxTime = sim.mission.limit + 5, bot = new MissionBot(sim)): CampaignSimulation {
  const maxSteps = Math.round(maxTime / SIM.dt);
  for (let i = 0; i < maxSteps && sim.state === 'running'; i++) {
    bot.tick();
    sim.step();
    if (sim.events.length > 512) sim.events.length = 0;
    if (sim.campaignEvents.length > 512) sim.campaignEvents.length = 0;
  }
  return sim;
}
