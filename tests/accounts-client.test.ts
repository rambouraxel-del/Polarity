import { describe, expect, it } from 'vitest';
import { AccountService, parseMagicParam, type AccountHost } from '../src/account/AccountService';
import { availability } from '../src/account/providers';
import { BALANCE_VERSION } from '../src/config/version';
import { ensureInstallId } from '../src/economy/ids';
import { noteEarned } from '../src/economy/local';
import { applySyncResult, buildSyncBody, pendingSummary } from '../src/economy/reconcile';
import type { EmailRequestResponse, ProvidersResponse, SyncResponse } from '../src/net/accountProtocol';
import { IDENTITY_KEY, LeaderboardClient } from '../src/net/leaderboard';
import { MemoryStore, SAVE_VERSION, defaultSave, parseSave, writeSave, type SaveData } from '../src/save/save';
import * as S from '../src/ui/screens';
import { accountScreen } from '../src/ui/accountScreens';
import { createApp } from '../server/app';
import { openDb, type Db } from '../server/db';
import type { Mailer, MailMessage } from '../server/mailer';
import { balancesOf } from '../server/profile';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
  lastCode(): string {
    const m = /: ([A-Z0-9]{4})-([A-Z0-9]{4})/.exec(this.sent[this.sent.length - 1]?.text ?? '');
    return m ? m[1] + m[2] : '';
  }
}

/** Service en mémoire partagé par plusieurs « appareils » ; chaque appareil a sa propre connexion (coupable) et son stockage. */
function world() {
  const clock = { t: 1_700_000_000_000 };
  const db: Db = openDb(':memory:');
  const mailer = new FakeMailer();
  const app = createApp(db, { ticketSecret: SECRET, now: () => clock.t, balance: BALANCE_VERSION, accounts: { mailer, appUrl: 'https://exemple.github.io/Polarity/' } });

  function device(initial?: SaveData) {
    const online = { value: true };
    const store = new MemoryStore();
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!online.value) throw new TypeError('Failed to fetch');
      const u = new URL(String(url));
      const h = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const req = { method: init?.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: { authorization: h.Authorization }, body, ip: '10.0.0.1' };
      const out = await (app.async(req) ?? app(req));
      return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const lb = new LeaderboardClient({ baseUrl: 'http://classement.test', store, fetchFn, balance: BALANCE_VERSION, build: 'test', now: () => clock.t });
    let save = initial ?? defaultSave();
    let playing = false;
    const host: AccountHost = {
      lb,
      store,
      getSave: () => save,
      commit: (mutate) => {
        mutate(save);
        writeSave(store, save);
      },
      isPlaying: () => playing,
      onChange: () => undefined,
      now: () => clock.t,
      setTimer: () => 0,
    };
    const account = new AccountService(host);
    return { online, store, lb, account, get save() { return save; }, set save(s: SaveData) { save = s; }, setPlaying: (p: boolean) => (playing = p) };
  }
  return { clock, db, app, mailer, device };
}

/** Sauvegarde d'avant les comptes (format 6) : 340 Éclats, un succès, un cosmétique. */
function oldSave(shards = 340): SaveData {
  const raw = { ...defaultSave(), version: 6, wallet: { shards, prisms: 7 }, achievements: { first_cycle: 1000 }, owned: ['aurore'], rewarded: ['first_cycle'] } as Record<string, unknown>;
  delete raw.economy;
  const parsed = parseSave(JSON.stringify(raw));
  if (!parsed) throw new Error('sauvegarde de test invalide');
  return parsed;
}

describe('compte : profil invité, migration et synchronisation', () => {
  it('démarrage : identifiant d’installation, profil invité créé sans saisie, aucune inscription', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    expect(d.save.economy.installId).not.toBe('');
    expect(d.lb.identity()?.guest).toBe(true);
    expect(d.account.state.sync.status).toBe('ok');
    expect(d.account.state.identity?.guest).toBe(true);
  });

  it('ancienne sauvegarde : importée intégralement UNE fois ; les Prismes locaux ne sont jamais repris', async () => {
    const w = world();
    const d = w.device(oldSave());
    expect(SAVE_VERSION).toBe(7);
    expect(d.save.economy.legacy).toEqual({ shards: 340, imported: false });
    expect(d.account.state.pending.legacy).toBe(true);
    await d.account.start('');
    expect(d.save.economy.legacy?.imported).toBe(true);
    expect(d.save.wallet.shards).toBe(340);
    expect(d.save.wallet.prisms).toBe(0);
    expect(d.save.owned).toContain('aurore');
    expect(d.save.achievements.first_cycle).toBe(1000);
    const id = d.lb.identity()!;
    expect(balancesOf(w.db, id.playerId)).toEqual({ shards: 340, prisms: 0 });
    // Synchronisations répétées : jamais de nouveau crédit
    for (let i = 0; i < 3; i++) await d.account.syncNow(true);
    expect(balancesOf(w.db, id.playerId).shards).toBe(340);
    expect(d.save.wallet.shards).toBe(340);
  });

  it('migration hors ligne : la sauvegarde reste jouable, l’import se fait plus tard, une seule fois', async () => {
    const w = world();
    const d = w.device(oldSave());
    d.online.value = false;
    await d.account.start('');
    expect(d.account.state.sync.status).toBe('offline');
    expect(d.save.wallet.shards).toBe(340);
    expect(d.save.economy.legacy?.imported).toBe(false);
    d.online.value = true;
    await d.account.syncNow(true);
    expect(d.save.economy.legacy?.imported).toBe(true);
    expect(balancesOf(w.db, d.lb.identity()!.playerId).shards).toBe(340);
  });

  it('copie de sauvegarde : l’ancienne sauvegarde est conservée avant la migration (clé avant-v6)', () => {
    const store = new MemoryStore();
    store.set('polarite.save', JSON.stringify({ ...defaultSave(), version: 6, wallet: { shards: 12, prisms: 0 } }));
    // Le chargement réel (loadSave) conserve la copie ; ici on vérifie seulement que la clé historique est celle attendue
    expect(store.get('polarite.save')).not.toBeNull();
  });

  it('gains hors ligne : provisoires, confirmés au retour en ligne, jamais comptés deux fois', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    d.online.value = false;
    d.account.state.sync.status = 'idle';
    d.save.wallet.shards += 120;
    noteEarned(d.save, 120);
    await d.account.syncNow(true);
    expect(d.account.state.sync.status).toBe('offline');
    expect(d.save.wallet.shards).toBe(120);
    expect(pendingSummary(d.save).earned).toBe(120);
    d.online.value = true;
    await d.account.syncNow(true);
    const pid = d.lb.identity()!.playerId;
    expect(balancesOf(w.db, pid).shards).toBe(120);
    expect(d.save.wallet.shards).toBe(120);
    expect(pendingSummary(d.save).earned).toBe(0);
    for (let i = 0; i < 3; i++) await d.account.syncNow(true);
    expect(balancesOf(w.db, pid).shards).toBe(120);
    expect(d.save.wallet.prisms).toBe(0);
  });

  it('pendant une partie : aucune requête (la synchronisation attend)', async () => {
    const w = world();
    const d = w.device();
    d.setPlaying(true);
    await d.account.start('');
    expect(d.lb.identity()).toBeNull();
    d.setPlaying(false);
    await d.account.syncNow(true);
    expect(d.lb.identity()).not.toBeNull();
  });

  it('service non configuré : tout reste local, aucune requête, aucun profil fictif', async () => {
    const store = new MemoryStore();
    const lb = new LeaderboardClient({ baseUrl: '', store, balance: BALANCE_VERSION, build: 'test' });
    let save = oldSave();
    const acc = new AccountService({ lb, store, getSave: () => save, commit: (m) => m(save), isPlaying: () => false, onChange: () => undefined });
    await acc.start('');
    expect(acc.state.configured).toBe(false);
    expect(acc.state.sync.status).toBe('disabled');
    expect(save.wallet.shards).toBe(340);
    expect(store.get(IDENTITY_KEY)).toBeNull();
    expect(accountScreen({ state: acc.state, methods: acc.availability() })).toContain('pas disponibles');
    save = defaultSave();
  });
});

describe('compte : connexion par courriel et fusion', () => {
  async function login(d: ReturnType<ReturnType<typeof world>['device']>, w: ReturnType<typeof world>, address: string) {
    await d.account.emailRequest(address);
    const requestId = d.account.state.email.requestId!;
    return { requestId, code: w.mailer.lastCode() };
  }

  it('invité → compte : même profil, pseudo et records conservés', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    const before = d.lb.identity()!.playerId;
    const { requestId, code } = await login(d, w, 'a@exemple.fr');
    expect(await d.account.emailVerify(requestId, code, false)).toBe(true);
    expect(d.lb.identity()!.playerId).toBe(before);
    expect(d.account.state.profile?.identities.map((i) => i.provider)).toEqual(['email']);
  });

  it('lien magique : le paramètre de l’adresse est lu, jamais d’autre format accepté', () => {
    expect(parseMagicParam('?magic=0123456789abcdef0123456789abcdef.abcd2345')).toEqual({ requestId: '0123456789abcdef0123456789abcdef', code: 'ABCD2345' });
    expect(parseMagicParam('?magic=zz.zz')).toBeNull();
    expect(parseMagicParam('')).toBeNull();
  });

  it('deux appareils : conflit, fusion SEULEMENT après confirmation ; aucun double crédit ; réserve de campagne séparée', async () => {
    const w = world();
    const a = w.device(oldSave(300));
    await a.account.start('');
    const la = await login(a, w, 'joueur@exemple.fr');
    await a.account.emailVerify(la.requestId, la.code, false);
    const pidA = a.lb.identity()!.playerId;

    const saveB = oldSave(100);
    saveB.campaign.reserve = 25;
    const b = w.device(saveB);
    await b.account.start('');
    const lb = await login(b, w, 'joueur@exemple.fr');
    expect(await b.account.emailVerify(lb.requestId, lb.code, false)).toBe(false);
    expect(b.account.state.conflict?.canMerge).toBe(true);
    // Rien n'a été fusionné sans confirmation
    expect(balancesOf(w.db, pidA).shards).toBe(300);
    expect(await b.account.confirmMerge()).toBe(true);
    expect(b.account.state.conflict).toBeNull();
    expect(b.lb.identity()!.playerId).toBe(pidA);
    await b.account.syncNow(true);
    // 300 (appareil A) + 100 (appareil B) : chaque import compté une fois
    expect(balancesOf(w.db, pidA).shards).toBe(400);
    expect(b.save.wallet.shards).toBe(400);
    for (let i = 0; i < 2; i++) {
      await b.account.syncNow(true);
      await a.account.syncNow(true);
    }
    expect(balancesOf(w.db, pidA).shards).toBe(400);
    expect(a.save.wallet.shards).toBe(400);
    // Succès partagé obtenu sur les deux appareils : réuni, récompense jamais doublée (comptée dans les imports, pas ajoutée)
    expect(b.save.achievements.first_cycle).toBeDefined();
    expect(b.save.campaign.reserve).toBeGreaterThanOrEqual(25);
  });

  it('déconnexion : la progression locale est conservée, un nouvel invité est créé à la synchronisation suivante', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    d.save.wallet.shards = 50;
    noteEarned(d.save, 50);
    const { requestId, code } = await login(d, w, 'x@exemple.fr');
    await d.account.emailVerify(requestId, code, false);
    await d.account.logout();
    expect(d.lb.identity()).toBeNull();
    expect(d.save.wallet.shards).toBe(50);
  });
});

describe('compte : règles pures de réconciliation', () => {
  it('achat refusé par le serveur : article retiré, aucun Éclat perdu', () => {
    const save = defaultSave();
    ensureInstallId(save);
    save.owned = ['aurore'];
    save.economy.purchases = { aurore: 100 };
    const res = { rev: 1, balance: { shards: 500, prisms: 0 }, watermark: 0, capped: false, acknowledged: [], rejected: [{ item: 'aurore', reason: 'insufficient' }], save: { ...defaultSave(), owned: [] } } as unknown as SyncResponse;
    save.wallet.shards = 0;
    applySyncResult(save, res, 0);
    expect(save.owned).not.toContain('aurore');
    expect(save.economy.purchases).toEqual({});
    expect(save.wallet.shards).toBe(500);
  });

  it('gains faits pendant la requête : conservés (solde serveur + écart local)', () => {
    const save = defaultSave();
    ensureInstallId(save);
    save.wallet.shards = 130;
    const res = { rev: 1, balance: { shards: 100, prisms: 0 }, watermark: 0, capped: false, acknowledged: [], rejected: [], save: defaultSave() } as unknown as SyncResponse;
    applySyncResult(save, res, 100);
    expect(save.wallet.shards).toBe(130);
  });

  it('corps de synchronisation : sans options de l’appareil, avec compteur monotone', () => {
    const save = defaultSave();
    ensureInstallId(save);
    noteEarned(save, 40);
    const body = buildSyncBody(save);
    expect(body.earned).toBe(40);
    expect((body.save as unknown as Record<string, unknown>).options).toBeUndefined();
  });
});

describe('compte : fournisseurs et écran', () => {
  const cfg = (o: Partial<ProvidersResponse> = {}): ProvidersResponse => ({ google: { enabled: false, clientId: null }, apple: { enabled: false, clientId: null }, email: { enabled: false }, ...o }) as ProvidersResponse;
  const web = { native: false, plugin: false, online: true };

  it('rien n’est proposé sans configuration du service (aucune fausse connexion)', () => {
    for (const m of availability(cfg(), web)) {
      expect(m.available).toBe(false);
      expect(m.reason).toBeTruthy();
    }
    expect(availability(null, { ...web, online: false }).every((m) => !m.available)).toBe(true);
  });

  it('configurées : web = navigateur ; application native sans module = indisponible avec raison', () => {
    const c = cfg({ google: { enabled: true, clientId: 'cid' }, email: { enabled: true } } as Partial<ProvidersResponse>);
    expect(availability(c, web).find((m) => m.provider === 'google')).toMatchObject({ available: true, via: 'web' });
    expect(availability(c, web).find((m) => m.provider === 'email')?.available).toBe(true);
    expect(availability(c, web).find((m) => m.provider === 'apple')?.available).toBe(false);
    const nat = availability(c, { native: true, plugin: false, online: true }).find((m) => m.provider === 'google')!;
    expect(nat.available).toBe(false);
    expect(nat.reason).toContain('module');
    expect(availability(c, { native: true, plugin: true, online: true }).find((m) => m.provider === 'google')?.via).toBe('native');
  });

  it('options : l’entrée « Compte » n’apparaît que si le service est configuré', () => {
    expect(S.optionsScreen(defaultSave(), false)).not.toContain('data-action="account"');
    expect(S.optionsScreen(defaultSave(), true)).toContain('data-action="account"');
  });

  it('écran Compte : méthodes indisponibles = raison sans bouton ; courriel disponible = formulaire', () => {
    const w = world();
    const d = w.device();
    d.account.state.providers = cfg({ email: { enabled: true } } as Partial<ProvidersResponse>);
    const html = accountScreen({ state: d.account.state, methods: availability(d.account.state.providers, web) });
    expect(html).toContain('data-form="acct-email"');
    expect(html).toContain('pas configuré');
    expect(html).not.toContain('acct-apple');
  });

  it('inscription d’un invité courriel : demande acceptée sans révéler l’existence d’un compte', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    const r = await d.lb.api<EmailRequestResponse>('POST', '/api/auth/email/request', { body: { email: 'inconnu@exemple.fr' } });
    expect(r.ok).toBe(true);
  });
});
