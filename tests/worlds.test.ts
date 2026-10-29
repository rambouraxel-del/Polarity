import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARENA, SAFETY, SIM } from '../src/config/balance';
import { playerHitRadius } from '../src/config/hitbox';
import { MUSIC } from '../src/config/music';
import { BALANCE_VERSION } from '../src/config/version';
import { WORLD_MUSIC, WORLD_RHYTHM_DATA, WORLD_TRANSITION_AUDIO, WORLD2_START, WORLDS_RHYTHM } from '../src/config/worldMusic';
import { WORLD2_AT } from '../src/config/world2';
import { CLOUDS, CURRENTS, WORLD_COUNT, WORLD_LIST, WORLDS, localTime, nextBoundary, worldIndexAt, worldStart, worldStartStep } from '../src/config/worlds';
import { WorldMusic } from '../src/audio/worldMusic';
import type { AudioHost, MusicPosition } from '../src/audio/music';
import { GameSession } from '../src/game/session';
import { createSimulation } from '../src/modes/run';
import { worldsDifficulty, worldsProfile, worldsSpeed } from '../src/modes/worlds';
import { applyRun } from '../src/progression/progress';
import { defaultSave } from '../src/save/save';
import { Bot } from '../src/sim/bot';
import { sectorHits } from '../src/sim/collision';
import { WorldsField, type SpeedField } from '../src/sim/field';
import { dangerStart, makeSector, type Hazard } from '../src/sim/hazards';
import { hasEscapePath } from '../src/sim/safety';
import { Simulation } from '../src/sim/simulation';
import { omegaAt } from '../src/sim/speed';
import { wrapAngle } from '../src/core/math';
import { emptyProfile } from './helpers';
import { FakeCtx, FakeGain, FakeNode, FakeParam, FakeScheduled, buf, nameOf } from './fakeAudio';

const STEP = (t: number): number => Math.round(t / SIM.dt);
const hazardCount = (sim: Simulation): number => (sim as unknown as { hazardCount: number }).hazardCount;

/** Avance la simulation (vaisseau immortel) jusqu'au pas `step` exclu, sans session (aucune transition). */
function fastForward(sim: Simulation, step: number): void {
  const inv = sim.invincible;
  sim.invincible = true;
  while (sim.stepIndex < step && sim.state === 'running') {
    sim.step();
    sim.events.length = 0;
  }
  sim.invincible = inv;
}

function worldsSession(seed = 7, hooks: ConstructorParameters<typeof GameSession>[1] = {}): GameSession {
  return new GameSession({ mode: 'survival', seed, worlds: true, bonus: true, stock: { boost: 2, gel: 2 } }, hooks);
}

// ————————————————————————————————————————————— 1. Frontières des univers

describe('univers : calendrier (config/worlds.ts)', () => {
  it('quatre univers de 120 s de temps actif, frontières exactes', () => {
    expect(WORLD_COUNT).toBe(4);
    expect(WORLD_LIST.map((w) => w.id)).toHaveLength(4);
    expect(WORLDS.span).toBe(120);
    expect(WORLDS.transition).toBe(4);
    expect([0, 1, 2, 3].map(worldStart)).toEqual([0, 120, 240, 360]);
    expect(worldIndexAt(0)).toBe(0);
    expect(worldIndexAt(119.999)).toBe(0);
    expect(worldIndexAt(120)).toBe(1);
    expect(worldIndexAt(239.999)).toBe(1);
    expect(worldIndexAt(240)).toBe(2);
    expect(worldIndexAt(360)).toBe(3);
    // Au-delà de 8 minutes : le dernier univers continue (aucune phase 5 vide)
    expect(worldIndexAt(480)).toBe(3);
    expect(worldIndexAt(5000)).toBe(3);
    expect(worldStartStep(1)).toBe(STEP(120));
    expect(worldStartStep(3)).toBe(STEP(360));
    expect(localTime(130)).toBeCloseTo(10, 9);
    expect(nextBoundary(10)).toBe(120);
    expect(nextBoundary(400)).toBe(Infinity);
  });

  it('chaque univers a ses propres motifs, sa mécanique et sa transition', () => {
    expect(WORLD_LIST.map((w) => w.field)).toEqual(['none', 'none', 'clouds', 'currents']);
    expect(WORLD_LIST.slice(0, 3).map((w) => w.transition?.variant)).toEqual(['rift', 'mist', 'spiral']);
    const ids = WORLD_LIST.map((w) => Object.keys(w.weights(60)).sort().join());
    expect(new Set(ids).size).toBe(4);
  });

  it('la simulation entre dans l’univers suivant au pas exact de la frontière, arène vidée, événement « world »', () => {
    const sim = createSimulation({ mode: 'survival', seed: 3, worlds: true });
    fastForward(sim, worldStartStep(1));
    expect(sim.world).toBe(1);
    sim.invincible = true;
    sim.step();
    expect(sim.world).toBe(2);
    expect(sim.events).toContainEqual({ type: 'world', world: 2 });
  });
});

// ————————————————————————————————————————————— 2 à 5. Transition de 4 s (session)

describe('univers : transition de 4 s hors du temps de jeu', () => {
  it('simulation gelée pendant 4 s (chronomètre, score, inversions, pouvoirs), hooks start/end, une seule fois par frontière', () => {
    const stages: string[] = [];
    const s = worldsSession(7, { onTransit: (st) => stages.push(st) });
    fastForward(s.sim, worldStartStep(1));
    s.sim.invincible = true;
    s.frame(0.02);
    expect(stages).toEqual(['start']);
    expect(s.transitTo).toBe(2);
    expect(s.transitTotal).toBe(4);
    expect(s.transitLeft).toBeGreaterThan(3.9);
    const frozen = s.sim.stepIndex;
    const score = s.sim.scoring.score;
    const flips = s.sim.flips;
    const angle = s.sim.angle;
    expect(s.action()).toBe(false);
    expect(s.power('boost')).toBe(false);
    let elapsed = 0;
    let lastP = -1;
    while (s.transitLeft > 0) {
      expect(s.transitProgress).toBeGreaterThan(lastP);
      lastP = s.transitProgress;
      s.frame(0.1);
      elapsed += 0.1;
      expect(s.sim.stepIndex).toBe(frozen);
      expect(s.sim.scoring.score).toBe(score);
      expect(s.sim.flips).toBe(flips);
      expect(s.sim.angle).toBe(angle);
    }
    expect(elapsed).toBeGreaterThanOrEqual(WORLDS.transition - 0.11);
    expect(stages).toEqual(['start', 'end']);
    s.frame(0.1);
    expect(s.sim.world).toBe(2);
    expect(s.sim.stepIndex).toBeGreaterThan(frozen);
    // Le temps compté ne contient pas les 4 s
    expect(s.sim.time).toBeLessThan(120.2);
    expect(stages).toEqual(['start', 'end']);
  });

  it('les trois transitions s’enchaînent (1→2, 2→3, 3→4), jamais de 4ᵉ', () => {
    const tos: number[] = [];
    const s = worldsSession(11, { onTransit: (st, ses) => st === 'start' && tos.push(ses.transitTo) });
    s.sim.invincible = true;
    s.skipTo(560);
    expect(tos).toEqual([2, 3, 4]);
    expect(s.sim.world).toBe(4);
  });

  it('pause et retour d’arrière-plan pendant la transition : le décompte s’arrête, une longue image est plafonnée', () => {
    const s = worldsSession();
    fastForward(s.sim, worldStartStep(1));
    s.sim.invincible = true;
    s.frame(0.02);
    s.frame(0.5);
    const left = s.transitLeft;
    s.frame(30); // retour d'arrière-plan : image plafonnée
    expect(left - s.transitLeft).toBeLessThanOrEqual(SIM.maxFrameTime + 1e-9);
    const left2 = s.transitLeft;
    s.pause();
    s.frame(10);
    expect(s.transitLeft).toBe(left2);
    s.resume();
    while (s.phase !== 'running') s.frame(0.5);
    expect(s.transitLeft).toBe(left2);
    while (s.transitLeft > 0) s.frame(0.1);
    s.frame(0.1);
    expect(s.sim.world).toBe(2);
  });

  it('reprise juste avant une frontière : la transition a lieu une seule fois après la reprise', () => {
    const tos: number[] = [];
    const s = worldsSession(5, { canOffer: () => true, onTransit: (st, ses) => st === 'start' && tos.push(ses.transitTo) });
    fastForward(s.sim, worldStartStep(1) - STEP(1));
    s.sim.invincible = false;
    s.sim.hazards.length = 0;
    s.sim.hazards.push(makeSector('arc', s.sim.time - 1, 0.01, 5, s.sim.angle, 0.5));
    while (s.phase !== 'offer') s.frame(0.1);
    expect(tos).toEqual([]);
    expect(s.revive()).toBe(true);
    while ((s.phase as string) !== 'running') s.frame(0.1);
    s.sim.invincible = true;
    while (s.sim.world < 2) s.frame(0.1);
    expect(tos).toEqual([2]);
    s.skipTo(200);
    expect(tos).toEqual([2]);
  });

  it('aucune collision pendant la transition, puis arène vide et première vague différée (réapparition sûre)', () => {
    const s = worldsSession(13);
    fastForward(s.sim, worldStartStep(1));
    s.sim.invincible = false;
    s.frame(0.02);
    expect(s.transitLeft).toBeGreaterThan(0);
    // Un danger posé sur le vaisseau pendant la transition ne le touche jamais (simulation gelée), et disparaît à l'arrivée
    s.sim.hazards.push(makeSector('arc', s.sim.time - 1, 0.01, 30, s.sim.angle, 0.6));
    while (s.transitLeft > 0) s.frame(0.1);
    expect(s.sim.state).toBe('running');
    const entry = s.sim.time;
    s.frame(SIM.dt * 1.01);
    expect(s.sim.world).toBe(2);
    expect(s.sim.hazards).toHaveLength(0);
    // Aucune menace dangereuse avant le délai de première vague
    let first = Infinity;
    while (s.sim.time < entry + WORLDS.firstWaveDelay + 1) {
      s.frame(1 / 60);
      for (const h of s.sim.hazards) first = Math.min(first, dangerStart(h));
    }
    expect(s.sim.state).toBe('running');
    expect(first).toBeGreaterThanOrEqual(entry + WORLDS.firstWaveDelay - 1e-6);
  });

  it('aucune nouvelle vague dans les dernières secondes avant une faille', () => {
    const sim = createSimulation({ mode: 'survival', seed: 21, worlds: true });
    const starts: number[] = [];
    sim.director.onWave = (t) => starts.push(t);
    fastForward(sim, worldStartStep(1));
    for (const t of starts) expect(t < 120 - WORLDS.quietBefore || t >= 120).toBe(true);
  });
});

// ————————————————————————————————————————————— 6. Champs de vitesse

describe('univers : champs de vitesse (Mer nébulaire, Monde des vents)', () => {
  const f = new WorldsField(42);

  it('univers 1 et 2 : facteur neutre partout', () => {
    for (const t of [0, 60, 119, 125, 230])
      for (let a = 0; a < 6.3; a += 0.3) {
        expect(f.factor(a, t, 1)).toBe(1);
        expect(f.factor(a, t, -1)).toBe(1);
      }
  });

  it('univers 3 : brumes lentes (facteur < 1 en leur centre), cumul toujours dans les bornes de la Mer nébulaire', () => {
    let slow = 0;
    for (let t = 240; t < 360; t += 0.5) {
      for (const c of f.cloudsAt(t)) if (c.presence > 0.99) slow = Math.min(slow || 1, f.factor(c.center, t, 1));
      for (let a = 0; a < 6.3; a += 0.2) {
        for (const dir of [1, -1] as const) {
          const k = f.factor(a, t, dir);
          expect(k).toBeGreaterThanOrEqual(CLOUDS.clamp.min - 1e-12);
          expect(k).toBeLessThanOrEqual(CLOUDS.clamp.max + 1e-12);
        }
      }
    }
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThanOrEqual(CLOUDS.factor + 0.02);
  });

  it('univers 4 : hémisphère rapide (120 %) et lent (50 %), inversion = demi-tour du centre rapide', () => {
    const t = 361;
    const c = f.fastCenter(t);
    expect(f.factor(c, t, 1)).toBeCloseTo(CURRENTS.fast, 6);
    expect(f.factor(c + Math.PI, t, 1)).toBeCloseTo(CURRENTS.slow, 6);
    const view = f.currentsAt(360 + CURRENTS.inversion.first - 1);
    expect(view.warning).toBeGreaterThan(0);
    const at = 360 + CURRENTS.inversion.first;
    const before = f.fastCenter(at - 0.01);
    const after = f.fastCenter(at + CURRENTS.inversion.swap + 0.01);
    const turned = Math.abs(Math.atan2(Math.sin(after - before - Math.PI), Math.cos(after - before - Math.PI)));
    expect(turned).toBeLessThan(0.15); // ≈ π (+ légère dérive)
  });

  it('tourbillons : plus rapide dans leur sens, plus lent à contre-sens', () => {
    const vs = f.vorticesUntil(700);
    const v = vs.find((x) => x.start > 360)!;
    const t = (v.start + v.end) / 2;
    const withF = f.factor(v.angle, t, v.spin);
    const againstF = f.factor(v.angle, t, (v.spin === 1 ? -1 : 1) as 1 | -1);
    const base = f.factor(v.angle + Math.PI, t, v.spin) === f.factor(v.angle + Math.PI, t, (v.spin === 1 ? -1 : 1) as 1 | -1);
    expect(base).toBe(true); // hors du tourbillon, le sens ne compte pas
    expect(withF).toBeGreaterThan(againstF);
    expect(withF).toBeLessThanOrEqual(CURRENTS.clamp.max);
    expect(againstF).toBeGreaterThanOrEqual(CURRENTS.clamp.min);
  });

  it('champ reproductible : même graine = mêmes valeurs ; graine différente = calendrier différent', () => {
    const a = new WorldsField(9);
    const b = new WorldsField(9);
    const c = new WorldsField(10);
    let diff = 0;
    for (let t = 240; t < 900; t += 1.7) {
      for (const ang of [0, 1.3, 2.9, 4.4]) {
        expect(a.factor(ang, t, 1)).toBe(b.factor(ang, t, 1));
        if (a.factor(ang, t, 1) !== c.factor(ang, t, 1)) diff++;
      }
    }
    expect(diff).toBeGreaterThan(0);
  });
});

// ————————————————————————————————————————————— 7. Collision continue à vitesse variable

class ConstField implements SpeedField {
  constructor(private readonly k: number) {}
  factor(): number {
    return this.k;
  }
}

describe('univers : déplacement et collision continue à vitesse variable', () => {
  it('le champ multiplie exactement le déplacement du pas', () => {
    const base = new Simulation({ seed: 1, profile: emptyProfile, timeLimit: null });
    const slow = new Simulation({ seed: 1, profile: { ...emptyProfile, createField: () => new ConstField(0.5) }, timeLimit: null });
    let tb = 0;
    let ts = 0;
    for (let i = 0; i < 240; i++) {
      const b0 = base.angle;
      const s0 = slow.angle;
      base.step();
      slow.step();
      tb += wrapAngle(base.angle - b0);
      ts += wrapAngle(slow.angle - s0);
    }
    expect(ts / tb).toBeCloseTo(0.5, 9);
  });

  it('vaisseau rapide (×1,5) : un arc étroit sur sa route est touché (aucun saut par-dessus)', () => {
    const sim = new Simulation({ seed: 1, profile: { ...emptyProfile, createField: () => new ConstField(1.5) }, timeLimit: null });
    const ahead = sim.angle + 0.5;
    sim.hazards.push(makeSector('arc', -1, 0.01, 60, ahead, 0.002));
    for (let i = 0; i < 1200 && sim.state === 'running'; i++) sim.step();
    expect(sim.state).toBe('dead');
  });

  it('arc mouvant (dérive + élargissement) : balayage relatif sur le pas', () => {
    const h = makeSector('gust', 0, 0, 5, 1, 0.05);
    h.morph = { halfTo: 0.3, drift: 0.4 };
    const r = playerHitRadius();
    // Vaisseau immobile hors de l'arc initial, rattrapé par son élargissement et sa dérive
    expect(sectorHits(h, 1.35, 0, 0, 0.01, r)).toBe(false);
    expect(sectorHits(h, 1.35, 0, 1, 1.01, r)).toBe(true);
    // Vaisseau qui traverse le centre mouvant en un pas : touché
    expect(sectorHits(h, 0.5, 1.2, 0.1, 0.11, r)).toBe(true);
    // Vaisseau qui fuit à la même vitesse que la dérive, loin devant : jamais touché
    expect(sectorHits(h, 2.5, 0.004, 0.5, 0.51, r)).toBe(false);
  });
});

// ————————————————————————————————————————————— 8. Validateur d'évitement à vitesse variable

describe('univers : validateur d’évitement avec champ de vitesse', () => {
  const omega = omegaAt(() => 1, 0);
  const half = 0.6;
  const need = half + (playerHitRadius() + SAFETY.margin) / ARENA.orbitRadius;
  const warn = (1.5 * need) / omega;
  const trap = (): Hazard[] => [makeSector('arc', 0, warn, 3, 0, half)];
  const q = (field?: SpeedField) => ({ angle: 0, dir: 1 as const, time: 0, forcedTime: 0, forcedDir: 1 as const, speed: () => 1, field });

  it('vitesse normale : la fuite existe (comme le validateur historique)', () => {
    expect(hasEscapePath(trap(), q())).toBe(true);
    expect(hasEscapePath(trap(), q(new ConstField(1)))).toBe(true);
  });

  it('dans un nuage lent, la même vague devient inévitable : le validateur la refuse', () => {
    expect(hasEscapePath(trap(), q(new ConstField(CURRENTS.clamp.min)))).toBe(false);
  });

  it('aucun danger : toujours une fuite', () => {
    expect(hasEscapePath([], q(new ConstField(0.5)))).toBe(true);
  });

  it('chaque vague du directeur passe le validateur (bot sur les 4 univers, aucune mort)', { timeout: 60000 }, () => {
    const sim = createSimulation({ mode: 'survival', seed: 1000, worlds: true, bonus: false });
    let waves = 0;
    sim.director.onWave = () => waves++;
    const bot = new Bot(sim, true);
    while (sim.state === 'running' && sim.time < 490) {
      bot.tick();
      sim.step();
      sim.events.length = 0;
    }
    expect(sim.state).toBe('running');
    expect(sim.world).toBe(4);
    expect(waves).toBeGreaterThan(120);
  });
});

// ————————————————————————————————————————————— 9. Reproductibilité

describe('univers : déterminisme', () => {
  it('même graine + mêmes entrées = même partie (franchissement d’une frontière compris)', () => {
    const run = () => {
      const sim = createSimulation({ mode: 'survival', seed: 77, worlds: true, bonus: false });
      const bot = new Bot(sim, true);
      while (sim.state === 'running' && sim.time < 150) {
        bot.tick();
        sim.step();
        sim.events.length = 0;
      }
      return { t: sim.time, a: sim.angle, s: sim.scoring.score, f: [...sim.flipLog], h: hazardCount(sim), w: sim.world };
    };
    expect(run()).toEqual(run());
  });
});

// ————————————————————————————————————————————— 10. Aucune dépendance à l'audio ni au rendu

describe('univers : le gameplay ne lit jamais l’audio', () => {
  it('simulation, modes et configuration de gameplay n’importent ni audio, ni ambiance, ni rendu', () => {
    const files = [...readdirSync('src/sim').map((f) => `src/sim/${f}`), ...readdirSync('src/modes').map((f) => `src/modes/${f}`), 'src/config/worlds.ts', 'src/config/worldMusic.ts', 'src/game/session.ts'];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from '\.\.\/(audio|ambience|render|ui)\//);
      expect(src, f).not.toMatch(/AudioContext|Music\.position|currentTime/);
    }
  });

  it('grille de rythme : battements réels des univers 1 à 3, aucun battement inventé en 4', () => {
    expect(WORLD_RHYTHM_DATA.beats1.length).toBeGreaterThan(100);
    expect(WORLD_RHYTHM_DATA.beats1.every((b) => b < 120)).toBe(true);
    expect(WORLD_RHYTHM_DATA.beats3.length).toBeGreaterThan(200);
    expect(WORLD_RHYTHM_DATA.beats3.every((b) => b >= 239.5 && b < 360)).toBe(true);
    for (const t of [370, 400, 900]) {
      expect(WORLDS_RHYTHM.nextBeat(t)).toBe(t);
      expect(WORLDS_RHYTHM.nextAccent(t)).toBe(Infinity);
    }
    const b = WORLDS_RHYTHM.nextBeat(150);
    expect(b).toBeGreaterThanOrEqual(150);
    expect(b - 150).toBeLessThan(WORLDS_RHYTHM.beatPeriodAt(150) + 1e-9);
  });
});

// ————————————————————————————————————————————— 11 à 13. Isolation : récompenses, sauvegardes, autres modes

describe('univers : isolation (aucune récompense, aucun classement, autres modes inchangés)', () => {
  it('une partie du voyage est TOUJOURS de test : résumé marqué, aucune prime de phase, rien n’est enregistré', () => {
    const s = worldsSession();
    s.sim.invincible = true;
    s.skipTo(250);
    const summary = s.summary();
    expect(summary.test).toBe(true);
    expect(summary.phase).toBeUndefined();
    const save = defaultSave();
    const before = JSON.stringify(save);
    const report = applyRun(save, { ...summary, time: 250, score: 99999 });
    expect(report.test).toBe(true);
    expect(report.newRecord).toBe(false);
    expect(report.orbitShards).toBe(0);
    expect(JSON.stringify(save)).toBe(before);
  });

  it('sauvegarde inchangée (format, champs) et version d’équilibrage officielle conservée', () => {
    expect(BALANCE_VERSION).toBe(4);
    expect(JSON.stringify(defaultSave())).not.toMatch(/world/i);
  });

  it('Survie officielle, défi quotidien et niveaux ignorent le voyage (aucun champ, univers 1 permanent)', () => {
    const plain = createSimulation({ mode: 'survival', seed: 4 });
    const daily = createSimulation({ mode: 'daily', seed: 4, date: '2026-10-23', worlds: true });
    for (const sim of [plain, daily]) {
      expect(sim.field).toBeNull();
      expect(sim.director.worlds).toBe(false);
    }
    // La Survie officielle est strictement identique avec ou sans `worlds: false`
    const a = createSimulation({ mode: 'survival', seed: 4, worlds: false });
    fastForward(plain, STEP(130));
    fastForward(a, STEP(130));
    expect(a.world).toBe(1);
    expect(hazardCount(a)).toBe(hazardCount(plain));
    expect(a.angle).toBe(plain.angle);
    expect(() => createSimulation({ mode: 'campaign', seed: 1, worlds: true })).toThrow();
  });

  it('le profil des univers n’est utilisé que par une Survie demandée explicitement', () => {
    expect(worldsProfile().worlds).toBe(true);
    expect(new GameSession({ mode: 'survival', seed: 1 }).isTest).toBe(false);
    expect(new GameSession({ mode: 'daily', seed: 1, date: '2026-10-23', worlds: true }).isTest).toBe(false);
    expect(worldsSession().isTest).toBe(true);
  });
});

// ————————————————————————————————————————————— 17. Au-delà de 8 minutes

describe('univers : au-delà du dernier univers', () => {
  it('difficulté et vitesse plafonnées, aucune croissance sans fin', () => {
    for (let t = 0; t < 3600; t += 3) {
      expect(worldsDifficulty(t)).toBeLessThanOrEqual(WORLDS.extension.dMax + 1e-9);
      expect(worldsSpeed(t)).toBeLessThanOrEqual(WORLDS.speedCap + 1e-9);
    }
    expect(worldsSpeed(3000)).toBe(WORLDS.extension.speed);
  });

  it('la partie continue en univers 4 après 8 minutes (vagues toujours générées)', () => {
    const sim = createSimulation({ mode: 'survival', seed: 2, worlds: true });
    let late = 0;
    sim.director.onWave = (t) => {
      if (t > 490) late++;
    };
    fastForward(sim, STEP(560));
    expect(sim.world).toBe(4);
    expect(late).toBeGreaterThan(5);
  });
});

// ————————————————————————————————————————————— 14 à 16. Musique des univers (faux contexte Web Audio)


function musicSetup() {
  const ctx = new FakeCtx();
  const out = new FakeNode();
  const host: AudioHost = { context: () => ctx as unknown as BaseAudioContext, output: () => out as unknown as AudioNode };
  const buffers = { intro: buf('intro'), loop: buf('loop'), outro: buf('outro'), world2: buf('world2'), world3: buf('world3') };
  const wm = new WorldMusic(host, () => buffers);
  const pos = (): MusicPosition => wm.position({ track: null, time: 0, playing: false } as MusicPosition);
  return { ctx, wm, pos };
}

/** Platine (GainNode) d'une source : source → gain de voix → gain de platine. */
const deckGain = (s: FakeScheduled): FakeParam => ((s.connections[0] as FakeGain).connections[0] as FakeGain).gain;

describe('univers : musique (plans, transitions de 4 s, pause, univers sans morceau)', () => {
  it('univers 1 : intro puis boucle reprise au battement choisi, sans minuterie', () => {
    const { ctx, wm, pos } = musicSetup();
    wm.startGame(1);
    expect(ctx.sources.map(nameOf)).toEqual(['intro', 'loop']);
    const loop = ctx.sources[1];
    expect(loop.loop).toBe(true);
    expect(loop.loopStart).toBe(MUSIC.loopStart);
    expect(loop.loopEnd).toBe(MUSIC.loopEnd);
    expect(loop.starts[0].offset).toBeCloseTo(MUSIC.loopStart + 52.144 - 0.35, 9);
    ctx.currentTime = 60;
    const p = pos();
    expect(p.track).toBe('loop');
    expect(p.playing).toBe(true);
  });

  it('transition 1 → 2 : fondu croisé sur l’horloge audio (aucune coupure sèche), entrée filtrée, montage de La Faille calé sur la transition', () => {
    const { ctx, wm, pos } = musicSetup();
    wm.startGame(1);
    ctx.currentTime = 118;
    const old = ctx.sources.slice();
    wm.transition(2);
    const now = 118;
    for (const s of old) {
      expect(s.stopAt).toBeCloseTo(now + WORLD_TRANSITION_AUDIO.fadeOut + 0.05, 9);
      const g = deckGain(s);
      const ramp = g.events.find((e) => e.type === 'ramp' && e.value === 0)!;
      expect(ramp.time).toBeCloseTo(now + WORLD_TRANSITION_AUDIO.fadeOut, 9);
    }
    // Montage de l'univers 2 : deux voix (avant et après le raccord) sur le même buffer
    const w2 = ctx.sources.filter((s) => nameOf(s) === 'world2');
    expect(w2).toHaveLength(2);
    // Première note : à la position de montage 0, soit WORLD2_START s après le début de la transition, fichier depuis 0
    expect(w2[0].starts[0].when).toBeCloseTo(now + WORLD2_START, 9);
    expect(w2[0].starts[0].offset).toBeCloseTo(0, 9);
    // Chevauchement : la nouvelle musique entre avant que l'ancienne ne se taise
    expect(now + WORLD2_START).toBeLessThan(now + WORLD_TRANSITION_AUDIO.fadeOut + 0.05 + 1);
    const g = deckGain(w2[0]).events;
    expect(g.length).toBeGreaterThan(0);
    const deck = ctx.gains.find((gn) => gn.gain.events.some((e) => e.type === 'ramp' && Math.abs(e.time - (now + WORLDS.transition)) < 1e-9))!;
    expect(deck).toBeTruthy();
    const filt = ctx.filters.at(-1)!.frequency.events;
    expect(filt[0]).toMatchObject({ type: 'set', value: WORLD_TRANSITION_AUDIO.filterFrom });
    expect(filt.find((e) => e.type === 'exp')!.time).toBeCloseTo(now + WORLDS.transition, 9);
    // À l'arrivée (fin de la transition, temps local 0) la position musicale est celle du montage au temps -WORLD2_AT
    ctx.currentTime = now + WORLDS.transition;
    const p = pos();
    expect(p.track).toBe('w2');
    expect(p.time).toBeCloseTo(-WORLD2_AT, 6);
    expect(wm.activeDecks).toBe(1);
  });

  it('pause / reprise : la position musicale est conservée (synchro de l’ambiance)', () => {
    const { ctx, wm, pos } = musicSetup();
    wm.startGame(1);
    ctx.currentTime = 70;
    const before = pos();
    wm.pause();
    ctx.currentTime = 200;
    const paused = pos();
    expect(paused.playing).toBe(false);
    expect(paused.time).toBeCloseTo(before.time, 6);
    wm.resume();
    const resumed = ctx.sources.at(-1)!;
    ctx.currentTime = resumed.starts[0].when;
    const after = pos();
    expect(after.track).toBe(before.track);
    expect(after.time).toBeCloseTo(before.time, 6);
  });

  it('univers 4 sans morceau : fond procédural, aucune position musicale (pas de faux battement), aucune erreur', () => {
    expect(WORLD_MUSIC[3].track).toBe('world3');
    expect(WORLD_MUSIC[3].pad).toBeNull();
    expect(WORLD_MUSIC[4].track).toBeNull();
    const { ctx, wm, pos } = musicSetup();
    wm.startGame(2);
    ctx.currentTime = 10;
    expect(() => wm.transition(3)).not.toThrow();
    ctx.currentTime = 20;
    expect(() => wm.transition(4)).not.toThrow();
    ctx.currentTime = 24;
    expect(ctx.oscs.length).toBeGreaterThan(0);
    const p = pos();
    expect(p.track).toBeNull();
    expect(p.playing).toBe(false);
    ctx.currentTime = 30;
    expect(pos().track).toBeNull();
    expect(wm.currentWorld).toBe(4);
    wm.pause();
    wm.resume();
    wm.endGame();
    expect(wm.resumeAfterDeath()).toBe(true);
    wm.stop();
    expect(wm.playing).toBe(false);
  });

  it('morceau pas encore décodé : silence, jamais d’erreur', () => {
    const ctx = new FakeCtx();
    const host: AudioHost = { context: () => ctx as unknown as BaseAudioContext, output: () => new FakeNode() as unknown as AudioNode };
    const wm = new WorldMusic(host, () => ({}));
    expect(() => wm.startGame(1)).not.toThrow();
    expect(() => wm.transition(2)).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
  });
});
