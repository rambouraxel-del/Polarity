import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../src/data/polar-rift-world1.json';
import { MUSIC_MAP, MusicSync } from '../src/ambience/musicSync';
import type { MusicPosition } from '../src/audio/music';
import { W1_ACCENTS, W1_ACCENT_MIN, W1_BEATS, W1_BEAT_PERIOD, W1_BEAT_STRENGTH, W1_END_AUDIBLE, W1_FADE_START, W1_IMPACTS, W1_IMPACT_STRENGTH, WORLD1_AT, WORLD1_PLAN, WORLD1_START } from '../src/config/world1';
import { WORLD_MUSIC, WORLD_RHYTHM_DATA, WORLDS_RHYTHM } from '../src/config/worldMusic';
import { WORLDS } from '../src/config/worlds';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';
import { firstOrbitContact } from '../src/sim/hazards';

describe('L’Orbite originelle : carte musicale de « Neon Arpeggio »', () => {
  it('le fichier est celui qui a été analysé ; un seul segment joué tel quel dès le départ (aucun montage)', () => {
    const f = readFileSync(`src/assets/audio/${data.file}`);
    expect(f.length).toBeGreaterThan(2_000_000);
    expect(WORLD1_PLAN.segments).toHaveLength(1);
    expect(WORLD1_PLAN.segments[0]).toMatchObject({ from: 0, at: 0 });
    expect(WORLD1_PLAN.duration).toBeGreaterThan(WORLDS.span);
    expect(WORLD1_PLAN.duration).toBeLessThan(WORLDS.span + 4);
    expect(WORLD1_AT).toBe(0);
    expect(WORLD1_START).toBe(0);
    expect(WORLD_MUSIC[1].track).toBe('world1');
  });

  it('le morceau se joue en plein jusqu’à la fin de l’univers ; son fondu final se perd dans la transition', () => {
    expect(W1_FADE_START).toBeGreaterThanOrEqual(WORLDS.span - 1);
    expect(W1_END_AUDIBLE).toBeLessThan(WORLDS.span + WORLDS.transition);
  });

  it('battements : ≈ 143 pulsations/min, très réguliers, triés, force dans [0, 1]', () => {
    expect(W1_BEAT_PERIOD).toBeGreaterThan(0.41);
    expect(W1_BEAT_PERIOD).toBeLessThan(0.43);
    expect(W1_BEATS.length).toBeGreaterThan(280);
    let bad = 0;
    for (let i = 1; i < W1_BEATS.length; i++) {
      const d = W1_BEATS[i] - W1_BEATS[i - 1];
      expect(d).toBeGreaterThan(0);
      if (d < 0.36 || d > 0.48) bad++;
    }
    expect(bad).toBeLessThanOrEqual(2);
    expect(W1_BEAT_STRENGTH).toHaveLength(W1_BEATS.length);
    for (const s of W1_BEAT_STRENGTH) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('moments forts : seuls les impacts francs (≥ seuil) rythment le gameplay ; une dizaine sur 120 s, le dernier avant la faille', () => {
    expect(W1_IMPACTS).toHaveLength(W1_IMPACT_STRENGTH.length);
    expect(W1_ACCENTS.length).toBeGreaterThanOrEqual(8);
    expect(W1_ACCENTS.length).toBeLessThanOrEqual(16);
    for (const a of W1_ACCENTS) expect(W1_IMPACT_STRENGTH[W1_IMPACTS.indexOf(a)]).toBeGreaterThanOrEqual(W1_ACCENT_MIN);
    expect(W1_ACCENTS.at(-1)!).toBeGreaterThan(105);
    expect(W1_ACCENTS.at(-1)!).toBeLessThan(WORLDS.span);
    // la plupart tombent sur un battement de la carte (écart < 60 ms) ; les autres sont de vrais contretemps du morceau : le gameplay vise alors l'impact lui-même
    const onBeat = W1_ACCENTS.filter((a) => Math.min(...W1_BEATS.map((b) => Math.abs(b - a))) < 0.06).length;
    expect(onBeat / W1_ACCENTS.length).toBeGreaterThan(0.6);
  });

  it('les montées et les calmes restent à leur place (introduction douce, fondu final)', () => {
    expect(data.builds.length).toBeGreaterThanOrEqual(3);
    for (const [a, b] of data.calm) {
      expect(b).toBeGreaterThan(a);
      expect(a < 2 || a >= 119).toBe(true);
    }
  });
});

describe('L’Orbite originelle : grille de rythme du gameplay (déterministe, jamais l’audio)', () => {
  it('nextBeat / nextAccent / beatPeriodAt de l’univers 1 viennent de la carte de « Neon Arpeggio »', () => {
    expect(WORLD_RHYTHM_DATA.beats1.every((b) => b < WORLDS.span)).toBe(true);
    expect(WORLD_RHYTHM_DATA.beats1.length).toBeGreaterThan(280);
    expect(WORLD_RHYTHM_DATA.drops1).toEqual(W1_ACCENTS.filter((t) => t < WORLDS.span));
    for (let t = 0.2; t < 118; t += 0.37) {
      const b = WORLDS_RHYTHM.nextBeat(t);
      expect(b).toBeGreaterThanOrEqual(t);
      expect(W1_BEATS.some((x) => Math.abs(x - b) < 1e-9)).toBe(true);
      expect(b - t).toBeLessThan(0.5);
    }
    expect(WORLDS_RHYTHM.beatPeriodAt(10)).toBeCloseTo(0.42, 3);
    expect(WORLDS_RHYTHM.nextAccent(0)).toBe(W1_ACCENTS[0]);
    expect(WORLDS_RHYTHM.nextAccent(W1_ACCENTS.at(-1)! + 0.01)).toBe(Infinity);
  });

  it('le module de configuration n’importe aucun lecteur audio (le gameplay ne lit que les tableaux préparés)', () => {
    const src = readFileSync('src/config/world1.ts', 'utf8');
    expect(/from '\.\.\/(audio|ambience)/.test(src)).toBe(false);
    const wm = readFileSync('src/config/worldMusic.ts', 'utf8');
    expect(/from '\.\.\/(audio|ambience)/.test(wm)).toBe(false);
  });

  it('parties du robot : l’univers 1 est traversé sans mourir, les vagues sont calées sur les battements et les moments forts', () => {
    let waves = 0;
    let aligned = 0;
    for (const seed of [1000, 8919, 16838]) {
      const sim = createSimulation({ mode: 'survival', seed, worlds: true, bonus: false });
      const bot = new Bot(sim, true);
      const seen = new Set<number>();
      const first = new Map<string, number>();
      while (sim.state === 'running' && sim.time < WORLDS.span) {
        bot.tick();
        sim.step();
        sim.events.length = 0;
        for (const h of sim.hazards) {
          if (seen.has(h.id)) continue;
          seen.add(h.id);
          const k = h.warnStart.toFixed(4);
          first.set(k, Math.min(first.get(k) ?? Infinity, firstOrbitContact(h)));
        }
      }
      expect(sim.state).toBe('running');
      waves += first.size;
      for (const c of first.values()) if (W1_BEATS.some((x) => Math.abs(x - c) < 1e-3) || W1_ACCENTS.some((x) => Math.abs(x - c) < 1e-3)) aligned++;
    }
    expect(waves).toBeGreaterThan(100);
    expect(aligned / waves).toBeGreaterThan(0.3);
  });
});

describe('L’Orbite originelle : le décor lit la position ENTENDUE (carte « w1 »)', () => {
  const pos = (time: number, playing = true): MusicPosition => ({ track: 'w1', time, playing });
  it('un battement est franchi une seule fois, avec sa force ; un impact franc donne un passage fort ; les impacts faibles non', () => {
    const m = MUSIC_MAP.tracks.w1;
    expect(m.hits).toBeUndefined(); // ambiance de la Survie : coups de basse détectés entre les battements
    expect(m.drops.length).toBe(W1_ACCENTS.length);
    const sync = new MusicSync();
    const lead = 0.034;
    const b = W1_BEATS[40];
    sync.update(pos(b - lead - 0.01));
    expect(sync.update(pos(b - lead + 0.005)).beat).toBe(W1_BEAT_STRENGTH[40]);
    expect(sync.update(pos(b - lead + 0.01)).beat).toBe(0);
    const d = W1_ACCENTS[3];
    sync.update(pos(d - lead - 0.02));
    expect(sync.update(pos(d - lead + 0.001)).drop).toBe(true);
    const weak = W1_IMPACTS.find((_, i) => W1_IMPACT_STRENGTH[i] < W1_ACCENT_MIN)!;
    sync.update(pos(weak - lead - 0.02));
    expect(sync.update(pos(weak - lead + 0.001)).drop).toBe(false);
  });
  it('en pause ou sourdine : aucune réaction', () => {
    const sync = new MusicSync();
    sync.update(pos(30));
    expect(sync.update(pos(30.5, false)).active).toBe(false);
    expect(sync.update(pos(31), false).active).toBe(false);
  });
});
