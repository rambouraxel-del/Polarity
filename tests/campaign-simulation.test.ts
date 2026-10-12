import { describe, expect, it } from 'vitest';
import { MissionBot, playMission } from '../src/campaign/bot';
import { CampaignSimulation, NO_UPGRADES } from '../src/campaign/simulation';
import { MISSIONS, UPGRADE_EFFECTS } from '../src/config/campaign';
import { RESPITE, SIM } from '../src/config/balance';
import { createSimulation } from '../src/modes/run';

const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);

describe('missions de campagne : faisabilité (joueur automatique)', () => {
  for (const m of MISSIONS) {
    it(`mission ${m.id} « ${m.title} » est réalisable avec le vaisseau de base`, () => {
      let wins = 0;
      for (const seed of SEEDS) {
        const sim = playMission(CampaignSimulation.create(m, seed));
        if (sim.outcome === 'success') wins++;
      }
      expect(wins).toBe(SEEDS.length);
    });
  }
});

describe('missions de campagne : structure', () => {
  it('dix missions consécutives, durées ≤ 90 s', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const m of MISSIONS) expect(m.limit).toBeLessThanOrEqual(90);
  });

  it('les transmissions en partie tombent dans une respiration (moment sûr)', () => {
    for (const m of MISSIONS) {
      for (const l of m.script.lines) {
        const ok = m.script.breaths.some(([a, b]) => l.at >= a + 0.9 && l.at < b);
        expect(ok, `mission ${m.id} : ligne à ${l.at} s`).toBe(true);
      }
    }
  });

  it('la vitesse est celle de la mission (pas de courbe de Survie)', () => {
    const sim = CampaignSimulation.create(MISSIONS[5], 3);
    const a = sim.speedFn(0);
    const b = sim.speedFn(60);
    expect(a).toBeCloseTo(b, 9);
  });

  it('une même graine donne la même tentative, une autre graine une autre trajectoire', () => {
    const m = MISSIONS[8];
    const run = (seed: number): string => {
      const sim = CampaignSimulation.create(m, seed);
      for (let i = 0; i < 120 * 30; i++) sim.step();
      return JSON.stringify(sim.hazards) + sim.angle.toFixed(6);
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('la Survie ne passe jamais par la campagne', () => {
    const sim = createSimulation({ mode: 'survival', seed: 1 });
    expect(sim).not.toBeInstanceOf(CampaignSimulation);
  });
});

describe('améliorations de campagne', () => {
  /** Fait collisionner le vaisseau avec un danger placé exactement sur lui. */
  function runUntilFirstHit(upgrades = NO_UPGRADES, seed = 11): CampaignSimulation {
    const sim = CampaignSimulation.create(MISSIONS[3], seed, upgrades);
    for (let i = 0; i < 120 * 60 && sim.state === 'running'; i++) sim.step(); // aucun pilote : il finit par être touché
    return sim;
  }

  it('sans bouclier, la première collision termine la tentative', () => {
    const sim = runUntilFirstHit();
    expect(sim.outcome).toBe('failure');
    expect(sim.report().stars.main).toBe(false);
  });

  it('le bouclier absorbe une collision puis protège brièvement ; la deuxième collision tue', () => {
    const sim = CampaignSimulation.create(MISSIONS[3], 11, { ...NO_UPGRADES, shield: true });
    let shieldAt = -1;
    let deathAt = -1;
    for (let i = 0; i < 120 * 60 && sim.state === 'running'; i++) {
      sim.step();
      for (const e of sim.campaignEvents) if (e.type === 'shield' && shieldAt < 0) shieldAt = sim.time;
      sim.campaignEvents.length = 0;
    }
    deathAt = sim.state === 'dead' ? sim.time : -1;
    expect(shieldAt).toBeGreaterThan(0);
    expect(sim.shieldUsed).toBe(true);
    expect(deathAt).toBeGreaterThan(shieldAt + UPGRADE_EFFECTS.shield.invulnerable - 0.01);
    expect(sim.report().stars.noShield).toBe(false);
  });

  it('le bouclier est rechargé à chaque tentative', () => {
    const a = CampaignSimulation.create(MISSIONS[3], 11, { ...NO_UPGRADES, shield: true });
    const b = CampaignSimulation.create(MISSIONS[3], 11, { ...NO_UPGRADES, shield: true });
    expect(a.shieldCharges).toBe(1);
    expect(b.shieldCharges).toBe(1);
  });

  it('étoile « sans bouclier » : acquise sans bouclier possédé, perdue si le bouclier a servi', () => {
    const plain = playMission(CampaignSimulation.create(MISSIONS[0], 21));
    expect(plain.report().stars.noShield).toBe(true);
  });

  it('stabilisateur : répit supplémentaire borné, jamais en dehors des cycles', () => {
    const run = (stab: boolean): number => {
      const sim = CampaignSimulation.create(MISSIONS[4], 31, { ...NO_UPGRADES, stabilizer: stab });
      const bot = new MissionBot(sim);
      let max = 0;
      for (let i = 0; i < 120 * 60 && sim.state === 'running'; i++) {
        bot.tick();
        sim.step();
        sim.events.length = 0;
        max = Math.max(max, sim.director.respiteThisWave);
      }
      return max;
    };
    const withStab = run(true);
    expect(withStab).toBeGreaterThanOrEqual(run(false));
    expect(withStab).toBeLessThanOrEqual(RESPITE.maxPerWave + 1e-9);
  });

  it('collecteur : objets de mission plus faciles à ramasser, hitbox des dangers inchangée', () => {
    const base = CampaignSimulation.create(MISSIONS[2], 1);
    const col = CampaignSimulation.create(MISSIONS[2], 1, { ...NO_UPGRADES, collector: true });
    expect(col.objectRadius).toBeGreaterThan(base.objectRadius);
  });

  it('les pas fixes restent à 1/120 s', () => {
    expect(SIM.dt).toBeCloseTo(1 / 120, 9);
  });
});
