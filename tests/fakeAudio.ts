/** Faux contexte Web Audio (horloge contrôlée, journal des programmations) partagé par les tests de la musique des univers. */

export class FakeParam {
  value = 1;
  events: { type: string; value: number; time: number }[] = [];
  setValueAtTime(v: number, t: number): void {
    this.events.push({ type: 'set', value: v, time: t });
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.events.push({ type: 'ramp', value: v, time: t });
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.events.push({ type: 'exp', value: v, time: t });
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(t: number): void {
    this.events = this.events.filter((e) => e.time < t);
  }
  cancelAndHoldAtTime(t: number): void {
    this.cancelScheduledValues(t);
  }
}

export class FakeNode {
  connections: unknown[] = [];
  connect(n: unknown): void {
    this.connections.push(n);
  }
  disconnect(): void {
    this.connections = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam();
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

export class FakeScheduled extends FakeNode {
  starts: { when: number; offset: number }[] = [];
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  start(when = 0, offset = 0): void {
    this.starts.push({ when, offset });
  }
  stop(when = 0): void {
    this.stopAt = when;
  }
}

export class FakeSource extends FakeScheduled {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
}

export class FakeOsc extends FakeScheduled {
  type = 'sine';
  frequency = new FakeParam();
}

export class FakeCtx {
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  sources: FakeSource[] = [];
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createOscillator(): FakeOsc {
    const o = new FakeOsc();
    this.oscs.push(o);
    return o;
  }
  createBuffer(_c: number, len: number): { getChannelData: () => Float32Array; name: string } {
    const d = new Float32Array(len);
    return { getChannelData: () => d, name: 'noise' };
  }
}

export const buf = (name: string): AudioBuffer => ({ name }) as unknown as AudioBuffer;
export const nameOf = (s: FakeSource): string => (s.buffer as { name: string }).name;
