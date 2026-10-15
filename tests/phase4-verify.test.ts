import { describe, expect, it } from 'vitest';
import { SIM } from '../src/config/balance';
import { POWER_CODES, REVIVE } from '../src/config/powers';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';
import type { Simulation } from '../src/sim/simulation';
import { replaySurvival } from '../server/verify';

/** Vérifications de la phase 3 confirmées en phase 4 : reprise sûre, pas de quatrième vie, rejeu exact du Bouclier. */
function dieAt(seed: number, steps: number): Simulation {
  const sim = createSimulation({ mode: 'survival', seed, stock: { boost: 0, gel: 0 } });
  const bot = new Bot(sim, true);
  for (let i = 0; i < steps && sim.state === 'running'; i++) {
    bot.tick();
    sim.step();
    sim.events.length = 0;
  }
  // Mort provoquée : on cesse de piloter et on laisse la simulation aller jusqu'à la collision
  for (let i = 0; i < 120 * 120 && sim.state === 'running'; i++) {
    if (i % 29 === 7) sim.flip();
    sim.step();
    sim.events.length = 0;
  }
  return sim;
}

describe('Reprise sûre (confirmation phase 3)', () => {
  it('menaces écartées, 3 s d’invulnérabilité sans aucune entrée, vaisseau resté sur son orbite', () => {
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const sim = dieAt(seed, 120 * 20);
      expect(sim.state).toBe('dead');
      const angle = sim.angle;
      expect(sim.revive()).toBe(true);
      expect(sim.hazards.length).toBe(0); // aucun danger immédiatement dangereux
      expect(sim.angle).toBe(angle);
      expect(sim.reviveProtected).toBe(true);
      expect(sim.reviveProtection).toBeCloseTo(REVIVE.invulnerability, 6);
      // Aucune entrée pendant toute la protection : le vaisseau ne meurt jamais
      const until = Math.round(REVIVE.invulnerability / SIM.dt);
      for (let i = 0; i < until - 1; i++) {
        sim.step();
        sim.events.length = 0;
        expect(sim.state).toBe('running');
      }
      // Nouvelles menaces annoncées avant d'être actives : aucune n'a déjà commencé à tuer au moment de sa création
      for (const h of sim.hazards) {
        if (h.kind === 'projectile') expect(h.launch).toBeGreaterThanOrEqual(h.warnStart);
        else expect(h.activeStart).toBeGreaterThan(h.warnStart);
      }
    }
  });

  it('aucun Bouclier consommé par la protection de reprise ; effets en cours éteints', () => {
    const sim = dieAt(4, 120 * 20);
    const used = { ...sim.powers.used };
    sim.revive();
    expect(sim.powers.used).toEqual(used);
    expect(sim.powers.shieldActive(sim.stepIndex)).toBe(false);
    expect(sim.powers.free).toBe(true);
  });
});

describe('Aucune quatrième vie', () => {
  it('la simulation refuse toute reprise après la troisième vie ; le service refuse la vie 4', () => {
    const sim = dieAt(5, 120 * 10);
    expect(sim.revive()).toBe(true);
    expect(sim.life).toBe(2);
    for (let i = 0; i < 120 * 600 && sim.state === 'running'; i++) {
      if (i % 29 === 7) sim.flip();
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.state).toBe('dead');
    expect(sim.revive()).toBe(true);
    expect(sim.life).toBe(3);
    sim.invincible = false;
    for (let i = 0; i < 120 * 600 && sim.state === 'running'; i++) {
      if (i % 29 === 7) sim.flip();
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.state).toBe('dead');
    expect(sim.canRevive).toBe(false);
    expect(sim.revive()).toBe(false);
    expect(sim.life).toBe(3);
  });
});

describe('Rejeu exact du Bouclier, des collisions absorbées et des charges', () => {
  it('une partie où le Bouclier absorbe réellement un impact est rejouée à l’identique (durée, score, absorptions, charges)', () => {
    let proven = 0;
    for (let seed = 1; seed < 400 && proven < 2; seed++) {
      const sim = createSimulation({ mode: 'survival', seed, stock: { boost: 3, gel: 3 } });
      const bot = new Bot(sim, true);
      let absorbed = 0;
      let shielded = false;
      for (let i = 0; i < 120 * 1200 && sim.state === 'running'; i++) {
        // Bot tant que le Bouclier n'a pas servi ; ensuite, joueur maladroit qui finit par se faire toucher
        if (!shielded) bot.tick();
        else if (i % 29 === 7) sim.flip();
        if (sim.powers.shieldStored && !sim.powers.shieldActive(sim.stepIndex)) sim.power('shield');
        sim.step();
        for (const e of sim.events) if (e.type === 'shield-absorb') absorbed++;
        if (sim.powers.used.shield > 0) shielded = true;
        sim.events.length = 0;
        if (absorbed > 0 && !shielded) shielded = true;
      }
      if (sim.state !== 'dead' || absorbed === 0) continue;
      const acts = sim.powers.log.map((a) => [a.step, POWER_CODES[a.kind]] as [number, number]);
      const rep = replaySurvival(seed, [...sim.flipLog], acts);
      expect(rep.ok, `seed ${seed}`).toBe(true);
      if (!rep.ok) return;
      expect(rep.steps).toBe(sim.stepIndex);
      expect(rep.score).toBe(sim.scoring.score);
      expect(rep.powers).toEqual(sim.powers.used);
      expect(rep.category).toBe('bonus');
      // Sans l'activation du Bouclier, la même partie se termine avant (l'impact absorbé aurait tué) : le rejeu ne peut pas l'ignorer
      const without = replaySurvival(seed, [...sim.flipLog], acts.filter((a) => a[1] !== POWER_CODES.shield));
      expect(!without.ok || without.steps !== rep.steps).toBe(true);
      proven++;
    }
    expect(proven).toBeGreaterThan(0);
  });
});
