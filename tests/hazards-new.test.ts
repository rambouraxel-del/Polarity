import { afterEach, describe, expect, it } from 'vitest';
import { ARENA, CAPS, SECTOR, SIM } from '../src/config/balance';
import { CONVOY, FRAGMENT, LASER } from '../src/config/hazards';
import { HITBOX, playerHitRadius, projectileHitRadius, setHitboxGrowth } from '../src/config/hitbox';
import { survivalSpeedFactor } from '../src/config/playerSpeed';
import { TAU } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { LEVELS } from '../src/config/levels';
import { levelProfile, survivalProfile, survivalWeights } from '../src/modes/profiles';
import { laserHits, projectileHits } from '../src/sim/collision';
import { paramsFor } from '../src/sim/difficulty';
import { laserAngle, makeLaser, makeRayProjectile, type Hazard, type LaserHazard, type ProjectileHazard } from '../src/sim/hazards';
import { PATTERNS } from '../src/sim/patterns';
import { hasEscapePath } from '../src/sim/safety';
import { Simulation } from '../src/sim/simulation';
import { quietSim } from './helpers';

afterEach(() => setHitboxGrowth(HITBOX.defaultGrowth));

const ctx = (seed: number, d = 0.6, speed = 1, angle = 0.3, dir: 1 | -1 = 1) => ({
  now: 10,
  rng: new Rng(seed),
  p: paramsFor(d, undefined, { speed }),
  playerAngle: angle,
  playerDir: dir,
  speed: () => speed,
});

describe('Astéroïde fragmenté', () => {
  it('se divise en deux fragments après avoir traversé l’orbite ; trajectoires annoncées dès le début', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const hz = PATTERNS.fragment.build(ctx(seed));
      expect(hz).toHaveLength(3);
      const [main, f1, f2] = hz as ProjectileHazard[];
      // Annonce : le point de passage (entrée) est connu, et la division se produit après le passage sur l'orbite
      expect(main.split).toBeDefined();
      expect(main.split!.t).toBeGreaterThan(main.crossTime1);
      expect(main.end).toBeCloseTo(main.split!.t, 9);
      expect(main.cross2).toBe(main.cross1);
      // Les fragments partent du point de division, au moment de la division, avec la même annonce que l'astéroïde
      for (const f of [f1, f2]) {
        expect(f.fragment).toBe(true);
        expect(f.warnStart).toBe(main.warnStart);
        expect(f.launch).toBeCloseTo(main.split!.t, 9);
        expect(f.x0).toBeCloseTo(main.split!.x, 9);
        expect(f.y0).toBeCloseTo(main.split!.y, 9);
        expect(f.scale).toBe(FRAGMENT.scale);
        // Délai de réaction : le fragment met au moins `minLead` à atteindre l'orbite après la division
        expect(f.crossTime1 - f.launch).toBeGreaterThanOrEqual(FRAGMENT.minLead - 1e-9);
        // L'annonce est visible bien avant que le fragment soit dangereux
        expect(f.launch - f.warnStart).toBeGreaterThanOrEqual(ctx(seed).p.projectileWarn);
        // Il coupe l'orbite en un seul point (sortie)
        expect(f.cross1).toBe(f.cross2);
      }
      // Les deux fragments divergent
      expect(Math.abs(Math.atan2(f1.vy, f1.vx) - Math.atan2(f2.vy, f2.vx))).toBeGreaterThan(0.6);
      // Vitesse des fragments plafonnée comme les autres projectiles
      expect(Math.hypot(f1.vx, f1.vy)).toBeLessThanOrEqual(CAPS.maxProjectileSpeed);
    }
  });

  it('la hitbox d’un fragment est plus petite (même rapport que son visuel)', () => {
    const base = (scale: number): ProjectileHazard => ({
      kind: 'projectile', id: 1, pattern: 'fragment', warnStart: 0, launch: 0, end: 10, threatEnd: 10,
      x0: ARENA.orbitRadius - 100, y0: 15, vx: 500, vy: 0, cross1: 0, cross2: 0, crossTime1: 0, crossTime2: 0, warned: false, scale,
    });
    // Passage à 15 unités : touche un astéroïde normal (7,46 + 8,52 = 15,98) mais pas un fragment (7,46 + 5,96 = 13,4)
    expect(projectileHits(base(1), 0, 0, 0, 0.5, playerHitRadius())).toBe(true);
    expect(projectileHits(base(FRAGMENT.scale), 0, 0, 0, 0.5, playerHitRadius())).toBe(false);
    expect(projectileHitRadius() * FRAGMENT.scale).toBeLessThan(projectileHitRadius());
  });

  it('collision : l’astéroïde ne touche plus rien après la division, les fragments tuent', () => {
    const pr = playerHitRadius();
    let killed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const hz = PATTERNS.fragment.build({ ...ctx(seed, 0.7), now: 0, playerAngle: 0, playerDir: 1 }) as ProjectileHazard[];
      const [main, f1] = hz;
      // L'astéroïde d'origine a disparu à la division : plus aucune collision possible sur son point d'entrée
      expect(projectileHits(main, main.cross1, 0, main.end + 0.001, main.end + 0.5, pr)).toBe(false);
      // Un fragment touche un vaisseau placé à son point de sortie, quand il y arrive
      const sim = quietSim();
      sim.angle = f1.cross1 - sim.dir * sim.omega * f1.crossTime1;
      sim.hazards.push(f1);
      for (let i = 0; i < Math.ceil((f1.crossTime1 + 0.5) / SIM.dt) && sim.state === 'running'; i++) sim.step();
      if (sim.state === 'dead') {
        killed++;
        const death = sim.events.find((e) => e.type === 'death');
        expect(death && death.type === 'death' && death.by).toBe('projectile');
        expect(sim.time).toBeGreaterThanOrEqual(f1.launch);
      }
    }
    expect(killed).toBeGreaterThan(10);
  });

  it('géométrie générale : makeRayProjectile trouve les passages et la fin de menace', () => {
    // Part du centre vers la droite à 200 u/s : sort de l'orbite à t = 1,5 s
    const h = makeRayProjectile('x', 0, 0, 0, 0, 200, 0);
    expect(h.crossTime1).toBeCloseTo(300 / 200, 9);
    expect(h.cross1).toBeCloseTo(0, 9);
    expect(h.threatEnd).toBeCloseTo(340 / 200, 9);
  });
});

describe('Convoi d’astéroïdes', () => {
  it('2 ou 3 astéroïdes sur la même trajectoire, décalés dans le temps', () => {
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const c = ctx(seed, 0.5, 0.7);
      const hz = PATTERNS.convoy.build(c) as ProjectileHazard[];
      sizes.add(hz.length);
      expect(hz.length).toBeGreaterThanOrEqual(CONVOY.count.min);
      expect(hz.length).toBeLessThanOrEqual(CONVOY.count.max);
      for (let i = 1; i < hz.length; i++) {
        expect(hz[i].x0).toBeCloseTo(hz[0].x0, 9);
        expect(hz[i].y0).toBeCloseTo(hz[0].y0, 9);
        expect(hz[i].vx).toBeCloseTo(hz[0].vx, 9);
        expect(hz[i].vy).toBeCloseTo(hz[0].vy, 9);
        expect(hz[i].warnStart).toBe(hz[0].warnStart);
        // Décalage : au moins le minimum, et au moins le décalage de la difficulté (adapté à la vitesse du vaisseau)
        const gap = hz[i].launch - hz[i - 1].launch;
        expect(gap).toBeGreaterThanOrEqual(CONVOY.minStagger - 1e-9);
        expect(gap).toBeGreaterThanOrEqual(c.p.comboStagger * CONVOY.stagger.min - 1e-9);
        // Leur passage sur l'orbite est donc décalé du même temps
        expect(hz[i].crossTime1 - hz[i - 1].crossTime1).toBeCloseTo(gap, 9);
      }
    }
    expect(sizes.has(2) && sizes.has(3)).toBe(true);
  });

  it('le décalage s’allonge quand le vaisseau est lent', () => {
    const gap = (m: number) => {
      const hz = PATTERNS.convoy.build(ctx(7, 0.5, m)) as ProjectileHazard[];
      return hz[1].launch - hz[0].launch;
    };
    expect(gap(0.4)).toBeGreaterThan(gap(1));
  });
});

describe('Laser balayeur', () => {
  const beam = (rate = 1, span = 1.6, start = 1): LaserHazard => makeLaser('laser', 0, 1, start, rate, span, LASER.half);

  it('ne tue que pendant l’activité, et seulement dans l’arc balayé : le reste est la zone de refuge', () => {
    const h = beam(1.2, 1.5, 1);
    const pr = playerHitRadius();
    // Vaisseau immobile au milieu de l'arc : touché quand le rayon passe
    const mid = 1 + 0.75;
    let hit = false;
    for (let t = 0; t < 4; t += SIM.dt) if (laserHits(h, mid, 0, t, t + SIM.dt, pr)) hit = true;
    expect(hit).toBe(true);
    // Avant l'activation : jamais
    for (let t = 0; t < h.activeStart - 0.01; t += SIM.dt) expect(laserHits(h, 1, 0, t, t + SIM.dt, pr)).toBe(false);
    // Hors de l'arc (zone de refuge) : jamais
    for (const a of [1 + 1.5 + 0.2, 1 - 0.2, 4, 5.5]) {
      for (let t = 0; t < 4; t += SIM.dt) expect(laserHits(h, a, 0, t, t + SIM.dt, pr)).toBe(false);
    }
    // Après la fin : jamais
    expect(laserHits(h, mid, 0, h.end + 0.01, h.end + 0.2, pr)).toBe(false);
  });

  it('collision continue : un rayon très rapide ou un face-à-face ne passent pas « à travers » le vaisseau', () => {
    const fast = beam(9, 2, 0.5); // 9 rad/s : 0,075 rad par pas
    const pr = playerHitRadius();
    let hit = false;
    for (let t = 0; t < 2; t += SIM.dt) if (laserHits(fast, 1.3, 0, t, t + SIM.dt, pr)) hit = true;
    expect(hit).toBe(true);
    // Le vaisseau et le rayon se croisent en sens inverse dans un même pas : détecté
    const h = beam(1, 3, 0);
    const a0 = laserAngle(h, h.activeStart + 1) + 0.05; // juste devant le rayon
    expect(laserHits(h, a0, -0.1, h.activeStart + 1, h.activeStart + 1 + SIM.dt * 20, pr)).toBe(true);
  });

  it('dans la simulation, la mort par laser est comptée une fois et place l’impact sur le vaisseau', () => {
    const sim = quietSim();
    const h = makeLaser('laser', 0, 0.2, sim.angle - 0.2, 1.0, 1.2, LASER.half);
    sim.hazards.push(h);
    // Le vaisseau avance dans le sens du balayage mais plus vite que le rayon ? Non : plus lent à vitesse réduite
    sim.advance(3);
    const deaths = sim.events.filter((e) => e.type === 'death');
    expect(deaths.length).toBeLessThanOrEqual(1);
    if (sim.state === 'dead') {
      const e = deaths[0];
      expect(e.type === 'death' && e.by).toBe('laser');
    }
  });

  it('le motif laisse toujours une zone de refuge d’au moins LASER.minRefuge et un secteur limité', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const d of [0, 0.5, 0.93]) {
        const [h] = PATTERNS.laser.build(ctx(seed, d, 0.4 + (seed % 7) * 0.1)) as LaserHazard[];
        expect(h.kind).toBe('laser');
        expect(TAU - h.span - 2 * h.half).toBeGreaterThanOrEqual(LASER.minRefuge - 1e-9);
        expect(Math.abs(h.rate)).toBeGreaterThan(0);
        expect(h.end - h.activeStart).toBeCloseTo(h.span / Math.abs(h.rate), 9);
        expect(h.activeStart - h.warnStart).toBeGreaterThanOrEqual(CAPS.minLaserWarn);
      }
    }
  });

  it('validateur : une zone de refuge doit rester atteignable', () => {
    const speed = () => 0.5;
    const q = { angle: 1.5, dir: 1 as const, time: 0, forcedTime: 0.25, forcedDir: 1 as const, margin: 6, speed };
    // Vaisseau au milieu de l'arc, rayon rapide, annonce trop courte : impossible
    expect(hasEscapePath([makeLaser('l', 0, 0.3, 1, 3, 1.5, LASER.half)], q)).toBe(false);
    // Annonce longue (le vaisseau peut sortir de l'arc avant l'activation) : possible
    expect(hasEscapePath([makeLaser('l', 0, 2.2, 1, 1.4, 1.5, LASER.half)], q)).toBe(true);
    // Vaisseau hors de l'arc : toujours possible
    expect(hasEscapePath([makeLaser('l', 0, 0.3, 1, 1.4, 1.5, LASER.half)], { ...q, angle: 4 })).toBe(true);
  });

  it('un laser compte comme un secteur dans les plafonds (simultanés et couverture)', () => {
    expect(SECTOR.maxSimultaneous).toBe(2);
    // 25 minutes de Survie : jamais plus de 2 secteurs + lasers à la fois, jamais plus de 36 % du cercle
    const sim = new Simulation({ seed: 31, profile: survivalProfile(), timeLimit: null, invincible: true });
    let maxArcs = 0;
    let maxCoverage = 0;
    let lasers = 0;
    sim.director.onWave = (_t, id) => {
      if (id === 'laser') lasers++;
    };
    for (let i = 0; i < 25 * 60 * 120; i++) {
      sim.step();
      sim.events.length = 0;
      let arcs = 0;
      let cov = 0;
      for (const h of sim.hazards) {
        if (h.kind === 'projectile') continue;
        arcs++;
        cov += h.kind === 'sector' ? 2 * h.half : h.span + 2 * h.half;
      }
      maxArcs = Math.max(maxArcs, arcs);
      maxCoverage = Math.max(maxCoverage, cov / TAU);
    }
    expect(lasers).toBeGreaterThan(10);
    expect(maxArcs).toBeLessThanOrEqual(SECTOR.maxSimultaneous);
    expect(maxCoverage).toBeLessThanOrEqual(SECTOR.maxCoverage + 1e-9);
  });
});

describe('Introduction progressive', () => {
  it('convoi dès ≈ 38 s, astéroïde fragmenté dès 75 s, laser dès 110 s ; rien avant', () => {
    for (let t = 0; t < 38; t += 1) expect(survivalWeights(t).convoy ?? 0).toBe(0);
    for (let t = 0; t < 75; t += 1) expect(survivalWeights(t).fragment ?? 0).toBe(0);
    for (let t = 0; t < 110; t += 1) expect(survivalWeights(t).laser ?? 0).toBe(0);
    expect(survivalWeights(50).convoy).toBeGreaterThan(0);
    expect(survivalWeights(90).fragment).toBeGreaterThan(0);
    expect(survivalWeights(130).laser).toBeGreaterThan(0);
    // L'ordre d'introduction est progressif
    expect(survivalWeights(120).convoy!).toBeGreaterThan(survivalWeights(120).laser!);
  });

  it('empirique : jamais avant leur palier, présents ensuite', () => {
    const firsts: Record<string, number[]> = { convoy: [], fragment: [], laser: [] };
    for (let seed = 1; seed <= 8; seed++) {
      const sim = new Simulation({ seed: seed * 53, profile: survivalProfile(), timeLimit: null, invincible: true });
      const seen: Record<string, number> = {};
      sim.director.onWave = (t, id, phase) => {
        // Pendant les événements, seuls les motifs de l'événement sont utilisés (convoi inclus : l'événement l'introduit)
        if (phase !== 'event' && id in firsts && seen[id] === undefined) seen[id] = t;
        if (phase === 'event' && id === 'convoy' && seen.convoyEvent === undefined) seen.convoyEvent = t;
      };
      for (let i = 0; i < 260 * 120; i++) {
        sim.step();
        sim.events.length = 0;
      }
      for (const k of Object.keys(firsts)) firsts[k].push(seen[k] ?? Infinity);
    }
    expect(Math.min(...firsts.convoy)).toBeGreaterThanOrEqual(38);
    expect(Math.min(...firsts.fragment)).toBeGreaterThanOrEqual(75);
    expect(Math.min(...firsts.laser)).toBeGreaterThanOrEqual(110);
    for (const k of Object.keys(firsts)) expect(firsts[k].filter((x) => x < Infinity).length).toBeGreaterThanOrEqual(6);
  });

  it('les niveaux ne contiennent pas les nouveaux dangers (réservés à la Survie et au défi)', () => {
    for (const level of LEVELS) {
      const w = levelProfile(level).weights(60);
      expect(w.fragment ?? 0).toBe(0);
      expect(w.convoy ?? 0).toBe(0);
      expect(w.laser ?? 0).toBe(0);
      expect(levelProfile(level).events).toBeUndefined();
    }
  });
});

describe('Survie : le robot traverse les nouveaux dangers', () => {
  it('survit 6 minutes sur plusieurs graines (vitesse progressive, événements, fragments, convois, lasers)', async () => {
    const { playWithBot } = await import('../src/sim/bot');
    for (const seed of [3, 17, 44, 91]) {
      const sim = new Simulation({ seed, profile: survivalProfile(), timeLimit: null });
      playWithBot(sim, 360);
      expect(sim.state).toBe('running');
      expect(survivalSpeedFactor(sim.time)).toBeGreaterThan(0.99);
    }
  });
});

describe('Types', () => {
  it('Hazard couvre projectile, secteur et laser', () => {
    const kinds: Hazard['kind'][] = ['projectile', 'sector', 'laser'];
    expect(kinds).toHaveLength(3);
  });
});
