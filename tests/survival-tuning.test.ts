import { describe, expect, it } from 'vitest';
import { CAPS, DIFFICULTY_RANGE, SECTOR, SIM } from '../src/config/balance';
import { LEVELS } from '../src/config/levels';
import { SURVIVAL } from '../src/config/survival';
import { levelProfile, survivalBreath, survivalDifficulty, survivalIntervalScale, survivalProfile, survivalWeights } from '../src/modes/profiles';
import { paramsFor } from '../src/sim/difficulty';
import type { PatternId } from '../src/sim/patterns';
import { Simulation } from '../src/sim/simulation';

const DOUBLES: PatternId[] = ['parallel', 'cross', 'twinArcs', 'echo', 'chase'];
const COMBOS: PatternId[] = ['shotArc', 'pincer'];

/** Joue la Survie sans collision et enregistre chaque vague (instant, motif). */
function record(seed: number, seconds: number): { t: number; id: PatternId }[] {
  const waves: { t: number; id: PatternId }[] = [];
  const sim = new Simulation({ seed, profile: survivalProfile(), timeLimit: null, invincible: true });
  sim.director.onWave = (t, id) => waves.push({ t, id });
  const steps = Math.round(seconds / SIM.dt);
  for (let i = 0; i < steps; i++) {
    sim.step();
    sim.events.length = 0;
  }
  return waves;
}

describe('Courbe de Survie accélérée', () => {
  it('atteint à 2 minutes la difficulté qu’elle atteignait à 5 minutes (v1.0)', () => {
    const old = survivalDifficulty(300, SURVIVAL.legacyTau);
    expect(old).toBeCloseTo(0.771, 2);
    expect(Math.abs(survivalDifficulty(120) - old)).toBeLessThan(0.005);
  });

  it('démarre au même point, reste sous le plafond et progresse sans saut', () => {
    expect(survivalDifficulty(0)).toBe(0);
    expect(SURVIVAL.dMax).toBe(0.93);
    let prev = 0;
    for (let t = 0.5; t < 3600; t += 0.5) {
      const d = survivalDifficulty(t);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d - prev).toBeLessThan(0.01);
      expect(d).toBeLessThanOrEqual(SURVIVAL.dMax);
      prev = d;
    }
  });
});

describe('Plafonds et contraintes conservés', () => {
  it('les plafonds absolus sont ceux de la v1.0', () => {
    expect(CAPS).toEqual({ maxProjectileSpeed: 580, minProjectileWarn: 0.55, minSectorWarn: 0.65, minWaveInterval: 0.85, maxActiveHazards: 8 });
    expect(SECTOR.maxSimultaneous).toBe(2);
    expect(SECTOR.maxCoverage).toBe(0.36);
    expect(DIFFICULTY_RANGE.projectileSpeed).toEqual({ easy: 320, hard: 560 });
    expect(DIFFICULTY_RANGE.maxHazards).toEqual({ easy: 2, hard: 6 });
  });

  it('la vitesse du joueur est inchangée', async () => {
    const { PLAYER } = await import('../src/config/balance');
    expect(PLAYER.angularSpeed).toBe(2.0);
  });
});

describe('Annonces réduites avec plancher', () => {
  it('les annonces de la Survie sont ~8 % plus courtes, jamais sous les planchers', () => {
    for (let d = 0; d <= 1.0001; d += 0.01) {
      const v1 = paramsFor(d);
      const v2 = paramsFor(d, undefined, SURVIVAL.warnScale);
      expect(v2.projectileWarn).toBeLessThanOrEqual(v1.projectileWarn + 1e-12);
      expect(v2.sectorWarn).toBeLessThanOrEqual(v1.sectorWarn + 1e-12);
      expect(v2.projectileWarn).toBeGreaterThanOrEqual(CAPS.minProjectileWarn);
      expect(v2.sectorWarn).toBeGreaterThanOrEqual(CAPS.minSectorWarn);
      if (v1.projectileWarn * SURVIVAL.warnScale > CAPS.minProjectileWarn) {
        expect(v2.projectileWarn / v1.projectileWarn).toBeCloseTo(SURVIVAL.warnScale, 9);
      }
    }
    // « légèrement » : au plus −10 %
    expect(SURVIVAL.warnScale).toBeGreaterThanOrEqual(0.9);
    // À la difficulté maximale de la Survie, l'annonce de tir laisse encore > 0,55 s
    const hard = paramsFor(SURVIVAL.dMax, undefined, SURVIVAL.warnScale);
    expect(hard.projectileWarn).toBeGreaterThanOrEqual(0.55);
    expect(hard.sectorWarn).toBeGreaterThanOrEqual(0.65);
  });

  it('les niveaux ne changent pas : annonces non réduites', () => {
    expect(levelProfile(LEVELS[0]).warnScale).toBeUndefined();
    expect(paramsFor(0.5).projectileWarn).toBeCloseTo(0.825, 9);
  });
});

describe('Calendrier des motifs en Survie', () => {
  it('aucune double attaque avant 30 s, aucune combinaison projectile/secteur avant 60 s', () => {
    for (let t = 0; t < 30; t += 1) for (const id of DOUBLES) expect(survivalWeights(t)[id] ?? 0).toBe(0);
    for (let t = 0; t < 45; t += 1) for (const id of ['twinArcs', 'echo', 'chase'] as const) expect(survivalWeights(t)[id] ?? 0).toBe(0);
    for (let t = 0; t < 60; t += 1) for (const id of COMBOS) expect(survivalWeights(t)[id] ?? 0).toBe(0);
    for (let t = 0; t < 90; t += 1) expect(survivalWeights(t).burst ?? 0).toBe(0);
  });

  it('les doubles attaques sont là entre 30 et 60 s, les combinaisons après une minute', () => {
    expect(survivalWeights(45).parallel).toBeGreaterThan(0);
    expect(survivalWeights(45).cross).toBeGreaterThan(0);
    expect(survivalWeights(60).twinArcs).toBeGreaterThan(0);
    expect(survivalWeights(75).shotArc).toBeGreaterThan(0);
  });

  it('davantage de combinaisons au fil du temps ; les motifs simples reculent', () => {
    const share = (t: number) => {
      const w = survivalWeights(t);
      let total = 0;
      let combo = 0;
      for (const [id, v] of Object.entries(w)) {
        total += v ?? 0;
        if (COMBOS.includes(id as PatternId)) combo += v ?? 0;
      }
      return combo / total;
    };
    expect(share(100)).toBeGreaterThan(share(70));
    expect(share(200)).toBeGreaterThan(share(100));
    expect(survivalWeights(250).shot!).toBeLessThan(survivalWeights(20).shot!);
  });

  it('empirique (12 graines) : doubles entre 30 et 60 s, combinaisons dès une minute', () => {
    const firstDouble: number[] = [];
    const firstCombo: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const waves = record(seed * 101, 130);
      firstDouble.push(waves.find((w) => DOUBLES.includes(w.id))?.t ?? Infinity);
      firstCombo.push(waves.find((w) => COMBOS.includes(w.id))?.t ?? Infinity);
    }
    expect(Math.min(...firstDouble)).toBeGreaterThanOrEqual(30);
    expect(Math.min(...firstCombo)).toBeGreaterThanOrEqual(60);
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    expect(med(firstDouble)).toBeLessThan(60);
    expect(med(firstCombo)).toBeLessThan(100);
  });
});

describe('Intensification après 3 minutes', () => {
  it('séquences plus serrées avec de brèves respirations', () => {
    expect(survivalBreath(100)).toBe(SURVIVAL.breath);
    const late = survivalBreath(240);
    expect(late.every.max).toBeLessThan(SURVIVAL.breath.every.min + 1);
    expect(late.duration.max).toBeLessThan(SURVIVAL.breath.duration.max);
    expect(late.duration.max).toBeLessThanOrEqual(1.5);
    expect(late.duration.min).toBeGreaterThan(0);
    const mean = (from: number) => {
      let s = 0;
      const n = 370; // une période complète de modulation (37 s)
      for (let i = 0; i < n; i++) s += survivalIntervalScale(from + i / 10);
      return s / n;
    };
    expect(mean(100)).toBeGreaterThan(0.97);
    expect(mean(240)).toBeLessThan(0.86);
  });

  it('empirique : après 3 min, plus de vagues par minute, sans jamais passer sous l’intervalle minimal', () => {
    let before = 0;
    let after = 0;
    let maxGapAfter = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const waves = record(seed * 77, 420);
      for (let i = 1; i < waves.length; i++) {
        expect(waves[i].t - waves[i - 1].t).toBeGreaterThanOrEqual(CAPS.minWaveInterval - 1e-9);
        if (waves[i].t > 220) maxGapAfter = Math.max(maxGapAfter, waves[i].t - waves[i - 1].t);
      }
      before += waves.filter((w) => w.t >= 120 && w.t < 180).length;
      after += waves.filter((w) => w.t >= 240 && w.t < 300).length;
    }
    expect(after).toBeGreaterThan(before);
    // Les respirations restent brèves : jamais plus de 5 s sans vague
    expect(maxGapAfter).toBeLessThan(5);
  });
});
