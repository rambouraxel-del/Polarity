import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import { dailySeed, formatDateFr, utcDateString } from '../src/modes/daily';
import { createSimulation } from '../src/modes/run';
import { applyRun, beatsRecord, isLevelUnlocked, starsFor } from '../src/progression/progress';
import { BALANCE_VERSION } from '../src/config/version';
import { hasLegacyRecords, legacyDailyList, legacySurvivalBest } from '../src/progression/progress';
import { BACKUP_PREFIX, BALANCE_BACKUP_PREFIX, CORRUPT_KEY, defaultSave, eraseAll, loadSave, MemoryStore, SAVE_KEY, SAVE_VERSION, writeSave } from '../src/save/save';

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
    const refuse = () => { throw new Error('refus'); };
    const broken = { get: refuse, set: refuse, remove: refuse };
    expect(() => writeSave(broken, defaultSave())).not.toThrow();
  });
});

/** Sauvegarde telle que l'écrivait la v1.0 (format 1, sans notion d'équilibrage). */
const V1_SAVE = {
  version: 1,
  levels: { '1': { completed: true, bestScore: 52000, stars: 2 }, '2': { completed: true, bestScore: 41000, stars: 1 } },
  survival: { bestTime: 312.4, bestScore: 88000, runs: 14 },
  daily: { '2026-10-09': { bestTime: 95.5, bestScore: 20000, runs: 3 }, '2026-10-10': { bestTime: 140.2, bestScore: 31000, runs: 2 } },
  achievements: { first_cycle: 1700000000000, first_level: 1700000100000, survive_60: 1700000200000 },
  skin: 'aurore',
  options: { muted: true, volume: 0.4, reducedEffects: true, tutorialSeen: true },
  seenIntros: ['projectile', 'sector'],
  stats: { totalCycles: 42, totalRuns: 30 },
};

describe('Migration de la sauvegarde v1.0 → v1.1', () => {
  const load = () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(V1_SAVE));
    return { store, res: loadSave(store) };
  };

  it('préserve la progression : niveaux, étoiles, succès, apparence, options, statistiques', () => {
    const { res } = load();
    expect(res.status).toBe('migrated');
    expect(res.data.version).toBe(SAVE_VERSION);
    expect(res.data.levels).toEqual(V1_SAVE.levels);
    expect(res.data.achievements).toEqual(V1_SAVE.achievements);
    expect(res.data.skin).toBe('aurore');
    // Les réglages de l'ancienne sauvegarde sont conservés ; les nouveaux (mixage musique/effets, intensité visuelle) prennent leur valeur par défaut
    expect(res.data.options).toEqual({ ...V1_SAVE.options, musicVolume: 1, sfxVolume: 1, visualIntensity: 1 });
    expect(res.data.seenIntros).toEqual(V1_SAVE.seenIntros);
    expect(res.data.stats).toMatchObject(V1_SAVE.stats);
    expect(isLevelUnlocked(res.data, 3)).toBe(true);
  });

  it('range les anciens records à part : les records actuels repartent de zéro', () => {
    const { res } = load();
    expect(res.data.balance).toBe(BALANCE_VERSION);
    expect(res.data.survival).toEqual({ bestTime: 0, bestScore: 0, runs: 0 });
    expect(res.data.daily).toEqual({});
    expect(res.data.archive['1'].survival).toEqual(V1_SAVE.survival);
    expect(res.data.archive['1'].daily).toEqual(V1_SAVE.daily);
    expect(hasLegacyRecords(res.data)).toBe(true);
    expect(legacySurvivalBest(res.data)).toEqual({ version: 1, time: 312.4, score: 88000 });
    expect(legacyDailyList(res.data).map((d) => d.date)).toEqual(['2026-10-10', '2026-10-09']);
    // L'information sur le nouvel équilibrage reste à lire
    expect(res.data.balanceNoticeSeen).toBeLessThan(BALANCE_VERSION);
  });

  it('conserve une copie de l’ancienne sauvegarde, sans jamais l’écraser', () => {
    const { store } = load();
    const backup = store.get(`${BACKUP_PREFIX}1`);
    expect(backup).not.toBeNull();
    expect(JSON.parse(backup as string)).toEqual(V1_SAVE);
    // Seconde lecture d'une sauvegarde déjà migrée : la copie reste celle d'origine
    const res = loadSave(store);
    writeSave(store, res.data);
    loadSave(store);
    expect(JSON.parse(store.get(`${BACKUP_PREFIX}1`) as string)).toEqual(V1_SAVE);
  });

  it('un record sous le nouvel équilibrage n’est jamais comparé à l’ancien', () => {
    const { res } = load();
    // 20 s : bien en dessous de l'ancien record (312 s), mais c'est un record sous le nouvel équilibrage
    const rep = applyRun(res.data, { mode: 'survival', time: 20, score: 3000, cycles: 0, bestMultiplier: 1, outcome: 'dead' });
    expect(rep.newRecord).toBe(true);
    expect(rep.previousBestTime).toBe(0);
    expect(rep.legacyBestTime).toBeCloseTo(312.4);
    expect(res.data.survival.bestTime).toBe(20);
    expect(res.data.archive['1'].survival.bestTime).toBe(312.4);
    // Défi : l'ancien résultat de la même date reste à part
    const d = applyRun(res.data, { mode: 'daily', date: '2026-10-10', time: 15, score: 1, cycles: 0, bestMultiplier: 1, outcome: 'dead' });
    expect(d.newRecord).toBe(true);
    expect(d.legacyBestTime).toBeCloseTo(140.2);
    expect(res.data.daily['2026-10-10'].bestTime).toBe(15);
    expect(res.data.archive['1'].daily['2026-10-10'].bestTime).toBe(140.2);
  });

  it('la migration est stable : une sauvegarde déjà migrée se relit à l’identique', () => {
    const { store, res } = load();
    applyRun(res.data, { mode: 'survival', time: 50, score: 100, cycles: 0, bestMultiplier: 1, outcome: 'dead' });
    writeSave(store, res.data);
    const again = loadSave(store);
    expect(again.status).toBe('ok');
    expect(again.data).toEqual(res.data);
  });

  it('une sauvegarde v1 sans records de Survie ne déclenche pas d’information inutile', () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify({ version: 1, levels: { '1': { completed: true, bestScore: 1, stars: 0 } } }));
    const res = loadSave(store);
    expect(hasLegacyRecords(res.data)).toBe(false);
    expect(res.data.levels['1'].completed).toBe(true);
  });

  it('un nouveau joueur n’a rien à migrer', () => {
    const res = loadSave(new MemoryStore());
    expect(res.status).toBe('new');
    expect(res.data.balance).toBe(BALANCE_VERSION);
    expect(res.data.balanceNoticeSeen).toBe(BALANCE_VERSION);
  });

  it('l’effacement explicite supprime aussi les copies', () => {
    const { store } = load();
    eraseAll(store);
    expect(store.get(SAVE_KEY)).toBeNull();
    expect(store.get(`${BACKUP_PREFIX}1`)).toBeNull();
  });

  it('une sauvegarde v1 abîmée garde ses parties valides et ne bloque pas le démarrage', () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify({ ...V1_SAVE, survival: 'oups', daily: [1, 2], levels: { '1': { completed: true, bestScore: 5, stars: 3 }, zz: 1 } }));
    const res = loadSave(store);
    expect(res.status).toBe('migrated');
    expect(res.data.levels['1'].stars).toBe(3);
    expect(res.data.skin).toBe('aurore');
    expect(res.data.survival.bestTime).toBe(0);
  });
});

/** Sauvegarde telle que l'écrivait la v1.1 (format 2, équilibrage 2) : avec des records archivés de la v1.0. */
const V2_SAVE = {
  version: 2,
  balance: 2,
  levels: { '1': { completed: true, bestScore: 60000, stars: 3 }, '2': { completed: true, bestScore: 50000, stars: 2 }, '3': { completed: true, bestScore: 1, stars: 0 } },
  survival: { bestTime: 188.2, bestScore: 64000, runs: 9 },
  daily: { '2026-10-11': { bestTime: 77.7, bestScore: 15000, runs: 2 } },
  archive: { '1': { survival: { bestTime: 312.4, bestScore: 88000, runs: 14 }, daily: { '2026-10-10': { bestTime: 140.2, bestScore: 31000, runs: 2 } } } },
  balanceNoticeSeen: 2,
  achievements: { first_cycle: 1, first_level: 2, survive_60: 3, max_combo: 4 },
  skin: 'glace',
  options: { muted: false, volume: 0.9, reducedEffects: true, tutorialSeen: true },
  seenIntros: ['projectile', 'sector', 'combo'],
  stats: { totalCycles: 77, totalRuns: 51 },
};

describe('Migration de la sauvegarde v1.1 → v1.2 (équilibrage 3)', () => {
  const load = () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(V2_SAVE));
    return { store, res: loadSave(store) };
  };

  it('préserve la progression : niveaux, étoiles, succès, apparence, options, introductions déjà vues', () => {
    const { res } = load();
    expect(res.status).toBe('migrated');
    expect(res.data.levels).toEqual(V2_SAVE.levels);
    expect(res.data.achievements).toEqual(V2_SAVE.achievements);
    expect(res.data.skin).toBe('glace');
    expect(res.data.options).toEqual({ ...V2_SAVE.options, musicVolume: 1, sfxVolume: 1, visualIntensity: 1 });
    expect(res.data.seenIntros).toEqual(V2_SAVE.seenIntros);
    expect(res.data.stats).toMatchObject(V2_SAVE.stats);
    expect(isLevelUnlocked(res.data, 4)).toBe(true);
  });

  it('distingue la nouvelle version d’équilibrage : records de la v1.1 archivés, ceux de la v1.0 intacts', () => {
    const { res } = load();
    expect(res.data.balance).toBe(BALANCE_VERSION);
    expect(BALANCE_VERSION).toBe(3);
    expect(res.data.survival).toEqual({ bestTime: 0, bestScore: 0, runs: 0 });
    expect(res.data.daily).toEqual({});
    expect(res.data.archive['2'].survival).toEqual(V2_SAVE.survival);
    expect(res.data.archive['2'].daily).toEqual(V2_SAVE.daily);
    expect(res.data.archive['1']).toEqual(V2_SAVE.archive['1']);
    // Meilleur ancien record (indicatif) : celui de la v1.0 ; défis : triés par date, toutes versions confondues
    expect(legacySurvivalBest(res.data)?.time).toBeCloseTo(312.4);
    expect(legacyDailyList(res.data).map((d) => d.date)).toEqual(['2026-10-11', '2026-10-10']);
    expect(res.data.balanceNoticeSeen).toBeLessThan(BALANCE_VERSION);
  });

  it('copie de l’ancienne sauvegarde conservée, sans écrasement', () => {
    const { store } = load();
    expect(JSON.parse(store.get(`${BALANCE_BACKUP_PREFIX}2`) as string)).toEqual(V2_SAVE);
    const res = loadSave(store);
    writeSave(store, res.data);
    loadSave(store);
    expect(JSON.parse(store.get(`${BALANCE_BACKUP_PREFIX}2`) as string)).toEqual(V2_SAVE);
  });

  it('un nouveau record n’est pas comparé aux anciens ; la sauvegarde migrée se relit à l’identique', () => {
    const { store, res } = load();
    const rep = applyRun(res.data, { mode: 'survival', time: 15, score: 900, cycles: 0, bestMultiplier: 1, outcome: 'dead' });
    expect(rep.newRecord).toBe(true);
    expect(rep.previousBestTime).toBe(0);
    expect(res.data.archive['2'].survival.bestTime).toBe(188.2);
    writeSave(store, res.data);
    const again = loadSave(store);
    expect(again.status).toBe('ok');
    expect(again.data).toEqual(res.data);
  });

  it('une sauvegarde déjà à l’équilibrage actuel n’est pas modifiée', () => {
    const store = new MemoryStore();
    const save = defaultSave();
    save.survival.bestTime = 42;
    writeSave(store, save);
    const res = loadSave(store);
    expect(res.status).toBe('ok');
    expect(res.data.survival.bestTime).toBe(42);
    expect(Object.keys(res.data.archive)).toHaveLength(0);
  });

  it('l’effacement explicite supprime aussi ces copies', () => {
    const { store } = load();
    eraseAll(store);
    expect(store.get(`${BALANCE_BACKUP_PREFIX}2`)).toBeNull();
    expect(store.get(SAVE_KEY)).toBeNull();
  });
});
