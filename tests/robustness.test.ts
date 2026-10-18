import { afterEach, describe, expect, it } from 'vitest';
import { applyMission, takeIntroScene, takeOutroScene } from '../src/campaign/progress';
import { STORAGE_NAMESPACE } from '../src/config/brand';
import { SCORE } from '../src/config/balance';
import { CATALOG, catalogItem, isPremium } from '../src/config/catalog';
import { TEST_PACK_ID, addTestPack } from './helpers';
import { ACHIEVEMENT_CONFIG } from '../src/config/achievements';
import { LEVELS } from '../src/config/levels';
import { MISSIONS } from '../src/config/campaign';
import { DEFAULT_SKIN_ID, SKINS } from '../src/config/skins';
import { STORY } from '../src/config/story';
import { WALLET_MAX } from '../src/config/economy';
import { NullPaymentProvider, setPaymentProvider } from '../src/monetization/payments';
import { ACHIEVEMENTS, claimMedals, claimableMedals, reconcileAchievements, unlockAchievements } from '../src/progression/achievements';
import { applyRun, type RunSummary } from '../src/progression/progress';
import { canPay, effectivePrice, equip, isOwned, itemState, priceOptions, purchase } from '../src/progression/shop';
import { BACKUP_PREFIX, BALANCE_BACKUP_PREFIX, BrowserStore, CORRUPT_KEY, MemoryStore, SAVE_KEY, SAVE_VERSION, defaultSave, eraseAll, loadSave, parseSave, resetProgress, sanitize, writeSave, type SaveData } from '../src/save/save';
import * as C from '../src/ui/campaignScreens';
import * as S from '../src/ui/screens';
import { optionsScreen } from '../src/ui/screens';

afterEach(() => setPaymentProvider(new NullPaymentProvider()));

const surv = (time: number, extra: Partial<RunSummary> = {}): RunSummary => ({ mode: 'survival', time, score: 1000, cycles: 0, bestMultiplier: 1, outcome: 'dead', ...extra });
/** Sauvegarde avec des Médailles (les cosmétiques non premium s'achètent uniquement avec des Médailles). */
const rich = (medals: number): SaveData => {
  const s = defaultSave();
  s.wallet.medals = medals;
  return s;
};
/** Deux « onglets » : copies indépendantes de la même sauvegarde enregistrée. */
const twoTabs = (save: SaveData): [SaveData, SaveData] => {
  const store = new MemoryStore();
  writeSave(store, save);
  return [loadSave(store).data, loadSave(store).data];
};

describe('succès : conditions exactes', () => {
  it('27 succès, identifiants uniques, objectifs cohérents avec la configuration du jeu', () => {
    expect(ACHIEVEMENTS).toHaveLength(27);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(27);
    const by = (id: string) => ACHIEVEMENT_CONFIG.find((a) => a.id === id)!;
    expect(by('all_levels').target).toBe(LEVELS.length);
    expect(by('stars_36').target).toBe(LEVELS.length * 3);
    expect(by('max_combo').target).toBe(SCORE.maxMultiplier);
    expect(by('stars_18').target).toBeLessThan(by('stars_36').target);
    for (const a of ACHIEVEMENTS) {
      expect(a.target, a.id).toBeGreaterThan(0);
      expect(a.medals, a.id).toBeGreaterThan(0);
      expect(a.legacyShards, a.id).toBeGreaterThan(0);
      expect(a.description.length, a.id).toBeGreaterThan(10);
    }
  });

  it('un objectif atteint exactement à sa cible se débloque (cible − 1 : non)', () => {
    const save = defaultSave();
    applyRun(save, surv(59.9));
    expect(save.achievements.survive_60).toBeUndefined();
    applyRun(save, surv(60));
    expect(save.achievements.survive_60).toBeDefined();
  });

  it('le défi quotidien compte pour « Rendez-vous », pas la Survie ; la campagne ne compte pour aucun succès', () => {
    const save = defaultSave();
    applyRun(save, surv(45));
    expect(save.achievements.daily_30).toBeUndefined();
    applyRun(save, { ...surv(31), mode: 'daily', date: '2026-10-12' });
    expect(save.achievements.daily_30).toBeDefined();
    const camp = defaultSave();
    for (const m of MISSIONS) applyMission(camp, { missionId: m.id, outcome: 'success', time: 30, beacons: 80, cycles: 14, maxMultiplier: 5, shieldUsed: false, objectsCollected: 0, objectsMissed: 0, stars: { main: true, challenge: true } });
    expect(Object.keys(camp.achievements)).toHaveLength(0);
    expect(camp.stats.totalCycles).toBe(0);
  });
});

describe('succès : Médailles réclamées une seule fois', () => {
  it('rechargement, relances et appels répétés : aucun versement, le registre des Médailles ne bouge pas', () => {
    const store = new MemoryStore();
    const save = defaultSave();
    const rep = applyRun(save, surv(65, { cycles: 1 }));
    expect(rep.achievementMedals).toBeGreaterThan(0);
    expect(claimMedals(save, 'survive_60').ok).toBe(true);
    writeSave(store, save);
    const claimed = [...save.medals.claimed];
    for (let i = 0; i < 5; i++) {
      const again = loadSave(store).data;
      expect(reconcileAchievements(again)).toEqual([]);
      expect(unlockAchievements(again, undefined, i)).toEqual([]);
      expect(again.wallet).toEqual(save.wallet);
      expect(again.medals.claimed).toEqual(claimed);
      expect(claimMedals(again, 'survive_60')).toEqual({ ok: false, reason: 'already' });
    }
  });

  it('deux onglets : après adoption de la sauvegarde de l’autre, la même réclamation n’est pas payée deux fois', () => {
    const [a, b] = twoTabs(defaultSave());
    applyRun(a, surv(65));
    claimMedals(a, 'survive_60');
    const store = new MemoryStore();
    writeSave(store, a);
    // L'onglet B (périmé) adopte la sauvegarde de A (événement `storage`) puis termine à son tour une partie de 65 s
    const adopted = parseSave(store.get(SAVE_KEY))!;
    applyRun(adopted, surv(65));
    expect(claimMedals(adopted, 'survive_60')).toEqual({ ok: false, reason: 'already' });
    expect(adopted.medals.claimed.filter((x) => x === 'survive_60')).toHaveLength(1);
    expect(adopted.wallet.medals).toBe(a.wallet.medals);
    // Sans adoption (dernier écrivain gagnant), B ne peut au pire que réclamer SA propre copie : jamais cumuler les deux
    applyRun(b, surv(65));
    claimMedals(b, 'survive_60');
    expect(b.wallet.medals).toBe(a.wallet.medals);
    expect(b.medals.claimed.filter((x) => x === 'survive_60')).toHaveLength(1);
  });

  it('sauvegarde incohérente (Médailles déjà réclamées, succès absent) : jamais re-créditées', () => {
    const save = defaultSave();
    save.medals.claimed = ['survive_60'];
    const rep = applyRun(save, surv(70));
    expect(rep.achievements.map((a) => a.id)).toContain('survive_60'); // le succès se débloque
    expect(claimableMedals(save)).toBe(rep.achievements.filter((a) => a.id !== 'survive_60').reduce((t, a) => t + a.medals, 0));
    expect(claimMedals(save, 'survive_60')).toEqual({ ok: false, reason: 'already' });
    expect(save.wallet.medals).toBe(0);
    expect(save.wallet.shards).toBe(0);
  });

  it('le registre des anciennes récompenses en Éclats (`rewarded`) ne bloque pas les nouvelles Médailles', () => {
    const save = defaultSave();
    save.achievements.first_cycle = 1;
    save.rewarded = ['first_cycle'];
    save.wallet.shards = 10;
    expect(claimMedals(save, 'first_cycle')).toMatchObject({ ok: true, medals: 20 });
    expect(save.wallet).toEqual({ shards: 10, medals: 20, prisms: 0 });
  });

  it('la notification de rattrapage des anciennes récompenses (migration) reste lisible, une seule fois ; les Médailles à récupérer sont signalées à l’accueil', () => {
    const save = defaultSave();
    save.stats.totalCycles = 12;
    expect(reconcileAchievements(save).length).toBeGreaterThan(0);
    const home = S.homeScreen(save, '2026-10-12');
    expect(home).toContain('Médailles</strong> à récupérer');
    expect(home).toContain('data-action="achievements"');
    expect(S.homeScreen(defaultSave(), '2026-10-12')).not.toContain('à récupérer');
    // Ancienne notification (Éclats déjà versés par une migration d'avant v8)
    const old = defaultSave();
    old.rewardNotice = { shards: 75, count: 3 };
    expect(S.homeScreen(old, '2026-10-12')).toContain('Anciennes récompenses de succès');
    old.rewardNotice = null;
    expect(S.homeScreen(old, '2026-10-12')).not.toContain('Anciennes récompenses');
  });

  it('aucun succès ne demande de dépenser : le solde ne fait jamais avancer ni reculer un objectif', () => {
    const save = defaultSave();
    save.wallet.shards = 5000;
    save.wallet.medals = 5000;
    expect(reconcileAchievements(save)).toEqual([]);
    save.stats.totalShards = 0;
    purchase(save, 'chantier-orbital');
    expect(save.stats.totalShards).toBe(0);
  });
});

describe('boutique : achats concurrents et états', () => {
  it('cinquante clics rapides sur « Confirmer » : un seul débit', () => {
    const save = rich(1000);
    let ok = 0;
    for (let i = 0; i < 50; i++) if (purchase(save, 'circuit').ok) ok++;
    expect(ok).toBe(1);
    expect(save.wallet.medals).toBe(750);
    expect(save.owned.filter((x) => x === 'circuit')).toHaveLength(1);
  });

  it('deux onglets qui achètent le même article : après adoption, le second est refusé sans débit', () => {
    const [a, b] = twoTabs(rich(500));
    expect(purchase(a, 'chantier-orbital').ok).toBe(true);
    const store = new MemoryStore();
    writeSave(store, a);
    const adopted = parseSave(store.get(SAVE_KEY))!;
    expect(purchase(adopted, 'chantier-orbital')).toEqual({ ok: false, reason: 'owned' });
    expect(adopted.wallet.medals).toBe(400);
    // Sans adoption, chaque copie ne débite qu'une fois : jamais deux débits sur la même copie
    expect(purchase(b, 'chantier-orbital').ok).toBe(true);
    expect(b.wallet.medals).toBe(400);
  });

  it('le solde ne devient jamais négatif ; solde incohérent (NaN) : refus sans débit', () => {
    const save = rich(99);
    expect(purchase(save, 'chantier-orbital').ok).toBe(false);
    save.wallet.medals = Number.NaN;
    expect(purchase(save, 'chantier-orbital')).toEqual({ ok: false, reason: 'insufficient' });
    expect(isOwned(save, 'chantier-orbital')).toBe(false);
  });

  it('pack premium (factice) partiellement possédé : prix au prorata, jamais plus cher que les articles restants achetés séparément', () => {
    const remove = addTestPack(100);
    try {
      const packs = CATALOG.filter((i) => i.kind === 'pack');
      expect(packs.map((p) => p.id)).toEqual([TEST_PACK_ID]);
      const prisms = (i: (typeof CATALOG)[number]): number => priceOptions(i).find((o) => o.currency === 'prisms')?.amount ?? 0;
      for (const pack of packs) {
        const parts = (pack.contents ?? []).map((c) => catalogItem(c)!);
        const full = effectivePrice(defaultSave(), pack)!.amount;
        expect(full).toBe(pack.acquire.type === 'price' ? pack.acquire.amount : -1);
        for (const owned of parts) {
          const save = defaultSave();
          save.owned.push(owned.id);
          const due = effectivePrice(save, pack)!.amount;
          const rest = parts.filter((p) => p.id !== owned.id).reduce((t, p) => t + prisms(p), 0);
          expect(due, `${pack.id} sans ${owned.id}`).toBeLessThanOrEqual(rest);
          expect(due).toBeLessThan(full);
          expect(due).toBeGreaterThan(0);
        }
      }
    } finally {
      remove();
    }
  });

  it('tous les états de la boutique sont lisibles sans la couleur, avec un bouton inactif quand l’achat est impossible', () => {
    const remove = addTestPack(100);
    try {
      const save = rich(150);
      save.owned.push('carbone-utilitaire');
      save.skin = 'chantier-orbital';
      save.owned.push('chantier-orbital');
      const cases: [string, string, boolean][] = [
        ['circuit', 'Médailles insuffisantes', true],
        ['dipole', 'Médailles insuffisantes', true],
        [DEFAULT_SKIN_ID, 'Équiper', false],
        ['chantier-orbital', 'Équipé', true],
        ['cartographe', 'Médailles insuffisantes', true],
        // Achat au choix sans fonds : un bouton par monnaie, tous inactifs, avec le motif
        ['long-courrier', 'Solde insuffisant', true],
        ['porcelaine', 'Indisponible', true],
        [TEST_PACK_ID, 'Bientôt', true],
      ];
      for (const [id, label, disabled] of cases) {
        const kind = catalogItem(id)!.kind;
        const html = S.cosmeticsScreen(save, kind === 'ship' ? 'ships' : kind === 'trail' ? 'trails' : 'prisms', 'all', id);
        expect(html, id).toContain(label);
        const btn = new RegExp(`<button[^>]*data-action="(buy|equip-item)"[^>]*>`, 'g');
        const buttons = [...html.matchAll(btn)].map((m) => m[0]);
        const primary = buttons.find((b) => !b.includes('select-item'));
        expect(primary, id).toBeDefined();
        expect(/disabled/.test(primary!), `${id} inactif`).toBe(disabled);
      }
      // Traînées : catégorie fermée, message lisible et aucune carte cliquable
      const trails = S.cosmeticsScreen(save, 'trails', 'all', 'emeraude');
      expect(trails).toContain('Indisponible pour l’instant');
      expect(trails).not.toContain('select-item');
      expect(trails).not.toMatch(/data-action="(buy|equip-item)"/);
      // Achat au choix avec des Éclats : un bouton par monnaie ; les Prismes restent inactifs sans service
      save.wallet.shards = 5000;
      const choice = S.cosmeticsScreen(save, 'ships', 'all', 'long-courrier');
      const shardsBtn = choice.match(/<button[^>]*data-currency="shards"[^>]*>/)?.[0];
      const prismsBtn = choice.match(/<button[^>]*data-currency="prisms"[^>]*>/)?.[0];
      expect(shardsBtn).toBeDefined();
      expect(/disabled/.test(shardsBtn!)).toBe(false);
      expect(prismsBtn).toBeDefined();
      expect(/disabled/.test(prismsBtn!)).toBe(true);
      expect(S.confirmPurchaseScreen(save, 'long-courrier', false, 'shards')).toContain('Confirmer l’achat');
      expect(S.confirmPurchaseScreen(save, 'long-courrier', false, 'prisms')).toContain('Achat impossible');
      // Acheter (fonds suffisants) puis confirmation : récapitulatif complet
      save.wallet.medals = 500;
      expect(S.cosmeticsScreen(save, 'ships', 'all', 'dipole')).toContain('Acheter');
      const confirm = S.confirmPurchaseScreen(save, 'dipole');
      expect(confirm).toContain('Confirmer l’achat');
      expect(confirm).toContain('Solde après l’achat');
      expect(S.cosmeticsScreen(save, 'ships', 'all', 'carbone-utilitaire')).toContain('Possédé');
    } finally {
      remove();
    }
  });

  it('confirmation d’un article non achetable : « Achat impossible » expliqué, aucun bouton de confirmation', () => {
    const save = rich(10);
    for (const id of ['chantier-orbital', 'cartographe', 'long-courrier', 'porcelaine', 'emeraude', 'inconnu']) {
      const html = S.confirmPurchaseScreen(save, id);
      expect(html, id).toContain('Achat impossible');
      expect(html).not.toContain('confirm-buy');
    }
    save.owned.push('chantier-orbital');
    expect(S.purchaseRefusal(save, catalogItem('chantier-orbital')!)).toContain('déjà possédé');
    expect(S.purchaseRefusal(save, catalogItem('circuit')!)).toContain('Rien n’a été débité');
  });

  it('un message d’achat (succès ou refus) est annoncé aux lecteurs d’écran', () => {
    const save = rich(0);
    expect(S.cosmeticsScreen(save, 'ships', 'all', undefined, { kind: 'error', text: 'Solde insuffisant' })).toMatch(/role="alert"[^>]*>Solde insuffisant/);
    expect(S.cosmeticsScreen(save, 'ships', 'all', undefined, { kind: 'ok', text: 'Achat effectué' })).toMatch(/role="status"[^>]*>Achat effectué/);
  });

  it('aucun avantage compétitif : apparences et traînées sans effet de jeu (même graine, même simulation)', () => {
    expect(CATALOG.every((i) => ['ship', 'trail', 'pack'].includes(i.kind))).toBe(true);
    const a = defaultSave();
    const b = defaultSave();
    b.owned.push('circuit', 'ultraviolet');
    equip(b, 'circuit');
    equip(b, 'ultraviolet'); // traînées fermées : sans effet, et sans aucun effet de jeu de toute façon
    // L'équipement ne change aucune règle : mêmes scores et mêmes records pour la même partie
    const run = surv(80, { score: 42000, cycles: 3, bestMultiplier: 3 });
    const ra = applyRun(a, run);
    const rb = applyRun(b, run);
    expect(rb.achievements.map((x) => x.id)).toEqual(ra.achievements.map((x) => x.id));
    expect(b.survival).toEqual(a.survival);
  });
});

describe('Prismes : sans service, jamais achetables ; avec un service, jamais débités localement', () => {
  it('sans service : « Bientôt disponible », refus, aucun débit, aucun crédit', () => {
    const remove = addTestPack(100);
    try {
      const save = rich(100000);
      save.wallet.shards = 100000;
      const premium = CATALOG.filter(isPremium);
      expect(premium.map((i) => i.id)).toEqual([TEST_PACK_ID]);
      for (const item of premium) {
        expect(itemState(save, item)).toBe('soon');
        expect(purchase(save, item.id)).toEqual({ ok: false, reason: 'unavailable' });
        for (const tab of ['ships', 'trails', 'prisms'] as const) {
          if (tab !== 'prisms' && !S.cosmeticItems(save, tab, 'all').includes(item)) continue;
          const html = S.cosmeticsScreen(save, tab, 'all', item.id);
          expect(html).toContain('Bientôt');
          expect(html).not.toMatch(/data-action="buy"(?![^>]*disabled)/);
        }
      }
      // Achat au choix : l'option Prismes n'est jamais payable ni proposée comme active sans service
      for (const item of CATALOG.filter((i) => i.acquire.type === 'choice')) {
        expect(canPay(save, item, 'prisms'), item.id).toBe(false);
        expect(purchase(save, item.id, 'prisms'), item.id).toEqual({ ok: false, reason: 'unavailable' });
        const prismsBtn = S.cosmeticsScreen(save, 'ships', 'all', item.id).match(/<button[^>]*data-currency="prisms"[^>]*>/)?.[0];
        expect(prismsBtn, item.id).toBeDefined();
        expect(/disabled/.test(prismsBtn!), item.id).toBe(true);
      }
      expect(save.wallet).toEqual({ shards: 100000, medals: 100000, prisms: 0 });
      expect(save.owned).toEqual([]);
      // L'accueil n'affiche pas de solde de Prismes fantôme
      expect(S.homeScreen(save, '2026-10-12')).not.toContain('wallet__item--prisms');
    } finally {
      remove();
    }
  });
});

describe('Éclats : boutique et campagne clairement distincts', () => {
  it('la réserve de campagne est nommée « Éclats de campagne », expliquée, et séparée du solde', () => {
    const save = defaultSave();
    save.campaign.reserve = 90;
    save.wallet.shards = 7;
    const html = C.campaignScreen(save);
    expect(html).toContain('Éclats de campagne');
    expect(html).toMatch(/distincts des Éclats de la Survie et de la boutique/);
    expect(html).not.toContain('data-wallet');
    const shop = S.cosmeticsScreen(save, 'ships', 'all');
    expect(shop).toMatch(/Éclats de campagne/);
    expect(shop).toContain('séparée');
  });

  it('l’accueil annonce la bonne campagne (plus l’ancien « signal impossible »)', () => {
    const html = S.homeScreen(defaultSave(), '2026-10-12');
    expect(html).toContain('Douze ans de silence');
    expect(html).not.toMatch(/signal impossible|Écho-7/);
  });
});

describe('stockage : indisponible, effacement, préférences', () => {
  const realLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (realLocal) Object.defineProperty(globalThis, 'localStorage', realLocal);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('écriture refusée (quota, navigation privée) ou stockage absent : le jeu continue et le signale', () => {
    const store = new BrowserStore();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined } });
    store.set('k', 'v');
    expect(store.failed).toBe(true);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
    store.set('k', 'v');
    expect(store.failed).toBe(false);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    store.set('k', 'v');
    expect(store.failed).toBe(true);
    expect(store.get('k')).toBeNull();
  });

  it('l’accueil prévient quand la progression ne sera pas conservée, ou quand la sauvegarde était illisible / trop récente', () => {
    const save = defaultSave();
    expect(S.homeScreen(save, '2026-10-12')).not.toContain('ne sera pas conservée');
    expect(S.homeScreen(save, '2026-10-12', false, false, { storageFailed: true, load: null })).toMatch(/role="alert"[^>]*>Sauvegarde impossible.*ne sera pas conservée/s);
    expect(S.homeScreen(save, '2026-10-12', false, false, { storageFailed: false, load: 'corrupt' })).toContain('illisible');
    expect(S.homeScreen(save, '2026-10-12', false, false, { storageFailed: false, load: 'future' })).toContain('version plus récente');
  });

  it('effacement confirmé : progression et copies supprimées, préférences et profil du classement conservés', () => {
    const store = new MemoryStore();
    const save = defaultSave();
    save.wallet.shards = 500;
    save.owned.push('chantier-orbital');
    save.options = { ...save.options, muted: true, volume: 0.2, musicVolume: 0.5, sfxVolume: 0.3, visualIntensity: 0.4, reducedEffects: true, tutorialSeen: true };
    writeSave(store, save);
    store.set(`${BACKUP_PREFIX}3`, 'x');
    store.set(`${BACKUP_PREFIX}6`, 'x');
    store.set(`${BALANCE_BACKUP_PREFIX}2`, 'x');
    store.set(CORRUPT_KEY, 'x');
    store.set('polarite.classement.identite', '{"playerId":"p"}');
    const fresh = resetProgress(store, save);
    expect(fresh.wallet.shards).toBe(0);
    expect(fresh.owned).toEqual([]);
    expect(fresh.options).toEqual(save.options);
    for (const k of [`${BACKUP_PREFIX}3`, `${BACKUP_PREFIX}6`, `${BALANCE_BACKUP_PREFIX}2`, CORRUPT_KEY]) expect(store.get(k), k).toBeNull();
    expect(store.get('polarite.classement.identite')).toBe('{"playerId":"p"}');
    expect(loadSave(store).data.options).toEqual(save.options);
    eraseAll(store);
    expect(store.get(SAVE_KEY)).toBeNull();
  });

  it('l’écran d’effacement dit ce qui est supprimé et ce qui est conservé', () => {
    const html = S.confirmResetScreen();
    for (const word of ['campagne', 'Éclats', 'cosmétiques', 'records', 'options', 'classement', 'irréversible']) expect(html, word).toContain(word);
    expect(html).toContain('data-action="options"');
  });
});

describe('sauvegarde : identifiants stables et données malformées', () => {
  it('espace de noms, clés, identifiants de scènes et d’apparences inchangés', () => {
    expect(STORAGE_NAMESPACE).toBe('polarite');
    expect(SAVE_KEY).toBe('polarite.save');
    expect(SAVE_VERSION).toBe(10);
    expect(SKINS.map((s) => s.id)).toEqual(['tole-brute', 'chantier-orbital', 'carbone-utilitaire', 'dipole', 'circuit', 'cartographe', 'long-courrier', 'basalte', 'arcade-84', 'porcelaine']);
    expect(DEFAULT_SKIN_ID).toBe('tole-brute');
    expect(STORY.map((s) => s.id)).toEqual(Array.from({ length: 10 }, (_, i) => [`n${i + 1}-before`, `n${i + 1}-after`]).flat());
    expect(MISSIONS.map((m) => `n${m.id}`)).toEqual(Array.from({ length: 10 }, (_, i) => `n${i + 1}`));
  });

  it('textes de toute nature : jamais d’exception, valeurs toujours dans des bornes sûres', () => {
    const garbage: unknown[] = [
      null, 0, 'x', [], [[]], true, {}, { version: 'six' }, { version: 6, wallet: 'riche' }, { version: 6, wallet: { shards: -5, prisms: 1e99 } },
      { version: 6, wallet: { shards: Number.NaN } }, { version: 6, owned: 'chantier-orbital' }, { version: 6, owned: [1, null, 'a'.repeat(100), 'chantier-orbital', 'chantier-orbital'] },
      { version: 6, levels: { 1: { completed: 'oui', stars: 99, bestScore: -3 }, x: {}, 2: null } }, { version: 6, campaign: { missions: { n1: { main: 'yes', challenge: true }, __proto__: { n2: 1 } }, reserve: 'beaucoup', chapterComplete: true } },
      { version: 6, options: { volume: 7, musicVolume: 'fort', visualIntensity: -1, muted: 'non' } }, { version: 6, skin: { id: 1 }, trail: 5 }, { version: 99, wallet: { shards: 5 } },
      JSON.parse('{"version":6,"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}'),
    ];
    for (const g of garbage) {
      const store = new MemoryStore();
      store.set(SAVE_KEY, JSON.stringify(g));
      const { data } = loadSave(store);
      expect(Number.isInteger(data.wallet.shards) && data.wallet.shards >= 0 && data.wallet.shards <= WALLET_MAX, JSON.stringify(g)).toBe(true);
      expect(data.wallet.prisms >= 0 && data.wallet.prisms <= WALLET_MAX).toBe(true);
      expect(new Set(data.owned).size).toBe(data.owned.length);
      for (const l of Object.values(data.levels)) expect(l.stars >= 0 && l.stars <= 3 && l.bestScore >= 0).toBe(true);
      expect(data.options.volume >= 0 && data.options.volume <= 1 && data.options.musicVolume <= 1 && data.options.visualIntensity >= 0).toBe(true);
      expect(typeof data.skin).toBe('string');
      expect(typeof data.options.muted).toBe('boolean');
      if (!MISSIONS.every((m) => data.campaign.missions[`n${m.id}`]?.main)) expect(data.campaign.chapterComplete).toBe(false);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    }
  });

  it('texte illisible : copie mise de côté, jamais effacée ; sauvegarde plus récente : lue au mieux, original conservé', () => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, '{pas du json');
    expect(loadSave(store).status).toBe('corrupt');
    expect(store.get(CORRUPT_KEY)).toBe('{pas du json');
    const fut = new MemoryStore();
    const text = JSON.stringify({ version: 99, wallet: { shards: 42, prisms: 0 }, owned: ['chantier-orbital'] });
    fut.set(SAVE_KEY, text);
    const r = loadSave(fut);
    expect(r.status).toBe('future');
    expect(r.data.wallet.shards).toBe(42);
    expect(fut.get(CORRUPT_KEY)).toBe(text);
    expect(parseSave(text)).toBeNull();
    expect(parseSave('{')).toBeNull();
    expect(parseSave(null)).toBeNull();
  });

  it('parseSave (autre onglet) migre sans copie ni effet de bord', () => {
    const old = { version: 5, levels: { 1: { completed: true, stars: 2, bestScore: 900 } }, wallet: { shards: 10, prisms: 0 }, campaign: { missions: { 1: { main: true } } } };
    const data = parseSave(JSON.stringify(old))!;
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.levels['1']).toMatchObject({ completed: true, stars: 2 });
    expect(data.wallet.shards).toBe(10);
    expect(data.campaign.missions).toEqual({});
  });

  it('migrations de toutes les anciennes versions : progression, monnaies, achats, équipement, succès et options conservés, jamais remis à zéro', () => {
    const base = {
      levels: { 1: { completed: true, bestScore: 5000, stars: 3 }, 2: { completed: true, bestScore: 4000, stars: 1 } },
      survival: { bestTime: 130, bestScore: 77000, runs: 9 },
      achievements: { first_cycle: 100, survive_60: 200, all_levels: 300 },
      skin: 'chantier-orbital',
      options: { muted: true, volume: 0.3, reducedEffects: true, tutorialSeen: true },
    };
    for (const version of [1, 2, 3, 4, 5]) {
      const raw: Record<string, unknown> = { ...base, version, balance: version >= 2 ? 3 : undefined };
      if (version >= 3) Object.assign(raw, { wallet: { shards: 321, prisms: 0 }, owned: ['chantier-orbital', 'carbone-utilitaire'], trail: 'emeraude', paid: { 1: { first: true, stars: 3 } } });
      if (version >= 4) Object.assign(raw, { rewarded: ['first_cycle', 'survive_60', 'all_levels'], stats: { totalCycles: 50, totalShards: 77, totalEvents: 4, bestScore: 9000, bestMultiplier: 4, totalRuns: 20 } });
      const store = new MemoryStore();
      store.set(SAVE_KEY, JSON.stringify(raw));
      const res = loadSave(store);
      expect(res.status, `v${version}`).toBe('migrated');
      expect(store.get(`${BACKUP_PREFIX}${version}`), `copie v${version}`).not.toBeNull();
      const d = res.data;
      expect(d.version).toBe(SAVE_VERSION);
      expect(d.levels['1']).toEqual({ completed: true, bestScore: 5000, stars: 3 });
      expect(d.levels['2'].stars).toBe(1);
      expect(d.skin).toBe('chantier-orbital');
      expect(d.achievements.survive_60).toBe(200);
      expect(d.options).toMatchObject({ muted: true, volume: 0.3, reducedEffects: true, tutorialSeen: true, musicVolume: 1, sfxVolume: 1, visualIntensity: 1 });
      expect(d.survival.bestTime + Object.values(d.archive).reduce((t, a) => t + a.survival.bestTime, 0)).toBeGreaterThanOrEqual(130);
      if (version >= 3) {
        expect(d.owned).toEqual(expect.arrayContaining(['chantier-orbital', 'carbone-utilitaire']));
        expect(d.trail).toBe('emeraude');
        expect(d.wallet.shards).toBeGreaterThanOrEqual(321);
      }
      // Rechargement après migration : stable, aucun nouveau versement
      writeSave(store, d);
      const again = loadSave(store);
      expect(again.status).toBe('ok');
      expect(again.data.wallet).toEqual(d.wallet);
      expect(reconcileAchievements(again.data).filter((a) => !d.achievements[a.id])).toBeDefined();
    }
  });

  it('campagne v6 : scènes vues, étoiles, réserve et fin de chapitre survivent à un aller-retour', () => {
    const s = defaultSave();
    for (const m of MISSIONS) {
      takeIntroScene(s, m);
      applyMission(s, { missionId: m.id, outcome: 'success', time: 30, beacons: 0, cycles: 0, maxMultiplier: 1, shieldUsed: false, objectsCollected: 0, objectsMissed: 0, stars: { main: true, challenge: true } });
      takeOutroScene(s, { missionId: m.id, outcome: 'success', time: 30, beacons: 0, cycles: 0, maxMultiplier: 1, shieldUsed: false, objectsCollected: 0, objectsMissed: 0, stars: { main: true, challenge: false } });
    }
    const back = sanitize(JSON.parse(JSON.stringify(s)));
    expect(back.campaign).toEqual(s.campaign);
    expect(back.campaign.seen).toHaveLength(20);
    expect(back.campaign.chapterComplete).toBe(true);
  });
});

describe('classement hors ligne et honnêteté sur les données', () => {
  const view = (over: Partial<S.LeaderboardView> = {}): S.LeaderboardView => ({ configured: true, identity: null, loading: false, error: null, top: null, me: null, balances: null, balance: 3, category: 'plain', pending: [], nickMessage: null, localBest: { time: 90, score: 1234 }, ...over });

  it('service non configuré : message clair, sans jargon technique, sans faux bouton, record local visible', () => {
    const html = S.leaderboardScreen(view({ configured: false }));
    expect(html).toContain('pas encore disponible');
    expect(html).not.toMatch(/docs\/|VITE_|CLASSEMENT\.md/);
    expect(html).not.toMatch(/data-action="(lb-|buy)/);
    expect(html).toContain('Votre record sur cet appareil');
    expect(html).toContain('Durée puis score');
  });

  it('hors connexion : erreur annoncée (role=alert), « Réessayer » seulement, jeu et record local toujours là', () => {
    const html = S.leaderboardScreen(view({ error: 'réseau indisponible' }));
    expect(html).toMatch(/role="alert"[^>]*>Classement indisponible : réseau indisponible/);
    expect(html.match(/data-action="lb-refresh"/g)).toHaveLength(1);
    expect(html).toContain('Votre record sur cet appareil');
    expect(html).toContain('envoi plus tard');
  });

  it('options : la sauvegarde est locale à ce navigateur, non synchronisée avec une application native ni un autre appareil', () => {
    const html = optionsScreen(defaultSave());
    expect(html).toContain('dans ce navigateur, sur cet appareil');
    expect(html).toMatch(/pas synchronisée automatiquement/);
    expect(html).toContain('application native');
    expect(html).toContain('classement mondial');
  });

  it('aucune publicité ni achat intégré dans l’interface', () => {
    const all = [S.homeScreen(defaultSave(), '2026-10-12'), S.cosmeticsScreen(rich(10), 'prisms', 'all')].join('');
    expect(all).not.toMatch(/publicité|regarder une vidéo|acheter des prismes|achat intégré|abonnement/i);
    // Réglages : seule la section « Confidentialité » (politique publique, choix de consentement) parle des publicités ; jamais d'incitation à en regarder
    expect(optionsScreen(defaultSave())).not.toMatch(/regarder une vidéo|acheter des prismes|achat intégré|abonnement/i);
  });
});
