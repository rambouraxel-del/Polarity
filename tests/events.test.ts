import { describe, expect, it } from 'vitest';
import { CAPS, SIM } from '../src/config/balance';
import { EVENTS, eventDef } from '../src/config/events';
import { dailySeed } from '../src/modes/daily';
import { createSimulation } from '../src/modes/run';
import { survivalProfile } from '../src/modes/profiles';
import type { DirectorPhase } from '../src/sim/director';
import { Simulation, type SimEvent } from '../src/sim/simulation';
import { LEVELS } from '../src/config/levels';
import { levelProfile } from '../src/modes/profiles';

interface Stage { stage: string; kind: string; t: number }

/** Joue sans collision et relève chaque transition d'événement et chaque vague (avec la phase du directeur). */
function trace(seed: number, seconds: number, flipEvery = 0) {
  const sim = new Simulation({ seed, profile: survivalProfile(), timeLimit: null, invincible: true });
  const stages: Stage[] = [];
  const waves: { t: number; id: string; phase: DirectorPhase }[] = [];
  const phases: { t: number; phase: DirectorPhase; hazards: number; added: number }[] = [];
  sim.director.onWave = (t, id, phase) => waves.push({ t, id, phase });
  const steps = Math.round(seconds / SIM.dt);
  let prevIds = new Set<number>();
  for (let i = 0; i < steps; i++) {
    if (flipEvery && i % Math.round(flipEvery / SIM.dt) === 0) sim.flip();
    sim.step();
    for (const e of sim.events as SimEvent[]) if (e.type === 'event') stages.push({ stage: e.stage, kind: e.kind, t: sim.time - SIM.dt });
    sim.events.length = 0;
    let added = 0;
    for (const h of sim.hazards) if (!prevIds.has(h.id)) added++;
    prevIds = new Set(sim.hazards.map((h) => h.id));
    phases.push({ t: sim.time, phase: sim.director.phase, hazards: sim.hazards.length, added });
  }
  return { sim, stages, waves, phases };
}

describe('Calendrier des événements', () => {
  it('premier événement entre 45 et 60 s, puis 40 à 60 s après la fin du précédent', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { stages } = trace(seed * 101, 6 * 60);
      const starts = stages.filter((s) => s.stage === 'start');
      const ends = stages.filter((s) => s.stage === 'end');
      expect(starts.length).toBeGreaterThanOrEqual(5);
      expect(starts[0].t).toBeGreaterThanOrEqual(45 - SIM.dt);
      expect(starts[0].t).toBeLessThanOrEqual(60 + SIM.dt);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i].t - ends[i - 1].t;
        expect(gap).toBeGreaterThanOrEqual(40 - SIM.dt);
        expect(gap).toBeLessThanOrEqual(60 + SIM.dt);
      }
    }
  });

  it('annonce 2 s avant le début, durées 12 s / 10 s, respiration de 3 s, puis reprise', () => {
    const { stages } = trace(2024, 7 * 60);
    const kinds = new Set<string>();
    for (let i = 0; i + 3 < stages.length; ) {
      if (stages[i].stage !== 'announce') { i++; continue; }
      const [an, st, en, re] = stages.slice(i, i + 4);
      expect([st.stage, en.stage, re.stage]).toEqual(['start', 'end', 'resume']);
      expect(new Set([an.kind, st.kind, en.kind, re.kind]).size).toBe(1);
      expect(st.t - an.t).toBeCloseTo(EVENTS.announce, 1);
      expect(Math.abs(en.t - st.t - eventDef(st.kind as 'meteor' | 'storm').duration)).toBeLessThan(2 * SIM.dt);
      expect(Math.abs(re.t - en.t - EVENTS.breath)).toBeLessThan(2 * SIM.dt);
      kinds.add(st.kind);
      i += 4;
    }
    expect(kinds.size).toBe(2); // les deux événements apparaissent
    expect(eventDef('meteor').duration).toBe(12);
    expect(eventDef('storm').duration).toBe(10);
  });

  it('reproductible : même graine → même calendrier, quelles que soient les actions du joueur', () => {
    const a = trace(777, 5 * 60).stages;
    const b = trace(777, 5 * 60, 1.3).stages; // le joueur inverse toutes les 1,3 s
    expect(b.map((s) => `${s.stage}:${s.kind}:${s.t.toFixed(3)}`)).toEqual(a.map((s) => `${s.stage}:${s.kind}:${s.t.toFixed(3)}`));
    const c = trace(778, 5 * 60).stages;
    expect(c.map((s) => s.t.toFixed(2))).not.toEqual(a.map((s) => s.t.toFixed(2)));
  });

  it('défi quotidien : même date → mêmes événements et mêmes vagues pour des entrées identiques', () => {
    const run = (date: string, flips: boolean) => {
      const sim = createSimulation({ mode: 'daily', seed: Math.floor(Math.random() * 1e9), date });
      (sim as unknown as { invincible: boolean }).invincible = true;
      const stages: string[] = [];
      for (let i = 0; i < 4 * 60 * 120; i++) {
        if (flips && i % 150 === 0) sim.flip();
        sim.step();
        for (const e of sim.events) if (e.type === 'event') stages.push(`${e.stage}:${e.kind}:${(sim.time - SIM.dt).toFixed(3)}`);
        sim.events.length = 0;
      }
      return { stages, json: JSON.stringify(sim.hazards), waves: sim.director.waveCount };
    };
    const a = run('2026-10-12', false);
    const b = run('2026-10-12', false);
    expect(b).toEqual(a);
    expect(a.stages.length).toBeGreaterThan(8);
    // Autres actions : même calendrier d'événements (graine dédiée)
    expect(run('2026-10-12', true).stages).toEqual(a.stages);
    // Autre date : autre calendrier
    expect(run('2026-10-13', false).stages).not.toEqual(a.stages);
    expect(dailySeed('2026-10-12')).not.toBe(dailySeed('2026-10-13'));
  });
});

describe('Un seul directeur de vagues', () => {
  it('aucune vague normale pendant l’annonce, l’événement et la respiration ; événements sans chevauchement', () => {
    for (const seed of [5, 9, 31]) {
      const { waves, stages } = trace(seed, 8 * 60);
      // Fenêtres de chaque événement
      const windows: [number, number, number, number][] = [];
      for (let i = 0; i < stages.length; i++) {
        if (stages[i].stage === 'announce' && stages[i + 3]) windows.push([stages[i].t, stages[i + 1].t, stages[i + 2].t, stages[i + 3].t]);
      }
      expect(windows.length).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < windows.length; i++) expect(windows[i][0]).toBeGreaterThan(windows[i - 1][3]); // pas de chevauchement
      // Dernier événement éventuellement inachevé à la fin de la partie simulée : ignoré
      const lastWindowEnd = windows[windows.length - 1][3];
      for (const w of waves.filter((x) => x.t < lastWindowEnd)) {
        const inside = windows.find(([an, , , re]) => w.t >= an - 1e-9 && w.t < re - 1e-9);
        if (!inside) {
          expect(w.phase).toBe('normal');
        } else {
          const [, st, en] = inside;
          // Entre l'annonce et le début, et pendant la respiration : aucune nouvelle attaque
          expect(w.t).toBeGreaterThanOrEqual(st - 1e-9);
          expect(w.t).toBeLessThan(en + 1e-9);
          expect(w.phase).toBe('event');
        }
      }
    }
  });

  it('pendant un événement, seuls les motifs de l’événement sont lancés', () => {
    const { waves, stages } = trace(64, 8 * 60);
    const meteor = Object.keys(eventDef('meteor').weights);
    const storm = Object.keys(eventDef('storm').weights);
    let seenMeteor = 0;
    let seenStorm = 0;
    for (const w of waves.filter((x) => x.phase === 'event')) {
      const st = [...stages].reverse().find((s) => s.stage === 'start' && s.t <= w.t + SIM.dt)!;
      const allowed = st.kind === 'meteor' ? meteor : storm;
      expect(allowed).toContain(w.id);
      if (st.kind === 'meteor') seenMeteor++;
      else seenStorm++;
    }
    expect(seenMeteor).toBeGreaterThan(5);
    expect(seenStorm).toBeGreaterThan(5);
  });

  it('la pluie mêle astéroïdes simples et convois ; la tempête, des secteurs et quelques astéroïdes', () => {
    const counts = { meteor: {} as Record<string, number>, storm: {} as Record<string, number> };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { waves, stages } = trace(seed * 313, 10 * 60);
      for (const w of waves.filter((x) => x.phase === 'event')) {
        const st = [...stages].reverse().find((s) => s.stage === 'start' && s.t <= w.t + SIM.dt)!;
        const bag = counts[st.kind as 'meteor' | 'storm'];
        bag[w.id] = (bag[w.id] ?? 0) + 1;
      }
    }
    const m = counts.meteor;
    expect((m.shot ?? 0) + (m.diameter ?? 0)).toBeGreaterThan(5);
    expect(m.convoy ?? 0).toBeGreaterThan(5);
    const s = counts.storm;
    const sectors = (s.arc ?? 0) + (s.twinArcs ?? 0) + (s.chase ?? 0);
    const rocks = (s.shot ?? 0) + (s.diameter ?? 0);
    expect(sectors).toBeGreaterThan(rocks);
    expect(rocks).toBeGreaterThan(0);
  });

  it('les menaces déjà présentes ne sont jamais effacées : elles finissent normalement', () => {
    const sim = new Simulation({ seed: 8, profile: survivalProfile(), timeLimit: null, invincible: true });
    const watched = new Map<number, number>(); // id → fin prévue
    let announcedAt = -1;
    for (let i = 0; i < 6 * 60 * 120; i++) {
      sim.step();
      for (const e of sim.events) if (e.type === 'event' && e.stage === 'announce' && announcedAt < 0) announcedAt = sim.time;
      sim.events.length = 0;
      if (announcedAt >= 0 && watched.size === 0 && sim.time - announcedAt < 0.01) for (const h of sim.hazards) watched.set(h.id, h.end);
      if (watched.size) {
        // Une menace présente à l'annonce ne disparaît qu'à sa fin naturelle
        const alive = new Set(sim.hazards.map((h) => h.id));
        for (const [id, end] of watched) if (!alive.has(id)) expect(sim.time).toBeGreaterThan(end - 1e-6);
      }
      if (announcedAt >= 0 && sim.time > announcedAt + 15) break;
    }
    expect(announcedAt).toBeGreaterThan(40);
    expect(watched.size).toBeGreaterThan(0);
  });

  it('la respiration suspend les nouvelles attaques sans effacer brutalement les menaces présentes', () => {
    const { stages, phases } = trace(14, 5 * 60);
    const ends = stages.filter((s) => s.stage === 'end');
    expect(ends.length).toBeGreaterThan(3);
    for (const e of ends) {
      const during = phases.filter((p) => p.t > e.t + SIM.dt && p.t <= e.t + EVENTS.breath - SIM.dt);
      expect(during.length).toBeGreaterThan(100);
      for (const p of during) {
        expect(p.phase).toBe('breath');
        expect(p.added).toBe(0);
      }
      // Pas de disparition en bloc : le nombre de menaces ne chute pas d'un coup
      for (let i = 1; i < during.length; i++) expect(during[i - 1].hazards - during[i].hazards).toBeLessThanOrEqual(2);
    }
  });

  it('pendant l’annonce, aucune nouvelle attaque', () => {
    const { stages, phases } = trace(21, 4 * 60);
    for (const a of stages.filter((s) => s.stage === 'announce')) {
      const during = phases.filter((p) => p.t > a.t + SIM.dt && p.t < a.t + EVENTS.announce - SIM.dt);
      for (const p of during) {
        expect(p.phase).toBe('announce');
        expect(p.added).toBe(0);
      }
    }
  });

  it('plafonds respectés pendant les événements (menaces, intervalle minimal) et plus de 25 min sans accumulation', () => {
    const { waves, phases } = trace(404, 25 * 60);
    let maxAlive = 0;
    for (const p of phases) maxAlive = Math.max(maxAlive, p.hazards);
    expect(maxAlive).toBeLessThanOrEqual(CAPS.maxActiveHazards + 6); // listes incluant des objets terminés en cours de nettoyage
    for (let i = 1; i < waves.length; i++) expect(waves[i].t - waves[i - 1].t).toBeGreaterThanOrEqual(CAPS.minWaveInterval - 1e-9);
    expect(waves.filter((w) => w.phase === 'event').length).toBeGreaterThan(100);
  });

  it('les niveaux n’ont pas d’événements', () => {
    for (const level of [LEVELS[0], LEVELS[5], LEVELS[11]]) {
      const sim = new Simulation({ seed: 3, profile: levelProfile(level), timeLimit: 90, invincible: true });
      for (let i = 0; i < 90 * 120; i++) {
        sim.step();
        expect(sim.director.phase).toBe('normal');
        for (const e of sim.events) expect(e.type).not.toBe('event');
        sim.events.length = 0;
      }
    }
  });

  it('le répit de cycle n’agit que hors événement', () => {
    const sim = new Simulation({ seed: 3, profile: survivalProfile(), timeLimit: null, invincible: true });
    for (let i = 0; i < 80 * 120 && sim.director.phase !== 'event'; i++) sim.step();
    expect(sim.director.phase).toBe('event');
    expect(sim.director.onCycleComplete(sim.time)).toBe(0);
  });
});
