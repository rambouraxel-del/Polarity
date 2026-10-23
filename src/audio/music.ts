import { LOOP_ENTRY_OFFSET, MUSIC } from '../config/music';
import { PHASE1_PLAN, PHASE2_MUSIC } from '../config/phases';

/**
 * Musique de partie (Web Audio) : intro → boucle → outro (phase 1), puis musique de la phase 2 en boucle sans trou (après la traversée de la faille).
 *
 * Phase 1 sur cinq minutes : intro, un tour de boucle complet, puis un second tour qui entre dans la boucle à `PHASE1_PLAN.secondPassFrom` (fondu enchaîné
 * en phase) pour que la montée finale tombe sur 300 s. Phase 2 : `enterPhase2()` fond la phase 1 et fait entrer le morceau joint pendant la traversée ;
 * boucle par fondus enchaînés programmés sur l'horloge audio (`maintain()` programme les passes suivantes : aucun minuteur) ; jamais de silence final.
 *
 * - Tous les raccords sont programmés sur l'horloge audio (`start(when, offset)`, rampes de gain) : ni setTimeout, ni événement
 *   `ended`, ni boucle de rendu ne relancent la musique. Un seul nœud `loop = true` couvre tous les tours : une partie d'une heure
 *   ne crée ni nœud ni buffer supplémentaire.
 * - Le contexte et la sortie (volume, sourdine) sont ceux du jeu (audio/sfx.ts) : aucun second moteur audio.
 * - Les buffers sont décodés une seule fois (au premier geste du joueur) puis réutilisés à chaque partie.
 * - Fin de partie (même pendant l'intro) : la musique active est fondue vers l'outro (1,2 s) et le démarrage programmé de la boucle est annulé.
 *   Nouvelle partie pendant l'outro : fondu court, puis intro, sans superposition.
 */

export interface AudioHost {
  context(): BaseAudioContext | null;
  output(): AudioNode | null;
}

export interface MusicBuffers {
  intro?: AudioBuffer;
  loop?: AudioBuffer;
  outro?: AudioBuffer;
  /** Musique de la phase 2 (décodée tardivement, une seule fois). */
  phase2?: AudioBuffer;
}

type State = 'idle' | 'playing' | 'paused' | 'outro';

/** Morceau en cours de lecture (pour la synchronisation de l'ambiance visuelle). */
export type MusicTrack = 'intro' | 'loop' | 'outro' | 'p2';

/**
 * Position de lecture ENTENDUE (latence de sortie déduite), réutilisable sans allocation.
 * `time` : secondes depuis le début du fichier (intro, outro, phase 2) ou depuis `loopStart` (boucle de la phase 1).
 */
export interface MusicPosition {
  track: MusicTrack | null;
  time: number;
  /** Faux en pause (la position est figée) ou sans musique. */
  playing: boolean;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Instant audio programmé du démarrage (une voix pas encore démarrée est simplement annulée). */
  startAt: number;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Durée (s) de l'intro et d'un tour de boucle de la phase 1 : le second tour entre dans la boucle à `PHASE1_PLAN.secondPassFrom`. */
const SECOND_PASS_AT = MUSIC.introDuration + MUSIC.loopDuration;

/** Temps dans la région en boucle de la phase 1 à la position de timeline `pos` (≥ durée de l'intro). */
export function loopTimeAt(pos: number): number {
  const p = pos - MUSIC.introDuration;
  if (pos < SECOND_PASS_AT) return p;
  return mod(PHASE1_PLAN.secondPassFrom + (pos - SECOND_PASS_AT), MUSIC.loopDuration);
}

/** Position dans le FICHIER de phase 2 à la position de timeline `pos` (0 = début de la traversée) : première lecture, puis boucle sans trou. */
export function phase2FilePosition(pos: number): number {
  const { loopStart, loopEnd, loopDuration } = PHASE2_MUSIC;
  return pos < loopEnd ? pos : loopStart + mod(pos - loopEnd, loopDuration);
}

const EQ_STEPS = 48;
/** Courbes de fondu à puissance constante (entrée = sinus, sortie = cosinus). */
const FADE_IN_CURVE = Float32Array.from({ length: EQ_STEPS }, (_, i) => Math.sin(((i / (EQ_STEPS - 1)) * Math.PI) / 2));
const FADE_OUT_CURVE = Float32Array.from({ length: EQ_STEPS }, (_, i) => Math.cos(((i / (EQ_STEPS - 1)) * Math.PI) / 2));

export class Music {
  private buffers: MusicBuffers = {};
  private loading: Promise<void> | null = null;
  private bus: GainNode | null = null;
  private voices: Voice[] = [];
  private state: State = 'idle';
  /** Origine de la timeline musicale (temps du contexte) : position = currentTime − t0. */
  private t0 = 0;
  private pausedPos = 0;
  /** Une partie est en cours (le démarrage attend éventuellement le décodage). */
  private want = false;
  private pausedWhileLoading = false;
  private gen = 0;
  /** Instant audio du démarrage de l'outro en cours. */
  private outroAt = 0;
  /** Mixage de la musique choisi par le joueur (0–1, courbe quadratique) ; le volume général et la sourdine sont ceux de `Sfx`. */
  private level = 1;
  /** Phase 2 en cours : la timeline (`t0`, `pausedPos`) est celle du morceau de phase 2 (0 = début de la traversée). */
  private mode2 = false;
  /** Instant audio où la prochaine passe de boucle de la phase 2 doit démarrer (début du fondu enchaîné). */
  private nextLoopAt = 0;
  /** Second tour de la phase 1 : raccord à programmer (voir `planSecondPass`). */
  private pendingSecond: { at: number; first: Voice; loop: AudioBuffer } | null = null;
  private phase2Loading: Promise<void> | null = null;
  /** Position de la musique au moment de la fin de partie (mort) : une reprise payée repart de là, jamais du début. */
  private stoppedAt: { pos: number; mode2: boolean } | null = null;

  constructor(
    private readonly host: AudioHost,
    private readonly urls: { intro: string; loop: string; outro: string; phase2?: string } = MUSIC.urls,
  ) {}

  /** La musique de phase 2 est-elle décodée ? */
  get phase2Ready(): boolean {
    return !!this.buffers.phase2;
  }

  /** Phase 2 en cours (état exposé pour les tests et le diagnostic). */
  get inPhase2(): boolean {
    return this.mode2;
  }

  /** État courant (tests et diagnostic). */
  get mode(): State {
    return this.state;
  }

  /** Nombre de nœuds de lecture actifs (une partie en cours en a au plus 2 pendant le raccord ; jamais plus). */
  get activeVoices(): number {
    return this.voices.length;
  }

  get ready(): boolean {
    return !!(this.buffers.intro && this.buffers.loop);
  }

  /** Buffers décodés partagés (lecture seule) : le lecteur du voyage des univers réutilise les mêmes, jamais un second décodage. */
  get decoded(): Readonly<MusicBuffers> {
    return this.buffers;
  }

  /** Mixage de la musique choisi par le joueur (0–1). */
  get mixLevel(): number {
    return this.level;
  }

  /** Fournit des buffers déjà décodés (tests). */
  setBuffers(b: MusicBuffers): void {
    this.buffers = { ...this.buffers, ...b };
  }

  // ————————————————————————————————————————————— chargement

  /** Charge et décode les trois fichiers, une seule fois : intro et boucle d'abord, l'outro ensuite (budget mémoire). */
  preload(): Promise<void> {
    if (!this.loading) {
      if (!this.host.context()) return Promise.resolve();
      this.loading = this.loadAll().catch(() => {
        this.loading = null; // nouvel essai à la prochaine partie
      });
    }
    return this.loading;
  }

  /** Charge et décode la musique de phase 2, une seule fois, à la demande (vers 200 s de survie) : le budget mémoire n'est dépensé que pour les parties qui s'en approchent. */
  preloadPhase2(): Promise<void> {
    if (this.buffers.phase2 || !this.urls.phase2) return Promise.resolve();
    if (!this.phase2Loading) {
      if (!this.host.context()) return Promise.resolve();
      const url = this.urls.phase2;
      this.phase2Loading = (async () => {
        const ctx = this.host.context();
        if (!ctx) throw new Error('contexte audio indisponible');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`phase2: HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        this.buffers.phase2 = await new Promise<AudioBuffer>((resolve, reject) => {
          const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
          p?.catch?.(() => undefined);
        });
      })().catch(() => {
        this.phase2Loading = null; // nouvel essai plus tard
      });
    }
    return this.phase2Loading;
  }

  private async loadAll(): Promise<void> {
    for (const key of ['intro', 'loop', 'outro'] as const) {
      if (this.buffers[key]) continue;
      const ctx = this.host.context();
      if (!ctx) throw new Error('contexte audio indisponible');
      const res = await fetch(this.urls[key]);
      if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      this.buffers[key] = await new Promise<AudioBuffer>((resolve, reject) => {
        // Forme à rappels : compatible avec les anciens Safari ; la promesse éventuellement renvoyée est absorbée
        const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
        p?.catch?.(() => undefined);
      });
    }
  }

  // ————————————————————————————————————————————— cycle de la partie

  /** Début de partie : intro, puis boucle. Interrompt proprement toute musique en cours (outro comprise). */
  startGame(): void {
    const ctx = this.host.context();
    if (!ctx) return;
    this.want = true;
    this.mode2 = false;
    this.stoppedAt = null;
    this.pausedWhileLoading = false;
    const g = ++this.gen;
    const hadVoices = this.voices.length > 0;
    if (hadVoices) this.fadeOutVoices(ctx, MUSIC.restartFade);
    this.state = 'idle';
    const begin = (): void => {
      if (!this.want || g !== this.gen || !this.ready) return;
      if (this.pausedWhileLoading) {
        this.pausedWhileLoading = false;
        this.pausedPos = 0;
        this.state = 'paused';
        return;
      }
      const at = ctx.currentTime + (hadVoices ? MUSIC.restartFade + 0.02 : MUSIC.startDelay);
      this.play(ctx, 0, at, false);
    };
    if (this.ready) begin();
    else void this.preload().then(begin);
  }

  /** Pause de la partie : la musique s'arrête avec un fondu bref et reprend au même endroit. */
  pause(): void {
    const ctx = this.host.context();
    if (!ctx) return;
    if (this.state === 'playing') {
      this.pausedPos = Math.max(0, ctx.currentTime - this.t0);
      this.fadeOutVoices(ctx, MUSIC.pauseFade);
      this.state = 'paused';
    } else if (this.state === 'idle' && this.want) {
      this.pausedWhileLoading = true;
    }
  }

  /** Reprise de la partie : la musique repart de sa position (même raccord intro → boucle si on était dans l'intro). */
  resume(): void {
    const ctx = this.host.context();
    if (!ctx) return;
    if (this.state === 'paused') {
      if (this.mode2) this.play2(ctx, this.pausedPos, ctx.currentTime + MUSIC.startDelay, true);
      else this.play(ctx, this.pausedPos, ctx.currentTime + MUSIC.startDelay, true);
    } else if (this.pausedWhileLoading) {
      this.pausedWhileLoading = false;
    }
  }

  /** Fin de partie : fondu de la musique active (1,2 s) vers l'outro ; le démarrage programmé de la boucle est annulé. N'attend jamais un tour de boucle. */
  endGame(): void {
    const ctx = this.host.context();
    this.want = false;
    this.pausedWhileLoading = false;
    this.gen++; // annule un démarrage en attente de décodage
    if (!ctx) return;
    if (this.state !== 'playing' && this.state !== 'paused') return;
    // Mémorise où la musique s'est arrêtée : une reprise (2ᵉ ou 3ᵉ vie) repart de cet endroit
    this.stoppedAt = { pos: this.state === 'paused' ? this.pausedPos : Math.max(0, ctx.currentTime - this.t0), mode2: this.mode2 };
    if (this.mode2) {
      // Phase 2 : fondu sortant (l'outro de la phase 1 est un autre morceau), jamais d'attente d'un tour de boucle
      this.fadeOutVoices(ctx, PHASE2_MUSIC.endFade);
      this.state = 'idle';
      this.mode2 = false;
      return;
    }
    this.fadeOutVoices(ctx, MUSIC.outroCrossfade);
    const outro = this.buffers.outro;
    if (!outro) {
      this.state = 'idle';
      return;
    }
    // L'outro entre en fondu pendant que la musique active sort : un seul morceau audible à la fin
    const now = ctx.currentTime;
    const v = this.voice(ctx, outro, 0);
    v.gain.gain.setValueAtTime(0, now);
    v.gain.gain.linearRampToValueAtTime(1, now + MUSIC.outroCrossfade);
    v.startAt = now;
    v.src.start(now);
    this.outroAt = now;
    this.state = 'outro';
    const g = this.gen;
    v.src.onended = () => {
      this.release(v);
      if (g === this.gen && this.state === 'outro' && this.voices.length === 0) this.state = 'idle';
    };
  }

  /** Partie quittée sans résultat (retour au menu) : fondu, sans outro. */
  stop(): void {
    const ctx = this.host.context();
    this.want = false;
    this.stoppedAt = null;
    this.pausedWhileLoading = false;
    this.gen++;
    if (!ctx) return;
    if (this.voices.length > 0) this.fadeOutVoices(ctx, MUSIC.quitFade);
    this.state = 'idle';
  }

  /**
   * Écoute d'essai du mixage (réglage « Musique » des options, hors partie) : 2,5 s de la boucle, en fondu, sur le même bus que la partie.
   * Sans effet pendant une partie (la musique y est déjà audible) ou tant que la musique n'est pas décodée.
   */
  audition(): void {
    const ctx = this.host.context();
    const loop = this.buffers.loop;
    if (!ctx || !loop || this.state !== 'idle' || this.want) return;
    if (this.voices.length > 0) this.fadeOutVoices(ctx, 0.05);
    const v = this.voice(ctx, loop, 0);
    const now = ctx.currentTime + 0.02;
    const len = MUSIC.auditionSeconds;
    v.gain.gain.setValueAtTime(0, now);
    v.gain.gain.linearRampToValueAtTime(1, now + 0.15);
    v.gain.gain.setValueAtTime(1, now + len - 0.3);
    v.gain.gain.linearRampToValueAtTime(0, now + len);
    v.startAt = now;
    v.src.start(now, MUSIC.loopStart + MUSIC.auditionFrom);
    v.src.stop(now + len + 0.02);
  }

  // ————————————————————————————————————————————— position de lecture (ambiance visuelle)

  /**
   * Instant audio ENTENDU maintenant : horodatage de sortie du contexte quand il existe (Chrome, Firefox, Safari récents),
   * sinon horloge du contexte moins la latence annoncée. Calculé à chaque appel depuis l'horloge audio : aucun décalage cumulatif.
   */
  private heardTime(ctx: BaseAudioContext): number {
    const ac = ctx as AudioContext;
    if (typeof ac.getOutputTimestamp === 'function') {
      const ts = ac.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        return Math.min(ctx.currentTime, t);
      }
    }
    return ctx.currentTime - (ac.outputLatency || ac.baseLatency || 0);
  }

  /**
   * Remplit `out` avec la position de lecture entendue : intro (une fois), puis boucle (temps dans la région en boucle),
   * outro après la fin de partie. Pause : position figée. Aucune musique (non décodée, pas de contexte) : `track = null`.
   */
  position(out: MusicPosition): MusicPosition {
    const ctx = this.host.context();
    out.track = null;
    out.time = 0;
    out.playing = false;
    if (!ctx) return out;
    // Contexte suspendu ou interrompu (arrière-plan, appel sur iPhone) : l'horloge audio est figée, rien n'est entendu
    const st = (ctx as AudioContext).state as string | undefined;
    const running = st === undefined || st === 'running';
    if (this.state === 'outro') {
      const t = this.heardTime(ctx) - this.outroAt;
      if (t >= 0) {
        out.track = 'outro';
        out.time = t;
        out.playing = running;
      }
      return out;
    }
    let pos: number;
    if (this.state === 'playing') pos = this.heardTime(ctx) - this.t0;
    else if (this.state === 'paused') pos = this.pausedPos;
    else return out;
    if (pos < 0) return out; // démarrage programmé, pas encore entendu
    out.playing = this.state === 'playing' && running;
    if (this.mode2) {
      out.track = 'p2';
      out.time = phase2FilePosition(pos);
    } else if (pos < MUSIC.introDuration) {
      out.track = 'intro';
      out.time = pos;
    } else {
      out.track = 'loop';
      out.time = loopTimeAt(pos);
    }
    return out;
  }

  // ————————————————————————————————————————————— programmation (horloge audio)

  /**
   * Programme la lecture à partir de la position `pos` (s) de la timeline musicale, à l'instant audio `at`.
   * Dans l'intro : intro + boucle entrante (démarrée 20 ms avant la fin de l'intro, offset 0,100 s) avec rampes de gain complémentaires.
   * Dans la boucle : un seul nœud, offset dans la région en boucle.
   */
  private play(ctx: BaseAudioContext, pos: number, at: number, fadeIn: boolean): void {
    const { intro, loop } = this.buffers;
    if (!intro || !loop) return;
    const I = MUSIC.introDuration;
    const X = MUSIC.introCrossfade;
    const t0 = at - pos;
    this.t0 = t0;
    this.state = 'playing';
    const fin = fadeIn ? 0.05 : 0;

    if (pos < I - X) {
      // Intro (une seule fois)
      const iv = this.voice(ctx, intro, fadeIn ? 0 : 1);
      if (fadeIn) {
        iv.gain.gain.setValueAtTime(0, at);
        iv.gain.gain.linearRampToValueAtTime(1, at + fin);
      }
      iv.startAt = at;
      iv.src.start(at, pos);
      iv.src.stop(t0 + I);
      iv.gain.gain.setValueAtTime(1, t0 + I - X);
      iv.gain.gain.linearRampToValueAtTime(0, t0 + I);
      // Boucle : programmée sur l'horloge audio, dans sa garde, jamais par un minuteur
      const lv = this.voice(ctx, loop, 0);
      lv.src.loop = true;
      lv.src.loopStart = MUSIC.loopStart;
      lv.src.loopEnd = MUSIC.loopEnd;
      lv.gain.gain.setValueAtTime(0, t0 + I - X);
      lv.gain.gain.linearRampToValueAtTime(1, t0 + I);
      lv.startAt = t0 + I - X;
      lv.src.start(t0 + I - X, LOOP_ENTRY_OFFSET);
      this.planSecondPass(ctx, t0, lv, loop);
    } else {
      const offset = MUSIC.loopStart + loopTimeAt(pos);
      const lv = this.voice(ctx, loop, fadeIn ? 0 : 1);
      lv.src.loop = true;
      lv.src.loopStart = MUSIC.loopStart;
      lv.src.loopEnd = MUSIC.loopEnd;
      if (fadeIn) {
        lv.gain.gain.setValueAtTime(0, at);
        lv.gain.gain.linearRampToValueAtTime(1, at + fin);
      }
      lv.startAt = at;
      lv.src.start(at, offset);
      // Premier tour de boucle : le second tour entrera dans la boucle à `secondPassFrom` (fondu enchaîné en phase)
      if (pos < SECOND_PASS_AT - PHASE1_PLAN.crossfade) this.planSecondPass(ctx, t0, lv, loop);
    }
  }

  /**
   * Séquence de cinq minutes (phase 1) : à la fin du premier tour de boucle, la voix de boucle sort en fondu pendant qu'une seconde voix entre dans la
   * boucle à `PHASE1_PLAN.secondPassFrom` (calé sur un battement), puis boucle seule. Tout est programmé sur l'horloge audio.
   */
  private planSecondPass(ctx: BaseAudioContext, t0: number, first: Voice, loop: AudioBuffer): void {
    const at = t0 + SECOND_PASS_AT - PHASE1_PLAN.crossfade;
    if (at <= ctx.currentTime + 0.01) return;
    // Programmation tardive (quelques secondes avant le raccord, par `maintain()`) : une partie courte ne crée jamais ce nœud
    this.pendingSecond = { at, first, loop };
  }

  private scheduleSecondPass(ctx: BaseAudioContext): void {
    const pend = this.pendingSecond;
    if (!pend || ctx.currentTime < pend.at - 4) return;
    this.pendingSecond = null;
    const { at, first, loop } = pend;
    const X = PHASE1_PLAN.crossfade;
    if (!this.voices.includes(first)) return; // la voix a été arrêtée entre-temps (pause, fin de partie)
    first.gain.gain.setValueAtTime(1, at);
    first.gain.gain.linearRampToValueAtTime(0, at + X);
    first.src.stop(at + X + 0.02);
    const second = this.voice(ctx, loop, 0);
    second.src.loop = true;
    second.src.loopStart = MUSIC.loopStart;
    second.src.loopEnd = MUSIC.loopEnd;
    second.gain.gain.setValueAtTime(0, at);
    second.gain.gain.linearRampToValueAtTime(1, at + X);
    second.startAt = at;
    second.src.start(at, MUSIC.loopStart + PHASE1_PLAN.secondPassFrom - X);
  }

  // ————————————————————————————————————————————— phase 2

  /**
   * Traversée de la faille : la musique de phase 1 sort en fondu progressif (`fadeOut`) et le morceau de phase 2 entre pendant toute la traversée
   * (`fadeIn`). Sans musique de phase 2 décodée, la phase 1 continue de jouer (jamais de silence imposé). Renvoie vrai si la bascule a eu lieu.
   */
  enterPhase2(): boolean {
    const ctx = this.host.context();
    if (!ctx || !this.buffers.phase2 || this.mode2) return false;
    if (this.state !== 'playing' && this.state !== 'paused') return false;
    if (this.state === 'playing') {
      this.fadeOutVoices(ctx, PHASE2_MUSIC.fadeOut);
      this.mode2 = true;
      this.play2(ctx, 0, ctx.currentTime + 0.03, false);
    } else {
      // Pause au moment exact de la traversée : la phase 2 démarrera à la reprise
      this.mode2 = true;
      this.pausedPos = 0;
    }
    return true;
  }

  /**
   * Reprise (deuxième ou troisième vie) : la musique repart EXACTEMENT là où elle s'était arrêtée à la mort (même morceau, même position : intro, boucle,
   * ou phase 2), avec un court fondu entrant ; l'outro en cours est coupée. Faux si aucune position n'est mémorisée ou si le morceau n'est pas décodé.
   */
  resumeAfterDeath(): boolean {
    const ctx = this.host.context();
    const saved = this.stoppedAt;
    if (!ctx || !saved) return false;
    if (saved.mode2 ? !this.buffers.phase2 : !this.ready) return false;
    this.stoppedAt = null;
    this.want = true;
    this.pausedWhileLoading = false;
    this.gen++;
    if (this.voices.length > 0) this.fadeOutVoices(ctx, MUSIC.restartFade);
    const at = ctx.currentTime + MUSIC.restartFade + 0.02;
    this.mode2 = saved.mode2;
    if (saved.mode2) this.play2(ctx, saved.pos, at, true);
    else this.play(ctx, saved.pos, at, true);
    return true;
  }

  /** Reprise (deuxième ou troisième vie) en phase 2 sans position mémorisée : la musique de phase 2 repart dans sa boucle (jamais l'intro de la phase 1). Faux si non décodée. */
  startPhase2Loop(): boolean {
    const ctx = this.host.context();
    if (!ctx || !this.buffers.phase2) return false;
    this.want = true;
    this.pausedWhileLoading = false;
    this.gen++;
    if (this.voices.length > 0) this.fadeOutVoices(ctx, MUSIC.restartFade);
    this.mode2 = true;
    this.play2(ctx, PHASE2_MUSIC.loopEnd, ctx.currentTime + MUSIC.restartFade + 0.02, true);
    return true;
  }

  /**
   * Programme la lecture du morceau de phase 2 à partir de la position `pos` (s depuis le début de la traversée) à l'instant audio `at`.
   * Première lecture : du début du fichier jusqu'à `loopEnd`, puis boucle par fondus enchaînés à puissance constante, en phase (la durée de boucle est un
   * nombre entier de temps) : la voix suivante démarre à `loopStart − crossfade` pendant que la précédente finit sa passe. `maintain()` ajoute les passes.
   */
  private play2(ctx: BaseAudioContext, pos: number, at: number, resume: boolean): void {
    const buf = this.buffers.phase2;
    if (!buf) return;
    const { loopStart, loopEnd, crossfade: X, fadeIn } = PHASE2_MUSIC;
    this.t0 = at - pos;
    this.state = 'playing';
    // Position dans le fichier ; au-delà de la fin de la région en boucle (ou dans la zone de raccord), on reprend au début de la boucle
    let offset = phase2FilePosition(pos);
    if (pos >= loopEnd && loopEnd - offset < X + 0.5) offset = loopStart;
    const gainStart = pos < fadeIn ? pos / fadeIn : 1;
    const v = this.voice(ctx, buf, resume ? 0 : gainStart);
    const p = v.gain.gain;
    if (pos < fadeIn) {
      p.setValueAtTime(gainStart, at);
      p.linearRampToValueAtTime(1, at + (fadeIn - pos));
    } else if (resume) {
      p.setValueAtTime(0, at);
      p.linearRampToValueAtTime(1, at + 0.05);
    }
    v.startAt = at;
    v.src.start(at, offset);
    // Fin de cette voix : elle atteint `loopEnd` dans `loopEnd − offset` secondes
    const endAt = at + (loopEnd - offset);
    this.fadeVoiceOut(v, endAt - X, X);
    v.src.stop(endAt + 0.02);
    this.nextLoopAt = endAt - X;
    this.maintain();
  }

  /** Fondu sortant à puissance constante de la voix, de `from` pendant `dur` secondes. */
  private fadeVoiceOut(v: Voice, from: number, dur: number): void {
    const p = v.gain.gain;
    if (typeof p.setValueCurveAtTime === 'function') p.setValueCurveAtTime(FADE_OUT_CURVE, from, dur);
    else {
      p.setValueAtTime(1, from);
      p.linearRampToValueAtTime(0, from + dur);
    }
  }

  /**
   * Programme les passes de boucle de la phase 2 à venir (deux passes d'avance au moins). À appeler à chaque image : sans effet hors phase 2 ou quand tout
   * est déjà programmé. Pas de minuteur : c'est la boucle de rendu qui tient la programmation à jour, sur l'horloge audio.
   */
  maintain(): void {
    const ctx = this.host.context();
    if (ctx && this.state === 'playing' && !this.mode2) this.scheduleSecondPass(ctx);
    const buf = this.buffers.phase2;
    if (!ctx || !buf || !this.mode2 || this.state !== 'playing') return;
    const { loopStart, loopDuration: L, crossfade: X } = PHASE2_MUSIC;
    let guard = 0;
    while (this.nextLoopAt < ctx.currentTime + 2 * L && guard++ < 16) {
      const at = this.nextLoopAt;
      const v = this.voice(ctx, buf, 0);
      const p = v.gain.gain;
      if (typeof p.setValueCurveAtTime === 'function') p.setValueCurveAtTime(FADE_IN_CURVE, at, X);
      else {
        p.setValueAtTime(0, at);
        p.linearRampToValueAtTime(1, at + X);
      }
      v.startAt = at;
      v.src.start(at, loopStart - X);
      // Cette voix finit sa passe `L + X` secondes plus tard ; la suivante démarre `L` secondes après celle-ci
      this.fadeVoiceOut(v, at + L, X);
      v.src.stop(at + L + X + 0.02);
      this.nextLoopAt = at + L;
    }
  }

  /** Mixage de la musique (0–1) : s'applique tout de suite, sans coupure (rampe de 10 ms). */
  setLevel(v: number): void {
    this.level = Math.min(1, Math.max(0, v));
    const ctx = this.host.context();
    if (this.bus && ctx) this.bus.gain.setTargetAtTime(this.busGain(), ctx.currentTime, 0.01);
  }

  private busGain(): number {
    return MUSIC.gain * this.level * this.level;
  }

  private ensureBus(ctx: BaseAudioContext): GainNode | null {
    if (this.bus) return this.bus;
    const out = this.host.output();
    if (!out) return null;
    const bus = ctx.createGain();
    bus.gain.value = this.busGain();
    bus.connect(out);
    this.bus = bus;
    return bus;
  }

  private voice(ctx: BaseAudioContext, buffer: AudioBuffer, initialGain: number): Voice {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = initialGain;
    src.connect(gain);
    const bus = this.ensureBus(ctx);
    if (bus) gain.connect(bus);
    const v: Voice = { src, gain, startAt: 0 };
    src.onended = () => this.release(v);
    this.voices.push(v);
    return v;
  }

  private release(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try {
      v.src.disconnect();
      v.gain.disconnect();
    } catch {
      /* déjà déconnecté */
    }
  }

  /** Fondu de toutes les voix actives (y compris une boucle programmée mais pas encore démarrée), puis arrêt. */
  private fadeOutVoices(ctx: BaseAudioContext, dur: number): void {
    this.pendingSecond = null;
    const now = ctx.currentTime;
    const list = this.voices.slice();
    for (const v of list) {
      // Voix programmée mais pas encore démarrée (boucle d'une partie perdue pendant l'intro) : annulée et libérée tout de suite
      if (v.startAt > now) {
        try {
          v.src.stop(now);
        } catch {
          /* ignoré */
        }
        this.release(v);
        continue;
      }
      const p = v.gain.gain;
      try {
        // Fige le gain à sa valeur courante (rampe de raccord en cours comprise), puis fondu vers 0
        if (typeof p.cancelAndHoldAtTime === 'function') {
          p.cancelAndHoldAtTime(now);
        } else {
          const cur = p.value;
          p.cancelScheduledValues(now);
          p.setValueAtTime(cur, now);
        }
        p.linearRampToValueAtTime(0, now + dur);
        v.src.stop(now + dur + 0.02);
      } catch {
        /* nœud déjà arrêté */
      }
    }
    // Les nœuds sont libérés à leur arrêt (`onended`, nettoyage seulement) ; l'état courant ne les compte plus
    this.voices = this.voices.filter((v) => !list.includes(v));
  }
}
