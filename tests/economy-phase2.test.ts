import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_CONFIG } from '../src/config/achievements';
import { BONUS, BONUS_LIST } from '../src/config/economy';
import { CATALOG, LEGACY_ACHIEVEMENT_ITEMS } from '../src/config/catalog';
import { buyBonus, grantCharges } from '../src/economy/bonus';
import { mergeSaves } from '../src/economy/merge';
import { applyRun } from '../src/progression/progress';
import { claimableMedals, claimMedals } from '../src/progression/achievements';
import { isOwned } from '../src/progression/shop';
import { BACKUP_PREFIX, MemoryStore, SAVE_KEY, SAVE_VERSION, defaultSave, loadSave, parseSave, writeSave } from '../src/save/save';
import { accountScreen } from '../src/ui/accountScreens';
import * as S from '../src/ui/screens';
import { MIGRATIONS, SCHEMA_VERSION, openDb } from '../server/db';

/** Sauvegarde d'un joueur de la version publique (format 6) ayant obtenu plusieurs succès, dont ceux qui débloquaient un cosmétique. */
const v6 = (): Record<string, unknown> => ({
  version: 6,
  balance: 3,
  levels: { '1': { completed: true, bestScore: 52000, stars: 3 } },
  survival: { bestTime: 320, bestScore: 90000, runs: 12 },
  daily: {},
  archive: {},
  balanceNoticeSeen: 3,
  achievements: { first_cycle: 10, survive_60: 20, survive_300: 30, max_combo: 40, shards_250: 50, events_30: 60, all_levels: 70 },
  skin: 'solaire',
  trail: 'citron',
  wallet: { shards: 840, prisms: 12 },
  owned: ['aurore'],
  paid: { '1': { first: true, stars: 3 } },
  options: { muted: false, volume: 0.7, reducedEffects: false, tutorialSeen: true },
  seenIntros: [],
  stats: { totalCycles: 120, totalRuns: 30, totalShards: 400, totalEvents: 40, bestScore: 90000, bestMultiplier: 5 },
  rewarded: ['first_cycle', 'survive_60', 'survive_300', 'max_combo', 'shards_250', 'events_30', 'all_levels'],
  rewardNotice: null,
  campaign: { missions: {}, seen: [], reserve: 55, upgrades: { owned: [], enabled: [] }, chapterComplete: false },
});

describe('migration de la sauvegarde v6 vers la v8 : aucun acquis perdu, Médailles réclamables rétroactivement', () => {
  const migrate = (raw: Record<string, unknown>) => {
    const store = new MemoryStore();
    store.set(SAVE_KEY, JSON.stringify(raw));
    return { store, res: loadSave(store) };
  };

  it('Éclats historiques, cosmétiques, succès, statistiques, records et réserve de campagne conservés ; copie de sauvegarde', () => {
    const { store, res } = migrate(v6());
    const s = res.data;
    expect(res.status).toBe('migrated');
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.wallet.shards).toBe(840);
    expect(s.wallet.medals).toBe(0);
    expect(s.rewarded).toHaveLength(7); // registre des anciens Éclats intact
    expect(s.achievements.survive_300).toBe(30);
    expect(s.stats.totalCycles).toBe(120);
    expect(s.survival.bestTime).toBe(320);
    expect(s.campaign.reserve).toBe(55);
    // Cosmétiques débloqués autrefois par les succès : conservés (passés dans « possédés »), jamais re-facturés
    for (const id of ['solaire', 'glace', 'citron', 'boreale', 'prisme', 'aurore']) expect(isOwned(s, id), id).toBe(true);
    expect(s.skin).toBe('solaire');
    expect(s.trail).toBe('citron');
    expect(store.get(`${BACKUP_PREFIX}6`)).toBe(JSON.stringify(v6()));
    // Migration de l'ancien solde pour la synchronisation (une seule fois)
    expect(s.economy.legacy).toEqual({ shards: 840, imported: false });
  });

  it('Médailles : aucune créditée à la migration ; les 7 succès accomplis sont réclamables rétroactivement (20+20+100+50+50+100+100)', () => {
    const { res } = migrate(v6());
    const s = res.data;
    expect(s.medals.claimed).toEqual([]);
    expect(claimableMedals(s)).toBe(20 + 20 + 100 + 50 + 50 + 100 + 100);
    for (const id of Object.keys(v6().achievements as object)) expect(claimMedals(s, id).ok, id).toBe(true);
    expect(s.wallet.medals).toBe(440);
    expect(s.wallet.shards).toBe(840); // jamais touché
  });

  it('idempotente : recharger ou migrer deux fois donne la même sauvegarde, sans double Médaille ni double cosmétique', () => {
    const { store, res } = migrate(v6());
    claimMedals(res.data, 'first_cycle');
    writeSave(store, res.data);
    const again = loadSave(store);
    expect(again.status).toBe('ok');
    expect(again.data).toEqual(res.data);
    expect(again.data.owned.filter((x) => x === 'solaire')).toHaveLength(1);
    expect(again.data.wallet.medals).toBe(20);
    // Une seconde migration depuis le même texte v6 produit le même résultat
    const second = parseSave(JSON.stringify(v6()))!;
    const third = parseSave(JSON.stringify(v6()))!;
    expect(second).toEqual(third);
  });

  it('sauvegarde v7 (branche de développement) : cosmétiques d’exclusivité conservés, pas de nouvel import hérité', () => {
    const { res } = migrate({ ...v6(), version: 7, economy: { installId: 'install-aaaa-1111', earned: 5, confirmedEarned: 5, purchases: {}, confirmedPurchases: [], legacy: null } });
    expect(res.data.economy.legacy).toBeNull();
    expect(res.data.economy.installId).toBe('install-aaaa-1111');
    expect(isOwned(res.data, 'glace')).toBe(true);
    expect(res.data.economy.bonusBought).toEqual({ boost: 0, gel: 0 });
  });

  it('nouveau joueur : aucun cosmétique direct par succès (le succès accompli ne possède rien)', () => {
    const s = defaultSave();
    s.stats.totalEvents = 40;
    s.survival.bestTime = 700;
    applyRun(s, { mode: 'survival', time: 700, score: 1, cycles: 0, bestMultiplier: 1, outcome: 'dead', events: 0 });
    expect(Object.keys(s.achievements).length).toBeGreaterThan(5);
    for (const id of Object.keys(LEGACY_ACHIEVEMENT_ITEMS)) expect(isOwned(s, id), id).toBe(false);
    expect(s.owned).toEqual([]);
  });

  it('valeurs aberrantes d’une sauvegarde modifiée : Médailles, inventaire et compteurs ramenés à des valeurs sûres', () => {
    const raw = { ...defaultSave(), wallet: { shards: 1, medals: -5, prisms: 0 }, medals: { claimed: ['first_cycle', 'first_cycle', 'inconnu', 7] }, inventory: { boost: 5000, gel: -1 } } as unknown as Record<string, unknown>;
    const s = parseSave(JSON.stringify(raw))!;
    expect(s.wallet.medals).toBe(0);
    expect(s.medals.claimed).toEqual(['first_cycle']);
    expect(s.inventory).toEqual({ boost: BONUS.maxStock, gel: 0 });
    (raw.economy as { bonusBought: unknown; bonusProcessed: unknown }).bonusBought = { boost: 2, gel: 0 };
    (raw.economy as { bonusProcessed: unknown }).bonusProcessed = { boost: 9, gel: 0 };
    expect(parseSave(JSON.stringify(raw))!.economy.bonusProcessed.boost).toBe(2);
  });
});

describe('fusion de sauvegardes : Médailles réclamées', () => {
  it('union des succès réclamés ; portefeuille et inventaire de la sauvegarde principale ; commutative sur les contenus', () => {
    const a = defaultSave();
    a.medals.claimed = ['first_cycle'];
    a.wallet.medals = 20;
    a.inventory.boost = 2;
    const b = defaultSave();
    b.medals.claimed = ['first_cycle', 'survive_60'];
    b.wallet.medals = 999;
    const m = mergeSaves(a, b);
    expect(m.medals.claimed.sort()).toEqual(['first_cycle', 'survive_60']);
    expect(m.wallet.medals).toBe(20);
    expect(m.inventory.boost).toBe(2);
    expect(mergeSaves(b, a).medals.claimed.sort()).toEqual(m.medals.claimed.sort());
  });
});

describe('écrans : préparation de la Survie, bonus, confirmations, notifications', () => {
  const save = () => {
    const s = defaultSave();
    s.wallet.shards = 380;
    s.inventory = { boost: 2, gel: 1 };
    return s;
  };

  it('préparation : stocks, solde d’Éclats, achats, limite de 3 activations, lancement sans bonus', () => {
    const html = S.prepScreen(save());
    expect(html).toContain('Préparer la partie');
    expect(html).toContain('data-stock="boost">2<');
    expect(html).toContain('data-stock="gel">1<');
    expect(html).toContain('data-wallet="shards"');
    expect(html).not.toContain('data-wallet="medals"');
    expect(html).toContain('au plus 3 fois pendant la première vie');
    expect(html).toMatch(/data-action="bonus-ask"[^>]*data-bonus="boost"[^>]*data-qty="1"/);
    expect(html).toMatch(/data-action="bonus-ask"[^>]*data-bonus="gel"[^>]*data-qty="5"/);
    expect(html).toMatch(/data-action="survival-start"/);
    // Sans bonus : le lancement reste possible
    expect(S.prepScreen(defaultSave())).toContain('Sans bonus');
    expect(S.prepScreen(defaultSave())).toContain('data-action="survival-start"');
    // Achat de 5 Gel (500 Éclats) impossible avec 380 : bouton inactif
    expect(html).toMatch(/data-action="bonus-ask"[^>]*data-bonus="gel" data-qty="5" disabled/);
    expect(html).toContain('Boost');
    expect(html).toContain('Gel temporel');
    // Honnêteté : les effets ne sont pas encore actifs
    expect(BONUS.activationEnabled).toBe(false);
    expect(html).toContain('prochaine mise à jour');
  });

  it('onglet Bonus de la boutique : prix, quantités possédées, séparation Éclats / Médailles / Prismes', () => {
    const html = S.cosmeticsScreen(save(), 'bonus', 'all');
    expect(html).toContain('Bonus · en Éclats');
    for (const b of BONUS_LIST) {
      expect(html).toContain(b.name);
      expect(html).toContain(`>${b.price}<`);
    }
    expect(html).toContain('data-action="cat-bonus"');
    expect(html).not.toContain('En Médailles');
    const ships = S.cosmeticsScreen(save(), 'ships', 'all');
    expect(ships).toContain('En Médailles');
    expect(ships).toContain('Premium · en Prismes');
    expect(ships).not.toContain('Bonus · en Éclats');
  });

  it('confirmation d’un achat de bonus : prix, Éclats avant/après, stock avant/après ; refus sans bouton de confirmation', () => {
    const html = S.confirmBonusScreen(save(), 'boost', 3, 'prep');
    expect(html).toContain('Confirmer l’achat');
    expect(html).toContain('150');
    expect(html).toContain('Éclats restants');
    expect(html).toContain('230');
    expect(html).toContain('2 → 5');
    expect(html).toMatch(/data-action="bonus-confirm"[^>]*data-bonus="boost"[^>]*data-qty="3"/);
    for (const [kind, qty] of [['gel', 10], ['inconnu', 1], ['boost', 0]] as const) {
      const refused = S.confirmBonusScreen(save(), kind, qty, 'cosmetics');
      expect(refused, `${kind} ${qty}`).toContain('Achat impossible');
      expect(refused).not.toContain('bonus-confirm');
    }
    expect(S.confirmBonusScreen(save(), 'gel', 10, 'prep')).toContain('Retour à la préparation');
  });

  it('achat de bonus : après confirmation le stock et le solde changent, une seule fois', () => {
    const s = save();
    expect(buyBonus(s, 'boost', 3)).toMatchObject({ ok: true, stock: 5, balance: 230 });
    expect(S.prepScreen(s)).toContain('data-stock="boost">5<');
    expect(grantCharges(s, 'gel', 500)).toBe(BONUS.maxStock - 1);
    expect(s.economy.bonusBought.gel).toBe(0); // un crédit sans achat n'alimente pas les compteurs d'achat
  });

  it('succès : notification d’accueil des Médailles à récupérer, bouton Récupérer, Médailles visuellement distinctes', () => {
    const s = defaultSave();
    s.achievements = { first_cycle: 1, survive_600: 2 };
    const home = S.homeScreen(s, '2026-10-12');
    expect(home).toContain('220 Médailles');
    expect(home).toContain('à récupérer');
    expect(home).toContain('coin--medals');
    expect(home).not.toContain('220 Éclats');
    const ach = S.achievementsScreen(s);
    expect(ach).toContain('price--medals');
    expect(ach).toContain('Tout récupérer (220 Médailles)');
  });

  it('compte : confirmations en attente (Médailles, charges) affichées', () => {
    const state = {
      configured: true, identity: { nickname: 'Joueur-abc', guest: true }, profile: null, providers: null, providersLoaded: true,
      email: { stage: 'idle' as const, address: '', requestId: null }, conflict: null, message: null,
      sync: { status: 'idle' as const, lastAt: null, message: null },
      pending: { earned: 0, purchases: 1, legacy: false, claims: 2, charges: 3 }, busy: false,
    };
    const html = accountScreen({ state, methods: [] });
    expect(html).toContain('2 succès à confirmer');
    expect(html).toContain('3 charges de bonus à confirmer');
    expect(html).not.toContain('acct-logout'); // un profil invité n'a rien à quitter : jamais de déconnexion qui ferait perdre le profil
  });
});

describe('base de données : schéma v4 additif', () => {
  it('migration v3 → v4 : colonnes de bonus ajoutées, données conservées, copie de sauvegarde avant migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-db-'));
    try {
      const path = join(dir, 'classement.sqlite');
      const old = new DatabaseSync(path);
      for (let i = 0; i < 3; i++) old.exec(MIGRATIONS[i]);
      old.exec('PRAGMA user_version = 3');
      old.prepare("INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES ('p1', 'Axel', 'axel', 'h', 1)").run();
      old.prepare("INSERT INTO installs (install_id, player_id, earned, bucket, first_seen, last_sync) VALUES ('install-aaaa-1111', 'p1', 42, 10, 1, 1)").run();
      old.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES ('p1', 'shards', 'earn', 42, 'earn:install-aaaa-1111:42', 1)").run();
      old.close();
      const db = openDb(path);
      expect(SCHEMA_VERSION).toBe(4);
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
      const row = db.prepare('SELECT earned, bonus_boost, bonus_gel FROM installs').get();
      expect(row).toEqual({ earned: 42, bonus_boost: 0, bonus_gel: 0 });
      expect(db.prepare("SELECT amount FROM ledger WHERE ref = 'earn:install-aaaa-1111:42'").get()).toEqual({ amount: 42 });
      expect(existsSync(`${path}.avant-v3.bak`)).toBe(true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cohérence de la configuration', () => {
  it('chaque succès a des Médailles, aucun cosmétique non premium ne coûte d’Éclats, bonus Boost 50 / Gel 100, plafond 3', () => {
    expect(ACHIEVEMENT_CONFIG.reduce((t, a) => t + a.medals, 0)).toBe(1650);
    for (const i of CATALOG) if (i.acquire.type === 'price') expect(i.acquire.currency).not.toBe('shards');
    expect(BONUS_LIST.map((b) => [b.id, b.price])).toEqual([['boost', 50], ['gel', 100]]);
    expect(BONUS.maxActivationsPerRun).toBe(3);
  });
});

describe('régression : démarrage de l’application', () => {
  it('le service de compte est créé dans le constructeur, APRÈS le chargement de la sauvegarde (un initialiseur de champ plantait au lancement)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'app.ts'), 'utf8');
    expect(src).toMatch(/readonly account: AccountService;/);
    expect(src).not.toMatch(/readonly account = new AccountService/);
    const loaded = src.indexOf('this.save = res.data');
    const created = src.indexOf('this.account = new AccountService');
    expect(loaded).toBeGreaterThan(0);
    expect(created).toBeGreaterThan(loaded);
    // Avant toute écriture de la sauvegarde (normalizeSave peut persister)
    expect(created).toBeLessThan(src.indexOf('this.normalizeSave();'));
  });
});
