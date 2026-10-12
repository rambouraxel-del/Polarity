/**
 * Sons procéduraux (Web Audio) : aucun fichier audio.
 * Le contexte audio n'est créé qu'après une interaction utilisateur.
 * Les sons complètent l'image ; aucune information n'est transmise uniquement par le son.
 */
export type SoundName = 'flip' | 'collect' | 'cycle' | 'warn' | 'activate' | 'hit' | 'success' | 'record' | 'ui' | 'tick' | 'shard' | 'shardSpawn' | 'shield' | 'objectSpawn';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;
  private muted = false;
  private lastPlayed: Partial<Record<SoundName, number>> = {};

  /** À appeler depuis un gestionnaire d'événement utilisateur. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyGain();
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    const g = this.muted ? 0 : this.volume * this.volume * 0.5;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
  }

  play(name: SoundName, param = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || this.volume <= 0 || ctx.state !== 'running') return;
    // Évite l'empilement d'un même son dans une même image
    const now = ctx.currentTime;
    const last = this.lastPlayed[name] ?? -1;
    if (now - last < 0.03) return;
    this.lastPlayed[name] = now;
    switch (name) {
      case 'flip':
        this.tone('triangle', 520, 380, 0.06, 0.18);
        break;
      case 'collect': {
        // Plus aigu avec le multiplicateur
        const f = 660 * Math.pow(1.06, Math.min(12, param));
        this.tone('sine', f, f * 1.5, 0.12, 0.25);
        break;
      }
      case 'cycle':
        [0, 0.07, 0.14, 0.21].forEach((d, i) => this.tone('triangle', 520 * Math.pow(1.26, i), 0, 0.16, 0.2, d));
        break;
      case 'warn':
        this.tone('sine', 300, 260, 0.1, 0.12);
        break;
      case 'activate':
        this.noiseBurst(0.12, 2400, 0.08);
        break;
      case 'hit':
        this.noiseBurst(0.45, 900, 0.5);
        this.tone('sawtooth', 180, 40, 0.4, 0.25);
        break;
      case 'success':
        [0, 0.1, 0.2].forEach((d, i) => this.tone('triangle', 440 * Math.pow(1.335, i), 0, 0.35, 0.22, d));
        break;
      case 'record':
        [0, 0.09, 0.18, 0.3].forEach((d, i) => this.tone('sine', 660 * Math.pow(1.19, i), 0, 0.25, 0.22, d));
        break;
      case 'shard':
        // Deux notes cristallines montantes : distinctes de la collecte d'une balise
        [0, 0.07].forEach((d, i) => this.tone('sine', 988 * Math.pow(1.5, i), 0, 0.22, 0.2, d));
        this.tone('triangle', 1976, 0, 0.3, 0.06, 0.07);
        break;
      case 'shardSpawn':
        this.tone('sine', 1320, 1760, 0.14, 0.08);
        break;
      case 'shield':
        // Choc sourd puis résonance claire : le bouclier a tenu
        this.noiseBurst(0.18, 1400, 0.22);
        this.tone('sine', 330, 660, 0.35, 0.2);
        this.tone('triangle', 990, 0, 0.3, 0.08, 0.05);
        break;
      case 'objectSpawn':
        this.tone('triangle', 880, 1175, 0.16, 0.1);
        break;
      case 'ui':
        this.tone('sine', 880, 0, 0.05, 0.1);
        break;
      case 'tick':
        this.tone('sine', 740, 0, 0.08, 0.15);
        break;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 > 0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, cutoff: number, gain: number): void {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
