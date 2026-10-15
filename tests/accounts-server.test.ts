import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { BALANCE_VERSION } from '../src/config/version';
import { ACHIEVEMENT_CONFIG } from '../src/config/achievements';
import { LEVEL_REWARDS } from '../src/config/economy';
import { REPLAY_FORMAT, type LeaderboardResponse, type RunSubmission, type TicketsResponse } from '../src/net/protocol';
import type { AuthResponse, ConflictResponse, EmailRequestResponse, NonceResponse, ProfileResponse, ProvidersResponse, SyncResponse } from '../src/net/accountProtocol';
import { defaultSave } from '../src/save/save';
import { SYNC_RULES } from '../src/economy/rules';
import { createApp, type App, type HttpRequest, type HttpResponse } from '../server/app';
import { LEGACY_SHARDS_CAP, maskEmail } from '../server/accounts';
import { openDb, type Db } from '../server/db';
import type { Mailer, MailMessage } from '../server/mailer';
import { balancesOf } from '../server/profile';
import { OidcError, nonceMatches } from '../server/oidc';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';
const HOUR = 3_600_000;

// ————————————————————————— jetons OIDC de test (clé RSA locale ; jamais de réseau)
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(rsa.publicKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'k1', use: 'sig', alg: 'RS256' };
const b64 = (o: unknown): string => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function idToken(claims: Record<string, unknown>, opts: { key?: typeof rsa; kid?: string; alg?: string } = {}): string {
  const header = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' });
  const payload = b64(claims);
  if (opts.alg === 'none') return `${header}.${payload}.`;
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign((opts.key ?? rsa).privateKey).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  fail = false;
  async send(m: MailMessage): Promise<void> {
    if (this.fail) throw new Error('boom');
    this.sent.push(m);
  }
  lastCode(): string {
    const m = /: ([A-Z0-9]{4})-([A-Z0-9]{4})/.exec(this.sent[this.sent.length - 1]?.text ?? '');
    return m ? m[1] + m[2] : '';
  }
}

interface Ctx {
  db: Db;
  app: App;
  now: { t: number };
  mailer: FakeMailer;
  call: (method: string, path: string, o?: { body?: unknown; auth?: string; ip?: string }) => HttpResponse;
  acall: (method: string, path: string, o?: { body?: unknown; auth?: string; ip?: string }) => Promise<HttpResponse>;
}

function ctx(opts: { google?: boolean; apple?: boolean; email?: boolean } = {}, db: Db = openDb(':memory:'), now = { t: 1_700_000_000_000 }): Ctx {
  const mailer = new FakeMailer();
  const app = createApp(db, {
    ticketSecret: SECRET,
    now: () => now.t,
    balance: BALANCE_VERSION,
    accounts: {
      google: opts.google ? { audiences: ['cid-web', 'cid-android'], web: 'cid-web' } : undefined,
      apple: opts.apple ? { audiences: ['fr.test.service'], web: 'fr.test.service' } : undefined,
      mailer: opts.email ? mailer : null,
      appUrl: 'https://exemple.github.io/Polarity/',
      jwksFetcher: async () => ({ keys: [jwk as never] }),
    },
  });
  const req = (method: string, path: string, o: { body?: unknown; auth?: string; ip?: string } = {}): HttpRequest => ({
    method,
    path,
    query: new URLSearchParams(),
    headers: { authorization: o.auth ? `Bearer ${o.auth}` : undefined },
    body: o.body,
    ip: o.ip ?? '10.0.0.1',
  });
  return {
    db,
    app,
    now,
    mailer,
    call: (m, p, o) => app(req(m, p, o)),
    acall: async (m, p, o) => {
      const pending = app.async(req(m, p, o));
      if (!pending) throw new Error(`pas une route asynchrone : ${p}`);
      return pending;
    },
  };
}

const auth = (r: AuthResponse): string => `${r.playerId}.${r.token}`;

function guest(c: Ctx, ip = '10.0.0.1'): { id: string; auth: string; nickname: string } {
  const res = c.call('POST', '/api/register', { body: {}, ip });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const b = res.body as { playerId: string; token: string; nickname: string; guest: boolean };
  expect(b.guest).toBe(true);
  return { id: b.playerId, auth: `${b.playerId}.${b.token}`, nickname: b.nickname };
}

function pseudo(c: Ctx, nickname: string, ip = '10.0.0.1'): { id: string; auth: string } {
  const res = c.call('POST', '/api/register', { body: { nickname }, ip });
  expect(res.status).toBe(201);
  const b = res.body as { playerId: string; token: string };
  return { id: b.playerId, auth: `${b.playerId}.${b.token}` };
}

async function nonce(c: Ctx): Promise<string> {
  const r = c.call('POST', '/api/auth/nonce');
  expect(r.status).toBe(200);
  return (r.body as NonceResponse).nonce;
}

async function googleLogin(c: Ctx, sub: string, o: { auth?: string; merge?: boolean; claims?: Record<string, unknown>; key?: typeof rsa; n?: string; alg?: string } = {}): Promise<HttpResponse> {
  const n = o.n ?? (await nonce(c));
  const token = idToken(
    { iss: 'https://accounts.google.com', aud: 'cid-web', sub, email: `${sub}@exemple.fr`, exp: Math.floor(c.now.t / 1000) + 600, iat: Math.floor(c.now.t / 1000), nonce: n, ...o.claims },
    { key: o.key, alg: o.alg },
  );
  return c.acall('POST', '/api/auth/google', { body: { idToken: token, nonce: n, merge: o.merge }, auth: o.auth });
}

/** Sauvegarde locale d'AVANT les comptes (format 6), avec du contenu à importer. */
const legacySave = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 6,
  balance: BALANCE_VERSION,
  levels: { '1': { completed: true, bestScore: 900, stars: 2 } },
  survival: { bestTime: 123.4, bestScore: 5000, runs: 7 },
  achievements: { first_cycle: 1000, first_level: 2000 },
  rewarded: ['first_cycle', 'first_level'],
  wallet: { shards: 340, prisms: 50 },
  owned: ['aurore', 'neon'],
  paid: { '1': { first: true, stars: 2 } },
  stats: { totalCycles: 40, totalRuns: 7, totalShards: 50, totalEvents: 3, bestScore: 5000, bestMultiplier: 4 },
  campaign: { missions: { n1: { main: true, challenge: false, clears: 1, bestTime: 90 } }, seen: ['n1-before'], reserve: 40, upgrades: { owned: [], enabled: [] }, chapterComplete: false },
  ...over,
});

const migrateBody = (installId: string, save: unknown): { installId: string; save: unknown } => ({ installId, save });

function playRun(seed: number): { flips: number[]; time: number; score: number } {
  const session = new GameSession({ mode: 'survival', seed });
  let frame = 0;
  while (session.phase === 'running') {
    if (frame % 29 === 7) session.action();
    session.frame(1 / 60);
    if (++frame > 60 * 600) throw new Error('la partie ne se termine pas');
  }
  return { flips: [...session.sim.flipLog], time: session.sim.time, score: session.sim.scoring.score };
}

const sync = (c: Ctx, who: { auth: string }, body: { installId: string; earned?: number; purchases?: Record<string, number>; claims?: string[]; bonusBought?: { boost: number; gel: number }; save?: unknown }): HttpResponse =>
  c.call('POST', '/api/sync', { auth: who.auth, body: { earned: 0, purchases: {}, claims: [], bonusBought: { boost: 0, gel: 0 }, save: defaultSave(), ...body } });

/** Sauvegarde dont ces succès sont accomplis (progression déclarée par le client). */
function achieved(...ids: string[]): ReturnType<typeof defaultSave> {
  const save = defaultSave();
  ids.forEach((id, i) => (save.achievements[id] = 1000 + i));
  save.medals.claimed = [...ids];
  return save;
}

/** 140 Médailles : de quoi acheter « aurore » (survive_300 = 100, first_cycle = 20, first_level = 20). */
const MEDAL_140 = ['survive_300', 'first_cycle', 'first_level'];

const ledgerRows = (c: Ctx, id: string): { kind: string; amount: number; ref: string }[] => c.db.prepare('SELECT kind, amount, ref FROM ledger WHERE player_id = ? ORDER BY id').all(id) as never;

// ————————————————————————————————————————————————————————————————————————————————

describe('comptes : profil invité et classement', () => {
  it('profil invité sans inscription : pseudo « Joueur-xxxxxx », absent du classement public jusqu’au choix d’un pseudo', () => {
    const c = ctx();
    const g = guest(c);
    expect(g.nickname).toMatch(/^Joueur-[0-9a-f]{6}$/);
    const [t] = (c.call('POST', '/api/tickets', { auth: g.auth }).body as TicketsResponse).tickets;
    c.now.t += 5000;
    const run = playRun(t.seed);
    const sub: RunSubmission = { ticket: t, replay: { v: REPLAY_FORMAT, flips: run.flips }, claimed: { time: run.time, score: run.score }, client: { balance: BALANCE_VERSION, build: 't' } };
    expect(c.call('POST', '/api/runs', { auth: g.auth, body: sub }).status).toBe(200);
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries).toHaveLength(0);
    expect(c.call('PATCH', '/api/me', { auth: g.auth, body: { nickname: 'Axel' } }).status).toBe(200);
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries[0]).toMatchObject({ nickname: 'Axel', time: run.time });
  });

  it('le profil existant du classement est réutilisé : pseudo et records conservés, aucune migration destructive', () => {
    const c = ctx();
    const a = pseudo(c, 'Axel');
    expect(c.call('GET', '/api/profile', { auth: a.auth }).body).toMatchObject({ nickname: 'Axel', guest: false, canBuyPremium: false });
  });
});

describe('comptes : méthodes de connexion désactivées sans configuration', () => {
  it('aucune méthode n’est active : fournisseurs masqués, routes 503, aucune fausse connexion', async () => {
    const c = ctx();
    const p = c.call('GET', '/api/auth/providers').body as ProvidersResponse;
    expect(p).toEqual({ google: { enabled: false }, apple: { enabled: false }, email: { enabled: false } });
    expect((await googleLogin(c, 'x')).status).toBe(503);
    expect((await c.acall('POST', '/api/auth/apple', { body: { idToken: 'a.b.c', nonce: 'n'.repeat(20) } })).status).toBe(503);
    expect((await c.acall('POST', '/api/auth/email/request', { body: { email: 'a@exemple.fr' } })).status).toBe(503);
    expect(c.call('POST', '/api/auth/email/verify', { body: { requestId: 'a'.repeat(32), code: 'AAAAAAAA' } }).status).toBe(503);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM identities').get()).toEqual({ n: 0 });
  });

  it('configurées : seuls les identifiants clients PUBLICS sont exposés, jamais un secret', () => {
    const c = ctx({ google: true, apple: true, email: true });
    const p = c.call('GET', '/api/auth/providers').body as ProvidersResponse;
    expect(p).toEqual({ google: { enabled: true, clientId: 'cid-web' }, apple: { enabled: true, clientId: 'fr.test.service' }, email: { enabled: true } });
    expect(JSON.stringify(p)).not.toMatch(/secret|key|SECRET/i);
  });
});

describe('comptes : Google / Apple (OpenID Connect)', () => {
  it('connexion sans profil : nouveau profil, accès propre à l’appareil, courriel masqué', async () => {
    const c = ctx({ google: true });
    const r = await googleLogin(c, 'sub-1');
    expect(r.status).toBe(201);
    const b = r.body as AuthResponse;
    expect(b).toMatchObject({ created: true, guest: true });
    expect(b.token).toBeTruthy();
    expect(b.identities).toEqual([{ provider: 'google', label: maskEmail('sub-1@exemple.fr') }]);
    expect(c.call('GET', '/api/profile', { auth: auth(b) }).body).toMatchObject({ canBuyPremium: true });
  });

  it('nouvel appareil : même sujet = même profil (accès supplémentaire), l’ancien accès continue de fonctionner', async () => {
    const c = ctx({ google: true });
    const first = (await googleLogin(c, 'sub-1')).body as AuthResponse;
    const second = (await googleLogin(c, 'sub-1', { auth: undefined })).body as AuthResponse;
    expect(second.playerId).toBe(first.playerId);
    expect(second.token).not.toBe(first.token);
    expect(c.call('GET', '/api/profile', { auth: auth(first) }).status).toBe(200);
    expect(c.call('GET', '/api/profile', { auth: auth(second) }).status).toBe(200);
    // Déconnexion : seul l'accès de cet appareil est révoqué
    expect(c.call('POST', '/api/auth/logout', { auth: auth(second) }).body).toMatchObject({ revoked: true });
    expect(c.call('GET', '/api/profile', { auth: auth(second) }).status).toBe(401);
    expect(c.call('GET', '/api/profile', { auth: auth(first) }).status).toBe(200);
  });

  it('anti-rejeu : un nonce ne sert qu’une fois ; nonce inconnu, expiré ou différent du jeton refusés', async () => {
    const c = ctx({ google: true });
    const n = await nonce(c);
    expect((await googleLogin(c, 'sub-1', { n })).status).toBe(201);
    expect((await googleLogin(c, 'sub-1', { n })).status).toBe(400);
    expect((await googleLogin(c, 'sub-2', { n: 'inconnu-'.repeat(4) })).status).toBe(400);
    const n2 = await nonce(c);
    expect((await googleLogin(c, 'sub-3', { n: n2, claims: { nonce: 'autre-nonce-0123456789' } })).status).toBe(401);
    const n3 = await nonce(c);
    c.now.t += 11 * 60_000;
    expect((await googleLogin(c, 'sub-4', { n: n3, claims: { exp: Math.floor(c.now.t / 1000) + 600 } })).status).toBe(400);
  });

  it('jetons falsifiés refusés : mauvaise signature, algorithme « none », mauvais émetteur, mauvaise audience, expiré', async () => {
    const c = ctx({ google: true });
    expect((await googleLogin(c, 's', { key: other })).status).toBe(401);
    expect((await googleLogin(c, 's', { alg: 'none' })).status).toBe(401);
    expect((await googleLogin(c, 's', { claims: { iss: 'https://evil.example' } })).status).toBe(401);
    expect((await googleLogin(c, 's', { claims: { aud: 'autre-application' } })).status).toBe(401);
    expect((await googleLogin(c, 's', { claims: { exp: Math.floor(c.now.t / 1000) - 3600 } })).status).toBe(401);
    expect((await c.acall('POST', '/api/auth/google', { body: { idToken: 'x'.repeat(9000), nonce: 'n'.repeat(20) } })).status).toBe(400);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM identities').get()).toEqual({ n: 0 });
    expect(nonceMatches(undefined, 'x')).toBe(false);
    expect(new OidcError('expired').code).toBe('expired');
  });

  it('association à un profil existant : ajoutée, mais une seule méthode par fournisseur', async () => {
    const c = ctx({ google: true });
    const g = guest(c);
    const r = await googleLogin(c, 'sub-1', { auth: g.auth });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ playerId: g.id });
    expect(((r.body as AuthResponse).token ?? '')).toBe('');
    expect((await googleLogin(c, 'sub-2', { auth: g.auth })).status).toBe(409);
    // Authentification invalide + jeton valide : jamais d'association à un profil non authentifié
    expect((await googleLogin(c, 'sub-3', { auth: `${g.id}.${'A'.repeat(43)}` })).status).toBe(401);
  });

  it('Apple : même mécanisme, audience propre ; nonce haché (SHA-256) accepté', async () => {
    const c = ctx({ apple: true });
    const n = await nonce(c);
    const { createHash } = await import('node:crypto');
    const token = idToken({ iss: 'https://appleid.apple.com', aud: 'fr.test.service', sub: 'apple-1', exp: Math.floor(c.now.t / 1000) + 600, nonce: createHash('sha256').update(n).digest('hex') });
    const r = await c.acall('POST', '/api/auth/apple', { body: { idToken: token, nonce: n } });
    expect(r.status).toBe(201);
    expect((r.body as AuthResponse).identities[0].provider).toBe('apple');
  });
});

describe('comptes : fusion de profils (sans fusion non autorisée)', () => {
  it('conflit : le compte existe déjà → 409 sans rien modifier ; fusion seulement avec confirmation explicite', async () => {
    const c = ctx({ google: true });
    const account = (await googleLogin(c, 'sub-A')).body as AuthResponse; // compte existant (profil créé par la connexion)
    const guestB = guest(c, '10.0.0.2');
    const conflict = await googleLogin(c, 'sub-A', { auth: guestB.auth });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: 'identity_conflict', canMerge: true } satisfies Partial<ConflictResponse>);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM players WHERE merged_into IS NOT NULL').get()).toEqual({ n: 0 });
    const merged = await googleLogin(c, 'sub-A', { auth: guestB.auth, merge: true });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ playerId: account.playerId, merged: true });
    // L'ancien accès de l'invité agit désormais sur le compte (alias) ; le registre des fusions garde la trace
    expect(c.call('GET', '/api/profile', { auth: guestB.auth }).body).toMatchObject({ playerId: account.playerId });
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM merges').get()).toEqual({ n: 1 });
  });

  it('un profil qui possède déjà un compte n’est JAMAIS fusionné (collision / prise de contrôle)', async () => {
    const c = ctx({ google: true, apple: true });
    const a = (await googleLogin(c, 'sub-A')).body as AuthResponse;
    const bAcc = (await googleLogin(c, 'sub-B')).body as AuthResponse;
    const refused = await googleLogin(c, 'sub-A', { auth: auth(bAcc), merge: true });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'merge_not_allowed' });
    expect(c.call('GET', '/api/profile', { auth: auth(a) }).body).toMatchObject({ playerId: a.playerId });
    expect(c.call('GET', '/api/profile', { auth: auth(bAcc) }).body).toMatchObject({ playerId: bAcc.playerId });
  });

  it('records vérifiés : le meilleur des deux profils est conservé, parties rattachées, pseudo choisi repris', async () => {
    const c = ctx({ google: true });
    const account = (await googleLogin(c, 'sub-A')).body as AuthResponse; // invité sans record
    const b = pseudo(c, 'Bea', '10.0.0.2');
    const [t] = (c.call('POST', '/api/tickets', { auth: b.auth }).body as TicketsResponse).tickets;
    c.now.t += 5000;
    const run = playRun(t.seed);
    expect(c.call('POST', '/api/runs', { auth: b.auth, body: { ticket: t, replay: { v: REPLAY_FORMAT, flips: run.flips }, claimed: { time: run.time, score: run.score }, client: { balance: BALANCE_VERSION, build: 't' } } }).status).toBe(200);
    const r = await googleLogin(c, 'sub-A', { auth: b.auth, merge: true });
    expect(r.body).toMatchObject({ playerId: account.playerId, merged: true, nickname: 'Bea', guest: false });
    const top = c.call('GET', '/api/leaderboard').body as LeaderboardResponse;
    expect(top.entries).toHaveLength(1);
    expect(top.entries[0]).toMatchObject({ nickname: 'Bea', time: run.time });
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE player_id = ?').get(account.playerId)).toEqual({ n: 1 });
  });

  it('dissocier : jamais la dernière méthode de connexion', async () => {
    const c = ctx({ google: true, apple: true });
    const a = (await googleLogin(c, 'sub-A')).body as AuthResponse;
    expect(c.call('POST', '/api/auth/unlink', { auth: auth(a), body: { provider: 'google' } }).status).toBe(409);
    expect(c.call('POST', '/api/auth/unlink', { auth: auth(a), body: { provider: 'email' } }).status).toBe(404);
    expect(c.call('POST', '/api/auth/unlink', { body: { provider: 'google' } }).status).toBe(401);
  });
});

describe('comptes : lien magique par courriel', () => {
  async function requestCode(c: Ctx, email: string, ip = '10.0.0.1'): Promise<{ requestId: string; code: string }> {
    const r = await c.acall('POST', '/api/auth/email/request', { body: { email }, ip });
    expect(r.status).toBe(202);
    return { requestId: (r.body as EmailRequestResponse).requestId, code: c.mailer.lastCode() };
  }

  it('demande, courriel envoyé (code + lien), connexion ; le code ne sert qu’une fois', async () => {
    const c = ctx({ email: true });
    const { requestId, code } = await requestCode(c, 'Axel@Exemple.fr');
    expect(c.mailer.sent[0].to).toBe('axel@exemple.fr');
    expect(c.mailer.sent[0].text).toContain(`?magic=${requestId}.${code}`);
    const ok = c.call('POST', '/api/auth/email/verify', { body: { requestId, code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` } });
    expect(ok.status).toBe(201);
    expect((ok.body as AuthResponse).identities).toEqual([{ provider: 'email', label: 'a***@exemple.fr' }]);
    expect(c.call('POST', '/api/auth/email/verify', { body: { requestId, code } }).status).toBe(400);
    // Le courriel en clair n'est plus conservé dans la demande consommée
    expect(c.db.prepare('SELECT email FROM login_requests WHERE id = ?').get(requestId)).toEqual({ email: null });
  });

  it('cinq essais au plus par demande, code expiré refusé, aucune information sur l’existence d’un compte', async () => {
    const c = ctx({ email: true });
    const { requestId, code } = await requestCode(c, 'a@exemple.fr');
    for (let i = 0; i < 5; i++) expect(c.call('POST', '/api/auth/email/verify', { body: { requestId, code: 'ZZZZZZZZ' } }).status).toBe(400);
    // Même le bon code est refusé après 5 essais
    expect(c.call('POST', '/api/auth/email/verify', { body: { requestId, code } }).status).toBe(400);
    const r2 = await requestCode(c, 'b@exemple.fr');
    c.now.t += 16 * 60_000;
    expect(c.call('POST', '/api/auth/email/verify', { body: { requestId: r2.requestId, code: r2.code } }).status).toBe(400);
    // Adresse invalide : même réponse 202, rien d'envoyé
    const sentBefore = c.mailer.sent.length;
    const bad = await c.acall('POST', '/api/auth/email/request', { body: { email: 'pas-un-courriel' } });
    expect(bad.status).toBe(202);
    expect(c.mailer.sent.length).toBe(sentBefore);
  });

  it('limites : 3 demandes par heure et par adresse ; échec d’envoi signalé sans crédit', async () => {
    const c = ctx({ email: true });
    for (let i = 0; i < 3; i++) await requestCode(c, 'a@exemple.fr', `10.0.1.${i}`);
    expect((await c.acall('POST', '/api/auth/email/request', { body: { email: 'a@exemple.fr' }, ip: '10.0.2.1' })).status).toBe(429);
    c.mailer.fail = true;
    expect((await c.acall('POST', '/api/auth/email/request', { body: { email: 'z@exemple.fr' }, ip: '10.0.2.2' })).status).toBe(503);
  });

  it('un invité se connecte par courriel : association à son profil ; sur un autre appareil : fusion confirmée', async () => {
    const c = ctx({ email: true });
    const g = guest(c);
    const r1 = await requestCode(c, 'a@exemple.fr');
    const linked = c.call('POST', '/api/auth/email/verify', { auth: g.auth, body: r1 });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ playerId: g.id });
    // Autre appareil (invité B) : la même adresse mène au profil de A → conflit puis fusion explicite
    const g2 = guest(c, '10.0.0.2');
    const r2 = await requestCode(c, 'a@exemple.fr', '10.0.0.2');
    const conflict = c.call('POST', '/api/auth/email/verify', { auth: g2.auth, body: r2 });
    expect(conflict.status).toBe(409);
    // Le code n'est pas consommé par un conflit : la fusion peut être confirmée avec le même code
    const merged = c.call('POST', '/api/auth/email/verify', { auth: g2.auth, body: { ...r2, merge: true } });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ playerId: g.id, merged: true });
  });
});

describe('migration exceptionnelle des anciennes sauvegardes', () => {
  it('import intégral : Éclats, succès, cosmétiques, statistiques, records locaux ; Prismes et article premium JAMAIS importés', () => {
    const c = ctx();
    const g = guest(c);
    const r = c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-aaaa-1111', legacySave()) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const b = r.body as SyncResponse;
    expect(b.legacy).toBe('imported');
    expect(b.balance).toEqual({ shards: 340, medals: 0, prisms: 0 });
    expect(b.save.achievements).toMatchObject({ first_cycle: 1000, first_level: 2000 });
    expect(b.save.owned).toEqual(['aurore']);
    expect(b.save.stats).toMatchObject({ totalCycles: 40, bestScore: 5000 });
    expect(b.save.survival).toMatchObject({ bestTime: 123.4, bestScore: 5000 });
    expect(b.save.campaign.reserve).toBe(40);
    expect(b.save.levels['1']).toMatchObject({ completed: true, stars: 2 });
    expect(balancesOf(c.db, g.id)).toEqual({ shards: 340, medals: 0, prisms: 0 });
  });

  it('idempotente : un second import de la même installation ne change rien (aucun double import)', () => {
    const c = ctx();
    const g = guest(c);
    c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-aaaa-1111', legacySave()) });
    for (let i = 0; i < 3; i++) {
      const again = c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-aaaa-1111', legacySave({ wallet: { shards: 999999, prisms: 9 } })) }).body as SyncResponse;
      expect(again.legacy).toBe('already');
      expect(again.balance.shards).toBe(340);
    }
    expect(ledgerRows(c, g.id).filter((e) => e.kind === 'import')).toHaveLength(1);
  });

  it('une sauvegarde déjà au format courant (sans solde hérité) n’est pas importée comme héritage', () => {
    const c = ctx();
    const g = guest(c);
    const r = c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-bbbb-2222', defaultSave()) }).body as SyncResponse;
    expect(r.legacy).toBe('none');
    expect(r.balance.shards).toBe(0);
  });

  it('deux installations héritées d’un même profil : les deux soldes sont importés, au plus trois installations', () => {
    const c = ctx();
    const g = guest(c);
    for (const [i, id] of ['install-0001-aaaa', 'install-0002-aaaa', 'install-0003-aaaa'].entries()) {
      const r = c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody(id, legacySave({ wallet: { shards: 100 * (i + 1), prisms: 0 } })) }).body as SyncResponse;
      expect(r.legacy).toBe('imported');
    }
    const fourth = c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-0004-aaaa', legacySave()) }).body as SyncResponse;
    expect(fourth.legacy).toBe('limit');
    expect(balancesOf(c.db, g.id).shards).toBe(600);
  });

  it('une installation appartient à UN seul profil ; solde aberrant plafonné ; requêtes mal formées refusées', () => {
    const c = ctx();
    const a = guest(c);
    const b = guest(c, '10.0.0.2');
    expect(c.call('POST', '/api/migrate', { auth: a.auth, body: migrateBody('install-cccc-3333', legacySave()) }).status).toBe(200);
    expect(c.call('POST', '/api/migrate', { auth: b.auth, body: migrateBody('install-cccc-3333', legacySave()) }).status).toBe(409);
    const huge = c.call('POST', '/api/migrate', { auth: b.auth, body: migrateBody('install-dddd-4444', legacySave({ wallet: { shards: 900_000_000, prisms: 0 } })) }).body as SyncResponse;
    expect(huge.balance.shards).toBe(LEGACY_SHARDS_CAP);
    expect(c.call('POST', '/api/migrate', { auth: b.auth, body: { installId: 'x', save: {} } }).status).toBe(400);
    expect(c.call('POST', '/api/migrate', { body: migrateBody('install-eeee-5555', legacySave()) }).status).toBe(401);
    expect(c.call('POST', '/api/migrate', { auth: b.auth, body: migrateBody('install-ffff-6666', { ...legacySave(), version: 99 }) }).status).toBe(400);
  });

  it('récompenses déjà couvertes par l’import : jamais re-créditées à la synchronisation suivante (aucun double crédit)', () => {
    const c = ctx();
    const g = guest(c);
    const save = legacySave();
    c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-aaaa-7777', save) });
    const before = balancesOf(c.db, g.id).shards;
    const r = sync(c, g, { installId: 'install-aaaa-7777', save }).body as SyncResponse;
    expect(r.balance.shards).toBe(before);
    expect(ledgerRows(c, g.id).filter((e) => e.kind === 'reward')).toHaveLength(0);
  });
});

describe('synchronisation : gains, récompenses uniques, achats', () => {
  const install = 'install-zzzz-0001';

  it('gains répétables : crédités par écart du compteur monotone ; rejouer la même requête ne crédite rien', () => {
    const c = ctx();
    const g = guest(c);
    expect((sync(c, g, { installId: install, earned: 120 }).body as SyncResponse).balance.shards).toBe(120);
    for (let i = 0; i < 4; i++) {
      c.now.t += 1000;
      expect((sync(c, g, { installId: install, earned: 120 }).body as SyncResponse).balance.shards).toBe(120);
    }
    c.now.t += HOUR;
    const r = sync(c, g, { installId: install, earned: 200 }).body as SyncResponse;
    expect(r).toMatchObject({ watermark: 200, capped: false });
    expect(r.balance.shards).toBe(200);
  });

  it('plafond : un compteur gonflé ne crée qu’un seau de jetons ; répéter les requêtes ne crée rien, le temps recharge', () => {
    const c = ctx();
    const g = guest(c);
    const first = sync(c, g, { installId: install, earned: 10_000_000 }).body as SyncResponse;
    expect(first.capped).toBe(true);
    expect(first.balance.shards).toBe(SYNC_RULES.earnBucketCap);
    for (let i = 0; i < 20; i++) sync(c, g, { installId: install, earned: 10_000_000 });
    expect(balancesOf(c.db, g.id).shards).toBe(SYNC_RULES.earnBucketCap);
    c.now.t += HOUR;
    expect(sync(c, g, { installId: install, earned: 10_000_000 }).body).toMatchObject({ balance: { shards: SYNC_RULES.earnBucketCap + SYNC_RULES.earnRefillPerHour } });
    // Compteur qui recule (effacement local) : aucun crédit, aucune erreur
    expect(sync(c, g, { installId: install, earned: 5 }).status).toBe(200);
  });

  it('récompenses uniques : montants de la configuration, une fois par profil, quel que soit le nombre d’appareils', () => {
    const c = ctx();
    const g = guest(c);
    const save = defaultSave();
    const ach = ACHIEVEMENT_CONFIG[0];
    save.achievements[ach.id] = 5;
    save.rewarded.push(ach.id);
    save.paid['1'] = { first: true, stars: 3 };
    const total = ach.legacyShards + LEVEL_REWARDS.firstClear + 3 * LEVEL_REWARDS.perStar;
    expect((sync(c, g, { installId: 'install-dev-aaaa1', save }).body as SyncResponse).balance.shards).toBe(total);
    // Un second appareil avec la même progression : aucun nouveau crédit
    expect((sync(c, g, { installId: 'install-dev-bbbb2', save }).body as SyncResponse).balance.shards).toBe(total);
    // Un succès « versé » mais non débloqué n'ouvre aucun droit
    const forged = defaultSave();
    forged.rewarded = ACHIEVEMENT_CONFIG.map((a) => a.id);
    const g2 = guest(c, '10.0.0.2');
    expect((sync(c, g2, { installId: 'install-dev-cccc3', save: forged }).body as SyncResponse).balance.shards).toBe(0);
  });

  it('achat en Médailles : prix du catalogue vérifié, débit unique, article accordé ; jamais deux fois', () => {
    const c = ctx();
    const g = guest(c);
    const save = achieved(...MEDAL_140);
    expect((sync(c, g, { installId: install, claims: MEDAL_140, save }).body as SyncResponse).balance.medals).toBe(140);
    save.owned = ['aurore'];
    const r = sync(c, g, { installId: install, claims: MEDAL_140, purchases: { aurore: 140 }, save }).body as SyncResponse;
    expect(r.acknowledged).toEqual([{ item: 'aurore', charged: true }]);
    expect(r.balance).toEqual({ shards: 0, medals: 0, prisms: 0 });
    expect(r.save.owned).toContain('aurore');
    for (let i = 0; i < 3; i++) expect((sync(c, g, { installId: install, claims: MEDAL_140, purchases: { aurore: 140 }, save }).body as SyncResponse).balance.medals).toBe(0);
    expect(ledgerRows(c, g.id).filter((e) => e.ref === 'spend:aurore')).toHaveLength(1);
  });

  it('achat refusé : financement insuffisant, prix falsifié, article inconnu ou PREMIUM (Prismes) ; l’article n’est pas accordé, aucun solde négatif', () => {
    const c = ctx();
    const g = guest(c);
    const save = achieved('first_cycle', 'first_level', 'first_survival'); // 60 Médailles
    save.owned = ['spectre', 'aurore', 'neon', 'menthe'];
    const r = sync(c, g, { installId: install, earned: 150, claims: ['first_cycle', 'first_level', 'first_survival'], purchases: { spectre: 170, aurore: 1, neon: 150, menthe: 150, inconnu: 5 }, save }).body as SyncResponse;
    const reasons = Object.fromEntries(r.rejected.map((x) => [x.item, x.reason]));
    expect(reasons).toEqual({ spectre: 'insufficient', aurore: 'bad_price', neon: 'premium', menthe: 'insufficient', inconnu: 'unknown' });
    expect(r.save.owned).toEqual([]);
    expect(r.balance).toEqual({ shards: 150, medals: 60, prisms: 0 });
  });

  it('les Éclats ne financent pas un cosmétique ; les anciens prix en Éclats et les anciens packs n’existent plus', () => {
    const c = ctx();
    const g = guest(c);
    sync(c, g, { installId: install, earned: 2000 });
    const save = defaultSave();
    save.owned = ['aurore', 'emeraude'];
    const r = sync(c, g, { installId: install, earned: 2000, purchases: { aurore: 140, emeraude: 70, 'pack-aurore': 120, 'pack-spectre': 900 }, save }).body as SyncResponse;
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['insufficient', 'insufficient', 'unknown', 'unknown']);
    expect(r.save.owned).toEqual([]);
    expect(r.balance.shards).toBe(2000);
  });

  it('cosmétiques non vérifiés retirés de la progression synchronisée (liste « possédés » falsifiée sans achat)', () => {
    const c = ctx();
    const g = guest(c);
    const save = defaultSave();
    save.owned = ['spectre', 'ultraviolet', 'neon'];
    save.wallet = { shards: 99999, medals: 99999, prisms: 99999 };
    const r = sync(c, g, { installId: install, save }).body as SyncResponse;
    expect(r.save.owned).toEqual([]);
    expect(r.balance).toEqual({ shards: 0, medals: 0, prisms: 0 });
  });

  it('article déjà possédé (importé) : jamais débité, même « acheté » à nouveau ; un pack se refuse en différé (premium)', () => {
    const c = ctx();
    const g = guest(c);
    const save = achieved(...MEDAL_140);
    sync(c, g, { installId: install, claims: MEDAL_140, save });
    const r = sync(c, g, { installId: install, claims: MEDAL_140, purchases: { 'pack-neon': 200 }, save }).body as SyncResponse;
    expect(r.rejected).toEqual([{ item: 'pack-neon', reason: 'premium' }]);
    const g2 = guest(c, '10.0.0.2');
    c.call('POST', '/api/migrate', { auth: g2.auth, body: migrateBody('install-mig-0001', legacySave({ owned: ['menthe'], wallet: { shards: 500, prisms: 0 } })) });
    const s2 = defaultSave();
    s2.owned = ['menthe'];
    const r2 = sync(c, g2, { installId: 'install-mig-0002', purchases: { menthe: 150 }, save: s2 }).body as SyncResponse;
    expect(r2.acknowledged).toEqual([{ item: 'menthe', charged: false }]);
    expect(r2.balance).toEqual({ shards: 500, medals: 0, prisms: 0 });
  });

  it('aucun chemin ne crée de Prismes à partir du client (portefeuille falsifié, achats, import)', () => {
    const c = ctx();
    const g = guest(c);
    const evil = defaultSave();
    evil.wallet = { shards: 1e9, prisms: 1e9 };
    evil.economy.legacy = { shards: 10, imported: false };
    c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-prm-0001', { ...legacySave(), wallet: { shards: 5, prisms: 777777 } }) });
    sync(c, g, { installId: 'install-prm-0001', earned: 50, purchases: { neon: 150, 'pack-neon': 200 }, save: evil });
    c.call('POST', '/api/shop/prisms', { auth: g.auth, body: { item: 'neon' } });
    expect(balancesOf(c.db, g.id).prisms).toBe(0);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE currency = 'prisms'").get()).toEqual({ n: 0 });
  });

  it('requêtes invalides : sans authentification, installation d’un autre profil, corps trop gros ou malformé', () => {
    const c = ctx();
    const a = guest(c);
    const b = guest(c, '10.0.0.2');
    expect(c.call('POST', '/api/sync', { body: { installId: install, earned: 0, purchases: {}, save: defaultSave() } }).status).toBe(401);
    expect(sync(c, a, { installId: install }).status).toBe(200);
    expect(sync(c, b, { installId: install }).status).toBe(409);
    expect(c.call('POST', '/api/sync', { auth: a.auth, body: { installId: 'x', earned: 0, save: {} } }).status).toBe(400);
    expect(c.call('POST', '/api/sync', { auth: a.auth, body: { installId: install, earned: -4, save: {} } }).status).toBe(400);
    expect(c.call('POST', '/api/sync', { auth: a.auth, body: { installId: install, earned: 0, save: { blob: 'x'.repeat(300_000) } } }).status).toBe(413);
  });
});

describe('fusion de deux profils : monnaies et récompenses sans double crédit', () => {
  it('une récompense obtenue par les deux profils n’est comptée qu’une fois ; gains, imports et achats distincts additionnés', async () => {
    const c = ctx({ google: true });
    const account = (await googleLogin(c, 'sub-A')).body as AuthResponse;
    const acc = { auth: auth(account) };
    const ach = ACHIEVEMENT_CONFIG[1];
    const saveA = defaultSave();
    saveA.achievements[ach.id] = 10;
    saveA.rewarded.push(ach.id);
    sync(c, acc, { installId: 'install-A-dev0001', earned: 300, save: saveA }); // 300 + ach
    const b = guest(c, '10.0.0.2');
    const saveB = defaultSave();
    saveB.achievements[ach.id] = 20;
    saveB.rewarded.push(ach.id);
    sync(c, b, { installId: 'install-B-dev0002', earned: 500, save: saveB }); // 500 + ach
    const balA = balancesOf(c.db, account.playerId).shards;
    const balB = balancesOf(c.db, b.id).shards;
    expect(balA).toBe(300 + ach.legacyShards);
    expect(balB).toBe(500 + ach.legacyShards);

    const merged = await googleLogin(c, 'sub-A', { auth: b.auth, merge: true });
    expect(merged.status).toBe(200);
    // Gains des deux installations additionnés ; récompense commune comptée UNE fois
    expect(balancesOf(c.db, account.playerId).shards).toBe(300 + 500 + ach.legacyShards);
    const refs = ledgerRows(c, account.playerId).map((e) => e.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.filter((r) => r.startsWith('ach:'))).toHaveLength(1);
    // Les installations ont changé de propriétaire : leur filigrane est conservé (aucun re-crédit des gains)
    const again = sync(c, acc, { installId: 'install-B-dev0002', earned: 500, save: saveB }).body as SyncResponse;
    expect(again.balance.shards).toBe(300 + 500 + ach.legacyShards);
    // Progression fusionnée : union des succès (la plus ancienne date)
    expect(again.save.achievements[ach.id]).toBe(10);
  });

  it('un import couvrant une récompense l’emporte sur un crédit de l’autre profil (jamais deux fois la même récompense)', async () => {
    const c = ctx({ google: true });
    const account = (await googleLogin(c, 'sub-A')).body as AuthResponse;
    const ach = ACHIEVEMENT_CONFIG[0];
    // Compte B (invité) : récompense créditée normalement
    const b = guest(c, '10.0.0.2');
    const saveB = defaultSave();
    saveB.achievements[ach.id] = 1;
    saveB.rewarded.push(ach.id);
    sync(c, b, { installId: 'install-B-dev0003', save: saveB });
    expect(balancesOf(c.db, b.id).shards).toBe(ach.legacyShards);
    // Compte A : même succès DÉJÀ inclus dans le solde hérité (marqueur à 0)
    const legacy = legacySave({ achievements: { [ach.id]: 1 }, rewarded: [ach.id], paid: {}, wallet: { shards: 1000, prisms: 0 }, owned: [] });
    c.call('POST', '/api/migrate', { auth: auth(account), body: migrateBody('install-A-dev0004', legacy) });
    await googleLogin(c, 'sub-A', { auth: b.auth, merge: true });
    expect(balancesOf(c.db, account.playerId).shards).toBe(1000);
  });
});

describe('suppression et autorisations', () => {
  it('DELETE /api/me efface aussi connexions, accès, sauvegarde, installations, registre et alias de fusion', async () => {
    const c = ctx({ google: true });
    const account = (await googleLogin(c, 'sub-A')).body as AuthResponse;
    const b = guest(c, '10.0.0.2');
    sync(c, b, { installId: 'install-del-0001', earned: 100 });
    await googleLogin(c, 'sub-A', { auth: b.auth, merge: true });
    expect(c.call('DELETE', '/api/me', { auth: auth(account) }).status).toBe(200);
    for (const t of ['players', 'identities', 'sessions', 'saves', 'installs', 'ledger', 'merges', 'tickets', 'runs', 'bests']) {
      expect(c.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
    }
    expect(c.call('GET', '/api/profile', { auth: b.auth }).status).toBe(401);
  });

  it('routes de compte : authentification obligatoire ; aucun accès aux données d’un autre profil', () => {
    const c = ctx();
    for (const [m, p] of [['GET', '/api/profile'], ['POST', '/api/sync'], ['POST', '/api/migrate'], ['POST', '/api/auth/logout'], ['POST', '/api/auth/unlink']] as const) {
      expect(c.call(m, p).status, p).toBe(401);
      expect(c.call(m, p, { auth: 'nimporte.AAAAAAAAAAAAAAAAAAAAAAAAAAAA' }).status, p).toBe(401);
    }
    // Un accès ne permet pas d'agir sur un autre profil : le profil est toujours celui de l'accès
    const a = guest(c);
    const b = guest(c, '10.0.0.2');
    const pa = c.call('GET', '/api/profile', { auth: a.auth }).body as ProfileResponse;
    const pb = c.call('GET', '/api/profile', { auth: b.auth }).body as ProfileResponse;
    expect(pa.playerId).not.toBe(pb.playerId);
    expect(c.call('GET', '/api/profile', { auth: `${a.id}.${b.auth.split('.')[1]}` }).status).toBe(401);
  });

  it('l’ancienne API reste compatible : pseudo + secret, classement, tickets, parties', () => {
    const c = ctx();
    const a = pseudo(c, 'Axel');
    expect(c.call('GET', '/api/me', { auth: a.auth }).status).toBe(200);
    expect(c.call('POST', '/api/tickets', { auth: a.auth }).status).toBe(200);
    expect(c.call('GET', '/api/health').body).toEqual({ ok: true, balance: BALANCE_VERSION });
  });
});

// ————————————————————————————————————————————————————————————————————————————————
// Phase 2 : Médailles, bonus, articles premium

import { ACHIEVEMENT_CONFIG as ACH, totalMedals } from '../src/config/achievements';
import { BONUS } from '../src/config/economy';
import type { PremiumPurchaseResponse } from '../src/net/accountProtocol';
import { inventoryOf } from '../server/profile';

describe('Médailles de succès : attribution unique, contrôlée par le service', () => {
  const inst = 'install-med-0001';
  const ALL = ACH.map((a) => a.id);

  it('réclamation : montants de la configuration, une seule ligne par succès, jamais de double crédit (répétitions, autre appareil)', () => {
    const c = ctx();
    const g = guest(c);
    const save = achieved('first_cycle', 'survive_600');
    const r = sync(c, g, { installId: inst, claims: ['first_cycle', 'survive_600'], save }).body as SyncResponse;
    expect(r.balance.medals).toBe(20 + 200);
    expect(r.claimed.sort()).toEqual(['first_cycle', 'survive_600']);
    for (let i = 0; i < 4; i++) expect((sync(c, g, { installId: inst, claims: ['first_cycle', 'survive_600'], save }).body as SyncResponse).balance.medals).toBe(220);
    expect((sync(c, g, { installId: 'install-med-0002', claims: ['first_cycle'], save }).body as SyncResponse).balance.medals).toBe(220);
    expect(ledgerRows(c, g.id).filter((e) => e.ref.startsWith('medal:'))).toHaveLength(2);
  });

  it('aucun crédit arbitraire : succès absent de la progression, identifiant inconnu ; les montants ne viennent jamais du client', () => {
    const c = ctx();
    const g = guest(c);
    const r = sync(c, g, { installId: inst, claims: ['survive_600', 'inconnu', 'first_cycle'], save: achieved('first_cycle') }).body as SyncResponse;
    expect(r.rejectedClaims.sort()).toEqual(['inconnu', 'survive_600']);
    expect(r.balance.medals).toBe(20);
    // Portefeuille falsifié : ignoré
    const evil = achieved();
    evil.wallet.medals = 999999;
    expect((sync(c, g, { installId: inst, save: evil }).body as SyncResponse).balance.medals).toBe(20);
  });

  it('total exact : les 27 succès rapportent 1 650 Médailles, sans dépense réelle', () => {
    const c = ctx();
    const g = guest(c);
    const r = sync(c, g, { installId: inst, claims: ALL, save: achieved(...ALL) }).body as SyncResponse;
    expect(r.balance.medals).toBe(1650);
    expect(totalMedals()).toBe(1650);
  });

  it('rétroactif : un succès importé d’une ancienne sauvegarde reste réclamable, sans toucher aux Éclats ; réclamable une seule fois', () => {
    const c = ctx();
    const g = guest(c);
    c.call('POST', '/api/migrate', { auth: g.auth, body: migrateBody('install-ret-0001', legacySave()) });
    const before = balancesOf(c.db, g.id);
    expect(before).toEqual({ shards: 340, medals: 0, prisms: 0 });
    const save = defaultSave();
    save.achievements = { first_cycle: 1000, first_level: 2000 };
    const r = sync(c, g, { installId: 'install-ret-0001', claims: ['first_cycle', 'first_level'], save }).body as SyncResponse;
    expect(r.balance).toEqual({ shards: 340, medals: 40, prisms: 0 });
    // Une seconde réclamation, d'un autre appareil comme du même : aucun crédit
    expect((sync(c, g, { installId: 'install-ret-0002', claims: ['first_cycle', 'first_level'], save }).body as SyncResponse).balance).toEqual({ shards: 340, medals: 40, prisms: 0 });
  });

  it('fusion de deux profils : un succès réclamé par les deux n’est crédité qu’une fois', async () => {
    const c = ctx({ google: true });
    const account = (await googleLogin(c, 'sub-M')).body as AuthResponse;
    sync(c, { auth: auth(account) }, { installId: 'install-fm-0001', claims: ['first_cycle', 'first_level'], save: achieved('first_cycle', 'first_level') });
    const b = guest(c, '10.0.0.2');
    sync(c, b, { installId: 'install-fm-0002', claims: ['first_cycle', 'survive_60'], save: achieved('first_cycle', 'survive_60') });
    expect(balancesOf(c.db, b.id).medals).toBe(40);
    expect((await googleLogin(c, 'sub-M', { auth: b.auth, merge: true })).status).toBe(200);
    expect(balancesOf(c.db, account.playerId).medals).toBe(20 + 20 + 20); // first_cycle une fois, first_level, survive_60
    const refs = ledgerRows(c, account.playerId).map((e) => e.ref).filter((r) => r.startsWith('medal:'));
    expect(refs.sort()).toEqual(['medal:first_cycle', 'medal:first_level', 'medal:survive_60']);
  });
});

describe('bonus : inventaire persistant, achats en Éclats idempotents et vérifiés', () => {
  const inst = 'install-bon-0001';

  it('achat : débit au prix de la configuration, crédit d’inventaire, rejouer la requête ne change rien', () => {
    const c = ctx();
    const g = guest(c);
    sync(c, g, { installId: inst, earned: 1000 });
    const r = sync(c, g, { installId: inst, earned: 1000, bonusBought: { boost: 2, gel: 1 } }).body as SyncResponse;
    expect(r.balance.shards).toBe(1000 - 2 * 50 - 100);
    expect(r.inventory).toEqual({ boost: 2, gel: 1 });
    expect(r.bonus).toEqual({ boost: 2, gel: 1 });
    for (let i = 0; i < 4; i++) {
      const again = sync(c, g, { installId: inst, earned: 1000, bonusBought: { boost: 2, gel: 1 } }).body as SyncResponse;
      expect(again.balance.shards).toBe(800);
      expect(again.inventory).toEqual({ boost: 2, gel: 1 });
    }
    // Achat suivant : seul l'écart compte
    const next = sync(c, g, { installId: inst, earned: 1000, bonusBought: { boost: 3, gel: 1 } }).body as SyncResponse;
    expect(next.inventory.boost).toBe(3);
    expect(next.balance.shards).toBe(750);
  });

  it('financement insuffisant : refusé (jamais de solde négatif), ordre de réception respecté, le compteur est consommé (pas de réessai)', () => {
    const c = ctx();
    const g = guest(c);
    sync(c, g, { installId: inst, earned: 120 });
    const r = sync(c, g, { installId: inst, earned: 120, bonusBought: { boost: 5, gel: 0 } }).body as SyncResponse;
    expect(r.inventory.boost).toBe(2); // 120 / 50
    expect(r.bonusRejected).toEqual({ boost: 3, gel: 0 });
    expect(r.balance.shards).toBe(20);
    const again = sync(c, g, { installId: inst, earned: 120, bonusBought: { boost: 5, gel: 0 } }).body as SyncResponse;
    expect(again.inventory.boost).toBe(2);
    expect(again.balance.shards).toBe(20);
    // Deux appareils : la première requête reçue est servie la première
    const g2 = guest(c, '10.0.0.2');
    sync(c, g2, { installId: 'install-bon-0002', earned: 100 });
    const first = sync(c, g2, { installId: 'install-bon-0002', earned: 100, bonusBought: { boost: 0, gel: 1 } }).body as SyncResponse;
    expect(first.inventory.gel).toBe(1);
    const second = sync(c, g2, { installId: 'install-bon-0003', bonusBought: { boost: 0, gel: 1 } }).body as SyncResponse;
    expect(second.bonusRejected.gel).toBe(1);
    expect(second.inventory.gel).toBe(1);
  });

  it('stock maximal respecté ; les charges ne sont jamais supprimées ; un compteur falsifié ne crée rien sans Éclats', () => {
    const c = ctx();
    const g = guest(c);
    sync(c, g, { installId: inst, earned: 3000 });
    const r = sync(c, g, { installId: inst, earned: 3000, bonusBought: { boost: 60, gel: 0 } }).body as SyncResponse;
    expect(r.inventory.boost).toBe(60);
    const full = sync(c, g, { installId: inst, earned: 3000, bonusBought: { boost: 200, gel: 0 } }).body as SyncResponse;
    expect(full.inventory.boost).toBeLessThanOrEqual(BONUS.maxStock);
    expect(full.balance.shards).toBeGreaterThanOrEqual(0);
    const g2 = guest(c, '10.0.0.2');
    const evil = sync(c, g2, { installId: 'install-bon-0009', bonusBought: { boost: 1e9, gel: 1e9 } }).body as SyncResponse;
    expect(evil.inventory).toEqual({ boost: 0, gel: 0 });
    expect(inventoryOf(c.db, g2.id)).toEqual({ boost: 0, gel: 0 });
  });

  it('fusion de profils : l’inventaire suit le registre ; les compteurs des installations sont conservés (aucun rachat gratuit)', async () => {
    const c = ctx({ google: true });
    const account = (await googleLogin(c, 'sub-B')).body as AuthResponse;
    const b = guest(c, '10.0.0.2');
    sync(c, b, { installId: 'install-bon-0010', earned: 500, bonusBought: { boost: 4, gel: 0 } });
    expect(inventoryOf(c.db, b.id).boost).toBe(4);
    await googleLogin(c, 'sub-B', { auth: b.auth, merge: true });
    expect(inventoryOf(c.db, account.playerId).boost).toBe(4);
    const again = sync(c, { auth: auth(account) }, { installId: 'install-bon-0010', earned: 500, bonusBought: { boost: 4, gel: 0 } }).body as SyncResponse;
    expect(again.inventory.boost).toBe(4);
    expect(again.balance.shards).toBe(300);
  });
});

describe('articles premium : débit de Prismes sécurisé par le service', () => {
  /** Prismes obtenus « légitimement » : écrits par le SERVICE (jamais une valeur du client). Réservé aux tests. */
  const credit = (c: Ctx, id: string, amount: number, ref = `test:${amount}:${Math.random()}`): void => {
    c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'prisms', 'test', ?, ?, 0)").run(id, amount, ref);
  };
  const buy = (c: Ctx, who: { auth: string }, item: string): HttpResponse => c.call('POST', '/api/shop/prisms', { auth: who.auth, body: { item } });

  it('sans Prismes : refusé (409), rien n’est accordé ni débité ; sans authentification : 401', () => {
    const c = ctx();
    const g = guest(c);
    expect(buy(c, g, 'neon').status).toBe(409);
    expect(balancesOf(c.db, g.id).prisms).toBe(0);
    expect(c.call('POST', '/api/shop/prisms', { body: { item: 'neon' } }).status).toBe(401);
  });

  it('achat : débit atomique du prix du catalogue, article accordé ; rejouer = aucun second débit', () => {
    const c = ctx();
    const g = guest(c);
    credit(c, g.id, 400);
    const r = buy(c, g, 'neon');
    expect(r.status).toBe(200);
    const b = r.body as PremiumPurchaseResponse;
    expect(b).toMatchObject({ item: 'neon', charged: true, price: 150 });
    expect(b.balance.prisms).toBe(250);
    expect(b.owned).toContain('neon');
    for (let i = 0; i < 3; i++) expect((buy(c, g, 'neon').body as PremiumPurchaseResponse)).toMatchObject({ charged: false, price: 0, balance: { prisms: 250 } });
    expect(ledgerRows(c, g.id).filter((e) => e.ref === 'spend:neon')).toHaveLength(1);
  });

  it('pack : 200 Prismes (25 d’économie) ; si un élément est déjà possédé, prorata sans rien perdre ni racheter', () => {
    const c = ctx();
    const g = guest(c);
    credit(c, g.id, 1000);
    const full = buy(c, g, 'pack-neon').body as PremiumPurchaseResponse;
    expect(full).toMatchObject({ charged: true, price: 200 });
    expect(full.owned.sort()).toEqual(['nebuleuse', 'neon']);
    const g2 = guest(c, '10.0.0.2');
    credit(c, g2.id, 1000);
    buy(c, g2, 'neon'); // 150
    const part = buy(c, g2, 'pack-neon').body as PremiumPurchaseResponse;
    expect(part.charged).toBe(true);
    expect(part.price).toBe(Math.round((200 * 75) / 225)); // reste à obtenir : la traînée
    expect(part.price).toBeLessThan(75);
    expect(part.owned.sort()).toEqual(['nebuleuse', 'neon']);
    expect(part.balance.prisms).toBe(1000 - 150 - part.price);
    expect((buy(c, g2, 'pack-neon').body as PremiumPurchaseResponse).charged).toBe(false);
  });

  it('articles non premium refusés (400), articles inconnus (404) ; le client ne peut pas créer de Prismes', () => {
    const c = ctx();
    const g = guest(c);
    credit(c, g.id, 1000);
    expect(buy(c, g, 'aurore').status).toBe(400);
    expect(buy(c, g, 'inconnu').status).toBe(404);
    expect(c.call('POST', '/api/shop/prisms', { auth: g.auth, body: {} }).status).toBe(400);
    const evil = defaultSave();
    evil.wallet.prisms = 5e8;
    sync(c, g, { installId: 'install-prm-0099', save: evil });
    expect(balancesOf(c.db, g.id).prisms).toBe(1000);
  });
});
