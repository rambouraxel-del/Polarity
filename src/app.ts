import Phaser from 'phaser';
import { Sfx } from './audio/sfx';
import { ARENA, SIM, UI } from './config/balance';
import { LEVELS, levelById } from './config/levels';
import { MISSIONS, missionById, type MissionDef } from './config/campaign';
import { STORY_UI, storyAsset, storyById, type StorySequence } from './config/story';
import { activeUpgrades, applyMission, isMissionUnlocked, markSeen, type MissionResult } from './campaign/progress';
import type { CampaignEvent } from './campaign/simulation';
import { eventDef } from './config/events';
import { BALANCE_VERSION } from './config/version';
import { randomSeed } from './core/rng';
import { InputController } from './game/input';
import { GameSession } from './game/session';
import { utcDateString } from './modes/daily';
import type { RunConfig } from './modes/run';
import { applyRun, isLevelUnlocked, type RunReport, type RunSummary } from './progression/progress';
import { reconcileAchievements } from './progression/achievements';
import { creditShards, equip, isOwned, purchase } from './progression/shop';
import { resolveEquipped, skinById, type Skin } from './progression/skins';
import { CAMPAIGN_SKIN } from './config/skins';
import { DEFAULT_TRAIL_ID } from './config/trails';
import { ArenaRenderer, COLORS } from './render/ArenaRenderer';
import { BrowserStore, defaultSave, eraseAll, loadSave, writeSave, type KeyValueStore, type SaveData } from './save/save';
import { Bot } from './sim/bot';
import { FAMILY_INTRO } from './sim/patterns';
import type { SimEvent } from './sim/simulation';
import { LEADERBOARD_URL, LeaderboardClient, type PendingRun } from './net/leaderboard';
import type { BalancesResponse, LeaderboardResponse, MeResponse, Ticket } from './net/protocol';
import { escapeHtml } from './ui/format';
import { Hud } from './ui/hud';
import { bannerHelp, isTouchPrimary } from './ui/controls';
import { ShipPreview } from './ui/shipPreview';
import { SpaceBackground } from './ui/space';
import * as S from './ui/screens';
import * as C from './ui/campaignScreens';

type ScreenId = 'home' | 'campaign' | 'chapter' | 'mission' | 'journal' | 'story' | 'campaign-result' | 'levels' | 'daily' | 'cosmetics' | 'achievements' | 'leaderboard' | 'confirm-purchase' | 'options' | 'confirm-reset' | 'pause' | 'result' | null;

/** Écran parent (touche Échap) : on remonte d'un niveau plutôt que de retourner à l'accueil. */
const PARENT: Partial<Record<NonNullable<ScreenId>, NonNullable<ScreenId>>> = {
  campaign: 'home',
  chapter: 'campaign',
  mission: 'chapter',
  journal: 'campaign',
  levels: 'campaign',
};

/** Scène en cours d'affichage : réplique courante, avancement du texte progressif et suite à donner. */
interface StoryState {
  seq: StorySequence;
  index: number;
  /** Libellé de la dernière réplique (« Lancer le niveau », « Voir le bilan », « Fermer »). */
  finish: string;
  then: () => void;
  /** Caractères déjà révélés de la réplique courante (flottant : avance avec le temps réel). */
  shown: number;
  /** Réplique entièrement révélée : le prochain toucher avance. */
  full: boolean;
}

/**
 * Chef d'orchestre : écrans, partie en cours, sauvegarde, son et rendu.
 */
export class App {
  private readonly store: KeyValueStore = new BrowserStore();
  /** Classement mondial (service facultatif ; le jeu reste jouable hors ligne). */
  readonly lb = new LeaderboardClient({ baseUrl: LEADERBOARD_URL, store: this.store, balance: BALANCE_VERSION, build: __APP_VERSION__ });
  /** ?demo (joueur automatique) ou ?debug : jamais éligible au classement. */
  private readonly devMode = new URLSearchParams(location.search).has('demo') || new URLSearchParams(location.search).has('debug');
  private nextTicket: Ticket | null = null;
  private runTicket: Ticket | null = null;
  private runLb: S.RunLbStatus = { kind: 'hidden' };
  private lbBalance = BALANCE_VERSION;
  private lbLoading = false;
  private lbError: string | null = null;
  private lbTop: LeaderboardResponse | null = null;
  private lbMe: MeResponse | null = null;
  private lbBalances: BalancesResponse | null = null;
  private lbNickMessage: string | null = null;
  save: SaveData;
  private readonly sfx = new Sfx();
  private readonly hud = new Hud();
  private renderer: ArenaRenderer | null = null;
  private game: Phaser.Game | null = null;
  private session: GameSession | null = null;
  private lastConfig: RunConfig | null = null;
  private screen: ScreenId = null;
  private readonly screenEl = document.getElementById('screen')!;
  private readonly bannerEl = document.getElementById('banner')!;
  private readonly countdownEl = document.getElementById('countdown')!;
  private readonly gameEl = document.getElementById('game')!;
  private readonly arenaBox = document.getElementById('arena-box')!;
  private bannerTimer = 0;
  private bannerKind: 'event' | 'info' | null = null;
  private space: SpaceBackground | null = null;
  private reducedMotion = false;
  private cosmeticsTab: S.CosmeticsTab = 'ships';
  private cosmeticsFilter: S.CosmeticsFilter = 'all';
  private selectedItem: string | null = null;
  private pendingPurchase: string | null = null;
  private selectedMission = 1;
  private story: StoryState | null = null;
  /** Éclats déjà crédités pendant la partie en cours (chaque éclat n'est crédité qu'une fois). */
  private creditedShards = new Set<number>();
  private eventKey = '';
  private resultLock = 0;
  private clock = 0;
  private lastFrame = 0;
  private dpr = 1;
  private bestAtStart = 0;
  private tutorialActive = false;
  private lastCountdownShown = -1;
  private demoBot: Bot | null = null;

  constructor() {
    const res = loadSave(this.store);
    this.save = res.data;
    this.sfx.setVolume(this.save.options.volume);
    this.sfx.setMuted(this.save.options.muted);
    // Apparence équipée : si l'identifiant est inconnu ou verrouillé, retour au modèle classique
    this.save.skin = resolveEquipped(this.save.skin, this.save).id;
    if (!isOwned(this.save, this.save.trail)) this.save.trail = DEFAULT_TRAIL_ID;
    // Nouveaux objectifs déjà atteints grâce à la progression existante : succès débloqués et récompensés une seule fois
    if (reconcileAchievements(this.save).length > 0) this.persist();
  }

  // ————————————————————————————————————————————— démarrage

  attachGame(game: Phaser.Game): void {
    this.game = game;
  }

  onSceneReady(scene: Phaser.Scene): void {
    this.renderer = new ArenaRenderer(scene);
    this.renderer.reducedEffects = this.save.options.reducedEffects;
    this.renderer.debug = new URLSearchParams(location.search).has('debug');
    this.space = new SpaceBackground(document.getElementById('space') as HTMLCanvasElement);
    this.applyReducedEffects();
    new InputController(this.gameEl, {
      action: () => this.onAction(),
      pauseKey: () => this.onPauseKey(),
      inGame: () => this.session !== null && ['running', 'countdown', 'ending'].includes(this.session.phase),
      firstInteraction: () => this.sfx.unlock(),
    }).attach();
    // Scène illustrée : Entrée ou Espace = révéler / avancer (mêmes règles que le toucher) ; un bouton focalisé garde son propre rôle
    document.addEventListener('keydown', (e) => {
      if (this.screen !== 'story' || (e.key !== 'Enter' && e.key !== ' ')) return;
      if ((e.target as HTMLElement | null)?.closest?.('button')) return;
      e.preventDefault();
      this.advanceStory();
    });
    document.getElementById('btn-pause')!.addEventListener('click', () => this.pause());
    document.getElementById('btn-pause')!.addEventListener('pointerdown', (e) => e.preventDefault());
    this.screenEl.addEventListener('click', this.onScreenClick);
    this.screenEl.addEventListener('input', this.onScreenInput);
    this.screenEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const kind = (e.target as HTMLElement).dataset.form;
      if (kind === 'lb-register' || kind === 'lb-rename') void this.submitNickname(kind);
    });
    // Retour en ligne : envoi des résultats en attente et renouvellement des tickets
    window.addEventListener('online', () => {
      void this.lb.flush();
      void this.lb.ensureTickets();
    });
    void this.lb.flush();
    void this.lb.ensureTickets();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
        this.sfx.suspend();
      } else {
        this.sfx.resume();
      }
    });
    window.addEventListener('blur', () => this.pause());
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    this.layout();
    this.lastFrame = performance.now();
    this.showScreen('home');
  }

  /** Taille du canvas : pixels réels plafonnés (×2 max) pour préserver les performances mobiles. */
  layout(): void {
    if (!this.game || !this.renderer) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const pixels = w * h;
    const maxDpr = pixels > 1_600_000 ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const cw = Math.round(w * this.dpr);
    const ch = Math.round(h * this.dpr);
    this.game.scale.resize(cw, ch);
    this.game.scale.setZoom(1 / this.dpr);
    const box = this.arenaBox.getBoundingClientRect();
    const radiusCss = Math.max(60, Math.min(box.width, box.height) / 2);
    const cx = (box.left + box.width / 2) * this.dpr;
    const cy = (box.top + box.height / 2) * this.dpr;
    this.renderer.layout(cx, cy, radiusCss * this.dpr, cw, ch, this.dpr);
    // Le bandeau d'information se place au centre de l'orbite : il ne masque jamais l'orbite ni ses abords.
    const orbitCss = radiusCss * (ARENA.orbitRadius / ARENA.viewRadius);
    this.bannerEl.style.left = `${box.left + box.width / 2}px`;
    this.bannerEl.style.top = `${box.top + box.height / 2}px`;
    this.bannerEl.style.maxWidth = `${Math.round(orbitCss * 1.45)}px`;
    this.bannerEl.style.fontSize = orbitCss < 150 ? '13px' : '15px';
    this.space?.resize(w, h, window.devicePixelRatio || 1);
  }

  /** Effets réduits : option du joueur ou préférence du système. Coupe secousses, flash, traînées, animations et fond animé. */
  private applyReducedEffects(): void {
    const system = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const reduced = this.save.options.reducedEffects;
    if (this.renderer) this.renderer.reducedEffects = reduced;
    document.documentElement.dataset.fx = reduced ? 'reduced' : 'full';
    this.reducedMotion = reduced || system;
    this.space?.setReduced(this.reducedMotion);
  }

  // ————————————————————————————————————————————— boucle

  frame(): void {
    const now = performance.now();
    const realDt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.clock += realDt;
    const session = this.session;
    if (session) {
      session.frame(realDt);
      if (this.session === session) this.updateInGameUi(session);
    }
    // Le bandeau est un chronomètre comme les autres : la pause l'arrête
    if (this.bannerTimer > 0 && (!session || session.phase === 'running')) {
      this.bannerTimer -= realDt;
      if (this.bannerTimer <= 0.3) this.bannerEl.classList.add('fade');
      if (this.bannerTimer <= 0) this.bannerEl.classList.add('hidden');
    }
    if (this.resultLock > 0) {
      this.resultLock -= realDt;
      if (this.resultLock <= 0) {
        const btn = this.screenEl.querySelector<HTMLButtonElement>('[data-replay]');
        if (btn) {
          btn.disabled = false;
          btn.focus({ preventScroll: true });
        }
      }
    }
    // Fond spatial : menus seulement (pendant une partie, le décor reste sobre)
    this.space?.setVisible(this.session === null);
    this.space?.update(realDt);
    this.updateStoryText(realDt);
    // Campagne : le vaisseau est celui d'Élias (la Traverse) ; les cosmétiques de la Survie ne s'y appliquent pas
    if (this.renderer) this.renderer.trailId = this.isCampaignRun() ? DEFAULT_TRAIL_ID : this.save.trail;
    this.renderer?.draw(this.session, this.activeSkin(), realDt, this.clock);
  }

  private updateInGameUi(session: GameSession): void {
    const cfg = session.config;
    let label = cfg.mode === 'level' ? `Niveau ${cfg.level?.id}` : cfg.mode === 'daily' ? 'Défi' : cfg.mode === 'campaign' ? `Mission ${cfg.mission?.id}` : 'Survie';
    // Événements (Survie / défi) : annonce 2 s avant, libellé et compte à rebours pendant l'événement
    let eventActive = false;
    if (cfg.mode === 'survival' || cfg.mode === 'daily') {
      const st = session.sim.director.status(session.sim.time);
      const def = st.kind ? eventDef(st.kind) : null;
      const secs = Math.ceil(st.remaining - 1e-6);
      if (st.phase === 'event' && def) {
        label = `${def.name} · ${secs} s`;
        eventActive = true;
      }
      const key = st.phase === 'announce' || st.phase === 'event' ? `${st.phase}${st.kind}${secs}` : st.phase;
      if (key !== this.eventKey) {
        this.eventKey = key;
        if (st.phase === 'announce' && def) {
          this.banner(`<strong>${escapeHtml(def.announce)}</strong><br>dans ${Math.max(1, secs)} s`, 5);
          this.bannerKind = 'event';
        } else if (this.bannerKind === 'event') {
          this.hideBanner();
        }
      }
    }
    if (cfg.mode === 'campaign') {
      this.hud.updateCampaign(session);
    } else if (this.hud.update(session, label, cfg.mode === 'level' ? null : this.bestAtStart, !eventActive)) {
      this.sfx.play('record');
      this.renderer?.ring(COLORS.gold);
    }
    if (session.phase === 'countdown') {
      const n = Math.ceil(session.countdown / UI.resumeStep);
      if (n !== this.lastCountdownShown) {
        this.lastCountdownShown = n;
        this.countdownEl.textContent = String(Math.max(1, n));
        this.countdownEl.classList.remove('hidden');
        this.sfx.play('tick');
      }
    } else if (this.lastCountdownShown !== -1) {
      this.lastCountdownShown = -1;
      this.countdownEl.classList.add('hidden');
    }
    if (this.tutorialActive && session.sim.flips > 0 && this.bannerTimer > 1.2) this.bannerTimer = 1.2;
  }

  // ————————————————————————————————————————————— parties

  startRun(cfg: RunConfig): void {
    this.endSession();
    this.lastConfig = cfg;
    this.runTicket = cfg.mode === 'survival' ? this.nextTicket : null;
    this.nextTicket = null;
    this.runLb = { kind: 'hidden' };
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.showScreen(null);
    this.renderer?.clearEffects();
    this.hud.reset();
    this.eventKey = '';
    this.creditedShards.clear();
    this.hud.show(true);
    if (cfg.mode === 'survival') this.bestAtStart = this.save.survival.bestTime;
    else if (cfg.mode === 'daily') this.bestAtStart = this.save.daily[cfg.date ?? '']?.bestTime ?? 0;
    else this.bestAtStart = 0;

    // Mode démonstration (?demo) : le joueur automatique joue, pour inspecter les motifs.
    const demo = new URLSearchParams(location.search).has('demo');
    const session = new GameSession(cfg, {
      onBeforeStep: demo ? () => this.demoBot?.tick() : undefined,
      onEvent: (e, s) => this.onSimEvent(e, s),
      onCampaignEvent: (e, s) => this.onCampaignEvent(e, s),
      onEnd: (summary, s) => this.onRunEnd(summary, s),
    });
    this.session = session;
    this.demoBot = demo ? new Bot(session.sim) : null;

    this.tutorialActive = false;
    if (!this.save.options.tutorialSeen) {
      this.tutorialActive = true;
      this.banner(bannerHelp(isTouchPrimary()), 6);
      this.save.options.tutorialSeen = true;
      this.persist();
    } else if (cfg.mode === 'campaign' && cfg.mission) {
      this.banner(`<strong>Mission ${cfg.mission.id} — ${escapeHtml(cfg.mission.title)}</strong><br>${escapeHtml(cfg.mission.objectiveText)}`, 3.5);
    } else if (cfg.mode === 'level' && cfg.level) {
      // Niveau 1 : l'aide aux contrôles dépend de l'appareil
      const hint = cfg.level.id === 1 ? bannerHelp(isTouchPrimary()) : escapeHtml(cfg.level.hint);
      this.banner(`<strong>Niveau ${cfg.level.id} — ${escapeHtml(cfg.level.name)}</strong><br>${hint}`, 3.2);
    } else {
      this.hideBanner();
    }
  }

  /** Outil de démonstration (?demo) : avance la partie en cours avec le joueur automatique. */
  fastForward(seconds: number): void {
    const s = this.session;
    const bot = this.demoBot;
    if (!s || !bot) return;
    const n = Math.round(seconds / SIM.dt);
    for (let i = 0; i < n && s.sim.state === 'running'; i++) {
      bot.tick();
      s.sim.step();
    }
    s.sim.events.length = 0;
  }

  private endSession(): void {
    if (this.session) this.session.abort();
    this.session = null;
    this.countdownEl.classList.add('hidden');
    this.lastCountdownShown = -1;
  }

  private onAction(): void {
    if (this.session?.action()) this.sfx.play('flip');
  }

  private onPauseKey(): void {
    const s = this.session;
    if (s && s.isPausable) {
      this.pause();
      return;
    }
    if (s && s.phase === 'paused') {
      this.resume();
      return;
    }
    if (this.screen === 'confirm-purchase') {
      this.showScreen('cosmetics');
      return;
    }
    if (this.screen === 'story') {
      this.finishStory();
      return;
    }
    if (this.screen && this.screen !== 'home' && this.screen !== 'result' && this.screen !== 'campaign-result') this.showScreen(PARENT[this.screen] ?? 'home');
  }

  pause(): void {
    const s = this.session;
    if (!s || !s.isPausable) return;
    s.pause();
    this.countdownEl.classList.add('hidden');
    this.lastCountdownShown = -1;
    this.showScreen('pause');
  }

  private resume(): void {
    const s = this.session;
    if (!s || s.phase !== 'paused') return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.showScreen(null);
    s.resume();
  }

  private onSimEvent(e: SimEvent, s: GameSession): void {
    const r = this.renderer;
    switch (e.type) {
      case 'collect': {
        this.sfx.play('collect', s.sim.scoring.beacons % 6 + e.multiplier * 2);
        const a = s.sim.beacons.angles[e.index];
        const x = ARENA.orbitRadius * Math.cos(a);
        const y = ARENA.orbitRadius * Math.sin(a);
        r?.burst(x, y, this.activeSkin().colors.beacon, 8, 140, 0.45);
        r?.popup(x, y, `+${e.points}`);
        break;
      }
      case 'cycle':
        this.sfx.play('cycle');
        r?.ring(this.activeSkin().colors.orbit);
        r?.popup(0, -40 / 0.82, `Cycle +${e.points}`, '#9ff9ff');
        break;
      case 'multiplier':
        if (e.up) r?.popup(0, 40 / 0.82, `×${e.value}`, '#ffd84a');
        break;
      case 'warn':
        this.sfx.play('warn');
        // Introduction brève d'une nouvelle famille de menaces : marquée « vue » seulement quand elle a été affichée
        if (
          (s.config.mode === 'survival' || s.config.mode === 'daily') &&
          !this.save.seenIntros.includes(e.family) &&
          (!this.tutorialActive || this.bannerTimer <= 0) &&
          this.bannerKind !== 'event'
        ) {
          this.save.seenIntros.push(e.family);
          this.persist();
          this.banner(escapeHtml(FAMILY_INTRO[e.family]), 3.5);
        }
        break;
      case 'activate':
        this.sfx.play('activate');
        break;
      case 'death':
        this.sfx.play('hit');
        r?.impact(e.hitX, e.hitY, e.x, e.y, e.by);
        break;
      case 'event':
        if (e.stage === 'announce') this.sfx.play('warn');
        if (e.stage === 'start') {
          this.sfx.play('activate');
          r?.ring(0xff3df0);
        }
        break;
      case 'shard-spawn':
        this.sfx.play('shardSpawn');
        break;
      case 'shard-collect': {
        // Crédit unique (identifiant de l'éclat), sauvegardé tout de suite : les Éclats restent acquis à la mort
        if (this.creditedShards.has(e.id)) break;
        this.creditedShards.add(e.id);
        creditShards(this.save, e.amount);
        this.persist();
        this.sfx.play('shard');
        const x = ARENA.orbitRadius * Math.cos(e.angle);
        const y = ARENA.orbitRadius * Math.sin(e.angle);
        r?.burst(x, y, COLORS.shard, 12, 170, 0.5);
        r?.burst(x, y, 0xffffff, 6, 120, 0.35);
        r?.popup(x, y, `+${e.amount}`, '#c9a8ff');
        break;
      }
      case 'shard-expire':
        r?.burst(ARENA.orbitRadius * Math.cos(e.angle), ARENA.orbitRadius * Math.sin(e.angle), COLORS.shard, 6, 60, 0.4);
        break;
      case 'flip':
        // Inversion immédiate : l'ancienne traînée (désormais devant le vaisseau) disparaît
        r?.resetTrail();
        break;
      case 'complete':
        this.sfx.play('success');
        r?.ring(COLORS.gold);
        break;
      default:
        break;
    }
  }

  /** Fin de partie : résultat appliqué une seule fois (la session garantit l'unicité de l'appel). */
  private onRunEnd(summary: RunSummary, s: GameSession): void {
    if (s !== this.session) return;
    if (summary.mode === 'campaign') {
      this.onMissionEnd(summary, s);
      return;
    }
    const report = applyRun(this.save, summary);
    this.persist();
    if (summary.mode === 'survival') this.afterSurvivalRun(summary, s);
    this.hud.show(false);
    this.hideBanner();
    this.showResult(report);
  }

  private showResult(report: RunReport): void {
    const lvl = report.run.levelId;
    const hasNext = report.run.mode === 'level' && lvl !== undefined && LEVELS.some((l) => l.id === lvl + 1);
    this.screen = 'result';
    this.screenEl.innerHTML = S.resultScreen(report, hasNext && isLevelUnlocked(this.save, (lvl ?? 0) + 1), this.runLb);
    this.screenEl.classList.remove('hidden');
    this.screenEl.classList.add('dim');
    this.screenEl.scrollTop = 0;
    this.resultLock = UI.resultInputLock;
  }

  // ————————————————————————————————————————————— campagne

  /** Lance une mission déverrouillée ; sa séquence d'introduction ne s'affiche qu'à la première fois (passable, relisible au journal). */
  private launchMission(id: number): void {
    const m = missionById(id);
    if (!m || !isMissionUnlocked(this.save, id)) return;
    if (m.before && markSeen(this.save, m.before)) {
      this.persist();
      this.openStory(m.before, () => this.startMission(m), 'Lancer le niveau');
    } else {
      this.startMission(m);
    }
  }

  private startMission(m: MissionDef): void {
    this.selectedMission = m.id;
    this.startRun({ mode: 'campaign', seed: randomSeed(), mission: m, upgrades: activeUpgrades(this.save) });
  }

  private isCampaignRun(): boolean {
    return this.session?.config.mode === 'campaign';
  }

  /** Apparence affichée : la Traverse en campagne, sinon l'apparence équipée. */
  private activeSkin(): Skin {
    return this.isCampaignRun() ? CAMPAIGN_SKIN : skinById(this.save.skin);
  }

  // ————————————————————————————————————————————— scènes illustrées (récit)

  /**
   * Affiche une scène (illustration au-dessus, dialogue au-dessous, une réplique à la fois). `then` est appelé à la fin ou si le joueur
   * passe. Aucune partie n'est en cours pendant une scène : le jeu, le chrono et les commandes de jeu sont à l'arrêt.
   */
  private openStory(id: string, then: () => void, finish: string): void {
    const seq = storyById(id);
    if (!seq || seq.lines.length === 0) {
      then();
      return;
    }
    this.story = { seq, index: 0, finish, then, shown: 0, full: false };
    this.renderStory(true);
  }

  private renderStory(fresh: boolean): void {
    const d = this.story;
    if (!d) return;
    this.screen = 'story';
    this.screenEl.classList.remove('hidden');
    this.screenEl.classList.remove('dim');
    this.screenEl.classList.add('no-anim');
    this.screenEl.classList.add('screen--story');
    this.screenEl.innerHTML = C.storyScreen(d.seq, d.index, d.finish);
    this.screenEl.scrollTop = 0;
    d.shown = 0;
    d.full = false;
    // Précharge l'illustration de la scène suivante du même niveau
    if (fresh) this.preloadStory(d.seq);
    if (this.reducedMotion) this.revealStoryLine();
  }

  private preloadStory(seq: StorySequence): void {
    const nextSeq = storyById(seq.phase === 'before' ? `n${seq.level}-after` : `n${seq.level + 1}-before`);
    if (!nextSeq) return;
    const url = storyAsset(nextSeq.illustration);
    if (url) new Image().src = url;
  }

  /** Texte progressif : avance avec le temps réel (la scène n'est pas une partie ; rien ne dépend de la pause). */
  private updateStoryText(realDt: number): void {
    const d = this.story;
    if (!d || d.full) return;
    const text = d.seq.lines[d.index].text;
    d.shown += realDt * STORY_UI.charsPerSecond;
    if (d.shown >= text.length) {
      this.revealStoryLine();
      return;
    }
    const live = document.getElementById('story-live');
    if (live) live.textContent = text.slice(0, Math.floor(d.shown));
  }

  private revealStoryLine(): void {
    const d = this.story;
    if (!d) return;
    d.full = true;
    d.shown = d.seq.lines[d.index].text.length;
    const live = document.getElementById('story-live');
    if (live) live.textContent = d.seq.lines[d.index].text;
    this.screenEl.querySelector('.story__box')?.classList.add('story__box--done');
  }

  /** Premier toucher : révèle toute la réplique ; toucher suivant : réplique suivante (ou fin de la scène). */
  private advanceStory(): void {
    const d = this.story;
    if (!d) return;
    if (!d.full) {
      this.revealStoryLine();
      return;
    }
    if (d.index >= d.seq.lines.length - 1) {
      this.finishStory();
      return;
    }
    d.index++;
    this.renderStory(false);
  }

  /** Ferme la scène (fin ou « Passer ») : ne donne jamais ni victoire ni récompense. */
  private finishStory(): void {
    const d = this.story;
    if (!d) return;
    this.story = null;
    this.screenEl.classList.remove('screen--story');
    d.then();
  }

  /** Fin d'une mission : résultat appliqué une seule fois (étoiles, récompenses, déblocages), puis transmission de fin (1re fois). */
  private onMissionEnd(summary: RunSummary, s: GameSession): void {
    const rep = summary.report;
    if (!rep) return;
    const res = applyMission(this.save, rep);
    this.persist();
    this.hud.show(false);
    this.hideBanner();
    const after = rep.outcome === 'success' ? s.config.mission?.after : undefined;
    if (after && markSeen(this.save, after)) {
      this.persist();
      this.openStory(after, () => this.showMissionResult(res), 'Voir le bilan');
    } else {
      this.showMissionResult(res);
    }
  }

  private showMissionResult(res: MissionResult): void {
    const id = res.report.missionId;
    const nextId = MISSIONS.find((m) => m.id === id + 1)?.id;
    const canNext = res.report.outcome === 'success' && nextId !== undefined && isMissionUnlocked(this.save, nextId);
    this.screen = 'campaign-result';
    this.screenEl.innerHTML = C.campaignResultScreen(this.save, res, canNext);
    this.screenEl.classList.remove('hidden', 'no-anim');
    this.screenEl.classList.add('dim');
    this.screenEl.scrollTop = 0;
    this.resultLock = UI.resultInputLock;
  }

  /** Événements propres à la campagne : objets de mission, bouclier, verrous, transmissions en partie. */
  private onCampaignEvent(e: CampaignEvent, s: GameSession): void {
    const r = this.renderer;
    const at = (angle: number): [number, number] => [ARENA.orbitRadius * Math.cos(angle), ARENA.orbitRadius * Math.sin(angle)];
    switch (e.type) {
      case 'object-spawn': {
        this.sfx.play('objectSpawn');
        const [x, y] = at(e.angle);
        r?.burst(x, y, COLORS.signal, 6, 70, 0.4);
        break;
      }
      case 'object-collect': {
        this.sfx.play('shard');
        const [x, y] = at(e.angle);
        r?.burst(x, y, COLORS.signal, 12, 170, 0.5);
        r?.burst(x, y, 0xffffff, 6, 120, 0.35);
        const o = s.config.mission?.objective;
        r?.popup(x, y, e.kind === 'blackbox' ? 'Boîte noire !' : o && o.type === 'objects' ? `${e.count}/${o.count}` : '+1', '#7dffc4');
        break;
      }
      case 'object-miss': {
        const [x, y] = at(e.angle);
        r?.burst(x, y, COLORS.signal, 5, 50, 0.4);
        r?.popup(x, y, 'Perdu… il revient', '#9db1d6');
        break;
      }
      case 'shield':
        this.sfx.play('shield');
        r?.shieldBurst(e.x, e.y);
        r?.popup(e.x, e.y, 'Bouclier !', '#9cd0ff');
        break;
      case 'lock':
        r?.ring(COLORS.signal);
        r?.popup(0, 80 / 0.82, `Verrou ${e.done}/${e.total}`, '#7dffc4');
        break;
      case 'sequence':
        r?.ring(COLORS.signal);
        break;
      case 'line': {
        // Transmission en partie : uniquement aux moments sûrs prévus par le scénario (respirations)
        const m = /^([A-ZÉ]+) : (.*)$/.exec(e.text);
        this.banner(m ? `<strong>${escapeHtml(m[1])}</strong><br>${escapeHtml(m[2])}` : escapeHtml(e.text), 4);
        break;
      }
      case 'announce':
        this.sfx.play('warn');
        this.banner(`<strong>${escapeHtml(e.text)}</strong>`, 2.6);
        break;
      default:
        break;
    }
  }


  // ————————————————————————————————————————————— écrans

  showScreen(id: ScreenId, animate = true): void {
    this.screen = id;
    this.story = null;
    this.screenEl.classList.remove('screen--story');
    if (id === null) {
      this.screenEl.classList.add('hidden');
      this.screenEl.innerHTML = '';
      return;
    }
    if (id !== 'pause') {
      this.endSession();
      this.hud.show(false);
      this.hideBanner();
    }
    const today = utcDateString();
    let html = '';
    switch (id) {
      case 'home': html = S.homeScreen(this.save, today, isTouchPrimary()); break;
      case 'campaign': html = C.campaignScreen(this.save); break;
      case 'chapter': html = C.chapterScreen(this.save); break;
      case 'mission': html = C.missionScreen(this.save, this.selectedMission); break;
      case 'journal': html = C.journalScreen(this.save); break;
      case 'levels': html = S.levelsScreen(this.save); break;
      case 'daily': html = S.dailyScreen(this.save, today); break;
      case 'cosmetics': html = S.cosmeticsScreen(this.save, this.cosmeticsTab, this.cosmeticsFilter, this.selectedItem ?? undefined); break;
      case 'achievements': html = S.achievementsScreen(this.save); break;
      case 'leaderboard': html = S.leaderboardScreen(this.leaderboardView()); break;
      case 'confirm-purchase': html = S.confirmPurchaseScreen(this.save, this.pendingPurchase ?? ''); break;
      case 'options': html = S.optionsScreen(this.save); break;
      case 'confirm-reset': html = S.confirmResetScreen(); break;
      case 'pause': html = S.pauseScreen(this.modeLabel(), this.session?.config.mode === 'campaign'); break;
      default: break;
    }
    // Transition d'entrée (fondu + glissement) ; pas rejouée quand seul un réglage ou un onglet change
    this.screenEl.classList.toggle('no-anim', !animate);
    this.screenEl.innerHTML = html;
    this.screenEl.classList.remove('hidden');
    this.screenEl.classList.toggle('dim', id === 'pause');
    if (animate) this.screenEl.scrollTop = 0;
    const focus = this.screenEl.querySelector<HTMLElement>('[data-autofocus]');
    focus?.focus({ preventScroll: true });
    this.attachSkinPreview();
  }

  /** Grand aperçu du menu Apparences : rotation lente et réacteur animé (figé en effets réduits). */
  private attachSkinPreview(): void {
    const cv = this.screenEl.querySelector<HTMLCanvasElement>('canvas[data-skin-preview]');
    if (!cv) return;
    const trail = cv.dataset.trailColor;
    new ShipPreview(cv, skinById(cv.dataset.skinPreview ?? ''), this.reducedMotion, trail === undefined ? null : Number(trail)).start();
  }

  private modeLabel(): string {
    const c = this.session?.config;
    if (!c) return '';
    if (c.mode === 'level') return `Niveau ${c.level?.id} — ${c.level?.name}`;
    if (c.mode === 'campaign') return `Mission ${c.mission?.id} — ${c.mission?.title}`;
    return c.mode === 'daily' ? 'Défi quotidien' : 'Survie';
  }

  private readonly onScreenClick = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || (target as HTMLButtonElement).disabled) return;
    this.sfx.unlock();
    const action = target.dataset.action!;
    if (action !== 'replay' && action !== 'resume') this.sfx.play('ui');
    switch (action) {
      case 'home': this.showScreen('home'); break;
      case 'campaign': this.showScreen('campaign'); break;
      case 'chapter': this.showScreen('chapter'); break;
      case 'journal': this.showScreen('journal'); break;
      case 'open-mission': {
        const id = Number(target.dataset.mission);
        if (isMissionUnlocked(this.save, id)) {
          this.selectedMission = id;
          this.showScreen('mission');
        }
        break;
      }
      case 'play-mission': this.launchMission(Number(target.dataset.mission)); break;
      case 'next-mission': this.launchMission((this.lastConfig?.mission?.id ?? 0) + 1); break;
      case 'read-seq': {
        // Relecture : depuis la fiche de niveau ou le journal ; on y revient à la fin (ou en passant)
        const seq = storyById(target.dataset.seq ?? '');
        const back = target.dataset.from === 'mission' ? 'mission' : 'journal';
        if (seq && this.save.campaign.seen.includes(seq.id)) this.openStory(seq.id, () => this.showScreen(back), 'Fermer');
        break;
      }
      case 'story-advance': this.advanceStory(); break;
      case 'story-skip': this.finishStory(); break;
      case 'levels': this.showScreen('levels'); break;
      case 'daily': this.showScreen('daily'); break;
      case 'cosmetics': this.selectedItem = null; this.pendingPurchase = null; this.showScreen('cosmetics'); break;
      case 'back-cosmetics': this.pendingPurchase = null; this.showScreen('cosmetics'); break;
      case 'achievements': this.showScreen('achievements'); break;
      case 'leaderboard': this.openLeaderboard(); break;
      case 'lb-refresh': void this.refreshLeaderboard(); break;
      case 'lb-flush': void this.refreshLeaderboard(); break;
      case 'lb-clear': this.lb.clearDone(); this.rerenderLeaderboard(); break;
      case 'lb-balance':
        this.lbBalance = Number(target.dataset.balance) || BALANCE_VERSION;
        void this.refreshLeaderboard();
        break;
      // Les formulaires de pseudo sont traités à l'envoi (touche Entrée comprise), pas au clic
      case 'lb-register':
      case 'lb-rename':
        break;
      case 'options': this.showScreen('options'); break;
      case 'survival': this.startRun({ mode: 'survival', seed: this.survivalSeed() }); break;
      case 'play-daily': {
        const date = utcDateString();
        this.startRun({ mode: 'daily', seed: 0, date });
        break;
      }
      case 'play-level': {
        const level = levelById(Number(target.dataset.level));
        if (level && isLevelUnlocked(this.save, level.id)) this.startRun({ mode: 'level', seed: randomSeed(), level });
        break;
      }
      case 'next-level': {
        const cur = this.lastConfig?.level?.id ?? 0;
        const level = levelById(cur + 1);
        if (level && isLevelUnlocked(this.save, level.id)) this.startRun({ mode: 'level', seed: randomSeed(), level });
        break;
      }
      case 'replay':
      case 'restart':
        if (this.lastConfig) this.startRun(this.freshConfig(this.lastConfig));
        break;
      case 'resume': this.resume(); break;
      case 'quit': this.showScreen(this.lastConfig?.mode === 'campaign' && this.session ? 'chapter' : 'home'); break;
      case 'cat-ships':
      case 'cat-trails':
      case 'cat-packs':
        this.cosmeticsTab = action.slice('cat-'.length) as S.CosmeticsTab;
        this.selectedItem = null;
        this.showScreen('cosmetics', false);
        break;
      case 'filter-all':
      case 'filter-owned':
      case 'filter-locked':
        this.cosmeticsFilter = action.slice('filter-'.length) as S.CosmeticsFilter;
        this.selectedItem = null;
        this.showScreen('cosmetics', false);
        break;
      case 'select-item':
        // Affiche l'aperçu de la carte choisie (sans l'équiper) et le ramène à l'écran s'il est hors de vue
        this.selectedItem = target.dataset.item ?? null;
        this.showScreen('cosmetics', false);
        this.screenEl.querySelector('.skin-stage')?.scrollIntoView({ block: 'nearest', behavior: this.reducedMotion ? 'auto' : 'smooth' });
        break;
      case 'equip-item': {
        const id = target.dataset.item ?? '';
        if (equip(this.save, id)) {
          this.selectedItem = id;
          this.persist();
          this.showScreen('cosmetics', false);
        }
        break;
      }
      case 'buy':
        // Étape de confirmation : rien n'est débité ici
        this.pendingPurchase = target.dataset.item ?? null;
        this.showScreen('confirm-purchase');
        break;
      case 'confirm-buy': {
        // Vérification du solde, débit et déblocage dans la même modification, puis une seule écriture. Un article déjà possédé n'est jamais débité.
        const res = purchase(this.save, target.dataset.item ?? '');
        if (res.ok) {
          this.persist();
          this.sfx.play('success');
          this.selectedItem = res.item.id;
        }
        this.pendingPurchase = null;
        this.showScreen('cosmetics');
        break;
      }
      case 'toggle-sound':
        this.save.options.muted = !this.save.options.muted;
        this.sfx.setMuted(this.save.options.muted);
        this.persist();
        this.refreshOptions();
        break;
      case 'toggle-fx':
        this.save.options.reducedEffects = !this.save.options.reducedEffects;
        this.applyReducedEffects();
        this.persist();
        this.refreshOptions();
        break;
      case 'reset-tutorial':
        this.save.options.tutorialSeen = false;
        this.save.seenIntros = [];
        this.persist();
        (target.querySelector('.btn__label') ?? target).textContent = 'Fait ✓';
        break;
      case 'dismiss-notice':
        this.save.balanceNoticeSeen = BALANCE_VERSION;
        this.persist();
        this.showScreen('home', false);
        break;
      case 'dismiss-reward-notice':
        this.save.rewardNotice = null;
        this.persist();
        this.showScreen('home', false);
        break;
      case 'ask-reset': this.showScreen('confirm-reset'); break;
      case 'confirm-reset': {
        const options = this.save.options;
        eraseAll(this.store);
        this.save = defaultSave();
        this.save.options = options;
        this.persist();
        this.showScreen('home');
        break;
      }
      default: break;
    }
  };

  private refreshOptions(): void {
    const scroll = this.screenEl.scrollTop;
    this.screenEl.classList.add('no-anim');
    this.screenEl.innerHTML = S.optionsScreen(this.save);
    this.screenEl.scrollTop = scroll;
  }

  private readonly onScreenInput = (e: Event): void => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.input === 'volume') {
      const v = Number(el.value) / 100;
      this.save.options.volume = v;
      this.sfx.setVolume(v);
      const label = document.getElementById('opt-volume-val');
      if (label) label.textContent = `${Math.round(v * 100)} %`;
      el.style.setProperty('--fill', `${Math.round(v * 100)}%`);
      this.persist();
      this.sfx.play('collect', 0);
    }
  };

  /** Nouvelle tentative : nouvelle graine (sauf défi, dont la graine est celle du jour). */
  // ————————————————————————————————————————————— classement mondial

  /**
   * Fin d'une partie de Survie : si elle est éligible (graine d'un ticket, aucune aide de test), son journal d'entrées est
   * conservé « en attente » puis envoyé ; le serveur la rejoue et décide. Rien n'est classé tant que le serveur n'a pas validé.
   */
  private afterSurvivalRun(summary: RunSummary, s: GameSession): void {
    this.runLb = { kind: 'hidden' };
    if (!this.lb.configured) return;
    if (this.devMode || s.sim.assisted) this.runLb = { kind: 'assisted' };
    else if (!this.lb.identity()) this.runLb = { kind: 'no-identity' };
    else if (!this.runTicket) this.runLb = { kind: 'no-ticket' };
    else {
      const ticket = this.runTicket;
      this.lb.recordRun(ticket, s.sim.flipLog, { time: summary.time, score: summary.score });
      this.runLb = { kind: 'sending' };
      void this.lb.flush().then((list) => {
        const p = list.find((x) => x.id === ticket.id);
        this.runLb = this.statusOf(p);
        this.refreshRunLbStatus();
        if (this.screen === 'leaderboard') void this.refreshLeaderboard();
      });
    }
    this.runTicket = null;
  }

  private statusOf(p: PendingRun | undefined): S.RunLbStatus {
    if (!p) return { kind: 'hidden' };
    if (p.status === 'accepted' && p.result) return { kind: 'accepted', rank: p.result.rank, best: p.result.personalBest };
    if (p.status === 'rejected') return { kind: 'rejected', message: p.message ?? 'refusé par le serveur' };
    return { kind: 'pending', offline: !!p.lastError };
  }

  /** Met à jour la ligne de statut du résultat sans recréer l'écran (aucun crédit, aucune animation rejouée). */
  private refreshRunLbStatus(): void {
    if (this.screen !== 'result') return;
    const el = this.screenEl.querySelector('#lb-status');
    if (el) el.innerHTML = S.runLbStatusHtml(this.runLb);
  }

  private leaderboardView(): S.LeaderboardView {
    const id = this.lb.identity();
    return {
      configured: this.lb.configured,
      identity: id ? { nickname: id.nickname } : null,
      loading: this.lbLoading,
      error: this.lbError,
      top: this.lbTop,
      me: this.lbMe,
      balances: this.lbBalances,
      balance: this.lbBalance,
      pending: this.lb.pending(),
      nickMessage: this.lbNickMessage,
      localBest: this.save.survival.bestTime > 0 ? { time: this.save.survival.bestTime, score: this.save.survival.bestScore } : null,
    };
  }

  private rerenderLeaderboard(): void {
    if (this.screen !== 'leaderboard') return;
    const keep = (this.screenEl.querySelector('#nick-input') as HTMLInputElement | null)?.value;
    this.showScreen('leaderboard', false);
    const input = this.screenEl.querySelector('#nick-input') as HTMLInputElement | null;
    if (input && keep) input.value = keep;
  }

  /** Ouvre le menu puis charge le classement (envoie d'abord les résultats en attente). */
  private openLeaderboard(): void {
    this.lbNickMessage = null;
    this.showScreen('leaderboard');
    void this.refreshLeaderboard();
  }

  private async refreshLeaderboard(): Promise<void> {
    if (!this.lb.configured) return;
    this.lbLoading = true;
    this.lbError = null;
    this.rerenderLeaderboard();
    await this.lb.flush();
    void this.lb.ensureTickets();
    const [top, me, balances] = await Promise.all([this.lb.top(this.lbBalance), this.lb.identity() ? this.lb.me(this.lbBalance) : Promise.resolve(null), this.lb.balances()]);
    this.lbLoading = false;
    if (top.ok) {
      this.lbTop = top.data;
      this.lbError = null;
    } else {
      this.lbTop = null;
      this.lbError = top.message;
    }
    this.lbMe = me && me.ok ? me.data : null;
    this.lbBalances = balances.ok ? balances.data : this.lbBalances;
    this.rerenderLeaderboard();
  }

  private async submitNickname(kind: 'lb-register' | 'lb-rename'): Promise<void> {
    const input = this.screenEl.querySelector('#nick-input') as HTMLInputElement | null;
    const res = kind === 'lb-register' ? await this.lb.register(input?.value ?? '') : await this.lb.rename(input?.value ?? '');
    this.lbNickMessage = res.ok ? `Pseudo enregistré : ${res.data.nickname}` : res.message;
    if (res.ok) void this.lb.ensureTickets();
    this.rerenderLeaderboard();
    if (res.ok) void this.refreshLeaderboard();
  }

  private freshConfig(cfg: RunConfig): RunConfig {
    if (cfg.mode === 'daily') return { ...cfg, date: utcDateString() };
    // Campagne : nouvelle graine (trajectoires variées) et améliorations relues (activées entre deux tentatives)
    if (cfg.mode === 'campaign') return { ...cfg, seed: randomSeed(), upgrades: activeUpgrades(this.save) };
    return { ...cfg, seed: cfg.mode === 'survival' ? this.survivalSeed() : randomSeed() };
  }

  /**
   * Graine d'une partie de Survie : celle d'un ticket du classement si disponible (graine attribuée par le serveur, ce qui rend
   * la partie éligible au classement mondial), sinon une graine locale (résultat conservé sur l'appareil).
   */
  private survivalSeed(): number {
    this.nextTicket = this.devMode ? null : this.lb.takeTicket();
    if (this.nextTicket) void this.lb.ensureTickets();
    return this.nextTicket?.seed ?? randomSeed();
  }

  private banner(html: string, seconds: number): void {
    this.bannerKind = 'info';
    this.bannerEl.innerHTML = html;
    this.bannerEl.classList.remove('hidden', 'fade');
    this.bannerTimer = seconds;
  }

  private hideBanner(): void {
    this.bannerTimer = 0;
    this.bannerKind = null;
    this.bannerEl.classList.add('hidden');
  }

  private persist(): void {
    writeSave(this.store, this.save);
  }
}
