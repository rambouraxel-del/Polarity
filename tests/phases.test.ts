import { describe, expect, it } from 'vitest';
import * as phasesConfig from '../src/config/phases';
import { PHASE2_MUSIC, PHASE_BONUS, PHASES, nextAccent, nextBeat } from '../src/config/phases';
import { SURVIVAL } from '../src/config/survival';
import { ARENA, SIM } from '../src/config/balance';
import { catalogItem } from '../src/config/catalog';
import * as localEconomy from '../src/economy/local';
import { claimPhaseBonus } from '../src/economy/local';
import { GameSession } from '../src/game/session';
import { createSimulation } from '../src/modes/run';
import { phase2Intensity, phasedDifficulty, phasedIntervalScale, phasedWeights, survivalProfile } from '../src/modes/profiles';
import { defaultSave } from '../src/save/save';
import { Bot } from '../src/sim/bot';
import { Rng } from '../src/core/rng';
import { paramsFor } from '../src/sim/difficulty';
import { PATTERNS, type PatternId } from '../src/sim/patterns';
import { makeArcProjectile, makeSpiralProjectile, projectileX, projectileY, type ProjectileHazard } from '../src/sim/hazards';
import { projectileHits } from '../src/sim/collision';
import { playerHitRadius } from '../src/config/hitbox';
import { survivalSpeedFactor } from '../src/config/playerSpeed';
import { replaySurvival } from '../server/verify';

const NEW_IDS: PatternId[] = ['arcShot', 'arcConvoy', 'spiral', 'rotBeam', 'sweepBeam', 'altBeams', 'arcSector', 'spiralArc', 'beamShot'];

describe('grilles de rythme (config/phases.ts) : le gameplay ne lit jamais l’audio', () => {
  it('phase 2 : grille régulière de période beatPeriod, sur la traversée (6 s consommées dans le morceau)', () => {
    const P = PHASE2_MUSIC.beatPeriod;
    let t = nextBeat(PHASES.phase2At);
    expect(t).toBeGreaterThanOrEqual(PHASES.phase2At);
    for (let i = 0; i < 50; i++) {
      const n = nextBeat(t + 1e-6);
      expect(n - t).toBeCloseTo(P, 6);
      t = n;
    }
    // Position de fichier correspondante = firstBeat + k·P
    const k = (nextBeat(400) - PHASES.phase2At + PHASES.transit - PHASE2_MUSIC.firstBeat) / P;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
  });

  it('phase 1 : battements réels de la musique, monotones, jamais après 300 s ; moments forts triés', () => {
    let t = 0;
    for (let i = 0; i < 1500; i++) {
      const n = nextBeat(t);
      expect(n).toBeGreaterThanOrEqual(t);
      if (n >= PHASES.phase2At) break;
      t = n + 1e-6;
    }
    expect(t).toBeGreaterThan(250);
    const a = nextAccent(0);
    expect(a).toBeGreaterThan(0);
    expect(nextAccent(a + 1e-6)).toBeGreaterThan(a);
    expect(nextAccent(299.9)).toBeGreaterThan(300); // le premier moment fort de la phase 2 vient après la traversée
  });
});

describe('simulation : traversée à 300 s de survie active et phase 2', () => {
  it('le Survie a des phases ; le défi quotidien garde ses règles (aucune phase 2)', () => {
    expect(createSimulation({ mode: 'survival', seed: 1 }).director.phased).toBe(true);
    expect(createSimulation({ mode: 'daily', seed: 0, date: '2026-10-16' }).director.phased).toBe(false);
    expect(createSimulation({ mode: 'daily', seed: 0, date: '2026-10-16' }).phase).toBe(1);
  });

  it('au pas 36000 (300 s) l’arène est aspirée : menaces effacées, phase 2, événement, rien d’autre ne change', () => {
    const sim = createSimulation({ mode: 'survival', seed: 5, stock: { boost: 3, gel: 3 } });
    sim.invincible = true;
    const bot = new Bot(sim, true, 6);
    while (sim.stepIndex < PHASES.phase2Step - 1) {
      bot.tick();
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.phase).toBe(1);
    expect(sim.hazards.length).toBeGreaterThanOrEqual(0);
    const score = sim.scoring.score;
    sim.step(); // pas 35999 → 36000
    sim.events.length = 0;
    const flips = sim.flips;
    sim.step(); // premier pas de la phase 2
    expect(sim.phase).toBe(2);
    expect(sim.events.some((e) => e.type === 'phase')).toBe(true);
    expect(sim.scoring.score).toBeGreaterThanOrEqual(score);
    expect(sim.flips).toBeGreaterThanOrEqual(flips);
    expect(sim.hazards.every((h) => h.warnStart >= sim.time - SIM.dt)).toBe(true);
    // Aucune vague avant firstWaveDelay : le retour est sûr
    for (let i = 0; i < Math.round((PHASES.firstWaveDelay - 0.2) / SIM.dt); i++) {
      sim.step();
      expect(sim.hazards).toHaveLength(0);
    }
  });

  it('la traversée n’est pas du temps de jeu : la session gèle la simulation pendant 6 s (commandes refusées), hooks start/end, une seule fois', () => {
    const stages: string[] = [];
    const s = new GameSession({ mode: 'survival', seed: 9, stock: { boost: 1, gel: 1 }, bonus: true }, { onTransit: (stage) => stages.push(stage) });
    s.sim.invincible = true;
    const bot = new Bot(s.sim, true, 6);
    // Avance rapide jusqu'au pas 36000
    while (s.sim.stepIndex < PHASES.phase2Step) {
      bot.tick();
      s.sim.step();
      s.sim.events.length = 0;
    }
    expect(s.sim.phase).toBe(1); // la phase 2 commence au pas SUIVANT la traversée
    const frozenAt = s.sim.stepIndex;
    s.frame(0.02);
    expect(stages).toEqual(['start']);
    expect(s.transitLeft).toBeGreaterThan(5.9);
    const score = s.sim.scoring.score;
    const flips = s.sim.flips;
    // Commandes de déplacement et pouvoirs refusés pendant la traversée
    expect(s.action()).toBe(false);
    expect(s.power('boost')).toBe(false);
    let elapsed = 0;
    while (s.transitLeft > 0) {
      s.frame(0.1);
      elapsed += 0.1;
      expect(s.sim.stepIndex).toBe(frozenAt); // chronomètre, dangers, collisions, score figés
      expect(s.sim.scoring.score).toBe(score);
      expect(s.sim.flips).toBe(flips);
    }
    expect(elapsed).toBeGreaterThanOrEqual(PHASES.transit - 0.11);
    expect(stages).toEqual(['start', 'end']);
    expect(s.action()).toBe(true);
    s.frame(0.1);
    expect(s.sim.stepIndex).toBeGreaterThan(frozenAt);
    expect(s.sim.phase).toBe(2);
    expect(stages).toEqual(['start', 'end']); // une seule traversée
    // Le temps de survie compté ne contient pas les 6 s
    expect(s.sim.time).toBeLessThan(PHASES.phase2At + 0.5);
  });

  it('pause pendant la traversée : le décompte s’arrête et reprend (compte à rebours de reprise), rien n’avance', () => {
    const s = new GameSession({ mode: 'survival', seed: 9 }, {});
    s.sim.invincible = true;
    const bot = new Bot(s.sim, true, 6);
    while (s.sim.stepIndex < PHASES.phase2Step) {
      bot.tick();
      s.sim.step();
      s.sim.events.length = 0;
    }
    s.frame(0.02);
    s.frame(0.5);
    const left = s.transitLeft;
    s.pause();
    expect(s.phase).toBe('paused');
    s.frame(5);
    expect(s.transitLeft).toBe(left);
    s.resume();
    s.frame(1); // compte à rebours de reprise
    while (s.phase !== 'running') s.frame(0.5);
    expect(s.transitLeft).toBeLessThanOrEqual(left);
    expect(s.transitLeft).toBeGreaterThan(0);
  });

  it('rejeu du service : une partie qui franchit la faille puis meurt en phase 2 est rejouée à l’identique (durée sans les 6 s, score, catégorie déclarée)', () => {
    const seed = 123;
    const sim = createSimulation({ mode: 'survival', seed, stock: { boost: 0, gel: 0 }, bonus: false });
    const bot = new Bot(sim, true, 6);
    // Le bot joue jusqu'à 40 s après la faille, puis le vaisseau est laissé sans commande jusqu'à la mort (phase 2)
    while (sim.state === 'running' && sim.time < PHASES.phase2At + 40) {
      bot.tick();
      sim.step();
      sim.events.length = 0;
    }
    while (sim.state === 'running' && sim.time < PHASES.phase2At + 200) {
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.state).toBe('dead');
    expect(sim.phase).toBe(2);
    const full = replaySurvival(seed, [...sim.flipLog], [], 120 * 3600, 'plain');
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.steps).toBe(sim.stepIndex);
    expect(full.time).toBeCloseTo(sim.time, 9);
    expect(full.score).toBe(sim.scoring.score);
    expect(full.category).toBe('plain');
    // La durée classée est celle de la simulation : les 6 s de traversée ne s'y ajoutent jamais
    expect(full.steps).toBeGreaterThanOrEqual(PHASES.phase2Step);
    expect(full.time).toBeLessThan(PHASES.phase2At + 200 + 1);
  });
});

describe('difficulté et nouvelles menaces de la phase 2', () => {
  it('phase 1 : paliers lissés avec vague de tension, jamais au-dessus de dMax ; accueil accessible', () => {
    expect(phasedDifficulty(0)).toBeLessThan(0.2);
    let prev = phasedDifficulty(0);
    for (let t = 0; t < PHASES.phase2At; t += 0.5) {
      const d = phasedDifficulty(t);
      expect(d).toBeLessThanOrEqual(SURVIVAL.dMax);
      expect(Math.abs(d - prev)).toBeLessThan(0.05); // aucune marche brutale
      prev = d;
    }
    // Les paliers montent : moyenne par tranche de 60 s croissante
    const avg = (a: number, b: number): number => {
      let s = 0;
      let n = 0;
      for (let t = a; t < b; t += 0.5) {
        s += phasedDifficulty(t);
        n++;
      }
      return s / n;
    };
    for (let a = 0; a < 240; a += 60) expect(avg(a + 60, a + 120)).toBeGreaterThan(avg(a, a + 60) - 0.02);
  });

  it('phase 2 : reprend le dernier palier sans hausse brutale puis tend vers dMax, plafond jamais dépassé, même après une heure', () => {
    const before = phasedDifficulty(PHASES.phase2At - 0.01);
    const after = phasedDifficulty(PHASES.phase2At + 0.01);
    expect(Math.abs(after - before)).toBeLessThan(0.05);
    for (const t of [300, 400, 600, 900, 3600, 36000]) expect(phasedDifficulty(t)).toBeLessThanOrEqual(SURVIVAL.dMax);
    expect(phasedDifficulty(3600)).toBeGreaterThan(phasedDifficulty(320) - 0.01);
    expect(phase2Intensity(299)).toBe(0);
    expect(phase2Intensity(3600)).toBeGreaterThan(0.99);
    expect(phasedIntervalScale(36000)).toBeGreaterThanOrEqual(SURVIVAL.phase2.tightness - 1e-9);
  });

  it('nouvelles menaces introduites une à une, séparément, puis combinées ; aucune avant 300 s', () => {
    for (let t = 0; t < PHASES.phase2At; t += 5) for (const id of NEW_IDS) expect(phasedWeights(t)[id] ?? 0, `${id}@${t}`).toBe(0);
    const u = SURVIVAL.phase2.unlock;
    const at = (s: number) => phasedWeights(PHASES.phase2At + s);
    expect(at(0).arcShot ?? 0).toBe(0);
    expect(at(u.arcShot.from + u.arcShot.span).arcShot!).toBeGreaterThan(0);
    // Chaque famille n'apparaît qu'après la précédente
    expect(at(u.spiral.from - 1).spiral ?? 0).toBe(0);
    expect(at(u.spiral.from + u.spiral.span).spiral!).toBeGreaterThan(0);
    expect(at(u.rotBeam.from - 1).rotBeam ?? 0).toBe(0);
    expect(at(u.sweepBeam.from - 1).sweepBeam ?? 0).toBe(0);
    expect(at(u.altBeams.from - 1).altBeams ?? 0).toBe(0);
    for (const id of ['arcSector', 'spiralArc', 'beamShot', 'arcConvoy'] as const) {
      expect(at(u.combos.from - 1)[id] ?? 0, id).toBe(0);
      expect(at(u.combos.from + u.combos.span)[id]!, id).toBeGreaterThan(0);
    }
    // Les obstacles de la phase 1 restent présents dans la phase 2
    expect(at(600).shot!).toBeGreaterThan(0);
    expect(at(600).convoy!).toBeGreaterThan(0);
  });

  it('chaque nouveau motif construit des menaces finies, bien formées, dans l’arène, avec un préavis', () => {
    const rng = new Rng(77);
    const p = paramsFor(0.92, undefined, { warnScale: SURVIVAL.warnScale, speed: survivalSpeedFactor(310) });
    for (const id of NEW_IDS) {
      for (let k = 0; k < 40; k++) {
        const hs = PATTERNS[id].build({ now: 310, rng, p, playerAngle: rng.range(-3, 3), playerDir: rng.sign(), speed: survivalSpeedFactor });
        expect(hs.length, id).toBeGreaterThan(0);
        for (const h of hs) {
          for (const v of [h.warnStart, h.threatEnd, h.end]) expect(Number.isFinite(v), `${id} fini`).toBe(true);
          expect(h.end).toBeGreaterThan(h.warnStart);
          if (h.kind === 'projectile') {
            expect(h.launch).toBeGreaterThanOrEqual(h.warnStart + 0.5);
            expect(Math.hypot(projectileX(h, h.launch), projectileY(h, h.launch))).toBeGreaterThan(0);
            expect(Number.isFinite(h.crossTime1) && Number.isFinite(h.crossTime2)).toBe(true);
          } else if (h.kind === 'sector') expect(h.activeStart - h.warnStart).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  });

  it('trajectoires courbes : un grand arc coupe l’orbite deux fois, une spirale traverse l’orbite ; la collision suit la courbe', () => {
    const R = ARENA.orbitRadius;
    const S = ARENA.spawnRadius;
    const arc = makeArcProjectile('t', 0, 1, 380, [S * Math.cos(-1.2), S * Math.sin(-1.2)], [-60, 0], [S * Math.cos(1.3), S * Math.sin(1.3)])!;
    expect(arc.path?.type).toBe('arc');
    expect(arc.crossTime2).toBeGreaterThan(arc.crossTime1);
    expect(Math.abs(Math.hypot(projectileX(arc, arc.crossTime1), projectileY(arc, arc.crossTime1)) - R)).toBeLessThan(3); // échantillonnage 1/240 s
    const spiral = makeSpiralProjectile('t', 0, 1, S, -300, 0.5, 1.2);
    expect(spiral.crossTime1).toBeGreaterThan(spiral.launch);
    expect(Math.abs(Math.hypot(projectileX(spiral, spiral.crossTime1), projectileY(spiral, spiral.crossTime1)) - R)).toBeLessThan(3);
    // Le vaisseau posé à l'endroit exact du passage est touché ; décalé de 60° il ne l'est pas
    const hit = (h: ProjectileHazard, ang: number, t: number): boolean => projectileHits(h, ang, 0, t - 0.008, t + 0.008, playerHitRadius());
    for (const h of [arc, spiral]) {
      const t = h.crossTime1;
      expect(hit(h, h.cross1, t)).toBe(true);
      expect(hit(h, h.cross1 + 1.05, t)).toBe(false);
    }
  });

  it('le bot franchit la faille puis survit dix minutes de phase 2 : les nouvelles menaces apparaissent et restent évitables (validateur)', () => {
    const sim = createSimulation({ mode: 'survival', seed: 4, stock: { boost: 0, gel: 0 }, bonus: false });
    const bot = new Bot(sim, true, 6);
    const seen = new Set<string>();
    sim.director.onWave = (_t, id) => seen.add(id);
    while (sim.state === 'running' && sim.time < PHASES.phase2At + 600) {
      bot.tick();
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.state).toBe('running');
    expect(sim.phase).toBe(2);
    for (const id of ['arcShot', 'spiral', 'rotBeam', 'sweepBeam', 'altBeams']) expect(seen.has(id), id).toBe(true);
  });
});

describe('récompenses de phase : prime d’Éclats (plus d’apparence exclusive)', () => {
  it('prime : montant centralisé, croissant selon la phase, versée une seule fois par partie et par phase (reprises, synchronisations)', () => {
    expect(PHASE_BONUS[2]).toBe(150);
    expect(PHASE_BONUS[3]).toBeGreaterThan(PHASE_BONUS[2]);
    const s = defaultSave();
    expect(claimPhaseBonus(s, 'run-a', 2)).toBe(150);
    expect(s.wallet.shards).toBe(150);
    expect(s.economy.earned).toBe(150); // alimente le compteur monotone envoyé au service
    expect(claimPhaseBonus(s, 'run-a', 2)).toBe(0);
    expect(s.wallet.shards).toBe(150);
    expect(claimPhaseBonus(s, 'run-b', 2)).toBe(150);
    expect(claimPhaseBonus(s, 'run-b', 9)).toBe(0); // phase sans prime
    expect(claimPhaseBonus(s, '', 2)).toBe(0);
  });

  it('plus d’apparence exclusive : l’apparence « Faille » n’existe plus ; franchir une phase ne verse que la prime d’Éclats, jamais un cosmétique', () => {
    expect('PHASE_REWARD_SKIN' in phasesConfig).toBe(false);
    expect('grantPhaseSkin' in localEconomy).toBe(false);
    expect(catalogItem('faille')).toBeUndefined();
    const s = defaultSave();
    s.wallet.medals = 99999;
    expect(claimPhaseBonus(s, 'run-a', 2)).toBe(PHASE_BONUS[2]);
    expect(s.owned).toEqual([]);
    expect(s.wallet.medals).toBe(99999);
  });

  it('le profil de Survie à phases est celui du directeur (hooks de rythme et de phase)', () => {
    const p = survivalProfile(true, true);
    expect(p.phased).toBe(true);
    expect(p.beatChance?.(10)).toBeCloseTo(SURVIVAL.beat.chance[0], 9);
    expect(p.beatChance?.(400)).toBeCloseTo(SURVIVAL.beat.chance[1], 9);
    expect(survivalProfile(true).phased).toBeUndefined();
  });
});
