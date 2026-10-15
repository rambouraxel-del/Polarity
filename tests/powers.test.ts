import { describe, expect, it } from 'vitest';
import { PLAYER, SIM } from '../src/config/balance';
import { REVIVE, POWERS } from '../src/config/powers';
import { survivalProfile } from '../src/modes/profiles';
import { createSimulation } from '../src/modes/run';
import { makeChordProjectile, makeSector, projectileX, shiftHazard } from '../src/sim/hazards';
import { BOOST_COOLDOWN_STEPS, BOOST_STEPS, GEL_COOLDOWN_STEPS, GEL_SHIFT, GEL_STEPS, SHIELD_STEPS } from '../src/sim/powers';
import { Simulation } from '../src/sim/simulation';
import { emptyProfile } from './helpers';

const OMEGA = PLAYER.angularSpeed; // facteur de vitesse 1 avec le profil sans vague

/** Simulation sans vague (vitesse constante) avec pouvoirs : isole le déplacement et les effets. */
function sim(stock = { boost: 5, gel: 5 }, invincible = true): Simulation {
  return new Simulation({ seed: 1, profile: emptyProfile, timeLimit: null, invincible, powers: { stock } });
}

const stepN = (s: Simulation, n: number): void => {
  for (let i = 0; i < n; i++) s.step();
};

/** Avance de n pas et renvoie l'angle parcouru (rad, positif : sens constant). */
const travel = (s: Simulation, n: number): number => {
  const a0 = s.angle;
  stepN(s, n);
  return s.angle - a0;
};

/** Danger secteur couvrant l'angle du vaisseau, actif tout de suite : tue (ou est absorbé). */
let uid = 9000;
function killZone(s: Simulation, active = 5): void {
  const h = makeSector('test', s.time, 0, active, s.angle + 0.02, 0.6);
  h.id = ++uid;
  s.hazards.push(h);
}

describe('Boost : +50 % de vitesse pendant 5 s, recharge 10 s', () => {
  it('multiplie la vitesse réelle de 1,5 pendant exactement 5 s, puis la restaure', () => {
    const s = sim();
    stepN(s, 10);
    const normal = travel(s, 60);
    expect(normal).toBeCloseTo(OMEGA * 60 * SIM.dt, 9);
    s.power('boost');
    const boosted = travel(s, 60);
    expect(boosted / normal).toBeCloseTo(1.5, 9);
    stepN(s, BOOST_STEPS - 60 - 1);
    expect(s.powers.boostActive(s.stepIndex)).toBe(true);
    stepN(s, 2);
    expect(s.powers.boostActive(s.stepIndex)).toBe(false);
    expect(travel(s, 60) / normal).toBeCloseTo(1, 9);
    expect(BOOST_STEPS).toBe(5 * 120);
  });

  it('suit la vitesse réelle courante : sur la courbe de Survie, le facteur 1,5 s’applique à la vitesse du moment', () => {
    const run = (boost: boolean): number => {
      const s = new Simulation({ seed: 2, profile: { ...emptyProfile, speed: (t) => 0.4 + t * 0.05 }, timeLimit: null, invincible: true, powers: { stock: { boost: 1, gel: 0 } } });
      stepN(s, 120 * 20);
      if (boost) s.power('boost');
      return travel(s, 60);
    };
    expect(run(true) / run(false)).toBeCloseTo(1.5, 6);
  });

  it('recharge de 10 s dès l’activation : une seconde activation avant échoue sans consommer de charge', () => {
    const s = sim();
    s.power('boost');
    stepN(s, 1);
    expect(s.powers.used.boost).toBe(1);
    expect(s.powers.stock.boost).toBe(4);
    stepN(s, BOOST_COOLDOWN_STEPS - 2);
    expect(s.powers.deny('boost', s.stepIndex)).toBe('cooldown');
    s.power('boost');
    stepN(s, 1);
    expect(s.powers.used.boost).toBe(1);
    expect(s.powers.rejected).toBe(1);
    expect(s.powers.log).toHaveLength(1);
    stepN(s, 1);
    expect(s.powers.deny('boost', s.stepIndex)).toBeNull();
    s.power('boost');
    stepN(s, 1);
    expect(s.powers.used.boost).toBe(2);
  });

  it('première vie : 3 activations au plus ; pas de charge = pas d’activation ; chaque succès consomme exactement une charge', () => {
    const s = sim({ boost: 10, gel: 0 });
    for (let i = 0; i < 3; i++) {
      s.power('boost');
      stepN(s, 1);
      stepN(s, BOOST_COOLDOWN_STEPS);
    }
    expect(s.powers.used.boost).toBe(3);
    expect(s.powers.stock.boost).toBe(7);
    expect(s.powers.deny('boost', s.stepIndex)).toBe('cap');
    s.power('boost');
    stepN(s, 1);
    expect(s.powers.used.boost).toBe(3);
    // Stock vide
    const e = sim({ boost: 1, gel: 0 });
    e.power('boost');
    stepN(e, 1 + BOOST_COOLDOWN_STEPS);
    expect(e.powers.deny('boost', e.stepIndex)).toBe('stock');
    expect(e.powers.state('boost', e.stepIndex)).toBe('empty');
    // Les charges inutilisées restent : le stock du simulateur n'est jamais « vidé »
    const idle = sim({ boost: 3, gel: 2 });
    stepN(idle, 1000);
    expect(idle.powers.stock).toEqual({ boost: 3, gel: 2 });
  });
});

describe('Gel temporel : dangers à 40 % pendant 6 s, recharge 20 s', () => {
  const hazardAt = (s: Simulation): ReturnType<typeof makeChordProjectile> => {
    const h = makeChordProjectile('test', 0.5, 0.5, 300, 0, Math.PI);
    h.id = ++uid;
    s.hazards.push(h);
    return h;
  };

  it('la progression d’un projectile tombe à 40 % pendant le Gel, puis revient à 100 %', () => {
    const progress = (gel: boolean): { normal: number; frozen: number; after: number } => {
      const s = sim();
      const h = hazardAt(s);
      stepN(s, 240); // le projectile est parti
      if (gel) s.power('gel');
      const x0 = projectileX(h, s.time);
      stepN(s, 120);
      const frozen = projectileX(h, s.time) - x0;
      stepN(s, GEL_STEPS - 120 - 2);
      const x1 = projectileX(h, s.time);
      stepN(s, 4); // le Gel s'est éteint
      const x2 = projectileX(h, s.time);
      stepN(s, 120);
      return { normal: 0, frozen, after: projectileX(h, s.time) - x2 + 0 * (x1 - x0) };
    };
    const base = progress(false);
    const gelled = progress(true);
    expect(gelled.frozen / base.frozen).toBeCloseTo(0.4, 6);
    expect(gelled.after / base.after).toBeCloseTo(1, 6);
    expect(GEL_STEPS).toBe(6 * 120);
  });

  it('retarde la frise de chaque danger de (1 − 0,4)·dt par pas gelé, sans toucher à l’horloge de la partie', () => {
    const s = sim();
    const h = hazardAt(s);
    const launch0 = h.launch;
    s.power('gel');
    stepN(s, 100);
    expect(h.launch - launch0).toBeCloseTo(100 * GEL_SHIFT, 12);
    expect(s.time).toBeCloseTo(100 * SIM.dt, 12);
    expect(GEL_SHIFT).toBeCloseTo(0.6 * SIM.dt, 15);
    // Tous les instants sont décalés ensemble
    const sec = makeSector('x', 1, 1, 2, 0, 0.3);
    const before = { ...sec };
    shiftHazard(sec, 0.25);
    expect(sec.warnStart - before.warnStart).toBeCloseTo(0.25, 12);
    expect(sec.activeStart - before.activeStart).toBeCloseTo(0.25, 12);
    expect(sec.end - before.end).toBeCloseTo(0.25, 12);
  });

  it('un danger qui touche le vaisseau gelé est détecté sur la trajectoire réelle (pas de saut ni de faux contact)', () => {
    // Même partie, avec et sans Gel, danger arrivant sur la position du vaisseau : le Gel retarde le contact
    const hitTime = (gel: boolean): number | null => {
      const s = new Simulation({ seed: 3, profile: emptyProfile, timeLimit: null, powers: { stock: { boost: 0, gel: 3 } } });
      const h = makeSector('x', 0, 0, 4, 0, 0.1);
      h.id = ++uid;
      h.center = s.angle + 1.6; // le vaisseau l'atteindra bientôt
      h.activeStart = 0.5;
      h.end = 4.5;
      h.threatEnd = 4.5;
      s.hazards.push(h);
      if (gel) s.power('gel');
      for (let i = 0; i < 120 * 5 && s.state === 'running'; i++) s.step();
      return s.state === 'dead' ? s.time : null;
    };
    const plain = hitTime(false);
    expect(plain).not.toBeNull();
    const frozen = hitTime(true);
    // Avec le Gel le secteur n'est actif que plus tard (ou jamais atteint pendant la durée) : jamais plus tôt
    expect(frozen === null || frozen >= plain!).toBe(true);
  });

  it('recharge de 20 s dès l’activation ; 3 activations au plus ; une charge consommée par succès', () => {
    const s = sim({ boost: 0, gel: 9 });
    s.power('gel');
    stepN(s, 1);
    expect(s.powers.used.gel).toBe(1);
    expect(s.powers.stock.gel).toBe(8);
    stepN(s, GEL_COOLDOWN_STEPS - 2);
    expect(s.powers.deny('gel', s.stepIndex)).toBe('cooldown');
    stepN(s, 2);
    expect(s.powers.deny('gel', s.stepIndex)).toBeNull();
    for (let i = 0; i < 2; i++) {
      s.power('gel');
      stepN(s, GEL_COOLDOWN_STEPS + 1);
    }
    expect(s.powers.used.gel).toBe(3);
    expect(s.powers.deny('gel', s.stepIndex)).toBe('cap');
    expect(GEL_COOLDOWN_STEPS).toBe(20 * 120);
  });
});

describe('Exclusivité Boost / Gel', () => {
  it('Boost actif : le Gel est refusé sans consommer de charge ; après l’effet il redevient disponible', () => {
    const s = sim();
    s.power('boost');
    stepN(s, 10);
    expect(s.powers.state('gel', s.stepIndex)).toBe('blocked');
    s.power('gel');
    stepN(s, 1);
    expect(s.powers.used.gel).toBe(0);
    expect(s.powers.stock.gel).toBe(5);
    expect(s.powers.gelActive(s.stepIndex)).toBe(false);
    stepN(s, BOOST_STEPS);
    expect(s.powers.state('gel', s.stepIndex)).toBe('ready');
    s.power('gel');
    stepN(s, 1);
    expect(s.powers.used.gel).toBe(1);
  });

  it('Gel actif : le Boost est refusé sans consommer ; les recharges propres continuent ; jamais d’empilement', () => {
    const s = sim();
    s.power('gel');
    stepN(s, 5);
    s.power('boost');
    stepN(s, 1);
    expect(s.powers.used.boost).toBe(0);
    s.power('gel'); // pas d'empilement
    stepN(s, 1);
    expect(s.powers.used.gel).toBe(1);
    stepN(s, GEL_STEPS);
    expect(s.powers.state('boost', s.stepIndex)).toBe('ready');
    // Gel en recharge (20 s) mais Boost libre : indépendants
    expect(s.powers.state('gel', s.stepIndex)).toBe('cooldown');
    s.power('boost');
    stepN(s, 1);
    expect(s.powers.used.boost).toBe(1);
    // Deux demandes dans le même pas : la première gagne, l'autre est refusée sans consommation
    const t = sim();
    t.power('gel');
    t.power('boost');
    stepN(t, 1);
    expect(t.powers.used).toEqual({ boost: 0, gel: 1, shield: 0 });
    expect(t.powers.log).toEqual([{ step: 0, kind: 'gel' }]);
  });

  it('les temps de jeu actif : aucune progression sans pas (pause), recharge exprimée en pas', () => {
    const s = sim();
    s.power('boost');
    stepN(s, 1);
    const left = s.powers.remaining('boost', s.stepIndex, 'cooldown');
    // Aucun pas simulé (pause) : rien ne change, quel que soit le temps réel écoulé
    expect(s.powers.remaining('boost', s.stepIndex, 'cooldown')).toBe(left);
    expect(left).toBeCloseTo(10 - SIM.dt, 9);
  });
});

describe('Bouclier : 18 balises, manuel, un impact ou 8 s', () => {
  /** Ramasse n balises : vaisseau invincible tournant seul (6 balises par tour). */
  function charged(beacons: number): Simulation {
    const s = sim({ boost: 0, gel: 0 });
    let guard = 0;
    while (s.scoring.beacons < beacons && guard++ < 120 * 120) s.step();
    return s;
  }

  it('se charge à 18 balises, jauge pleine et figée : les balises suivantes ne sont pas conservées', () => {
    const s = charged(17);
    expect(s.powers.shieldProgress).toBe(17);
    expect(s.powers.shieldStored).toBe(false);
    expect(s.powers.state('shield', s.stepIndex)).toBe('charging');
    s.events.length = 0;
    while (s.scoring.beacons < 18) s.step();
    expect(s.powers.shieldStored).toBe(true);
    expect(s.powers.shieldProgress).toBe(POWERS.shield.beacons);
    expect(s.events.some((e) => e.type === 'shield-ready')).toBe(true);
    // 12 balises de plus : la jauge reste pleine, aucune réserve cachée
    while (s.scoring.beacons < 30) s.step();
    expect(s.powers.shieldProgress).toBe(18);
    s.power('shield');
    stepN(s, 1);
    expect(s.powers.shieldStored).toBe(false);
    expect(s.powers.shieldProgress).toBeLessThanOrEqual(1); // repart de zéro (au plus la balise de ce pas)
    expect(s.powers.shieldActive(s.stepIndex)).toBe(true);
    s.powers.shieldProgress = 0;
  });

  it('activation impossible sans charge ; une seule activation à la fois ; aucune limite de 3 ; gratuit', () => {
    const s = sim({ boost: 0, gel: 0 });
    s.power('shield');
    stepN(s, 1);
    expect(s.powers.log).toHaveLength(0);
    expect(s.powers.rejected).toBe(1);
    const t = charged(18);
    t.power('shield');
    stepN(t, 1);
    t.power('shield');
    stepN(t, 1);
    expect(t.powers.log.filter((a) => a.kind === 'shield')).toHaveLength(1);
    // Disparaît après 8 s
    stepN(t, SHIELD_STEPS);
    expect(t.powers.shieldActive(t.stepIndex)).toBe(false);
    expect(SHIELD_STEPS).toBe(8 * 120);
    // Rechargeable : encore 18 balises, nouvelle activation, aucun plafond de 3
    let n = 1;
    for (let k = 0; k < 4; k++) {
      const target = t.scoring.beacons + 18;
      while (t.scoring.beacons < target) t.step();
      expect(t.powers.shieldStored).toBe(true);
      t.power('shield');
      stepN(t, 1 + SHIELD_STEPS);
      n++;
    }
    expect(t.powers.used.shield).toBe(n);
    expect(n).toBeGreaterThan(3);
    expect(t.powers.used.boost + t.powers.used.gel).toBe(0); // gratuit : aucune charge achetée
  });

  it('absorbe UN impact calculé par la simulation : le vaisseau survit, le Bouclier disparaît, le danger touché est neutralisé', () => {
    const s = new Simulation({ seed: 1, profile: emptyProfile, timeLimit: null, powers: { stock: { boost: 0, gel: 0 } } });
    s.powers.shieldStored = true;
    s.power('shield');
    stepN(s, 1);
    expect(s.powers.shieldActive(s.stepIndex)).toBe(true);
    killZone(s, 4);
    stepN(s, 30);
    expect(s.state).toBe('running');
    expect(s.powers.shieldActive(s.stepIndex)).toBe(false);
    expect(s.events.filter((e) => e.type === 'shield-absorb')).toHaveLength(1);
    // Le danger absorbé reste neutralisé (aucun second contact), mais un nouveau danger tue
    stepN(s, 120 * 3);
    expect(s.state).toBe('running');
    killZone(s, 2);
    stepN(s, 30);
    expect(s.state).toBe('dead');
  });

  it('sans Bouclier actif, le même danger tue ; Bouclier expiré = aucune protection', () => {
    const s = new Simulation({ seed: 1, profile: emptyProfile, timeLimit: null, powers: { stock: { boost: 0, gel: 0 } } });
    killZone(s, 4);
    stepN(s, 30);
    expect(s.state).toBe('dead');
    const t = new Simulation({ seed: 1, profile: emptyProfile, timeLimit: null, powers: { stock: { boost: 0, gel: 0 } } });
    t.powers.shieldStored = true;
    t.power('shield');
    stepN(t, 1 + SHIELD_STEPS + 2);
    killZone(t, 4);
    stepN(t, 30);
    expect(t.state).toBe('dead');
  });

  it('compatible avec Boost et Gel actifs en même temps que le Bouclier', () => {
    const s = new Simulation({ seed: 1, profile: emptyProfile, timeLimit: null, powers: { stock: { boost: 2, gel: 2 } } });
    s.powers.shieldStored = true;
    s.power('shield');
    s.power('boost');
    stepN(s, 1);
    expect(s.powers.shieldActive(s.stepIndex)).toBe(true);
    expect(s.powers.boostActive(s.stepIndex)).toBe(true);
    const g = new Simulation({ seed: 1, profile: emptyProfile, timeLimit: null, powers: { stock: { boost: 2, gel: 2 } } });
    g.powers.shieldStored = true;
    g.power('gel');
    g.power('shield');
    stepN(g, 1);
    expect(g.powers.gelActive(g.stepIndex) && g.powers.shieldActive(g.stepIndex)).toBe(true);
  });
});

describe('Reprises : vie 2 et vie 3, sécurisées, jamais classées', () => {
  function dead(): Simulation {
    const s = new Simulation({ seed: 5, profile: emptyProfile, timeLimit: null, powers: { stock: { boost: 3, gel: 3 } } });
    stepN(s, 360);
    s.power('boost');
    stepN(s, 10);
    s.flip();
    stepN(s, 20);
    killZone(s, 3);
    stepN(s, 40);
    expect(s.state).toBe('dead');
    return s;
  }

  it('première mort : tentative figée (temps, score, journaux, pouvoirs) et inchangée par les reprises', () => {
    const s = dead();
    const fl = s.firstLife!;
    expect(fl.steps).toBe(s.stepIndex);
    expect(fl.time).toBeCloseTo(s.stepIndex * SIM.dt, 12);
    expect(fl.used).toEqual({ boost: 1, gel: 0, shield: 0 });
    expect(fl.acts).toEqual([{ step: 360, kind: 'boost' }]);
    const snapshot = JSON.stringify(fl);
    expect(s.revive()).toBe(true);
    s.flip();
    stepN(s, 600);
    expect(JSON.stringify(s.firstLife)).toBe(snapshot);
    expect(s.flipLog.length).toBeGreaterThan(fl.flips.length);
  });

  it('reprise sécurisée : dangers écartés, 3 s d’invulnérabilité (sans Bouclier), puis vulnérable ; aucune quatrième vie', () => {
    const s = dead();
    expect(s.canRevive).toBe(true);
    expect(s.revive()).toBe(true);
    expect(s.life).toBe(2);
    expect(s.state).toBe('running');
    expect(s.hazards).toHaveLength(0);
    expect(s.reviveProtected).toBe(true);
    expect(s.reviveProtection).toBeCloseTo(REVIVE.invulnerability, 9);
    expect(s.powers.shieldStored).toBe(false); // aucune charge de Bouclier consommée ni créée
    // Un danger posé sur le vaisseau ne le tue pas pendant les 3 s
    killZone(s, 2.5);
    stepN(s, 120 * 2);
    expect(s.state).toBe('running');
    stepN(s, 120 * 2); // l'invulnérabilité de 3 s est terminée
    expect(s.reviveProtected).toBe(false);
    killZone(s, 2);
    stepN(s, 30);
    expect(s.state).toBe('dead');
    // Troisième vie, puis fin définitive
    expect(s.revive()).toBe(true);
    expect(s.life).toBe(3);
    stepN(s, 120 * 3 + 5);
    killZone(s, 2);
    stepN(s, 30);
    expect(s.state).toBe('dead');
    expect(s.canRevive).toBe(false);
    expect(s.revive()).toBe(false);
    expect(s.life).toBe(3);
  });

  it('après une reprise, Boost et Gel sont gratuits et illimités (recharges conservées), aucun éclat n’apparaît', () => {
    const s = new Simulation({ seed: 5, profile: survivalProfile(true), timeLimit: null, powers: { stock: { boost: 0, gel: 0 } } });
    // Sans charge achetée : refusé en première vie
    s.power('boost');
    stepN(s, 2);
    expect(s.powers.log).toHaveLength(0);
    s.hazards.length = 0;
    killZone(s, 3);
    stepN(s, 60);
    expect(s.state).toBe('dead');
    s.revive();
    s.invincible = true; // la partie continue sans danger : on teste seulement les pouvoirs et les éclats
    for (let i = 0; i < 5; i++) {
      s.power('boost');
      stepN(s, 1);
      stepN(s, BOOST_COOLDOWN_STEPS);
    }
    expect(s.powers.log.filter((a) => a.kind === 'boost')).toHaveLength(5);
    expect(s.powers.used.boost).toBe(0); // aucune charge consommée
    s.power('gel');
    stepN(s, 1);
    expect(s.powers.log.some((a) => a.kind === 'gel')).toBe(true);
    expect(s.powers.used.gel).toBe(0);
    // Aucun éclat sur l'orbite pendant la continuation
    const income = s.shards!.income;
    stepN(s, 120 * 60);
    expect(s.shards!.income).toBe(income);
  });

  it('pouvoirs et reprises réservés à la Survie : défi quotidien, niveaux et campagne n’en ont aucun', () => {
    const daily = createSimulation({ mode: 'daily', seed: 0, date: '2026-10-12' });
    expect(daily.powers.enabled).toBe(false);
    daily.power('boost');
    stepN(daily, 5);
    expect(daily.powers.log).toHaveLength(0);
    const surv = createSimulation({ mode: 'survival', seed: 4, stock: { boost: 1, gel: 1 } });
    expect(surv.powers.enabled).toBe(true);
    expect(daily.canRevive).toBe(false);
  });
});

describe('déterminisme : sans activation, la simulation est strictement celle d’avant', () => {
  const play = (powers: boolean): string => {
    const s = createSimulation({ mode: 'survival', seed: 12345, stock: powers ? { boost: 3, gel: 3 } : undefined });
    let k = 0;
    while (s.state === 'running' && k < 120 * 400) {
      if (k % 37 === 5) s.flip();
      s.step();
      k++;
    }
    return JSON.stringify([s.stepIndex, s.scoring.score, s.angle, s.flipLog.length, s.hazards.length]);
  };

  it('mêmes pas, score, angle avec ou sans pouvoirs disponibles (aucune activation) : anciens records et rejeux inchangés', () => {
    expect(play(true)).toBe(play(false));
  });
});
