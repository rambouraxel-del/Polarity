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

import { LeaderboardClient } from '../src/net/leaderboard';
import { BALANCE_VERSION } from '../src/config/version';
import { backupRecords, clearRecords, hasRecords, snapshotRecords } from '../src/dev/records';
import { PHASES } from '../src/config/phases';
import { AmbienceDirector } from '../src/ambience/director';
import { leaderboardScreen } from '../src/ui/screens';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join as pjoin } from 'node:path';

describe('fenêtre développeur : contrôles de partie', () => {
  const cfg = { mode: 'survival' as const, seed: 4242, bonus: false, stock: { boost: 0, gel: 0 }, test: true };

  it('les contrôles sont refusés sur une partie normale et ne la transforment jamais en partie de test', () => {
    const s = new GameSession({ mode: 'survival', seed: 4242, bonus: false });
    expect(s.setTestInvincible(true)).toBe(false);
    expect(s.setTestFrozen(true)).toBe(false);
    expect(s.setTestRate(4)).toBe(false);
    s.skipTo(60);
    expect(s.sim.time).toBe(0);
    expect(s.sim.invincible).toBe(false);
    expect(s.summary().test).toBeUndefined();
  });

  it('pause, vitesse et immortalité : partie de test, temps gelé puis repris, vitesse ×4', () => {
    const s = new GameSession(cfg);
    s.setTestFrozen(true);
    for (let i = 0; i < 60; i++) s.frame(1 / 60);
    expect(s.sim.time).toBe(0);
    s.setTestFrozen(false);
    for (let i = 0; i < 60; i++) s.frame(1 / 60);
    const normal = s.sim.time;
    expect(normal).toBeGreaterThan(0.9);
    s.setTestRate(4);
    for (let i = 0; i < 60; i++) s.frame(1 / 60);
    expect(s.sim.time - normal).toBeGreaterThan(3.5);
    expect(s.setTestInvincible(false)).toBe(true);
    expect(s.sim.invincible).toBe(false);
    // Mortelle de nouveau, mais toujours une partie de test (jamais classée)
    expect(s.summary().test).toBe(true);
  });

  it('sauts dans le temps : 4:30, traversée, phase 2 ; aucun résultat, partie de test', () => {
    const s = new GameSession(cfg);
    s.skipTo(PHASES.coreGrowFrom);
    expect(s.sim.time).toBeGreaterThanOrEqual(PHASES.coreGrowFrom);
    expect(s.sim.time).toBeLessThan(PHASES.coreGrowFrom + 1);
    expect(s.sim.phase).toBe(1);
    s.skipTo(PHASES.phase2At - 0.3);
    expect(s.sim.phase).toBe(1);
    expect(s.transitLeft).toBe(0);
    s.skipTo(0, true);
    expect(s.sim.phase).toBe(2);
    expect(s.transitLeft).toBe(0);
    expect(s.sim.state).toBe('running');
    expect(s.skipping).toBe(false);
    expect(s.summary().test).toBe(true);
    // Les sauts ne produisent aucune progression réelle
    const save = defaultSave();
    const before = JSON.stringify(save);
    applyRun(save, s.summary());
    expect(JSON.stringify(save)).toBe(before);
  });

  it('déclencher un obstacle marque la partie comme test même sans le mode à l’origine', () => {
    const s = new GameSession({ mode: 'survival', seed: 7, bonus: false });
    s.sim.injectPattern('shot');
    expect(s.sim.assisted).toBe(true); // jamais éligible
    s.markTest();
    expect(s.summary().test).toBe(true);
  });

  it('effets décoratifs demandés à la main : appliqués à l’image suivante, jamais lus par la simulation', () => {
    const d = new AmbienceDirector(() => 0.99);
    const silent = { active: false, track: null, bass: 0, intensity: 0, beat: 0, drop: false, build: 0 } as const;
    d.trigger('bolt');
    d.trigger('wave');
    const st = d.update(10, 1 / 60, { ...silent }, false);
    expect(st.spawnArcs).toBeGreaterThanOrEqual(2);
    expect(st.spawnWave).toBeGreaterThan(0);
    expect(d.update(10, 1 / 60, { ...silent }, false).spawnArcs).toBe(0);
  });
});

describe('records locaux : copie préalable puis effacement des seuls records', () => {
  it('conserve profil, monnaies, succès et options ; la copie contient les records effacés', () => {
    const save = defaultSave();
    save.survival = { bestTime: 321.5, bestScore: 1234, runs: 9 };
    save.survivalBonus = { bestTime: 100, bestScore: 50, runs: 2 };
    save.daily = { '2026-10-10': { bestTime: 60, bestScore: 10, runs: 1 } };
    save.wallet.shards = 777;
    save.owned = [...save.owned, 'chantier-orbital'];
    save.options.visualIntensity = 0.5;
    const others = JSON.stringify({ ...save, survival: 0, survivalBonus: 0, daily: 0 });
    const mem = new Map<string, string>();
    const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v), remove: (k: string) => void mem.delete(k) };
    expect(hasRecords(save)).toBe(true);
    const idx: string[] = [];
    const key = backupRecords(store, snapshotRecords(save, 1_700_000_000_000), idx);
    expect(key).not.toBeNull();
    clearRecords(save);
    expect(hasRecords(save)).toBe(false);
    expect(JSON.stringify({ ...save, survival: 0, survivalBonus: 0, daily: 0 })).toBe(others);
    const copy = JSON.parse(store.get(key!)!) as { survival: { bestTime: number }; daily: Record<string, unknown> };
    expect(copy.survival.bestTime).toBe(321.5);
    expect(Object.keys(copy.daily)).toEqual(['2026-10-10']);
  });

  it('stockage qui refuse l’écriture : aucune copie, donc rien n’est effacé par l’application', () => {
    const store = { get: () => null, set: () => undefined, remove: () => undefined, failed: true };
    expect(backupRecords(store, snapshotRecords(defaultSave()), [])).toBeNull();
  });

  it('seules trois copies sont conservées', () => {
    const mem = new Map<string, string>();
    const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v), remove: (k: string) => void mem.delete(k) };
    const idx: string[] = [];
    for (let i = 0; i < 5; i++) backupRecords(store, snapshotRecords(defaultSave(), 1_700_000_000_000 + i * 1000), idx);
    expect(idx).toHaveLength(3);
    expect(mem.size).toBe(3);
  });
});

describe('classements : version actuelle seulement, remise à zéro mondiale sans secret dans le jeu', () => {
  const view = { configured: true, identity: null, loading: false, error: null, top: null, me: null, balance: BALANCE_VERSION, category: 'plain' as const, pending: [], nickMessage: null, localBest: null, balances: { current: BALANCE_VERSION, versions: [{ balance: BALANCE_VERSION - 1, players: 3 }] } };

  it('aucun sélecteur de version ni accès aux anciens classements, même si le service en connaît', () => {
    const html = leaderboardScreen(view);
    expect(html).not.toContain('lb-balance');
    expect(html).not.toMatch(/ancien|Version d’équilibrage/i);
    expect(html).toContain('Sans bonus');
    expect(html).toContain('Avec bonus');
    const src = readFileSync('src/app.ts', 'utf8');
    expect(src).not.toContain('lb-balance');
    expect(src).not.toContain('lbBalance');
  });

  it('diagnostic du classement et remise à zéro : autorisation dans l’en-tête, jamais stockée ni dans le corps', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mem = new Map<string, string>();
    const client = new LeaderboardClient({
      baseUrl: 'https://service.exemple.net',
      balance: BALANCE_VERSION,
      build: 't',
      store: { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v), remove: (k: string) => void mem.delete(k) },
      fetchFn: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ ok: true, board: 'plain', removed: 2, backup: 'x.sqlite' }) } as Response;
      }) as unknown as typeof fetch,
    } as never);
    const d = client.diagnostics();
    expect(d.configured).toBe(true);
    expect(d.tickets).toBe(0);
    expect(d.lastRefusal).toBeNull();
    const r = await client.adminResetBoard('plain', 'une-autorisation-administrateur-de-test', 'REMETTRE À ZÉRO');
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('https://service.exemple.net/api/admin/reset-board');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer une-autorisation-administrateur-de-test');
    expect(String(calls[0].init.body)).not.toContain('autorisation-administrateur');
    expect([...mem.values()].join('')).not.toContain('autorisation-administrateur');
  });

  it('aucune autorisation administrateur ni code de remise à zéro serveur dans le code du jeu (hors « serveur »)', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(pjoin(dir, f)).isDirectory() ? walk(pjoin(dir, f)) : f.endsWith('.ts') ? [pjoin(dir, f)] : []));
    for (const f of walk('src')) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/ADMIN_RESET_SECRET|server\/boards|from '\.\.\/server/);
    }
  });
});
