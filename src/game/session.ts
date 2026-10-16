import { SIM, UI } from '../config/balance';
import { PHASES } from '../config/phases';
import { CampaignSimulation, NO_UPGRADES, type CampaignEvent } from '../campaign/simulation';
import { createSimulation, type RunConfig } from '../modes/run';
import type { RunSummary } from '../progression/progress';
import type { PowerKind } from '../config/powers';
import type { SimEvent, Simulation } from '../sim/simulation';

/** `offer` : la première (ou deuxième) mort a eu lieu, une reprise est proposée (le temps n'avance pas). */
export type Phase = 'running' | 'paused' | 'countdown' | 'ending' | 'offer' | 'over';

export interface SessionHooks {
  /** Appelé avant chaque pas de simulation (outil de démonstration). */
  onBeforeStep?(session: GameSession): void;
  onEvent?(e: SimEvent, session: GameSession): void;
  /** Événements propres à la campagne (objets, bouclier, transmissions). */
  onCampaignEvent?(e: CampaignEvent, session: GameSession): void;
  onPhase?(phase: Phase, session: GameSession): void;
  /** Appelé une seule fois, à la fin de la partie (mort ou réussite). */
  onEnd?(summary: RunSummary, session: GameSession): void;
  /** Survie : PREMIÈRE mort. La tentative classée est figée (résumé de la première vie) ; elle ne changera plus, quelles que soient les reprises. */
  onFirstDeath?(summary: RunSummary, session: GameSession): void;
  /** Une reprise est-elle proposable après cette mort ? (absent ou faux : la partie se termine directement) */
  canOffer?(session: GameSession): boolean;
  /** Traversée de la faille (Survie, 300 s de survie active) : `start` (tout est suspendu) puis `end` (la phase 2 commence au pas suivant). */
  onTransit?(stage: 'start' | 'end', session: GameSession): void;
  /** Phase « offer » atteinte : l'application affiche l'écran de reprise. */
  onOffer?(life: number, session: GameSession): void;
}

/**
 * Gestion d'une partie : horloge à pas fixe, pause, compte à rebours de reprise et fin de partie.
 * Le temps actif n'avance que dans la phase « running » : ni la pause, ni le compte à rebours,
 * ni l'arrière-plan ne comptent.
 */
export class GameSession {
  readonly sim: Simulation;
  /** La même simulation, vue campagne (null hors campagne). */
  readonly campaign: CampaignSimulation | null;
  phase: Phase = 'running';
  /** Temps réel accumulé non encore simulé (sert aussi à l'interpolation du rendu). */
  acc = 0;
  /** Temps restant du compte à rebours de reprise. */
  countdown = 0;
  private endTimer = 0;
  private ended = false;
  private firstDeathDone = false;
  /** Secondes de traversée restantes (0 = pas de traversée en cours). Pendant la traversée, la simulation n'avance PAS. */
  transitLeft = 0;
  /** La traversée a déjà eu lieu pendant cette partie (une seule fois, reprises comprises). */
  private transitDone = false;

  constructor(readonly config: RunConfig, private readonly hooks: SessionHooks = {}) {
    if (config.mode === 'campaign') {
      if (!config.mission) throw new Error('Mission manquante');
      this.campaign = CampaignSimulation.create(config.mission, config.seed, config.upgrades ?? NO_UPGRADES);
      this.sim = this.campaign;
    } else {
      this.campaign = null;
      this.sim = createSimulation(config);
    }
  }

  /** Avance d'une image de durée réelle `realDt` (secondes). */
  frame(realDt: number): void {
    const dt = Math.max(0, Math.min(realDt, SIM.maxFrameTime));
    switch (this.phase) {
      case 'running': {
        // Traversée de la faille : le temps de jeu est gelé (chronomètre, score, dangers, collisions, bonus, commandes) ; seul le décor avance
        if (this.transitLeft > 0) {
          this.acc = 0;
          this.transitLeft -= dt;
          if (this.transitLeft <= 0) {
            this.transitLeft = 0;
            this.hooks.onTransit?.('end', this);
          }
          break;
        }
        this.acc += dt;
        while (this.acc >= SIM.dt && this.sim.state === 'running') {
          if (this.shouldTransit()) {
            this.transitDone = true;
            this.transitLeft = PHASES.transit;
            this.acc = 0;
            this.hooks.onTransit?.('start', this);
            break;
          }
          this.hooks.onBeforeStep?.(this);
          this.sim.step();
          this.acc -= SIM.dt;
          this.drain();
        }
        if (this.sim.state !== 'running') {
          this.acc = 0;
          // Première mort de Survie : le résultat classé est figé et traité tout de suite (jamais attendre une éventuelle reprise)
          if (this.config.mode === 'survival' && this.sim.state === 'dead' && !this.firstDeathDone) {
            this.firstDeathDone = true;
            this.hooks.onFirstDeath?.(this.summary(), this);
          }
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
        if (this.endTimer <= 0) {
          if (this.offerable()) {
            this.setPhase('offer');
            this.hooks.onOffer?.(this.sim.life + 1, this);
          } else this.finish();
        }
        break;
      default:
        break;
    }
  }

  /** La traversée commence-t-elle maintenant ? (Survie à phases, exactement à 300 s de survie active, une seule fois) */
  private shouldTransit(): boolean {
    return this.config.mode === 'survival' && !this.transitDone && this.sim.director.phased && this.sim.phase === 1 && this.sim.stepIndex >= PHASES.phase2Step;
  }

  /** Action de jeu (clic, toucher, Espace) : une inversion, uniquement en jeu (jamais pendant la traversée). */
  action(): boolean {
    if (this.phase !== 'running' || this.transitLeft > 0) return false;
    this.sim.flip();
    return true;
  }

  /** Une reprise peut-elle être proposée ? (Survie, première ou deuxième mort, jamais de quatrième vie) */
  private offerable(): boolean {
    return this.config.mode === 'survival' && this.sim.canRevive && this.hooks.canOffer?.(this) === true;
  }

  /** Activation d'un pouvoir (Boost, Gel, Bouclier) : jamais une inversion. Appliquée au début du prochain pas, seulement en jeu. */
  power(kind: PowerKind): boolean {
    if (this.phase !== 'running' || this.transitLeft > 0) return false;
    this.sim.power(kind);
    return true;
  }

  /** REPRISE acceptée (paiement confirmé ailleurs) : la partie continue, NON CLASSÉE, après le bref compte à rebours. */
  revive(): boolean {
    if (this.phase !== 'offer' || !this.sim.revive()) return false;
    this.ended = false;
    this.acc = 0;
    this.countdown = UI.resumeCountdown * UI.resumeStep;
    this.setPhase('countdown');
    return true;
  }

  /** Reprise refusée : fin définitive (le résultat classé a déjà été figé à la première mort). */
  decline(): void {
    if (this.phase === 'offer') this.finish();
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

  /**
   * Résumé de la partie. En Survie, c'est celui de la PREMIÈRE VIE (figé à la première mort) : les reprises ne le modifient jamais ;
   * la survie libre qui suit est indiquée à part (`free`).
   */
  summary(): RunSummary {
    const s = this.sim;
    const f = this.config.mode === 'survival' ? s.firstLife : null;
    const used = f?.used ?? s.powers.used;
    return {
      mode: this.config.mode,
      levelId: this.config.level?.id,
      date: this.config.date,
      time: f?.time ?? s.time,
      score: f?.score ?? s.scoring.score,
      cycles: f?.cycles ?? s.scoring.cycles,
      bestMultiplier: f?.bestMultiplier ?? s.scoring.bestMultiplier,
      outcome: this.campaign ? (this.campaign.outcome === 'success' ? 'complete' : 'dead') : s.state === 'complete' ? 'complete' : 'dead',
      shards: f?.shards ?? s.shards?.income ?? 0,
      events: f?.events ?? s.director.eventCount,
      // Survie : le mode choisi au départ fait foi (sans choix explicite : déduit des pouvoirs utilisés)
      category: this.config.mode === 'survival' ? (this.config.bonus !== undefined ? (this.config.bonus ? 'bonus' : 'plain') : used.boost + used.gel + used.shield > 0 ? 'bonus' : 'plain') : undefined,
      phase: this.config.mode === 'survival' && s.director.phased ? ((f?.steps ?? s.stepIndex) >= PHASES.phase2Step ? 2 : 1) : undefined,
      free: this.config.mode === 'survival' && s.life > 1 ? { time: s.time, score: s.scoring.score, lives: s.life } : undefined,
      missionId: this.config.mission?.id,
      report: this.campaign?.report(),
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
    if (ev.length > 0) {
      for (let i = 0; i < ev.length; i++) this.hooks.onEvent?.(ev[i], this);
      ev.length = 0;
    }
    const cev = this.campaign?.campaignEvents;
    if (cev && cev.length > 0) {
      for (let i = 0; i < cev.length; i++) this.hooks.onCampaignEvent?.(cev[i], this);
      cev.length = 0;
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.hooks.onPhase?.(p, this);
  }
}
