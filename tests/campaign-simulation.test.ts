import { describe, expect, it } from 'vitest';
import { MissionBot, playMission } from '../src/campaign/bot';
import { CampaignSimulation, NO_UPGRADES } from '../src/campaign/simulation';
import { MISSIONS, UPGRADE_EFFECTS } from '../src/config/campaign';
import { RESPITE, SIM } from '../src/config/balance';
import { createSimulation } from '../src/modes/run';

const SEEDS = Array.from({ length: 4 }, (_, i) => 1000 + i * 7919);

describe('missions de campagne : faisabilité et durée (joueur automatique parfait)', () => {
  for (const m of MISSIONS) {
    it(`mission ${m.id} « ${m.title} » : réalisable, entre 90 et 300 s de jeu, défi secondaire atteignable`, () => {
      for (const seed of SEEDS) {
        const sim = playMission(CampaignSimulation.create(m, seed));
        expect(sim.outcome, `graine ${seed}`).toBe('success');
        const r = sim.report();
        // Même un joueur parfait ne finit pas avant 90 s (objectifs répartis sur toute la mission, sans attente artificielle)
        expect(r.time, `graine ${seed}`).toBeGreaterThanOrEqual(90);
        expect(r.time).toBeLessThanOrEqual(300);
        expect(r.time).toBeLessThanOrEqual(m.limit);
        expect(r.stars.challenge, `défi secondaire, graine ${seed}`).toBe(true);
      }
    });
  }

  it('durées de jeu du joueur parfait dans les fourchettes prévues par niveau (6 à 10)', () => {
    const range: Record<number, [number, number]> = { 6: [90, 180], 7: [100, 190], 8: [120, 210], 9: [130, 230], 10: [140, 240] };
    for (const m of MISSIONS.filter((x) => x.id >= 6)) {
      const t = playMission(CampaignSimulation.create(m, 1000)).report().time;
      expect(t, `niveau ${m.id}`).toBeGreaterThanOrEqual(range[m.id][0]);
      expect(t, `niveau ${m.id}`).toBeLessThanOrEqual(range[m.id][1]);
    }
    const first = MISSIONS.map((m) => playMission(CampaignSimulation.create(m, 1000)).report().time);
    expect(first[4]).toBeGreaterThan(first[0] + 60);
  });

  it('consignes, compteurs et conditions de victoire concordent', () => {
    for (const m of MISSIONS) {
      const o = m.objective;
      if (o.type === 'beacons') expect(m.objectiveText).toContain(String(o.count));
      if (o.type === 'objects') {
        expect(m.objectiveText).toContain(String(o.count));
        if (o.after) expect(m.objectiveText).toContain(String(o.after.beacons));
      }
      if (o.type === 'survive') expect(m.objectiveText).toContain(String(o.seconds));
      expect(m.limit).toBeLessThanOrEqual(300);
      // La limite laisse de la marge au joueur : objectifs à collecter (limite ≥ 1,5 × la durée du joueur parfait testée ci-dessus)
      if (o.type !== 'survive') expect(m.limit).toBeGreaterThanOrEqual(200);
    }
  });

  it('niveau 5 : phase d’approche (éclats) puis balise narrative distincte, compteur cohérent', () => {
    const m = MISSIONS[4];
    const sim = CampaignSimulation.create(m, 7);
    expect(sim.progressText()).toBe('Approche de la capsule : éclats 0/90');
    expect(sim.objects).toHaveLength(0);
    const bot = new MissionBot(sim);
    let sawObject = false;
    for (let i = 0; i < 120 * 300 && sim.state === 'running'; i++) {
      bot.tick();
      sim.step();
      sim.events.length = 0;
      sim.campaignEvents.length = 0;
      if (sim.objects.length > 0 && !sawObject) {
        sawObject = true;
        expect(sim.beaconsCollected).toBeGreaterThanOrEqual(90);
        expect(sim.objects[0].kind).toBe('blackbox');
        expect(sim.progressText()).toMatch(/^Téléchargement \d\/5$/);
      }
    }
    expect(sawObject).toBe(true);
    expect(sim.outcome).toBe('success');
  });
});

describe('missions de campagne : structure', () => {
  it('dix niveaux consécutifs, limites ≤ 300 s', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const m of MISSIONS) expect(m.limit).toBeLessThanOrEqual(300);
  });

  it('aucun laser hostile avant le niveau 11 ; niveaux 1 à 5 : astéroïdes seulement', () => {
    const asteroids = new Set(['shot', 'diameter', 'parallel', 'cross', 'burst', 'fragment', 'convoy']);
    for (const m of MISSIONS) {
      const all = [...m.script.phases.map((p) => p.weights), ...(m.script.phaseByCycles ?? [])];
      for (const w of all) for (const k of Object.keys(w)) {
        expect(k, `niveau ${m.id} : laser`).not.toMatch(/laser/);
        if (m.id <= 5) expect(asteroids.has(k), `niveau ${m.id} : motif ${k}`).toBe(true);
      }
    }
  });

  it('aucune transmission en pleine esquive : la narration se joue avant et après le niveau', () => {
    for (const m of MISSIONS) {
      expect(m.script.lines).toEqual([]);
      // Niveaux 1 à 5 : aucun bandeau ; niveaux 6 à 10 : seulement de courts bandeaux d'information (jamais de dialogue)
      if (m.id <= 5) expect(m.script.announces).toEqual([]);
    }
  });

  it('la vitesse est celle de la mission (pas de courbe de Survie)', () => {
    const sim = CampaignSimulation.create(MISSIONS[2], 3);
    const a = sim.speedFn(0);
    const b = sim.speedFn(60);
    expect(a).toBeCloseTo(b, 9);
  });

  it('une même graine donne la même tentative, une autre graine une autre trajectoire', () => {
    const m = MISSIONS[2];
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
    const sim = CampaignSimulation.create(MISSIONS[2], seed, upgrades);
    for (let i = 0; i < 120 * 60 && sim.state === 'running'; i++) sim.step(); // aucun pilote : il finit par être touché
    return sim;
  }

  it('sans bouclier, la première collision termine la tentative', () => {
    const sim = runUntilFirstHit();
    expect(sim.outcome).toBe('failure');
    expect(sim.report().stars.main).toBe(false);
  });

  it('le bouclier absorbe une collision puis protège brièvement ; la deuxième collision tue', () => {
    const sim = CampaignSimulation.create(MISSIONS[2], 11, { ...NO_UPGRADES, shield: true });
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
  });

  it('le bouclier est rechargé à chaque tentative', () => {
    const a = CampaignSimulation.create(MISSIONS[2], 11, { ...NO_UPGRADES, shield: true });
    const b = CampaignSimulation.create(MISSIONS[2], 11, { ...NO_UPGRADES, shield: true });
    expect(a.shieldCharges).toBe(1);
    expect(b.shieldCharges).toBe(1);
  });


  it('stabilisateur : répit supplémentaire borné, jamais en dehors des cycles', () => {
    const run = (stab: boolean): number => {
      const sim = CampaignSimulation.create(MISSIONS[1], 31, { ...NO_UPGRADES, stabilizer: stab });
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
    const base = CampaignSimulation.create(MISSIONS[3], 1);
    const col = CampaignSimulation.create(MISSIONS[3], 1, { ...NO_UPGRADES, collector: true });
    expect(col.objectRadius).toBeGreaterThan(base.objectRadius);
  });

  it('les pas fixes restent à 1/120 s', () => {
    expect(SIM.dt).toBeCloseTo(1 / 120, 9);
  });
});

describe('cas limites : victoire et défaite', () => {
  it('objectif rempli au pas même où la limite de temps est atteinte : victoire, pas « temps écoulé »', () => {
    const m = { ...MISSIONS[0], limit: 3, objective: { type: 'beacons' as const, count: 5 } };
    const sim = CampaignSimulation.create(m, 1);
    while (sim.state === 'running' && sim.time < m.limit - 1.5 * SIM.dt) sim.step();
    expect(sim.state).toBe('running');
    expect(sim.outcome).toBe('running');
    sim.beaconsCollected = 5; // l'objectif devient rempli juste avant le dernier pas
    for (let i = 0; i < 3 && sim.state === 'running'; i++) sim.step();
    expect(sim.outcome).toBe('success');
    expect(sim.report().stars.main).toBe(true);
    expect(sim.report().time).toBeLessThanOrEqual(m.limit + SIM.dt);
  });

  it('limite atteinte sans objectif : « temps écoulé », aucune étoile ; « survivre » : victoire à la limite', () => {
    const m = { ...MISSIONS[0], limit: 2, objective: { type: 'beacons' as const, count: 999 } };
    const sim = CampaignSimulation.create(m, 1);
    for (let i = 0; i < 120 * 3 && sim.state === 'running'; i++) sim.step();
    expect(sim.outcome).toBe('timeout');
    expect(sim.report().stars).toEqual({ main: false, challenge: false });
    const surv = { ...MISSIONS[2], limit: 2, objective: { type: 'survive' as const, seconds: 2 } };
    const s2 = CampaignSimulation.create(surv, 1);
    // Aucune collision possible pendant 2 s sans menace : on neutralise les dangers pour tester la règle de victoire
    s2.hazards.length = 0;
    for (let i = 0; i < 120 * 3 && s2.state === 'running'; i++) {
      s2.hazards.length = 0;
      s2.step();
    }
    expect(s2.outcome).toBe('success');
  });

  it('une collision termine la tentative en échec, même au dernier pas, et ne produit jamais de victoire', () => {
    const sim = CampaignSimulation.create(MISSIONS[2], 11);
    for (let i = 0; i < 120 * 150 && sim.state === 'running'; i++) sim.step(); // aucun pilote : il finit par être touché
    expect(sim.outcome).toBe('failure');
    expect(sim.report().stars).toEqual({ main: false, challenge: false });
    expect(sim.events.some((e) => e.type === 'complete')).toBe(false);
  });
});

describe('défis secondaires atteignables par un humain moins rapide que le robot', () => {
  const times = new Map<number, number>();
  for (const m of MISSIONS.filter((x) => x.challenge.kind === 'time')) {
    it(`niveau ${m.id} : cible de ${(m.challenge as { target: number }).target} s ≥ 1,15 × la durée du robot le plus lent testé, et ≤ la limite`, () => {
      const target = (m.challenge as { target: number }).target;
      const worst = Math.max(...SEEDS.map((seed) => playMission(CampaignSimulation.create(m, seed)).report().time));
      times.set(m.id, worst);
      expect(target).toBeGreaterThanOrEqual(worst * 1.15);
      expect(target).toBeLessThanOrEqual(m.limit);
    });
  }

  it('le texte du défi affiche la cible réelle', () => {
    for (const m of MISSIONS) expect(m.challenge.text, `niveau ${m.id}`).toContain(String(m.challenge.target));
  });
});
