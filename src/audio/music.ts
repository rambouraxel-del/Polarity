import { LOOP_ENTRY_OFFSET, MUSIC } from '../config/music';

/**
 * Musique de partie (Web Audio) : intro → boucle → outro.
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
}

type State = 'idle' | 'playing' | 'paused' | 'outro';

/** Morceau en cours de lecture (pour la synchronisation de l'ambiance visuelle). */
export type MusicTrack = 'intro' | 'loop' | 'outro';

/**
 * Position de lecture ENTENDUE (latence de sortie déduite), réutilisable sans allocation.
 * `time` : secondes depuis le début du fichier (intro, outro) ou depuis `loopStart` (boucle).
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

  constructor(
    private readonly host: AudioHost,
    private readonly urls: { intro: string; loop: string; outro: string } = MUSIC.urls,
  ) {}

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
      this.play(ctx, this.pausedPos, ctx.currentTime + MUSIC.startDelay, true);
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
    if (pos < MUSIC.introDuration) {
      out.track = 'intro';
      out.time = pos;
    } else {
      out.track = 'loop';
      out.time = mod(pos - MUSIC.introDuration, MUSIC.loopDuration);
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
    } else {
      const offset = MUSIC.loopStart + mod(pos - I, MUSIC.loopDuration);
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
