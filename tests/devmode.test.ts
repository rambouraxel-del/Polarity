import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_LOCK, DevAttemptGuard, checkDevPassword, defaultDevOptions, devPasswordProblem, makeLock, sanitizeDevOptions } from '../src/dev/devMode';
import { sha256Hex } from '../src/dev/sha256';
import { createSimulation } from '../src/modes/run';
import { GameSession } from '../src/game/session';
import { applyRun, type RunSummary } from '../src/progression/progress';
import { defaultSave, sanitize } from '../src/save/save';

const DEV_PASSWORD = 'Dev!2026';

describe('mode développeur : verrou d’accès', () => {
  it('SHA-256 conforme (vecteurs connus)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('désactivé par défaut, mot de passe d’origine accepté, autres refusés', () => {
    expect(defaultDevOptions()).toEqual({ enabled: false, lock: '' });
    expect(defaultSave().options.dev.enabled).toBe(false);
    expect(checkDevPassword('', DEV_PASSWORD)).toBe(true);
    expect(checkDevPassword('', 'dev!2026')).toBe(false);
    expect(checkDevPassword('', '')).toBe(false);
    expect(DEFAULT_DEV_LOCK).not.toContain(DEV_PASSWORD);
  });

  it('mot de passe configurable : le nouveau remplace l’ancien (sel propre)', () => {
    const lock = makeLock('Autre!Passe9', 'abcd1234abcd1234');
    expect(checkDevPassword(lock, 'Autre!Passe9')).toBe(true);
    expect(checkDevPassword(lock, DEV_PASSWORD)).toBe(false);
    expect(lock).not.toContain('Autre!Passe9');
    expect(devPasswordProblem('court')).not.toBeNull();
    expect(devPasswordProblem('assez long')).toBeNull();
  });

  it('sauvegarde : verrou illisible ignoré, mode jamais activé par défaut, valeurs valides conservées', () => {
    expect(sanitizeDevOptions(undefined)).toEqual({ enabled: false, lock: '' });
    expect(sanitizeDevOptions({ enabled: 'oui', lock: 12 })).toEqual({ enabled: false, lock: '' });
    expect(sanitizeDevOptions({ enabled: true, lock: 'pas un verrou' })).toEqual({ enabled: true, lock: '' });
    const lock = makeLock('Autre!Passe9', 'abcd1234');
    expect(sanitizeDevOptions({ enabled: true, lock })).toEqual({ enabled: true, lock });
    const s = defaultSave();
    s.options.dev = { enabled: true, lock };
    const back = sanitize(JSON.parse(JSON.stringify(s)));
    expect(back.options.dev).toEqual({ enabled: true, lock });
    // Anciennes sauvegardes sans le champ
    const old = JSON.parse(JSON.stringify(defaultSave())) as { options: Record<string, unknown> };
    delete old.options.dev;
    expect(sanitize(old).options.dev.enabled).toBe(false);
  });

  it('essais limités : 5 échecs, puis attente croissante', () => {
    const g = new DevAttemptGuard();
    for (let i = 0; i < 4; i++) g.fail(1000);
    expect(g.wait(1000)).toBe(0);
    g.fail(1000);
    expect(g.wait(1000)).toBe(30);
    expect(g.wait(1000 + 31_000)).toBe(0);
    g.fail(40_000);
    expect(g.wait(40_000)).toBe(60);
    g.succeed();
    expect(g.wait(40_000)).toBe(0);
  });
});

describe('mode développeur : parties de test', () => {
  const base = { mode: 'survival' as const, seed: 12345, bonus: false, stock: { boost: 0, gel: 0 } };

  it('vaisseau immortel : aucune collision n’arrête la partie, obstacles inchangés, partie « assistée »', () => {
    const normal = createSimulation(base);
    const test = createSimulation({ ...base, test: true });
    let hazards = 0;
    for (let i = 0; i < 120 * 200 && normal.state === 'running'; i++) normal.step(); // le vaisseau qui ne bouge pas finit par mourir
    expect(normal.state).toBe('dead');
    for (let i = 0; i < 120 * 200; i++) {
      test.step();
      hazards = Math.max(hazards, test.hazards.length);
    }
    expect(test.state).toBe('running');
    expect(test.assisted).toBe(true);
    expect(hazards).toBeGreaterThan(0);
    expect(test.time).toBeGreaterThan(190);
  });

  it('sans le champ « test » (service, parties normales) : simulation strictement identique', () => {
    const a = createSimulation(base);
    const b = createSimulation({ ...base, test: false });
    for (let i = 0; i < 120 * 60; i++) {
      a.step();
      b.step();
      if (i % 700 === 0) {
        a.flip();
        b.flip();
      }
    }
    expect(b.state).toBe(a.state);
    expect(b.time).toBe(a.time);
    expect(b.scoring.score).toBe(a.scoring.score);
    expect(b.flipLog).toEqual(a.flipLog);
    expect(b.assisted).toBe(false);
  });

  it('une partie de test reste de test : résumé marqué, jamais comptabilisée, même mode désactivé ensuite', () => {
    const session = new GameSession({ ...base, test: true });
    const summary = session.summary();
    expect(summary.test).toBe(true);
    const save = defaultSave();
    const before = JSON.stringify(save);
    const run: RunSummary = { ...summary, time: 400, score: 999999, cycles: 300, bestMultiplier: 5, shards: 80, events: 9, phase: 2, test: true };
    const report = applyRun(save, run);
    expect(report.test).toBe(true);
    expect(report.achievements).toEqual([]);
    expect(report.newRecord).toBe(false);
    expect(report.orbitShards).toBe(0);
    expect(JSON.stringify(save)).toBe(before); // aucune statistique, record, Éclat, succès ni déblocage
    // Le même résultat sans le marqueur serait, lui, comptabilisé
    const normal = defaultSave();
    applyRun(normal, { ...run, test: undefined });
    expect(normal.survival.bestTime).toBeGreaterThan(0);
    expect(normal.stats.totalRuns).toBe(1);
  });

  it('une partie normale n’est jamais marquée comme test', () => {
    expect(new GameSession(base).summary().test).toBeUndefined();
    expect(new GameSession({ ...base, test: false }).summary().test).toBeUndefined();
    // Le mode ne concerne que la Survie
    expect(new GameSession({ mode: 'daily', seed: 1, date: '2026-10-16', test: true }).summary().test).toBeUndefined();
  });
});
