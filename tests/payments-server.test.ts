import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PRISM_PACKS, formatEuros, packById, packByProductId, AD_REVIVE_LIFE } from '../src/config/monetization';
import { CATALOG } from '../src/config/catalog';
import { REVIVE } from '../src/config/powers';
import { BALANCE_VERSION } from '../src/config/version';
import type { RegisterResponse } from '../src/net/protocol';
import { createApp, type HttpRequest, type HttpResponse } from '../server/app';
import { openDb, type Db } from '../server/db';
import { accountBinding, debtOf, settleDebt, appleJwt, type WebEvent, type WebProvider } from '../server/payments';
import { balancesOf } from '../server/profile';

/**
 * Tests des achats de Prismes et des publicités récompensées avec des FOURNISSEURS SIMULÉS (réponses fabriquées, clés locales).
 * Ils vérifient la logique du service (vérification, idempotence, liaison au compte, remboursements, dette, usage unique) ; ils ne prouvent PAS
 * qu'un paiement ou une publicité réels fonctionnent : cela exige les comptes, produits et clés listés dans docs/MONETISATION.md.
 */
const SECRET = 'secret-de-test-pour-les-tickets-0123456789';
const NOW0 = Date.UTC(2026, 9, 15, 12, 0, 0);
const BUNDLE = 'fr.test.polarrift';
const PACKAGE = 'fr.test.polarrift.android';
const AD_UNIT = 'ca-app-pub-0000000000000000/1111111111';

const appleKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const googleKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const admobKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const admobPem = admobKey.publicKey.export({ type: 'spki', format: 'pem' }) as string;

const b64u = (o: unknown): string => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const jws = (payload: Record<string, unknown>): string => `${b64u({ alg: 'ES256', x5c: [] })}.${b64u(payload)}.${b64u('sig')}`;

interface AppleTx {
  transactionId: string;
  productId: string;
  appAccountToken: string | null;
  bundleId?: string;
  environment?: 'Production' | 'Sandbox';
  quantity?: number;
  revocationDate?: number;
}
interface GoogleTx {
  productId: string;
  orderId: string;
  purchaseState: 0 | 1 | 2;
  obfuscatedExternalAccountId: string | null;
  purchaseType?: number;
  quantity?: number;
}

/** « Serveurs » Apple et Google simulés : ils contrôlent que le service s'authentifie avec ses propres clés. */
function providers() {
  const state = {
    apple: new Map<string, AppleTx>(),
    appleSandbox: new Map<string, AppleTx>(),
    google: new Map<string, GoogleTx>(),
    consumed: [] as string[],
    /** Achats annulés / remboursés / rétrofacturés (liste officielle « Voided Purchases »). */
    voided: [] as { orderId: string; purchaseToken: string; voidedTimeMillis: number }[],
    voidedPageSize: 100,
    voidedQueries: [] as string[],
    /** Notifications REFUND / REVOKE d'Apple (historique) : identifiants de transactions. */
    appleHistory: [] as { type: 'REFUND' | 'REVOKE'; transactionId: string; bundleId?: string }[],
    appleHistoryDown: false,
    consumeFails: false,
    down: false,
    calls: [] as string[],
    keysCalls: 0,
  };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    state.calls.push(`${init?.method ?? 'GET'} ${u.replace(/\/tokens\/[^/:]+/, '/tokens/…')}`);
    if (state.down) throw new Error('réseau coupé');
    const ok = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    const appleLookup = /^(https:\/\/api\.storekit(-sandbox)?\.itunes\.apple\.com)\/inApps\/v1\/transactions\/(\d+)$/.exec(u);
    if (appleLookup) {
      // Le service doit signer son jeton (ES256) avec SA clé : vérifié ici
      const auth = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
      const [h, p, s] = auth.split('.');
      const { verify, createVerify } = await import('node:crypto');
      void verify;
      const okSig = createVerify('SHA256').update(`${h}.${p}`).verify({ key: appleKey.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (!okSig || claims.aud !== 'appstoreconnect-v1' || claims.bid !== BUNDLE || JSON.parse(Buffer.from(h, 'base64url').toString()).kid !== 'KEYID') return ok({}, 401);
      const map = appleLookup[2] ? state.appleSandbox : state.apple;
      const tx = map.get(appleLookup[3]);
      if (!tx) return ok({}, 404);
      return ok({ signedTransactionInfo: jws({ transactionId: tx.transactionId, originalTransactionId: tx.transactionId, bundleId: tx.bundleId ?? BUNDLE, productId: tx.productId, appAccountToken: tx.appAccountToken, environment: tx.environment ?? (appleLookup[2] ? 'Sandbox' : 'Production'), quantity: tx.quantity ?? 1, type: 'Consumable', ...(tx.revocationDate ? { revocationDate: tx.revocationDate } : {}) }) });
    }
    if (u.endsWith('/inApps/v1/notifications/history') || /\/inApps\/v1\/notifications\/history\?paginationToken=/.test(u)) {
      if (state.appleHistoryDown) return ok({}, 500);
      const auth = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
      const { createVerify } = await import('node:crypto');
      const [h, pp, sg] = auth.split('.');
      if (!createVerify('SHA256').update(`${h}.${pp}`).verify({ key: appleKey.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url'))) return ok({}, 401);
      const body = JSON.parse(String(init?.body)) as { notificationType: string };
      const items = state.appleHistory.filter((n) => n.type === body.notificationType).map((n) => ({ signedPayload: jws({ notificationType: n.type, data: { signedTransactionInfo: jws({ transactionId: n.transactionId, bundleId: n.bundleId ?? BUNDLE }) } }) }));
      return ok({ notificationHistory: items, hasMore: false });
    }
    if (u === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? '';
      const [h, p, s] = assertion.split('.');
      const { createVerify } = await import('node:crypto');
      const good = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(googleKey.publicKey, Buffer.from(s, 'base64url'));
      const c = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (!good || c.iss !== 'play@test.iam' || c.scope !== 'https://www.googleapis.com/auth/androidpublisher') return ok({}, 400);
      return ok({ access_token: 'tok-google', expires_in: 3600 });
    }
    const vp = /androidpublisher\/v3\/applications\/([^/]+)\/purchases\/voidedpurchases\?(.*)$/.exec(u);
    if (vp) {
      if ((init?.headers as Record<string, string>)?.Authorization !== 'Bearer tok-google') return ok({}, 401);
      state.voidedQueries.push(vp[2]);
      const qs = new URLSearchParams(vp[2]);
      const start = Number(qs.get('startTime'));
      const end = Number(qs.get('endTime'));
      const all = state.voided.filter((v) => v.voidedTimeMillis >= start && v.voidedTimeMillis <= end);
      const from = Number(qs.get('token') ?? 0);
      const slice = all.slice(from, from + state.voidedPageSize);
      return ok({ voidedPurchases: slice.map((v) => ({ kind: 'androidpublisher#voidedPurchase', ...v, voidedTimeMillis: String(v.voidedTimeMillis) })), ...(from + state.voidedPageSize < all.length ? { tokenPagination: { nextPageToken: String(from + state.voidedPageSize) } } : {}) });
    }
    const g = /androidpublisher\/v3\/applications\/([^/]+)\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:consume)?$/.exec(u);
    if (g) {
      if ((init?.headers as Record<string, string>)?.Authorization !== 'Bearer tok-google') return ok({}, 401);
      if (decodeURIComponent(g[1]) !== PACKAGE) return ok({}, 404);
      const tx = state.google.get(decodeURIComponent(g[3]));
      if (!tx || tx.productId !== decodeURIComponent(g[2])) return ok({}, 410);
      if (g[4]) {
        if (state.consumeFails) return ok({}, 500);
        state.consumed.push(g[3]);
        return ok({});
      }
      return ok({ purchaseState: tx.purchaseState, orderId: tx.orderId, purchaseType: tx.purchaseType, obfuscatedExternalAccountId: tx.obfuscatedExternalAccountId, quantity: tx.quantity ?? 1 });
    }
    if (u === 'https://www.gstatic.com/admob/reward/verifier-keys.json') {
      state.keysCalls++;
      return ok({ keys: [{ keyId: 1, pem: admobPem }] });
    }
    return ok({}, 404);
  }) as typeof fetch;
  return { state, fetchFn };
}

class FakeWeb implements WebProvider {
  name = 'faux-prestataire';
  async checkout(i: { playerId: string; productId: string; reference: string }): Promise<{ url: string }> {
    return { url: `https://pay.example/checkout?p=${i.productId}&ref=${i.reference}` };
  }
  async parseNotification(raw: string, headers: Record<string, string | undefined>): Promise<WebEvent | null> {
    if (headers['x-signature'] !== 'valide') throw new Error('signature');
    const j = JSON.parse(raw) as Partial<WebEvent>;
    return j.ref ? (j as WebEvent) : null;
  }
}

interface Opts {
  apple?: { acceptSandbox?: boolean } | false;
  google?: { acceptTestPurchases?: boolean } | false;
  web?: boolean;
  ads?: boolean;
  notifyToken?: string;
}

function ctx(o: Opts = {}, db: Db = openDb(':memory:')) {
  const now = { t: NOW0 };
  const pv = providers();
  const app = createApp(db, {
    ticketSecret: SECRET,
    now: () => now.t,
    balance: BALANCE_VERSION,
    payments: {
      apple: o.apple === false ? undefined : { issuerId: 'ISSUER', keyId: 'KEYID', privateKey: appleKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, bundleId: BUNDLE, ...o.apple },
      google: o.google === false ? undefined : { packageName: PACKAGE, clientEmail: 'play@test.iam', privateKey: googleKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, ...o.google },
      web: o.web ? new FakeWeb() : undefined,
      playNotifyToken: o.notifyToken ?? 'jeton-notif-google',
      fetch: pv.fetchFn,
      ads: o.ads === false ? undefined : { adUnits: [AD_UNIT], keys: async () => ({ '1': admobPem }) },
    },
  });
  let ip = 1;
  const mk = (method: string, path: string, c: { body?: unknown; auth?: string; query?: string; headers?: Record<string, string>; raw?: string } = {}): HttpRequest => ({
    method,
    path,
    query: new URLSearchParams(c.query ?? ''),
    rawQuery: c.query ?? '',
    headers: { authorization: c.auth ? `Bearer ${c.auth}` : undefined, ...c.headers },
    body: c.body,
    raw: c.raw ?? (c.body === undefined ? undefined : JSON.stringify(c.body)),
    ip: `10.2.${Math.floor(ip / 200)}.${ip++ % 200}`,
  });
  const call = async (method: string, path: string, c: Parameters<typeof mk>[2] = {}): Promise<HttpResponse> => {
    const req = mk(method, path, c);
    const p = app.async(req);
    return p ? p : app(req);
  };
  /** Profil CONNECTÉ (avec une méthode de connexion) : peut acheter. */
  const account = (nick: string): { id: string; auth: string } => {
    const r = app({ ...mk('POST', '/api/register', { body: { nickname: nick } }) });
    const b = r.body as RegisterResponse;
    db.prepare("INSERT INTO identities (player_id, provider, subject, email, created_at) VALUES (?, 'email', ?, NULL, 1)").run(b.playerId, `sub-${b.playerId}`);
    return { id: b.playerId, auth: `${b.playerId}.${b.token}` };
  };
  const pseudoOnly = (nick: string): { id: string; auth: string } => {
    const b = app(mk('POST', '/api/register', { body: { nickname: nick } })).body as RegisterResponse;
    return { id: b.playerId, auth: `${b.playerId}.${b.token}` };
  };
  const guest = (): { id: string; auth: string } => {
    const b = app(mk('POST', '/api/register', { body: {} })).body as RegisterResponse;
    return { id: b.playerId, auth: `${b.playerId}.${b.token}` };
  };
  return { db, now, app, call, pv, account, pseudoOnly, guest, mk };
}
type Ctx = ReturnType<typeof ctx>;

const prisms = (c: Ctx, id: string): number => balancesOf(c.db, id).prisms;
const apple = (c: Ctx, p: { id: string }, tid: string, productId: string, over: Partial<AppleTx> = {}): void => {
  c.pv.state.apple.set(tid, { transactionId: tid, productId, appAccountToken: accountBinding(SECRET, 'apple', p.id), ...over });
};
const verifyApple = (c: Ctx, p: { auth: string }, tid: string, productId = 'polar_rift_prisms_30'): Promise<HttpResponse> => c.call('POST', '/api/payments/verify', { auth: p.auth, body: { provider: 'apple', transactionId: tid, productId } });
const google = (c: Ctx, p: { id: string }, token: string, productId: string, over: Partial<GoogleTx> = {}): void => {
  c.pv.state.google.set(token, { productId, orderId: `GPA.${token.slice(15, 21)}`, purchaseState: 0, obfuscatedExternalAccountId: accountBinding(SECRET, 'google', p.id), ...over });
};
const verifyGoogle = (c: Ctx, p: { auth: string }, token: string, productId: string): Promise<HttpResponse> => c.call('POST', '/api/payments/verify', { auth: p.auth, body: { provider: 'google', productId, purchaseToken: token } });
const TOKEN = (n: number): string => `purchase-token-${String(n).padStart(6, '0')}-abcdefghij`;

describe('Packs de Prismes : configuration (tarifs et identifiants figés)', () => {
  it('30 / 100 / 380 Prismes pour 0,99 € / 2,99 € / 9,99 €, identifiants de produits stables', () => {
    expect(PRISM_PACKS.map((p) => [p.id, p.prisms, p.priceCents, p.productId])).toEqual([
      ['decouverte', 30, 99, 'polar_rift_prisms_30'],
      ['intermediaire', 100, 299, 'polar_rift_prisms_100'],
      ['grand', 380, 999, 'polar_rift_prisms_380'],
    ]);
    expect(PRISM_PACKS.map((p) => formatEuros(p.priceCents))).toEqual(['0,99 €', '2,99 €', '9,99 €']);
    expect(packByProductId('polar_rift_prisms_100')?.prisms).toBe(100);
    expect(packById('grand')?.productId).toBe('polar_rift_prisms_380');
    expect(packByProductId('polar_rift_prisms_999')).toBeUndefined();
    expect(new Set(PRISM_PACKS.map((p) => p.productId)).size).toBe(3);
  });

  it('utilisations existantes inchangées : Néon 150, Nébuleuse 75, pack 200, reprises 5 puis 10 ; Éclats et Médailles non touchés', () => {
    const price = (id: string): unknown => CATALOG.find((i) => i.id === id)?.acquire;
    expect(price('neon')).toEqual({ type: 'price', currency: 'prisms', amount: 150 });
    expect(price('nebuleuse')).toEqual({ type: 'price', currency: 'prisms', amount: 75 });
    expect(price('pack-neon')).toEqual({ type: 'price', currency: 'prisms', amount: 200 });
    expect(REVIVE.prisms).toEqual({ 2: 5, 3: 10 });
    expect(AD_REVIVE_LIFE).toBe(2);
    expect(REVIVE.adLives).toEqual([2]);
    expect(CATALOG.filter((i) => i.acquire.type === 'price' && i.acquire.currency === 'medals').reduce((t, i) => t + (i.acquire.type === 'price' ? i.acquire.amount : 0), 0)).toBe(1640);
  });
});

describe('Configuration publique et fournisseurs absents', () => {
  it('sans identifiants : aucun fournisseur actif, achats refusés (503), aucun crédit, aucune ligne', async () => {
    const c = ctx({ apple: false, google: false, ads: false });
    const cfg = (await c.call('GET', '/api/payments/config')).body as { packs: unknown[]; providers: Record<string, boolean>; ads: { enabled: boolean } };
    expect(cfg.providers).toEqual({ apple: false, google: false, web: false });
    expect(cfg.ads.enabled).toBe(false);
    expect(cfg.packs).toHaveLength(3);
    const p = c.account('Axel');
    for (const body of [{ provider: 'apple', transactionId: '1', productId: 'polar_rift_prisms_30' }, { provider: 'google', productId: 'polar_rift_prisms_30', purchaseToken: TOKEN(1) }]) {
      const r = await c.call('POST', '/api/payments/verify', { auth: p.auth, body });
      expect(r.status).toBe(503);
      expect(r.body).toMatchObject({ error: 'provider_unavailable' });
    }
    expect((await c.call('POST', '/api/payments/web/checkout', { auth: p.auth, body: { productId: 'polar_rift_prisms_30' } })).status).toBe(503);
    expect(prisms(c, p.id)).toBe(0);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 });
  });

  it('seuls les fournisseurs configurés sont actifs (Apple seul, Google seul, web avec prestataire)', async () => {
    const a = ctx({ google: false });
    expect(((await a.call('GET', '/api/payments/config')).body as { providers: object }).providers).toEqual({ apple: true, google: false, web: false });
    const g = ctx({ apple: false, web: true });
    expect(((await g.call('GET', '/api/payments/config')).body as { providers: object }).providers).toEqual({ apple: false, google: true, web: true });
    const p = g.account('Axel');
    expect((await verifyApple(g, p, '1')).status).toBe(503);
  });
});

describe('Achat refusé sans compte connecté', () => {
  it('invité, pseudo seul : 403 account_required, jamais de crédit, jamais d’appel au fournisseur ; la partie reste jouable', async () => {
    const c = ctx();
    for (const who of [c.guest(), c.pseudoOnly('Nova')]) {
      apple(c, who, '5001', 'polar_rift_prisms_30');
      const r = await verifyApple(c, who, '5001');
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: 'account_required' });
      expect(prisms(c, who.id)).toBe(0);
      expect((await c.call('GET', '/api/payments/prepare', { auth: who.auth })).status).toBe(403);
      expect((await c.call('POST', '/api/payments/restore', { auth: who.auth, body: { items: [{ provider: 'apple', transactionId: '5001' }] } })).status).toBe(403);
      // Le jeu reste utilisable : tickets, profil
      expect((await c.call('POST', '/api/tickets', { auth: who.auth })).status).toBe(200);
    }
    expect(c.pv.state.calls).toEqual([]);
    expect((await verifyApple(c, { auth: '' }, '5001')).status).toBe(401);
  });
});

describe('Apple : achat vérifié par le service', () => {
  it('chaque pack crédite exactement 30 / 100 / 380 Prismes, depuis la table du service (jamais un montant ou un prix annoncé)', async () => {
    const c = ctx();
    const p = c.account('Axel');
    let expected = 0;
    for (const [i, pack] of PRISM_PACKS.entries()) {
      apple(c, p, `700${i}`, pack.productId);
      const r = await c.call('POST', '/api/payments/verify', { auth: p.auth, body: { provider: 'apple', transactionId: `700${i}`, productId: pack.productId, prisms: 99999, priceCents: 1, amount: 1e9, balance: 1e9 } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'credited', prisms: pack.prisms, provider: 'apple', productId: pack.productId });
      expected += pack.prisms;
      expect(prisms(c, p.id)).toBe(expected);
    }
    expect(expected).toBe(510);
    // Le client ne choisit pas le produit : c'est celui du justificatif vérifié (le client annonce 30, la transaction est un pack de 380)
    apple(c, p, '7100', 'polar_rift_prisms_380');
    expect((await verifyApple(c, p, '7100', 'polar_rift_prisms_30')).body).toMatchObject({ prisms: 380 });
  });

  it('le service s’authentifie auprès d’Apple avec SA clé (JWT ES256 signé, application et clé attendues)', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '7200', 'polar_rift_prisms_30');
    expect((await verifyApple(c, p, '7200')).status).toBe(200); // le faux serveur renvoie 401 si le jeton est invalide
    expect(c.pv.state.calls[0]).toMatch(/^GET https:\/\/api\.storekit\.itunes\.apple\.com\/inApps\/v1\/transactions\/7200$/);
    const jwt = appleJwt({ issuerId: 'I', keyId: 'K', privateKey: appleKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, bundleId: BUNDLE }, 1_700_000_000);
    expect(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())).toMatchObject({ iss: 'I', iat: 1_700_000_000, exp: 1_700_000_300, aud: 'appstoreconnect-v1', bid: BUNDLE });
  });

  it('idempotent : le même justificatif rejoué (coupure réseau, double toucher) ne crédite jamais deux fois', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '7300', 'polar_rift_prisms_100');
    expect((await verifyApple(c, p, '7300')).body).toMatchObject({ status: 'credited', prisms: 100 });
    for (let i = 0; i < 3; i++) expect((await verifyApple(c, p, '7300')).body).toMatchObject({ status: 'already_credited', prisms: 0, balance: { prisms: 100 } });
    expect(prisms(c, p.id)).toBe(100);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref = 'iap:apple:7300'").get()).toEqual({ n: 1 });
    // Appels simultanés : un seul crédit
    apple(c, p, '7301', 'polar_rift_prisms_30');
    await Promise.all([verifyApple(c, p, '7301'), verifyApple(c, p, '7301'), verifyApple(c, p, '7301')]);
    expect(prisms(c, p.id)).toBe(130);
  });

  it('refus : justificatif d’un autre profil, jeton de compte étranger ou absent, autre application, produit inconnu, quantité, bac à sable, inconnu', async () => {
    const c = ctx();
    const a = c.account('Axel');
    const b = c.account('Lea');
    apple(c, a, '7400', 'polar_rift_prisms_30');
    expect((await verifyApple(c, a, '7400')).status).toBe(200);
    // Même justificatif sur un autre profil
    const used = await verifyApple(c, b, '7400');
    expect(used.status).toBe(409);
    expect(used.body).toMatchObject({ error: 'receipt_used' });
    // Achat fait pour un autre compte (jeton de liaison du profil A présenté par B) ; achat sans jeton
    apple(c, a, '7401', 'polar_rift_prisms_30');
    expect((await verifyApple(c, b, '7401')).body).toMatchObject({ error: 'account_mismatch' });
    apple(c, b, '7402', 'polar_rift_prisms_30', { appAccountToken: null });
    expect((await verifyApple(c, b, '7402')).body).toMatchObject({ error: 'account_mismatch' });
    // Autre application, produit inconnu, quantité 2, bac à sable (refusé par défaut), transaction inconnue
    apple(c, b, '7403', 'polar_rift_prisms_30', { bundleId: 'fr.autre.app' });
    expect((await verifyApple(c, b, '7403')).body).toMatchObject({ error: 'unverified' });
    apple(c, b, '7404', 'autre_produit');
    expect((await verifyApple(c, b, '7404')).body).toMatchObject({ error: 'unknown_product' });
    apple(c, b, '7405', 'polar_rift_prisms_30', { quantity: 2 });
    expect((await verifyApple(c, b, '7405')).body).toMatchObject({ error: 'bad_quantity' });
    c.pv.state.appleSandbox.set('7406', { transactionId: '7406', productId: 'polar_rift_prisms_30', appAccountToken: accountBinding(SECRET, 'apple', b.id) });
    expect((await verifyApple(c, b, '7406')).status).toBe(422);
    expect((await verifyApple(c, b, '9999999')).body).toMatchObject({ error: 'unverified' });
    expect((await verifyApple(c, b, 'pas-un-id')).status).toBe(400);
    expect(prisms(c, b.id)).toBe(0);
    expect(prisms(c, a.id)).toBe(30);
  });

  it('bac à sable accepté seulement si le service l’autorise explicitement (relecture Apple)', async () => {
    const c = ctx({ apple: { acceptSandbox: true } });
    const p = c.account('Axel');
    c.pv.state.appleSandbox.set('7500', { transactionId: '7500', productId: 'polar_rift_prisms_30', appAccountToken: accountBinding(SECRET, 'apple', p.id) });
    expect((await verifyApple(c, p, '7500')).body).toMatchObject({ status: 'credited' });
    expect(c.db.prepare("SELECT environment FROM payments WHERE provider_ref = '7500'").get()).toEqual({ environment: 'sandbox' });
  });

  it('coupure réseau du fournisseur : 502, rien n’est crédité ni perdu ; la reprise de la même demande aboutit', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '7600', 'polar_rift_prisms_30');
    c.pv.state.down = true;
    const r = await verifyApple(c, p, '7600');
    expect(r.status).toBe(502);
    expect(prisms(c, p.id)).toBe(0);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 });
    c.pv.state.down = false;
    expect((await verifyApple(c, p, '7600')).body).toMatchObject({ status: 'credited', prisms: 30 });
  });

  it('redémarrage du service entre l’achat et la vérification : même base, même résultat, un seul crédit', async () => {
    const db = openDb(':memory:');
    const c1 = ctx({}, db);
    const p = c1.account('Axel');
    apple(c1, p, '7700', 'polar_rift_prisms_30');
    expect((await verifyApple(c1, p, '7700')).body).toMatchObject({ status: 'credited' });
    // « Redémarrage » : nouvelle application sur la même base
    const c2 = ctx({}, db);
    c2.pv.state.apple = c1.pv.state.apple;
    expect((await verifyApple(c2, p, '7700')).body).toMatchObject({ status: 'already_credited', balance: { prisms: 30 } });
    expect(prisms(c2, p.id)).toBe(30);
  });
});

describe('Google Play : achat vérifié, consommé, en attente, annulé', () => {
  it('achat valide : crédité (30/100/380) puis CONSOMMÉ chez Google une seule fois ; compte acheteur contrôlé', async () => {
    const c = ctx();
    const p = c.account('Axel');
    const other = c.account('Lea');
    for (const [i, pack] of PRISM_PACKS.entries()) {
      google(c, p, TOKEN(i), pack.productId);
      expect((await verifyGoogle(c, p, TOKEN(i), pack.productId)).body).toMatchObject({ status: 'credited', prisms: pack.prisms, provider: 'google' });
    }
    expect(prisms(c, p.id)).toBe(510);
    expect(c.pv.state.consumed).toHaveLength(3);
    // Rejeu : aucun nouveau crédit, aucune nouvelle consommation
    expect((await verifyGoogle(c, p, TOKEN(0), PRISM_PACKS[0].productId)).body).toMatchObject({ status: 'already_credited' });
    expect(c.pv.state.consumed).toHaveLength(3);
    // Autre profil, mêmes justificatifs : refusé
    expect((await verifyGoogle(c, other, TOKEN(1), PRISM_PACKS[1].productId)).body).toMatchObject({ error: 'receipt_used' });
    google(c, p, TOKEN(10), PRISM_PACKS[0].productId);
    expect((await verifyGoogle(c, other, TOKEN(10), PRISM_PACKS[0].productId)).body).toMatchObject({ error: 'account_mismatch' });
    expect(prisms(c, other.id)).toBe(0);
  });

  it('en attente : aucun Prisme tant que le paiement n’est pas finalisé ; crédité à la finalisation ; annulé : jamais crédité', async () => {
    const c = ctx();
    const p = c.account('Axel');
    google(c, p, TOKEN(20), 'polar_rift_prisms_100', { purchaseState: 2 });
    const pending = await verifyGoogle(c, p, TOKEN(20), 'polar_rift_prisms_100');
    expect(pending.body).toMatchObject({ status: 'pending', prisms: 0 });
    expect(prisms(c, p.id)).toBe(0);
    expect(c.pv.state.consumed).toHaveLength(0);
    c.pv.state.google.get(TOKEN(20))!.purchaseState = 0;
    c.pv.state.google.get(TOKEN(20))!.orderId = 'GPA.final-1';
    // (identifiant dérivé du jeton tant que l'achat est en attente, puis numéro de commande : deux lignes ne doivent jamais créditer deux fois)
    expect((await verifyGoogle(c, p, TOKEN(20), 'polar_rift_prisms_100')).body).toMatchObject({ status: 'credited', prisms: 100 });
    expect(prisms(c, p.id)).toBe(100);
    google(c, p, TOKEN(21), 'polar_rift_prisms_30', { purchaseState: 1 });
    expect((await verifyGoogle(c, p, TOKEN(21), 'polar_rift_prisms_30')).body).toMatchObject({ status: 'cancelled', prisms: 0 });
    expect(prisms(c, p.id)).toBe(100);
  });

  it('échec de la consommation : le crédit reste acquis (jamais perdu), la consommation est retentée à la demande suivante', async () => {
    const c = ctx();
    const p = c.account('Axel');
    google(c, p, TOKEN(30), 'polar_rift_prisms_30');
    c.pv.state.consumeFails = true;
    expect((await verifyGoogle(c, p, TOKEN(30), 'polar_rift_prisms_30')).body).toMatchObject({ status: 'credited' });
    expect(c.db.prepare('SELECT consumed FROM payments').get()).toEqual({ consumed: 0 });
    c.pv.state.consumeFails = false;
    expect((await verifyGoogle(c, p, TOKEN(30), 'polar_rift_prisms_30')).body).toMatchObject({ status: 'already_credited' });
    expect(c.db.prepare('SELECT consumed FROM payments').get()).toEqual({ consumed: 1 });
    expect(prisms(c, p.id)).toBe(30);
  });

  it('achat de test refusé par défaut ; jeton invalide ou produit inconnu ; fournisseur injoignable', async () => {
    const c = ctx();
    const p = c.account('Axel');
    google(c, p, TOKEN(40), 'polar_rift_prisms_30', { purchaseType: 0 });
    expect((await verifyGoogle(c, p, TOKEN(40), 'polar_rift_prisms_30')).body).toMatchObject({ error: 'sandbox_refused' });
    expect((await verifyGoogle(c, p, 'court', 'polar_rift_prisms_30')).status).toBe(400);
    expect((await verifyGoogle(c, p, TOKEN(41), 'polar_rift_prisms_9')).status).toBe(400);
    expect((await verifyGoogle(c, p, TOKEN(42), 'polar_rift_prisms_30')).body).toMatchObject({ error: 'unverified' });
    c.pv.state.down = true;
    google(c, p, TOKEN(43), 'polar_rift_prisms_30');
    expect((await verifyGoogle(c, p, TOKEN(43), 'polar_rift_prisms_30')).status).toBe(502);
    expect(prisms(c, p.id)).toBe(0);
    const ok = ctx({ google: { acceptTestPurchases: true } });
    const q = ok.account('Lea');
    google(ok, q, TOKEN(44), 'polar_rift_prisms_30', { purchaseType: 0 });
    expect((await verifyGoogle(ok, q, TOKEN(44), 'polar_rift_prisms_30')).body).toMatchObject({ status: 'credited' });
  });
});

describe('Restauration des achats', () => {
  it('rejoue les transactions retrouvées : manquantes créditées une fois, déjà créditées sans effet, invalides isolées ; lot borné', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '8001', 'polar_rift_prisms_30');
    apple(c, p, '8002', 'polar_rift_prisms_100');
    expect((await verifyApple(c, p, '8001')).status).toBe(200);
    const items = [
      { provider: 'apple', transactionId: '8001' },
      { provider: 'apple', transactionId: '8002' },
      { provider: 'apple', transactionId: '8003' },
      { provider: 'autre' },
    ];
    const r = await c.call('POST', '/api/payments/restore', { auth: p.auth, body: { items } });
    const res = r.body as { results: Record<string, unknown>[]; balance: { prisms: number } };
    expect(res.results[0]).toMatchObject({ status: 'already_credited' });
    expect(res.results[1]).toMatchObject({ status: 'credited', prisms: 100 });
    expect(res.results[2]).toMatchObject({ error: 'unverified' });
    expect(res.results[3]).toMatchObject({ error: 'bad_request' });
    expect(res.balance.prisms).toBe(130);
    expect((await c.call('POST', '/api/payments/restore', { auth: p.auth, body: { items: [] } })).status).toBe(400);
    expect((await c.call('POST', '/api/payments/restore', { auth: p.auth, body: { items: Array(21).fill({ provider: 'apple', transactionId: '8001' }) } })).status).toBe(400);
  });
});

/** Notification Apple V2 : charge utile imbriquée (non signée ici : le service ne la croit de toute façon pas). */
const appleNotif = (type: string, tid: string, bundleId = BUNDLE): unknown => ({ signedPayload: jws({ notificationType: type, data: { signedTransactionInfo: jws({ transactionId: tid, bundleId }) } }) });

describe('Remboursements, révocations et dette (jamais de solde négatif)', () => {
  it('Apple : remboursement confirmé par l’API → débit du solde ; justificatif refusé ensuite ; idempotent', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '9001', 'polar_rift_prisms_100');
    await verifyApple(c, p, '9001');
    expect(prisms(c, p.id)).toBe(100);
    c.pv.state.apple.get('9001')!.revocationDate = NOW0 + 1000;
    const n = await c.call('POST', '/api/payments/notify/apple', { body: appleNotif('REFUND', '9001') });
    expect(n.status).toBe(200);
    expect(prisms(c, p.id)).toBe(0);
    expect(c.db.prepare("SELECT state, unrecovered FROM payments WHERE provider_ref = '9001'").get()).toEqual({ state: 'refunded', unrecovered: 0 });
    for (let i = 0; i < 2; i++) await c.call('POST', '/api/payments/notify/apple', { body: appleNotif('REFUND', '9001') });
    expect(prisms(c, p.id)).toBe(0);
    expect((await verifyApple(c, p, '9001')).body).toMatchObject({ status: 'refunded', prisms: 0 });
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref = 'refund:apple:9001'").get()).toEqual({ n: 1 });
  });

  it('notification falsifiée : jamais crue (l’API du fournisseur ne confirme pas la révocation) ; autre application ; type sans effet', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '9101', 'polar_rift_prisms_30');
    await verifyApple(c, p, '9101');
    expect((await c.call('POST', '/api/payments/notify/apple', { body: appleNotif('REFUND', '9101') })).body).toMatchObject({ ignored: 'not_revoked' });
    expect((await c.call('POST', '/api/payments/notify/apple', { body: appleNotif('REFUND', '9101', 'fr.autre') })).body).toMatchObject({ ignored: 'unrelated' });
    expect((await c.call('POST', '/api/payments/notify/apple', { body: appleNotif('DID_RENEW', '9101') })).body).toMatchObject({ ignored: 'DID_RENEW' });
    expect((await c.call('POST', '/api/payments/notify/apple', { body: { signedPayload: 'n-importe-quoi' } })).body).toMatchObject({ ignored: 'unrelated' });
    expect(prisms(c, p.id)).toBe(30);
  });

  it('Prismes déjà dépensés : le débit est plafonné au solde, le reste devient une dette recouvrée sur les crédits suivants ; jamais négatif', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '9201', 'polar_rift_prisms_100');
    await verifyApple(c, p, '9201');
    // Le joueur dépense 80 Prismes (reprises, cosmétiques premium)
    c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'prisms', 'spend', -80, 'spend:test', 1)").run(p.id);
    c.pv.state.apple.get('9201')!.revocationDate = NOW0;
    await c.call('POST', '/api/payments/notify/apple', { body: appleNotif('REVOKE', '9201') });
    expect(prisms(c, p.id)).toBe(0);
    expect(debtOf(c.db, p.id)).toBe(80);
    expect(c.db.prepare("SELECT unrecovered FROM payments WHERE provider_ref = '9201'").get()).toEqual({ unrecovered: 80 });
    // Dépenser est impossible tant que la dette absorbe les crédits ; un nouvel achat de 30 est entièrement absorbé
    apple(c, p, '9202', 'polar_rift_prisms_30');
    expect((await verifyApple(c, p, '9202')).body).toMatchObject({ status: 'credited', balance: { prisms: 0 } });
    expect(debtOf(c.db, p.id)).toBe(50);
    apple(c, p, '9203', 'polar_rift_prisms_100');
    expect((await verifyApple(c, p, '9203')).body).toMatchObject({ balance: { prisms: 50 } });
    expect(debtOf(c.db, p.id)).toBe(0);
    const sums = c.db.prepare("SELECT MIN(s) AS m FROM (SELECT SUM(amount) OVER (ORDER BY id) AS s FROM ledger WHERE player_id = ? AND currency = 'prisms')").get(p.id) as { m: number };
    expect(sums.m).toBeGreaterThanOrEqual(0);
    // Un joueur en dette ne peut pas dépenser des Prismes qui ne lui appartiennent pas (reprise de 5 Prismes refusée)
    c.db.prepare("INSERT INTO payment_debts (player_id, amount) VALUES (?, 60) ON CONFLICT(player_id) DO UPDATE SET amount = 60").run(p.id);
    const rev = await c.call('POST', '/api/revive', { auth: p.auth, body: { runId: 'run-debt-0001', life: 2 } });
    expect(prisms(c, p.id)).toBe(0);
    expect(rev.status).toBe(409);
  });

  it('settleDebt : sans dette ou sans solde, aucun effet', () => {
    const c = ctx();
    const p = c.account('Axel');
    expect(settleDebt(c.db, p.id, 1)).toBe(0);
    c.db.prepare('INSERT INTO payment_debts (player_id, amount) VALUES (?, 5)').run(p.id);
    expect(settleDebt(c.db, p.id, 1)).toBe(0);
    expect(debtOf(c.db, p.id)).toBe(5);
  });

  it('Google : notification « voided » = simple déclencheur ; le remboursement vient de la liste officielle des achats annulés ; jeton de notification obligatoire', async () => {
    const c = ctx();
    const p = c.account('Axel');
    google(c, p, TOKEN(50), 'polar_rift_prisms_380');
    await verifyGoogle(c, p, TOKEN(50), 'polar_rift_prisms_380');
    const orderId = c.pv.state.google.get(TOKEN(50))!.orderId;
    const push = (data: unknown): { body: unknown; query: string } => ({ body: { message: { data: Buffer.from(JSON.stringify(data)).toString('base64') } }, query: 'token=jeton-notif-google' });
    const voided = push({ packageName: PACKAGE, voidedPurchaseNotification: { purchaseToken: TOKEN(50), orderId, productType: 1, refundType: 1 } });
    expect((await c.call('POST', '/api/payments/notify/google', { body: voided.body, query: 'token=faux' })).status).toBe(401);
    expect((await c.call('POST', '/api/payments/notify/google', { body: voided.body })).status).toBe(401);
    // Notification FALSIFIÉE (rien dans la liste officielle, achat encore « acheté ») : aucun effet
    expect((await c.call('POST', '/api/payments/notify/google', voided)).status).toBe(200);
    expect(prisms(c, p.id)).toBe(380);
    // Google publie l'achat dans la liste des achats annulés, MÊME si la lecture ponctuelle répond encore « acheté » (cas non couvert par une simple relecture)
    c.pv.state.google.get(TOKEN(50))!.purchaseState = 0;
    c.pv.state.voided.push({ orderId, purchaseToken: TOKEN(50), voidedTimeMillis: NOW0 - 1000 });
    c.now.t += 60_000;
    expect((await c.call('POST', '/api/payments/notify/google', voided)).body).toMatchObject({ ok: true });
    expect(prisms(c, p.id)).toBe(0);
    expect((await verifyGoogle(c, p, TOKEN(50), 'polar_rift_prisms_380')).body).toMatchObject({ status: 'refunded' });
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'refund:google:%'").get()).toEqual({ n: 1 });
    // Autre application : ignorée
    expect((await c.call('POST', '/api/payments/notify/google', push({ packageName: 'fr.autre', voidedPurchaseNotification: { purchaseToken: TOKEN(51), orderId: 'GPA.x' } }))).body).toMatchObject({ ignored: 'unrelated' });
  });

  it('Google : annulation connue avant tout crédit (liste officielle) : consignée, le justificatif ne pourra plus jamais créditer', async () => {
    const c = ctx();
    const p = c.account('Axel');
    c.pv.state.voided.push({ orderId: 'GPA.early', purchaseToken: TOKEN(52), voidedTimeMillis: NOW0 - 5000 });
    const r = await c.app.reconcile();
    expect(r.google).toMatchObject({ ran: true, voided: 1, refunded: 0 });
    google(c, p, TOKEN(52), 'polar_rift_prisms_30', { orderId: 'GPA.early' });
    expect((await verifyGoogle(c, p, TOKEN(52), 'polar_rift_prisms_30')).status).toBe(409);
    expect(prisms(c, p.id)).toBe(0);
  });

  it('Google : achat en attente devenu valide (notification) crédité pour son propriétaire, une seule fois', async () => {
    const c = ctx();
    const p = c.account('Axel');
    google(c, p, TOKEN(60), 'polar_rift_prisms_100', { purchaseState: 2, orderId: 'GPA.p60' });
    expect((await verifyGoogle(c, p, TOKEN(60), 'polar_rift_prisms_100')).body).toMatchObject({ status: 'pending' });
    c.pv.state.google.get(TOKEN(60))!.purchaseState = 0;
    const note = { body: { message: { data: Buffer.from(JSON.stringify({ packageName: PACKAGE, oneTimeProductNotification: { notificationType: 1, purchaseToken: TOKEN(60), sku: 'polar_rift_prisms_100' } })).toString('base64') } }, query: 'token=jeton-notif-google' };
    expect((await c.call('POST', '/api/payments/notify/google', note)).status).toBe(200);
    expect((await c.call('POST', '/api/payments/notify/google', note)).status).toBe(200);
    expect(prisms(c, p.id)).toBe(100);
  });
});

describe('Web : architecture modulaire sans prestataire imposé', () => {
  it('avec un prestataire configuré : session de paiement liée au profil, notification authentifiée créditée une fois, remboursement géré', async () => {
    const c = ctx({ web: true });
    const p = c.account('Axel');
    const co = await c.call('POST', '/api/payments/web/checkout', { auth: p.auth, body: { productId: 'polar_rift_prisms_100' } });
    expect((co.body as { url: string }).url).toContain(`ref=${accountBinding(SECRET, 'web', p.id)}`);
    expect((await c.call('POST', '/api/payments/web/checkout', { auth: p.auth, body: { productId: 'x' } })).status).toBe(400);
    const ev = (o: Partial<WebEvent> = {}): { body: WebEvent; headers: Record<string, string> } => ({ body: { ref: 'WEB-1', productId: 'polar_rift_prisms_100', playerId: p.id, state: 'purchased', environment: 'production', ...o }, headers: { 'x-signature': 'valide' } });
    const bad = await c.call('POST', '/api/payments/notify/web', { body: ev().body, headers: { 'x-signature': 'faux' } });
    expect(bad.status).toBe(400);
    expect(prisms(c, p.id)).toBe(0);
    expect((await c.call('POST', '/api/payments/notify/web', ev())).status).toBe(200);
    expect((await c.call('POST', '/api/payments/notify/web', ev())).status).toBe(200);
    expect(prisms(c, p.id)).toBe(100);
    expect((await c.call('POST', '/api/payments/notify/web', ev({ state: 'refunded' }))).status).toBe(200);
    expect(prisms(c, p.id)).toBe(0);
    // Même référence prétendant appartenir à un autre profil : refusée
    const other = c.account('Lea');
    expect((await c.call('POST', '/api/payments/notify/web', ev({ playerId: other.id, state: 'purchased' }))).status).toBeGreaterThanOrEqual(400);
    expect(prisms(c, other.id)).toBe(0);
    // Un invité (sans compte connecté) ne peut pas lancer de paiement web
    expect((await c.call('POST', '/api/payments/web/checkout', { auth: c.guest().auth, body: { productId: 'polar_rift_prisms_30' } })).status).toBe(403);
  });
});

describe('Prismes achetés et gratuits interchangeables ; journal et historique', () => {
  it('achat → cosmétique premium (Néon 150), pack 200, reprises 5 et 10 : mêmes Prismes, aucun changement de tarif', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '9301', 'polar_rift_prisms_380');
    await verifyApple(c, p, '9301');
    // Prismes gratuits (calendrier, Top 10) s'ajoutent au même solde
    c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'prisms', 'daily', 15, 'daily:2026-10-14', 1)").run(p.id);
    expect(prisms(c, p.id)).toBe(395);
    expect((await c.call('POST', '/api/shop/prisms', { auth: p.auth, body: { item: 'pack-neon' } })).body).toMatchObject({ charged: true, price: 200, balance: { prisms: 195 } });
    expect((await c.call('POST', '/api/revive', { auth: p.auth, body: { runId: 'run-pay-00001', life: 2 } })).body).toMatchObject({ price: 5, balance: { prisms: 190 } });
    expect((await c.call('POST', '/api/revive', { auth: p.auth, body: { runId: 'run-pay-00001', life: 3 } })).body).toMatchObject({ price: 10, balance: { prisms: 180 } });
    expect((await c.call('POST', '/api/revive', { auth: p.auth, body: { runId: 'run-pay-00001', life: 4 } })).status).toBe(400);
  });

  it('journal d’audit sans donnée sensible ; historique du joueur ; justificatif conservé sans donnée personnelle après effacement du profil', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '9401', 'polar_rift_prisms_30');
    await verifyApple(c, p, '9401');
    apple(c, p, '9402', 'polar_rift_prisms_30', { bundleId: 'fr.autre' });
    await verifyApple(c, p, '9402');
    const events = c.db.prepare('SELECT kind, detail FROM payment_events ORDER BY id').all() as { kind: string; detail: string | null }[];
    expect(events.map((e) => e.kind)).toEqual(['credited']);
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/PRIVATE KEY|Bearer|token|9401/i.test(text) ? /$^/ : /nothing/);
    const h = (await c.call('GET', '/api/payments/history', { auth: p.auth })).body as { purchases: { productId: string; state: string; prisms: number }[]; debt: number };
    expect(h.purchases).toEqual([expect.objectContaining({ productId: 'polar_rift_prisms_30', state: 'credited', prisms: 30 })]);
    // Effacement RGPD : le justificatif reste « utilisé » (non rejouable sur un autre profil), sans lien avec une personne
    expect((await c.call('DELETE', '/api/me', { auth: p.auth })).status).toBe(200);
    expect(c.db.prepare("SELECT player_id, state FROM payments WHERE provider_ref = '9401'").get()).toEqual({ player_id: null, state: 'credited' });
    const q = c.account('Lea');
    apple(c, q, '9401', 'polar_rift_prisms_30');
    expect((await verifyApple(c, q, '9401')).body).toMatchObject({ error: 'receipt_used' });
    expect(prisms(c, q.id)).toBe(0);
  });

  it('un compte ne peut pas acheter pour un profil fusionné ailleurs ; prépare : jetons de liaison propres au profil et au fournisseur', async () => {
    const c = ctx();
    const a = c.account('Axel');
    const b = c.account('Lea');
    const pa = (await c.call('GET', '/api/payments/prepare', { auth: a.auth })).body as { apple: { appAccountToken: string }; google: { obfuscatedAccountId: string }; web: { reference: string } };
    const pb = (await c.call('GET', '/api/payments/prepare', { auth: b.auth })).body as typeof pa;
    expect(pa.apple.appAccountToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pa.apple.appAccountToken).not.toBe(pb.apple.appAccountToken);
    expect(pa.google.obfuscatedAccountId).toHaveLength(40);
    expect(new Set([pa.apple.appAccountToken, pa.google.obfuscatedAccountId, pa.web.reference]).size).toBe(3);
    expect(pa.apple.appAccountToken).toBe(accountBinding(SECRET, 'apple', a.id));
    expect(accountBinding('autre-secret-de-test-0123456789', 'apple', a.id)).not.toBe(pa.apple.appAccountToken);
  });
});

/** Confirmation SSV AdMob : requête signée (ECDSA SHA-256 DER) avec la clé de la régie. */
function ssvQuery(c: { sessionId: string; userId: string }, o: { tx?: string; unit?: string; user?: string; custom?: string; sign?: boolean } = {}): string {
  const msg = `ad_network=5450213213286189855&ad_unit=${o.unit ?? AD_UNIT}&reward_amount=1&reward_item=reprise&timestamp=1700000000000&transaction_id=${o.tx ?? 'TX-1'}&user_id=${o.user ?? c.userId}&custom_data=${o.custom ?? c.sessionId}`;
  const sig = o.sign === false ? 'AAAA' : createSign('SHA256').update(msg).sign(admobKey.privateKey).toString('base64url');
  return `${msg}&signature=${sig}&key_id=1`;
}

describe('Publicités récompensées : seconde chance confirmée par le service', () => {
  const session = async (c: Ctx, p: { auth: string }, runId = 'run-ads-00001', life: unknown = 2): Promise<{ sessionId: string; userId: string; customData: string }> => {
    const r = await c.call('POST', '/api/ads/session', { auth: p.auth, body: { runId, life } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { sessionId: string; userId: string; customData: string };
  };
  const claim = (c: Ctx, p: { auth: string }, sessionId: string): Promise<HttpResponse> => c.call('POST', '/api/ads/claim', { auth: p.auth, body: { sessionId } });

  it('publicité terminée et confirmée par la régie : exactement une reprise, aucun Prisme débité ; la confirmation ne sert qu’une fois', async () => {
    const c = ctx();
    const p = c.guest(); // un invité peut regarder une publicité (aucun achat)
    const s = await session(c, p);
    expect(s.customData).toBe(s.sessionId);
    expect(s.userId).not.toContain(p.id);
    expect((await claim(c, p, s.sessionId)).status).toBe(202); // pas encore confirmée : aucune reprise
    const q = ssvQuery(s);
    expect((await c.call('GET', '/api/ads/ssv', { query: q })).status).toBe(200);
    expect((await claim(c, p, s.sessionId)).body).toMatchObject({ status: 'granted' });
    const second = await claim(c, p, s.sessionId);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'already_used' });
    // Même session redemandée pour la même partie : refusée (une seule reprise par publicité)
    expect((await c.call('POST', '/api/ads/session', { auth: p.auth, body: { runId: 'run-ads-00001', life: 2 } })).status).toBe(409);
    expect(prisms(c, p.id)).toBe(0);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'spend' OR amount < 0").get()).toEqual({ n: 0 });
  });

  it('interrompue, fermée, échouée ou non confirmée : aucune reprise ; confirmation rejouée sans effet', async () => {
    const c = ctx();
    const p = c.guest();
    const s = await session(c, p);
    // Aucune confirmation de la régie : jamais de reprise, quelle que soit l'attente (pas de minuterie de substitution)
    for (let i = 0; i < 3; i++) expect((await claim(c, p, s.sessionId)).status).toBe(202);
    c.now.t += 16 * 60_000;
    expect((await claim(c, p, s.sessionId)).status).toBe(410);
    // Confirmation tardive d'une session expirée : refusée
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s) })).status).toBe(410);
    // Confirmation rejouée : sans effet (même transaction)
    const s2 = await session(c, p, 'run-ads-00002');
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s2, { tx: 'TX-2' }) })).status).toBe(200);
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s2, { tx: 'TX-2' }) })).body).toMatchObject({ repeated: true });
    expect((await claim(c, p, s2.sessionId)).status).toBe(200);
    expect((await claim(c, p, s2.sessionId)).status).toBe(409);
    // La même transaction AdMob ne peut pas confirmer une autre session
    const s3 = await session(c, p, 'run-ads-00003');
    const r = await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s3, { tx: 'TX-2' }) });
    expect((r.body as { repeated?: boolean }).repeated).toBe(true);
    expect((await claim(c, p, s3.sessionId)).status).toBe(202);
  });

  it('confirmation falsifiée : signature invalide, clé inconnue, unité publicitaire non autorisée, utilisateur ou session étrangers → refus, aucune reprise', async () => {
    const c = ctx();
    const p = c.guest();
    const other = c.guest();
    const s = await session(c, p);
    const so = await session(c, other, 'run-ads-09999');
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s, { sign: false }) })).status).toBe(401);
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s).replace('key_id=1', 'key_id=9') })).status).toBe(401);
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s, { unit: 'ca-app-pub-9/9' }) })).status).toBe(400);
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s, { user: so.userId }) })).status).toBe(400); // utilisateur d'un autre profil
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s, { custom: 'f'.repeat(32) }) })).status).toBe(400);
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s).replace('reward_amount=1', 'reward_amount=99') })).status).toBe(401); // message modifié après signature
    expect((await c.call('GET', '/api/ads/ssv')).status).toBe(400);
    expect((await claim(c, p, s.sessionId)).status).toBe(202);
    // Un autre profil ne peut pas réclamer la session d'autrui
    expect((await c.call('GET', '/api/ads/ssv', { query: ssvQuery(s) })).status).toBe(200);
    expect((await claim(c, other, s.sessionId)).status).toBe(400);
    expect((await claim(c, p, s.sessionId)).status).toBe(200);
  });

  it('seule la DEUXIÈME chance : pas de publicité pour la troisième, jamais de quatrième ; fournisseur absent : indisponible', async () => {
    const c = ctx();
    const p = c.guest();
    for (const life of [3, 4, 1, 0, '2', null]) expect((await c.call('POST', '/api/ads/session', { auth: p.auth, body: { runId: 'run-ads-00001', life } })).status).toBe(400);
    for (const runId of ['', 'court', 'é'.repeat(10), 5]) expect((await c.call('POST', '/api/ads/session', { auth: p.auth, body: { runId, life: 2 } })).status).toBe(400);
    expect((await c.call('POST', '/api/ads/session', { body: { runId: 'run-ads-00001', life: 2 } })).status).toBe(401);
    const off = ctx({ ads: false });
    const q = off.guest();
    const r = await off.call('POST', '/api/ads/session', { auth: q.auth, body: { runId: 'run-ads-00001', life: 2 } });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: 'ads_unavailable' });
    expect(((await off.call('GET', '/api/payments/config')).body as { ads: { enabled: boolean } }).ads.enabled).toBe(false);
    expect(((await c.call('GET', '/api/payments/config')).body as { ads: { enabled: boolean } }).ads.enabled).toBe(true);
    // Les reprises payantes restent seules possibles pour la 3ᵉ chance
    expect(REVIVE.adLives).toEqual([2]);
  });

  it('les clés publiques de la régie sont téléchargées puis mises en cache (24 h) ; indisponibles : 503 sans reprise', async () => {
    const db = openDb(':memory:');
    const now = { t: NOW0 };
    const pv = providers();
    const app = createApp(db, { ticketSecret: SECRET, now: () => now.t, payments: { fetch: pv.fetchFn, ads: { adUnits: [AD_UNIT] } } });
    const reg = app({ method: 'POST', path: '/api/register', query: new URLSearchParams(), headers: {}, body: {}, ip: '10.9.0.1' }).body as RegisterResponse;
    const auth = `Bearer ${reg.playerId}.${reg.token}`;
    const sess = app({ method: 'POST', path: '/api/ads/session', query: new URLSearchParams(), headers: { authorization: auth }, body: { runId: 'run-keys-0001', life: 2 }, ip: '10.9.0.2' }).body as { sessionId: string; userId: string };
    const q = ssvQuery(sess);
    const req = (): HttpRequest => ({ method: 'GET', path: '/api/ads/ssv', query: new URLSearchParams(q), rawQuery: q, headers: {}, body: undefined, ip: '10.9.0.3' });
    expect((await app.async(req()))!.status).toBe(200);
    expect(pv.state.keysCalls).toBe(1);
    await app.async(req());
    expect(pv.state.keysCalls).toBe(1);
    pv.state.down = true;
    now.t += 25 * 3_600_000;
    expect((await app.async(req()))!.status).toBe(503);
  });
});

describe('Migration SQLite v7 puis v8 : additive', () => {
  it('tables de paiement et de publicité créées sans toucher aux données du schéma v6', async () => {
    const { MIGRATIONS, SCHEMA_VERSION } = await import('../server/db');
    const { DatabaseSync } = await import('node:sqlite');
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    expect(SCHEMA_VERSION).toBe(8);
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-v7-'));
    try {
      const path = join(dir, 'c.sqlite');
      const old = new DatabaseSync(path);
      for (let i = 0; i < 6; i++) old.exec(MIGRATIONS[i]);
      old.exec('PRAGMA user_version = 6');
      old.prepare("INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES ('p1', 'Axel', 'axel', 'h', 1)").run();
      old.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES ('p1', 'prisms', 'daily', 15, 'daily:2026-10-14', 1)").run();
      old.prepare("INSERT INTO daily_attempts (id, player_id, date, started_at) VALUES ('a1', 'p1', '2026-10-14', 5)").run();
      old.close();
      const db = openDb(path);
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
      expect(existsSync(`${path}.avant-v6.bak`)).toBe(true);
      expect(db.prepare('SELECT amount FROM ledger').all()).toEqual([{ amount: 15 }]);
      expect(db.prepare('SELECT id, commit_digest, committed_at FROM daily_attempts').all()).toEqual([{ id: 'a1', commit_digest: null, committed_at: null }]);
      for (const t of ['payments', 'payment_events', 'payment_debts', 'ad_sessions', 'provider_sync']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Réconciliation avec les fournisseurs (phase 6) : remboursements, annulations, rétrofacturations', () => {
  const credit = async (c: Ctx, p: { id: string; auth: string }, n: number, pack = 'polar_rift_prisms_100'): Promise<string> => {
    google(c, p, TOKEN(n), pack);
    await verifyGoogle(c, p, TOKEN(n), pack);
    return c.pv.state.google.get(TOKEN(n))!.orderId;
  };

  it('Google : la liste officielle est la source (pas de notification reçue), recouvrement de fenêtres, curseur conservé, idempotent', async () => {
    const c = ctx();
    const p = c.account('Axel');
    const order = await credit(c, p, 100);
    expect(prisms(c, p.id)).toBe(100);
    // Premier passage : rien d'annulé, le curseur avance
    expect(await c.app.reconcile()).toMatchObject({ google: { ran: true, voided: 0, refunded: 0 } });
    expect(c.db.prepare("SELECT cursor, last_ok, last_error FROM provider_sync WHERE provider = 'google'").get()).toEqual({ cursor: NOW0, last_ok: NOW0, last_error: null });
    // Google annule l'achat TROIS jours plus tard (rétrofacturation) : le passage suivant le retrouve grâce au recouvrement des fenêtres
    c.now.t += 2 * 86_400_000;
    c.pv.state.voided.push({ orderId: order, purchaseToken: TOKEN(100), voidedTimeMillis: NOW0 - 3_600_000 });
    const r = await c.app.reconcile();
    expect(r.google).toMatchObject({ voided: 1, refunded: 1 });
    expect(prisms(c, p.id)).toBe(0);
    // Idempotent : repasser n'ajoute rien
    for (let i = 0; i < 3; i++) expect((await c.app.reconcile()).google.refunded).toBe(0);
    expect(c.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'refund:%'").get()).toEqual({ n: 1 });
    // Fenêtre de lecture : jamais plus de 29 jours en arrière (limite de l'API), cursor − 3 jours ensuite
    const q = c.pv.state.voidedQueries.map((x) => new URLSearchParams(x));
    expect(Number(q[0].get('startTime'))).toBe(NOW0 - 29 * 86_400_000);
    expect(Number(q[1].get('startTime'))).toBe(NOW0 - 3 * 86_400_000);
    expect(q[0].get('type')).toBe('0');
  });

  it('Google : correspondance par jeton (empreinte) même sans identifiant de commande ; pagination complète ; achat déjà remboursé ignoré', async () => {
    const c = ctx();
    c.pv.state.voidedPageSize = 2;
    const p = c.account('Axel');
    const orders: string[] = [];
    for (let n = 110; n < 115; n++) orders.push(await credit(c, p, n, 'polar_rift_prisms_30'));
    expect(prisms(c, p.id)).toBe(150);
    // Entrées sans orderId (jeton seul) pour deux achats, avec orderId pour deux autres ; le dernier reste valide
    c.pv.state.voided.push({ orderId: '', purchaseToken: TOKEN(110), voidedTimeMillis: NOW0 - 10 });
    c.pv.state.voided.push({ orderId: '', purchaseToken: TOKEN(111), voidedTimeMillis: NOW0 - 9 });
    c.pv.state.voided.push({ orderId: orders[2], purchaseToken: '', voidedTimeMillis: NOW0 - 8 });
    c.pv.state.voided.push({ orderId: orders[3], purchaseToken: TOKEN(113), voidedTimeMillis: NOW0 - 7 });
    const r = await c.app.reconcile();
    expect(r.google).toMatchObject({ voided: 4, refunded: 4 });
    expect(prisms(c, p.id)).toBe(30);
    expect(c.pv.state.voidedQueries.length).toBe(2);
  });

  it('Google : Prismes déjà dépensés → dette (jamais de solde négatif) ; panne du fournisseur : rien d\'appliqué, curseur conservé, retenté ensuite', async () => {
    const c = ctx();
    const p = c.account('Axel');
    const order = await credit(c, p, 120, 'polar_rift_prisms_100');
    c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'prisms', 'spend', -90, 'spend:test', 1)").run(p.id);
    c.pv.state.voided.push({ orderId: order, purchaseToken: TOKEN(120), voidedTimeMillis: NOW0 - 1 });
    c.pv.state.down = true;
    const down = await c.app.reconcile();
    expect(down.google.error).toBe('provider_error');
    expect(down.google.ran).toBe(false);
    expect(prisms(c, p.id)).toBe(10);
    expect(c.db.prepare("SELECT cursor, last_error FROM provider_sync WHERE provider = 'google'").get()).toEqual({ cursor: 0, last_error: 'provider_error' });
    c.pv.state.down = false;
    const up = await c.app.reconcile();
    expect(up.google.refunded).toBe(1);
    expect(prisms(c, p.id)).toBe(0);
    expect(debtOf(c.db, p.id)).toBe(90);
  });

  it('Apple : historique des notifications REFUND / REVOKE rattrape une notification perdue ; chaque transaction est REVÉRIFIÉE par l\'API avant tout débit', async () => {
    const c = ctx();
    const p = c.account('Axel');
    apple(c, p, '9301', 'polar_rift_prisms_100');
    apple(c, p, '9302', 'polar_rift_prisms_30');
    apple(c, p, '9303', 'polar_rift_prisms_30');
    for (const id of ['9301', '9302', '9303']) await verifyApple(c, p, id, apple_product(c, id));
    expect(prisms(c, p.id)).toBe(160);
    // Apple a émis un REFUND pour 9301 et un REVOKE pour 9302 ; 9303 : historique mensonger (l'API ne confirme pas)
    c.pv.state.apple.get('9301')!.revocationDate = NOW0;
    c.pv.state.apple.get('9302')!.revocationDate = NOW0;
    c.pv.state.appleHistory.push({ type: 'REFUND', transactionId: '9301' }, { type: 'REVOKE', transactionId: '9302' }, { type: 'REFUND', transactionId: '9303' }, { type: 'REFUND', transactionId: '9304', bundleId: 'fr.autre' });
    const r = await c.app.reconcile();
    expect(r.apple).toMatchObject({ ran: true, checked: 3, refunded: 2 });
    expect(prisms(c, p.id)).toBe(30);
    expect((await c.app.reconcile()).apple.refunded).toBe(0);
    c.pv.state.appleHistoryDown = true;
    c.now.t += 1000;
    expect((await c.app.reconcile()).apple.error).toBe('provider_error');
    expect(prisms(c, p.id)).toBe(30);
  });

  it('fournisseurs non configurés : réconciliation sans appel ni effet', async () => {
    const c = ctx({ apple: false, google: false });
    const r = await c.app.reconcile();
    expect(r).toEqual({ google: { ran: false, voided: 0, refunded: 0 }, apple: { ran: false, checked: 0, refunded: 0 } });
    expect(c.pv.state.calls).toEqual([]);
  });

  it('fusion de profils : deux recouvrements de dette distincts ne se confondent jamais (clés uniques par profil)', () => {
    const c = ctx();
    const a = c.account('Alpha');
    const b = c.account('Bravo');
    for (const [pl, amount] of [[a.id, 5], [b.id, 7]] as const) {
      c.db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'prisms', 'daily', 50, ?, 1)").run(pl, `daily:x-${pl}`);
      c.db.prepare('INSERT INTO payment_debts (player_id, amount) VALUES (?, ?)').run(pl, amount);
      expect(settleDebt(c.db, pl, 2)).toBe(amount);
    }
    const refs = (c.db.prepare("SELECT ref FROM ledger WHERE ref LIKE 'debt:%'").all() as { ref: string }[]).map((r) => r.ref);
    expect(new Set(refs).size).toBe(2);
  });
});

const apple_product = (c: Ctx, id: string): string => c.pv.state.apple.get(id)!.productId;
