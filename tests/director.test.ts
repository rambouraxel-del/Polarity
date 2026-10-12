import { describe, expect, it } from 'vitest';
import { CAPS, LEVEL_DURATION, SECTOR, SIM } from '../src/config/balance';
import { SURVIVAL } from '../src/config/survival';
import { LEVELS } from '../src/config/levels';
import { TAU } from '../src/core/math';
import { levelProfile, survivalDifficulty, survivalProfile } from '../src/modes/profiles';
import { playWithBot } from '../src/sim/bot';
import { paramsFor } from '../src/sim/difficulty';
import { makeSector } from '../src/sim/hazards';
import { hasEscapePath } from '../src/sim/safety';
import { Simulation } from '../src/sim/simulation';

describe('Directeur de Survie', () => {
  it('reste dans les plafonds au-delà de 20 minutes simulées, sans accumuler de menaces', () => {
    const sim = new Simulation({ seed: 77, profile: survivalProfile(), timeLimit: null, invincible: true });
    const minutes = 25;
    let maxHazards = 0;
    let maxThreats = 0;
    let lastWave = 0;
    let maxGap = 0;
    let waves = 0;
    const steps = Math.round((minutes * 60) / SIM.dt);
    for (let i = 0; i < steps; i++) {
      sim.step();
      sim.events.length = 0;
      const t = sim.time;
      if (sim.director.waveCount !== waves) {
        waves = sim.director.waveCount;
        if (t > 120) maxGap = Math.max(maxGap, t - lastWave);
        lastWave = t;
        const p = sim.director.params;
        expect(p.d).toBeLessThanOrEqual(SURVIVAL.dMax + 1e-9);
        expect(p.projectileSpeed).toBeLessThanOrEqual(CAPS.maxProjectileSpeed);
        expect(p.projectileWarn).toBeGreaterThanOrEqual(CAPS.minProjectileWarn);
        expect(p.sectorWarn).toBeGreaterThanOrEqual(CAPS.minSectorWarn);
        expect(p.waveInterval).toBeGreaterThanOrEqual(CAPS.minWaveInterval);
      }
      maxHazards = Math.max(maxHazards, sim.hazards.length);
      let threats = 0;
      let sectors = 0;
      let coverage = 0;
      for (const h of sim.hazards) {
        if (h.threatEnd >= t) threats++;
        if (h.kind === 'sector') {
          sectors++;
          coverage += 2 * h.half;
        }
      }
      maxThreats = Math.max(maxThreats, threats);
      expect(sectors).toBeLessThanOrEqual(SECTOR.maxSimultaneous);
      expect(coverage / TAU).toBeLessThanOrEqual(SECTOR.maxCoverage + 1e-9);
    }
    expect(sim.time).toBeGreaterThanOrEqual(minutes * 60 - 1e-6);
    expect(maxThreats).toBeLessThanOrEqual(CAPS.maxActiveHazards);
    // Les objets terminés sont nettoyés : pas d'accumulation
    expect(maxHazards).toBeLessThan(20);
    // La partie continue de produire des vagues jusqu'au bout (pas de fin cachée)
    expect(waves).toBeGreaterThan(minutes * 25);
    expect(sim.time - lastWave).toBeLessThan(10);
    expect(maxGap).toBeLessThan(10);
  });

  it('la difficulté croît progressivement, sans saut brutal', () => {
    let prev = survivalDifficulty(0);
    for (let t = 0.5; t < 1500; t += 0.5) {
      const d = survivalDifficulty(t);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d - prev).toBeLessThan(0.01);
      prev = d;
    }
    expect(paramsFor(prev).d).toBeLessThan(1);
  });
});

describe('Validateur d’évitement', () => {
  it('refuse un piège sans issue : secteurs de part et d’autre qui se referment', () => {
    // Deux secteurs couvrant tout le cercle sauf la position du joueur, puis un troisième sur lui
    const a = 0;
    const hz = [
      makeSector('arc', 0, 0.3, 2, a + Math.PI / 2 + 0.2, Math.PI / 2),
      makeSector('arc', 0, 0.3, 2, a - Math.PI / 2 - 0.2, Math.PI / 2),
      makeSector('arc', 0, 0.6, 1, a, 0.4),
    ];
    expect(hasEscapePath(hz, { angle: a, dir: 1, time: 0, forcedTime: 0, forcedDir: 1, speed: () => 1 })).toBe(false);
  });

  it('accepte une situation évitable', () => {
    const hz = [makeSector('arc', 0, 1.2, 1, 0, 0.4)];
    expect(hasEscapePath(hz, { angle: 0, dir: 1, time: 0, forcedTime: 0.25, forcedDir: 1, speed: () => 1 })).toBe(true);
  });

  it('dangers des deux côtés avec un passage : trouve le trajet', () => {
    const hz = [
      makeSector('arc', 0, 1.0, 1, 1.2, 0.4),
      makeSector('arc', 0, 1.0, 1, -1.2, 0.4),
    ];
    expect(hasEscapePath(hz, { angle: 0, dir: 1, time: 0, forcedTime: 0.25, forcedDir: 1, speed: () => 1 })).toBe(true);
  });
});

describe('Générateur (joueur automatique)', () => {
  // Le bot ne fait que vérifier la cohérence du générateur et du validateur ;
  // ce n'est pas une validation de l'équilibrage ressenti par des joueurs.
  it.each(LEVELS.map((l) => [l.id, l] as const))('niveau %i : le bot survit aux 90 s', (_id, level) => {
    for (const seed of [11, 29]) {
      const sim = new Simulation({ seed, profile: levelProfile(level), timeLimit: LEVEL_DURATION });
      playWithBot(sim, LEVEL_DURATION + 1);
      expect(sim.state).toBe('complete');
    }
  });

  it('Survie : le bot tient 6 minutes', () => {
    const sim = new Simulation({ seed: 5, profile: survivalProfile(), timeLimit: null });
    playWithBot(sim, 360);
    expect(sim.state).toBe('running');
    expect(sim.time).toBeGreaterThanOrEqual(360 - 1e-6);
  });
});
