import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import { dailySeed, formatDateFr, utcDateString } from '../src/modes/daily';
import { createSimulation } from '../src/modes/run';
import { applyRun, beatsRecord, isLevelUnlocked, starsFor } from '../src/progression/progress';
import { CORRUPT_KEY, defaultSave, loadSave, MemoryStore, SAVE_KEY, writeSave } from '../src/save/save';

const levelRun = (id: number, outcome: 'dead' | 'complete', score = 1000) =>
  ({ mode: 'level', levelId: id, time: outcome === 'complete' ? 90 : 30, score, cycles: 2, bestMultiplier: 2, outcome }) as const;

describe('Progression des niveaux', () => {
  it('seul le niveau 1 est ouvert au départ', () => {
    const save = defaultSave();
    expect(isLevelUnlocked(save, 1)).toBe(true);
    expect(isLevelUnlocked(save, 2)).toBe(false);
  });

  it('un échec ne débloque rien, une réussite débloque le suivant même avec un score faible', () => {
    const save = defaultSave();
    applyRun(save, levelRun(1, 'dead', 999999));
    expect(isLevelUnlocked(save, 2)).toBe(false);
    const rep = applyRun(save, levelRun(1, 'complete', 0));
    expect(rep.unlockedLevel).toBe(2);
    expect(rep.stars).toBe(0);
    expect(isLevelUnlocked(save, 2)).toBe(true);
    expect(isLevelUnlocked(save, 3)).toBe(false);
  });

  it('conserve les meilleures étoiles et le meilleur score', () => {
    const save = defaultSave();
    const l = LEVELS[0];
    applyRun(save, levelRun(1, 'complete', l.stars[2]));
    applyRun(save, levelRun(1, 'complete', l.stars[0]));
    expect(save.levels['1'].stars).toBe(3);
    expect(save.levels['1'].bestScore).toBe(l.stars[2]);
    expect(starsFor(l, l.stars[1])).toBe(2);
  });

  it('succès débloqués une seule fois', () => {
    const save = defaultSave();
    const r1 = applyRun(save, levelRun(1, 'complete'));
    expect(r1.achievements.map((a) => a.id)).toContain('first_level');
    const r2 = applyRun(save, levelRun(1, 'complete'));
    expect(r2.achievements.map((a) => a.id)).not.toContain('first_level');
  });
});

describe('Records de Survie', () => {
  it('le temps prime, le score départage', () => {
    expect(beatsRecord(10, 0, 9, 1000)).toBe(true);
    expect(beatsRecord(10, 500, 10, 400)).toBe(true);
    expect(beatsRecord(10, 300, 10, 400)).toBe(false);
  });

  it('enregistre le record et l’écart', () => {
    const save = defaultSave();
    const run = (time: number, score: number) =>
      applyRun(save, { mode: 'survival', time, score, cycles: 0, bestMultiplier: 1, outcome: 'dead' });
    expect(run(30, 100).newRecord).toBe(true);
    const r = run(20, 5000);
    expect(r.newRecord).toBe(false);
    expect(r.previousBestTime).toBe(30);
    expect(save.survival.bestTime).toBe(30);
    expect(save.survival.runs).toBe(2);
  });
});

describe('Défi quotidien', () => {
  it('date UTC et graine reproductibles', () => {
    expect(utcDateString(new Date(Date.UTC(2026, 9, 11, 23, 59)))).toBe('2026-10-11');
    expect(dailySeed('2026-10-11')).toBe(dailySeed('2026-10-11'));
    expect(dailySeed('2026-10-11')).not.toBe(dailySeed('2026-10-12'));
    expect(formatDateFr('2026-10-01')).toBe('1er octobre 2026');
  });

  it('même date et mêmes entrées : mêmes motifs, quelle que soit la graine aléatoire fournie', () => {
    const a = createSimulation({ mode: 'daily', seed: 1, date: '2026-10-11' });
    const b = createSimulation({ mode: 'daily', seed: 2, date: '2026-10-11' });
    a.advance(40);
    b.advance(40);
    expect(JSON.stringify(a.hazards)).toBe(JSON.stringify(b.hazards));
    expect(a.director.waveCount).toBe(b.director.waveCount);
  });

  it('meilleur résultat conservé par date', () => {
    const save = defaultSave();
    const run = (date: string, time: number) =>
      applyRun(save, { mode: 'daily', date, time, score: 0, cycles: 0, bestMultiplier: 1, outcome: 'dead' });
    run('2026-10-10', 50);
    run('2026-10-11', 20);
    run('2026-10-11', 10);
    expect(save.daily['2026-10-10'].bestTime).toBe(50);
    expect(save.daily['2026-10-11'].bestTime).toBe(20);
    expect(save.daily['2026-10-11'].runs).toBe(2);
  });
});

describe('Sauvegarde', () => {
  it('absente : valeurs par défaut', () => {
    const r = loadSave(new MemoryStore());
    expect(r.status).toBe('new');
    expect(r.data.levels).toEqual({});
  });

  it('corrompue : repli sur les valeurs par défaut, donnée mise de côté', () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, '{pas du json');
    const r = loadSave(store);
    expect(r.status).toBe('corrupt');
    expect(r.data.survival.bestTime).toBe(0);
    expect(store.get(CORRUPT_KEY)).toBe('{pas du json');
  });

  it('partiellement invalide : les champs valides sont conservés', () => {
    const store = new MemoryStore();
    store.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, levels: { '1': { completed: true, bestScore: 1200, stars: 9 }, x: 3 }, survival: { bestTime: 'oops' }, options: { volume: 7 } }),
    );
    const r = loadSave(store);
    expect(r.data.levels['1']).toEqual({ completed: true, bestScore: 1200, stars: 3 });
    expect(r.data.levels.x).toBeUndefined();
    expect(r.data.survival.bestTime).toBe(0);
    expect(r.data.options.volume).toBe(1);
  });

  it('aller-retour écriture / lecture', () => {
    const store = new MemoryStore();
    const save = defaultSave();
    save.survival.bestTime = 123.4;
    save.achievements.first_cycle = 1;
    writeSave(store, save);
    expect(loadSave(store).data).toEqual(save);
  });

  it('stockage indisponible : aucune exception', () => {
    const broken = { get: () => { throw new Error('refus'); }, set: () => { throw new Error('refus'); } };
    expect(() => writeSave(broken, defaultSave())).not.toThrow();
  });
});
