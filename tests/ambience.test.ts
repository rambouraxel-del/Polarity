import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AmbienceDirector, QualityGovernor, paramAt, stageAt } from '../src/ambience/director';
import { MUSIC_MAP, MusicSync, envAt, type MusicFrame } from '../src/ambience/musicSync';
import { Music, type AudioHost, type MusicPosition } from '../src/audio/music';
import { AMBIENCE, AMBIENCE_MODES, STAGES, STAGE_PARAMS } from '../src/config/ambience';
import { MUSIC } from '../src/config/music';
import timing from '../src/data/polar-rift-audio.json';

const silent: MusicFrame = { active: false, track: null, bass: 0, intensity: 0, beat: 0, drop: false, build: 0 };

describe('ambience : stades et transitions', () => {
  it('cinq stades aux seuils demandés (0, 60, 120, 180, 240 s)', () => {
    expect(STAGES.map((s) => s.from)).toEqual([0, 60, 120, 180, 240]);
    for (const v of Object.values(STAGE_PARAMS)) expect(v).toHaveLength(5);
  });

  it('stade continu : plein stade après chaque transition, jamais de saut', () => {
    expect(stageAt(0)).toBe(0);
    expect(stageAt(59.9)).toBe(0);
    for (let k = 1; k < 5; k++) expect(stageAt(STAGES[k].from + AMBIENCE.transition)).toBeCloseTo(k, 9);
    expect(stageAt(1000)).toBe(4);
    // Transition entre 8 et 12 s, continue : aucun saut de plus de 1 % de stade par 1/60 s
    expect(AMBIENCE.transition).toBeGreaterThanOrEqual(8);
    expect(AMBIENCE.transition).toBeLessThanOrEqual(12);
    let prev = stageAt(0);
    for (let t = 1 / 60; t < 300; t += 1 / 60) {
      const s = stageAt(t);
      expect(s - prev).toBeLessThan(0.01);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('les effets croissent avec la survie et restent plafonnés', () => {
    for (const k of ['dust', 'riftOpen', 'riftGlow', 'nebula', 'beatGain'] as const) {
      for (let s = 0; s < 4; s += 0.25) expect(paramAt(k, s + 0.25)).toBeGreaterThanOrEqual(paramAt(k, s));
    }
    const d = new AmbienceDirector(() => 0);
    const loud: MusicFrame = { active: true, track: 'loop', bass: 1, intensity: 1, beat: 1, drop: true, build: 1 };
    for (let i = 0; i < 600; i++) {
      const st = d.update(400 + i / 60, 1 / 60, loud, false);
      expect(st.beat).toBeLessThanOrEqual(1);
      expect(st.p.heat).toBeLessThanOrEqual(1);
      expect(st.p.nebula * 2).toBeLessThan(10);
    }
  });

  it('pause : rien ne bouge (temps d’animation, impulsions, demandes)', () => {
    const d = new AmbienceDirector(() => 0);
    d.update(200, 1 / 60, { ...silent, active: true, beat: 1, drop: true }, false);
    const before = { ...d.state, p: { ...d.state.p } };
    const st = d.update(200, 0, { ...silent, active: true, beat: 1, drop: true }, false);
    expect(st.time).toBe(before.time);
    expect(st.beat).toBe(before.beat);
    expect(st.drop).toBe(before.drop);
    expect(st.spawnRing + st.spawnWave + st.spawnArcs).toBe(0);
  });

  it('battement significatif : impulsion immédiate puis décroissance rapide ; battement faible ignoré', () => {
    const d = new AmbienceDirector(() => 1);
    let st = d.update(130, 1 / 60, { ...silent, active: true, beat: 0.2 }, false);
    expect(st.beat).toBe(0);
    st = d.update(130, 1 / 60, { ...silent, active: true, beat: 1 }, false);
    const peak = st.beat;
    expect(peak).toBeCloseTo(paramAt('beatGain', stageAt(130)), 6);
    for (let i = 0; i < 30; i++) st = d.update(130, 1 / 60, { ...silent, active: true }, false);
    expect(st.beat).toBeLessThan(peak * 0.1);
  });

  it('sans musique : aucune réaction (pas de fausse pulsation)', () => {
    const d = new AmbienceDirector(() => 0);
    for (let i = 0; i < 600; i++) {
      const st = d.update(300, 1 / 60, silent, false);
      expect(st.beat).toBe(0);
      expect(st.spawnRing).toBe(0);
      expect(st.spawnWave).toBe(0);
    }
  });

  it('effets réduits : réactions adoucies, ni onde, ni arc, ni déformation', () => {
    const d = new AmbienceDirector(() => 0);
    const st = d.update(300, 1 / 60, { active: true, track: 'loop', bass: 1, intensity: 1, beat: 1, drop: true, build: 0 }, true);
    expect(st.spawnWave).toBe(0);
    expect(st.spawnArcs).toBe(0);
    expect(st.p.gridWarp).toBe(0);
    expect(st.beat).toBeLessThanOrEqual(AMBIENCE.reduced.reaction);
  });

  it('réservée à la Survie et au défi quotidien (jamais la campagne ni les défis classiques)', () => {
    expect([...AMBIENCE_MODES]).toEqual(['survival', 'daily']);
  });

  it('qualité adaptative : descend si les images sont lentes, remonte seulement après une longue période fluide', () => {
    const q = new QualityGovernor('high');
    for (let i = 0; i < 30 * 4.5; i++) q.update(1 / 30); // 4,5 s lentes
    expect(q.tier).toBe('medium');
    for (let i = 0; i < 60 * 5; i++) q.update(1 / 60);
    expect(q.tier).toBe('medium');
    for (let i = 0; i < 60 * 25; i++) q.update(1 / 60);
    expect(q.tier).toBe('high');
  });
});

describe('carte musicale (analyse hors ligne des morceaux)', () => {
  it('cohérente avec les fichiers et les repères de boucle', () => {
    const files = timing.files;
    expect(MUSIC_MAP.tracks.intro.duration).toBeCloseTo(files.intro.decodedDurationSeconds, 3);
    expect(MUSIC_MAP.tracks.loop.duration).toBeCloseTo(files.loop.loopDurationSeconds, 3);
    expect(MUSIC_MAP.tracks.outro.duration).toBeCloseTo(files.outro.decodedDurationSeconds, 3);
    for (const t of Object.values(MUSIC_MAP.tracks)) {
      for (let i = 1; i < t.beats.length; i++) expect(t.beats[i]).toBeGreaterThan(t.beats[i - 1]);
      expect(t.beats[t.beats.length - 1]).toBeLessThan(t.duration);
      for (const s of t.strength) expect(s).toBeGreaterThanOrEqual(0);
      expect(t.strength.length).toBe(t.beats.length);
      expect(Math.abs(t.bass.length - t.duration * MUSIC_MAP.envFps)).toBeLessThan(MUSIC_MAP.envFps);
      expect(t.intensity.length).toBe(t.bass.length);
      for (const d of t.drops) expect(d).toBeLessThan(t.duration);
    }
    // La pulsation est mesurée (pas supposée) et les battements de la boucle la suivent
    const lp = MUSIC_MAP.tracks.loop.beats;
    const gaps = Array.from(lp.slice(1)).map((b, i) => b - lp[i]).sort((a, b) => a - b);
    expect(gaps[Math.floor(gaps.length / 2)]).toBeCloseTo(MUSIC_MAP.beatPeriod, 1);
    expect(MUSIC_MAP.tracks.loop.drops.length).toBeGreaterThan(0);
  });

  it('les MP3 ne sont pas modifiés (tailles identiques aux repères)', () => {
    for (const k of ['intro', 'loop', 'outro'] as const) {
      const f = timing.files[k];
      expect(readFileSync(`src/assets/audio/${f.file}`).length).toBe(f.fileBytes);
    }
  });

  it('enveloppe interpolée et bornée', () => {
    const e = new Float32Array([0, 1, 0.5]);
    expect(envAt(e, 10, 0.05)).toBeCloseTo(0.5, 6);
    expect(envAt(e, 10, 99)).toBe(0.5);
  });
});

describe('synchronisation : battements à la position de lecture réelle', () => {
  const pos = (track: MusicPosition['track'], time: number, playing = true): MusicPosition => ({ track, time, playing });
  const lead = AMBIENCE.music.lead;

  it('un battement est signalé quand la position entendue le franchit, une seule fois', () => {
    const sync = new MusicSync();
    const b = MUSIC_MAP.tracks.loop.beats[10];
    sync.update(pos('loop', b - lead - 0.01));
    expect(sync.update(pos('loop', b - lead - 0.001)).beat).toBe(0);
    expect(sync.update(pos('loop', b - lead + 0.005)).beat).toBe(MUSIC_MAP.tracks.loop.strength[10]);
    expect(sync.update(pos('loop', b - lead + 0.01)).beat).toBe(0);
  });

  it('pause : position figée, aucun battement ; reprise sans rafale de battements manqués', () => {
    const sync = new MusicSync();
    sync.update(pos('loop', 10));
    for (let i = 0; i < 10; i++) expect(sync.update(pos('loop', 10, false)).beat).toBe(0);
    // Saut de plusieurs secondes (changement de position) : rien n'est rattrapé
    expect(sync.update(pos('loop', 20)).beat).toBe(0);
  });

  it('tour de boucle : les battements de la fin et du début de la région sont vus, sans décalage cumulé', () => {
    const sync = new MusicSync();
    const L = MUSIC_MAP.tracks.loop.duration;
    const first = MUSIC_MAP.tracks.loop.beats[0];
    let seen = 0;
    // Deux tours complets à 60 images/s : autant de battements vus que dans la carte (×2)
    let t = 0;
    sync.update(pos('loop', 0));
    for (let i = 1; i <= Math.round(2 * L * 60); i++) {
      t = (i / 60) % L;
      if (sync.update(pos('loop', t)).beat > 0 || sync.frame.beat > 0) seen++;
    }
    const strong = Array.from(MUSIC_MAP.tracks.loop.strength).filter((s) => s > 0).length;
    expect(seen).toBeGreaterThanOrEqual(2 * strong - 3);
    expect(seen).toBeLessThanOrEqual(2 * strong + 1);
    expect(first).toBeLessThan(0.5);
  });

  it('passage fort franchi : signalé', () => {
    const sync = new MusicSync();
    const d = MUSIC_MAP.tracks.loop.drops[0];
    sync.update(pos('loop', d - lead - 0.02));
    expect(sync.update(pos('loop', d - lead + 0.001)).drop).toBe(true);
  });

  it('aucune musique : image inactive', () => {
    const sync = new MusicSync();
    const f = sync.update(pos(null, 0, false));
    expect(f.active).toBe(false);
    expect(f.beat).toBe(0);
  });
});

describe('position de lecture de la musique (horloge audio)', () => {
  class Node {
    connect(): void {}
    disconnect(): void {}
  }
  class Param {
    value = 1;
    setValueAtTime(): void {}
    linearRampToValueAtTime(): void {}
    cancelScheduledValues(): void {}
    cancelAndHoldAtTime(): void {}
  }
  class Src extends Node {
    buffer: unknown = null;
    loop = false;
    loopStart = 0;
    loopEnd = 0;
    onended: (() => void) | null = null;
    start(): void {}
    stop(): void {}
  }
  const setup = (): { ctx: { currentTime: number; outputLatency: number }; music: Music } => {
    const ctx = {
      currentTime: 0,
      outputLatency: 0.05,
      createGain: () => Object.assign(new Node(), { gain: new Param() }),
      createBufferSource: () => new Src(),
    };
    const host: AudioHost = { context: () => ctx as unknown as BaseAudioContext, output: () => new Node() as unknown as AudioNode };
    const music = new Music(host, { intro: 'i', loop: 'l', outro: 'o' });
    const b = (n: string): AudioBuffer => ({ n }) as unknown as AudioBuffer;
    music.setBuffers({ intro: b('i'), loop: b('l'), outro: b('o') });
    return { ctx, music };
  };
  const out = (): MusicPosition => ({ track: null, time: 0, playing: false });

  it('intro puis boucle, latence de sortie déduite, sans dérive après de nombreux tours', () => {
    const { ctx, music } = setup();
    music.startGame();
    const start = MUSIC.startDelay;
    ctx.currentTime = start + 0.05 + 3; // 3 s entendues
    const p = music.position(out());
    expect(p.track).toBe('intro');
    expect(p.time).toBeCloseTo(3, 6);
    // Après 10 tours de boucle
    ctx.currentTime = start + 0.05 + MUSIC.introDuration + 10 * MUSIC.loopDuration + 12.5;
    const q = music.position(out());
    expect(q.track).toBe('loop');
    expect(q.time).toBeCloseTo(12.5, 6);
  });

  it('pause : position figée ; reprise au même endroit ; outro après la fin', () => {
    const { ctx, music } = setup();
    music.startGame();
    ctx.currentTime = 40;
    music.pause();
    const paused = music.position(out());
    expect(paused.playing).toBe(false);
    ctx.currentTime = 100;
    expect(music.position(out()).time).toBeCloseTo(paused.time, 9);
    music.resume();
    ctx.currentTime = 100 + MUSIC.startDelay + 0.05 + 1;
    const resumed = music.position(out());
    expect(resumed.playing).toBe(true);
    // Reprise : la position repart de la pause (aux latences près)
    expect(Math.abs(resumed.time - (paused.time + 1))).toBeLessThan(0.1);
    music.endGame();
    ctx.currentTime += 2;
    const o = music.position(out());
    expect(o.track).toBe('outro');
    expect(o.time).toBeCloseTo(2 - 0.05, 6);
  });

  it('sans musique décodée : aucune position', () => {
    const ctx = { currentTime: 5 };
    const music = new Music({ context: () => ctx as unknown as BaseAudioContext, output: () => null }, { intro: 'i', loop: 'l', outro: 'o' });
    expect(music.position(out()).track).toBeNull();
  });
});
