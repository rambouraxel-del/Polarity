import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../src/data/polar-rift-world3.json';
import { AmbienceDirector } from '../src/ambience/director';
import { MUSIC_MAP, MusicSync, type MusicFrame } from '../src/ambience/musicSync';
import type { AudioHost, MusicPosition } from '../src/audio/music';
import { WorldMusic } from '../src/audio/worldMusic';
import { AMBIENCE } from '../src/config/ambience';
import { WORLD_MUSIC, WORLD_RHYTHM_DATA, WORLDS_RHYTHM } from '../src/config/worldMusic';
import { CLOUDS, WORLD_LIST, WORLDS, worldStart } from '../src/config/worlds';
import {
  CONTACT_LEAD3,
  W3_ATTACKS,
  W3_BEATS,
  W3_BEAT_PERIOD,
  W3_BEAT_STRENGTH,
  W3_BUILDS,
  W3_CALM,
  W3_DROPS,
  W3_DROP_STRENGTH,
  W3_ECLIPSE,
  W3_END_AUDIBLE,
  W3_FADE_START,
  W3_PRESSURE,
  W3_WAVE_AT,
  W3_WELLS,
  W3_WELL_AT,
  WORLD3_AT,
  WORLD3_ENTRY_TRANSITION,
  WORLD3_FADE_IN,
  WORLD3_PLAN,
  WORLD3_SPAN,
  WORLD3_START,
  calmAhead3,
  eclipseAt,
  inCalm3,
  intensity3At,
  world3Weights,
  type EclipseState,
} from '../src/config/world3';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';
import { WorldsField } from '../src/sim/field';
import { firstOrbitContact, type Hazard, type ProjectileHazard } from '../src/sim/hazards';
import { PATTERNS } from '../src/sim/patterns';
import { WORLD_TRANSITION_AUDIO } from '../src/config/worldMusic';
import { FakeCtx, FakeNode, buf, nameOf } from './fakeAudio';

const FRAME = 1 / 60;
const T0 = worldStart(2);
const FOUR = ['monolith', 'procession', 'collapse', 'processionCollapse'];

// ————————————————————————————————————————————— carte musicale et lecture du morceau

describe('La Mer nébulaire : carte musicale de « Cosmic Impact »', () => {
  it('le fichier est celui qui a été analysé ; un seul segment, joué tel quel (aucun montage)', () => {
    const f = readFileSync(`src/assets/audio/${data.file}`);
    expect(f.length).toBeGreaterThan(2_000_000);
    expect(WORLD3_PLAN.segments).toHaveLength(1);
    const [seg] = WORLD3_PLAN.segments;
    expect(seg.at).toBe(0);
    expect(seg.from).toBe(0);
    expect(seg.to).toBeCloseTo(WORLD3_PLAN.duration, 3);
    expect(WORLD3_PLAN.crossfade).toBe(0);
    expect(WORLD3_PLAN.duration).toBeGreaterThan(118);
    expect(WORLD3_PLAN.duration).toBeLessThan(121);
  });

  it('constantes de calage : l’univers dure 120 s, le morceau démarre pendant la transition d’entrée et son fondu se termine avant la faille de sortie', () => {
    expect(WORLD3_SPAN).toBe(WORLDS.span);
    expect(WORLD3_ENTRY_TRANSITION).toBe(WORLDS.transition);
    expect(WORLD3_START).toBeCloseTo(WORLDS.transition + WORLD3_AT, 9);
    expect(WORLD3_START).toBeGreaterThan(WORLD_TRANSITION_AUDIO.fadeInFrom);
    expect(WORLD3_START).toBeLessThan(WORLDS.transition);
    expect(WORLD3_FADE_IN).toBeGreaterThan(0.1);
    expect(WORLD3_FADE_IN).toBeLessThan(1);
    // Le fondu final commence dans les dernières secondes et le son est éteint avant l'ouverture de la faille de sortie
    expect(W3_FADE_START).toBeGreaterThan(WORLDS.span - 6);
    expect(W3_END_AUDIBLE).toBeLessThan(WORLDS.span);
    expect(W3_END_AUDIBLE).toBeGreaterThan(W3_FADE_START);
  });

  it('les tableaux sont triés, bornés et de tailles cohérentes ; les enveloppes couvrent le morceau', () => {
    for (const arr of [data.beats, data.hits, data.drops]) for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1]);
    expect(data.strength).toHaveLength(data.beats.length);
    expect(data.hitStrength).toHaveLength(data.hits.length);
    expect(data.dropStrength).toHaveLength(data.drops.length);
    for (const v of [...data.strength, ...data.hitStrength, ...data.dropStrength]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const [a, b] of [...data.builds, ...data.calm]) expect(b).toBeGreaterThan(a);
    expect(data.bass.length / 2).toBeCloseTo(WORLD3_PLAN.duration * data.envFps, -1);
    expect(MUSIC_MAP.tracks.w3.duration).toBeCloseTo(WORLD3_PLAN.duration, 6);
    expect(data.beats.length).toBeGreaterThan(240);
    expect(data.hits.length).toBeGreaterThan(500);
    expect(data.drops.length).toBeGreaterThanOrEqual(12);
  });

  it('la pulsation est régulière (≈ 129 pulsations/min) sur tout le morceau ; le seul écart notable suit l’attaque réelle du grand impact de la révélation', () => {
    expect(W3_BEAT_PERIOD).toBeCloseTo(60 / 129.4, 2);
    let long = 0;
    for (let i = 1; i < data.beats.length; i++) {
      const d = data.beats[i] - data.beats[i - 1];
      expect(d, `battement ${i}`).toBeGreaterThan(0.4);
      expect(d, `battement ${i}`).toBeLessThan(0.6);
      if (d > 0.52) long++;
    }
    expect(long).toBeLessThanOrEqual(2);
  });

  it('structure : introduction douce, plateau avec basses dès ≈ 30 s, creux vers 68 s, grande montée finale (impact maximal), rupture, dernier élan puis fondu', () => {
    expect(intensity3At(5)).toBeLessThan(0.3);
    expect(intensity3At(45)).toBeGreaterThan(0.45);
    // Creux du morceau vers 68 s
    expect(W3_CALM.some(([a, b]) => a < 69 && b > 68.5)).toBe(true);
    // Le plus grand impact est dans la montée finale
    const big = W3_DROP_STRENGTH.indexOf(Math.max(...W3_DROP_STRENGTH));
    expect(W3_DROP_STRENGTH[big]).toBeGreaterThanOrEqual(0.95);
    expect(W3_DROPS[big]).toBeGreaterThan(100);
    expect(W3_DROPS[big]).toBeLessThan(108);
    expect(W3_BUILDS.some(([a, b]) => a > 100 && b > 104)).toBe(true);
    // Rupture juste avant le dernier élan, et fondu final dans le calme
    expect(W3_CALM.some(([a, b]) => a > 106 && b < 112)).toBe(true);
    expect(W3_CALM.some(([a]) => a > 114)).toBe(true);
    // Les basses arrivent avec le plateau
    const early = W3_DROPS.filter((t) => t < 17).length;
    expect(early).toBe(0);
    expect(W3_DROPS.filter((t) => t > 30 && t < 60).length).toBeGreaterThanOrEqual(5);
  });
});

// ————————————————————————————————————————————— grille de rythme du gameplay

describe('La Mer nébulaire : grille de rythme (préparée à l’avance, jamais lue dans l’audio)', () => {
  it('battements, percussions et impacts sont ceux de la carte, en temps de jeu actif', () => {
    expect(WORLD_RHYTHM_DATA.beats3).toHaveLength(data.beats.length);
    expect(WORLD_RHYTHM_DATA.beats3[7]).toBeCloseTo(data.beats[7] + WORLD3_AT + T0, 3);
    expect(WORLD_RHYTHM_DATA.hits3).toHaveLength(data.hits.length);
    expect(WORLD_RHYTHM_DATA.drops3).toHaveLength(data.drops.length);
  });

  it('nextBeat / nextHit / nextAccent / nextImpact : premier repère ≥ t, jamais en arrière ; hors de l’univers, la grille ne répond pas', () => {
    for (let t = T0 + 2; t < T0 + 116; t += 0.37) {
      const b = WORLDS_RHYTHM.nextBeat(t);
      expect(b).toBeGreaterThanOrEqual(t);
      expect(b - t).toBeLessThan(0.55);
      expect(WORLDS_RHYTHM.nextHit!(t)).toBeGreaterThanOrEqual(t);
      expect(WORLDS_RHYTHM.nextAccent(t)).toBeGreaterThanOrEqual(t);
    }
    expect(WORLDS_RHYTHM.beatPeriodAt(T0 + 10)).toBeCloseTo(W3_BEAT_PERIOD, 6);
    expect(WORLDS_RHYTHM.nextImpact!(T0 + 30, 0.9)).toBeCloseTo(T0 + 104 - 0.3 + 0.0, 0); // le seul impact ≥ 0,9 est celui du final
    expect(WORLDS_RHYTHM.nextImpact!(T0 + 105.5, 0.9)).toBe(Infinity);
    expect(Number.isFinite(WORLDS_RHYTHM.nextImpact!(T0 + 30, 0.5))).toBe(true);
    expect(WORLDS_RHYTHM.nextImpact!(T0 + 119.9, 0.2)).toBe(Infinity);
    // Les autres univers ne répondent pas avec la grille de la Mer nébulaire
    expect(WORLDS_RHYTHM.nextImpact!(T0 + 130, 0.5)).toBe(Infinity);
    expect(WORLDS_RHYTHM.nextBeat(400)).toBe(400);
  });

  it('le calcul est pur : mêmes questions, mêmes réponses', () => {
    const q = [10.3, 55.1, 91.7, 118.2].map((x) => T0 + x);
    expect(q.map((t) => [WORLDS_RHYTHM.nextBeat(t), WORLDS_RHYTHM.nextHit!(t), WORLDS_RHYTHM.nextAccent(t)])).toEqual(q.map((t) => [WORLDS_RHYTHM.nextBeat(t), WORLDS_RHYTHM.nextHit!(t), WORLDS_RHYTHM.nextAccent(t)]));
  });
});

// ————————————————————————————————————————————— les cinq familles : brumes, ondes de pression, puits (champ de vitesse)

describe('La Mer nébulaire : brumes, ondes de pression et puits gravitationnels (champ de vitesse)', () => {
  const field = new WorldsField(1000);

  it('les ondes de pression partent EXACTEMENT sur de grands impacts de la carte, espacés, hors des calmes et achevées avant la faille', () => {
    expect(W3_WAVE_AT.length).toBeGreaterThanOrEqual(5);
    for (const at of W3_WAVE_AT) {
      const i = W3_DROPS.findIndex((d) => Math.abs(d - at) < 1e-9);
      expect(i, `impact ${at}`).toBeGreaterThanOrEqual(0);
      expect(W3_DROP_STRENGTH[i]).toBeGreaterThanOrEqual(W3_PRESSURE.minStrength);
      expect(inCalm3(at)).toBe(false);
      expect(at).toBeLessThanOrEqual(W3_PRESSURE.until);
    }
    for (let i = 1; i < W3_WAVE_AT.length; i++) expect(W3_WAVE_AT[i] - W3_WAVE_AT[i - 1]).toBeGreaterThanOrEqual(W3_PRESSURE.spacing - 1e-9);
    // Le plus fort des impacts du final en fait partie
    expect(W3_WAVE_AT.some((a) => Math.abs(a - W3_DROPS[W3_DROP_STRENGTH.indexOf(Math.max(...W3_DROP_STRENGTH))]) < 1e-9)).toBe(true);
    expect(field.waves).toHaveLength(W3_WAVE_AT.length);
    field.waves.forEach((w, i) => {
      expect(w.start).toBeCloseTo(T0 + W3_WAVE_AT[i], 9);
      expect(w.start - w.warnAt).toBeCloseTo(CLOUDS.wave.warn, 9);
      expect(w.end).toBeLessThan(T0 + WORLDS.span - 3);
    });
  });

  it('les puits gravitationnels sont calés sur des battements forts, un seul à la fois, annoncés à l’avance, surtout entre 70 et 100 s', () => {
    expect(W3_WELL_AT).toHaveLength(W3_WELLS.nominal.length);
    W3_WELL_AT.forEach((at, i) => {
      const k = W3_BEATS.findIndex((b) => Math.abs(b - at) < 1e-9);
      expect(k, `puits ${at}`).toBeGreaterThanOrEqual(0);
      expect(W3_BEAT_STRENGTH[k]).toBeGreaterThanOrEqual(W3_WELLS.minBeatStrength);
      expect(at).toBeGreaterThanOrEqual(W3_WELLS.nominal[i]);
      expect(at - W3_WELLS.nominal[i]).toBeLessThan(2);
    });
    expect(W3_WELL_AT.filter((a) => a >= 70 && a <= 100).length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < field.wells.length; i++) expect(field.wells[i].start).toBeGreaterThan(field.wells[i - 1].end);
    for (const w of field.wells) expect(w.start - w.warnAt).toBeCloseTo(W3_WELLS.warn, 9);
  });

  it('puits : plus vite dans son sens, plus lent à contre-sens, jamais de saut ; hors puits le champ est neutre dans les deux sens', () => {
    const w = field.wells[1];
    const t = w.start + 2;
    const fwd = field.factor(w.angle, t, w.spin);
    const bwd = field.factor(w.angle, t, (w.spin === 1 ? -1 : 1) as 1 | -1);
    expect(fwd).toBeGreaterThan(bwd);
    // Hors des nuages et des ondes, le puits agit pleinement
    expect(fwd).toBeGreaterThan(1.05);
    expect(bwd).toBeLessThan(0.95);
    // Progressivité : aucun saut entre deux images consécutives (60 Hz) ni entre deux angles voisins
    let worstT = 0;
    let worstA = 0;
    for (let tt = T0; tt < T0 + 119.9; tt += 1 / 60) {
      for (let a = 0; a < 6.3; a += 0.45) {
        const f0 = field.factor(a, tt, 1);
        worstT = Math.max(worstT, Math.abs(field.factor(a, tt + 1 / 60, 1) - f0));
        worstA = Math.max(worstA, Math.abs(field.factor(a + 0.03, tt, 1) - f0));
      }
    }
    expect(worstT).toBeLessThan(0.1);
    expect(worstA).toBeLessThan(0.25);
  });

  it('ralentissements cumulés bornés : jamais sous le plancher de la Mer nébulaire, jamais au-dessus du plafond, quel que soit le sens', () => {
    let min = 9;
    let max = 0;
    for (let tt = T0; tt < T0 + 120; tt += 0.25)
      for (let a = 0; a < 6.3; a += 0.1)
        for (const dir of [1, -1] as const) {
          const f = field.factor(a, tt, dir);
          min = Math.min(min, f);
          max = Math.max(max, f);
        }
    expect(min).toBeGreaterThanOrEqual(CLOUDS.clamp.min - 1e-12);
    expect(min).toBeLessThan(0.7);
    expect(max).toBeLessThanOrEqual(CLOUDS.clamp.max + 1e-12);
    expect(max).toBeGreaterThan(1.05);
  });

  it('brumes : plus présentes pendant la découverte (0–30 s) qu’en fin d’univers ; le champ est une fonction pure de la graine et du temps', () => {
    const count = (a: number, b: number): number => {
      let n = 0;
      for (let t = T0 + a; t < T0 + b; t += 1) n += field.cloudsAt(t).length;
      return n / (b - a);
    };
    expect(count(5, 30)).toBeGreaterThan(count(95, 118));
    const g = new WorldsField(1000);
    for (const t of [T0 + 10, T0 + 50, T0 + 90]) for (const a of [0.3, 2, 4]) expect(g.factor(a, t, 1)).toBe(field.factor(a, t, 1));
    const other = new WorldsField(7);
    expect(other.waves.map((w) => w.a0)).not.toEqual(field.waves.map((w) => w.a0));
  });
});

// ————————————————————————————————————————————— monolithes, procession, effondrement

describe('La Mer nébulaire : monolithes voyageurs et effondrement minéral, calés sur la musique', () => {
  it('seuls les monolithes (seuls, en procession, effondrement) sont tirés ; les anciennes attaques gazeuses sont retirées', () => {
    const seen = new Set<string>();
    for (let l = 0; l <= 120; l += 0.25) for (const [k, v] of Object.entries(world3Weights(l))) if (v && v > 0) seen.add(k);
    for (const k of seen) expect(FOUR).toContain(k);
    for (const k of FOUR) expect(seen.has(k), k).toBe(true);
    for (const old of ['gasMass', 'gasDrift', 'nebulaDebris', 'debrisVolley', 'massDebris', 'gasPair']) expect(Object.keys(PATTERNS)).not.toContain(old);
    const w = WORLD_LIST[2].weights(50);
    for (const k of Object.keys(w)) expect(FOUR).toContain(k);
    expect(WORLD_LIST[2].name).toBe('La Mer nébulaire');
    expect(WORLD_LIST[2].field).toBe('clouds');
  });

  it('progression : monolithes dès l’arrivée, procession puis effondrements ensuite, combinaison procession + effondrement seulement en fin d’univers', () => {
    expect(world3Weights(1).monolith).toBeGreaterThan(0);
    expect(world3Weights(1).collapse ?? 0).toBe(0);
    expect(world3Weights(40).collapse).toBeGreaterThan(0.5);
    expect(world3Weights(40).processionCollapse ?? 0).toBe(0);
    expect(world3Weights(100).processionCollapse).toBeGreaterThan(0);
  });

  it('aucun danger ne peut être lancé de façon à toucher l’orbite pendant un calme (poids nuls dans la fenêtre de contact)', () => {
    for (const [a, b] of W3_CALM) {
      for (let l = a - CONTACT_LEAD3.max + 0.01; l < b - CONTACT_LEAD3.min; l += 0.2) {
        if (l < 0) continue;
        expect(Object.values(world3Weights(l)).every((v) => !v), `l = ${l.toFixed(2)}`).toBe(true);
        expect(calmAhead3(l)).toBe(true);
      }
    }
  });

  /** Parties du robot sur l'univers 3 : tous les dangers, vus une seule fois. */
  function play(seed: number): { hazards: Hazard[]; state: string; time: number; waves: { t: number; id: string }[]; maxLive: number } {
    const sim = createSimulation({ mode: 'survival', seed, worlds: true, bonus: false });
    const bot = new Bot(sim, true);
    const seen = new Set<number>();
    const out: Hazard[] = [];
    const waves: { t: number; id: string }[] = [];
    sim.director.onWave = (t, id) => {
      if (t >= T0 && t < worldStart(3)) waves.push({ t: t - T0, id });
    };
    let maxLive = 0;
    while (sim.state === 'running' && sim.time < worldStart(3)) {
      bot.tick();
      sim.step();
      sim.events.length = 0;
      if (sim.world !== 3) continue;
      let live = 0;
      for (const h of sim.hazards) {
        if (h.threatEnd >= sim.time) live++;
        if (seen.has(h.id)) continue;
        seen.add(h.id);
        out.push({ ...h });
      }
      maxLive = Math.max(maxLive, live);
    }
    return { hazards: out, state: sim.state, time: sim.time, waves, maxLive };
  }
  const games = [1000, 8919, 16838].map(play);
  const projectiles = (g: (typeof games)[number]): ProjectileHazard[] => g.hazards.filter((h): h is ProjectileHazard => h.kind === 'projectile');

  it('le robot traverse les 120 s sans mourir ; les quatre motifs (trois familles de dangers) apparaissent ; rien d’autre', () => {
    const kinds = new Set<string>();
    for (const g of games) {
      expect(g.state).toBe('running');
      for (const h of g.hazards) kinds.add(h.pattern);
    }
    for (const k of ['monolith', 'procession', 'collapse']) expect(kinds.has(k), k).toBe(true);
    for (const k of kinds) expect(FOUR).toContain(k);
  });

  it('densité raisonnable : quelques événements marquants (20 à 36 vagues), jamais d’écran surchargé', () => {
    for (const g of games) {
      expect(g.waves.length).toBeGreaterThanOrEqual(20);
      expect(g.waves.length).toBeLessThanOrEqual(36);
      expect(g.maxLive).toBeLessThanOrEqual(8);
    }
  });

  it('plus aucune vague dans les dernières secondes (l’approche de la faille reste sûre) ; la découverte commence par des monolithes seuls', () => {
    for (const g of games) {
      for (const w of g.waves) expect(w.t).toBeLessThan(WORLDS.span - WORLDS.quietBefore + 1e-6);
      expect(g.waves[0].id).toBe('monolith');
      expect(g.waves.filter((w) => w.t < 14).every((w) => w.id === 'monolith')).toBe(true);
    }
  });

  it('toute menace est annoncée à l’avance, et rien ne touche l’orbite pendant un passage calme du morceau', () => {
    for (const g of games)
      for (const h of projectiles(g)) {
        expect(h.launch - h.warnStart).toBeGreaterThanOrEqual(1.4);
        const contact = firstOrbitContact(h) - T0;
        for (const [a, b] of W3_CALM) expect(contact < a - 1e-6 || contact >= b - 1e-6, `contact ${contact.toFixed(2)} dans le calme ${a.toFixed(1)}–${b.toFixed(1)}`).toBe(true);
      }
  });

  it('procession : 2 ou 3 monolithes sur la même trajectoire, chacun franchissant l’orbite sur un battement (premier contact calé sur la grille quand elle est proche)', () => {
    let groups = 0;
    let aligned = 0;
    for (const g of games) {
      const byWave = new Map<string, ProjectileHazard[]>();
      for (const h of projectiles(g)) if (h.pattern === 'procession') byWave.set(h.warnStart.toFixed(4), [...(byWave.get(h.warnStart.toFixed(4)) ?? []), h]);
      for (const group of byWave.values()) {
        groups++;
        expect(group.length).toBeGreaterThanOrEqual(2);
        expect(group.length).toBeLessThanOrEqual(W3_ATTACKS.procession.count.max);
        const first = group.reduce((m, h) => Math.min(m, firstOrbitContact(h)), Infinity);
        if (W3_BEATS.some((b) => Math.abs(b + T0 - first) < 1e-3)) aligned++;
        // Même trajectoire, un intervalle de deux battements
        const sorted = [...group].sort((a, b) => a.launch - b.launch);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].x0).toBeCloseTo(sorted[0].x0, 6);
          expect(sorted[i].launch - sorted[i - 1].launch).toBeGreaterThanOrEqual(0.69);
        }
      }
    }
    expect(groups).toBeGreaterThanOrEqual(6);
    expect(aligned / groups).toBeGreaterThan(0.7);
  });

  it('effondrement : le bloc se brise sur un battement de la grille, et sur un grand impact de la carte quand il en existe un dans l’attente permise ; 2 ou 3 fragments annoncés partent de la rupture', () => {
    let blocks = 0;
    let onImpact = 0;
    let onBeat = 0;
    for (const g of games) {
      const ps = projectiles(g).filter((h) => h.pattern === 'collapse');
      for (const m of ps.filter((h) => h.split)) {
        blocks++;
        const frags = ps.filter((h) => h.fragment && Math.abs(h.launch - m.split!.t) < 1e-6);
        expect(frags.length).toBeGreaterThanOrEqual(W3_ATTACKS.collapse.fragments.min);
        expect(frags.length).toBeLessThanOrEqual(W3_ATTACKS.collapse.fragments.max);
        for (const f of frags) {
          expect(f.scale).toBeCloseTo(W3_ATTACKS.collapse.fragScale, 9);
          expect(f.warnStart).toBeLessThanOrEqual(m.launch);
          expect(f.x0).toBeCloseTo(m.split!.x, 6);
        }
        const local = m.split!.t - T0;
        const i = W3_DROPS.findIndex((d) => Math.abs(d - local) < 1e-3);
        if (i >= 0 && W3_DROP_STRENGTH[i] >= W3_ATTACKS.collapse.minImpact) onImpact++;
        if (W3_BEATS.some((b) => Math.abs(b - local) < 1e-3)) onBeat++;
      }
    }
    expect(blocks).toBeGreaterThanOrEqual(6);
    expect(onBeat / blocks).toBeGreaterThan(0.9);
    expect(onImpact).toBeGreaterThanOrEqual(3);
  });

  it('déterminisme : deux parties de même graine donnent exactement les mêmes dangers, sans aucun audio', () => {
    const sig = (g: ReturnType<typeof play>): string[] => g.hazards.map((h) => `${h.pattern}:${h.warnStart.toFixed(4)}:${h.kind === 'projectile' ? h.launch.toFixed(4) : ''}`);
    expect(sig(play(1000))).toEqual(sig(games[0]));
  });

  it('le gameplay de la Mer nébulaire n’importe aucun module audio, ambiance ou rendu, et n’utilise pas l’éclipse', () => {
    for (const f of ['src/config/world3.ts', 'src/sim/patterns.ts', 'src/sim/director.ts', 'src/sim/field.ts', 'src/modes/worlds.ts', 'src/config/worlds.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from '\.\.?\/(audio|ambience|render|ui)\//);
      expect(src, f).not.toMatch(/AudioContext|currentTime|musicSync/);
    }
    for (const f of readdirSync('src/sim')) {
      const src = readFileSync(`src/sim/${f}`, 'utf8');
      expect(src, f).not.toMatch(/world3\.json|polar-rift-world3|eclipseAt|W3_ECLIPSE/);
    }
  });
});

// ————————————————————————————————————————————— événement spécial : l'Éclipse des géants

describe('La Mer nébulaire : l’Éclipse des géants (événement visuel unique)', () => {
  const e = (l: number): EclipseState => eclipseAt(l, { mass: 0, dark: 0, scatter: 0, flash: 0, glow: 0, active: false });
  const reveal = W3_ECLIPSE.reveal + WORLD3_AT;
  const start = W3_ECLIPSE.start + WORLD3_AT;

  it('elle se révèle exactement sur un grand impact de la carte, après le creux du morceau, dans la fenêtre 70–100 s', () => {
    expect(W3_DROPS.some((d, i) => Math.abs(d - reveal) < 0.015 && W3_DROP_STRENGTH[i] >= 0.6)).toBe(true);
    expect(start).toBeGreaterThanOrEqual(70);
    expect(reveal).toBeLessThanOrEqual(101);
    // Creux musical juste avant la révélation (basses faibles : le plus profond de la pénombre)
    expect(intensity3At(reveal - 1.5)).toBeLessThan(intensity3At(reveal - 8));
  });

  it('progressive : la masse avance, la pénombre s’installe, jamais au-delà de la profondeur prévue ; événement unique', () => {
    expect(e(start - 1).active).toBe(false);
    let prevMass = -1;
    let prevDark = -1;
    for (let l = start + 0.1; l < reveal - 0.1; l += 0.25) {
      const s = e(l);
      expect(s.active).toBe(true);
      expect(s.mass).toBeGreaterThanOrEqual(prevMass - 1e-12);
      expect(s.dark).toBeGreaterThanOrEqual(prevDark - 1e-12);
      expect(s.dark).toBeLessThanOrEqual(W3_ECLIPSE.depth + 1e-9);
      expect(s.flash).toBe(0);
      prevMass = s.mass;
      prevDark = s.dark;
    }
    expect(e(reveal - 0.1).dark).toBeGreaterThan(0.45 * W3_ECLIPSE.depth);
    // Après la dispersion : plus rien, jusqu'à la fin de l'univers
    for (let l = reveal + W3_ECLIPSE.scatter + 0.5; l < 125; l += 1) expect(e(l).active).toBe(false);
  });

  it('révélation : éclat maximal sur l’impact, la pénombre disparaît d’un coup, la masse se disperse, la lumière revient puis retombe', () => {
    const r = e(reveal + 0.001);
    expect(r.flash).toBeGreaterThan(0.95);
    expect(r.dark).toBe(0);
    expect(r.scatter).toBeLessThan(0.05);
    expect(e(reveal + 1).flash).toBeLessThan(0.2);
    expect(e(reveal + 3.5).scatter).toBeGreaterThan(0.3);
    expect(e(reveal + 6).glow).toBeGreaterThan(0.5);
    expect(e(reveal + 6).glow).toBeGreaterThan(e(reveal + 0.5).glow);
    expect(e(reveal + 14.5).glow).toBe(0);
  });
});

// ————————————————————————————————————————————— lecture de la carte à la position entendue

describe('La Mer nébulaire : synchronisation de la carte sur la position de lecture', () => {
  const pos = (m: number, playing = true): MusicPosition => ({ track: 'w3', time: m, playing });

  it('à 60 images/s, chaque battement, percussion et impact de la carte est franchi une seule fois, au plus une image après l’instant entendu, jamais en avance', () => {
    const sync = new MusicSync();
    const lead = AMBIENCE.music.lead;
    const m = MUSIC_MAP.tracks.w3;
    let beats = 0;
    let hits = 0;
    let impacts = 0;
    const beatSeen: number[] = [];
    const hitSeen: number[] = [];
    sync.update(pos(0), true);
    for (let k = 1; k * FRAME < WORLD3_PLAN.duration - lead; k++) {
      const t = k * FRAME;
      const f = sync.update(pos(t), true);
      if (f.beat > 0) {
        beats++;
        beatSeen.push(t + lead);
      }
      if ((f.perc ?? 0) > 0) {
        hits++;
        hitSeen.push(t + lead);
      }
      if ((f.impact ?? 0) > 0) impacts++;
    }
    const horizon = Math.floor((WORLD3_PLAN.duration - lead) / FRAME) * FRAME;
    const expBeats = Array.from(m.beats).filter((t, i) => t - lead > 0 && t - lead <= horizon && m.strength[i] > 0);
    const expHits = Array.from(m.hits!).filter((t, i) => t - lead > 0 && t - lead <= horizon && m.hitStrength![i] > 0);
    const expDrops = Array.from(m.drops).filter((t) => t - lead > 0 && t - lead <= horizon);
    expect(beats).toBe(expBeats.length);
    expect(hits).toBe(expHits.length);
    expect(impacts).toBe(expDrops.length);
    let worstBeat = 0;
    let worstHit = 0;
    for (let i = 0; i < beatSeen.length; i++) {
      worstBeat = Math.max(worstBeat, beatSeen[i] - expBeats[i]);
      expect(beatSeen[i]).toBeGreaterThanOrEqual(expBeats[i] - 1e-9);
    }
    for (let i = 0; i < hitSeen.length; i++) worstHit = Math.max(worstHit, hitSeen[i] - expHits[i]);
    expect(worstBeat).toBeLessThanOrEqual(FRAME + 1e-9);
    expect(worstHit).toBeLessThanOrEqual(FRAME + 1e-9);
  });

  it('pause, musique coupée ou sourdine : aucune réaction ; une reprise plus loin ne rejoue aucun repère manqué', () => {
    const sync = new MusicSync();
    for (let t = 20; t < 25; t += FRAME) sync.update(pos(t), true);
    for (let i = 0; i < 60; i++) {
      const f = sync.update(pos(25, false), true);
      expect(f.active).toBe(false);
      expect(f.beat + (f.perc ?? 0) + (f.impact ?? 0)).toBe(0);
    }
    const f = sync.update(pos(65), true);
    expect(f.beat + (f.perc ?? 0) + (f.impact ?? 0)).toBe(0);
    for (let t = 38; t < 42; t += FRAME) {
      const g = sync.update(pos(t), false);
      expect(g.active).toBe(false);
      expect(g.bass).toBe(0);
      expect(g.beat + (g.perc ?? 0)).toBe(0);
    }
  });

  it('passages calmes de la carte : le creux de 68 s et la rupture avant le dernier élan', () => {
    const sync = new MusicSync();
    const a = sync.update(pos(68.5), true).calm;
    const b = sync.update(pos(50), true).calm;
    const c = sync.update(pos(109.5), true).calm;
    expect(a).toBe(1);
    expect(b).toBe(0);
    expect(c).toBe(1);
  });
});

// ————————————————————————————————————————————— réactions du décor

describe('La Mer nébulaire : réactions du décor à la musique', () => {
  const world3 = { phase: 1 as const, transit: 0, phased: true, world: { index: 3, to: 3 } };
  const frame = (o: Partial<MusicFrame> = {}): MusicFrame => ({ active: true, track: 'w3', bass: 0, intensity: 0, beat: 0, hit: 0, drop: false, perc: 0, impact: 0, calm: 0, build: 0, ...o });
  const at = (l: number): number => T0 + l;

  function settle(d: AmbienceDirector, f: MusicFrame, l: number, seconds: number, ph = world3): void {
    for (let t = 0; t < seconds; t += FRAME) d.update(at(l), FRAME, { ...f, drop: false, beat: 0, perc: 0, impact: 0 }, false, 1, ph);
  }

  it('basses : le décor réagit proportionnellement ; sans musique il ne bat pas du tout', () => {
    const d = new AmbienceDirector(() => 0.5);
    settle(d, frame({ bass: 0.8, intensity: 0.6 }), 40, 4);
    expect(d.state.bass).toBeGreaterThan(0.5);
    expect(d.state.world).toBe(3);
    expect(d.state.amt[2]).toBeCloseTo(1, 6);
    const e = new AmbienceDirector(() => 0.5);
    settle(e, frame({ active: false, track: null, bass: 0.9 }), 40, 1.5);
    expect(e.state.bass).toBe(0);
    expect(e.state.perc).toBe(0);
  });

  it('percussions : impulsion proportionnelle à la force, retombée rapide, jamais d’éclair dans la nébuleuse', () => {
    const d = new AmbienceDirector(() => 0.01); // tirage favorable aux éclairs : il ne doit pas en naître
    d.update(at(40), FRAME, frame({ perc: 0.8, intensity: 0.5 }), false, 1, world3);
    expect(d.state.perc).toBeCloseTo(0.8, 1);
    expect(d.state.spawnArcs).toBe(0);
    settle(d, frame({ intensity: 0.5 }), 40, 1);
    expect(d.state.perc).toBeLessThan(0.01);
    const w = new AmbienceDirector(() => 0.5);
    w.update(at(40), FRAME, frame({ perc: 0.3, intensity: 0.5 }), false, 1, world3);
    expect(w.state.perc).toBeCloseTo(0.3, 1);
  });

  it('impacts : décharge proportionnelle à leur force ; montées : le décor s’anime ; calmes : tout s’apaise', () => {
    const small = new AmbienceDirector(() => 0.5);
    const big = new AmbienceDirector(() => 0.5);
    small.update(at(40), FRAME, frame({ drop: true, impact: 0.4, intensity: 0.5 }), false, 1, world3);
    big.update(at(40), FRAME, frame({ drop: true, impact: 1, intensity: 0.5 }), false, 1, world3);
    expect(big.state.drop).toBeGreaterThan(small.state.drop * 1.2);
    expect(big.state.spawnWave).toBeGreaterThan(small.state.spawnWave);
    const b = new AmbienceDirector(() => 0.5);
    settle(b, frame({ build: 1, intensity: 0.8 }), 104, 2);
    expect(b.state.build).toBeGreaterThan(0.8);
    const calm = new AmbienceDirector(() => 0.5);
    settle(calm, frame({ intensity: 0.1, calm: 1 }), 68.5, 2);
    expect(calm.state.calm).toBeGreaterThan(0.9);
  });

  it('éclipse : lue dans le temps de jeu local (jamais dans l’audio), unique, éteinte hors de l’univers 3 et pendant les transitions', () => {
    const d = new AmbienceDirector(() => 0.5);
    d.update(at(80), FRAME, frame(), false, 1, world3);
    expect(d.state.eclipse.active).toBe(false);
    d.update(at(95), FRAME, frame(), false, 1, world3);
    expect(d.state.eclipse.active).toBe(true);
    expect(d.state.eclipse.dark).toBeGreaterThan(0.2);
    // Même instant, musique coupée : exactement le même état d'éclipse
    const mute = new AmbienceDirector(() => 0.5);
    mute.update(at(95), FRAME, frame({ active: false, track: null }), false, 1, world3);
    expect(mute.state.eclipse).toEqual(d.state.eclipse);
    d.update(at(WORLD3_ECLIPSE_REVEAL() + 0.01), FRAME, frame(), false, 1, world3);
    expect(d.state.eclipse.flash).toBeGreaterThan(0.9);
    // Pendant la transition vers l'univers 4 et dans les autres univers : aucune éclipse
    d.update(at(95), FRAME, frame(), false, 1, { phase: 1, transit: 0.4, phased: true, world: { index: 3, to: 4 } });
    expect(d.state.eclipse.active).toBe(false);
    d.update(95, FRAME, frame(), false, 1, { phase: 1, transit: 0, phased: true, world: { index: 1, to: 1 } });
    expect(d.state.eclipse.active).toBe(false);
  });

  it('paramètres de la Mer nébulaire imposés au décor ; sortie vers les vents : brume qui vire à l’orange, tourbillon accéléré', () => {
    const d = new AmbienceDirector(() => 0.5);
    settle(d, frame({ intensity: 0.5 }), 40, 0.5);
    for (const k of ['bassGain', 'beatGain', 'ringChance', 'waveGain', 'boltChance', 'arcRate'] as const) expect(d.state.p[k]).toBeCloseTo(AMBIENCE.world3.params[k], 6);
    expect(d.state.p.arcRate).toBe(0);
    const exit = { phase: 1 as const, transit: 0.35, phased: true, world: { index: 3, to: 4 } };
    d.update(at(120), FRAME, frame(), false, 1, exit);
    expect(d.state.variant).toBe('spiral');
    expect(d.state.riftTo).toBe(0xff8a2a);
  });

  it('effets réduits : la nébuleuse reste (mouvement atténué) ; intensité visuelle à zéro : le décor s’éteint', () => {
    const d = new AmbienceDirector(() => 0.01);
    d.update(at(40), FRAME, frame({ perc: 1, intensity: 0.5 }), true, 1, world3);
    expect(d.state.reduced).toBe(true);
    expect(d.state.spawnArcs).toBe(0);
    const u = new AmbienceDirector(() => 0.01);
    u.update(at(40), FRAME, frame({ perc: 1, intensity: 0.5 }), false, 0, world3);
    expect(u.state.user).toBe(0);
  });
});

function WORLD3_ECLIPSE_REVEAL(): number {
  return W3_ECLIPSE.reveal + WORLD3_AT;
}

// ————————————————————————————————————————————— lecture audio du morceau (faux contexte)

describe('La Mer nébulaire : lecture du morceau sur l’horloge audio', () => {
  function setup(withBuffer = true) {
    const ctx = new FakeCtx();
    const out = new FakeNode();
    const host: AudioHost = { context: () => ctx as unknown as BaseAudioContext, output: () => out as unknown as AudioNode };
    const buffers = { intro: buf('intro'), loop: buf('loop'), outro: buf('outro'), world2: buf('world2'), ...(withBuffer ? { world3: buf('world3') } : {}) };
    const wm = new WorldMusic(host, () => buffers);
    const pos = (): MusicPosition => wm.position({ track: null, time: 0, playing: false } as MusicPosition);
    return { ctx, wm, pos };
  }
  const voices = (ctx: FakeCtx) => ctx.sources.filter((s) => nameOf(s) === 'world3');

  it('transition 2 → 3 : une seule voix programmée sur l’horloge audio, démarrée avant l’émergence au début du fichier, avec un fondu d’entrée', () => {
    const { ctx, wm, pos } = setup();
    ctx.currentTime = 50;
    wm.startGame(2, 60);
    ctx.currentTime = 52;
    wm.transition(3);
    const v = voices(ctx);
    expect(v).toHaveLength(1);
    // La voix démarre `WORLD3_START` s après le début de la transition, à la première note du fichier
    expect(v[0].starts[0].when).toBeCloseTo(52 + WORLD3_START, 6);
    expect(v[0].starts[0].offset).toBe(0);
    const g = (v[0].connections[0] as { gain: { events: { type: string; value: number; time: number }[] } }).gain.events;
    expect(g.find((e) => e.type === 'ramp' && e.value === 1)!.time).toBeCloseTo(52 + WORLD3_START + WORLD3_FADE_IN, 6);
    // Position entendue : temps du fichier
    ctx.currentTime = 52 + WORLD3_START + 10;
    const p = pos();
    expect(p.track).toBe('w3');
    expect(p.time).toBeCloseTo(10, 1);
    // Avant la première note : aucune musique
    ctx.currentTime = 52 + WORLD3_START - 0.5;
    expect(pos().track).toBeNull();
  });

  it('saut de test en pleine musique : la voix est calée dans le fichier au temps local + calage du morceau', () => {
    const { ctx, wm } = setup();
    wm.startGame(3, 60);
    const v = voices(ctx);
    expect(v).toHaveLength(1);
    expect(v[0].starts[0].offset).toBeCloseTo(60 + WORLDS.transition - WORLD3_START, 3);
  });

  it('pause puis reprise : position conservée ; après la fin audible : aucune position ; sans fichier décodé : silence, aucune erreur', () => {
    const { ctx, wm, pos } = setup();
    wm.startGame(3, 0);
    ctx.currentTime = 0.5 + 40;
    const before = pos();
    expect(before.track).toBe('w3');
    wm.pause();
    ctx.currentTime += 30;
    const paused = pos();
    expect(paused.playing).toBe(false);
    expect(paused.time).toBeCloseTo(before.time, 6);
    const n = ctx.sources.length;
    wm.resume();
    const fresh = ctx.sources.slice(n).filter((s) => nameOf(s) === 'world3');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].starts[0].offset).toBeCloseTo(before.time, 2);
    ctx.currentTime += WORLD3_PLAN.duration + 5;
    expect(pos().track).toBeNull();
    const silent = setup(false);
    expect(() => silent.wm.startGame(3, 10)).not.toThrow();
    expect(voices(silent.ctx)).toHaveLength(0);
    expect(silent.pos().track).toBeNull();
  });

  it('mort puis reprise payée : la musique repart là où elle s’était arrêtée ; l’univers 3 n’a plus de fond procédural', () => {
    const { ctx, wm } = setup();
    wm.startGame(3, 0);
    ctx.currentTime = 20;
    wm.endGame();
    ctx.currentTime += 3;
    const n = ctx.sources.length;
    expect(wm.resumeAfterDeath()).toBe(true);
    expect(ctx.sources.slice(n).filter((s) => nameOf(s) === 'world3')).toHaveLength(1);
    expect(WORLD_MUSIC[3].pad).toBeNull();
    expect(WORLD_MUSIC[3].track).toBe('world3');
  });
});
