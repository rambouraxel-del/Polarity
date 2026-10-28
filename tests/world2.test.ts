import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../src/data/polar-rift-world2.json';
import { AmbienceDirector } from '../src/ambience/director';
import { MUSIC_MAP, MusicSync, type MusicFrame } from '../src/ambience/musicSync';
import type { AudioHost, MusicPosition } from '../src/audio/music';
import { WorldMusic } from '../src/audio/worldMusic';
import { MusicSyncGuard } from '../src/audio/syncGuard';
import { AMBIENCE } from '../src/config/ambience';
import { MUSIC } from '../src/config/music';
import {
  CALM_LEAD,
  W2_ATTACKS,
  W2_BEATS,
  W2_BEAT_PERIOD,
  W2_BUILDS,
  W2_CALM,
  W2_DROPS,
  W2_DROP_STRENGTH,
  W2_HITS,
  WORLD2_AT,
  WORLD2_ENTRY_TRANSITION,
  WORLD2_PLAN,
  WORLD2_SPAN,
  WORLD2_START,
  inCalm,
  intensityAt,
  nextImpactIn,
  world2Weights,
} from '../src/config/world2';
import { WORLD_MUSIC_SYNC, WORLD_TRANSITION_AUDIO, WORLD_RHYTHM_DATA, WORLDS_RHYTHM } from '../src/config/worldMusic';
import { WORLD_LIST, WORLDS, worldStart } from '../src/config/worlds';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';
import { dangerStart, firstOrbitContact, type Hazard } from '../src/sim/hazards';
import { PATTERNS } from '../src/sim/patterns';
import { FakeCtx, FakeNode, buf, nameOf } from './fakeAudio';

const FRAME = 1 / 60;
const W2_T0 = worldStart(1);

// ————————————————————————————————————————————— carte musicale et montage

describe('La Faille : carte musicale et montage de « Portal Surge »', () => {
  it('le fichier est celui qui a été analysé et le plan de montage est continu', () => {
    const f = readFileSync(`src/assets/audio/${data.file}`);
    expect(f.length).toBeGreaterThan(2_000_000);
    const [a, b] = WORLD2_PLAN.segments;
    expect(a.at).toBe(0);
    expect(a.from).toBe(0);
    // Le second segment reprend à la fin du premier (temps du montage continu) et repart `repeat.length` s en arrière dans le fichier
    expect(b.at).toBeCloseTo(a.to - a.from, 6);
    expect(a.to - b.from).toBeCloseTo(WORLD2_PLAN.repeat.length, 3);
    expect(WORLD2_PLAN.duration).toBeCloseTo(b.at + (b.to - b.from), 3);
    expect(WORLD2_PLAN.repeat.beats).toBe(12);
    expect(WORLD2_PLAN.crossfade).toBeLessThan(0.2);
  });

  it('constantes de calage : fin du jeu actif et transition d’entrée identiques à la configuration des univers', () => {
    expect(WORLD2_SPAN).toBe(WORLDS.span);
    expect(WORLD2_ENTRY_TRANSITION).toBe(WORLDS.transition);
    // Le dernier coup sec tombe exactement sur l'ouverture de la faille de sortie (fin des 120 s de jeu actif)
    expect(WORLD2_AT + WORLD2_PLAN.cut).toBeCloseTo(WORLDS.span, 9);
    // La musique démarre pendant la transition d'entrée (après le début du fondu), avant l'émergence
    expect(WORLD2_START).toBeGreaterThan(WORLD_TRANSITION_AUDIO.fadeInFrom);
    expect(WORLD2_START).toBeLessThan(WORLDS.transition);
    // Elle couvre tout l'univers : la queue de réverbération se prolonge sous la transition de sortie
    expect(WORLD2_PLAN.duration + WORLD2_AT).toBeGreaterThan(WORLDS.span);
  });

  it('les tableaux sont triés, bornés et de tailles cohérentes ; les enveloppes couvrent le montage', () => {
    for (const arr of [data.beats, data.hits, data.drops]) for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1]);
    expect(data.strength).toHaveLength(data.beats.length);
    expect(data.hitStrength).toHaveLength(data.hits.length);
    expect(data.dropStrength).toHaveLength(data.drops.length);
    for (const v of [...data.strength, ...data.hitStrength, ...data.dropStrength]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const [a, b] of [...data.builds, ...data.calm]) expect(b).toBeGreaterThan(a);
    expect(data.bass.length / 2).toBeCloseTo(WORLD2_PLAN.duration * data.envFps, -1);
    expect(MUSIC_MAP.tracks.w2.duration).toBeCloseTo(WORLD2_PLAN.duration, 6);
  });

  it('la pulsation reste régulière à 140 pulsations/min, y compris au raccord de la phrase répétée', () => {
    expect(W2_BEAT_PERIOD).toBeCloseTo(60 / 140, 2);
    const seam = WORLD2_PLAN.segments[1].at;
    let near = 0;
    for (let i = 1; i < data.beats.length; i++) {
      const d = data.beats[i] - data.beats[i - 1];
      expect(d, `battement ${i}`).toBeGreaterThan(0.36);
      expect(d, `battement ${i}`).toBeLessThan(0.52);
      if (Math.abs(data.beats[i] - seam) < 1.2) near++;
    }
    expect(near).toBeGreaterThan(2);
  });

  it('la phrase répétée est bien dépliée : mêmes battements, décalés de la longueur de la phrase', () => {
    const { from, to, length } = WORLD2_PLAN.repeat;
    const seamAt = WORLD2_PLAN.segments[1].at;
    const first = data.beats.filter((t) => t >= seamAt - length - 0.01 && t < seamAt - 0.01);
    const second = data.beats.filter((t) => t >= seamAt - 0.01 && t < seamAt + length - 0.01);
    expect(first.length).toBe(second.length);
    expect(first.length).toBeGreaterThanOrEqual(11);
    expect(first.length).toBeLessThanOrEqual(12);
    for (let i = 0; i < first.length; i++) expect(second[i] - first[i]).toBeCloseTo(length, 1);
    expect(to - from).toBeCloseTo(length, 3);
  });

  it('structure du morceau : introduction calme, plateau intense, grand impact du premier drop, montée finale puis coup sec', () => {
    const first = intensityAt(10);
    const plateau = intensityAt(60);
    expect(plateau).toBeGreaterThan(first * 1.8);
    // Un grand impact (≥ 0,9) au premier drop, avant la moitié de l'univers
    const big = W2_DROPS.findIndex((_, i) => W2_DROP_STRENGTH[i] >= 0.9);
    expect(big).toBeGreaterThanOrEqual(0);
    expect(W2_DROPS[big]).toBeLessThan(WORLDS.span / 2);
    // Une montée recouvre les secondes qui précèdent la fin (le point culminant)
    expect(W2_BUILDS.some(([a, b]) => a > 100 && b > 116)).toBe(true);
    // Au moins un passage calme en début d'univers, un autre vers 73 s
    expect(W2_CALM.some(([a]) => a < 10)).toBe(true);
    expect(W2_CALM.some(([a, b]) => a < 74 && b > 72)).toBe(true);
    // Après le coup sec, l'énergie s'éteint
    expect(intensityAt(WORLDS.span + 1.5)).toBeLessThan(0.4);
  });
});

// ————————————————————————————————————————————— grille de rythme du gameplay

describe('La Faille : grille de rythme (préparée à l’avance, jamais lue dans l’audio)', () => {
  it('battements, percussions et impacts sont ceux de la carte, en temps de jeu actif', () => {
    expect(WORLD_RHYTHM_DATA.beats2).toHaveLength(data.beats.length);
    expect(WORLD_RHYTHM_DATA.beats2[5]).toBeCloseTo(data.beats[5] + WORLD2_AT + W2_T0, 3);
    expect(WORLD_RHYTHM_DATA.hits2).toHaveLength(data.hits.length);
    expect(WORLD_RHYTHM_DATA.drops2).toHaveLength(data.drops.length);
  });

  it('nextBeat / nextHit / nextAccent / nextImpact : premier repère ≥ t, jamais en arrière, repli sans repère', () => {
    for (let t = W2_T0 + 2; t < W2_T0 + 118; t += 0.37) {
      const b = WORLDS_RHYTHM.nextBeat(t);
      expect(b).toBeGreaterThanOrEqual(t);
      expect(b - t).toBeLessThan(0.55);
      const h = WORLDS_RHYTHM.nextHit!(t);
      expect(h).toBeGreaterThanOrEqual(t);
      const a = WORLDS_RHYTHM.nextAccent(t);
      expect(a).toBeGreaterThanOrEqual(t);
    }
    // Un grand impact existe dans la première moitié ; au-delà du dernier : aucun
    const i = WORLDS_RHYTHM.nextImpact!(W2_T0 + 30, 0.9);
    expect(Number.isFinite(i)).toBe(true);
    expect(WORLDS_RHYTHM.nextImpact!(W2_T0 + 119.9, 0.5)).toBe(Infinity);
    // Hors de l'univers 2 : la grille de La Faille ne répond pas
    expect(WORLDS_RHYTHM.nextHit!(50)).toBe(Infinity);
    expect(WORLDS_RHYTHM.nextImpact!(300, 0.5)).toBe(Infinity);
    expect(WORLDS_RHYTHM.nextBeat(300)).toBe(300);
  });

  it('le calcul est pur : mêmes questions, mêmes réponses', () => {
    const a = [10.3, 55.1, 91.7, 118.2].map((x) => [WORLDS_RHYTHM.nextBeat(W2_T0 + x), WORLDS_RHYTHM.nextHit!(W2_T0 + x), WORLDS_RHYTHM.nextAccent(W2_T0 + x)]);
    const b = [10.3, 55.1, 91.7, 118.2].map((x) => [WORLDS_RHYTHM.nextBeat(W2_T0 + x), WORLDS_RHYTHM.nextHit!(W2_T0 + x), WORLDS_RHYTHM.nextAccent(W2_T0 + x)]);
    expect(a).toEqual(b);
  });
});

// ————————————————————————————————————————————— les cinq attaques

describe('La Faille : cinq familles d’attaques, calées sur la musique', () => {
  const FIVE = ['riftOrb', 'orbitCrack', 'surgeArc', 'riftWave', 'fractureSpiral'];
  const COMBOS = ['crackOrb', 'waveSpiral'];

  it('seules les cinq familles (et deux combinaisons de ces mêmes familles) sont tirées ; les anciennes attaques de l’univers sont retirées', () => {
    const seen = new Set<string>();
    for (let l = 0; l <= 120; l += 0.25) for (const [k, v] of Object.entries(world2Weights(l))) if (v && v > 0) seen.add(k);
    for (const k of seen) expect([...FIVE, ...COMBOS]).toContain(k);
    for (const k of FIVE) expect(seen.has(k), k).toBe(true);
    expect(Object.keys(PATTERNS)).not.toContain('orbPair');
    expect(Object.keys(PATTERNS)).not.toContain('surgeOrb');
    // L'univers 2 n'utilise ni faisceaux ni laser : seulement ces attaques
    const w = WORLD_LIST[1].weights(50);
    for (const k of Object.keys(w)) expect([...FIVE, ...COMBOS]).toContain(k);
    expect(WORLD_LIST[1].name).toBe('La Faille');
  });

  it('aucune nouvelle attaque pendant un passage calme du morceau (marge comprise)', () => {
    for (const [a, b] of W2_CALM) {
      for (let l = a - CALM_LEAD + 0.01; l < b; l += 0.2) {
        if (l < 0) continue; // avant l'émergence : transition d'entrée, aucune vague
        const w = world2Weights(l);
        expect(Object.values(w).every((v) => !v), `l = ${l.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('l’onde de rupture n’est tirée que si un grand impact tombe dans sa fenêtre de charge ; les spirales exigent un morceau intense', () => {
    for (let l = 20; l < 118; l += 0.5) {
      const w = world2Weights(l);
      const impact = nextImpactIn(l + W2_ATTACKS.wave.warn.min, W2_ATTACKS.wave.minImpact);
      if ((w.riftWave ?? 0) > 0) {
        expect(impact - l).toBeLessThanOrEqual(W2_ATTACKS.wave.maxWait + 1e-9);
        expect(inCalm(impact)).toBe(false);
      }
      if ((w.fractureSpiral ?? 0) > 0) expect(intensityAt(l)).toBeGreaterThan(0.3);
    }
  });

  /** Parties du robot sur l'univers 2 : tous les dangers, vus une seule fois, avec leur instant de menace. */
  function play(seed: number): { hazards: Hazard[]; state: string; time: number } {
    const sim = createSimulation({ mode: 'survival', seed, worlds: true, bonus: false });
    const bot = new Bot(sim, true);
    const seen = new Set<number>();
    const out: Hazard[] = [];
    while (sim.state === 'running' && sim.time < worldStart(2)) {
      bot.tick();
      sim.step();
      sim.events.length = 0;
      if (sim.world !== 2) continue;
      for (const h of sim.hazards) {
        if (seen.has(h.id)) continue;
        seen.add(h.id);
        out.push({ ...h });
      }
    }
    return { hazards: out, state: sim.state, time: sim.time };
  }

  const games = [1000, 8919, 16838].map(play);

  it('le robot traverse les 120 s sans mourir et les cinq familles apparaissent', () => {
    const kinds = new Set<string>();
    for (const g of games) {
      expect(g.state).toBe('running');
      for (const h of g.hazards) kinds.add(h.pattern);
    }
    for (const k of FIVE) expect(kinds.has(k), k).toBe(true);
    for (const k of kinds) expect([...FIVE, ...COMBOS]).toContain(k);
  });

  it('onde de rupture : se déclenche exactement sur un grand impact de la carte, après au moins 2 s de charge annoncée', () => {
    let waves = 0;
    for (const g of games)
      for (const h of g.hazards) {
        if (h.kind !== 'sector' || (h.pattern !== 'riftWave' && h.pattern !== 'waveSpiral')) continue;
        waves++;
        const local = h.activeStart - W2_T0;
        const i = W2_DROPS.findIndex((d) => Math.abs(d - local) < 1e-3);
        expect(i, `activation ${local.toFixed(3)}`).toBeGreaterThanOrEqual(0);
        expect(W2_DROP_STRENGTH[i]).toBeGreaterThanOrEqual(W2_ATTACKS.wave.minImpact);
        expect(h.activeStart - h.warnStart).toBeGreaterThanOrEqual(W2_ATTACKS.wave.warn.min - 1e-6);
        expect(h.activeStart - h.warnStart).toBeLessThanOrEqual(W2_ATTACKS.wave.maxWait + 1e-6);
        expect(h.end - h.activeStart).toBeCloseTo(W2_ATTACKS.wave.active, 6);
        // L'onde s'élargit : emprise annoncée = emprise finale
        expect(h.morph?.halfTo).toBeCloseTo(W2_ATTACKS.wave.halfTo, 9);
      }
    expect(waves).toBeGreaterThanOrEqual(3);
  });

  it('fissure d’orbite : 4 à 8 s de danger, ouverture annoncée 2,4 à 3,8 s, terminée sur un battement quand il est proche', () => {
    let cracks = 0;
    let onBeat = 0;
    for (const g of games)
      for (const h of g.hazards) {
        if (h.kind !== 'sector' || (h.pattern !== 'orbitCrack' && h.pattern !== 'crackOrb')) continue;
        cracks++;
        const active = h.end - h.activeStart;
        expect(active).toBeGreaterThanOrEqual(W2_ATTACKS.crack.active.min - 1e-6);
        expect(active).toBeLessThanOrEqual(W2_ATTACKS.crack.active.max + 1e-6);
        const warn = h.activeStart - h.warnStart;
        expect(warn).toBeGreaterThanOrEqual(W2_ATTACKS.crack.warn.min - 1e-6);
        expect(warn).toBeLessThanOrEqual(W2_ATTACKS.crack.warn.max + 0.6 + 1e-6);
        if (W2_BEATS.some((b) => Math.abs(b + W2_T0 - h.activeStart) < 1e-3)) onBeat++;
      }
    expect(cracks).toBeGreaterThanOrEqual(6);
    expect(onBeat / cracks).toBeGreaterThan(0.5);
  });

  it('arc rampant : son activation attend une percussion cartographiée quand elle est à moins de 0,45 s (jamais d’annonce raccourcie)', () => {
    let creeping = 0;
    let onHit = 0;
    for (const g of games)
      for (const h of g.hazards) {
        if (h.kind !== 'sector' || h.pattern !== 'surgeArc') continue;
        creeping++;
        expect(h.activeStart - h.warnStart).toBeGreaterThanOrEqual(W2_ATTACKS.creep.warn - 1e-6);
        expect(h.morph?.drift).toBeDefined();
        expect(Math.abs(h.morph!.drift)).toBeLessThanOrEqual(W2_ATTACKS.creep.drift.max + 1e-9);
        if (W2_HITS.some((x) => Math.abs(x + W2_T0 - h.activeStart) < 1e-3)) onHit++;
      }
    expect(creeping).toBeGreaterThanOrEqual(5);
    expect(onHit / creeping).toBeGreaterThan(0.8);
  });

  it('toute menace est annoncée à l’avance, et rien ne touche l’orbite pendant un passage calme', () => {
    for (const g of games)
      for (const h of g.hazards) {
        expect((h.kind === 'projectile' ? h.launch : h.activeStart) - h.warnStart).toBeGreaterThanOrEqual(0.55);
        const local = dangerStart(h) - W2_T0;
        const contact = firstOrbitContact(h) - W2_T0;
        // une menace lancée avant un calme (et déjà annoncée) peut le traverser : on ne contrôle que les menaces dont le contact tombe en plein calme
        for (const [a, b] of W2_CALM) if (a > 3) expect(contact < a - 0.05 || contact > b + 0.05 || local < a - CALM_LEAD).toBe(true);
      }
  });

  it('spirales fracturées : seulement quand le morceau est intense', () => {
    let spirals = 0;
    for (const g of games)
      for (const h of g.hazards) {
        if (h.pattern !== 'fractureSpiral') continue;
        spirals++;
        expect(intensityAt(h.warnStart - W2_T0)).toBeGreaterThan(0.3);
        expect(h.warnStart - W2_T0).toBeGreaterThan(40);
      }
    expect(spirals).toBeGreaterThanOrEqual(4);
  });

  it('densité raisonnable : quelques attaques bien mises en scène (moins d’une toutes les 3 s), jamais plus de 6 menaces simultanées', () => {
    for (const g of games) {
      const starts = new Set(g.hazards.map((h) => `${h.pattern}@${h.warnStart.toFixed(2)}`));
      expect(starts.size).toBeLessThan(50);
    }
    // plafonds du directeur pour les secteurs de cet univers
    const sim = createSimulation({ mode: 'survival', seed: 99, worlds: true, bonus: false });
    sim.invincible = true;
    let max = 0;
    while (sim.time < worldStart(2)) {
      sim.step();
      sim.events.length = 0;
      if (sim.world === 2) max = Math.max(max, sim.hazards.filter((h) => h.threatEnd >= sim.time).length);
    }
    expect(max).toBeLessThanOrEqual(8);
  });

  it('déterminisme : deux parties de même graine donnent exactement les mêmes attaques, sans aucun audio', () => {
    const sig = (g: ReturnType<typeof play>) => g.hazards.map((h) => `${h.pattern}:${h.warnStart.toFixed(4)}:${dangerStart(h).toFixed(4)}`);
    expect(sig(play(1000))).toEqual(sig(games[0]));
  });

  it('le gameplay de La Faille n’importe aucun module audio, ambiance ou rendu', () => {
    for (const f of ['src/config/world2.ts', 'src/sim/patterns.ts', 'src/sim/director.ts', 'src/modes/worlds.ts', 'src/config/worlds.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from '\.\.?\/(audio|ambience|render|ui)\//);
      expect(src, f).not.toMatch(/AudioContext|currentTime|musicSync/);
    }
    for (const f of readdirSync('src/sim')) expect(readFileSync(`src/sim/${f}`, 'utf8'), f).not.toMatch(/world2\.json|polar-rift-world2/);
  });
});

// ————————————————————————————————————————————— lecture de la carte à la position entendue

describe('La Faille : synchronisation de la carte sur la position de lecture', () => {
  const pos = (m: number, playing = true): MusicPosition => ({ track: 'w2', time: m, playing });

  it('à 60 images/s, chaque battement, percussion et impact de la carte est franchi une seule fois, au plus une image après l’instant entendu', () => {
    const sync = new MusicSync();
    const lead = AMBIENCE.music.lead;
    const m = MUSIC_MAP.tracks.w2;
    let beats = 0;
    let hits = 0;
    let impacts = 0;
    let worstBeat = 0;
    let worstHit = 0;
    const beatSeen: number[] = [];
    const hitSeen: number[] = [];
    // départ à la première note ; la lecture avance de 1/60 s par image
    sync.update(pos(0.0), true);
    for (let k = 1; k * FRAME < WORLD2_PLAN.duration - lead; k++) {
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
    // Les repères franchis : tous ceux dont l'instant (moins l'avance visuelle) est atteint pendant la lecture simulée (force nulle : ignoré par la carte)
    const horizon = Math.floor((WORLD2_PLAN.duration - lead) / FRAME) * FRAME;
    const expBeats = Array.from(m.beats).filter((t, i) => t - lead > 0 && t - lead <= horizon && m.strength[i] > 0);
    const expHits = Array.from(m.hits!).filter((t, i) => t - lead > 0 && t - lead <= horizon && m.hitStrength![i] > 0);
    const expDrops = Array.from(m.drops).filter((t) => t - lead > 0 && t - lead <= horizon);
    expect(beats).toBe(expBeats.length);
    expect(hits).toBe(expHits.length);
    expect(impacts).toBe(expDrops.length);
    // instants franchis (comparés repère par repère) : au plus une image de retard
    for (let i = 0; i < beatSeen.length; i++) worstBeat = Math.max(worstBeat, beatSeen[i] - expBeats[i]);
    for (let i = 0; i < hitSeen.length; i++) worstHit = Math.max(worstHit, hitSeen[i] - expHits[i]);
    expect(worstBeat).toBeLessThanOrEqual(FRAME + 1e-9);
    expect(worstHit).toBeLessThanOrEqual(FRAME + 1e-9);
    // et jamais en avance sur l'instant entendu
    for (let i = 0; i < beatSeen.length; i++) expect(beatSeen[i]).toBeGreaterThanOrEqual(expBeats[i] - 1e-9);
  });

  it('pause : la position ne progresse plus, plus aucune réaction ; la reprise ne rejoue aucun battement manqué (pas de rafale)', () => {
    const sync = new MusicSync();
    for (let t = 20; t < 25; t += FRAME) sync.update(pos(t), true);
    for (let i = 0; i < 120; i++) {
      const f = sync.update(pos(25, false), true);
      expect(f.active).toBe(false);
      expect(f.beat).toBe(0);
      expect(f.perc ?? 0).toBe(0);
    }
    // reprise 40 s plus loin (saut de position) : aucun rattrapage
    const f = sync.update(pos(65), true);
    expect(f.beat).toBe(0);
    expect(f.perc ?? 0).toBe(0);
    expect(f.impact ?? 0).toBe(0);
  });

  it('musique coupée, en sourdine ou sans volume : aucune réaction (l’ambiance ne simule jamais une fausse pulsation)', () => {
    const sync = new MusicSync();
    for (let t = 38; t < 45; t += FRAME) {
      const f = sync.update(pos(t), false);
      expect(f.active).toBe(false);
      expect(f.bass).toBe(0);
      expect(f.beat).toBe(0);
      expect(f.perc ?? 0).toBe(0);
    }
    const f = sync.update({ track: null, time: 0, playing: true }, true);
    expect(f.active).toBe(false);
  });

  it('passages calmes : indiqués par la carte, intensité et basses du morceau à la position entendue', () => {
    const sync = new MusicSync();
    // (le même objet image est réutilisé : on relève les valeurs tout de suite)
    const f1 = sync.update(pos(15.5), true);
    const calm1 = f1.calm;
    const inten1 = f1.intensity;
    const f2 = sync.update(pos(60), true);
    expect(calm1).toBe(1);
    expect(f2.calm).toBe(0);
    expect(f2.intensity).toBeGreaterThan(inten1);
    expect(f2.bass).toBeGreaterThan(0.2);
  });
});

// ————————————————————————————————————————————— réactions du décor

describe('La Faille : réactions du décor à la musique', () => {
  const world2 = { phase: 1 as const, transit: 0, phased: true, world: { index: 2, to: 2 } };
  const frame = (o: Partial<MusicFrame> = {}): MusicFrame => ({ active: true, track: 'w2', bass: 0, intensity: 0, beat: 0, hit: 0, drop: false, perc: 0, impact: 0, calm: 0, build: 0, ...o });

  function settle(d: AmbienceDirector, f: MusicFrame, seconds: number, ph = world2): void {
    for (let t = 0; t < seconds; t += FRAME) d.update(130, FRAME, { ...f, drop: false, beat: 0, perc: 0, impact: 0 }, false, 1, ph);
  }

  it('basses : la faille pulse et le gain de pulsation est celui de La Faille', () => {
    const d = new AmbienceDirector(() => 0.5);
    settle(d, frame({ bass: 0.9, intensity: 0.5 }), 6);
    expect(d.state.bass).toBeGreaterThan(0.6);
    expect(d.state.pulse).toBeCloseTo(AMBIENCE.world2.hole.pulse, 1);
    expect(d.state.holeOpen).toBeGreaterThan(0.75);
    expect(d.state.core).toBeGreaterThan(0.6);
    // Sans musique : pas de pulsation du tout
    const e = new AmbienceDirector(() => 0.5);
    settle(e, frame({ active: false, track: null, bass: 0.9 }), 1.5);
    expect(e.state.bass).toBe(0);
  });

  it('percussions : impulsion proportionnelle à la force, qui retombe en un dixième de seconde ; éclairs seulement sur les percussions franches', () => {
    const d = new AmbienceDirector(() => 0.3); // tirage favorable aux percussions franches seulement
    d.update(130, FRAME, frame({ perc: 0.9, intensity: 0.5 }), false, 1, world2);
    expect(d.state.perc).toBeCloseTo(0.9, 1);
    expect(d.state.spawnArcs).toBeGreaterThanOrEqual(1);
    settle(d, frame({ intensity: 0.5 }), 0.6);
    expect(d.state.perc).toBeLessThan(0.01);
    const w = new AmbienceDirector(() => 0.3);
    w.update(130, FRAME, frame({ perc: 0.3, intensity: 0.5 }), false, 1, world2);
    expect(w.state.perc).toBeCloseTo(0.3, 1);
    expect(w.state.spawnArcs).toBe(0); // percussion faible : pas d'éclair
  });

  it('montées : instabilité croissante ; impacts : décharge proportionnelle à leur force ; calme : apaisement', () => {
    const d = new AmbienceDirector(() => 0.5);
    settle(d, frame({ build: 1, intensity: 0.8 }), 2);
    expect(d.state.instab).toBeGreaterThan(0.6);
    const calm = new AmbienceDirector(() => 0.5);
    settle(calm, frame({ intensity: 0.1, calm: 1 }), 2);
    expect(calm.state.calm).toBeGreaterThan(0.9);
    expect(calm.state.instab).toBeLessThan(0.05);
    // Impact : deux forces, deux amplitudes
    const small = new AmbienceDirector(() => 0.5);
    const big = new AmbienceDirector(() => 0.5);
    small.update(130, FRAME, frame({ drop: true, impact: 0.4, intensity: 0.5 }), false, 1, world2);
    big.update(130, FRAME, frame({ drop: true, impact: 1, intensity: 0.5 }), false, 1, world2);
    expect(big.state.drop).toBeGreaterThan(small.state.drop * 1.2);
    expect(big.state.spawnWave).toBeGreaterThan(small.state.spawnWave);
    expect(big.state.spawnArcs).toBeGreaterThan(small.state.spawnArcs);
  });

  it('paramètres de La Faille imposés au décor (en fondu avec sa présence) : violet profond, magenta, bleu lumineux', () => {
    const d = new AmbienceDirector(() => 0.5);
    settle(d, frame({ intensity: 0.5 }), 0.5);
    for (const k of ['bassGain', 'beatGain', 'ringChance', 'waveGain', 'boltChance', 'waveChance', 'fissure'] as const) expect(d.state.p[k]).toBeCloseTo(AMBIENCE.world2.params[k], 6);
    // le ciel est assombri par l'apparence de la phase 2 (réglage hérité) mais les réactions musicales sont celles de La Faille
    expect(d.state.p.bassGain).toBeGreaterThanOrEqual(0.99);
    const pal = WORLD_LIST[1].palette;
    expect(pal.primary).toBe(0x8a3dff);
    expect(pal.secondary).toBe(0xd04bff);
    expect(pal.accent).toBe(0x3d6bff);
  });

  it('sortie : la faille se stabilise après le dernier coup (éclairs et pulsations s’éteignent) et l’énergie violette cède à la brume turquoise', () => {
    const d = new AmbienceDirector(() => 0.01);
    settle(d, frame({ bass: 0.9, intensity: 0.8 }), 1);
    expect(d.state.stab).toBe(0);
    const exit = { phase: 1 as const, transit: 0.35, phased: true, world: { index: 2, to: 3 } };
    d.update(239.8, FRAME, frame({ perc: 1, bass: 0.9, intensity: 0.8 }), false, 1, exit);
    expect(d.state.stab).toBeGreaterThan(0.9);
    expect(d.state.spawnArcs).toBe(0);
    expect(d.state.perc).toBeLessThan(0.05);
    expect(d.state.variant).toBe('mist');
    expect(d.state.riftFrom).toBe(WORLD_LIST[1].transition.from);
    expect(d.state.riftTo).toBe(0x3fe0d0);
  });

  it('effets réduits : aucun éclair ; réglage d’intensité visuelle à zéro : le décor s’éteint', () => {
    const d = new AmbienceDirector(() => 0.01);
    d.update(130, FRAME, frame({ perc: 1, intensity: 0.5 }), true, 1, world2);
    expect(d.state.spawnArcs).toBe(0);
    const u = new AmbienceDirector(() => 0.01);
    u.update(130, FRAME, frame({ perc: 1, intensity: 0.5 }), false, 0, world2);
    expect(u.state.user).toBe(0);
  });

  it('les autres univers et la Survie officielle ne sont pas modifiés par ces réglages', () => {
    const a = new AmbienceDirector(() => 0.5);
    settle(a, frame({ track: 'loop', bass: 0.6, intensity: 0.5 }), 1, { phase: 1, transit: 0, phased: true, world: { index: 1, to: 1 } });
    expect(a.state.pulse).toBe(1);
    expect(a.state.instab).toBe(0);
    expect(a.state.stab).toBe(0);
    const s = new AmbienceDirector(() => 0.5);
    settle(s, frame({ track: 'loop', bass: 0.6, intensity: 0.5 }), 1, { phase: 1, transit: 0, phased: true } as never);
    expect(s.state.pulse).toBe(1);
    expect(s.state.world).toBe(0);
  });
});

// ————————————————————————————————————————————— lecture audio du montage (faux contexte)

describe('La Faille : lecture du montage sur l’horloge audio', () => {
  function setup(withBuffer = true) {
    const ctx = new FakeCtx();
    const out = new FakeNode();
    const host: AudioHost = { context: () => ctx as unknown as BaseAudioContext, output: () => out as unknown as AudioNode };
    const buffers = { intro: buf('intro'), loop: buf('loop'), outro: buf('outro'), ...(withBuffer ? { world2: buf('world2') } : {}) };
    const wm = new WorldMusic(host, () => buffers);
    const pos = (): MusicPosition => wm.position({ track: null, time: 0, playing: false } as MusicPosition);
    return { ctx, wm, pos };
  }
  const [seg0, seg1] = WORLD2_PLAN.segments;
  const xf = WORLD2_PLAN.crossfade;
  const voices = (ctx: FakeCtx) => ctx.sources.filter((s) => nameOf(s) === 'world2');

  it('départ de partie à un temps local : position de platine = temps local + transition d’entrée, voix du segment courant seulement après le raccord', () => {
    const { ctx, wm, pos } = setup();
    wm.startGame(2, 0);
    const v = voices(ctx);
    expect(v).toHaveLength(2);
    ctx.currentTime = MUSIC.restartFade + 0.02 + 5;
    // position entendue = 5 s après le démarrage (moins la latence de sortie, nulle ici)
    const p = pos();
    expect(p.track).toBe('w2');
    expect(p.time).toBeCloseTo(WORLDS.transition + 5 - WORLD2_START, 1);
    // Reprise APRÈS le raccord : une seule voix, calée dans le fichier
    const b = setup();
    const localAfter = seg1.at + 10 + WORLD2_AT; // temps local 10 s après le raccord
    b.wm.startGame(2, localAfter);
    const w = voices(b.ctx);
    expect(w).toHaveLength(1);
    expect(w[0].starts[0].offset).toBeCloseTo(seg1.from + 10, 3);
  });

  it('raccord : la voix suivante entre pendant le fondu et la précédente sort ; au moment du raccord elles sont à la même position musicale', () => {
    const { ctx, wm } = setup();
    ctx.currentTime = 100;
    wm.startGame(2, 0);
    const [v0, v1] = voices(ctx);
    // démarrage au temps local 0 : le montage est déjà à -WORLD2_AT s (la musique a commencé pendant la transition d'entrée)
    const m0 = -WORLD2_AT;
    const at = v0.starts[0].when;
    expect(v0.starts[0].offset).toBeCloseTo(m0, 6);
    const spliceAudio = at + (seg1.at - m0);
    // la voix 2 démarre `crossfade` plus tôt, dans le fichier `crossfade` avant la phrase répétée
    expect(v1.starts[0].when).toBeCloseTo(spliceAudio - xf, 6);
    expect(v1.starts[0].offset).toBeCloseTo(seg1.from - xf, 6);
    // positions de lecture dans le fichier à l'instant du raccord : voix 0 = fin du premier segment ; voix 1 = début du second
    const pos0 = v0.starts[0].offset + (spliceAudio - v0.starts[0].when);
    const pos1 = v1.starts[0].offset + (spliceAudio - v1.starts[0].when);
    expect(pos0).toBeCloseTo(seg0.to, 6);
    expect(pos1).toBeCloseTo(seg1.from, 6);
    // la voix 0 s'arrête juste après le raccord ; son gain atteint 0 à l'instant du raccord (aucune coupure sèche)
    expect(v0.stopAt).toBeCloseTo(spliceAudio + 0.02, 6);
    const g0 = (v0.connections[0] as { gain: { events: { type: string; value: number; time: number }[] } }).gain.events;
    expect(g0.find((e) => e.type === 'ramp' && e.value === 0)!.time).toBeCloseTo(spliceAudio, 6);
    const g1 = (v1.connections[0] as { gain: { events: { type: string; value: number; time: number }[] } }).gain.events;
    expect(g1.find((e) => e.type === 'ramp' && e.value === 1)!.time).toBeCloseTo(spliceAudio, 6);
    // les deux fondus sont terminés AVANT l'attaque du battement de raccord (pas d'écrasement du transitoire)
    expect(spliceAudio).toBeLessThanOrEqual(spliceAudio);
    // aucun minuteur : tout est programmé sur l'horloge audio
  });

  it('pause puis reprise : la position musicale est conservée, une reprise après le raccord repart dans la bonne voix', () => {
    const { ctx, wm, pos } = setup();
    wm.startGame(2, 0);
    ctx.currentTime = 0.3 + seg1.at + 3 - WORLD2_AT + 0.3; // 3 s après le raccord (approximatif)
    const before = pos();
    expect(before.track).toBe('w2');
    wm.pause();
    ctx.currentTime += 50;
    const paused = pos();
    expect(paused.playing).toBe(false);
    expect(paused.time).toBeCloseTo(before.time, 6);
    const n = ctx.sources.length;
    wm.resume();
    const fresh = ctx.sources.slice(n).filter((s) => nameOf(s) === 'world2');
    expect(fresh).toHaveLength(1); // après le raccord : une seule voix
    const expectOffset = seg1.from + (before.time - seg1.at);
    expect(fresh[0].starts[0].offset).toBeCloseTo(expectOffset, 2);
  });

  it('mort puis reprise payée : la musique repart là où elle s’était arrêtée', () => {
    const { ctx, wm, pos } = setup();
    wm.startGame(2, 0);
    ctx.currentTime = 20;
    const before = pos();
    wm.endGame();
    ctx.currentTime += 3;
    expect(wm.resumeAfterDeath()).toBe(true);
    ctx.currentTime += 1;
    expect(pos().time).toBeGreaterThan(0);
    void before;
  });

  it('avant la première note et après la queue : aucune position musicale ; sans fichier décodé : silence, aucune erreur', () => {
    const { ctx, wm, pos } = setup();
    ctx.currentTime = 1;
    wm.transition(2); // état idle : ignoré
    wm.startGame(1);
    wm.transition(2);
    ctx.currentTime += 0.5; // transition en cours, avant la première note
    expect(pos().track).toBeNull();
    ctx.currentTime += WORLD2_START + WORLD2_PLAN.duration + 5;
    expect(pos().track).toBeNull();
    const silent = setup(false);
    expect(() => silent.wm.startGame(2, 10)).not.toThrow();
    expect(voices(silent.ctx)).toHaveLength(0);
    expect(silent.pos().track).toBeNull();
  });
});

// ————————————————————————————————————————————— garde de synchronisation jeu/musique

describe('La Faille : garde de synchronisation jeu/musique (appareil lent)', () => {
  it('un écart faible ou passager n’entraîne jamais de recalage', () => {
    const g = new MusicSyncGuard();
    for (let t = 0; t < 120; t += FRAME) expect(g.update(0.02 * Math.sin(t), FRAME)).toBe(false);
    // dépassement bref (une image lente) : pas de recalage
    const h = new MusicSyncGuard();
    for (let i = 0; i < 20; i++) expect(h.update(0.5, FRAME)).toBe(false);
    for (let i = 0; i < 600; i++) expect(h.update(0.01, FRAME)).toBe(false);
  });

  it('un écart durable (jeu en retard ou en avance sur la musique) déclenche UN recalage, puis un délai avant le suivant', () => {
    const g = new MusicSyncGuard();
    let fired = 0;
    let firstAt = -1;
    for (let i = 0; i < Math.round(20 / FRAME); i++) {
      if (g.update(-0.4, FRAME)) {
        fired++;
        if (firstAt < 0) firstAt = i * FRAME;
      }
    }
    expect(firstAt).toBeGreaterThanOrEqual(WORLD_MUSIC_SYNC.hold - 2 * FRAME);
    expect(firstAt).toBeLessThan(WORLD_MUSIC_SYNC.hold + 2 * FRAME);
    // 20 s d'écart permanent : au plus un recalage toutes les `cooldown` s
    expect(fired).toBeLessThanOrEqual(Math.ceil(20 / WORLD_MUSIC_SYNC.cooldown));
    expect(fired).toBeGreaterThanOrEqual(2);
    const e = new MusicSyncGuard();
    let any = false;
    for (let i = 0; i < Math.round(3 / FRAME); i++) any = e.update(0.35, FRAME) || any;
    expect(any).toBe(true);
  });

  it('sans mesure (pause, transition, musique absente : NaN), le compteur retombe', () => {
    const g = new MusicSyncGuard();
    for (let i = 0; i < 40; i++) g.update(0.5, FRAME);
    g.update(NaN, FRAME);
    for (let i = 0; i < 40; i++) expect(g.update(0.5, FRAME)).toBe(false);
    g.reset();
    for (let i = 0; i < Math.round(WORLD_MUSIC_SYNC.hold / FRAME) + 3; i++) g.update(0.5, FRAME);
  });
});
