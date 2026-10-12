import { describe, expect, it } from 'vitest';
import { activeUpgrades, applyMission, buyUpgrade, isMissionUnlocked, isUpgradeVisible, markSeen, missionStars, toggleUpgrade, totalStars } from '../src/campaign/progress';
import type { MissionReport } from '../src/campaign/simulation';
import { CAMPAIGN_REWARDS, MISSIONS, UPGRADES } from '../src/config/campaign';
import { STORY } from '../src/config/story';
import { itemState, isOwned } from '../src/progression/shop';
import { resolveEquipped } from '../src/progression/skins';
import { BACKUP_PREFIX, MemoryStore, SAVE_KEY, SAVE_VERSION, defaultSave, eraseAll, loadSave, sanitize } from '../src/save/save';
import { catalogItem } from '../src/config/catalog';

const report = (missionId: number, over: Partial<MissionReport> = {}, stars?: Partial<MissionReport['stars']>): MissionReport => ({
  missionId,
  outcome: 'success',
  time: 30,
  beacons: 6,
  cycles: 0,
  maxMultiplier: 1,
  shieldUsed: false,
  objectsCollected: 0,
  objectsMissed: 0,
  stars: { main: true, challenge: false, noShield: true, ...stars },
  ...over,
});
const failed = (id: number): MissionReport => report(id, { outcome: 'failure' }, { main: false, challenge: false, noShield: false });

describe('progression de campagne', () => {
  it('seule la mission 1 est ouverte ; la suivante s’ouvre à la réussite (aucun score minimal)', () => {
    const s = defaultSave();
    expect(isMissionUnlocked(s, 1)).toBe(true);
    expect(isMissionUnlocked(s, 2)).toBe(false);
    const r = applyMission(s, report(1));
    expect(r.unlockedMission).toBe(2);
    expect(isMissionUnlocked(s, 2)).toBe(true);
    expect(isMissionUnlocked(s, 3)).toBe(false);
  });

  it('un échec ne verse rien, ne débloque rien, ne retire rien', () => {
    const s = defaultSave();
    applyMission(s, report(1, {}, { challenge: true }));
    const wallet = s.wallet.shards;
    const stars = missionStars(s, 1);
    const r = applyMission(s, failed(1));
    expect(r.rewards.total).toBe(0);
    expect(s.wallet.shards).toBe(wallet);
    expect(missionStars(s, 1)).toBe(stars);
    const t = defaultSave();
    expect(applyMission(t, failed(1)).unlockedMission).toBeNull();
    expect(isMissionUnlocked(t, 2)).toBe(false);
  });

  it('1re réussite : 30 Éclats + 10 par étoile secondaire nouvelle ; jamais deux fois', () => {
    const s = defaultSave();
    const a = applyMission(s, report(1, {}, { challenge: true, noShield: true }));
    expect(a.rewards.firstClear).toBe(CAMPAIGN_REWARDS.firstClear);
    expect(a.rewards.total).toBe(30 + 20);
    expect(s.wallet.shards).toBe(50);
    expect(missionStars(s, 1)).toBe(3);
    // Même résultat rejoué : seulement le bonus de répétition
    const b = applyMission(s, report(1, {}, { challenge: true, noShield: true }));
    expect(b.rewards.total).toBe(CAMPAIGN_REWARDS.repeat);
    expect(s.wallet.shards).toBe(55);
  });

  it('une étoile secondaire obtenue plus tard est payée une seule fois', () => {
    const s = defaultSave();
    applyMission(s, report(2, {}, { challenge: false, noShield: false }));
    const first = s.wallet.shards;
    expect(first).toBe(30);
    const r = applyMission(s, report(2, {}, { challenge: true, noShield: false }));
    expect(r.newStars.challenge).toBe(true);
    expect(s.wallet.shards).toBe(first + 10 + 5);
    const again = applyMission(s, report(2, {}, { challenge: true, noShield: false }));
    expect(again.newStars.challenge).toBe(false);
    expect(s.wallet.shards).toBe(first + 15 + 5);
  });

  it('dernière mission : 60 Éclats, chapitre terminé, apparence Écho débloquée une seule fois', () => {
    const s = defaultSave();
    expect(isOwned(s, 'echo')).toBe(false);
    expect(itemState(s, catalogItem('echo')!)).toBe('campaign');
    expect(resolveEquipped('echo', s).id).toBe('classique');
    const r = applyMission(s, report(10, {}, { noShield: false }));
    expect(r.rewards.firstClear).toBe(CAMPAIGN_REWARDS.finalFirstClear);
    expect(r.chapterCompleted).toBe(true);
    expect(isOwned(s, 'echo')).toBe(true);
    expect(resolveEquipped('echo', s).id).toBe('echo');
    expect(applyMission(s, report(10)).chapterCompleted).toBe(false);
  });

  it('les étoiles : 3 par mission, 30 au total', () => {
    const s = defaultSave();
    for (const m of MISSIONS) applyMission(s, report(m.id, {}, { challenge: true, noShield: true }));
    expect(totalStars(s)).toBe(30);
  });

  it('transmissions : lues une seule fois, identifiants inconnus ignorés', () => {
    const s = defaultSave();
    const id = STORY[0].id;
    expect(markSeen(s, id)).toBe(true);
    expect(markSeen(s, id)).toBe(false);
    expect(markSeen(s, 'inexistante')).toBe(false);
    expect(s.campaign.seen).toEqual([id]);
  });
});

describe('hangar', () => {
  it('présentation après la mission requise ; achat en Éclats sans double débit', () => {
    const s = defaultSave();
    s.wallet.shards = 1000;
    const shield = UPGRADES.find((u) => u.id === 'shield')!;
    expect(isUpgradeVisible(s, shield)).toBe(false);
    expect(buyUpgrade(s, 'shield')).toEqual({ ok: false, reason: 'locked' });
    for (let i = 1; i <= shield.unlockAfter; i++) applyMission(s, report(i));
    const before = s.wallet.shards;
    expect(isUpgradeVisible(s, shield)).toBe(true);
    const r = buyUpgrade(s, 'shield');
    expect(r.ok).toBe(true);
    expect(s.wallet.shards).toBe(before - shield.price);
    expect(buyUpgrade(s, 'shield')).toEqual({ ok: false, reason: 'owned' });
    expect(s.wallet.shards).toBe(before - shield.price);
  });

  it('solde insuffisant : rien n’est débité', () => {
    const s = defaultSave();
    for (let i = 1; i <= 3; i++) applyMission(s, report(i));
    s.wallet.shards = 99;
    expect(buyUpgrade(s, 'shield')).toEqual({ ok: false, reason: 'insufficient' });
    expect(s.wallet.shards).toBe(99);
    expect(s.campaign.upgrades.owned).toEqual([]);
  });

  it('activation / désactivation ; seules les améliorations possédées et activées s’appliquent', () => {
    const s = defaultSave();
    for (let i = 1; i <= 3; i++) applyMission(s, report(i));
    s.wallet.shards = 500;
    expect(toggleUpgrade(s, 'shield')).toBeNull();
    buyUpgrade(s, 'shield');
    expect(activeUpgrades(s).shield).toBe(true);
    expect(toggleUpgrade(s, 'shield')).toBe(false);
    expect(activeUpgrades(s)).toEqual({ shield: false, collector: false, stabilizer: false });
    expect(toggleUpgrade(s, 'shield')).toBe(true);
    expect(activeUpgrades(s).shield).toBe(true);
  });
});

describe('sauvegarde v5', () => {
  const v4 = {
    version: 4,
    balance: 3,
    levels: { '1': { completed: true, bestScore: 1200, stars: 2 } },
    survival: { bestTime: 123.4, bestScore: 5000, runs: 7 },
    daily: {},
    archive: {},
    balanceNoticeSeen: 3,
    achievements: { first_cycle: 1 },
    skin: 'aurore',
    trail: 'auto',
    wallet: { shards: 321, prisms: 4 },
    owned: ['aurore'],
    paid: { '1': { first: true, stars: 2 } },
    options: { muted: true, volume: 0.3, reducedEffects: false, tutorialSeen: true },
    seenIntros: [],
    stats: { totalCycles: 10, totalRuns: 3, totalShards: 5, totalEvents: 1, bestScore: 1200, bestMultiplier: 4 },
    rewarded: ['first_cycle'],
    rewardNotice: null,
  };

  it('migration v4 → v5 : tout est conservé, campagne vide, copie de sauvegarde', () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(v4));
    const { data, status } = loadSave(store);
    expect(status).toBe('migrated');
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.wallet).toEqual({ shards: 321, prisms: 4 });
    expect(data.survival.bestTime).toBe(123.4);
    expect(data.skin).toBe('aurore');
    expect(data.owned).toEqual(['aurore']);
    expect(data.rewarded).toEqual(['first_cycle']);
    expect(data.levels['1'].stars).toBe(2);
    expect(data.campaign).toEqual({ missions: {}, seen: [], upgrades: { owned: [], enabled: [] }, chapterComplete: false });
    expect(store.get(`${BACKUP_PREFIX}4`)).toBe(JSON.stringify(v4));
  });

  it('champ campagne corrompu : valeurs valides conservées, le reste ignoré', () => {
    const data = sanitize({
      ...v4,
      version: 5,
      campaign: {
        missions: { '1': { main: true, challenge: true, noShield: 'x', clears: 3, bestTime: 20 }, '99': { main: true }, '2': { main: false, challenge: true } },
        seen: ['a', 3, 'a', 'b'],
        upgrades: { owned: ['shield', 'inconnue'], enabled: ['shield', 'collector'] },
        chapterComplete: 'oui',
      },
    });
    expect(data.campaign.missions['1']).toEqual({ main: true, challenge: true, noShield: false, clears: 3, bestTime: 20 });
    expect(data.campaign.missions['99']).toBeUndefined();
    expect(data.campaign.missions['2'].challenge).toBe(false);
    expect(data.campaign.seen).toEqual(['a', 'b']);
    expect(data.campaign.upgrades).toEqual({ owned: ['shield'], enabled: ['shield'] });
    expect(data.campaign.chapterComplete).toBe(false);
  });

  it('effacement explicite : supprime aussi la copie v4', () => {
    const store = new MemoryStore();
    store.set(`${BACKUP_PREFIX}4`, 'x');
    eraseAll(store);
    expect(store.get(`${BACKUP_PREFIX}4`)).toBeNull();
  });
});
