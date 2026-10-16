import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Music, type AudioHost } from '../src/audio/music';
import { LOOP_ENTRY_OFFSET, MUSIC } from '../src/config/music';
import timing from '../src/data/polar-rift-audio.json';
import { PHASE1_PLAN, PHASE2_MUSIC } from '../src/config/phases';

// ————————————————————————————————————————————— faux contexte audio (horloge contrôlée, journal des programmations)

class FakeParam {
  value = 1;
  events: { type: 'set' | 'ramp'; value: number; time: number }[] = [];
  setValueAtTime(v: number, t: number): void {
    this.events.push({ type: 'set', value: v, time: t });
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.events.push({ type: 'ramp', value: v, time: t });
  }
  targets: number[] = [];
  setTargetAtTime(v: number): void {
    this.targets.push(v);
    this.value = v;
  }
  cancelScheduledValues(t: number): void {
    this.events = this.events.filter((e) => e.time < t);
  }
  cancelAndHoldAtTime(t: number): void {
    this.cancelScheduledValues(t);
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  connect(n: FakeNode): void {
    this.connections.push(n);
  }
  disconnect(): void {
    this.connections = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
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

class FakeCtx {
  currentTime = 0;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}

const buf = (name: string): AudioBuffer => ({ name }) as unknown as AudioBuffer;

function setup(): { ctx: FakeCtx; out: FakeNode; music: Music; buffers: Record<string, AudioBuffer> } {
  const ctx = new FakeCtx();
  const out = new FakeNode();
  const host: AudioHost = { context: () => ctx as unknown as BaseAudioContext, output: () => out as unknown as AudioNode };
  const music = new Music(host, { intro: 'i', loop: 'l', outro: 'o' });
  const buffers = { intro: buf('intro'), loop: buf('loop'), outro: buf('outro') };
  music.setBuffers(buffers);
  return { ctx, out, music, buffers };
}

const I = timing.files.intro.decodedDurationSeconds;
const name = (s: FakeSource): string => (s.buffer as { name: string }).name;
/** Gain d'une source (le GainNode auquel elle est connectée). */
const gainOf = (_ctx: FakeCtx, s: FakeSource): FakeParam => (s.connections[0] as FakeGain).gain;

/** Sources qui sonnent à l'instant t (démarrées, non arrêtées) — hors fenêtres de fondu. */
const playingAt = (ctx: FakeCtx, t: number): FakeSource[] => ctx.sources.filter((s) => s.starts.length > 0 && s.starts[0].when <= t && (s.stopAt === null || t < s.stopAt));

afterEach(() => vi.restoreAllMocks());

describe('musique : repères et fichiers', () => {
  it('repères du JSON utilisés tels quels', () => {
    expect(MUSIC.loopStart).toBe(0.12);
    expect(MUSIC.loopEnd).toBe(153.29002267573696);
    expect(MUSIC.loopDuration).toBeCloseTo(153.17002267573696, 12);
    expect(MUSIC.introDuration).toBe(24.284988662131518);
    expect(MUSIC.introCrossfade).toBe(0.02);
    expect(MUSIC.outroCrossfade).toBe(1.2);
    expect(LOOP_ENTRY_OFFSET).toBeCloseTo(0.1, 12);
    expect(timing.files.loop.loopStartSamples).toBe(5292);
    expect(timing.files.loop.loopEndSamples).toBe(6760090);
  });

  it('trois MP3 (≈ 2,71 Mo) aux poids annoncés, sans fichier de 15 minutes', () => {
    let total = 0;
    for (const [k, f] of Object.entries(timing.files)) {
      const size = readFileSync(`src/assets/audio/${f.file}`).length;
      expect(size, k).toBe(f.fileBytes);
      total += size;
    }
    expect(total).toBe(2710075);
  });
});

describe('musique : intro → boucle sur l’horloge audio', () => {
  it('démarrage : intro une fois, boucle programmée dans sa garde avec les repères exacts', () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const { ctx, music } = setup();
    music.startGame();
    expect(music.mode).toBe('playing');
    expect(ctx.sources).toHaveLength(2);
    const [intro, loop] = ctx.sources;
    const t0 = MUSIC.startDelay;
    const T = t0 + I;
    expect(name(intro)).toBe('intro');
    expect(intro.loop).toBe(false);
    expect(intro.starts).toEqual([{ when: t0, offset: 0 }]);
    expect(intro.stopAt).toBeCloseTo(T, 12);
    expect(name(loop)).toBe('loop');
    expect(loop.loop).toBe(true);
    expect(loop.loopStart).toBe(0.12);
    expect(loop.loopEnd).toBe(153.29002267573696);
    expect(loop.starts[0].when).toBeCloseTo(T - 0.02, 12);
    expect(loop.starts[0].offset).toBeCloseTo(0.1, 12);
    // Rampes complémentaires sur [T − 20 ms, T]
    const ig = gainOf(ctx, intro).events;
    const lg = gainOf(ctx, loop).events;
    expect(ig).toContainEqual({ type: 'set', value: 1, time: expect.closeTo(T - 0.02, 9) });
    expect(ig).toContainEqual({ type: 'ramp', value: 0, time: expect.closeTo(T, 9) });
    expect(lg).toContainEqual({ type: 'set', value: 0, time: expect.closeTo(T - 0.02, 9) });
    expect(lg).toContainEqual({ type: 'ramp', value: 1, time: expect.closeTo(T, 9) });
    // Aucun minuteur : tout est sur l'horloge audio
    expect(timers).not.toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();
  });

  it('une partie d’une heure ne crée aucun nœud supplémentaire (un seul nœud en boucle)', () => {
    const { ctx, music } = setup();
    music.startGame();
    for (let t = 0; t <= 3600; t += 5) ctx.currentTime = t; // le temps passe : rien n'est (re)programmé
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(1);
    expect(music.activeVoices).toBe(2);
  });

  it('un seul ensemble de buffers : les mêmes objets à chaque partie, branchés sur la sortie du jeu', () => {
    const { ctx, out, music, buffers } = setup();
    for (let i = 0; i < 4; i++) {
      music.startGame();
      ctx.currentTime += 30;
    }
    for (const s of ctx.sources) expect(s.buffer).toBe(buffers[name(s) as keyof typeof buffers]);
    // Un seul bus, connecté à la sortie du jeu (volume et sourdine existants) ; rien vers la destination directe
    expect(ctx.gains.filter((g) => g.connections.includes(out))).toHaveLength(1);
    expect(ctx.destination.connections).toHaveLength(0);
  });
});

describe('musique : fin de partie', () => {
  it('défaite pendant l’intro : boucle programmée annulée, fondu 1,2 s vers l’outro', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 5;
    music.endGame();
    expect(music.mode).toBe('outro');
    const [intro, loop, outro] = ctx.sources;
    // La boucle ne démarrera jamais : son démarrage prévu à T − 20 ms est dépassé par son arrêt
    expect(loop.stopAt).toBeLessThanOrEqual(5 + 1.2 + 0.05);
    expect(loop.stopAt).toBeLessThan(loop.starts[0].when);
    expect(intro.stopAt).toBeLessThanOrEqual(5 + 1.2 + 0.05);
    expect(name(outro)).toBe('outro');
    expect(outro.starts[0].when).toBe(5);
    expect(outro.loop).toBe(false);
    expect(gainOf(ctx, outro).events).toEqual([
      { type: 'set', value: 0, time: 5 },
      { type: 'ramp', value: 1, time: expect.closeTo(6.2, 9) },
    ]);
    // Plus rien d'autre que l'outro après le fondu
    expect(playingAt(ctx, 7).map(name)).toEqual(['outro']);
    expect(playingAt(ctx, 100).map(name)).toEqual(['outro']);
  });

  it('défaite pendant la boucle : fondu depuis la boucle active, sans attendre le tour suivant', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 100;
    music.endGame();
    const loop = ctx.sources[1];
    const outro = ctx.sources[2];
    expect(loop.stopAt).toBeLessThanOrEqual(100 + 1.25);
    expect(outro.starts[0].when).toBe(100);
    expect(playingAt(ctx, 102).map(name)).toEqual(['outro']);
    // L'outro se termine seule ; l'état revient au repos
    outro.onended?.();
    expect(music.mode).toBe('idle');
  });

  it('fin de partie quand rien ne joue : sans effet', () => {
    const { ctx, music } = setup();
    music.endGame();
    expect(ctx.sources).toHaveLength(0);
  });

  it('outro indisponible : simple fondu de la musique active, sans erreur', () => {
    const ctx = new FakeCtx();
    const out = new FakeNode();
    const music = new Music({ context: () => ctx as unknown as BaseAudioContext, output: () => out as unknown as AudioNode }, { intro: 'i', loop: 'l', outro: 'o' });
    music.setBuffers({ intro: buf('intro'), loop: buf('loop') });
    music.startGame();
    ctx.currentTime = 3;
    music.endGame();
    expect(music.mode).toBe('idle');
    expect(ctx.sources).toHaveLength(2);
    expect(playingAt(ctx, 6).length).toBe(0);
  });
});

describe('musique : relance rapide', () => {
  it('relance pendant l’outro : fondu court, l’outro est arrêtée avant l’intro, aucune superposition', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 40;
    music.endGame();
    ctx.currentTime = 41; // le joueur relance tout de suite
    music.startGame();
    const outro = ctx.sources[2];
    const intro2 = ctx.sources[3];
    expect(name(intro2)).toBe('intro');
    expect(outro.stopAt).toBeLessThanOrEqual(41 + MUSIC.restartFade + 0.05);
    expect(intro2.starts[0].when).toBeGreaterThanOrEqual(41 + MUSIC.restartFade);
    expect(outro.stopAt as number).toBeLessThanOrEqual(intro2.starts[0].when + 0.03);
    expect(playingAt(ctx, 45).map(name)).toEqual(['intro']);
  });

  it('plusieurs redémarrages rapides : une seule musique audible à la fin', () => {
    const { ctx, music } = setup();
    for (let i = 0; i < 6; i++) {
      music.startGame();
      ctx.currentTime += 0.3;
      if (i % 2 === 1) music.endGame();
      ctx.currentTime += 0.1;
    }
    music.startGame();
    const now = ctx.currentTime;
    // Bien plus tard : seules l'intro (puis la boucle) de la dernière partie existent
    const later = playingAt(ctx, now + 10);
    expect(later.map(name)).toEqual(['intro']);
    expect(playingAt(ctx, now + 60).map(name)).toEqual(['loop']);
    // Toutes les anciennes sources ont un arrêt dans le fondu de relance
    const last = ctx.sources.slice(-2);
    for (const s of ctx.sources.filter((x) => !last.includes(x))) expect(s.stopAt, name(s)).not.toBeNull();
  });

  it('relance pendant l’intro : l’ancienne boucle programmée est annulée', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 2;
    music.startGame();
    const [i1, l1] = ctx.sources;
    expect(l1.stopAt as number).toBeLessThan(l1.starts[0].when);
    expect(i1.stopAt as number).toBeLessThan(2 + 0.3);
    expect(playingAt(ctx, 20).map(name)).toEqual(['intro']);
    expect(playingAt(ctx, 40).map(name)).toEqual(['loop']);
  });
});

describe('musique : pause et reprise', () => {
  it('pause pendant l’intro : reprise à la même position, raccord vers la boucle recalé', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 10.06; // position 10 s
    music.pause();
    expect(music.mode).toBe('paused');
    expect(ctx.sources[0].stopAt as number).toBeLessThan(10.06 + 0.2);
    ctx.currentTime = 50; // longue pause
    music.resume();
    expect(music.mode).toBe('playing');
    const iv = ctx.sources[2];
    const lv = ctx.sources[3];
    const at = 50 + MUSIC.startDelay;
    expect(iv.starts[0].when).toBeCloseTo(at, 9);
    expect(iv.starts[0].offset).toBeCloseTo(10, 6);
    // La boucle entre exactement quand l'intro se termine (position I), 20 ms plus tôt pour le fondu
    expect(lv.starts[0].when).toBeCloseTo(at + (I - 10) - 0.02, 6);
    expect(iv.stopAt).toBeCloseTo(at + (I - 10), 6);
  });

  it('pause pendant la boucle : reprise dans la région en boucle', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = MUSIC.startDelay + I + 30; // 30 s dans la boucle
    music.pause();
    ctx.currentTime += 100;
    music.resume();
    const lv = ctx.sources[ctx.sources.length - 1];
    expect(lv.loop).toBe(true);
    expect(lv.starts[0].offset).toBeCloseTo(MUSIC.loopStart + 30, 6);
    expect(lv.starts[0].offset).toBeGreaterThanOrEqual(MUSIC.loopStart);
    expect(lv.starts[0].offset).toBeLessThan(MUSIC.loopEnd);
  });

  it('reprise sans pause préalable : sans effet ; pause répétée : sans effet', () => {
    const { ctx, music } = setup();
    music.resume();
    expect(ctx.sources).toHaveLength(0);
    music.startGame();
    music.pause();
    music.pause();
    expect(ctx.sources).toHaveLength(2);
  });

  it('retour à l’état initial après une partie quittée : fondu, aucune boucle restante', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 30;
    music.stop();
    expect(music.mode).toBe('idle');
    expect(playingAt(ctx, 40)).toHaveLength(0);
  });
});

describe('musique : mixage et écoute d’essai', () => {
  it('le mixage de la musique agit sur son bus (courbe quadratique), tout de suite, sans toucher aux nœuds de lecture', () => {
    const { ctx, music } = setup();
    music.startGame();
    const bus = ctx.gains.find((g) => g.gain.value === MUSIC.gain)!;
    expect(bus).toBeDefined();
    music.setLevel(0.5);
    expect(bus.gain.targets.at(-1)).toBeCloseTo(MUSIC.gain * 0.25, 9);
    music.setLevel(1);
    expect(bus.gain.targets.at(-1)).toBeCloseTo(MUSIC.gain, 9);
    music.setLevel(0);
    expect(bus.gain.targets.at(-1)).toBe(0);
    // Un mixage défini avant le premier bus s'applique à sa création
    const b = setup();
    b.music.setLevel(0.5);
    b.music.startGame();
    expect(b.ctx.gains.some((g) => Math.abs(g.gain.value - MUSIC.gain * 0.25) < 1e-9)).toBe(true);
  });

  it('écoute d’essai : 2,5 s de la boucle hors partie ; sans effet pendant une partie', () => {
    const { ctx, music } = setup();
    music.audition();
    const src = ctx.sources.at(-1)!;
    expect(name(src)).toBe('loop');
    expect(src.loop).toBe(false);
    expect(src.starts[0].offset).toBeCloseTo(MUSIC.loopStart + MUSIC.auditionFrom, 9);
    expect(src.stopAt).toBeCloseTo(0.02 + MUSIC.auditionSeconds + 0.02, 9);
    const n = ctx.sources.length;
    music.startGame();
    music.audition();
    // Pendant la partie : aucun nœud d'essai supplémentaire (seulement ceux de la partie)
    expect(ctx.sources.length - n).toBeLessThanOrEqual(2);
    expect(ctx.sources.slice(n).every((s) => s !== src)).toBe(true);
  });
});

// ————————————————————————————————————————————— phase 2 : morceau joint, boucle sans trou, séquence de cinq minutes

describe('musique : séquence de la phase 1 (second tour) et phase 2', () => {
  const T2 = I + MUSIC.loopDuration;

  it('second tour de la phase 1 : raccord programmé tardivement (maintain), voix du premier tour fondue, second tour calé sur secondPassFrom', () => {
    const { ctx, music } = setup();
    music.startGame();
    expect(ctx.sources).toHaveLength(2);
    ctx.currentTime = 10;
    music.maintain();
    expect(ctx.sources).toHaveLength(2); // trop tôt : rien n'est programmé
    ctx.currentTime = MUSIC.startDelay + T2 - 3;
    music.maintain();
    expect(ctx.sources).toHaveLength(3);
    const second = ctx.sources[2];
    const X = PHASE1_PLAN.crossfade;
    expect(second.loop).toBe(true);
    expect(second.starts[0].when).toBeCloseTo(MUSIC.startDelay + T2 - X, 9);
    expect(second.starts[0].offset).toBeCloseTo(MUSIC.loopStart + PHASE1_PLAN.secondPassFrom - X, 9);
    expect(ctx.sources[1].stopAt).toBeCloseTo(MUSIC.startDelay + T2 + 0.02, 9);
    // Une seule programmation, même si maintain() est rappelé à chaque image
    music.maintain();
    expect(ctx.sources).toHaveLength(3);
  });

  it('phase 2 : sans musique décodée la phase 1 continue ; avec elle, fondu sortant de la phase 1 et entrée progressive du morceau pendant la traversée', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 100;
    expect(music.enterPhase2()).toBe(false); // morceau non décodé : jamais de silence imposé
    expect(music.inPhase2).toBe(false);
    music.setBuffers({ phase2: buf('phase2') });
    expect(music.enterPhase2()).toBe(true);
    expect(music.inPhase2).toBe(true);
    const p2 = ctx.sources.find((s) => name(s) === 'phase2')!;
    expect(p2.starts[0].offset).toBe(0);
    // Entrée progressive : le gain atteint 1 à la fin de la traversée (6 s)
    const ramp = gainOf(ctx, p2).events.find((e) => e.type === 'ramp' && e.value === 1)!;
    expect(ramp.time - p2.starts[0].when).toBeCloseTo(PHASE2_MUSIC.fadeIn, 6);
    // La musique de phase 1 est coupée en fondu (pas à sec)
    for (const s of ctx.sources.filter((x) => name(x) !== 'phase2')) expect(s.stopAt ?? 0).toBeGreaterThan(100);
  });

  it('phase 2 : position dans le fichier — première lecture, puis boucle sans trou entre loopStart et loopEnd (jamais le silence final)', () => {
    const { ctx, music } = setup();
    music.setBuffers({ phase2: buf('phase2') });
    music.startGame();
    ctx.currentTime = 50;
    music.enterPhase2();
    const t0 = ctx.currentTime;
    const at = (pos: number): number => {
      ctx.currentTime = t0 + 0.03 + pos;
      const p = music.position({ track: null, time: 0, playing: false });
      expect(p.track).toBe('p2');
      return p.time;
    };
    expect(at(10)).toBeCloseTo(10, 6);
    expect(at(PHASE2_MUSIC.loopEnd - 1)).toBeCloseTo(PHASE2_MUSIC.loopEnd - 1, 6);
    // Après la fin de la région en boucle : retour à loopStart, indéfiniment (dix passes)
    const L = PHASE2_MUSIC.loopDuration;
    expect(at(PHASE2_MUSIC.loopEnd + 2)).toBeCloseTo(PHASE2_MUSIC.loopStart + 2, 6);
    expect(at(PHASE2_MUSIC.loopEnd + 10 * L + 5)).toBeCloseTo(PHASE2_MUSIC.loopStart + 5, 6);
    // Le silence final du fichier (après loopEnd) n'est jamais atteint
    for (const pos of [PHASE2_MUSIC.loopEnd - 0.01, PHASE2_MUSIC.loopEnd + 0.01, PHASE2_MUSIC.loopEnd + L - 0.01]) expect(at(pos)).toBeLessThan(PHASE2_MUSIC.loopEnd);
  });

  it('phase 2 : fondus enchaînés de boucle programmés sur l’horloge audio (voix suivante à loopStart − fondu, en phase), sans minuteur', () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { ctx, music } = setup();
    music.setBuffers({ phase2: buf('phase2') });
    music.startGame();
    const t0 = ctx.currentTime + 0.03; // la phase 2 démarre 30 ms après l'ordre (programmation sur l'horloge audio)
    music.enterPhase2();
    const voices = ctx.sources.filter((s) => name(s) === 'phase2');
    // Première lecture jusqu'à loopEnd, puis deux passes programmées d'avance au moins
    expect(voices.length).toBeGreaterThanOrEqual(2);
    const X = PHASE2_MUSIC.crossfade;
    const L = PHASE2_MUSIC.loopDuration;
    const first = voices[0];
    expect(first.stopAt).toBeCloseTo(t0 + PHASE2_MUSIC.loopEnd + 0.02, 6);
    const second = voices[1];
    expect(second.starts[0].offset).toBeCloseTo(PHASE2_MUSIC.loopStart - X, 9);
    expect(second.starts[0].when).toBeCloseTo(t0 + PHASE2_MUSIC.loopEnd - X, 6);
    // La phase de battement est conservée : à l'instant où la voix 1 atteint loopEnd, la voix 2 est exactement à loopStart
    expect(second.starts[0].offset + (t0 + PHASE2_MUSIC.loopEnd - second.starts[0].when)).toBeCloseTo(PHASE2_MUSIC.loopStart, 6);
    // La durée de boucle est un nombre entier de temps de la grille
    expect(L / PHASE2_MUSIC.beatPeriod).toBeCloseTo(Math.round(L / PHASE2_MUSIC.beatPeriod), 1);
    // Avancer l'horloge : maintain() programme les passes suivantes, sans doublon ni minuteur
    const before = ctx.sources.length;
    ctx.currentTime = t0 + 3 * L;
    music.maintain();
    expect(ctx.sources.length).toBeGreaterThan(before);
    const starts = ctx.sources.filter((s) => name(s) === 'phase2').map((s) => s.starts[0].when).sort((a, b) => a - b);
    for (let i = 2; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(L, 6);
    expect(timers).not.toHaveBeenCalled();
  });

  it('phase 2 : pause pendant la traversée puis reprise (entrée recalée), fin de partie = fondu sans outro de la phase 1', () => {
    const { ctx, music } = setup();
    music.setBuffers({ phase2: buf('phase2') });
    music.startGame();
    music.enterPhase2();
    ctx.currentTime += 2;
    music.pause();
    expect(music.mode).toBe('paused');
    const n = ctx.sources.length;
    music.resume();
    expect(music.mode).toBe('playing');
    const resumed = ctx.sources.slice(n).find((s) => name(s) === 'phase2')!;
    expect(resumed.starts[0].offset).toBeCloseTo(2 - 0.03, 3);
    music.endGame();
    expect(music.mode).toBe('idle');
    expect(ctx.sources.some((s) => name(s) === 'outro')).toBe(false);
    expect(music.inPhase2).toBe(false);
  });

  it('reprise en phase 2 (2ᵉ vie) : la musique de phase 2 repart dans sa boucle, jamais l’intro de la phase 1', () => {
    const { ctx, music } = setup();
    music.setBuffers({ phase2: buf('phase2') });
    expect(music.startPhase2Loop()).toBe(true);
    const v = ctx.sources.find((s) => name(s) === 'phase2')!;
    expect(v.starts[0].offset).toBeCloseTo(PHASE2_MUSIC.loopStart, 6);
    expect(ctx.sources.some((s) => name(s) === 'intro')).toBe(false);
  });
});
