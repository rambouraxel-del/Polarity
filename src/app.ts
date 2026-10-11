import Phaser from 'phaser';
import { Sfx } from './audio/sfx';
import { ARENA, UI } from './config/balance';
import { LEVELS, levelById } from './config/levels';
import { randomSeed } from './core/rng';
import { InputController } from './game/input';
import { GameSession } from './game/session';
import { utcDateString } from './modes/daily';
import type { RunConfig } from './modes/run';
import { applyRun, isLevelUnlocked, type RunReport, type RunSummary } from './progression/progress';
import { isSkinUnlocked, skinById, SKINS } from './progression/skins';
import { ArenaRenderer, COLORS } from './render/ArenaRenderer';
import { BrowserStore, defaultSave, loadSave, writeSave, type KeyValueStore, type SaveData } from './save/save';
import { FAMILY_INTRO } from './sim/patterns';
import type { SimEvent } from './sim/simulation';
import { escapeHtml } from './ui/format';
import { Hud } from './ui/hud';
import * as S from './ui/screens';

type ScreenId = 'home' | 'levels' | 'daily' | 'skins' | 'options' | 'confirm-reset' | 'pause' | 'result' | null;

/**
 * Chef d'orchestre : écrans, partie en cours, sauvegarde, son et rendu.
 */
export class App {
  private readonly store: KeyValueStore = new BrowserStore();
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
  private resultLock = 0;
  private clock = 0;
  private lastFrame = 0;
  private dpr = 1;
  private bestAtStart = 0;
  private tutorialActive = false;
  private lastCountdownShown = -1;

  constructor() {
    const res = loadSave(this.store);
    this.save = res.data;
    this.sfx.setVolume(this.save.options.volume);
    this.sfx.setMuted(this.save.options.muted);
    if (!isSkinUnlocked(skinById(this.save.skin), this.save.achievements)) this.save.skin = SKINS[0].id;
  }

  // ————————————————————————————————————————————— démarrage

  attachGame(game: Phaser.Game): void {
    this.game = game;
  }

  onSceneReady(scene: Phaser.Scene): void {
    this.renderer = new ArenaRenderer(scene);
    this.renderer.reducedEffects = this.save.options.reducedEffects;
    new InputController(this.gameEl, {
      action: () => this.onAction(),
      pauseKey: () => this.onPauseKey(),
      inGame: () => this.session !== null && ['running', 'countdown', 'ending'].includes(this.session.phase),
      firstInteraction: () => this.sfx.unlock(),
    }).attach();
    document.getElementById('btn-pause')!.addEventListener('click', () => this.pause());
    document.getElementById('btn-pause')!.addEventListener('pointerdown', (e) => e.preventDefault());
    this.screenEl.addEventListener('click', this.onScreenClick);
    this.screenEl.addEventListener('input', this.onScreenInput);
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
    if (this.bannerTimer > 0) {
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
    this.renderer?.draw(this.session, skinById(this.save.skin), realDt, this.clock);
  }

  private updateInGameUi(session: GameSession): void {
    const cfg = session.config;
    const label = cfg.mode === 'level' ? `Niveau ${cfg.level?.id}` : cfg.mode === 'daily' ? 'Défi' : 'Survie';
    if (this.hud.update(session, label, cfg.mode === 'level' ? null : this.bestAtStart)) {
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
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.showScreen(null);
    this.renderer?.clearEffects();
    this.hud.reset();
    this.hud.show(true);
    if (cfg.mode === 'survival') this.bestAtStart = this.save.survival.bestTime;
    else if (cfg.mode === 'daily') this.bestAtStart = this.save.daily[cfg.date ?? '']?.bestTime ?? 0;
    else this.bestAtStart = 0;

    this.session = new GameSession(cfg, {
      onEvent: (e, s) => this.onSimEvent(e, s),
      onEnd: (summary, s) => this.onRunEnd(summary, s),
    });

    this.tutorialActive = false;
    if (!this.save.options.tutorialSeen) {
      this.tutorialActive = true;
      this.banner('Touchez ou appuyez sur <strong>Espace</strong> pour inverser la direction.', 6);
      this.save.options.tutorialSeen = true;
      this.persist();
    } else if (cfg.mode === 'level' && cfg.level) {
      this.banner(`<strong>Niveau ${cfg.level.id} — ${escapeHtml(cfg.level.name)}</strong><br>${escapeHtml(cfg.level.hint)}`, 3.2);
    } else {
      this.hideBanner();
    }
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
    if (this.screen && this.screen !== 'home' && this.screen !== 'result') this.showScreen('home');
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
        r?.burst(x, y, skinById(this.save.skin).beacon, 8, 140, 0.45);
        r?.popup(x, y, `+${e.points}`);
        break;
      }
      case 'cycle':
        this.sfx.play('cycle');
        r?.ring(skinById(this.save.skin).orbit);
        r?.popup(0, -40 / 0.82, `Cycle +${e.points}`, '#9ff9ff');
        break;
      case 'multiplier':
        if (e.up) r?.popup(0, 40 / 0.82, `×${e.value}`, '#ffd84a');
        break;
      case 'warn':
        this.sfx.play('warn');
        if (s.config.mode !== 'level' && !this.save.seenIntros.includes(e.family)) {
          this.save.seenIntros.push(e.family);
          this.persist();
          if (!this.tutorialActive || this.bannerTimer <= 0) this.banner(escapeHtml(FAMILY_INTRO[e.family]), 3.5);
        }
        break;
      case 'activate':
        this.sfx.play('activate');
        break;
      case 'death':
        this.sfx.play('hit');
        r?.hit(e.x, e.y);
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
    const report = applyRun(this.save, summary);
    this.persist();
    this.hud.show(false);
    this.hideBanner();
    this.showResult(report);
  }

  private showResult(report: RunReport): void {
    const lvl = report.run.levelId;
    const hasNext = report.run.mode === 'level' && lvl !== undefined && LEVELS.some((l) => l.id === lvl + 1);
    this.screen = 'result';
    this.screenEl.innerHTML = S.resultScreen(report, hasNext && isLevelUnlocked(this.save, (lvl ?? 0) + 1));
    this.screenEl.classList.remove('hidden');
    this.screenEl.classList.add('dim');
    this.screenEl.scrollTop = 0;
    this.resultLock = UI.resultInputLock;
  }

  // ————————————————————————————————————————————— écrans

  showScreen(id: ScreenId): void {
    this.screen = id;
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
      case 'home': html = S.homeScreen(this.save, today); break;
      case 'levels': html = S.levelsScreen(this.save); break;
      case 'daily': html = S.dailyScreen(this.save, today); break;
      case 'skins': html = S.skinsScreen(this.save); break;
      case 'options': html = S.optionsScreen(this.save); break;
      case 'confirm-reset': html = S.confirmResetScreen(); break;
      case 'pause': html = S.pauseScreen(this.modeLabel()); break;
      default: break;
    }
    this.screenEl.innerHTML = html;
    this.screenEl.classList.remove('hidden');
    this.screenEl.classList.toggle('dim', id === 'pause');
    this.screenEl.scrollTop = 0;
    const focus = this.screenEl.querySelector<HTMLElement>('[data-autofocus]');
    focus?.focus({ preventScroll: true });
  }

  private modeLabel(): string {
    const c = this.session?.config;
    if (!c) return '';
    if (c.mode === 'level') return `Niveau ${c.level?.id} — ${c.level?.name}`;
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
      case 'levels': this.showScreen('levels'); break;
      case 'daily': this.showScreen('daily'); break;
      case 'skins': this.showScreen('skins'); break;
      case 'options': this.showScreen('options'); break;
      case 'survival': this.startRun({ mode: 'survival', seed: randomSeed() }); break;
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
      case 'quit': this.showScreen('home'); break;
      case 'skin': {
        const skin = skinById(target.dataset.skin ?? '');
        if (isSkinUnlocked(skin, this.save.achievements)) {
          this.save.skin = skin.id;
          this.persist();
          this.showScreen('skins');
        }
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
        if (this.renderer) this.renderer.reducedEffects = this.save.options.reducedEffects;
        this.persist();
        this.refreshOptions();
        break;
      case 'reset-tutorial':
        this.save.options.tutorialSeen = false;
        this.save.seenIntros = [];
        this.persist();
        target.textContent = 'Fait ✓';
        break;
      case 'ask-reset': this.showScreen('confirm-reset'); break;
      case 'confirm-reset': {
        const options = this.save.options;
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
      this.persist();
      this.sfx.play('collect', 0);
    }
  };

  /** Nouvelle tentative : nouvelle graine (sauf défi, dont la graine est celle du jour). */
  private freshConfig(cfg: RunConfig): RunConfig {
    if (cfg.mode === 'daily') return { ...cfg, date: utcDateString() };
    return { ...cfg, seed: randomSeed() };
  }

  private banner(html: string, seconds: number): void {
    this.bannerEl.innerHTML = html;
    this.bannerEl.classList.remove('hidden', 'fade');
    this.bannerTimer = seconds;
  }

  private hideBanner(): void {
    this.bannerTimer = 0;
    this.bannerEl.classList.add('hidden');
  }

  private persist(): void {
    writeSave(this.store, this.save);
  }
}
