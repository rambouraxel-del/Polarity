import Phaser from 'phaser';
import { Music, type MusicPosition } from './audio/music';
import { AmbienceDirector, QualityGovernor } from './ambience/director';
import { MusicSync } from './ambience/musicSync';
import { ambienceApplies, STAGES } from './config/ambience';
import { Sfx } from './audio/sfx';
import { ARENA, SIM, UI } from './config/balance';
import { LEVELS, levelById } from './config/levels';
import { MISSIONS, missionById, type MissionDef } from './config/campaign';
import { SPEAKERS, STORY_UI, storyAsset, storyById, type StorySequence } from './config/story';
import { activeUpgrades, applyMission, isMissionUnlocked, takeIntroScene, takeOutroScene, type MissionResult } from './campaign/progress';
import type { CampaignEvent } from './campaign/simulation';
import { eventDef } from './config/events';
import { BALANCE_VERSION } from './config/version';
import { randomSeed } from './core/rng';
import { InputController } from './game/input';
import { POWER_CODES, REVIVE, type PowerKind } from './config/powers';
import { getAdProvider, initNativeAds } from './monetization/ads';
import { getPaymentProvider, initNativePayments } from './monetization/payments';
import { StoreService } from './monetization/store';
import { reviveWithAd as adRevive } from './monetization/adReward';
import * as ST from './ui/storeScreens';
import { PowersBar, POWER_KEYS } from './ui/powers';
import { GameSession, type Phase } from './game/session';
import { utcDateString } from './modes/daily';
import type { RunConfig } from './modes/run';
import { applyRun, isLevelUnlocked, type RunReport, type RunSummary } from './progression/progress';
import { reconcileAchievements } from './progression/achievements';
import { catalogItem, type CatalogItem } from './config/catalog';
import { creditShards, equip, isOwned, itemState, purchase } from './progression/shop';
import { buyBonus } from './economy/bonus';
import { bonusDef } from './config/economy';
import { claimAllMedals, claimMedals } from './progression/achievements';
import { isPremium } from './config/catalog';
import { resolveEquipped, skinById, type Skin } from './progression/skins';
import { CAMPAIGN_SKIN } from './config/skins';
import { DEFAULT_TRAIL_ID } from './config/trails';
import { ArenaRenderer, COLORS } from './render/ArenaRenderer';
import { BrowserStore, SAVE_KEY, loadSave, parseSave, resetProgress, writeSave, type KeyValueStore, type LoadResult, type SaveData } from './save/save';
import { Bot } from './sim/bot';
import { FAMILY_INTRO } from './sim/patterns';
import type { SimEvent } from './sim/simulation';
import { AccountService } from './account/AccountService';
import { mountGoogleButton, signInNative, signInWithAppleWeb } from './account/providers';
import { INSTALL_KEY, ensureInstallId, useInstallStore } from './economy/ids';
import { accountScreen } from './ui/accountScreens';
import { LEADERBOARD_URL, LeaderboardClient, type PendingRun } from './net/leaderboard';
import { backAction, hideNativeSplash, initNative, nativePlatform } from './platform/native';
import type { BalancesResponse, Category, LeaderboardResponse, MeResponse, Ticket } from './net/protocol';
import { CURRENCY_NAME } from './ui/components';
import { escapeHtml, formatScore } from './ui/format';
import { Hud } from './ui/hud';
import { bannerHelp, isTouchPrimary } from './ui/controls';
import { ShipPreview } from './ui/shipPreview';
import { SpaceBackground } from './ui/space';
import * as S from './ui/screens';
import * as C from './ui/campaignScreens';
import * as RW from './ui/rewardsScreens';
import { applyLoyaltyClaim } from './economy/loyalty';
import type { DailyAttempt, DailyBoard } from './net/rewardsProtocol';

type ScreenId = 'home' | 'campaign' | 'chapter' | 'mission' | 'journal' | 'story' | 'campaign-result' | 'levels' | 'daily' | 'cosmetics' | 'achievements' | 'leaderboard' | 'confirm-purchase' | 'prep' | 'confirm-bonus' | 'options' | 'account' | 'confirm-reset' | 'pause' | 'result' | 'revive' | 'loyalty' | 'notices' | 'confirm-prisms' | null;

/** Écran parent (touche Échap) : on remonte d'un niveau plutôt que de retourner à l'accueil. */
const PARENT: Partial<Record<NonNullable<ScreenId>, NonNullable<ScreenId>>> = {
  campaign: 'home',
  chapter: 'campaign',
  mission: 'chapter',
  journal: 'campaign',
  levels: 'campaign',
  account: 'options',
  prep: 'home',
  loyalty: 'home',
  'confirm-prisms': 'cosmetics',
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
  readonly lb = new LeaderboardClient({ baseUrl: LEADERBOARD_URL, store: this.store, balance: BALANCE_VERSION, build: __APP_VERSION__, clientInfo: () => ({ installId: this.save.economy.installId || undefined, bonusBought: { ...this.save.economy.bonusBought } }) });
  /** Compte, synchronisation et migration (économie v3) : facultatifs, jamais bloquants ; inactifs si le service n'est pas configuré. */
  readonly account: AccountService;
  /** ?demo (joueur automatique) ou ?debug : jamais éligible au classement. */
  private readonly devMode = new URLSearchParams(location.search).has('demo') || new URLSearchParams(location.search).has('debug');
  private nextTicket: Ticket | null = null;
  private runTicket: Ticket | null = null;
  private runLb: S.RunLbStatus = { kind: 'hidden' };
  private lbBalance = BALANCE_VERSION;
  /** Classement affiché : « Sans bonus » par défaut. */
  private lbCategory: Category = 'plain';
  private lbLoading = false;
  private lbError: string | null = null;
  private lbTop: LeaderboardResponse | null = null;
  private lbMe: MeResponse | null = null;
  private lbBalances: BalancesResponse | null = null;
  private lbNickMessage: string | null = null;
  private lbProfileLost = false;
  private lbConfirmDelete = false;
  private lbReportMessage: string | null = null;
  save: SaveData;
  /** Résultat du chargement (sauvegarde illisible ou plus récente que le jeu : signalé à l'accueil). */
  private loadStatus: LoadResult['status'] = 'new';
  /** Le stockage du navigateur refuse les écritures : la progression ne sera pas conservée (signalé à l'accueil). */
  private storageFailed = false;
  private saveNoticeDismissed = false;
  private shopMessage: { kind: 'ok' | 'error'; text: string } | null = null;
  /** Achat de bonus en attente de confirmation et écran d'où il vient. */
  private bonusOrder: { kind: string; qty: number; back: 'cosmetics' | 'prep' } | null = null;
  private prepMessage: { kind: 'ok' | 'error'; text: string } | null = null;
  private achMessage: { kind: 'ok' | 'error'; text: string } | null = null;
  /** Succès réclamés à l'instant (animation courte, affichée une fois). */
  private justClaimed: string[] = [];
  /** Achat premium en cours auprès du service (le bouton de confirmation est neutralisé). */
  private purchaseBusy = false;
  private readonly sfx = new Sfx();
  /** Musique de partie : partage le contexte audio, le volume et la sourdine de `sfx`. */
  readonly music = new Music({ context: () => this.sfx.context, output: () => this.sfx.output });
  private readonly hud = new Hud();
  /** Ambiance évolutive de la Survie : position musicale entendue → carte musicale → directeur → rendu. */
  private readonly musicPos: MusicPosition = { track: null, time: 0, playing: false };
  private readonly musicSync = new MusicSync();
  private readonly ambience = new AmbienceDirector();
  private readonly quality = new QualityGovernor((navigator.hardwareConcurrency ?? 8) <= 4 ? 'medium' : 'high');
  /** Aperçu des stades (URL `?stade=N`, 1 à 5) : décale seulement le temps de l'ambiance, jamais celui de la partie. */
  private readonly ambiencePreview = ambiencePreviewOffset();
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
  private portraitsWarmed = false;
  /** Instant (ms) de la dernière action de récit acceptée : protège d'un double toucher involontaire. */
  private lastStoryTap = 0;
  /** Une version plus récente est publiée (la page affichée vient du cache du navigateur). */
  private updateAvailable = false;
  /** Vitesse du texte des scènes (caractères/s) ; réglable par les tests de bout en bout. */
  storyCharsPerSecond: number = STORY_UI.charsPerSecond;
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
  /** Commandes Boost / Gel / Bouclier (hors de l'aire de jeu). */
  private readonly powersBar = new PowersBar((k) => this.onPower(k));
  /** Résultat CLASSÉ de la partie de Survie en cours (figé à la première mort ; les reprises ne le modifient jamais). */
  private firstReport: RunReport | null = null;
  /** Identifiant aléatoire de la partie : clé d'idempotence du paiement des reprises en Prismes. */
  private runId = '';
  /** Paiement d'une reprise en cours de vérification par le service (boutons neutralisés). */
  private reviveBusy = false;
  private reviveMessage: { kind: 'ok' | 'error'; text: string } | null = null;
  /** Dépense de Prismes en attente de confirmation (écran de reprise). */
  private reviveConfirm = false;
  /** Achats de Prismes (boutique) : vérifiés par le service avant tout crédit. */
  private readonly prismStore: StoreService = new StoreService(
    {
      get configured() {
        return LEADERBOARD_URL.length > 0;
      },
      api: (m, p, o) => this.lb.api(m, p, o),
      hasIdentity: () => !!this.lb.identity(),
      isAccount: () => (this.account?.state.profile ? this.account.state.profile.canBuyPremium : null),
      commit: (mutate) => {
        mutate(this.save);
        this.persist(false);
      },
    },
    () => {
      if (this.session) return;
      if (this.screen === 'cosmetics' && this.cosmeticsTab === 'prisms') this.showScreen('cosmetics', false);
    },
  );
  private pendingPrismPack: string | null = null;
  // Récompenses gratuites (phase 4)
  /** Le service a répondu à la validation de présence pendant cette ouverture (sinon : dernier état connu). */
  private loyaltyOnline = false;
  private loyaltyBusy: string | null = null;
  private loyaltyMessage: { kind: 'ok' | 'error'; text: string } | null = null;
  private loyaltyJust: string[] = [];
  private dailyBoard: { board: DailyBoard | null; loading: boolean; error: string | null } = { board: null, loading: false, error: null };
  /** Gains à annoncer au lancement : résultats du Défi quotidien (rang, Prismes) et drops rares confirmés. */
  private gainQueue: RW.GainNotice[] = [];
  /** Tentative du Défi quotidien démarrée auprès du service (preuve d'horaire) pour la partie en cours. */
  private dailyAttempt: Promise<DailyAttempt | null> | null = null;

  constructor() {
    const res = loadSave(this.store);
    this.loadStatus = res.status;
    this.save = res.data;
    // Le service de compte lit la sauvegarde : il est créé APRÈS son chargement (et avant toute écriture)
    this.account = new AccountService({
      lb: this.lb,
      store: this.store,
      getSave: () => this.save,
      commit: (mutate) => {
        mutate(this.save);
        this.persist(false);
      },
      isPlaying: () => this.session !== null && this.session.phase !== 'over',
      onChange: () => {
        if (this.session) return;
        if (this.screen === 'account') this.rerenderAccount();
        // Soldes confirmés par le service : les écrans de boutique, succès et préparation se mettent à jour (jamais pendant un achat à confirmer)
        // Actualisation silencieuse (soldes confirmés) : les messages d'achat et l'animation de réclamation restent affichés jusqu'à la prochaine action
      else if (this.screen === 'cosmetics' || this.screen === 'achievements' || this.screen === 'prep' || this.screen === 'home') this.showScreen(this.screen, false);
      },
    });
    this.applyAudioOptions();
    this.normalizeSave();
    useInstallStore(this.store);
    ensureInstallId(this.save);
    this.storageFailed = !storageWorks(this.store);
    // Sauvegarde modifiée par un AUTRE onglet : on adopte la plus récente (jamais d'écrasement silencieux, aucune récompense en double)
    window.addEventListener('storage', (e) => this.onRemoteSave(e));
  }

  /**
   * Remet la sauvegarde en cohérence après chargement ou adoption : apparence et traînée équipées possédées, succès devenus
   * atteignables (versés une seule fois). Renvoie vrai si une écriture est nécessaire.
   */
  private normalizeSave(): boolean {
    // Apparence équipée : si l'identifiant est inconnu ou verrouillé, retour au modèle classique
    // Un service de comptes est-il configuré ? Alors seuls les soldes confirmés financent un achat hors ligne (economy/funds.ts)
    this.save.economy.managed = this.lb.configured;
    this.save.skin = resolveEquipped(this.save.skin, this.save).id;
    if (!isOwned(this.save, this.save.trail)) this.save.trail = DEFAULT_TRAIL_ID;
    // Nouveaux objectifs déjà atteints grâce à la progression existante : succès débloqués et récompensés une seule fois
    const gained = reconcileAchievements(this.save).length > 0;
    if (gained) this.persist();
    return gained;
  }

  /** Écran dépendant de la sauvegarde, sans saisie en cours : il peut être redessiné quand un autre onglet a enregistré. */
  private static readonly SAVE_SCREENS: ScreenId[] = ['home', 'campaign', 'chapter', 'mission', 'journal', 'levels', 'daily', 'achievements', 'options'];

  /** Avertissements de sauvegarde à l'accueil : stockage refusé (progression non conservée), sauvegarde illisible ou plus récente que le jeu. */
  private saveNotices(): S.SaveNotices {
    return {
      storageFailed: this.storageFailed,
      load: this.saveNoticeDismissed ? null : this.loadStatus === 'corrupt' || this.loadStatus === 'future' ? this.loadStatus : null,
    };
  }

  private onRemoteSave(e: StorageEvent): void {
    if (e.key !== SAVE_KEY) return;
    const next = parseSave(e.newValue);
    if (!next) return;
    this.save = next;
    this.applyAudioOptions();
    this.normalizeSave();
    if (App.SAVE_SCREENS.includes(this.screen) && !this.session) this.showScreen(this.screen, false);
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
      firstInteraction: () => this.unlockAudio(),
      power: (key) => {
        const kind = POWER_KEYS[key];
        if (kind) this.onPower(kind);
      },
    }).attach();
    // Scène illustrée : Entrée ou Espace = révéler / avancer (mêmes règles que le toucher) ; un bouton focalisé garde son propre rôle
    document.addEventListener('keydown', (e) => {
      if (this.screen !== 'story' || (e.key !== 'Enter' && e.key !== ' ')) return;
      if ((e.target as HTMLElement | null)?.closest?.('button')) return;
      e.preventDefault();
      if (e.repeat) return; // touche maintenue : une seule action
      this.advanceStory();
    });
    document.getElementById('btn-pause')!.addEventListener('click', () => this.pause());
    document.getElementById('btn-pause')!.addEventListener('pointerdown', (e) => e.preventDefault());
    this.screenEl.addEventListener('click', this.onScreenClick);
    // Image de récit introuvable (réseau coupé, ancienne version en cache) : on masque l'image défaillante, la scène reste jouable
    this.screenEl.addEventListener(
      'error',
      (e) => {
        const t = e.target;
        if (t instanceof HTMLImageElement && t.closest('.story')) t.classList.add('story__failed');
      },
      true,
    );
    this.screenEl.addEventListener('input', this.onScreenInput);
    // Réglage de la musique : écoute d'essai quand le curseur est relâché
    this.screenEl.addEventListener('change', (e) => {
      if ((e.target as HTMLElement).dataset?.input === 'music') this.music.audition();
    });
    this.screenEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const kind = (e.target as HTMLElement).dataset.form;
      if (kind === 'lb-register' || kind === 'lb-rename') void this.submitNickname(kind);
      else if (kind === 'lb-report') void this.submitReport();
      else if (kind === 'acct-email') void this.account.emailRequest(((e.target as HTMLElement).querySelector('input') as HTMLInputElement | null)?.value.trim() ?? '');
      else if (kind === 'acct-code') {
        const st = this.account.state.email;
        const code = (((e.target as HTMLElement).querySelector('input') as HTMLInputElement | null)?.value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (st.requestId) void this.account.emailVerify(st.requestId, code, false);
      }
    });
    // Retour en ligne : envoi des résultats en attente et renouvellement des tickets
    window.addEventListener('online', () => {
      void this.lb.flush();
      void this.lb.flushDaily();
      void this.refreshLoyalty();
      void this.lb.ensureTickets();
      void this.account.syncNow(true);
    });
    void this.lb.flush();
    void this.lb.ensureTickets();
    void this.lb.flushDaily();
    void this.account.start().then(() => {
      this.cleanMagicLink();
      return this.initRewards();
    }).then(() => this.initStore());
    void this.checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.checkForUpdate();
      // Application restée ouverte au-delà de minuit UTC : la présence du nouveau jour est validée au retour
      if (!document.hidden && !this.session) void this.refreshLoyalty();
      if (document.hidden) {
        this.pause();
        this.sfx.suspend();
      } else {
        this.sfx.resume();
      }
    });
    window.addEventListener('blur', () => this.pause());
    // Application native (Android / iOS) : cycle de vie, bouton Retour, écran de démarrage (sans effet sur le web)
    void initNative({
      onBackground: () => {
        this.pause();
        this.sfx.suspend();
      },
      onForeground: () => this.sfx.resume(),
      onBack: () => this.handleBack(),
    });
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    this.layout();
    this.lastFrame = performance.now();
    this.showScreen('home');
    void hideNativeSplash();
  }

  /**
   * Compare la version affichée à celle publiée (`version.json`, lu sans cache) : si la page vient d'un cache ancien,
   * l'accueil propose « Recharger ». Aucune erreur réseau ne bloque le jeu.
   */
  private async checkForUpdate(): Promise<void> {
    // Application native : le jeu est embarqué dans l'application, sa mise à jour passe par le magasin (pas de « Recharger »)
    if (__BUILD_ID__ === 'dev' || nativePlatform()) return;
    try {
      const res = await fetch(`${new URL('version.json', document.baseURI).href}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const info = (await res.json()) as { build?: unknown };
      if (typeof info.build === 'string' && info.build !== __BUILD_ID__ && !this.updateAvailable) {
        this.updateAvailable = true;
        if (this.screen === 'home') this.showScreen('home', false);
      }
    } catch {
      /* hors ligne ou fichier absent : rien à faire */
    }
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
  /** Volume général, mixage musique / effets sonores et sourdine (Sfx possède le contexte, la sortie et les deux bus). */
  private applyAudioOptions(): void {
    const o = this.save.options;
    this.sfx.setVolume(o.volume);
    this.sfx.setSfxVolume(o.sfxVolume);
    this.sfx.setMuted(o.muted);
    this.music.setLevel(o.musicVolume);
  }

  /** La musique est-elle réellement entendue ? Sinon l'ambiance ne réagit pas (aucune fausse synchronisation). */
  private musicAudible(): boolean {
    const o = this.save.options;
    return !o.muted && o.volume > 0 && o.musicVolume > 0;
  }

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
    if (this.renderer) {
      this.renderer.trailId = this.isCampaignRun() ? DEFAULT_TRAIL_ID : this.save.trail;
      this.renderer.ambience = this.updateAmbience(realDt);
    }
    this.renderer?.draw(this.session, this.activeSkin(), realDt, this.clock);
  }

  /** Ambiance de la Survie et du défi quotidien (décorative) : jamais en campagne ni en défi classique. */
  private updateAmbience(realDt: number): ReturnType<AmbienceDirector['update']> | null {
    const s = this.session;
    if (!s || !ambienceApplies(s.config.mode)) return null;
    this.quality.update(realDt);
    if (this.ambience.state.tier !== this.quality.tier) this.ambience.setQuality(this.quality.tier);
    const frame = this.musicSync.update(this.music.position(this.musicPos), this.musicAudible());
    const dt = s.phase === 'paused' ? 0 : realDt;
    return this.ambience.update(s.sim.time + this.ambiencePreview, dt, frame, this.reducedMotion, this.save.options.visualIntensity);
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
    } else if (this.hud.update(session, session.sim.life > 1 ? 'Survie libre · non classée' : label, cfg.mode === 'level' ? null : session.sim.life > 1 ? 0 : this.bestAtStart, !eventActive)) {
      this.sfx.play('record');
      this.renderer?.ring(COLORS.gold);
    }
    if (cfg.mode === 'survival') this.powersBar.update(session);
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
    // Survie : les charges de l'inventaire sont le stock de la partie (le service vérifie ensuite chaque activation par rejeu)
    // Le mode choisi à la préparation est figé pour toute la partie (rejouer garde le même mode) ; « Sans bonus » : aucune charge, aucun pouvoir
    if (cfg.mode === 'survival') {
      const bonus = cfg.bonus ?? this.save.options.survivalMode === 'bonus';
      cfg = { ...cfg, bonus, stock: bonus ? { boost: this.save.inventory.boost, gel: this.save.inventory.gel } : { boost: 0, gel: 0 } };
    }
    this.firstReport = null;
    this.runId = randomRunId();
    this.reviveBusy = false;
    this.reviveMessage = null;
    this.lastConfig = cfg;
    this.runTicket = cfg.mode === 'survival' ? this.nextTicket : null;
    this.nextTicket = null;
    this.runLb = { kind: 'hidden' };
    // Récompenses gratuites : le départ est enregistré par le SERVICE (preuve d'horaire du Défi quotidien ; condition du drop rare en Survie)
    this.dailyAttempt = null;
    if (cfg.mode === 'daily' && cfg.date && this.lb.configured && !this.devMode && this.lb.identity()) {
      this.dailyAttempt = this.lb.dailyStart(cfg.date).then((r) => (r.ok ? r.data.attempt : null), () => null);
    }
    if (cfg.mode === 'survival' && this.runTicket && !this.devMode) void this.lb.startTicket(this.runTicket.id);
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.showScreen(null);
    this.renderer?.clearEffects();
    this.ambience.reset();
    this.musicSync.reset();
    this.hud.reset();
    this.eventKey = '';
    this.creditedShards.clear();
    this.hud.show(true);
    this.setPowersVisible(cfg.mode === 'survival' && cfg.bonus !== false);
    if (cfg.mode === 'survival') this.bestAtStart = (cfg.bonus ? this.save.survivalBonus : this.save.survival).bestTime;
    else if (cfg.mode === 'daily') this.bestAtStart = this.save.daily[cfg.date ?? '']?.bestTime ?? 0;
    else this.bestAtStart = 0;

    // Mode démonstration (?demo) : le joueur automatique joue, pour inspecter les motifs.
    const demo = new URLSearchParams(location.search).has('demo');
    const session = new GameSession(cfg, {
      onBeforeStep: demo ? () => this.demoBot?.tick() : undefined,
      onEvent: (e, s) => this.onSimEvent(e, s),
      onPhase: (p, s) => this.onSessionPhase(p, s),
      onCampaignEvent: (e, s) => this.onCampaignEvent(e, s),
      onEnd: (summary, s) => this.onRunEnd(summary, s),
      onFirstDeath: (summary, s) => this.onFirstDeath(summary, s),
      canOffer: (s) => !this.devMode && !s.sim.assisted && this.lb.configured,
      onOffer: (life, s) => this.showRevive(life === 3 ? 3 : 2, s),
    });
    this.session = session;
    this.music.startGame();
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

  /** Déverrouille l'audio (geste du joueur) et lance, une seule fois, le décodage de la musique. */
  private unlockAudio(): void {
    this.sfx.unlock();
    void this.music.preload();
  }

  /** Musique et phases de la partie : pause, reprise (après le compte à rebours), fin (outro). */
  private onSessionPhase(p: Phase, s: GameSession): void {
    if (s !== this.session) return;
    if (p === 'paused') this.music.pause();
    else if (p === 'running') this.music.resume();
    else if (p === 'ending') this.music.endGame();
  }

  private endSession(): void {
    // Partie quittée en cours de route (menu, recommencer) : la musique s'arrête ; après la fin de partie, l'outro continue
    if (this.session && ['running', 'paused', 'countdown'].includes(this.session.phase)) this.music.stop();
    if (this.session) this.session.abort();
    this.session = null;
    // Partie abandonnée avant sa première mort : ses charges consommées sont DÉCLARÉES au service (usage non classé)
    const live = this.save.economy.liveUse;
    if (live.boost > 0 || live.gel > 0) {
      this.save.economy.liveUse = { boost: 0, gel: 0 };
      this.persist();
    }
    this.setPowersVisible(false);
    this.countdownEl.classList.add('hidden');
    this.lastCountdownShown = -1;
  }

  private onAction(): void {
    if (this.session?.action()) this.sfx.play('flip');
  }

  /** Activation d'un pouvoir (bouton ou raccourci) : jamais une inversion ; la simulation juge la demande au prochain pas. */
  private onPower(kind: PowerKind): void {
    const s = this.session;
    if (!s || s.config.mode !== 'survival') return;
    s.power(kind);
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
    // Reprise proposée : on choisit explicitement (reprendre ou terminer), jamais d'abandon accidentel par Échap ou Retour
    if (this.screen === 'revive') return;
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

  /**
   * Bouton Retour d'Android : même logique que la touche Échap (pause en jeu, écran précédent dans les menus) ; les écrans de résultat
   * ramènent à l'accueil. Renvoie faux à l'accueil sans partie : l'application peut alors se fermer.
   */
  handleBack(): boolean {
    const s = this.session;
    const inRun = !!s && ['running', 'countdown', 'ending', 'paused'].includes(s.phase);
    const action = backAction(inRun, this.screen);
    if (action === 'exit') return false;
    if (action === 'home') this.showScreen('home');
    else this.onPauseKey();
    return true;
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
      case 'power':
        if (e.stage === 'start') this.onPowerStart(e.kind, e.charged);
        else if (e.reason === 'expire') this.sfx.play('tick');
        break;
      case 'shield-ready':
        this.sfx.play('success');
        r?.ring(COLORS.shield);
        break;
      case 'shield-absorb':
        this.sfx.play('hit');
        r?.impact(e.hitX, e.hitY, e.x, e.y, e.by);
        r?.ring(COLORS.shield);
        break;
      case 'revive':
        this.sfx.play('success');
        r?.ring(COLORS.cyan);
        break;
      default:
        break;
    }
  }

  /** Pouvoir activé : effet sonore et visuel ; si une charge achetée est consommée, l'inventaire local baisse tout de suite (provisoire). */
  private onPowerStart(kind: PowerKind, charged: boolean): void {
    this.sfx.play(kind === 'shield' ? 'success' : 'activate');
    this.renderer?.ring(kind === 'boost' ? COLORS.gold : kind === 'gel' ? COLORS.cyan : COLORS.shield);
    if (!charged || kind === 'shield') return;
    const e = this.save.economy;
    this.save.inventory[kind] = Math.max(0, this.save.inventory[kind] - 1);
    e.bonusUsed[kind]++;
    e.liveUse[kind]++;
    this.persist(false);
  }

  /** Fin de partie : résultat appliqué une seule fois (la session garantit l'unicité de l'appel). */
  private onRunEnd(summary: RunSummary, s: GameSession): void {
    if (s !== this.session) return;
    if (summary.mode === 'campaign') {
      this.onMissionEnd(summary);
      return;
    }
    let report: RunReport;
    if (summary.mode === 'survival') {
      // Le résultat classé a été appliqué à la première mort (jamais deux fois) ; la survie libre éventuelle n'est qu'un complément d'affichage
      report = this.firstReport ?? applyRun(this.save, summary);
      report.run.free = summary.free;
      this.persist();
      // Charges et achats en attente : synchronisation puis nouvel envoi des parties classées (le service demande parfois de synchroniser d'abord)
      void this.account.syncNow().then(() => this.lb.flush()).then(() => this.refreshRunLbFromPending());
    } else {
      report = applyRun(this.save, summary);
      this.persist();
      if (summary.mode === 'daily') this.afterDailyRun(summary, s);
    }
    this.hud.show(false);
    this.setPowersVisible(false);
    this.hideBanner();
    this.showResult(report);
  }

  /**
   * PREMIÈRE MORT en Survie : la tentative classée est figée et traitée tout de suite — records locaux, succès, soumission au classement (en attente si
   * hors ligne) — sans jamais attendre ni dépendre d'une éventuelle reprise.
   */
  private onFirstDeath(summary: RunSummary, s: GameSession): void {
    if (s !== this.session) return;
    this.firstReport = applyRun(this.save, summary);
    this.persist();
    this.afterSurvivalRun(summary, s);
  }

  // ————————————————————————————————————————————— récompenses gratuites (phase 4)

  private loyaltyView(): RW.LoyaltyView {
    return {
      state: this.save.loyalty.snapshot,
      online: this.loyaltyOnline,
      provisional: !this.loyaltyOnline && this.save.loyalty.localDay === utcDateString(),
      incompatible: this.lb.isServiceIncompatible(),
      busy: this.loyaltyBusy,
      message: this.loyaltyMessage,
      justClaimed: this.loyaltyJust,
      now: Date.now(),
    };
  }

  private dailyBoardView(): RW.DailyBoardView {
    return { ...this.dailyBoard, configured: this.lb.configured, pending: this.lb.pendingDaily(), now: Date.now() };
  }

  /** Valide la présence du jour auprès du service (heure du SERVICE) et met à jour le calendrier. Hors ligne : présence PROVISOIRE seulement (jamais créditée). */
  private async refreshLoyalty(): Promise<void> {
    if (!this.lb.configured) return;
    const res = await this.lb.loyaltyCheckin();
    if (res.ok) {
      this.loyaltyOnline = true;
      this.save.loyalty.snapshot = res.data;
      this.save.loyalty.localDay = '';
    } else {
      this.loyaltyOnline = false;
      this.save.loyalty.localDay = utcDateString();
    }
    this.persist(false);
    if (this.session) return;
    if (this.screen === 'loyalty' && this.loyaltyBusy === null) this.showScreen('loyalty', false);
    else if (this.screen === 'home') this.showScreen('home', false);
  }

  /** Au lancement : présence, résultats du Défi quotidien et drops en attente d'annonce ; jamais pendant une partie ni par-dessus un autre écran. */
  private async initRewards(): Promise<void> {
    if (!this.lb.configured) return;
    await this.refreshLoyalty();
    if (this.lb.identity()) {
      await this.lb.flush();
      const n = await this.lb.dailyNotices();
      if (n.ok) for (const x of n.data.notices) if (!this.gainQueue.some((g) => g.kind === 'daily' && g.date === x.date)) this.gainQueue.push({ kind: 'daily', ...x });
    }
    this.gainQueue = this.gainQueue.filter((g) => g.kind !== 'drop');
    for (const p of this.lb.unseenDrops()) if (p.result?.drop) this.gainQueue.push({ kind: 'drop', prisms: p.result.drop.prisms });
    if (this.session || this.screen !== 'home') return;
    if (this.gainQueue.length > 0) this.showScreen('notices');
    else this.maybeShowCalendar();
  }

  /** Le calendrier s'ouvre tout seul à la première ouverture de chaque jour UTC (jour du service si connu). */
  private maybeShowCalendar(): void {
    // Service pas à jour : le calendrier n'a rien à montrer, on n'ouvre pas d'écran inutile (aucune présence n'est perdue : elle sera validée dès la mise à jour)
    if (this.lb.isServiceIncompatible()) return;
    const today = this.loyaltyOnline && this.save.loyalty.snapshot ? this.save.loyalty.snapshot.today : utcDateString();
    if (this.save.loyalty.shownDay === today) return;
    this.save.loyalty.shownDay = today;
    this.persist(false);
    this.loyaltyMessage = null;
    this.loyaltyJust = [];
    this.showScreen('loyalty');
  }

  private async finishNotices(): Promise<void> {
    const dates = this.gainQueue.filter((g): g is Extract<RW.GainNotice, { kind: 'daily' }> => g.kind === 'daily').map((g) => g.date);
    this.gainQueue = [];
    if (dates.length > 0) void this.lb.dailyAck(dates);
    for (const p of this.lb.unseenDrops()) this.lb.markDropSeen(p.id);
    this.showScreen('home');
    this.maybeShowCalendar();
    // Les Prismes crédités par le service apparaissent au solde confirmé après la synchronisation
    void this.account.syncNow(true);
  }

  /** Réclamation MANUELLE d'une récompense du calendrier : le service décide (atomique, une seule fois) ; l'appareil reflète sa réponse. */
  private async claimLoyalty(cycle: number, day: number): Promise<void> {
    if (this.loyaltyBusy !== null || !Number.isInteger(cycle) || !Number.isInteger(day)) return;
    this.loyaltyBusy = `${cycle}:${day}`;
    this.loyaltyMessage = null;
    this.rerenderLoyalty();
    const res = await this.lb.loyaltyClaim(cycle, day);
    this.loyaltyBusy = null;
    if (res.ok) {
      applyLoyaltyClaim(this.save, res.data);
      this.persist(false);
      this.loyaltyOnline = true;
      if (res.data.credited) {
        this.loyaltyJust = [`${cycle}:${day}`];
        this.sfx.play(res.data.reward.kind === 'prisms' ? 'record' : 'success');
        this.loyaltyMessage = { kind: 'ok', text: `Récupéré : ${RW.rewardLabel(res.data.reward)}.` };
        void this.account.syncNow(true);
      } else {
        this.loyaltyMessage = { kind: 'ok', text: 'Cette récompense avait déjà été récupérée : rien n’a été ajouté.' };
      }
    } else {
      this.loyaltyMessage = { kind: 'error', text: res.kind === 'offline' ? 'Connexion requise pour récupérer une récompense : elle reste disponible.' : res.message };
    }
    this.rerenderLoyalty();
  }

  private rerenderLoyalty(): void {
    if (this.screen === 'loyalty') this.showScreen('loyalty', false);
  }

  /** Classement mondial du jour : consultation (le service reste l'autorité sur les rangs, les ex æquo et les Prismes). */
  private async refreshDailyBoard(): Promise<void> {
    if (!this.lb.configured) return;
    this.dailyBoard = { ...this.dailyBoard, loading: true, error: null };
    if (this.screen === 'daily') this.showScreen('daily', false);
    void this.lb.flushDaily().then(() => {
      if (this.screen === 'daily') this.showScreen('daily', false);
    });
    const res = await this.lb.dailyBoard();
    this.dailyBoard = res.ok ? { board: res.data, loading: false, error: null } : { board: this.dailyBoard.board, loading: false, error: res.message };
    if (this.screen === 'daily') this.showScreen('daily', false);
  }

  private dailyStatusOf(p: import('./net/leaderboard').PendingDaily | undefined): S.RunLbStatus {
    if (!p) return { kind: 'hidden' };
    if (p.status === 'accepted' && p.result) return { kind: 'daily-accepted', rank: p.result.rank, eligible: p.result.eligible, late: p.result.late, state: p.result.state };
    if (p.status === 'rejected') return { kind: 'rejected', message: p.message ?? 'refusé par le service' };
    return { kind: 'pending', offline: !!p.lastError };
  }

  /**
   * Fin d'une partie du Défi quotidien : si la tentative a été DÉMARRÉE en ligne (le service connaît l'heure de début), son journal est conservé « en attente »
   * puis envoyé ; le service rejoue et décide. Sinon : résultat local seulement, expliqué.
   */
  private afterDailyRun(summary: RunSummary, s: GameSession): void {
    this.runLb = { kind: 'hidden' };
    const attempt = this.dailyAttempt;
    this.dailyAttempt = null;
    if (!this.lb.configured || this.devMode || s.sim.assisted) return;
    if (!attempt) {
      this.runLb = { kind: 'daily-local' };
      return;
    }
    this.runLb = { kind: 'sending' };
    const flips = [...s.sim.flipLog];
    void attempt.then(async (att) => {
      if (!att) {
        this.runLb = { kind: 'daily-local' };
        this.refreshRunLbStatus();
        return;
      }
      this.lb.recordDaily(att, flips, { time: summary.time, score: summary.score });
      const list = await this.lb.flushDaily();
      this.runLb = this.dailyStatusOf(list.find((x) => x.id === att.id));
      this.refreshRunLbStatus();
      if (this.screen === 'daily') void this.refreshDailyBoard();
    });
  }

  // ————————————————————————————————————————————— boutique : achats de Prismes

  private storeName(): string {
    const st = getPaymentProvider().store;
    return st === 'apple' ? ST.STORE_NAMES.apple : st === 'google' ? ST.STORE_NAMES.google : ST.STORE_NAMES.web;
  }

  private storeView(): ST.StoreView {
    return {
      availability: this.prismStore.availability(),
      state: this.prismStore.state,
      confirmedPrisms: this.save.economy.confirmed?.prisms ?? null,
      canRestore: !!getPaymentProvider().pending && getPaymentProvider().isAvailable(),
      storeName: this.storeName(),
    };
  }

  /** Au démarrage : plugins natifs (s'ils existent), configuration du service, achats non terminés à revérifier. Sans plugin ni service : rien ne change. */
  private async initStore(): Promise<void> {
    await initNativePayments();
    await initNativeAds();
    if (!this.lb.configured) return;
    await this.prismStore.loadConfig();
    await this.account.loadProfile();
    await this.prismStore.restore(true);
  }

  // ————————————————————————————————————————————— reprise (deuxième / troisième chance)

  /** Affiche ou masque les commandes des pouvoirs et recalcule la taille de l'arène (la barre réserve sa place). */
  private setPowersVisible(visible: boolean): void {
    this.powersBar.show(visible);
    this.layout();
  }

  /** Écran de reprise : la partie classée est déjà enregistrée ; la suite est une survie libre non classée. */
  private showRevive(_life: 2 | 3, s: GameSession): void {
    if (s !== this.session) return;
    this.reviveBusy = false;
    this.reviveMessage = null;
    this.reviveConfirm = false;
    this.setPowersVisible(false);
    this.hud.show(false);
    this.hideBanner();
    this.screen = 'revive';
    this.renderRevive();
  }

  private renderRevive(): void {
    const s = this.session;
    if (!s || this.screen !== 'revive') return;
    const life = s.sim.life >= 2 ? 3 : 2;
    const report = this.firstReport;
    const price = REVIVE.prisms[life];
    const conf = this.save.economy.confirmed?.prisms ?? null;
    let blocked: string | null = null;
    if (!this.lb.configured) blocked = 'Indisponible dans cette version';
    else if (!this.lb.identity()) blocked = 'Connexion au service requise';
    else if (typeof navigator !== 'undefined' && navigator.onLine === false) blocked = 'Hors connexion : paiement impossible';
    else if (conf !== null && conf < price) blocked = `Prismes insuffisants (${conf} sur ${price})`;
    const adView = this.adView(life);
    this.screenEl.innerHTML = S.reviveScreen({
      life,
      time: report?.run.time ?? 0,
      score: report?.run.score ?? 0,
      category: report?.run.category ?? 'plain',
      ad: adView,
      prisms: { price, balance: conf, blocked },
      busy: this.reviveBusy,
      confirm: this.reviveConfirm && !blocked,
      message: this.reviveMessage,
      lb: this.runLb,
    });
    this.screenEl.classList.remove('hidden', 'no-anim');
    this.screenEl.classList.add('dim');
    this.screenEl.scrollTop = 0;
    this.screenEl.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }

  /**
   * Reprise payée en Prismes : le SERVICE vérifie le solde et débite (idempotent par partie et par vie). Aucune reprise tant que le paiement n'est pas
   * confirmé : réseau coupé, refus ou réponse perdue = pas de reprise, rien de débité localement ; une nouvelle tentative ne débite jamais deux fois.
   */
  private async reviveWithPrisms(): Promise<void> {
    const s = this.session;
    if (!s || this.reviveBusy || s.phase !== 'offer') return;
    const life = s.sim.life >= 2 ? 3 : 2;
    this.reviveBusy = true;
    this.reviveMessage = null;
    this.renderRevive();
    const res = await this.account.payRevive(this.runId, life);
    this.reviveConfirm = false;
    if (this.session !== s || s.phase !== 'offer') return;
    this.reviveBusy = false;
    if (res.ok) this.startRevive(s);
    else {
      this.reviveMessage = { kind: 'error', text: res.message };
      this.renderRevive();
    }
  }

  /** Vue de l'option « publicité » : prête, indisponible (expliquée) ou masquée (fournisseur présent mais aucune publicité prête). */
  private adView(life: 2 | 3): { offered: boolean; available: boolean; hidden?: boolean; reason?: string } {
    if (life !== 2 || !REVIVE.adLives.includes(2)) return { offered: false, available: false };
    const ad = getAdProvider();
    if (ad.kind !== 'native') return { offered: true, available: false, reason: 'Indisponible dans cette version' };
    if (this.prismStore.config && !this.prismStore.config.ads.enabled) return { offered: true, available: false, reason: 'Publicité non activée sur le service' };
    if (!this.lb.identity() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { offered: true, available: false, hidden: !ad.isAvailable(), reason: 'Connexion requise' };
    // Un fournisseur existe mais aucune publicité n'est prête : on ne montre pas l'option (jamais de bouton qui ne fait rien)
    return { offered: true, available: ad.isAvailable() && this.prismStore.config?.ads.enabled === true, hidden: !ad.isAvailable() };
  }

  /**
   * Reprise par publicité récompensée : session créée par le SERVICE → publicité (régie) → confirmation serveur à serveur → réclamation (usage unique).
   * Publicité interrompue, fermée, échouée ou non confirmée : aucune reprise. Aucune minuterie ne remplace la confirmation. Aucun Prisme débité.
   */
  private async reviveWithAd(): Promise<void> {
    const s = this.session;
    const ad = getAdProvider();
    const view = this.adView(2);
    if (!s || this.reviveBusy || s.phase !== 'offer' || s.sim.life !== 1 || !view.available || view.hidden || !ad.isAvailable()) return;
    this.reviveBusy = true;
    this.reviveMessage = null;
    this.renderRevive();
    const res = await adRevive({ api: (m, p, o) => this.lb.api(m, p, o), provider: ad, runId: this.runId, onReturn: () => this.sfx.resume() });
    if (this.session !== s || s.phase !== 'offer') return;
    this.reviveBusy = false;
    if (res.ok) {
      this.startRevive(s);
      return;
    }
    this.reviveMessage = { kind: 'error', text: res.message };
    this.renderRevive();
  }

  private startRevive(s: GameSession): void {
    this.screen = null;
    this.screenEl.classList.add('hidden');
    this.screenEl.classList.remove('dim');
    this.screenEl.innerHTML = '';
    this.music.startGame();
    this.hud.show(true);
    this.setPowersVisible(this.lastConfig?.bonus !== false);
    this.lastCountdownShown = -1;
    s.revive();
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
    const intro = takeIntroScene(this.save, m);
    if (intro) {
      this.persist();
      this.openStory(intro, () => this.startMission(m), 'Lancer le niveau');
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
    const html = C.storyScreen(d.seq, d.index, d.finish);
    const oldBox = fresh ? null : this.screenEl.querySelector('.story__box');
    const newBox = oldBox ? new DOMParser().parseFromString(html, 'text/html').querySelector('.story__box') : null;
    if (oldBox && newBox) {
      // Réplique suivante : seule la boîte de dialogue change ; l'illustration (déjà décodée) n'est ni rechargée ni redessinée
      oldBox.replaceWith(document.importNode(newBox, true));
    } else {
      this.screenEl.innerHTML = html;
    }
    this.screenEl.scrollTop = 0;
    d.shown = 0;
    d.full = false;
    if (fresh) this.preloadStory(d.seq);
    if (this.reducedMotion) this.revealStoryLine();
  }

  /** Précharge la scène suivante (même niveau, ou début du niveau suivant) et, une fois, les trois portraits (petits : aucun clignotement au changement de locuteur). */
  private preloadStory(seq: StorySequence): void {
    const warm = (key: string | null): void => {
      const url = storyAsset(key);
      if (url) new Image().src = url;
    };
    const nextSeq = storyById(seq.phase === 'before' ? `n${seq.level}-after` : `n${seq.level + 1}-before`);
    if (nextSeq) warm(nextSeq.illustration);
    if (!this.portraitsWarmed) {
      this.portraitsWarmed = true;
      for (const sp of Object.values(SPEAKERS)) warm(sp.portrait);
    }
  }

  /** Texte progressif : avance avec le temps réel (la scène n'est pas une partie ; rien ne dépend de la pause). */
  private updateStoryText(realDt: number): void {
    const d = this.story;
    if (!d || d.full) return;
    const text = d.seq.lines[d.index].text;
    d.shown += realDt * this.storyCharsPerSecond;
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
    // Double toucher (deux clics presque simultanés) : une seule action, jamais « révéler » puis « avancer » d'un coup
    const now = performance.now();
    if (now - this.lastStoryTap < STORY_UI.tapGuardMs) return;
    this.lastStoryTap = now;
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
  private onMissionEnd(summary: RunSummary): void {
    const rep = summary.report;
    if (!rep) return;
    const res = applyMission(this.save, rep);
    this.persist();
    this.hud.show(false);
    this.hideBanner();
    // Conclusion : seulement après une réussite, la première fois (jamais après un échec ni un temps écoulé)
    const after = takeOutroScene(this.save, rep);
    if (after) {
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
        // Le libellé suit le compteur affiché au HUD (niveau 5 : « Téléchargement 2/5 »), jamais un nom d'objet différent
        const progress = o && o.type === 'objects' ? `${e.count}/${o.count}` : '+1';
        r?.popup(x, y, e.kind === 'blackbox' ? `Téléchargement ${progress}` : progress, '#7dffc4');
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
      this.setPowersVisible(false);
      this.hideBanner();
    }
    const today = utcDateString();
    let html = '';
    switch (id) {
      case 'home': html = S.homeScreen(this.save, today, isTouchPrimary(), this.updateAvailable, this.saveNotices(), this.lb.configured, this.lb.configured ? { claimable: this.save.loyalty.snapshot?.claimable ?? 0 } : null); break;
      case 'campaign': html = C.campaignScreen(this.save); break;
      case 'chapter': html = C.chapterScreen(this.save); break;
      case 'mission': html = C.missionScreen(this.save, this.selectedMission); break;
      case 'journal': html = C.journalScreen(this.save); break;
      case 'levels': html = S.levelsScreen(this.save); break;
      case 'daily': html = S.dailyScreen(this.save, today, RW.dailyBoardHtml(this.dailyBoardView())); break;
      case 'loyalty': html = RW.loyaltyScreen(this.loyaltyView()); break;
      case 'notices': html = RW.noticesScreen(this.gainQueue); break;
      case 'cosmetics':
        html = S.cosmeticsScreen(this.save, this.cosmeticsTab, this.cosmeticsFilter, this.selectedItem ?? undefined, this.shopMessage, this.storeView());
        break;
      case 'achievements':
        html = S.achievementsScreen(this.save, this.achMessage, this.justClaimed);
        break;
      case 'leaderboard': html = S.leaderboardScreen(this.leaderboardView()); break;
      case 'confirm-prisms': html = ST.confirmPrismsScreen(this.pendingPrismPack ?? '', this.storeName()); break;
      case 'confirm-purchase': html = S.confirmPurchaseScreen(this.save, this.pendingPurchase ?? '', this.purchaseBusy); break;
      case 'confirm-bonus': html = S.confirmBonusScreen(this.save, this.bonusOrder?.kind ?? '', this.bonusOrder?.qty ?? 0, this.bonusOrder?.back ?? 'cosmetics'); break;
      case 'prep':
        html = S.prepScreen(this.save, this.prepMessage);
        break;
      case 'options': html = S.optionsScreen(this.save, this.lb.configured); break;
      case 'account': html = accountScreen({ state: this.account.state, methods: this.account.availability() }); break;
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
    if (id === 'account') this.afterAccountRender();
  }

  /** Redessine l'écran Compte sans animation ni perte de saisie (l'adresse en cours est conservée). */
  private rerenderAccount(): void {
    const typed = (this.screenEl.querySelector('#acct-email') as HTMLInputElement | null)?.value;
    this.showScreen('account', false);
    const input = this.screenEl.querySelector('#acct-email') as HTMLInputElement | null;
    if (input && typed) input.value = typed;
  }

  /** Après l'affichage de l'écran Compte : méthodes disponibles (chargées une fois) et bouton Google. */
  private afterAccountRender(): void {
    const acc = this.account;
    if (!acc.state.configured) return;
    if (!acc.state.providersLoaded) {
      void acc.loadProviders();
      void acc.loadProfile();
      return;
    }
    const g = acc.availability().find((m) => m.provider === 'google');
    const holder = this.screenEl.querySelector<HTMLElement>('#acct-google');
    const cfg = acc.state.providers;
    if (!g?.available || !holder || !cfg?.google.clientId) return;
    if (g.via === 'native') {
      holder.innerHTML = `<button class="btn btn--secondary btn--sm" data-action="acct-google-native" type="button">Continuer avec Google</button>`;
      return;
    }
    void acc.fetchNonce().then((nonce) => {
      if (!nonce || this.screen !== 'account') return;
      return mountGoogleButton(holder, cfg.google.clientId!, nonce, (r) => void acc.loginOidc('google', r.idToken, nonce));
    }).catch(() => {
      holder.textContent = 'Google est injoignable pour le moment.';
    });
  }

  /** Retire `?magic=…` de l'adresse après lecture (le code ne reste pas dans l'historique). */
  private cleanMagicLink(): void {
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('magic')) {
        u.searchParams.delete('magic');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    } catch {
      /* sans conséquence */
    }
  }

  private async socialLogin(provider: 'google' | 'apple'): Promise<void> {
    const acc = this.account;
    const cfg = acc.state.providers;
    const m = acc.availability().find((x) => x.provider === provider);
    if (!cfg || !m?.available) return;
    const nonce = await acc.fetchNonce();
    if (!nonce) return;
    try {
      const clientId = cfg[provider].clientId ?? '';
      const r = m.via === 'native' ? await signInNative(provider, cfg, nonce) : await signInWithAppleWeb(clientId, nonce);
      await acc.loginOidc(provider, r.idToken, nonce);
    } catch {
      /* fenêtre fermée ou connexion annulée : rien à faire */
    }
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
    this.unlockAudio();
    const action = target.dataset.action!;
    // Messages d'achat / de réclamation : affichés jusqu'à la prochaine action du joueur (une synchronisation en arrière-plan ne les efface pas)
    this.shopMessage = null;
    this.prepMessage = null;
    this.achMessage = null;
    this.justClaimed = [];
    if (action !== 'replay' && action !== 'resume') this.sfx.play('ui');
    switch (action) {
      case 'home': this.showScreen('home'); break;
      case 'reload-app': location.reload(); break;
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
      case 'daily': this.showScreen('daily'); void this.refreshDailyBoard(); break;
      case 'daily-refresh': void this.refreshDailyBoard(); break;
      case 'loyalty': this.loyaltyMessage = null; this.loyaltyJust = []; this.showScreen('loyalty'); void this.refreshLoyalty(); break;
      case 'loyalty-claim': void this.claimLoyalty(Number(target.dataset.cycle), Number(target.dataset.day)); break;
      case 'notices-continue': void this.finishNotices(); break;
      case 'cosmetics': this.selectedItem = null; this.pendingPurchase = null; this.showScreen('cosmetics'); void this.account.syncNow(); break;
      case 'back-cosmetics': this.pendingPurchase = null; this.showScreen('cosmetics'); break;
      case 'achievements': this.showScreen('achievements'); void this.account.syncNow(); break;
      case 'claim-medal': {
        const res = claimMedals(this.save, target.dataset.ach ?? '');
        if (res.ok) {
          this.persist();
          this.sfx.play('success');
          this.justClaimed = [res.achievement.id];
          this.achMessage = { kind: 'ok', text: `+${formatScore(res.medals)} Médailles : ${res.achievement.name}. Solde : ${formatScore(res.balance)} Médailles.` };
          void this.account.syncNow(true);
        } else {
          this.achMessage = { kind: 'error', text: res.reason === 'already' ? 'Ces Médailles ont déjà été récupérées.' : 'Succès non accompli : rien à récupérer.' };
        }
        this.showScreen('achievements', false);
        break;
      }
      case 'claim-all': {
        const res = claimAllMedals(this.save);
        if (res.claimed.length > 0) {
          this.persist();
          this.sfx.play('success');
          this.justClaimed = res.claimed.map((a) => a.id);
          this.achMessage = { kind: 'ok', text: `+${formatScore(res.medals)} Médailles récupérées (${res.claimed.length} succès). Solde : ${formatScore(this.save.wallet.medals)} Médailles.` };
          void this.account.syncNow(true);
        }
        this.showScreen('achievements', false);
        break;
      }
      case 'bonus-ask': {
        this.bonusOrder = { kind: target.dataset.bonus ?? '', qty: Number(target.dataset.qty) || 0, back: this.screen === 'prep' ? 'prep' : 'cosmetics' };
        this.showScreen('confirm-bonus');
        break;
      }
      case 'bonus-back': {
        const back = this.bonusOrder?.back ?? 'cosmetics';
        this.bonusOrder = null;
        this.showScreen(back);
        break;
      }
      case 'bonus-confirm': {
        // Vérification des fonds, débit et crédit d'inventaire dans la même modification, puis une seule écriture (aucune charge consommée)
        const back = this.bonusOrder?.back ?? 'cosmetics';
        const res = buyBonus(this.save, target.dataset.bonus ?? '', Number(target.dataset.qty) || 0);
        const msg = res.ok
          ? { kind: 'ok' as const, text: `${bonusDef(res.kind)?.name ?? ''} ×${res.quantity} ajouté (−${formatScore(res.spent)} Éclats). Stock : ${formatScore(res.stock)}.` }
          : { kind: 'error' as const, text: res.reason === 'stock_full' ? 'Inventaire plein pour ce bonus : rien n’a été débité.' : 'Éclats insuffisants : rien n’a été débité.' };
        if (res.ok) {
          this.persist();
          this.sfx.play('success');
          void this.account.syncNow(true);
        }
        this.bonusOrder = null;
        if (back === 'prep') this.prepMessage = msg;
        else this.shopMessage = msg;
        this.showScreen(back, false);
        break;
      }
      case 'leaderboard': this.openLeaderboard(); break;
      case 'lb-refresh': void this.refreshLeaderboard(); break;
      case 'lb-flush': void this.refreshLeaderboard(); break;
      case 'lb-clear': this.lb.clearDone(); this.rerenderLeaderboard(); break;
      case 'lb-category':
        this.lbCategory = target.dataset.category === 'bonus' ? 'bonus' : 'plain';
        void this.refreshLeaderboard();
        break;
      case 'lb-balance':
        this.lbBalance = Number(target.dataset.balance) || BALANCE_VERSION;
        void this.refreshLeaderboard();
        break;
      // Les formulaires de pseudo sont traités à l'envoi (touche Entrée comprise), pas au clic
      case 'lb-register':
      case 'lb-rename':
      case 'lb-report':
        break;
      case 'lb-delete-ask': this.lbConfirmDelete = true; this.rerenderLeaderboard(); break;
      case 'lb-delete-cancel': this.lbConfirmDelete = false; this.rerenderLeaderboard(); break;
      case 'lb-delete-confirm': void this.deleteLeaderboardProfile(); break;
      case 'lb-forget': this.lb.forgetProfile('drop'); this.lbProfileLost = false; this.lbMe = null; this.lbNickMessage = null; this.rerenderLeaderboard(); break;
      case 'options': this.showScreen('options'); break;
      case 'account': this.showScreen('account'); break;
      case 'acct-sync': void this.account.syncNow(true); break;
      case 'acct-apple': void this.socialLogin('apple'); break;
      case 'acct-google-native': void this.socialLogin('google'); break;
      case 'acct-merge-confirm': void this.account.confirmMerge(); break;
      case 'acct-merge-cancel': this.account.cancelMerge(); break;
      case 'acct-logout': void this.account.logout(); break;
      case 'acct-unlink': void this.account.unlink(target.dataset.provider === 'google' ? 'google' : target.dataset.provider === 'apple' ? 'apple' : 'email'); break;
      // Les formulaires du compte sont traités à l'envoi
      case 'acct-email-send':
      case 'acct-code':
        break;
      case 'survival':
        // Préparation facultative (bonus) avant une partie de Survie ; on peut toujours lancer sans aucun bonus
        this.prepMessage = null;
        this.showScreen('prep');
        void this.account.syncNow();
        break;
      case 'revive-prisms': this.reviveConfirm = true; this.renderRevive(); break;
      case 'revive-prisms-back': if (!this.reviveBusy) { this.reviveConfirm = false; this.renderRevive(); } break;
      case 'revive-prisms-confirm': void this.reviveWithPrisms(); break;
      case 'prisms-buy': this.pendingPrismPack = target.dataset.pack ?? null; this.showScreen('confirm-prisms'); break;
      case 'prisms-cancel': this.pendingPrismPack = null; this.showScreen('cosmetics'); break;
      case 'prisms-confirm': {
        const pack = target.dataset.pack ?? this.pendingPrismPack ?? '';
        this.pendingPrismPack = null;
        this.cosmeticsTab = 'prisms';
        this.showScreen('cosmetics');
        void this.prismStore.buy(pack).then(() => {
          if (this.screen === 'cosmetics') this.showScreen('cosmetics', false);
          void this.account.syncNow(true);
        });
        break;
      }
      case 'prisms-restore': void this.prismStore.restore().then(() => this.screen === 'cosmetics' && this.showScreen('cosmetics', false)); break;
      case 'prisms-account': this.showScreen('account'); break;
      case 'revive-ad': void this.reviveWithAd(); break;
      case 'revive-decline': if (!this.reviveBusy) this.session?.decline(); break;
      case 'prep-mode':
        this.save.options.survivalMode = target.dataset.mode === 'bonus' ? 'bonus' : 'plain';
        this.persist(false);
        this.showScreen('prep', false);
        break;
      case 'survival-start': this.startRun({ mode: 'survival', seed: this.survivalSeed(), bonus: this.save.options.survivalMode === 'bonus' }); break;
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
      case 'cat-bonus':
      case 'cat-prisms':
        if (action === 'cat-prisms') {
          this.prismStore.reset();
          void this.prismStore.loadConfig();
          void this.account.loadProfile();
        }
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
      case 'buy': {
        // Étape de confirmation : rien n'est débité ici. Un article qui n'est plus achetable (solde, déjà possédé) est refusé avec une explication.
        const item = catalogItem(target.dataset.item ?? '');
        if (!item || itemState(this.save, item) !== 'buy') {
          this.shopMessage = { kind: 'error', text: item ? S.purchaseRefusal(this.save, item) : 'Article inconnu : rien n’a été débité.' };
          this.pendingPurchase = null;
          this.showScreen('cosmetics');
          break;
        }
        this.pendingPurchase = item.id;
        this.showScreen('confirm-purchase');
        break;
      }
      case 'confirm-buy': {
        const wanted = catalogItem(target.dataset.item ?? '');
        if (wanted && isPremium(wanted)) {
          void this.confirmPremium(wanted);
          break;
        }
        // Vérification du solde, débit et déblocage dans la même modification, puis une seule écriture. Un article déjà possédé n'est jamais débité
        // (un double clic sur « Confirmer » ne peut donc pas payer deux fois : le second est refusé avec le motif « déjà possédé »).
        const res = purchase(this.save, target.dataset.item ?? '');
        if (res.ok) {
          this.persist();
          this.sfx.play('success');
          this.selectedItem = res.item.id;
          this.shopMessage = { kind: 'ok', text: `Achat effectué : ${res.item.name} (−${formatScore(res.spent)} ${CURRENCY_NAME[res.currency]}). Solde : ${formatScore(res.balance)} ${CURRENCY_NAME[res.currency]}.` };
          void this.account.syncNow(true);
        } else {
          const item = catalogItem(target.dataset.item ?? '');
          this.shopMessage = { kind: 'error', text: item ? S.purchaseRefusal(this.save, item) : 'Article inconnu : rien n’a été débité.' };
        }
        this.pendingPurchase = null;
        this.showScreen('cosmetics');
        break;
      }
      case 'toggle-sound':
        this.save.options.muted = !this.save.options.muted;
        this.applyAudioOptions();
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
      case 'dismiss-save-notice':
        this.saveNoticeDismissed = true;
        this.showScreen('home', false);
        break;
      case 'dismiss-reward-notice':
        this.save.rewardNotice = null;
        this.persist();
        this.showScreen('home', false);
        break;
      case 'ask-reset': this.showScreen('confirm-reset'); break;
      case 'confirm-reset': {
        this.save = resetProgress(this.store, this.save);
        this.save.economy.managed = this.lb.configured;
        this.store.remove(INSTALL_KEY); // remise à zéro volontaire : nouvelle installation
        ensureInstallId(this.save);
        this.persist(false);
        if (this.store.failed === true) this.storageFailed = true;
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
    const kind = el.dataset.input;
    if (kind !== 'volume' && kind !== 'music' && kind !== 'sfx' && kind !== 'visual') return;
    const v = Number(el.value) / 100;
    const o = this.save.options;
    if (kind === 'volume') o.volume = v;
    else if (kind === 'music') o.musicVolume = v;
    else if (kind === 'sfx') o.sfxVolume = v;
    else o.visualIntensity = v;
    this.applyAudioOptions();
    const label = document.getElementById(`${el.id}-val`);
    const pct = `${Math.round(v * 100)} %`;
    if (label) label.textContent = kind === 'visual' ? S.visualIntensityLabel(v) : pct;
    el.style.setProperty('--fill', `${Math.round(v * 100)}%`);
    this.persist();
    // Écoute immédiate : un effet sonore (volume général, effets) ; la musique a son écoute d'essai au relâchement (événement change)
    if (kind === 'volume' || kind === 'sfx') this.sfx.play('collect', 0);
  };

  /** Nouvelle tentative : nouvelle graine (sauf défi, dont la graine est celle du jour). */
  // ————————————————————————————————————————————— classement mondial

  /**
   * Fin d'une partie de Survie : si elle est éligible (graine d'un ticket, aucune aide de test), son journal d'entrées est
   * conservé « en attente » puis envoyé ; le serveur la rejoue et décide. Rien n'est classé tant que le serveur n'a pas validé.
   */
  private afterSurvivalRun(summary: RunSummary, s: GameSession): void {
    this.runLb = { kind: 'hidden' };
    this.runLbTicketId = null;
    // Charges consommées pendant la première vie : tranchées ici (envoyées avec le ticket, ou déclarées comme usage non classé)
    const eco = this.save.economy;
    const live = { ...eco.liveUse };
    eco.liveUse = { boost: 0, gel: 0 };
    const settled = (viaTicket: boolean): void => {
      if (viaTicket) {
        eco.bonusUsed.boost = Math.max(0, eco.bonusUsed.boost - live.boost);
        eco.bonusUsed.gel = Math.max(0, eco.bonusUsed.gel - live.gel);
      }
      this.persist();
    };
    if (!this.lb.configured) return settled(false);
    const first = s.sim.firstLife;
    if (this.devMode || s.sim.assisted || !first) {
      this.runLb = { kind: 'assisted' };
      settled(false);
    } else if (!this.lb.identity()) {
      this.runLb = { kind: 'no-identity' };
      settled(false);
    } else if (!this.runTicket) {
      this.runLb = { kind: 'no-ticket' };
      settled(false);
    } else {
      const ticket = this.runTicket;
      this.runLbTicketId = ticket.id;
      // Journal de la première vie (inversions + activations, en pas de simulation) : le service le REJOUE et déduit lui-même catégorie et durée
      const acts = first.acts.map((a) => [a.step, POWER_CODES[a.kind]] as [number, number]);
      this.lb.recordRun(ticket, { flips: first.flips, acts, category: summary.category }, { time: summary.time, score: summary.score }, live);
      settled(true);
      this.runLb = { kind: 'sending' };
      void this.lb.flush().then((list) => {
        const p = list.find((x) => x.id === ticket.id);
        this.runLb = this.statusOf(p);
        if (p?.result?.drop) {
          // Drop rare confirmé par le service : animation + solde confirmé à la prochaine synchronisation
          this.sfx.play('record');
          if (this.screen === 'result') this.lb.markDropSeen(p.id);
          void this.account.syncNow(true);
        }
        this.refreshRunLbStatus();
        if (p?.needsSync) void this.account.syncNow(true).then(() => this.lb.flush()).then(() => this.refreshRunLbFromPending());
        if (this.screen === 'leaderboard') void this.refreshLeaderboard();
      });
    }
    this.runTicket = null;
  }

  /** Ticket de la partie classée dont le statut est affiché (résultat et écran de reprise). */
  private runLbTicketId: string | null = null;

  /** Rafraîchit le statut mondial de la partie courante depuis la file « en attente » (après un renvoi ou une synchronisation). */
  private refreshRunLbFromPending(): void {
    const id = this.runLbTicketId;
    if (!id) return;
    const p = this.lb.pending().find((x) => x.id === id);
    if (!p) return;
    this.runLb = this.statusOf(p);
    this.refreshRunLbStatus();
  }

  private statusOf(p: PendingRun | undefined): S.RunLbStatus {
    if (!p) return { kind: 'hidden' };
    if (p.status === 'accepted' && p.result) return { kind: 'accepted', rank: p.result.rank, best: p.result.personalBest, category: p.result.category, drop: p.result.drop?.prisms };
    if (p.status === 'rejected') return { kind: 'rejected', message: p.message ?? 'refusé par le serveur' };
    return { kind: 'pending', offline: !!p.lastError };
  }

  /** Met à jour la ligne de statut du résultat sans recréer l'écran (aucun crédit, aucune animation rejouée). */
  private refreshRunLbStatus(): void {
    if (this.screen === 'revive') this.renderRevive();
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
      category: this.lbCategory,
      pending: this.lb.pendingOwn(),
      foreignPending: this.lb.pendingForeign().filter((p) => p.status === 'pending').length,
      nickMessage: this.lbNickMessage,
      localBest: (() => {
        const r = this.lbCategory === 'bonus' ? this.save.survivalBonus : this.save.survival;
        return r.bestTime > 0 ? { time: r.bestTime, score: r.bestScore } : null;
      })(),
      profileLost: this.lbProfileLost,
      confirmDelete: this.lbConfirmDelete,
      reportMessage: this.lbReportMessage,
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
    this.lbConfirmDelete = false;
    this.lbReportMessage = null;
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
    const [top, me, balances] = await Promise.all([this.lb.top(this.lbBalance, this.lbCategory), this.lb.identity() ? this.lb.me(this.lbBalance, this.lbCategory) : Promise.resolve(null), this.lb.balances()]);
    this.lbLoading = false;
    if (top.ok) {
      this.lbTop = top.data;
      this.lbError = null;
    } else {
      this.lbTop = null;
      this.lbError = top.message;
    }
    this.lbMe = me && me.ok ? me.data : null;
    this.lbProfileLost = !!me && !me.ok && me.kind === 'unauthorized';
    this.lbBalances = balances.ok ? balances.data : this.lbBalances;
    this.rerenderLeaderboard();
  }

  private async submitReport(): Promise<void> {
    const input = this.screenEl.querySelector('#report-input') as HTMLInputElement | null;
    const res = await this.lb.report(input?.value ?? '');
    this.lbReportMessage = res.ok ? 'Signalement enregistré. Merci : il sera examiné.' : res.message;
    this.rerenderLeaderboard();
  }

  /** Suppression du profil de classement (le serveur efface tout ; le profil local n'est oublié qu'après confirmation du serveur). */
  private async deleteLeaderboardProfile(): Promise<void> {
    this.lbConfirmDelete = false;
    const res = await this.lb.deleteProfile();
    if (res.ok) {
      this.lbMe = null;
      this.lbProfileLost = false;
      this.lbReportMessage = null;
      this.lbNickMessage = 'Profil supprimé : le service a effacé vos données de classement.';
    } else {
      this.lbReportMessage = res.kind === 'offline' ? 'Suppression impossible hors connexion : réessayez une fois en ligne (rien n’a été effacé).' : res.message;
    }
    this.rerenderLeaderboard();
    if (res.ok) void this.refreshLeaderboard();
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

  /** Achat d'un article premium : requête au service (débit atomique côté service) ; rien n'est débité ni accordé localement avant sa réponse. */
  private async confirmPremium(item: CatalogItem): Promise<void> {
    if (this.purchaseBusy) return;
    this.purchaseBusy = true;
    this.showScreen('confirm-purchase', false);
    const res = await this.account.buyPremium(item.id);
    this.purchaseBusy = false;
    if (res.ok) {
      this.persist();
      this.sfx.play('success');
      this.selectedItem = item.id;
      this.shopMessage = { kind: 'ok', text: res.charged ? `Achat effectué : ${item.name} (−${formatScore(res.price)} Prismes).` : `${item.name} est déjà possédé : aucun Prisme n’a été débité.` };
    } else {
      this.shopMessage = { kind: 'error', text: `${res.message} Rien n’a été débité.` };
    }
    this.pendingPurchase = null;
    if (this.screen === 'confirm-purchase') this.showScreen('cosmetics');
  }

  private persist(schedule = true): void {
    writeSave(this.store, this.save);
    if (this.store.failed === true) this.storageFailed = true;
    // Les gains et achats seront confirmés par le service (regroupés, jamais pendant une partie)
    if (schedule) this.account.scheduleSync();
  }
}

/** `?stade=3` : l'ambiance démarre au début du stade 3 (aperçu visuel ; la partie elle-même n'est pas modifiée). */
function ambiencePreviewOffset(): number {
  const n = Number(new URLSearchParams(location.search).get('stade'));
  return Number.isInteger(n) && n >= 1 && n <= STAGES.length ? STAGES[n - 1].from : 0;
}

/** Le stockage du navigateur accepte-t-il les écritures ? (sonde sur une clé à part ; navigation privée, quota, accès bloqué → non) */
/** Identifiant aléatoire d'une partie (clé d'idempotence du paiement des reprises). */
function randomRunId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function storageWorks(store: KeyValueStore): boolean {
  const key = 'polarite.sonde';
  store.set(key, '1');
  const ok = store.failed !== true && store.get(key) === '1';
  store.remove(key);
  return ok;
}
