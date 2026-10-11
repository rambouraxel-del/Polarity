import { afterEach, describe, expect, it } from 'vitest';
import { ARENA, PLAYER, SIM } from '../src/config/balance';
import { getHitboxGrowth, HITBOX, playerHitRadius, projectileHitRadius, setHitboxGrowth } from '../src/config/hitbox';
import { asteroidMinHalfExtent, asteroidRadius, shipHalfWidth, shipRadius, VISUAL } from '../src/config/visuals';
import { survivalDifficulty } from '../src/modes/profiles';
import { projectileHits } from '../src/sim/collision';
import type { ProjectileHazard } from '../src/sim/hazards';
import { makeChordProjectile } from '../src/sim/hazards';
import { exhaustDirection, heading, spriteRotation } from '../src/render/geometry';
import { quietSim } from './helpers';

afterEach(() => {
  setHitboxGrowth(HITBOX.defaultGrowth);
});

/** Projectile horizontal passant à la distance `d` d'un joueur immobile en (R, 0). */
function passingAt(d: number): ProjectileHazard {
  return {
    kind: 'projectile', id: 1, pattern: 'shot', warnStart: 0, launch: 0, end: 10, threatEnd: 10,
    x0: ARENA.orbitRadius - 100, y0: d, vx: 500, vy: 0,
    cross1: 0, cross2: 0, crossTime1: 0, crossTime2: 0, warned: false,
  };
}

describe('Hitbox : réglage indépendant', () => {
  it('l’agrandissement par défaut reste dans la plage 5–8 %', () => {
    expect(HITBOX.defaultGrowth).toBeGreaterThanOrEqual(HITBOX.minGrowth);
    expect(HITBOX.defaultGrowth).toBeLessThanOrEqual(HITBOX.maxGrowth);
    expect(getHitboxGrowth()).toBe(HITBOX.defaultGrowth);
    expect(playerHitRadius()).toBeCloseTo(HITBOX.playerBase * (1 + HITBOX.defaultGrowth), 12);
    expect(projectileHitRadius()).toBeCloseTo(HITBOX.projectileBase * (1 + HITBOX.defaultGrowth), 12);
  });

  it('les hitboxes restent en retrait des silhouettes, aux deux extrémités de la plage', () => {
    for (const g of [HITBOX.minGrowth, HITBOX.defaultGrowth, HITBOX.maxGrowth]) {
      setHitboxGrowth(g);
      expect(playerHitRadius()).toBeLessThan(shipHalfWidth());
      expect(projectileHitRadius()).toBeLessThan(asteroidMinHalfExtent());
    }
  });

  it('les visuels sont agrandis de 15 % indépendamment des hitboxes', () => {
    expect(shipRadius()).toBeCloseTo(VISUAL.shipBaseRadius * 1.15, 12);
    expect(asteroidRadius()).toBeCloseTo(VISUAL.asteroidBaseRadius * 1.15, 12);
    const before = shipRadius();
    setHitboxGrowth(0.08);
    expect(shipRadius()).toBe(before);
  });

  it('un passage à la limite : épargné sans agrandissement, touché avec +5 %…+8 %', () => {
    const base = HITBOX.playerBase + HITBOX.projectileBase; // 15
    const near = passingAt(base + 0.3);
    const check = () => projectileHits(near, 0, 0, 0, 0.5, playerHitRadius());
    setHitboxGrowth(0);
    expect(check()).toBe(false);
    setHitboxGrowth(HITBOX.minGrowth);
    expect(check()).toBe(true); // 15 × 1,05 = 15,75 > 15,3
    setHitboxGrowth(HITBOX.maxGrowth);
    expect(check()).toBe(true);
    // Un passage plus large reste épargné même à +8 % (16,2)
    setHitboxGrowth(HITBOX.maxGrowth);
    expect(projectileHits(passingAt(base * 1.08 + 0.3), 0, 0, 0, 0.5, playerHitRadius())).toBe(false);
  });

  it('la hitbox ne change pas la courbe de difficulté', () => {
    const d = [10, 60, 120, 300].map((t) => survivalDifficulty(t));
    setHitboxGrowth(0.08);
    expect([10, 60, 120, 300].map((t) => survivalDifficulty(t))).toEqual(d);
  });

  it('refuse un agrandissement invalide', () => {
    expect(() => setHitboxGrowth(-0.1)).toThrow(RangeError);
    expect(() => setHitboxGrowth(Number.NaN)).toThrow(RangeError);
  });

  it('collision continue conservée avec la hitbox agrandie (projectile à 20 000 unités/s)', () => {
    setHitboxGrowth(HITBOX.maxGrowth);
    const sim = quietSim();
    const tc = 0.2 + (ARENA.spawnRadius - ARENA.orbitRadius) / 20000;
    const a = sim.angle + sim.dir * PLAYER.angularSpeed * tc;
    sim.hazards.push(makeChordProjectile('shot', 0, 0.2, 20000, a, a + Math.PI));
    for (let i = 0; i < 240 && sim.state === 'running'; i++) sim.step();
    expect(sim.state).toBe('dead');
  });
});

describe('Point d’impact', () => {
  it('la mort par projectile fournit un point de contact entre le vaisseau et la menace', () => {
    const sim = quietSim();
    const tc = 0.2 + (ARENA.spawnRadius - ARENA.orbitRadius) / 800;
    const a = sim.angle + sim.dir * PLAYER.angularSpeed * tc;
    sim.hazards.push(makeChordProjectile('shot', 0, 0.2, 800, a, a + Math.PI));
    for (let i = 0; i < 480 && sim.state === 'running'; i++) sim.step();
    expect(sim.state).toBe('dead');
    const death = sim.events.filter((e) => e.type === 'death');
    expect(death).toHaveLength(1);
    const e = death[0];
    if (e.type !== 'death') throw new Error('impossible');
    expect(e.by).toBe('projectile');
    const dist = Math.hypot(e.hitX - e.x, e.hitY - e.y);
    // Le contact est à la frontière des hitboxes : à moins d'un rayon de hitbox du vaisseau
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(playerHitRadius() + projectileHitRadius() + 2 * SIM.dt * 800);
  });

  it('la mort par secteur place l’impact sur le vaisseau', () => {
    const sim = quietSim();
    sim.hazards.push({
      kind: 'sector', id: 1, pattern: 'arc', warnStart: 0, activeStart: 0.05, end: 5, threatEnd: 5,
      center: sim.angle, half: 0.3, warned: false, activated: false,
    });
    sim.advance(1);
    const e = sim.events.find((x) => x.type === 'death');
    expect(e && e.type === 'death' && e.by).toBe('sector');
    if (e && e.type === 'death') {
      expect(e.hitX).toBe(e.x);
      expect(e.hitY).toBe(e.y);
    }
  });
});

describe('Géométrie du réacteur', () => {
  it('le déplacement est tangent à l’orbite et le réacteur lui est exactement opposé', () => {
    for (const dir of [1, -1] as const) {
      for (let a = 0; a < 6.3; a += 0.37) {
        const h = heading(a, dir);
        const ex = exhaustDirection(a, dir);
        expect(Math.hypot(h.x, h.y)).toBeCloseTo(1, 12);
        // tangent : orthogonal au rayon
        expect(h.x * Math.cos(a) + h.y * Math.sin(a)).toBeCloseTo(0, 12);
        // même sens que la dérivée de la position (R cos a, R sin a) selon dir
        expect(h.x * -Math.sin(a) * dir + h.y * Math.cos(a) * dir).toBeCloseTo(1, 12);
        expect(ex.x).toBeCloseTo(-h.x, 12);
        expect(ex.y).toBeCloseTo(-h.y, 12);
      }
    }
  });

  it('une inversion retourne immédiatement la direction du vaisseau et du réacteur', () => {
    const a = 1.234;
    const h1 = heading(a, 1);
    const h2 = heading(a, -1);
    expect(h2.x).toBeCloseTo(-h1.x, 12);
    expect(h2.y).toBeCloseTo(-h1.y, 12);
    const ex1 = exhaustDirection(a, 1);
    const ex2 = exhaustDirection(a, -1);
    expect(ex2.x).toBeCloseTo(-ex1.x, 12);
  });

  it('la rotation du sprite (nez vers le haut) pointe dans la direction du déplacement', () => {
    for (let a = 0; a < 6.3; a += 0.41) {
      for (const dir of [1, -1] as const) {
        const h = heading(a, dir);
        const th = spriteRotation(h.x, h.y);
        // nez après rotation Phaser : (sin θ, −cos θ)
        expect(Math.sin(th)).toBeCloseTo(h.x, 12);
        expect(-Math.cos(th)).toBeCloseTo(h.y, 12);
      }
    }
  });
});
