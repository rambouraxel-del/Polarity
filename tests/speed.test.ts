import { describe, expect, it } from 'vitest';
import { PLAYER, SIM } from '../src/config/balance';
import { angleDiff } from '../src/core/math';
import { LEVELS } from '../src/config/levels';
import { LEVEL_SPEED_DEFAULT, PACE, PLAYER_SPEED, paceFactor, survivalSpeedFactor } from '../src/config/playerSpeed';
import { GameSession } from '../src/game/session';
import { levelProfile, survivalProfile } from '../src/modes/profiles';
import { paramsFor } from '../src/sim/difficulty';
import { hasEscapePath } from '../src/sim/safety';
import { makeSector } from '../src/sim/hazards';
import { Simulation } from '../src/sim/simulation';
import { angularTravel, timeAfterTravel } from '../src/sim/speed';
import { emptyProfile } from './helpers';

describe('Paliers de vitesse (Survie et défi)', () => {
  it('départ à 40 % de la référence, +5 points toutes les 30 s, 100 % à 6 min', () => {
    expect(survivalSpeedFactor(0)).toBeCloseTo(0.4, 12);
    expect(survivalSpeedFactor(10)).toBeCloseTo(0.4, 12);
    expect(survivalSpeedFactor(30)).toBeCloseTo(0.45, 12);
    expect(survivalSpeedFactor(60)).toBeCloseTo(0.5, 12);
    expect(survivalSpeedFactor(90)).toBeCloseTo(0.55, 12);
    expect(survivalSpeedFactor(180)).toBeCloseTo(0.7, 12);
    expect(survivalSpeedFactor(360)).toBeCloseTo(1.0, 12);
    for (let k = 0; k <= 12; k++) {
      expect(survivalSpeedFactor(k * 30)).toBeCloseTo(0.4 + 0.05 * k, 12);
      // Plateau : stable entre la fin du lissage d'un palier et le début du suivant
      if (k < 12) expect(survivalSpeedFactor(k * 30 + 12)).toBeCloseTo(0.4 + 0.05 * k, 12);
    }
  });

  it('plafonné à 100 % pour cette version', () => {
    for (const t of [360, 361, 400, 600, 1800, 7200]) expect(survivalSpeedFactor(t)).toBe(1);
    for (let t = 0; t < 1000; t += 0.25) expect(survivalSpeedFactor(t)).toBeLessThanOrEqual(PLAYER_SPEED.max);
  });

  it('chaque hausse est lissée sur 2 s et se termine à l’instant du palier', () => {
    for (let k = 1; k <= 12; k++) {
      const end = k * 30;
      expect(survivalSpeedFactor(end - 2)).toBeCloseTo(0.4 + 0.05 * (k - 1), 12);
      expect(survivalSpeedFactor(end - 1)).toBeCloseTo(0.4 + 0.05 * (k - 0.5), 12); // milieu de la rampe
      expect(survivalSpeedFactor(end)).toBeCloseTo(0.4 + 0.05 * k, 12);
    }
  });

  it('jamais de saut : continue, croissante, pente bornée', () => {
    let prev = survivalSpeedFactor(0);
    const maxSlope = (PLAYER_SPEED.step * 1.5) / PLAYER_SPEED.smooth; // pente maximale d'un smoothstep
    for (let i = 1; i <= 60 * 400; i++) {
      const t = i / 60;
      const v = survivalSpeedFactor(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v - prev).toBeLessThanOrEqual((maxSlope / 60) * 1.001 + 1e-12);
      prev = v;
    }
  });

  it('la vitesse réelle du vaisseau suit la courbe (intégrale exacte)', () => {
    const sim = new Simulation({ seed: 1, profile: { ...emptyProfile, speed: survivalSpeedFactor }, timeLimit: null });
    const start = sim.angle;
    // Angle cumulé (sans repliement) : somme des déplacements de chaque pas
    let travelled = 0;
    for (let i = 0; i < 75 * 120; i++) {
      const a = sim.angle;
      sim.step();
      travelled += angleDiff(a, sim.angle);
    }
    expect(sim.angle - start).not.toBeNaN();
    // Sens constant : angle parcouru = ω_réf × ∫ facteur dt
    expect(travelled).toBeCloseTo(angularTravel(survivalSpeedFactor, 0, 75), 2);
    // Et nettement inférieur à l'ancienne vitesse constante
    expect(travelled).toBeLessThan(PLAYER.angularSpeed * 75 * 0.65);
  });

  it('l’inversion garde la vitesse : pas de délai ni de déplacement brusque', () => {
    const sim = new Simulation({ seed: 1, profile: { ...emptyProfile, speed: survivalSpeedFactor }, timeLimit: null });
    sim.advance(45.3); // plateau
    const a0 = sim.angle;
    sim.step();
    const forward = sim.angle - a0;
    sim.flip();
    const a1 = sim.angle;
    sim.step();
    const backward = sim.angle - a1;
    expect(sim.dir).toBe(-1);
    expect(backward).toBeCloseTo(-forward, 6);
    expect(Math.abs(forward)).toBeCloseTo(PLAYER.angularSpeed * 0.45 * SIM.dt, 6);
    // Pendant une rampe (59 s) : la position ne bouge pas à l'inversion, la vitesse est celle de l'instant
    sim.advance(13.7);
    const b0 = sim.angle;
    sim.flip();
    expect(sim.angle).toBe(b0);
    sim.step();
    expect(Math.abs(sim.angle - b0)).toBeCloseTo(sim.omega * SIM.dt, 3);
  });

  it('une inversion ne change pas la vitesse atteinte (même distance parcourue)', () => {
    const run = (flips: number[]) => {
      const sim = new Simulation({ seed: 1, profile: { ...emptyProfile, speed: survivalSpeedFactor }, timeLimit: null });
      let travelled = 0;
      for (let i = 0; i < 90 * 120; i++) {
        if (flips.includes(i)) sim.flip();
        const a = sim.angle;
        sim.step();
        travelled += Math.abs(angleDiff(a, sim.angle));
      }
      return travelled;
    };
    expect(run([1000, 3000, 5500, 8000])).toBeCloseTo(run([]), 6);
  });
});

describe('Vitesse des niveaux', () => {
  it('chaque niveau a sa vitesse configurable (référence = 1,0) et n’utilise pas la courbe de Survie', () => {
    for (const level of LEVELS) {
      expect(level.speed).toBe(LEVEL_SPEED_DEFAULT);
      const f = levelProfile(level).speed;
      for (const t of [0, 30, 60, 180, 360]) expect(f(t)).toBe(level.speed);
    }
  });

  it('une vitesse de niveau personnalisée est appliquée telle quelle', () => {
    const slow = { ...LEVELS[0], speed: 0.6 };
    const sim = new Simulation({ seed: 1, profile: levelProfile(slow), timeLimit: 90, invincible: true });
    let travelled = 0;
    for (let i = 0; i < 10 * 120; i++) {
      const a = sim.angle;
      sim.step();
      travelled += angleDiff(a, sim.angle);
    }
    expect(travelled).toBeCloseTo(PLAYER.angularSpeed * 0.6 * 10, 3);
  });

  it('la Survie utilise bien la courbe (et pas la vitesse d’un niveau)', () => {
    expect(survivalProfile().speed(0)).toBeCloseTo(0.4, 12);
    expect(survivalProfile().speed(120)).toBeCloseTo(0.6, 12);
  });
});

describe('Pause', () => {
  it('la pause arrête le temps actif, la vitesse, les événements et les menaces', () => {
    const run = (pauseAt: number | null) => {
      const s = new GameSession({ mode: 'survival', seed: 99 });
      s.sim.invincible = true;
      let paused = false;
      for (let i = 0; i < 60 * 70; i++) {
        s.frame(1 / 60);
        if (pauseAt !== null && !paused && s.sim.time >= pauseAt) {
          paused = true;
          s.pause();
          const snap = JSON.stringify({ t: s.sim.time, a: s.sim.angle, h: s.sim.hazards, st: s.sim.director.status(s.sim.time) });
          for (let k = 0; k < 60 * 30; k++) s.frame(1 / 60); // 30 s réelles en pause
          expect(JSON.stringify({ t: s.sim.time, a: s.sim.angle, h: s.sim.hazards, st: s.sim.director.status(s.sim.time) })).toBe(snap);
          s.resume();
          for (let k = 0; k < 60 * 3; k++) s.frame(1 / 60); // compte à rebours
        }
      }
      return s;
    };
    // Pause à l'annonce d'un événement (~52 s) puis comparaison avec une partie sans pause à temps actif égal
    const withPause = run(52.5);
    const control = new GameSession({ mode: 'survival', seed: 99 });
    control.sim.invincible = true;
    while (control.sim.stepIndex < withPause.sim.stepIndex) control.frame(1 / 60);
    expect(control.sim.stepIndex).toBe(withPause.sim.stepIndex);
    expect(control.sim.angle).toBeCloseTo(withPause.sim.angle, 9);
    expect(JSON.stringify(control.sim.hazards)).toBe(JSON.stringify(withPause.sim.hazards));
    expect(control.sim.director.phase).toBe(withPause.sim.director.phase);
    expect(control.sim.director.waveCount).toBe(withPause.sim.director.waveCount);
  });
});

describe('Adaptation à la vitesse réelle', () => {
  it('pleine vitesse : aucun changement ; vaisseau lent : annonces, décalages et intervalles allongés, secteurs plus étroits', () => {
    for (const d of [0, 0.3, 0.6, 0.9]) {
      const full = paramsFor(d, undefined, { speed: 1 });
      const base = paramsFor(d);
      expect(full).toEqual(base);
      const slow = paramsFor(d, undefined, { speed: 0.4 });
      expect(slow.projectileWarn).toBeGreaterThan(base.projectileWarn);
      expect(slow.sectorWarn).toBeGreaterThan(base.sectorWarn);
      expect(slow.laserWarn).toBeGreaterThan(base.laserWarn);
      expect(slow.comboStagger).toBeGreaterThan(base.comboStagger);
      expect(slow.waveInterval).toBeGreaterThanOrEqual(base.waveInterval);
      expect(slow.sectorHalfWidth).toBeLessThan(base.sectorHalfWidth);
      expect(slow.laserRate).toBeLessThan(base.laserRate);
      expect(slow.projectileSpeed).toBe(base.projectileSpeed); // la vitesse des menaces ne change pas
    }
    expect(paceFactor(1, PACE.warn)).toBe(1);
    expect(paceFactor(0.4, PACE.warn)).toBeCloseTo(Math.pow(2.5, PACE.warn), 9);
  });

  it('le validateur d’évitement suit la vitesse réelle : un secteur évitable à pleine vitesse ne l’est plus à 40 %', () => {
    const arcs = [makeSector('arc', 0, 0.65, 2, 0, 0.6)]; // actif à 0,65 s, centré sur le vaisseau
    const q = { angle: 0, dir: 1 as const, time: 0, forcedTime: 0.25, forcedDir: 1 as const, margin: 6 };
    expect(hasEscapePath(arcs, { ...q, speed: () => 1 })).toBe(true);
    expect(hasEscapePath(arcs, { ...q, speed: () => 0.4 })).toBe(false);
    // Avec l'annonce adaptée à la vitesse (×(1/0,4)^0,8 ≈ 2,1), c'est de nouveau évitable
    const adapted = [makeSector('arc', 0, 0.65 * paceFactor(0.4, PACE.warn), 2, 0, 0.6)];
    expect(hasEscapePath(adapted, { ...q, speed: () => 0.4 })).toBe(true);
  });

  it('les pas du validateur parcourent exactement le même angle, même pendant une rampe de vitesse', () => {
    // 59 s : rampe de 58 à 60 s. Intégrale ≈ pas de réseau × n
    const unit = PLAYER.angularSpeed * survivalSpeedFactor(58) * 0.125;
    let t = 58;
    let angle = 0;
    for (let i = 0; i < 10; i++) {
      const t2 = timeAfterTravel(survivalSpeedFactor, t, unit);
      angle += angularTravel(survivalSpeedFactor, t, t2);
      t = t2;
    }
    expect(angle).toBeCloseTo(10 * unit, 3);
  });

  it('validateur = exploration exhaustive : mêmes résultats sur des scénarios aléatoires à plusieurs vitesses', () => {
    // Exploration exhaustive des séquences de décisions (jusqu'à 2^12) avec les mêmes durées de pas
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let agreeTrue = 0;
    let agreeFalse = 0;
    for (let n = 0; n < 90; n++) {
      // Vitesse constante (40 %, 70 %, 100 %) ou rampe de la Survie (passage de 45 % à 50 % entre 58 s et 60 s)
      const mode = n % 4;
      const speed = mode === 3 ? survivalSpeedFactor : () => [0.4, 0.7, 1][mode];
      const t0 = mode === 3 ? 57.5 : 0;
      const hz = [
        makeSector('a', t0, 0.2 + rnd() * 0.6, 0.6 + rnd() * 0.6, rnd() * 6.28, 0.25 + rnd() * 0.3),
        makeSector('b', t0, 0.2 + rnd() * 0.8, 0.6 + rnd() * 0.6, rnd() * 6.28, 0.25 + rnd() * 0.3),
      ];
      const q = { angle: rnd() * 6.28, dir: 1 as const, time: t0, forcedTime: 0.25, forcedDir: 1 as const, margin: 6, speed };
      const fast = hasEscapePath(hz, q);
      const brute = bruteForce(hz, q.angle, q.forcedTime, speed, t0);
      expect(fast).toBe(brute);
      if (fast) agreeTrue++;
      else agreeFalse++;
    }
    expect(agreeTrue).toBeGreaterThan(0);
    expect(agreeFalse).toBeGreaterThan(0);
  });
});

import { SAFETY } from '../src/config/balance';
import { playerHitRadius } from '../src/config/hitbox';
import { hazardHits } from '../src/sim/collision';
import { dangerWindow, type Hazard } from '../src/sim/hazards';

/** Référence indépendante : énumère toutes les séquences de décisions sur le même réseau de pas. */
function bruteForce(hazards: Hazard[], angle: number, forcedTime: number, speed: (t: number) => number, time: number): boolean {
  const unit = PLAYER.angularSpeed * speed(time) * SAFETY.decisionStep;
  let end = time;
  for (const h of hazards) end = Math.max(end, dangerWindow(h).to);
  const until = time + Math.min(SAFETY.maxHorizon, end - time);
  const times = [time];
  while (times[times.length - 1] < until && times.length < 14) times.push(timeAfterTravel(speed, times[times.length - 1], unit));
  const steps = times.length - 1;
  const sub = SAFETY.subSteps;
  const safe = (a: number, delta: number, t0: number, dt: number): boolean => {
    for (let j = 0; j < sub; j++) {
      for (const h of hazards) {
        if (hazardHits(h, a + (delta / sub) * j, delta / sub, t0 + (dt / sub) * j, t0 + (dt / sub) * (j + 1), playerHitRadius(), SAFETY.margin, SAFETY.timeMargin)) return false;
      }
    }
    return true;
  };
  const search = (k: number, a: number): boolean => {
    if (k >= steps) return true;
    const forced = times[k] < time + forcedTime - 1e-9;
    for (const s of forced ? [1] : [1, -1]) {
      if (safe(a, s * unit, times[k], times[k + 1] - times[k]) && search(k + 1, a + s * unit)) return true;
    }
    return false;
  };
  return search(0, angle);
}
