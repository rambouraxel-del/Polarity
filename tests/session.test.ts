import { describe, expect, it } from 'vitest';
import { SIM, UI } from '../src/config/balance';
import { LEVELS } from '../src/config/levels';
import { GameSession } from '../src/game/session';
import { makeSector } from '../src/sim/hazards';

function survival() {
  const ends: unknown[] = [];
  const s = new GameSession({ mode: 'survival', seed: 1 }, { onEnd: (r) => ends.push(r) });
  return { s, ends };
}

describe('Session : pause et temps actif', () => {
  it('le temps actif n’avance qu’en jeu', () => {
    const { s } = survival();
    for (let i = 0; i < 30; i++) s.frame(1 / 60);
    const t = s.sim.time;
    expect(t).toBeCloseTo(0.5, 1);
    s.pause();
    for (let i = 0; i < 600; i++) s.frame(1 / 60);
    expect(s.sim.time).toBe(t);
    s.resume();
    expect(s.phase).toBe('countdown');
    // Le compte à rebours ne compte pas
    for (let i = 0; i < 60; i++) s.frame(1 / 60);
    expect(s.sim.time).toBe(t);
    for (let i = 0; i < 120; i++) s.frame(1 / 60);
    expect(s.phase).toBe('running');
    expect(s.sim.time).toBeGreaterThan(t);
  });

  it('une image très longue (retour d’arrière-plan) est plafonnée', () => {
    const { s } = survival();
    s.frame(30);
    expect(s.sim.time).toBeLessThanOrEqual(SIM.maxFrameTime + SIM.dt);
  });

  it('les actions sont ignorées hors du jeu actif', () => {
    const { s } = survival();
    s.pause();
    expect(s.action()).toBe(false);
    s.resume();
    expect(s.action()).toBe(false);
    for (let i = 0; i < 120; i++) s.frame(1 / 60);
    expect(UI.resumeCountdown * UI.resumeStep).toBeLessThan(2);
    expect(s.action()).toBe(true);
  });

  it('les résultats sont indépendants de la fréquence d’affichage', () => {
    const run = (fps: number) => {
      const s = new GameSession({ mode: 'survival', seed: 9 });
      s.sim.flip();
      const frames = Math.round(20 * fps);
      for (let i = 0; i < frames; i++) s.frame(1 / fps);
      return { angle: s.sim.angle, time: s.sim.time, haz: s.sim.hazards.length, score: s.sim.scoring.score };
    };
    const a = run(30);
    const b = run(144);
    expect(Math.abs(a.time - b.time)).toBeLessThan(2 * SIM.dt);
  });

  it('la fin de partie est signalée une seule fois', () => {
    const { s, ends } = survival();
    s.sim.hazards.push(makeSector('arc', 0, 0.05, 5, s.sim.angle, 0.4));
    for (let i = 0; i < 300; i++) s.frame(1 / 60);
    expect(s.phase).toBe('over');
    expect(ends).toHaveLength(1);
    s.pause();
    s.resume();
    for (let i = 0; i < 300; i++) s.frame(1 / 60);
    expect(ends).toHaveLength(1);
  });

  it('un niveau réussi se termine par « complete »', () => {
    const ends: { outcome: string }[] = [];
    const s = new GameSession({ mode: 'level', seed: 1, level: LEVELS[0] }, { onEnd: (r) => ends.push(r) });
    // Simulation invincible pour atteindre la fin du chrono
    (s.sim as unknown as { invincible: boolean }).invincible = true;
    for (let i = 0; i < 95 * 60; i++) s.frame(1 / 60);
    expect(ends).toHaveLength(1);
    expect(ends[0].outcome).toBe('complete');
  });
});
