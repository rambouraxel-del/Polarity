import { SIM, UI } from '../config/balance';
import { createSimulation, type RunConfig } from '../modes/run';
import type { RunSummary } from '../progression/progress';
import type { SimEvent, Simulation } from '../sim/simulation';

export type Phase = 'running' | 'paused' | 'countdown' | 'ending' | 'over';

export interface SessionHooks {
  /** Appelé avant chaque pas de simulation (outil de démonstration). */
  onBeforeStep?(session: GameSession): void;
  onEvent?(e: SimEvent, session: GameSession): void;
  onPhase?(phase: Phase, session: GameSession): void;
  /** Appelé une seule fois, à la fin de la partie (mort ou réussite). */
  onEnd?(summary: RunSummary, session: GameSession): void;
}

/**
 * Gestion d'une partie : horloge à pas fixe, pause, compte à rebours de reprise et fin de partie.
 * Le temps actif n'avance que dans la phase « running » : ni la pause, ni le compte à rebours,
 * ni l'arrière-plan ne comptent.
 */
export class GameSession {
  readonly sim: Simulation;
  phase: Phase = 'running';
  /** Temps réel accumulé non encore simulé (sert aussi à l'interpolation du rendu). */
  acc = 0;
  /** Temps restant du compte à rebours de reprise. */
  countdown = 0;
  private endTimer = 0;
  private ended = false;

  constructor(readonly config: RunConfig, private readonly hooks: SessionHooks = {}) {
    this.sim = createSimulation(config);
  }

  /** Avance d'une image de durée réelle `realDt` (secondes). */
  frame(realDt: number): void {
    const dt = Math.max(0, Math.min(realDt, SIM.maxFrameTime));
    switch (this.phase) {
      case 'running': {
        this.acc += dt;
        while (this.acc >= SIM.dt && this.sim.state === 'running') {
          this.hooks.onBeforeStep?.(this);
          this.sim.step();
          this.acc -= SIM.dt;
          this.drain();
        }
        if (this.sim.state !== 'running') {
          this.acc = 0;
          this.endTimer = this.sim.state === 'dead' ? UI.deathScreenDelay : 0.5;
          this.setPhase('ending');
        }
        break;
      }
      case 'countdown':
        this.countdown -= dt;
        if (this.countdown <= 0) {
          this.countdown = 0;
          this.setPhase('running');
        }
        break;
      case 'ending':
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.finish();
        break;
      default:
        break;
    }
  }

  /** Action de jeu (clic, toucher, Espace) : une inversion, uniquement en jeu. */
  action(): boolean {
    if (this.phase !== 'running') return false;
    this.sim.flip();
    return true;
  }

  pause(): void {
    if (this.phase === 'running' || this.phase === 'countdown') {
      this.countdown = 0;
      this.setPhase('paused');
    }
  }

  /** Reprise volontaire : bref compte à rebours avant que le temps ne reparte. */
  resume(): void {
    if (this.phase !== 'paused') return;
    this.countdown = UI.resumeCountdown * UI.resumeStep;
    this.setPhase('countdown');
  }

  /** Abandon (retour au menu, recommencer) : aucun résultat enregistré. */
  abort(): void {
    this.ended = true;
    this.phase = 'over';
  }

  get isPausable(): boolean {
    return this.phase === 'running' || this.phase === 'countdown';
  }

  summary(): RunSummary {
    const s = this.sim;
    return {
      mode: this.config.mode,
      levelId: this.config.level?.id,
      date: this.config.date,
      time: s.time,
      score: s.scoring.score,
      cycles: s.scoring.cycles,
      bestMultiplier: s.scoring.bestMultiplier,
      outcome: s.state === 'complete' ? 'complete' : 'dead',
    };
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.setPhase('over');
    this.hooks.onEnd?.(this.summary(), this);
  }

  private drain(): void {
    const ev = this.sim.events;
    if (ev.length === 0) return;
    for (let i = 0; i < ev.length; i++) this.hooks.onEvent?.(ev[i], this);
    ev.length = 0;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.hooks.onPhase?.(p, this);
  }
}
