import { MUSIC } from '../config/music';
import { PHASE2_MUSIC } from '../config/phases';
import { WORLD1_PLAN, WORLD_MUSIC, WORLD_TRANSITION_AUDIO as TA, type PadId } from '../config/worldMusic';
import { WORLD2_PLAN, WORLD2_START } from '../config/world2';
import { WORLDS } from '../config/worlds';
import type { AudioHost, MusicBuffers, MusicPosition } from './music';

/**
 * Musique du VOYAGE DES UNIVERS (Web Audio). Même contexte, même sortie (volume général, sourdine) et mêmes buffers décodés que `Music` :
 * aucun second moteur, aucun second décodage. Chaque univers joue sur sa « platine » (gain → filtre passe-bas → bus de la musique) :
 *   - univers 1 : intro, puis la région en boucle reprise à `WORLD1_PLAN.loopEntry` (montage de 120 s, raccord en fondu court) ;
 *   - univers 2 « La Faille » : morceau « Portal Surge » monté sur 120 s (une phrase de trois mesures répétée, raccord sur deux battements réels, fondu de quelques
 *     dizaines de ms) ; il démarre pendant la transition d'entrée et son dernier coup sec tombe sur l'ouverture de la faille de sortie (`config/world2.ts`) ;
 *   - univers 3 et 4 : pas encore de morceau → fond atmosphérique procédural discret (ou silence), jamais de battement inventé.
 * Transition (4 s) : l'ancienne platine se ferme (filtre + gain) pendant que la nouvelle entre filtrée puis s'ouvre ; tout est programmé sur l'horloge
 * audio (aucun minuteur). Pause : position mémorisée et tout s'arrête ; reprise au même endroit.
 */

interface Deck {
  world: number;
  gain: GainNode;
  filter: BiquadFilterNode;
  nodes: AudioScheduledSourceNode[];
  /** Origine de la timeline de la platine (temps audio) : position = currentTime − t0. */
  t0: number;
  /** Le morceau est un fond procédural (aucune position musicale). */
  pad: boolean;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const OPEN = 18000;

export class WorldMusic {
  private bus: GainNode | null = null;
  private decks: Deck[] = [];
  private current: Deck | null = null;
  private state: 'idle' | 'playing' | 'paused' = 'idle';
  private world = 1;
  private pausedPos = 0;
  private stoppedAt: { world: number; pos: number } | null = null;
  private noise: AudioBuffer | null = null;
  private level = 1;

  constructor(
    private readonly host: AudioHost,
    private readonly buffers: () => Readonly<MusicBuffers>,
  ) {}

  get playing(): boolean {
    return this.state === 'playing';
  }

  /** Univers dont la musique est en cours (diagnostic). */
  get currentWorld(): number {
    return this.world;
  }

  /** Nombre de platines actives (une seule hors transition, deux au plus pendant). */
  get activeDecks(): number {
    return this.decks.length;
  }

  setLevel(v: number): void {
    this.level = Math.min(1, Math.max(0, v));
    const ctx = this.host.context();
    if (this.bus && ctx) this.bus.gain.setTargetAtTime(MUSIC.gain * this.level * this.level, ctx.currentTime, 0.01);
  }

  // ————————————————————————— cycle de la partie

  /**
   * Démarre la musique de l'univers `world` au temps de jeu LOCAL `local` (0 = début de l'univers). Pour les univers suivants, la position de la platine
   * compte aussi la transition d'entrée (qui précède le temps local 0). Sert au départ de partie et à la resynchronisation des sauts de test (fenêtre DEV).
   */
  startGame(world = 1, local = 0): void {
    const ctx = this.host.context();
    if (!ctx) return;
    this.stoppedAt = null;
    this.fadeAll(ctx, MUSIC.restartFade);
    this.world = world;
    this.state = 'playing';
    this.current = this.play(ctx, world, local + (world > 1 ? WORLDS.transition : 0), ctx.currentTime + MUSIC.restartFade + 0.02, 0.05);
  }

  /** Début de la transition vers l'univers `to` : l'ancienne platine se ferme, la nouvelle entre filtrée et s'ouvre à l'arrivée. */
  transition(to: number): void {
    const ctx = this.host.context();
    this.world = to;
    if (!ctx || this.state !== 'playing') {
      if (this.state === 'paused') this.pausedPos = 0;
      return;
    }
    const now = ctx.currentTime;
    for (const d of this.decks) this.closeDeck(d, now, TA.fadeOut);
    this.decks = [];
    const startAt = now + TA.fadeInFrom;
    const deck = this.play(ctx, to, TA.fadeInFrom, startAt, 0, now);
    if (!deck) return;
    const g = deck.gain.gain;
    const target = WORLD_MUSIC[to]?.gain ?? 1;
    g.setValueAtTime(0, startAt);
    g.linearRampToValueAtTime(target, now + WORLDS.transition);
    deck.filter.frequency.setValueAtTime(TA.filterFrom, startAt);
    deck.filter.frequency.exponentialRampToValueAtTime(OPEN, now + WORLDS.transition);
    this.current = deck;
  }

  pause(): void {
    const ctx = this.host.context();
    if (!ctx || this.state !== 'playing') return;
    this.pausedPos = this.current ? Math.max(0, ctx.currentTime - this.current.t0) : 0;
    this.fadeAll(ctx, MUSIC.pauseFade);
    this.state = 'paused';
  }

  resume(): void {
    const ctx = this.host.context();
    if (!ctx || this.state !== 'paused') return;
    this.state = 'playing';
    this.current = this.play(ctx, this.world, this.pausedPos, ctx.currentTime + MUSIC.startDelay, 0.05);
  }

  endGame(): void {
    const ctx = this.host.context();
    if (!ctx || this.state === 'idle') return;
    this.stoppedAt = { world: this.world, pos: this.state === 'paused' ? this.pausedPos : this.current ? Math.max(0, ctx.currentTime - this.current.t0) : 0 };
    this.fadeAll(ctx, PHASE2_MUSIC.endFade);
    this.state = 'idle';
  }

  stop(): void {
    const ctx = this.host.context();
    this.stoppedAt = null;
    if (ctx) this.fadeAll(ctx, MUSIC.quitFade);
    this.state = 'idle';
  }

  /** Reprise (deuxième ou troisième vie) : repart là où la musique s'était arrêtée. */
  resumeAfterDeath(): boolean {
    const ctx = this.host.context();
    const s = this.stoppedAt;
    if (!ctx || !s) return false;
    this.stoppedAt = null;
    this.world = s.world;
    this.state = 'playing';
    this.fadeAll(ctx, MUSIC.restartFade);
    this.current = this.play(ctx, s.world, s.pos, ctx.currentTime + MUSIC.restartFade + 0.02, 0.05);
    return true;
  }

  /** Position ENTENDUE (pour l'ambiance) : univers 1 = intro/boucle, univers 2 = temps du montage de « Portal Surge » ; fonds procéduraux = aucune position. */
  position(out: MusicPosition): MusicPosition {
    out.track = null;
    out.time = 0;
    out.playing = false;
    const ctx = this.host.context();
    const d = this.current;
    if (!ctx || this.state === 'idle') return out;
    // En pause, la platine est fermée : la position mémorisée fait foi (reprise au même endroit)
    const paused = this.state === 'paused';
    if (!paused && (!d || d.pad)) return out;
    const ac = ctx as AudioContext;
    const st = ac.state as string | undefined;
    const heard = ctx.currentTime - (ac.outputLatency || ac.baseLatency || 0);
    const pos = paused ? this.pausedPos : heard - (d as Deck).t0;
    if (pos < 0) return out;
    out.playing = !paused && (st === undefined || st === 'running');
    const track = WORLD_MUSIC[paused ? this.world : (d as Deck).world]?.track;
    if (track === 'phase1') {
      if (pos < MUSIC.introDuration) {
        out.track = 'intro';
        out.time = pos;
      } else {
        out.track = 'loop';
        out.time = mod(WORLD1_PLAN.loopEntry + (pos - MUSIC.introDuration), MUSIC.loopDuration);
      }
    } else if (track === 'world2') {
      // Temps du montage (monotone : la phrase répétée est déjà dépliée dans la carte musicale) ; avant la première note et après la queue : aucune musique
      const m = pos - WORLD2_START;
      if (m >= 0 && m <= WORLD2_PLAN.duration) {
        out.track = 'w2';
        out.time = m;
      } else out.playing = false;
    }
    return out;
  }

  // ————————————————————————— platines

  private ensureBus(ctx: BaseAudioContext): GainNode | null {
    if (this.bus) return this.bus;
    const out = this.host.output();
    if (!out) return null;
    this.bus = ctx.createGain();
    this.bus.gain.value = MUSIC.gain * this.level * this.level;
    this.bus.connect(out);
    return this.bus;
  }

  /**
   * Lance l'univers `world` à la position `pos` de sa timeline, à l'instant audio `at` (fondu d'entrée `fade` s ; 0 = gain piloté par l'appelant).
   * `origin` : instant audio où la position vaut 0 (par défaut at − pos).
   */
  private play(ctx: BaseAudioContext, world: number, pos: number, at: number, fade: number, origin = at - pos): Deck | null {
    const def = WORLD_MUSIC[world];
    const bus = this.ensureBus(ctx);
    if (!def || !bus) return null;
    const b = this.buffers();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = OPEN;
    gain.connect(filter);
    filter.connect(bus);
    const deck: Deck = { world, gain, filter, nodes: [], t0: origin, pad: def.track === null };
    const target = def.gain;
    gain.gain.setValueAtTime(fade > 0 ? 0 : target, at);
    if (fade > 0) gain.gain.linearRampToValueAtTime(target, at + fade);
    if (def.track === 'phase1' && b.intro && b.loop) this.playWorld1(ctx, deck, b.intro, b.loop, pos, at);
    else if (def.track === 'world2' && b.world2) this.playMontage(ctx, deck, b.world2, pos, at);
    else if (def.track === null && def.pad) this.playPad(ctx, deck, def.pad, at);
    else {
      // Morceau pas encore décodé : silence (jamais de faux battement), la platine reste disponible pour la suite
      deck.pad = true;
    }
    this.decks.push(deck);
    return deck;
  }

  private source(ctx: BaseAudioContext, deck: Deck, buf: AudioBuffer, g0: number): { src: AudioBufferSourceNode; g: GainNode } {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = g0;
    src.connect(g);
    g.connect(deck.gain);
    deck.nodes.push(src);
    return { src, g };
  }

  /** Univers 1 : intro puis boucle reprise à `loopEntry` (raccord en fondu court), ou directement dans la boucle. */
  private playWorld1(ctx: BaseAudioContext, deck: Deck, intro: AudioBuffer, loop: AudioBuffer, pos: number, at: number): void {
    const I = MUSIC.introDuration;
    const X = WORLD1_PLAN.crossfade;
    const t0 = at - pos;
    if (pos < I - X) {
      const iv = this.source(ctx, deck, intro, 1);
      iv.src.start(at, pos);
      iv.g.gain.setValueAtTime(1, t0 + I - X);
      iv.g.gain.linearRampToValueAtTime(0, t0 + I);
      iv.src.stop(t0 + I + 0.02);
      const lv = this.source(ctx, deck, loop, 0);
      lv.src.loop = true;
      lv.src.loopStart = MUSIC.loopStart;
      lv.src.loopEnd = MUSIC.loopEnd;
      lv.g.gain.setValueAtTime(0, t0 + I - X);
      lv.g.gain.linearRampToValueAtTime(1, t0 + I);
      lv.src.start(t0 + I - X, MUSIC.loopStart + WORLD1_PLAN.loopEntry - X);
    } else {
      const lv = this.source(ctx, deck, loop, 1);
      lv.src.loop = true;
      lv.src.loopStart = MUSIC.loopStart;
      lv.src.loopEnd = MUSIC.loopEnd;
      lv.src.start(at, MUSIC.loopStart + mod(WORLD1_PLAN.loopEntry + (pos - I), MUSIC.loopDuration));
    }
  }

  /**
   * Univers 2 : lecture du montage (`WORLD2_PLAN`) à partir de la position de platine `pos` (s depuis le début de la transition d'entrée), à l'instant audio `at`.
   * Chaque segment est une voix ; au raccord, la voix suivante entre pendant `crossfade` s pendant que la précédente sort (même phase de battement, fondu terminé
   * AVANT l'attaque du battement de raccord). Tout est programmé d'un coup sur l'horloge audio : aucun minuteur, aucun événement `ended`.
   */
  private playMontage(ctx: BaseAudioContext, deck: Deck, buf: AudioBuffer, pos: number, at: number): void {
    const { segments, crossfade: xf } = WORLD2_PLAN;
    const m = pos - WORLD2_START; // instant du montage entendu à `at` (négatif : la musique n'a pas encore commencé)
    // Segment courant : le dernier dont le fondu d'entrée a déjà commencé (une reprise au milieu d'un raccord entre directement dans la voix suivante)
    let first = 0;
    for (let k = 1; k < segments.length; k++) if (m >= segments[k].at - xf) first = k;
    for (let k = first; k < segments.length; k++) {
      const seg = segments[k];
      const last = k === segments.length - 1;
      const startM = k === first ? Math.max(m, seg.at) : seg.at - xf;
      const offset = seg.from + (startM - seg.at);
      const when = at + (startM - m);
      const v = this.source(ctx, deck, buf, k === first ? 1 : 0);
      v.src.start(when, Math.max(0, offset));
      if (k !== first) {
        v.g.gain.setValueAtTime(0, when);
        v.g.gain.linearRampToValueAtTime(1, when + xf);
      }
      if (!last) {
        const endAt = at + (segments[k + 1].at - m);
        v.g.gain.setValueAtTime(1, endAt - xf);
        v.g.gain.linearRampToValueAtTime(0, endAt);
        v.src.stop(endAt + 0.02);
      }
    }
  }

  /** Fond atmosphérique procédural (aucun battement) : nappe tenue + souffle filtré, modulés très lentement. */
  private playPad(ctx: BaseAudioContext, deck: Deck, pad: PadId, at: number): void {
    const voice = (type: OscillatorType, f: number, gain: number, cutoff: number): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(lp);
      lp.connect(g);
      g.connect(deck.gain);
      // Respiration lente du filtre
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.05;
      const depth = ctx.createGain();
      depth.gain.value = cutoff * 0.35;
      lfo.connect(depth);
      depth.connect(lp.frequency);
      o.start(at);
      lfo.start(at);
      deck.nodes.push(o, lfo);
    };
    const air = (low: number, high: number, gain: number, rate: number): void => {
      const n = this.noiseBuffer(ctx);
      if (!n) return;
      const src = ctx.createBufferSource();
      src.buffer = n;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.value = (low + high) / 2;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(bp);
      bp.connect(g);
      g.connect(deck.gain);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = (high - low) / 2;
      lfo.connect(depth);
      depth.connect(bp.frequency);
      src.start(at);
      lfo.start(at);
      deck.nodes.push(src, lfo);
    };
    if (pad === 'nebula') {
      // Accord ouvert, froid et profond (la, mi, si) ; houle très lente
      voice('sine', 110, 0.18, 700);
      voice('triangle', 164.81, 0.08, 900);
      voice('sine', 246.94, 0.05, 1200);
      air(220, 700, 0.05, 0.04);
    } else {
      // Vents : deux couches de souffle qui balayent le spectre, bourdon grave
      voice('sawtooth', 73.42, 0.05, 260);
      voice('sine', 146.83, 0.06, 500);
      air(300, 1400, 0.07, 0.11);
      air(700, 2600, 0.035, 0.17);
    }
  }

  private noiseBuffer(ctx: BaseAudioContext): AudioBuffer | null {
    if (this.noise) return this.noise;
    try {
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch {
      return null;
    }
    return this.noise;
  }

  /** Ferme une platine : filtre qui se referme et gain vers 0 pendant `dur` s, puis arrêt de ses sources. */
  private closeDeck(d: Deck, now: number, dur: number): void {
    const g = d.gain.gain;
    try {
      if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
      else {
        const cur = g.value;
        g.cancelScheduledValues(now);
        g.setValueAtTime(cur, now);
      }
      g.linearRampToValueAtTime(0, now + dur);
      d.filter.frequency.cancelScheduledValues(now);
      d.filter.frequency.setValueAtTime(Math.max(200, d.filter.frequency.value), now);
      if (dur > 0.3) d.filter.frequency.exponentialRampToValueAtTime(500, now + dur);
    } catch {
      /* nœud déjà arrêté */
    }
    for (const n of d.nodes) {
      try {
        n.stop(now + dur + 0.05);
      } catch {
        /* déjà arrêté */
      }
    }
    const nodes = d.nodes;
    const last = nodes[0];
    if (last) {
      last.onended = () => {
        try {
          d.gain.disconnect();
          d.filter.disconnect();
        } catch {
          /* déjà déconnecté */
        }
      };
    }
  }

  private fadeAll(ctx: BaseAudioContext, dur: number): void {
    const now = ctx.currentTime;
    for (const d of this.decks) this.closeDeck(d, now, dur);
    this.decks = [];
    this.current = null;
  }
}
