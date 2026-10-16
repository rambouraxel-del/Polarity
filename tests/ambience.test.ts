import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AmbienceDirector, QualityGovernor, paramAt, stageAt } from '../src/ambience/director';
import { MUSIC_MAP, MusicSync, envAt, type MusicFrame } from '../src/ambience/musicSync';
import { Music, type AudioHost, type MusicPosition } from '../src/audio/music';
import { AMBIENCE, AMBIENCE_MODES, STAGES, STAGE_PARAMS, ambienceApplies } from '../src/config/ambience';
import { Sfx } from '../src/audio/sfx';
import { defaultSave, sanitize } from '../src/save/save';
import { MUSIC } from '../src/config/music';
import { PHASE1_PLAN } from '../src/config/phases';
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
    // Musique énergique (intensité haute, lissée) : l'ambiance n'est pas dans un passage calme
    let st = d.update(130, 1 / 60, { ...silent, active: true, beat: 0.2, intensity: 0.9 }, false);
    for (let i = 0; i < 60; i++) st = d.update(130, 1 / 60, { ...silent, active: true, beat: 0.2, intensity: 0.9 }, false);
    expect(st.beat).toBe(0);
    st = d.update(130, 1 / 60, { ...silent, active: true, beat: 1, intensity: 0.9 }, false);
    const peak = st.beat;
    expect(peak).toBeCloseTo(paramAt('beatGain', stageAt(130)), 6);
    for (let i = 0; i < 30; i++) st = d.update(130, 1 / 60, { ...silent, active: true, intensity: 0.9 }, false);
    expect(st.beat).toBeLessThan(peak * 0.1);
  });

  it('passage calme de la musique : impulsions réduites, aucune fissure ni arc', () => {
    const d = new AmbienceDirector(() => 0);
    let calm = d.update(130, 1 / 60, { ...silent, active: true, beat: 1, intensity: 0.05 }, false);
    for (let i = 0; i < 90; i++) calm = d.update(130, 1 / 60, { ...silent, active: true, beat: i === 89 ? 1 : 0, intensity: 0.05 }, false);
    expect(calm.calm).toBeGreaterThan(0.9);
    expect(calm.beat).toBeLessThan(paramAt('beatGain', stageAt(130)) * 0.5);
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
    // Premier tour de boucle : temps depuis loopStart
    ctx.currentTime = start + 0.05 + MUSIC.introDuration + 12.5;
    const q0 = music.position(out());
    expect(q0.track).toBe('loop');
    expect(q0.time).toBeCloseTo(12.5, 6);
    // Après le raccord du second tour (séquence de cinq minutes) puis de nombreux tours : toujours dans la région en boucle, sans dérive
    ctx.currentTime = start + 0.05 + MUSIC.introDuration + MUSIC.loopDuration + 5;
    expect(music.position(out()).time).toBeCloseTo(PHASE1_PLAN.secondPassFrom + 5, 6);
    ctx.currentTime = start + 0.05 + MUSIC.introDuration + MUSIC.loopDuration + 10 * MUSIC.loopDuration + 12.5;
    const q = music.position(out());
    expect(q.track).toBe('loop');
    expect(q.time).toBeCloseTo((PHASE1_PLAN.secondPassFrom + 12.5) % MUSIC.loopDuration, 6);
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

describe('silence, sourdine, pause : aucune fausse synchronisation', () => {
  const pos = (track: MusicPosition['track'], time: number, playing = true): MusicPosition => ({ track, time, playing });

  it('sourdine ou musique à zéro (non audible) : image inactive, aucun battement ni passage fort, même en lecture', () => {
    const sync = new MusicSync();
    const b = MUSIC_MAP.tracks.loop.beats[40];
    const d = MUSIC_MAP.tracks.loop.drops[0];
    sync.update(pos('loop', b - 0.05), false);
    const f = sync.update(pos('loop', b + 0.01), false);
    expect(f.active).toBe(false);
    expect(f.beat).toBe(0);
    expect(f.bass).toBe(0);
    expect(sync.update(pos('loop', d + 0.01), false).drop).toBe(false);
  });

  it('remise du son : pas de rafale de battements manqués, la synchronisation repart proprement', () => {
    const sync = new MusicSync();
    sync.update(pos('loop', 10), false);
    sync.update(pos('loop', 20), false);
    // Son rétabli : la première image ne rejoue rien du passé
    expect(sync.update(pos('loop', 20.01), true).beat).toBe(0);
    const b = MUSIC_MAP.tracks.loop.beats.find((x) => x > 20.1)!;
    sync.update(pos('loop', b - 0.02));
    expect(sync.update(pos('loop', b + 0.01)).beat).toBeGreaterThan(0);
  });

  it('position non jouée (pause, compte à rebours, contexte suspendu) : aucune réaction, les valeurs retombent', () => {
    const sync = new MusicSync();
    const d = new AmbienceDirector(() => 0);
    const loud = { ...sync.update(pos('loop', 110.2)) };
    expect(loud.active).toBe(true);
    for (let i = 0; i < 120; i++) {
      const f = sync.update(pos('loop', 110.2, false));
      expect(f.active).toBe(false);
      d.update(300, 1 / 60, f, false);
    }
    expect(d.state.bass).toBeLessThan(0.01);
    expect(d.state.beat).toBeLessThan(0.01);
  });

  it('Music.position : contexte suspendu ou interrompu (Safari iPhone) = rien d’entendu', () => {
    const mk = (state: string) => {
      const ctx = { currentTime: 0, state } as unknown as BaseAudioContext;
      const music = new Music({ context: () => ctx, output: () => null }, { intro: 'i', loop: 'l', outro: 'o' });
      return { ctx, music };
    };
    const out: MusicPosition = { track: null, time: 0, playing: false };
    // Pas de musique démarrée : aucune position, quel que soit l'état
    expect(mk('running').music.position(out).track).toBeNull();
    expect(mk('interrupted').music.position(out).playing).toBe(false);
  });
});

describe('intensité visuelle choisie par le joueur', () => {
  const loud: MusicFrame = { active: true, track: 'loop', bass: 1, intensity: 1, beat: 1, drop: true, build: 1 };

  it('0 % : ciel étoilé seul (ni faille, ni nébuleuses, ni particules, ni réaction) ; les étoiles restent', () => {
    const d = new AmbienceDirector(() => 0);
    const st = d.update(400, 1 / 60, loud, false, 0);
    expect(st.p.riftGlow).toBe(0);
    expect(st.p.nebula).toBe(0);
    expect(st.p.dust).toBe(0);
    expect(st.p.debris).toBe(0);
    expect(st.beat).toBe(0);
    expect(st.spawnWave + st.spawnRing + st.spawnArcs).toBe(0);
    expect(st.p.stars).toBeGreaterThan(0);
  });

  it('proportionnelle : 50 % atténue les effets de moitié, 100 % = ambiance complète', () => {
    const full = new AmbienceDirector(() => 0).update(400, 1 / 60, silent, false, 1);
    const half = new AmbienceDirector(() => 0).update(400, 1 / 60, silent, false, 0.5);
    expect(half.p.nebula).toBeCloseTo(full.p.nebula * 0.5, 9);
    expect(half.p.dust).toBeCloseTo(full.p.dust * 0.5, 9);
    expect(half.p.stars).toBe(full.p.stars);
  });

  it('réglages enregistrés : valeurs par défaut, bornes, anciennes sauvegardes sans ces champs', () => {
    const def = defaultSave().options;
    expect([def.musicVolume, def.sfxVolume, def.visualIntensity]).toEqual([1, 1, 1]);
    const raw = JSON.parse(JSON.stringify(defaultSave())) as Record<string, unknown>;
    (raw.options as Record<string, unknown>) = { muted: true, volume: 0.4, reducedEffects: true, tutorialSeen: true, musicVolume: 7, sfxVolume: -3, visualIntensity: 'x' };
    const o = sanitize(raw).options;
    expect(o.musicVolume).toBe(1);
    expect(o.sfxVolume).toBe(0);
    expect(o.visualIntensity).toBe(1);
    expect(o.muted).toBe(true);
    expect(o.reducedEffects).toBe(true);
  });
});

describe('bus audio : effets sonores et musique sous le même volume général', () => {
  class P {
    value = 1;
    targets: number[] = [];
    setValueAtTime(): void {}
    exponentialRampToValueAtTime(): void {}
    linearRampToValueAtTime(): void {}
    setTargetAtTime(v: number): void {
      this.targets.push(v);
    }
  }
  class N {
    to: N[] = [];
    connect(n: N): void {
      this.to.push(n);
    }
    start(): void {}
    stop(): void {}
  }
  class G extends N {
    gain = new P();
  }
  class FakeContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 44100;
    destination = new N();
    gains: G[] = [];
    createGain(): G {
      const g = new G();
      this.gains.push(g);
      return g;
    }
    createBuffer(): { getChannelData: () => Float32Array } {
      return { getChannelData: () => new Float32Array(32768) };
    }
    createOscillator(): N & { frequency: { setValueAtTime(): void; exponentialRampToValueAtTime(): void }; type: string } {
      return Object.assign(new N(), { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    }
    resume(): Promise<void> {
      this.state = 'running';
      return Promise.resolve();
    }
  }

  it('effets sonores → bus effets → sortie générale → destination ; la musique se branche sur la même sortie', () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
    try {
      const sfx = new Sfx();
      sfx.unlock();
      const ctx = sfx.context as unknown as FakeContext;
      const master = sfx.output as unknown as G;
      expect(master.to).toContain(ctx.destination);
      const bus = ctx.gains.find((g) => g !== master && g.to.includes(master))!;
      expect(bus).toBeDefined();
      sfx.play('collect');
      // La voix d'effet passe par le bus des effets, jamais directement par la sortie générale
      const voice = ctx.gains.at(-1)!;
      expect(voice.to).toEqual([bus]);
      sfx.setSfxVolume(0.5);
      expect(bus.gain.targets.at(-1)).toBeCloseTo(0.25, 9);
      sfx.setVolume(1);
      sfx.setMuted(true);
      expect(master.gain.targets.at(-1)).toBe(0);
      sfx.setMuted(false);
      expect(master.gain.targets.at(-1)).toBeCloseTo(0.5, 9);
    } finally {
      delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    }
  });

  it('crête maximale de la musique × bus × volume général < 1 : aucune saturation propre au jeu', () => {
    // Crêtes mesurées des trois MP3 : ≤ 0,65 ; bus musique 0,5 ; sortie générale ≤ 0,5 ; effets les plus forts ≤ 0,75 en même temps
    const worst = (0.65 * MUSIC.gain + 0.75 + 0.25) * 0.5;
    expect(worst).toBeLessThan(1);
  });
});

describe('gameplay : l’ambiance ne touche ni la simulation ni les modes hors Survie', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });

  it('aucun fichier de la simulation, de la campagne, des modes, de la session ni du serveur n’importe l’ambiance', () => {
    const dirs = ['src/sim', 'src/campaign', 'src/modes', 'src/game', 'src/core', 'src/progression', 'server'];
    const files = dirs.flatMap(walk).concat(['src/config/hitbox.ts', 'src/config/balance.ts', 'src/config/levels.ts', 'src/config/survival.ts', 'src/config/playerSpeed.ts', 'src/config/hazards.ts', 'src/config/events.ts', 'src/config/economy.ts', 'src/config/campaign.ts', 'src/config/version.ts']);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/ambience|musicSync/i);
  });

  it('Survie et défi quotidien seulement', () => {
    expect(ambienceApplies('survival')).toBe(true);
    expect(ambienceApplies('daily')).toBe(true);
    expect(ambienceApplies('campaign')).toBe(false);
    expect(ambienceApplies('level')).toBe(false);
  });

  it('BALANCE_VERSION = 4 (Survie à phases)', async () => {
    const { BALANCE_VERSION } = await import('../src/config/version');
    expect(BALANCE_VERSION).toBe(4);
  });
});
