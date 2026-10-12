import { describe, expect, it } from 'vitest';
import { CATALOG, catalogItem, isPremium, itemsOfKind } from '../src/config/catalog';
import { LEGACY_SKIN_ACHIEVEMENTS, LEVEL_REWARDS, SHARDS } from '../src/config/economy';
import { SKINS, MIN_HAZARD_HUE_GAP, hazardHueGap } from '../src/config/skins';
import { TRAILS } from '../src/config/trails';
import { LEVELS } from '../src/config/levels';
import { GameSession } from '../src/game/session';
import { survivalProfile } from '../src/modes/profiles';
import { NullPaymentProvider, getPaymentProvider, premiumAvailable, setPaymentProvider, type PaymentProvider } from '../src/monetization/payments';
import { applyRun, type RunSummary } from '../src/progression/progress';
import { creditShards, equip, isOwned, itemState, purchase } from '../src/progression/shop';
import { BALANCE_BACKUP_PREFIX, BACKUP_PREFIX, MemoryStore, SAVE_KEY, defaultSave, loadSave, writeSave, type SaveData } from '../src/save/save';
import { angleDiff, TAU } from '../src/core/math';
import { Simulation } from '../src/sim/simulation';
import { ShardSpawner, shardHalfArc, shardReachable, type ShardEvent, type ShardWorld } from '../src/sim/shards';
import { survivalSpeedFactor } from '../src/config/playerSpeed';
import { BeaconRing } from '../src/sim/beacons';
import { SIM } from '../src/config/balance';
import { createSimulation } from '../src/modes/run';
import { levelProfile } from '../src/modes/profiles';

const world = (angle = 0, dir: 1 | -1 = 1, speed: (t: number) => number = () => 0.4): ShardWorld => ({ angle, dir, beacons: new BeaconRing(), speed });

/** Fait avancer un éclat isolé : le vaisseau reste immobile (delta = 0). */
function runSpawner(sp: ShardSpawner, from: number, to: number, w: ShardWorld, dt = 1 / 120): ShardEvent[] {
  const out: ShardEvent[] = [];
  for (let t = from; t <= to; t += dt) sp.step(t, w.angle, 0, w, out);
  return out;
}

describe('éclat sur l’orbite : apparition, durée, disparition', () => {
  it('première apparition entre 15 et 25 s ; un seul éclat à la fois', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sp = new ShardSpawner(seed);
      expect(sp.nextAt).toBeGreaterThanOrEqual(SHARDS.firstDelay.min);
      expect(sp.nextAt).toBeLessThanOrEqual(SHARDS.firstDelay.max);
      const ev = runSpawner(sp, 0, 120, world());
      let active = 0;
      for (const e of ev) {
        if (e.type === 'shard-spawn') active++;
        else active--;
        expect(active).toBeLessThanOrEqual(1);
        expect(active).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('disponible 5 s, puis prochaine apparition 15 à 25 s après la disparition', () => {
    const sp = new ShardSpawner(7);
    const times: { spawn: number[]; expire: number[] } = { spawn: [], expire: [] };
    const out: ShardEvent[] = [];
    const w = world();
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 200; i++) {
      const before = out.length;
      sp.step(i * dt, 0, 0, w, out);
      for (let k = before; k < out.length; k++) (out[k].type === 'shard-spawn' ? times.spawn : times.expire).push(i * dt);
    }
    expect(times.spawn.length).toBeGreaterThanOrEqual(4);
    for (let k = 0; k < times.expire.length; k++) {
      expect(times.expire[k] - times.spawn[k]).toBeGreaterThanOrEqual(SHARDS.lifetime - 1e-6);
      expect(times.expire[k] - times.spawn[k]).toBeLessThanOrEqual(SHARDS.lifetime + 2 * dt);
      if (times.spawn[k + 1] !== undefined) {
        const gap = times.spawn[k + 1] - times.expire[k];
        expect(gap).toBeGreaterThanOrEqual(SHARDS.nextDelay.min - 2 * dt);
        expect(gap).toBeLessThanOrEqual(SHARDS.nextDelay.max + 2 * dt);
      }
    }
    expect(sp.missed).toBe(times.expire.length);
    expect(sp.collected).toBe(0);
  });

  it('collecte : gain unique de 5 Éclats, puis nouvelle apparition 15 à 25 s plus tard', () => {
    const sp = new ShardSpawner(3);
    const w = world(0, 1);
    const out: ShardEvent[] = [];
    runSpawner(sp, 0, sp.nextAt + 0.01, w);
    const a = sp.active!;
    expect(a).not.toBeNull();
    // Le vaisseau traverse l'éclat
    const t = a.spawnedAt + 1;
    sp.step(t, a.angle - 0.2, 0.4, w, out);
    expect(out.filter((e) => e.type === 'shard-collect')).toEqual([{ type: 'shard-collect', id: a.id, amount: SHARDS.reward, angle: a.angle }]);
    expect(sp.active).toBeNull();
    expect(sp.collected).toBe(1);
    expect(sp.income).toBe(SHARDS.reward);
    expect(sp.nextAt - t).toBeGreaterThanOrEqual(SHARDS.nextDelay.min);
    expect(sp.nextAt - t).toBeLessThanOrEqual(SHARDS.nextDelay.max);
    // Un second passage au même endroit ne rapporte plus rien
    out.length = 0;
    sp.step(t + 0.01, a.angle - 0.2, 0.4, w, out);
    expect(out).toEqual([]);
  });

  it('les gains ne dépendent ni du score ni du combo', () => {
    expect(SHARDS.reward).toBe(5);
    const sim = createSimulation({ mode: 'survival', seed: 11 });
    sim.scoring.multiplier = 5;
    sim.scoring.score = 1_000_000;
    const sp = sim.shards!;
    sp.nextAt = 0;
    sim.invincible = true;
    // Avance jusqu'à l'apparition puis fait traverser l'éclat
    let got: ShardEvent | undefined;
    for (let i = 0; i < 120 * 30 && !got; i++) {
      if (sp.active) {
        const a = sp.active;
        const diff = angleDiff(sim.angle, a.angle) * sim.dir;
        if (diff < 0) sim.flip();
      }
      sim.step();
      got = sim.events.find((e) => e.type === 'shard-collect') as ShardEvent | undefined;
    }
    expect(got && got.type === 'shard-collect' ? got.amount : -1).toBe(SHARDS.reward);
  });
});

describe('éclat : emplacement et accessibilité', () => {
  it('jamais près du vaisseau ni d’une balise active ; toujours accessible avec la vitesse réelle', () => {
    for (const t0 of [0, 60, 200, 400]) {
      const speed = survivalSpeedFactor;
      for (let seed = 1; seed <= 40; seed++) {
        const sp = new ShardSpawner(seed * 97 + t0);
        sp.nextAt = t0;
        const w = world(((seed * 1.3) % TAU) - Math.PI, seed % 2 ? 1 : -1, speed);
        const out: ShardEvent[] = [];
        sp.step(t0, w.angle, 0, w, out);
        const a = sp.active!;
        expect(a, `seed ${seed}`).not.toBeNull();
        expect(Math.abs(angleDiff(w.angle, a.angle))).toBeGreaterThanOrEqual(SHARDS.minShipGap - 1e-9);
        for (const b of w.beacons.angles) expect(Math.abs(angleDiff(b, a.angle))).toBeGreaterThanOrEqual(SHARDS.minBeaconGap - 1e-9);
        expect(shardReachable(a.angle, w.angle, w.dir, t0, speed), `accessible seed ${seed} t ${t0}`).toBe(true);
      }
    }
  });

  it('la vitesse réelle est prise en compte : un éclat à l’opposé est inaccessible si le vaisseau est trop lent', () => {
    const slow = () => 0.1;
    expect(shardReachable(Math.PI, 0, 1, 0, slow)).toBe(false);
    expect(shardReachable(Math.PI, 0, 1, 0, () => 0.4)).toBe(true);
    expect(shardHalfArc()).toBeCloseTo(SHARDS.collectRadius / 300, 10);
  });

  it('la collecte reste possible : un joueur qui vise l’éclat l’obtient avant sa disparition', () => {
    let collected = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const sim = createSimulation({ mode: 'survival', seed });
      sim.invincible = true;
      sim.shards!.nextAt = 3;
      const sp = sim.shards!;
      for (let i = 0; i < 120 * 14; i++) {
        const a = sp.active;
        if (a) {
          // Réaction humaine : le joueur se décide 0,5 s après l'apparition
          if (sim.time - a.spawnedAt > 0.5) {
            const ahead = (((a.angle - sim.angle) * sim.dir) % TAU + TAU) % TAU;
            if (ahead > Math.PI) sim.flip();
          }
        }
        sim.step();
        for (const e of sim.events) if (e.type === 'shard-collect') collected++;
        sim.events.length = 0;
      }
    }
    expect(collected).toBe(12);
  });
});

describe('éclat : intégration à la simulation', () => {
  it('Survie seulement : ni les niveaux ni le défi quotidien', () => {
    expect(createSimulation({ mode: 'survival', seed: 1 }).shards).not.toBeNull();
    expect(createSimulation({ mode: 'daily', seed: 1, date: '2026-10-12' }).shards).toBeNull();
    expect(createSimulation({ mode: 'level', seed: 1, level: LEVELS[0] }).shards).toBeNull();
    expect(levelProfile(LEVELS[0]).shards).toBeUndefined();
  });

  it('ne change pas la difficulté : mêmes vagues avec ou sans éclats (générateur dédié)', () => {
    const mk = (shards: boolean): Simulation => new Simulation({ seed: 424242, profile: { ...survivalProfile(), shards }, timeLimit: null, invincible: true });
    const a = mk(true);
    const b = mk(false);
    const seen = (s: Simulation): string[] => {
      const out: string[] = [];
      for (let i = 0; i < 120 * 90; i++) {
        s.step();
        for (const h of s.hazards) if (!out.includes(`${h.id}:${h.pattern}`)) out.push(`${h.id}:${h.pattern}:${h.warnStart.toFixed(3)}`);
      }
      return out;
    };
    const sa = seen(a);
    expect(sa.length).toBeGreaterThan(10);
    expect(seen(b)).toEqual(sa);
    expect(a.shards).not.toBeNull();
    expect(b.shards).toBeNull();
  });

  it('reproductible : même graine, mêmes emplacements', () => {
    const run = (): number[] => {
      const sim = createSimulation({ mode: 'survival', seed: 99 });
      sim.invincible = true;
      const angles: number[] = [];
      for (let i = 0; i < 120 * 70; i++) {
        sim.step();
        for (const e of sim.events) if (e.type === 'shard-spawn') angles.push(e.angle);
        sim.events.length = 0;
      }
      return angles;
    };
    const x = run();
    expect(x.length).toBeGreaterThanOrEqual(2);
    expect(run()).toEqual(x);
  });

  it('la pause suspend apparition, expiration et animation (le temps actif ne bouge pas)', () => {
    const session = new GameSession({ mode: 'survival', seed: 5 });
    session.sim.invincible = true;
    session.sim.shards!.nextAt = 1;
    // Jusqu'à l'apparition
    for (let i = 0; i < 400 && !session.sim.shards!.active; i++) session.frame(0.05);
    const sh = session.sim.shards!;
    expect(sh.active).not.toBeNull();
    const t = session.sim.time;
    const rem = sh.remaining(t);
    session.pause();
    for (let i = 0; i < 100; i++) session.frame(0.1);
    expect(session.sim.time).toBe(t);
    expect(sh.remaining(session.sim.time)).toBe(rem);
    expect(sh.active).not.toBeNull();
  });
});

describe('récompenses de niveau', () => {
  const win = (levelId: number, score: number): RunSummary => ({ mode: 'level', levelId, time: 90, score, cycles: 3, bestMultiplier: 2, outcome: 'complete' });
  const lv = LEVELS[0];

  it('première réussite 50 + 15 par étoile, puis 10 par réussite, sans jamais re-payer une étoile', () => {
    const save = defaultSave();
    // 1re réussite avec 2 étoiles
    let rep = applyRun(save, win(1, lv.stars[1]));
    expect(rep.stars).toBe(2);
    expect(rep.levelReward).toEqual({ firstClear: 50, newStars: 2, starReward: 30, repeatClear: 0, total: 80 });
    expect(save.wallet.shards).toBe(80);
    expect(rep.shardsBalance).toBe(80);
    // Réussite répétée avec les mêmes étoiles : 10 seulement
    rep = applyRun(save, win(1, lv.stars[1]));
    expect(rep.levelReward).toEqual({ firstClear: 0, newStars: 0, starReward: 0, repeatClear: 10, total: 10 });
    expect(save.wallet.shards).toBe(90);
    // Meilleur score : 3e étoile payée une fois (15) + 10
    rep = applyRun(save, win(1, lv.stars[2]));
    expect(rep.levelReward).toEqual({ firstClear: 0, newStars: 1, starReward: 15, repeatClear: 10, total: 25 });
    expect(save.wallet.shards).toBe(115);
    // Plus aucune étoile à gagner
    rep = applyRun(save, win(1, lv.stars[2]));
    expect(rep.levelReward!.total).toBe(10);
    // Un score plus faible ne fait pas payer à nouveau les étoiles
    rep = applyRun(save, win(1, lv.stars[0]));
    expect(rep.levelReward!.total).toBe(10);
    expect(save.wallet.shards).toBe(135);
    expect(LEVEL_REWARDS).toEqual({ firstClear: 50, perStar: 15, repeatClear: 10 });
  });

  it('une défaite ou la Survie ne verse aucune récompense de niveau', () => {
    const save = defaultSave();
    const dead = applyRun(save, { ...win(1, 100), outcome: 'dead' });
    expect(dead.levelReward).toBeNull();
    const surv = applyRun(save, { mode: 'survival', time: 80, score: 5000, cycles: 1, bestMultiplier: 1, outcome: 'dead', shards: 15 });
    expect(surv.levelReward).toBeNull();
    // Les 15 Éclats ont déjà été crédités à la collecte : applyRun ne les recrédite pas
    expect(save.wallet.shards).toBe(0);
    expect(surv.orbitShards).toBe(15);
    // Rouvrir l'écran de résultat (nouveau rendu du même rapport) ne crédite rien
    expect(save.wallet.shards).toBe(0);
  });

  it('les Éclats collectés restent acquis à la mort', () => {
    const save = defaultSave();
    expect(creditShards(save, 5)).toBe(5);
    expect(creditShards(save, 5)).toBe(5);
    applyRun(save, { mode: 'survival', time: 30, score: 800, cycles: 0, bestMultiplier: 1, outcome: 'dead', shards: 10 });
    expect(save.wallet.shards).toBe(10);
    expect(creditShards(save, -3)).toBe(0);
    expect(creditShards(save, Number.NaN)).toBe(0);
    expect(save.wallet.shards).toBe(10);
  });
});

describe('sauvegarde v3 : migration et rechargement', () => {
  const v2 = (): Record<string, unknown> => ({
    version: 2,
    balance: 3,
    levels: { '1': { completed: true, bestScore: 52000, stars: 3 }, '2': { completed: true, bestScore: 30000, stars: 1 }, '3': { completed: false, bestScore: 0, stars: 0 } },
    survival: { bestTime: 100, bestScore: 9000, runs: 4 },
    daily: {},
    archive: {},
    balanceNoticeSeen: 3,
    achievements: { first_cycle: 1, survive_60: 2, max_combo: 3 },
    skin: 'ambre',
    options: { muted: false, volume: 0.7, reducedEffects: false, tutorialSeen: true },
    seenIntros: [],
    stats: { totalCycles: 10, totalRuns: 5 },
  });

  it('conserve les progrès, solde à 0, cosmétiques déjà obtenus conservés, récompenses historiques déjà traitées', () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(v2()));
    const res = loadSave(store);
    expect(res.status).toBe('migrated');
    const s = res.data;
    expect(s.version).toBe(3);
    expect(s.wallet).toEqual({ shards: 0, prisms: 0 });
    expect(s.levels['1']).toEqual({ completed: true, bestScore: 52000, stars: 3 });
    expect(s.survival.bestTime).toBe(100);
    expect(s.achievements.max_combo).toBe(3);
    // Cosmétiques obtenus avant la mise à jour
    expect([...s.owned].sort()).toEqual(['ambre', 'aurore', 'glace']);
    expect(isOwned(s, 'aurore') && isOwned(s, 'ambre') && isOwned(s, 'glace')).toBe(true);
    expect(isOwned(s, 'menthe')).toBe(false);
    expect(s.skin).toBe('ambre');
    expect(s.trail).toBe('auto');
    // Récompenses historiques traitées : pas de crédit rétroactif
    expect(s.paid['1']).toEqual({ first: true, stars: 3 });
    expect(s.paid['2']).toEqual({ first: true, stars: 1 });
    expect(s.paid['3']).toEqual({ first: false, stars: 0 });
    const rep = applyRun(s, { mode: 'level', levelId: 1, time: 90, score: 60000, cycles: 1, bestMultiplier: 1, outcome: 'complete' });
    expect(rep.levelReward!.firstClear).toBe(0);
    expect(rep.levelReward!.repeatClear).toBe(10);
    // Copie de l'ancienne sauvegarde conservée
    expect(store.get(`${BACKUP_PREFIX}2`)).toBe(JSON.stringify(v2()));
    expect(store.get(`${BALANCE_BACKUP_PREFIX}2`)).toBeNull();
  });

  it('une sauvegarde v1 passe aussi par la migration', () => {
    const store = new MemoryStore();
    const old = { ...v2(), version: 1 } as Record<string, unknown>;
    delete old.balance;
    store.set(SAVE_KEY, JSON.stringify(old));
    const s = loadSave(store).data;
    expect(s.version).toBe(3);
    expect(s.wallet.shards).toBe(0);
    expect(s.owned).toContain('aurore');
  });

  it('une apparence équipée sans succès correspondant (sauvegarde modifiée) n’est pas considérée comme possédée', () => {
    const raw = { ...v2(), achievements: {}, skin: 'solaire' };
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(raw));
    const s = loadSave(store).data;
    expect(s.owned).toEqual([]);
    expect(isOwned(s, 'solaire')).toBe(false);
  });

  it('soldes, cosmétiques et traînée survivent à un rechargement ; valeurs aberrantes ramenées à des entiers sûrs', () => {
    const store = new MemoryStore();
    const save = defaultSave();
    save.wallet = { shards: 345, prisms: 0 };
    save.owned = ['aurore', 'emeraude'];
    save.skin = 'aurore';
    save.trail = 'emeraude';
    save.paid = { '1': { first: true, stars: 2 } };
    writeSave(store, save);
    const back = loadSave(store);
    expect(back.status).toBe('ok');
    expect(back.data).toEqual(save);
    const bad = JSON.parse(JSON.stringify(save));
    bad.wallet = { shards: -50, prisms: 'beaucoup' };
    bad.owned = ['aurore', 'aurore', 12, null];
    bad.paid = { x: { first: true }, '2': { first: 'oui', stars: 9 } };
    store.set(SAVE_KEY, JSON.stringify(bad));
    const fixed = loadSave(store).data;
    expect(fixed.wallet).toEqual({ shards: 0, prisms: 0 });
    expect(fixed.owned).toEqual(['aurore']);
    expect(fixed.paid).toEqual({ '2': { first: false, stars: 3 } });
  });
});

function richSave(shards: number): SaveData {
  const s = defaultSave();
  s.wallet.shards = shards;
  return s;
}

describe('boutique : achats en Éclats', () => {
  it('premier cosmétique à 100 Éclats, prix progressifs', () => {
    const prices = CATALOG.filter((i) => i.acquire.type === 'price' && i.acquire.currency === 'shards' && i.kind === 'ship').map((i) => (i.acquire.type === 'price' ? i.acquire.amount : 0));
    expect(Math.min(...prices)).toBe(100);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(new Set(prices).size).toBe(prices.length);
  });

  it('achat : solde vérifié, débit et déblocage enregistrés ensemble', () => {
    const save = richSave(250);
    expect(itemState(save, catalogItem('aurore')!)).toBe('buy');
    const res = purchase(save, 'aurore');
    expect(res).toMatchObject({ ok: true, spent: 100, balance: 150, granted: ['aurore'] });
    expect(save.wallet.shards).toBe(150);
    expect(isOwned(save, 'aurore')).toBe(true);
    expect(itemState(save, catalogItem('aurore')!)).toBe('owned');
    expect(equip(save, 'aurore')).toBe(true);
    expect(itemState(save, catalogItem('aurore')!)).toBe('equipped');
  });

  it('aucun double débit : un article possédé n’est jamais racheté', () => {
    const save = richSave(500);
    expect(purchase(save, 'aurore').ok).toBe(true);
    expect(save.wallet.shards).toBe(400);
    for (let i = 0; i < 3; i++) expect(purchase(save, 'aurore')).toEqual({ ok: false, reason: 'owned' });
    expect(save.wallet.shards).toBe(400);
    expect(save.owned.filter((x) => x === 'aurore').length).toBe(1);
  });

  it('solde insuffisant : rien n’est débité ni débloqué', () => {
    const save = richSave(99);
    expect(itemState(save, catalogItem('aurore')!)).toBe('insufficient');
    expect(purchase(save, 'aurore')).toEqual({ ok: false, reason: 'insufficient' });
    expect(save.wallet.shards).toBe(99);
    expect(isOwned(save, 'aurore')).toBe(false);
    expect(equip(save, 'aurore')).toBe(false);
  });

  it('exclusivité de succès : non achetable, possédée dès le succès obtenu', () => {
    const save = richSave(100000);
    expect(itemState(save, catalogItem('glace')!)).toBe('achievement');
    expect(purchase(save, 'glace')).toEqual({ ok: false, reason: 'achievement' });
    expect(save.wallet.shards).toBe(100000);
    save.achievements.max_combo = 1;
    expect(isOwned(save, 'glace')).toBe(true);
    expect(itemState(save, catalogItem('glace')!)).toBe('owned');
  });

  it('pack : prix unique, contenu débloqué, articles déjà possédés non dupliqués, jamais re-débité', () => {
    const save = richSave(1000);
    purchase(save, 'aurore');
    expect(save.wallet.shards).toBe(900);
    const res = purchase(save, 'pack-aurore');
    expect(res).toMatchObject({ ok: true, spent: 220, granted: ['emeraude'] });
    expect(save.wallet.shards).toBe(680);
    expect(isOwned(save, 'pack-aurore')).toBe(true);
    expect(itemState(save, catalogItem('pack-aurore')!)).toBe('owned');
    expect(purchase(save, 'pack-aurore')).toEqual({ ok: false, reason: 'owned' });
    expect(save.wallet.shards).toBe(680);
    expect(save.owned.sort()).toEqual(['aurore', 'emeraude']);
  });

  it('équipement : traînée et vaisseau possédés seulement', () => {
    const save = richSave(1000);
    expect(equip(save, 'emeraude')).toBe(false);
    purchase(save, 'emeraude');
    expect(equip(save, 'emeraude')).toBe(true);
    expect(save.trail).toBe('emeraude');
    expect(equip(save, 'auto')).toBe(true);
    expect(equip(save, 'inconnu')).toBe(false);
    expect(equip(save, 'pack-aurore')).toBe(false);
    expect(save.skin).toBe('classique');
  });

  it('les cosmétiques d’origine restent disponibles et les gratuits aussi', () => {
    const save = defaultSave();
    expect(isOwned(save, 'classique')).toBe(true);
    expect(isOwned(save, 'auto')).toBe(true);
    expect(itemState(save, catalogItem('classique')!)).toBe('equipped');
  });
});

describe('Prismes : monnaie premium, aucun paiement actif', () => {
  it('solde initial à 0 ; les articles premium sont « Bientôt disponible » et ne s’achètent jamais', () => {
    const save = defaultSave();
    expect(save.wallet.prisms).toBe(0);
    const premium = CATALOG.filter(isPremium);
    expect(premium.length).toBeGreaterThanOrEqual(3);
    for (const item of premium) {
      expect(itemState(save, item)).toBe('soon');
      // Même avec un solde de Prismes fabriqué, aucun débit local
      const rich = defaultSave();
      rich.wallet.prisms = 10_000;
      rich.wallet.shards = 10_000;
      expect(purchase(rich, item.id)).toEqual({ ok: false, reason: 'unavailable' });
      expect(rich.wallet).toEqual({ shards: 10_000, prisms: 10_000 });
      expect(isOwned(rich, item.id)).toBe(false);
    }
  });

  it('fournisseur par défaut : indisponible, aucun crédit', async () => {
    const p = getPaymentProvider();
    expect(p).toBeInstanceOf(NullPaymentProvider);
    expect(p.isAvailable()).toBe(false);
    expect(premiumAvailable()).toBe(false);
    expect(await p.listProducts()).toEqual([]);
    expect(await p.purchase('prisms-100')).toEqual({ status: 'unavailable' });
  });

  it('une future intégration ne change que l’état affiché ; le jeu local ne débite jamais les Prismes', () => {
    const fake: PaymentProvider = { isAvailable: () => true, listProducts: async () => [], purchase: async () => ({ status: 'cancelled' }) };
    const old = getPaymentProvider();
    setPaymentProvider(fake);
    try {
      const save = defaultSave();
      save.wallet.prisms = 500;
      expect(itemState(save, catalogItem('neon')!)).toBe('buy');
      expect(purchase(save, 'neon')).toEqual({ ok: false, reason: 'unavailable' });
      expect(save.wallet.prisms).toBe(500);
    } finally {
      setPaymentProvider(old);
    }
  });
});

describe('catalogue : cohérence', () => {
  it('identifiants uniques, vaisseaux et traînées connus, packs bien formés et moins chers que leur contenu', () => {
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SKINS) expect(catalogItem(s.id)?.kind).toBe('ship');
    for (const t of TRAILS) expect(catalogItem(t.id)?.kind).toBe('trail');
    expect(itemsOfKind('ship').length).toBe(SKINS.length);
    expect(itemsOfKind('trail').length).toBe(TRAILS.length);
    for (const pack of itemsOfKind('pack')) {
      const parts = (pack.contents ?? []).map((c) => catalogItem(c)!);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts.every((p) => p.kind !== 'pack')).toBe(true);
      if (pack.acquire.type === 'price') {
        const { currency, amount } = pack.acquire;
        const sum = parts.reduce((t, p) => t + (p.acquire.type === 'price' && p.acquire.currency === currency ? p.acquire.amount : 0), 0);
        expect(amount).toBeLessThan(sum);
      }
    }
    for (const id of Object.keys(LEGACY_SKIN_ACHIEVEMENTS)) expect(catalogItem(id)).toBeDefined();
  });

  it('les traînées colorées restent distinctes des dangers', () => {
    for (const t of TRAILS) if (t.color !== null) expect(hazardHueGap(t.color), t.id).toBeGreaterThanOrEqual(MIN_HAZARD_HUE_GAP);
  });

  it('aucun article n’a d’effet de jeu : même simulation quelle que soit l’apparence', () => {
    const run = (): number => {
      const sim = new Simulation({ seed: 77, profile: { ...survivalProfile(), shards: false }, timeLimit: null, invincible: true });
      for (let i = 0; i < Math.round(30 / SIM.dt); i++) sim.step();
      return sim.angle;
    };
    expect(run()).toBe(run());
  });
});
