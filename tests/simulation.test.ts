import { describe, expect, it } from 'vitest';
import { ARENA, PLAYER, RESPITE, SIM } from '../src/config/balance';
import { wrapAngle } from '../src/core/math';
import { BeaconRing } from '../src/sim/beacons';
import { makeChordProjectile, makeSector } from '../src/sim/hazards';
import { Simulation } from '../src/sim/simulation';
import { survivalProfile } from '../src/modes/profiles';
import { emptyProfile, quietSim } from './helpers';

describe('Inversion', () => {
  it('conserve la position et change exactement une fois la direction', () => {
    const sim = quietSim();
    sim.advance(0.5);
    const angle = sim.angle;
    const dir = sim.dir;
    sim.flip();
    // L'inversion ne déplace pas : la position n'a pas changé avant le pas suivant
    expect(sim.angle).toBe(angle);
    sim.step();
    expect(sim.dir).toBe(-dir);
    expect(sim.flips).toBe(1);
    expect(sim.angle).toBeCloseTo(angle - dir * PLAYER.angularSpeed * SIM.dt, 12);
    expect(sim.events.filter((e) => e.type === 'flip')).toHaveLength(1);
  });

  it('deux actions donnent deux inversions (retour au sens initial)', () => {
    const sim = quietSim();
    const dir = sim.dir;
    sim.flip();
    sim.flip();
    sim.step();
    expect(sim.dir).toBe(dir);
    expect(sim.flips).toBe(2);
  });

  it('l’inversion ne casse pas le combo', () => {
    const sim = quietSim();
    sim.advance(4); // plus d'un tour : collectes rapprochées → multiplicateur ×2
    const mult = sim.scoring.multiplier;
    expect(mult).toBeGreaterThan(1);
    sim.flip();
    sim.step();
    expect(sim.scoring.multiplier).toBe(mult);
  });
});

describe('Balises', () => {
  it('collecte une seule fois par cycle et ne récompense pas l’oscillation', () => {
    const ring = new BeaconRing();
    const target = ring.angles[0];
    let collected = 0;
    const onC = () => collected++;
    ring.sweep(target - 0.05, 0.1, onC, () => undefined);
    expect(collected).toBe(1);
    // Allers-retours sur la même balise
    for (let i = 0; i < 10; i++) {
      ring.sweep(target + 0.05, -0.1, onC, () => undefined);
      ring.sweep(target - 0.05, 0.1, onC, () => undefined);
    }
    expect(collected).toBe(1);
  });

  it('fonctionne dans les deux sens et au passage de zéro', () => {
    const ring = new BeaconRing();
    // Une balise proche de 0 rad n'existe pas forcément : on vérifie le passage en sens négatif à travers 0
    const got: number[] = [];
    ring.sweep(0.3, -(Math.PI * 2 * 0.5), (i) => got.push(i), () => undefined);
    for (const i of got) {
      const a = ring.angles[i];
      const d = wrapAngle(0.3 - a);
      expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
    expect(got.length).toBe(3);
  });

  it('un grand pas (image longue) collecte toutes les balises traversées, une fois', () => {
    const ring = new BeaconRing();
    let n = 0;
    // Départ juste après une balise : un pas de presque un tour traverse les cinq autres
    const start = ring.angles[0] + 0.01;
    ring.sweep(start, Math.PI * 1.99, () => n++, () => undefined);
    expect(n).toBe(5);
    expect(ring.remaining).toBe(1);
  });

  it('un cycle complet donne le bonus, réactive les six balises', () => {
    const sim = quietSim();
    sim.advance((Math.PI * 2) / PLAYER.angularSpeed + 0.1);
    const cycles = sim.events.filter((e) => e.type === 'cycle');
    expect(cycles).toHaveLength(1);
    expect(sim.scoring.cycles).toBe(1);
    expect(sim.beacons.remaining).toBeGreaterThanOrEqual(5);
    expect(sim.scoring.beacons).toBe(6 + (6 - sim.beacons.remaining));
  });

  it('la collecte fonctionne en sens inverse sur plusieurs tours', () => {
    const sim = quietSim();
    sim.flip();
    sim.advance(3 * ((Math.PI * 2) / PLAYER.angularSpeed) + 0.05);
    expect(sim.scoring.cycles).toBe(3);
  });
});

describe('Répit de cycle (Survie)', () => {
  it('retarde la vague en attente, borné par le délai minimal et le cumul maximal', () => {
    const sim = new Simulation({ seed: 3, profile: { ...emptyProfile, firstWaveDelay: 100 }, timeLimit: null });
    const d = sim.director;
    const before = d.nextWaveAt;
    expect(d.onCycleComplete(10)).toBeCloseTo(RESPITE.delay);
    // Trop tôt : refusé
    expect(d.onCycleComplete(10 + RESPITE.cooldown / 2)).toBe(0);
    const second = d.onCycleComplete(10 + RESPITE.cooldown);
    expect(second).toBeCloseTo(Math.min(RESPITE.delay, RESPITE.maxPerWave - RESPITE.delay));
    // Cumul atteint : plus rien pour cette vague
    expect(d.onCycleComplete(10 + 3 * RESPITE.cooldown)).toBe(0);
    expect(d.nextWaveAt - before).toBeLessThanOrEqual(RESPITE.maxPerWave + 1e-9);
  });

  it('aucun répit stocké si aucune vague n’est en attente', () => {
    const sim = new Simulation({ seed: 3, profile: { ...emptyProfile, firstWaveDelay: 5 }, timeLimit: null });
    expect(sim.director.onCycleComplete(6)).toBe(0);
  });

  it('pas de répit en mode Niveaux', () => {
    const sim = new Simulation({ seed: 3, profile: { ...emptyProfile, firstWaveDelay: 100, respite: false }, timeLimit: 90 });
    expect(sim.director.onCycleComplete(10)).toBe(0);
  });
});

describe('Collisions', () => {
  it('un projectile très rapide n’est pas perdu entre deux images', () => {
    const sim = quietSim();
    // Projectile à 20 000 unités/s : il parcourt ~167 unités par pas, bien plus que la hitbox.
    // Tir diamétral : premier passage sur l'orbite à t = 0,2 + (S − R) / v ; on vise la position du joueur à cet instant
    const tc = 0.2 + (ARENA.spawnRadius - ARENA.orbitRadius) / 20000;
    const a = sim.angle + sim.dir * PLAYER.angularSpeed * tc;
    const h = makeChordProjectile('shot', 0, 0.2, 20000, a, a + Math.PI);
    sim.hazards.push(h);
    let steps = 0;
    while (sim.state === 'running' && steps < 240) {
      sim.step();
      steps++;
    }
    expect(sim.state).toBe('dead');
  });

  it('le secteur tue seulement une fois actif', () => {
    const sim = quietSim();
    sim.hazards.push(makeSector('arc', 0, 1, 1, sim.angle + 0.6, 0.2));
    sim.advance(0.5); // traverse le secteur pendant l'annonce
    expect(sim.state).toBe('running');
    const sim2 = quietSim();
    sim2.hazards.push(makeSector('arc', 0, 0.1, 2, sim2.angle + 0.6, 0.2));
    sim2.advance(1);
    expect(sim2.state).toBe('dead');
  });

  it('la mort arrête le gameplay et n’est comptée qu’une fois', () => {
    const sim = quietSim();
    sim.hazards.push(makeSector('arc', 0, 0.05, 5, sim.angle, 0.3));
    sim.advance(1);
    expect(sim.state).toBe('dead');
    const t = sim.time;
    const score = sim.scoring.score;
    sim.flip();
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.time).toBe(t);
    expect(sim.scoring.score).toBe(score);
    expect(sim.events.filter((e) => e.type === 'death')).toHaveLength(1);
    expect(sim.events.filter((e) => e.type === 'flip')).toHaveLength(0);
  });
});

describe('Fin de niveau', () => {
  it('se termine exactement à la durée limite', () => {
    const sim = quietSim(90);
    sim.advance(100);
    expect(sim.state).toBe('complete');
    expect(sim.time).toBeCloseTo(90, 9);
    expect(sim.events.filter((e) => e.type === 'complete')).toHaveLength(1);
  });

  it('collision et fin du chrono dans le même pas : la collision l’emporte (règle documentée)', () => {
    const sim = quietSim(1);
    // Secteur qui s'active pendant le dernier pas, exactement sous le joueur
    const lastStepStart = 1 - SIM.dt;
    const angleAtLast = PLAYER.startAngle + PLAYER.startDirection * PLAYER.angularSpeed * lastStepStart;
    sim.hazards.push(makeSector('arc', 0, lastStepStart + SIM.dt / 2, 1, angleAtLast, 0.1));
    sim.advance(2);
    expect(sim.state).toBe('dead');
  });
});

describe('Déterminisme', () => {
  function trace(seed: number, flipsAt: number[]): string {
    const sim = new Simulation({ seed, profile: survivalProfile(), timeLimit: null, invincible: true });
    const out: string[] = [];
    for (let i = 0; i < 120 * 90; i++) {
      if (flipsAt.includes(i)) sim.flip();
      sim.step();
      for (const h of sim.hazards) {
        if (h.warnStart === sim.time - SIM.dt || out.length === 0) out.push(`${h.kind}:${h.warnStart.toFixed(4)}`);
      }
    }
    for (const h of sim.hazards) out.push(JSON.stringify(h));
    return `${out.join('|')}#${sim.director.waveCount}`;
  }

  it('une graine identique reproduit les motifs pour des entrées identiques', () => {
    const inputs = [100, 400, 900, 2000, 5000];
    expect(trace(1234, inputs)).toBe(trace(1234, inputs));
  });

  it('une autre graine donne d’autres motifs', () => {
    expect(trace(1234, [])).not.toBe(trace(999, []));
  });
});

describe('Projectiles', () => {
  it('la trajectoire passe par les deux angles annoncés', () => {
    const h = makeChordProjectile('shot', 0, 1, 400, 0.3, 2.5);
    for (const [a, t] of [[h.cross1, h.crossTime1], [h.cross2, h.crossTime2]]) {
      const x = h.x0 + h.vx * (t - h.launch);
      const y = h.y0 + h.vy * (t - h.launch);
      expect(x).toBeCloseTo(ARENA.orbitRadius * Math.cos(a), 6);
      expect(y).toBeCloseTo(ARENA.orbitRadius * Math.sin(a), 6);
    }
    expect(h.crossTime1).toBeLessThan(h.crossTime2);
  });
});
