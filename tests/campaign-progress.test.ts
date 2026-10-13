import { describe, expect, it } from 'vitest';
import { activeUpgrades, applyMission, buyUpgrade, isMissionUnlocked, isUpgradeVisible, markSeen, missionStars, toggleUpgrade, totalStars } from '../src/campaign/progress';
import type { MissionReport } from '../src/campaign/simulation';
import { CAMPAIGN_REWARDS, HANGAR_ENABLED, MISSIONS, UPGRADES } from '../src/config/campaign';
import { STORY } from '../src/config/story';
import { BACKUP_PREFIX, MemoryStore, SAVE_KEY, SAVE_VERSION, defaultSave, eraseAll, loadSave, sanitize } from '../src/save/save';

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
  stars: { main: true, challenge: false, ...stars },
  ...over,
});
const failed = (id: number): MissionReport => report(id, { outcome: 'failure' }, { main: false, challenge: false });

describe('progression de campagne (niveaux 1 à 10)', () => {
  it('dix niveaux ; seul le niveau 1 est ouvert, le suivant s’ouvre à la réussite (aucun score minimal)', () => {
    expect(MISSIONS).toHaveLength(10);
    const s = defaultSave();
    expect(isMissionUnlocked(s, 1)).toBe(true);
    expect(isMissionUnlocked(s, 2)).toBe(false);
    const r = applyMission(s, report(1));
    expect(r.unlockedMission).toBe(2);
    expect(isMissionUnlocked(s, 2)).toBe(true);
    expect(isMissionUnlocked(s, 3)).toBe(false);
    expect(isMissionUnlocked(s, 6)).toBe(false);
    expect(isMissionUnlocked(s, 11)).toBe(false);
  });

  it('un échec ne verse rien, ne débloque rien, ne retire rien', () => {
    const s = defaultSave();
    applyMission(s, report(1, {}, { challenge: true }));
    const reserve = s.campaign.reserve;
    const stars = missionStars(s, 1);
    const r = applyMission(s, failed(1));
    expect(r.rewards.total).toBe(0);
    expect(s.campaign.reserve).toBe(reserve);
    expect(missionStars(s, 1)).toBe(stars);
    const t = defaultSave();
    expect(applyMission(t, failed(1)).unlockedMission).toBeNull();
    expect(isMissionUnlocked(t, 2)).toBe(false);
  });

  it('les gains vont à la réserve de campagne, jamais au portefeuille de la Survie, aux succès ni aux statistiques', () => {
    const s = defaultSave();
    s.wallet = { shards: 123, prisms: 4 };
    const before = JSON.stringify({ wallet: s.wallet, stats: s.stats, ach: s.achievements, rewarded: s.rewarded, survival: s.survival, owned: s.owned, skin: s.skin });
    const r = applyMission(s, report(1, { cycles: 12, maxMultiplier: 6 }, { challenge: true }));
    expect(r.rewards.total).toBe(CAMPAIGN_REWARDS.firstClear + CAMPAIGN_REWARDS.star);
    expect(s.campaign.reserve).toBe(r.rewards.total);
    expect(JSON.stringify({ wallet: s.wallet, stats: s.stats, ach: s.achievements, rewarded: s.rewarded, survival: s.survival, owned: s.owned, skin: s.skin })).toBe(before);
  });

  it('1re réussite : récompense unique ; rejouer ne verse rien de plus', () => {
    const s = defaultSave();
    const a = applyMission(s, report(1, {}, { challenge: true }));
    expect(a.rewards.firstClear).toBe(CAMPAIGN_REWARDS.firstClear);
    expect(s.campaign.reserve).toBe(CAMPAIGN_REWARDS.firstClear + CAMPAIGN_REWARDS.star);
    expect(missionStars(s, 1)).toBe(2);
    const b = applyMission(s, report(1, {}, { challenge: true }));
    expect(b.rewards.total).toBe(CAMPAIGN_REWARDS.repeat);
    expect(CAMPAIGN_REWARDS.repeat).toBe(0);
    expect(s.campaign.reserve).toBe(CAMPAIGN_REWARDS.firstClear + CAMPAIGN_REWARDS.star);
  });

  it('défi secondaire obtenu plus tard : payé une seule fois', () => {
    const s = defaultSave();
    applyMission(s, report(2));
    expect(s.campaign.reserve).toBe(CAMPAIGN_REWARDS.firstClear);
    const r = applyMission(s, report(2, {}, { challenge: true }));
    expect(r.newStars.challenge).toBe(true);
    expect(s.campaign.reserve).toBe(CAMPAIGN_REWARDS.firstClear + CAMPAIGN_REWARDS.star);
    const again = applyMission(s, report(2, {}, { challenge: true }));
    expect(again.newStars.challenge).toBe(false);
    expect(s.campaign.reserve).toBe(CAMPAIGN_REWARDS.firstClear + CAMPAIGN_REWARDS.star);
  });

  it('dernier niveau livré : « suite à venir », une seule fois ; aucun cosmétique n’est débloqué', () => {
    const s = defaultSave();
    for (let i = 1; i < 10; i++) applyMission(s, report(i));
    expect(s.campaign.chapterComplete).toBe(false);
    const r = applyMission(s, report(10));
    expect(r.chapterCompleted).toBe(true);
    expect(r.unlockedMission).toBeNull();
    expect(s.campaign.chapterComplete).toBe(true);
    expect(applyMission(s, report(10)).chapterCompleted).toBe(false);
    expect(s.owned).toEqual([]);
  });

  it('étoiles : 2 par niveau, 20 au total', () => {
    const s = defaultSave();
    for (const m of MISSIONS) applyMission(s, report(m.id, {}, { challenge: true }));
    expect(totalStars(s)).toBe(20);
  });

  it('scènes : lues une seule fois (automatiquement), identifiants inconnus ignorés', () => {
    const s = defaultSave();
    const id = STORY[0].id;
    expect(markSeen(s, id)).toBe(true);
    expect(markSeen(s, id)).toBe(false);
    expect(markSeen(s, 'inexistante')).toBe(false);
    expect(s.campaign.seen).toEqual([id]);
  });
});

describe('améliorations prévues pour la suite (hangar désactivé)', () => {
  it('rien n’est présenté ni appliqué tant que le hangar est fermé', () => {
    expect(HANGAR_ENABLED).toBe(false);
    const s = defaultSave();
    for (let i = 1; i <= 5; i++) applyMission(s, report(i));
    for (const u of UPGRADES) expect(isUpgradeVisible(s, u)).toBe(false);
    expect(buyUpgrade(s, 'shield')).toEqual({ ok: false, reason: 'locked' });
    s.campaign.upgrades = { owned: ['shield'], enabled: ['shield'] };
    expect(activeUpgrades(s)).toEqual({ shield: false, collector: false, stabilizer: false });
  });

  it('activation d’une amélioration possédée (logique conservée pour la suite)', () => {
    const s = defaultSave();
    expect(toggleUpgrade(s, 'shield')).toBeNull();
    s.campaign.upgrades.owned.push('shield');
    expect(toggleUpgrade(s, 'shield')).toBe(true);
    expect(s.campaign.upgrades.enabled).toEqual(['shield']);
    expect(toggleUpgrade(s, 'shield')).toBe(false);
  });
});

describe('sauvegarde v6', () => {
  const v5 = {
    version: 5,
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
    campaign: { missions: { '1': { main: true, challenge: true, noShield: true, clears: 3, bestTime: 20 } }, seen: ['m1-before'], upgrades: { owned: ['shield'], enabled: ['shield'] }, chapterComplete: false },
  };

  it('migration v5 → v6 : Survie, monnaies, succès, cosmétiques conservés ; campagne remise à neuf ; copie de sauvegarde', () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(v5));
    const { data, status } = loadSave(store);
    expect(status).toBe('migrated');
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.wallet).toEqual({ shards: 321, prisms: 4 });
    expect(data.survival.bestTime).toBe(123.4);
    expect(data.skin).toBe('aurore');
    expect(data.owned).toEqual(['aurore']);
    expect(data.rewarded).toEqual(['first_cycle']);
    expect(data.levels['1'].stars).toBe(2);
    expect(data.campaign).toEqual({ missions: {}, seen: [], reserve: 0, upgrades: { owned: [], enabled: [] }, chapterComplete: false });
    expect(store.get(`${BACKUP_PREFIX}5`)).toBe(JSON.stringify(v5));
  });

  it('migration v4 → v6 : pas de campagne, rien de perdu', () => {
    const { campaign: _omit, ...v4 } = { ...v5, version: 4 };
    void _omit;
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(v4));
    const { data } = loadSave(store);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.wallet.shards).toBe(321);
    expect(data.campaign.reserve).toBe(0);
  });

  it('anciennes missions terminées (clés 1 à 10, scènes m*) : la nouvelle histoire n’est ni terminée ni sautée, même sans migration', () => {
    const old = { ...v5, version: 6, campaign: { missions: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { main: true, challenge: true, clears: 2, bestTime: 30 }])), seen: ['m1-before', 'm1-after', 'm10-after'], reserve: 0, upgrades: { owned: [], enabled: [] }, chapterComplete: true } };
    const d = sanitize(old);
    expect(Object.keys(d.campaign.missions)).toEqual([]);
    expect(isMissionUnlocked(d, 1)).toBe(true);
    expect(isMissionUnlocked(d, 2)).toBe(false);
    expect(totalStars(d)).toBe(0);
    // Les anciens identifiants de scène ne comptent pas pour les nouvelles scènes : l'introduction du niveau 1 sera jouée
    expect(d.campaign.seen.includes('n1-before')).toBe(false);
    expect(markSeen(d, 'n1-before')).toBe(true);
  });

  it('une sauvegarde v6 est relue telle quelle', () => {
    const s = defaultSave();
    s.campaign.reserve = 40;
    s.campaign.seen = ['n1-before'];
    s.campaign.missions.n1 = { main: true, challenge: false, clears: 1, bestTime: 33 };
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(s));
    const r = loadSave(store);
    expect(r.status).toBe('ok');
    expect(r.data.campaign).toEqual(s.campaign);
  });

  it('champ campagne corrompu : valeurs valides conservées, le reste ignoré', () => {
    const data = sanitize({
      ...v5,
      version: 6,
      campaign: {
        missions: { n1: { main: true, challenge: true, clears: 3, bestTime: 20 }, n99: { main: true }, n2: { main: false, challenge: true }, '1': { main: true, challenge: true, clears: 9, bestTime: 1 } },
        seen: ['a', 3, 'a', 'b'],
        reserve: 55.9,
        upgrades: { owned: ['shield', 'inconnue'], enabled: ['shield', 'collector'] },
        chapterComplete: 'oui',
      },
    });
    expect(data.campaign.missions.n1).toEqual({ main: true, challenge: true, clears: 3, bestTime: 20 });
    expect(data.campaign.missions.n99).toBeUndefined();
    expect(data.campaign.missions.n2.challenge).toBe(false);
    // Ancienne clé de la première campagne : ignorée
    expect(data.campaign.missions['1']).toBeUndefined();
    expect(data.campaign.seen).toEqual(['a', 'b']);
    expect(data.campaign.reserve).toBe(55);
    expect(data.campaign.upgrades).toEqual({ owned: ['shield'], enabled: ['shield'] });
    expect(data.campaign.chapterComplete).toBe(false);
  });

  it('effacement explicite : supprime aussi les copies v4 et v5', () => {
    const store = new MemoryStore();
    store.set(`${BACKUP_PREFIX}4`, 'x');
    store.set(`${BACKUP_PREFIX}5`, 'y');
    eraseAll(store);
    expect(store.get(`${BACKUP_PREFIX}4`)).toBeNull();
    expect(store.get(`${BACKUP_PREFIX}5`)).toBeNull();
  });
});
