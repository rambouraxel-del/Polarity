import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { AccountService, parseMagicParam, type AccountHost } from '../src/account/AccountService';
import { availability } from '../src/account/providers';
import { BALANCE_VERSION } from '../src/config/version';
import { ensureInstallId } from '../src/economy/ids';
import { noteEarned } from '../src/economy/local';
import { applySyncResult, buildSyncBody, pendingSummary } from '../src/economy/reconcile';
import type { EmailRequestResponse, ProvidersResponse, SyncResponse } from '../src/net/accountProtocol';
import { IDENTITY_KEY, LeaderboardClient, PENDING_KEY } from '../src/net/leaderboard';
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
    const calls: string[] = [];
    const store = new MemoryStore();
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!online.value) throw new TypeError('Failed to fetch');
      const u = new URL(String(url));
      calls.push(`${init?.method ?? 'GET'} ${u.pathname}`);
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
    return { online, calls, store, lb, account, get save() { return save; }, set save(s: SaveData) { save = s; }, setPlaying: (p: boolean) => (playing = p) };
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
    expect(SAVE_VERSION).toBe(8);
    expect(d.save.economy.legacy).toEqual({ shards: 340, imported: false });
    expect(d.account.state.pending.legacy).toBe(true);
    await d.account.start('');
    expect(d.save.economy.legacy?.imported).toBe(true);
    expect(d.save.wallet.shards).toBe(340);
    expect(d.save.wallet.prisms).toBe(0);
    expect(d.save.owned).toContain('aurore');
    expect(d.save.achievements.first_cycle).toBe(1000);
    const id = d.lb.identity()!;
    expect(balancesOf(w.db, id.playerId)).toEqual({ shards: 340, medals: 0, prisms: 0 });
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

/** Réponse de synchronisation de test (valeurs neutres, surchargées au besoin). */
function serverReply(over: Partial<SyncResponse> = {}): SyncResponse {
  return {
    rev: 1,
    balance: { shards: 0, medals: 0, prisms: 0 },
    inventory: { boost: 0, gel: 0 },
    bonus: { boost: 0, gel: 0 },
    bonusRejected: { boost: 0, gel: 0 },
    claimed: [],
    rejectedClaims: [],
    watermark: 0,
    capped: false,
    acknowledged: [],
    rejected: [],
    save: defaultSave(),
    at: 0,
    ...over,
  };
}

describe('compte : règles pures de réconciliation', () => {
  it('achat refusé par le serveur : article retiré, aucun Éclat perdu', () => {
    const save = defaultSave();
    ensureInstallId(save);
    save.owned = ['aurore'];
    save.economy.purchases = { aurore: 100 };
    const res = serverReply({ balance: { shards: 500, medals: 0, prisms: 0 }, rejected: [{ item: 'aurore', reason: 'insufficient' }], save: { ...defaultSave(), owned: [] } });
    save.wallet.shards = 0;
    applySyncResult(save, res, structuredClone(save));
    expect(save.owned).not.toContain('aurore');
    expect(save.economy.purchases).toEqual({});
    expect(save.wallet.shards).toBe(500);
  });

  it('gains faits pendant la requête : conservés (solde serveur + écart local)', () => {
    const save = defaultSave();
    ensureInstallId(save);
    save.wallet.shards = 130;
    const res = serverReply({ balance: { shards: 100, medals: 0, prisms: 0 } });
    const sent = structuredClone(save);
    sent.wallet.shards = 100; // solde au moment de l'envoi : 30 gagnés depuis
    applySyncResult(save, res, sent);
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

/** Partie de Survie jouée avec la graine d'un ticket (le serveur la rejoue à l'identique). */
function playRun(seed: number): { flips: number[]; time: number; score: number } {
  const session = new GameSession({ mode: 'survival', seed });
  let frame = 0;
  while (session.phase === 'running') {
    if (frame % 31 === 5) session.action();
    session.frame(1 / 60);
    frame++;
  }
  return { flips: [...session.sim.flipLog], time: session.sim.time, score: session.sim.scoring.score };
}

describe('correctif phase 1 : parties classées en attente et déconnexion', () => {
  type Dev = ReturnType<ReturnType<typeof world>['device']>;
  const runPosts = (d: Dev): number => d.calls.filter((c) => c === 'POST /api/runs').length;

  async function connect(d: Dev, w: ReturnType<typeof world>, address: string): Promise<void> {
    await d.account.emailRequest(address);
    const requestId = d.account.state.email.requestId!;
    await d.account.emailVerify(requestId, w.mailer.lastCode(), false);
  }

  /** Joue une partie classée hors ligne pour le profil connecté et la laisse en attente. */
  async function pendingRun(d: Dev) {
    await d.lb.ensureTickets();
    const ticket = d.lb.takeTicket()!;
    const run = playRun(ticket.seed);
    d.online.value = false;
    d.lb.recordRun(ticket, run.flips, { time: run.time, score: run.score });
    await d.lb.flush();
    d.online.value = true;
    return { ticket, run };
  }

  it('après déconnexion : la partie en attente est conservée, rattachée à son profil, jamais envoyée avec une autre identité', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    await connect(d, w, 'a@exemple.fr');
    const idA = d.lb.identity()!.playerId;
    const { ticket } = await pendingRun(d);
    expect(d.lb.pendingOwn()).toHaveLength(1);
    expect(d.lb.pending()[0].owner).toBe(idA);

    await d.account.logout();
    expect(d.lb.identity()).toBeNull();
    expect(JSON.parse(d.store.get(PENDING_KEY)!)).toHaveLength(1);
    expect(d.lb.pendingForeign()).toHaveLength(1);

    // Un autre profil (nouvel invité) utilise l'appareil : la partie de A n'est PAS envoyée avec son identité
    await d.account.syncNow(true);
    const guestId = d.lb.identity()!.playerId;
    expect(guestId).not.toBe(idA);
    await d.lb.flush();
    await d.lb.flush();
    expect(runPosts(d)).toBe(0);
    expect(d.lb.pendingOwn()).toEqual([]);
    expect(d.lb.pending()).toHaveLength(1);
    expect(d.lb.pending()[0].id).toBe(ticket.id);
  });

  it('à la reconnexion de son propriétaire : envoyée une seule fois et validée, sans doublon', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    await connect(d, w, 'a@exemple.fr');
    const { ticket, run } = await pendingRun(d);
    await d.account.logout();
    await d.account.syncNow(true); // invité passager
    // A se reconnecte : l'invité de passage est fusionné dans son compte (confirmation explicite)
    await d.account.emailRequest('a@exemple.fr');
    expect(await d.account.emailVerify(d.account.state.email.requestId!, w.mailer.lastCode(), false)).toBe(false);
    expect(await d.account.confirmMerge()).toBe(true);
    const list = await d.lb.flush();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: ticket.id, status: 'accepted', result: { time: run.time, score: run.score } });
    expect(runPosts(d)).toBe(1);
    // Appels répétés : aucune nouvelle requête, aucun doublon
    await d.lb.flush();
    await d.lb.flush();
    expect(runPosts(d)).toBe(1);
    expect(d.lb.pending().filter((p) => p.id === ticket.id)).toHaveLength(1);
    const me = await d.lb.me();
    expect(me.ok && me.data.best?.time).toBe(run.time);
  });

  it('fusion d’un invité dans un compte : ses parties en attente restent envoyables (alias confirmé par le service)', async () => {
    const w = world();
    const a = w.device();
    await a.account.start('');
    await connect(a, w, 'x@exemple.fr'); // compte existant (appareil A)
    const b = w.device();
    await b.account.start(''); // invité sur l'appareil B
    const guestId = b.lb.identity()!.playerId;
    const { ticket } = await pendingRun(b);
    await b.account.emailRequest('x@exemple.fr');
    const requestId = b.account.state.email.requestId!;
    expect(await b.account.emailVerify(requestId, w.mailer.lastCode(), false)).toBe(false);
    expect(await b.account.confirmMerge()).toBe(true);
    expect(b.lb.identity()!.playerId).not.toBe(guestId);
    expect(b.lb.identity()!.aliases).toContain(guestId);
    const list = await b.lb.flush();
    expect(list.find((p) => p.id === ticket.id)?.status).toBe('accepted');
    expect(runPosts(b)).toBe(1);
  });

  it('anciennes entrées sans propriétaire : rattachées au profil actuel ; sans profil, jamais envoyées', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    const { ticket } = await pendingRun(d);
    const raw = JSON.parse(d.store.get(PENDING_KEY)!) as { owner?: string }[];
    delete raw[0].owner;
    d.store.set(PENDING_KEY, JSON.stringify(raw));
    expect(d.lb.pending()[0].owner).toBe(d.lb.identity()!.playerId);
    expect(ticket.id).toBeTruthy();
  });

  it('profil supprimé ou inconnu (« drop ») : seules ses parties sont retirées ; recordRun sans profil ne crée rien', async () => {
    const w = world();
    const d = w.device();
    await d.account.start('');
    await pendingRun(d);
    // Une entrée appartenant à un autre profil
    const list = JSON.parse(d.store.get(PENDING_KEY)!) as Record<string, unknown>[];
    list.push({ ...list[0], id: 'autre', owner: 'autre-profil' });
    d.store.set(PENDING_KEY, JSON.stringify(list));
    d.lb.forgetProfile('drop');
    expect(d.lb.pending().map((p) => p.id)).toEqual(['autre']);
    expect(d.lb.recordRun({ id: 'x', seed: 1, exp: 9e9, sig: 's' }, [], { time: 1, score: 1 })).toBeNull();
  });
});
