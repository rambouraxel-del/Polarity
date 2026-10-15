import { createHmac, createSign, createHash, timingSafeEqual } from 'node:crypto';
import { PRISM_PACKS, PURCHASE_LIMITS, packByProductId, type StoreId } from '../src/config/monetization';
import type { HttpRequest, HttpResponse, PlayerRow } from './app';
import { transaction, type Db } from './db';
import { balancesOf } from './profile';

/**
 * Achats réels de Prismes (phase 5).
 *
 * Principes :
 * - Le client n'est JAMAIS une autorité : il transmet seulement l'identifiant d'une transaction (Apple) ou un jeton d'achat (Google). Le SERVICE interroge le
 *   fournisseur avec ses propres identifiants (qui ne quittent jamais le serveur), contrôle produit, application, environnement, état et compte acheteur,
 *   puis crédite les Prismes de la TABLE DES PACKS (config/monetization.ts) — jamais un montant ou un prix annoncé.
 * - Un justificatif = une ligne `payments` (UNIQUE fournisseur + identifiant) et une ligne du registre `iap:<fournisseur>:<identifiant>` (UNIQUE par profil),
 *   écrites dans UNE transaction : crédit atomique, idempotent, jamais de doublon ; un justificatif déjà utilisé par un autre profil est refusé.
 * - Compte connecté obligatoire (au moins une méthode de connexion) ; un invité joue normalement mais n'achète pas.
 * - Remboursements : débit limité au solde (jamais négatif) ; le reste devient une dette recouvrée sur les crédits suivants.
 * - Sans identifiants configurés pour un fournisseur, ses achats sont DÉSACTIVÉS (aucun succès fictif).
 */

// ————————————————————————— configuration

export interface AppleConfig {
  issuerId: string;
  keyId: string;
  /** Clé privée .p8 (PEM) de l'API App Store Server : uniquement côté serveur. */
  privateKey: string;
  bundleId: string;
  /** Accepter les achats en bac à sable (relecture Apple) : désactivé par défaut en production. */
  acceptSandbox?: boolean;
}

export interface GoogleConfig {
  packageName: string;
  /** Compte de service (Google Play Developer API) : uniquement côté serveur. */
  clientEmail: string;
  privateKey: string;
  /** Accepter les achats de test (licence testeur) : désactivé par défaut en production. */
  acceptTestPurchases?: boolean;
}

export interface WebEvent {
  ref: string;
  productId: string;
  /** Profil acheteur transmis au prestataire à la création de la session de paiement. */
  playerId: string;
  state: 'purchased' | 'pending' | 'cancelled' | 'refunded';
  environment: 'production' | 'sandbox';
}

/**
 * Prestataire de paiement WEB : aucune décision commerciale n'est prise ici (le choix du prestataire est au propriétaire). Un module concret
 * implémente cette interface (création d'une session de paiement hébergée, vérification de la SIGNATURE de ses notifications avec son secret).
 */
export interface WebProvider {
  name: string;
  checkout(input: { playerId: string; productId: string; reference: string }): Promise<{ url: string }>;
  parseNotification(rawBody: string, headers: Record<string, string | undefined>): Promise<WebEvent | null>;
}

export interface PaymentsConfig {
  apple?: AppleConfig;
  google?: GoogleConfig;
  web?: WebProvider;
  /** Jeton secret de l'adresse de notification Google Play (Pub/Sub push) : `…/notify/google?token=…`. */
  playNotifyToken?: string;
  fetch?: typeof fetch;
  ads?: AdsConfig;
}

export interface AdsConfig {
  /** Identifiants d'unités publicitaires AdMob autorisés (vide = publicité désactivée). */
  adUnits: string[];
  /** Clés publiques de vérification AdMob (identifiant → PEM) ; par défaut téléchargées et mises en cache. */
  keys?: () => Promise<Record<string, string>>;
}

// ————————————————————————— vérificateurs (fournisseurs)

export type TxState = 'purchased' | 'pending' | 'cancelled' | 'refunded';
export interface VerifiedTx {
  provider: StoreId;
  /** Identifiant unique du justificatif CHEZ le fournisseur (transactionId Apple, orderId Google, référence web). */
  ref: string;
  productId: string;
  state: TxState;
  environment: 'production' | 'sandbox';
  /** Compte acheteur transmis à l'achat (appAccountToken, obfuscatedExternalAccountId, référence web). */
  binding: string | null;
  quantity: number;
}

export class VerifyError extends Error {
  constructor(readonly code: 'not_found' | 'provider_error' | 'bad_config' | 'bad_input', message: string) {
    super(message);
  }
}

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const fromB64u = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

/** Charge utile d'un JWS (SANS en vérifier la signature : l'authenticité vient de l'appel authentifié à l'API du fournisseur). */
export function jwsPayload(jws: unknown): Record<string, unknown> | null {
  if (typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const v = JSON.parse(fromB64u(parts[1])) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const APPLE_PROD = 'https://api.storekit.itunes.apple.com';
const APPLE_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';

export function appleJwt(cfg: AppleConfig, nowS: number): string {
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: cfg.keyId, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: cfg.issuerId, iat: nowS, exp: nowS + 300, aud: 'appstoreconnect-v1', bid: cfg.bundleId }));
  const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key: cfg.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

class AppleVerifier {
  constructor(private readonly cfg: AppleConfig, private readonly f: typeof fetch, private readonly now: () => number) {}

  async fetchTx(transactionId: string): Promise<VerifiedTx> {
    if (!/^[0-9]{1,24}$/.test(transactionId)) throw new VerifyError('bad_input', 'Identifiant de transaction invalide.');
    const jwt = appleJwt(this.cfg, Math.floor(this.now() / 1000));
    const tryBase = async (base: string): Promise<Response> => this.f(`${base}/inApps/v1/transactions/${transactionId}`, { headers: { Authorization: `Bearer ${jwt}` } });
    let res = await tryBase(APPLE_PROD);
    if (res.status === 404 && this.cfg.acceptSandbox) res = await tryBase(APPLE_SANDBOX);
    if (res.status === 404) throw new VerifyError('not_found', 'Transaction inconnue du fournisseur.');
    if (res.status === 401 || res.status === 403) throw new VerifyError('bad_config', 'Accès refusé par le fournisseur (identifiants du service).');
    if (!res.ok) throw new VerifyError('provider_error', `Fournisseur indisponible (${res.status}).`);
    const info = jwsPayload(((await res.json()) as { signedTransactionInfo?: unknown }).signedTransactionInfo);
    if (!info) throw new VerifyError('provider_error', 'Réponse du fournisseur illisible.');
    // L'application doit être la nôtre ; le justificatif d'une autre application n'a aucune valeur
    if (info.bundleId !== this.cfg.bundleId) throw new VerifyError('not_found', 'Transaction d’une autre application.');
    if (String(info.transactionId) !== transactionId) throw new VerifyError('not_found', 'Transaction différente de celle demandée.');
    return {
      provider: 'apple',
      ref: String(info.transactionId),
      productId: String(info.productId ?? ''),
      state: info.revocationDate ? 'refunded' : 'purchased',
      environment: String(info.environment).toLowerCase() === 'sandbox' ? 'sandbox' : 'production',
      binding: typeof info.appAccountToken === 'string' ? info.appAccountToken.toLowerCase() : null,
      quantity: Number.isInteger(info.quantity) ? (info.quantity as number) : 1,
    };
  }
}

class GoogleVerifier {
  private token: { value: string; exp: number } | null = null;
  constructor(private readonly cfg: GoogleConfig, private readonly f: typeof fetch, private readonly now: () => number) {}

  private async accessToken(): Promise<string> {
    const t = this.now();
    if (this.token && this.token.exp > t + 60_000) return this.token.value;
    const iat = Math.floor(t / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ iss: this.cfg.clientEmail, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3000 }));
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(this.cfg.privateKey);
    const res = await this.f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${b64u(sig)}` }).toString(),
    });
    if (!res.ok) throw new VerifyError('bad_config', 'Jeton d’accès Google refusé (compte de service).');
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new VerifyError('bad_config', 'Jeton d’accès Google absent.');
    this.token = { value: j.access_token, exp: t + (j.expires_in ?? 3000) * 1000 };
    return j.access_token;
  }

  private url(productId: string, token: string, suffix = ''): string {
    return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.cfg.packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}${suffix}`;
  }

  async fetchTx(productId: string, purchaseToken: string): Promise<VerifiedTx> {
    if (!packByProductId(productId)) throw new VerifyError('bad_input', 'Produit inconnu.');
    if (!/^[A-Za-z0-9._\-]{10,400}$/.test(purchaseToken)) throw new VerifyError('bad_input', 'Jeton d’achat invalide.');
    const res = await this.f(this.url(productId, purchaseToken), { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
    if (res.status === 404 || res.status === 410 || res.status === 400) throw new VerifyError('not_found', 'Achat inconnu du fournisseur.');
    if (res.status === 401 || res.status === 403) throw new VerifyError('bad_config', 'Accès refusé par le fournisseur (compte de service).');
    if (!res.ok) throw new VerifyError('provider_error', `Fournisseur indisponible (${res.status}).`);
    const j = (await res.json()) as { purchaseState?: number; orderId?: string; purchaseType?: number; obfuscatedExternalAccountId?: string; quantity?: number };
    const state: TxState = j.purchaseState === 0 ? 'purchased' : j.purchaseState === 2 ? 'pending' : 'cancelled';
    // Achat en attente : pas encore d'identifiant de commande ; on prend un identifiant dérivé du jeton (stable, jamais exposé en clair)
    const ref = typeof j.orderId === 'string' && j.orderId ? j.orderId : `tok-${createHash('sha256').update(purchaseToken).digest('hex').slice(0, 40)}`;
    return {
      provider: 'google',
      ref,
      productId,
      state,
      environment: j.purchaseType === 0 ? 'sandbox' : 'production',
      binding: typeof j.obfuscatedExternalAccountId === 'string' ? j.obfuscatedExternalAccountId : null,
      quantity: Number.isInteger(j.quantity) && (j.quantity as number) > 0 ? (j.quantity as number) : 1,
    };
  }

  /** Consomme l'achat (consommable) : sans cela, le même produit ne peut plus être racheté et Google rembourse au bout de 3 jours sans accusé. */
  async consume(productId: string, purchaseToken: string): Promise<boolean> {
    try {
      const res = await this.f(this.url(productId, purchaseToken, ':consume'), { method: 'POST', headers: { Authorization: `Bearer ${await this.accessToken()}` } });
      return res.ok || res.status === 400; // 400 : déjà consommé
    } catch {
      return false;
    }
  }
}

// ————————————————————————— liaison au compte acheteur

/**
 * Jetons de liaison (« ce justificatif appartient à CE profil ») : HMAC du secret du service, jamais devinables ni calculables par le client.
 * Apple : appAccountToken (UUID) ; Google : obfuscatedExternalAccountId ; web : référence de la session de paiement.
 */
export function accountBinding(secret: string, provider: StoreId, playerId: string): string {
  const hex = createHmac('sha256', secret).update(`iap-binding|${provider}|${playerId}`).digest('hex');
  if (provider === 'apple') return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return hex.slice(0, 40);
}

// ————————————————————————— dette de remboursement

/**
 * Recouvre sur le solde de Prismes une dette de remboursement (Prismes remboursés déjà dépensés) : jamais de solde négatif ; la dette est prélevée sur
 * les crédits suivants (achat, calendrier, Top 10, drop…). À appeler après tout crédit de Prismes. Sans effet sans dette.
 */
export function settleDebt(db: Db, playerId: string, at: number): number {
  const row = db.prepare('SELECT amount FROM payment_debts WHERE player_id = ?').get(playerId) as unknown as { amount: number } | undefined;
  if (!row || row.amount <= 0) return 0;
  const take = Math.min(row.amount, balancesOf(db, playerId).prisms);
  if (take <= 0) return 0;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE player_id = ? AND ref LIKE 'debt:%'").get(playerId) as unknown as { n: number }).n;
  db.prepare("INSERT OR IGNORE INTO ledger (player_id, currency, kind, amount, ref, at, meta) VALUES (?, 'prisms', 'debt', ?, ?, ?, NULL)").run(playerId, -take, `debt:${n + 1}`, at);
  db.prepare('UPDATE payment_debts SET amount = amount - ? WHERE player_id = ?').run(take, playerId);
  return take;
}

export const debtOf = (db: Db, playerId: string): number => Number((db.prepare('SELECT amount FROM payment_debts WHERE player_id = ?').get(playerId) as unknown as { amount: number } | undefined)?.amount ?? 0);

// ————————————————————————— service

export interface PaymentsDeps {
  db: Db;
  now: () => number;
  secret: string;
  allow: (key: string, max: number, windowMs: number) => boolean;
  authenticate: (req: HttpRequest) => PlayerRow | null;
  cfg: PaymentsConfig;
}

export interface Payments {
  handle(req: HttpRequest): HttpResponse | null;
  handleAsync(req: HttpRequest): Promise<HttpResponse> | null;
  /** Fournisseurs activés (identifiants présents). */
  providers(): Record<StoreId, boolean>;
}

export const PAYMENT_ASYNC_ROUTES: ReadonlySet<string> = new Set([
  'POST /api/payments/verify',
  'POST /api/payments/restore',
  'POST /api/payments/web/checkout',
  'POST /api/payments/notify/apple',
  'POST /api/payments/notify/google',
  'POST /api/payments/notify/web',
]);

const json = (status: number, body: unknown): HttpResponse => ({ status, body });
const err = (status: number, error: string, message: string): HttpResponse => json(status, { error, message });
const RATE = 'Trop de requêtes : réessayez plus tard.';
const HOUR = 3_600_000;

export type PurchaseStatus = 'credited' | 'already_credited' | 'pending' | 'cancelled' | 'refunded';
export interface PurchaseResult {
  status: PurchaseStatus;
  provider: StoreId;
  productId: string;
  /** Prismes accordés par CE justificatif (0 si non crédité). */
  prisms: number;
  balance: { shards: number; medals: number; prisms: number };
}

interface PayRow {
  id: number;
  provider: string;
  provider_ref: string;
  player_id: string | null;
  product_id: string;
  prisms: number;
  state: string;
  consumed: number;
  unrecovered: number;
}

export function createPayments(deps: PaymentsDeps): Payments {
  const { db, now, secret, allow, authenticate, cfg } = deps;
  const f = cfg.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const apple = cfg.apple ? new AppleVerifier(cfg.apple, f, now) : null;
  const google = cfg.google ? new GoogleVerifier(cfg.google, f, now) : null;
  const web = cfg.web ?? null;
  const providers = (): Record<StoreId, boolean> => ({ apple: !!apple, google: !!google, web: !!web });

  const q = {
    row: db.prepare('SELECT id, provider, provider_ref, player_id, product_id, prisms, state, consumed, unrecovered FROM payments WHERE provider = ? AND provider_ref = ?'),
    insert: db.prepare('INSERT INTO payments (provider, provider_ref, player_id, product_id, prisms, state, environment, consumed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    setState: db.prepare('UPDATE payments SET state = ?, player_id = COALESCE(player_id, ?), prisms = ?, updated_at = ? WHERE id = ?'),
    setConsumed: db.prepare('UPDATE payments SET consumed = 1, updated_at = ? WHERE id = ?'),
    setRefund: db.prepare("UPDATE payments SET state = 'refunded', unrecovered = ?, updated_at = ? WHERE id = ?"),
    ledgerAdd: db.prepare("INSERT OR IGNORE INTO ledger (player_id, currency, kind, amount, ref, at, meta) VALUES (?, 'prisms', ?, ?, ?, ?, ?)"),
    event: db.prepare('INSERT INTO payment_events (at, provider, provider_ref, player_id, kind, detail) VALUES (?, ?, ?, ?, ?, ?)'),
    identities: db.prepare('SELECT COUNT(*) AS n FROM identities WHERE player_id = ?'),
    history: db.prepare('SELECT provider, product_id, prisms, state, created_at, updated_at FROM payments WHERE player_id = ? ORDER BY id DESC LIMIT 50'),
    owner: db.prepare('SELECT player_id FROM payments WHERE provider = ? AND provider_ref = ?'),
  };

  /** Journal d'audit : jamais de justificatif brut, de jeton ni de clé ; seulement l'identifiant public de la transaction et des états. */
  const event = (provider: string, ref: string | null, playerId: string | null, kind: string, detail?: Record<string, unknown>): void => {
    q.event.run(now(), provider, ref, playerId, kind, detail ? JSON.stringify(detail) : null);
  };

  const isAccount = (playerId: string): boolean => Number((q.identities.get(playerId) as unknown as { n: number }).n) > 0;

  type Applied = { ok: true; result: PurchaseResult; needsFinalize: boolean } | { ok: false; status: number; error: string; message: string };

  const refuse = (status: number, error: string, message: string, tx: VerifiedTx | null, playerId: string | null): Applied => {
    event(tx?.provider ?? 'unknown', tx?.ref ?? null, playerId, `refused:${error}`, tx ? { product: tx.productId, state: tx.state, env: tx.environment } : undefined);
    return { ok: false, status, error, message };
  };

  /** Applique un justificatif VÉRIFIÉ : une transaction SQLite = ligne `payments` + ligne du registre. `playerId` : le demandeur (null pour une notification). */
  function applyTx(tx: VerifiedTx, playerId: string | null): Applied {
    const pack = packByProductId(tx.productId);
    if (!pack) return refuse(422, 'unknown_product', 'Produit inconnu.', tx, playerId);
    const sandboxOk = tx.provider === 'apple' ? cfg.apple?.acceptSandbox === true : tx.provider === 'google' ? cfg.google?.acceptTestPurchases === true : false;
    if (tx.environment === 'sandbox' && !sandboxOk) return refuse(422, 'sandbox_refused', 'Achat de test non accepté par ce service.', tx, playerId);
    if (tx.quantity !== 1) return refuse(422, 'bad_quantity', 'Quantité inattendue.', tx, playerId);
    return transaction(db, (): Applied => {
      const row = q.row.get(tx.provider, tx.ref) as unknown as PayRow | undefined;
      const owner = row?.player_id ?? playerId;
      if (row && (row.player_id === null || (playerId && row.player_id !== playerId))) return refuse(409, 'receipt_used', 'Ce justificatif a déjà été utilisé par un autre profil.', tx, playerId);
      // Compte acheteur : le justificatif doit porter le jeton de liaison de CE profil (anti-achat sur le mauvais compte, anti-rejeu d'un reçu étranger)
      if (owner && tx.binding !== accountBinding(secret, tx.provider, owner) && tx.state !== 'refunded') return refuse(409, 'account_mismatch', 'Cet achat n’est pas associé à votre compte.', tx, playerId);
      const bal = (id: string | null): PurchaseResult['balance'] => (id ? balancesOf(db, id) : { shards: 0, medals: 0, prisms: 0 });
      const out = (status: PurchaseStatus, prisms: number, needsFinalize = false): Applied => ({ ok: true, needsFinalize, result: { status, provider: tx.provider, productId: tx.productId, prisms, balance: bal(owner) } });
      const t = now();

      if (tx.state === 'refunded' || (tx.state === 'cancelled' && row?.state === 'credited')) {
        refund(tx, row);
        return out('refunded', 0);
      }
      if (tx.state === 'cancelled') {
        if (row?.state === 'refunded') return out('refunded', 0);
        if (!row) q.insert.run(tx.provider, tx.ref, owner, pack.productId, pack.prisms, 'cancelled', tx.environment, 0, t, t);
        else if (row.state === 'pending') q.setState.run('cancelled', owner, pack.prisms, t, row.id);
        event(tx.provider, tx.ref, owner, 'cancelled', { product: pack.productId });
        return out('cancelled', 0);
      }
      if (tx.state === 'pending') {
        if (!owner) return out('pending', 0);
        if (!row) q.insert.run(tx.provider, tx.ref, owner, pack.productId, pack.prisms, 'pending', tx.environment, 0, t, t);
        event(tx.provider, tx.ref, owner, 'pending', { product: pack.productId });
        return out('pending', 0);
      }
      // purchased
      if (!owner) return refuse(404, 'unclaimed', 'Achat non encore associé à un profil : il sera crédité à la vérification par le joueur.', tx, null);
      if (row?.state === 'refunded') return out('refunded', 0);
      if (row?.state === 'credited') return out('already_credited', 0, row.consumed === 0);
      if (!row) q.insert.run(tx.provider, tx.ref, owner, pack.productId, pack.prisms, 'credited', tx.environment, 0, t, t);
      else q.setState.run('credited', owner, pack.prisms, t, row.id);
      q.ledgerAdd.run(owner, 'purchase', pack.prisms, `iap:${tx.provider}:${tx.ref}`, t, JSON.stringify({ product: pack.productId }));
      settleDebt(db, owner, t);
      event(tx.provider, tx.ref, owner, 'credited', { product: pack.productId, prisms: pack.prisms, env: tx.environment });
      return out('credited', pack.prisms, true);
    });
  }

  /** Remboursement / révocation : débit plafonné au solde ; le reste devient une dette (jamais de solde négatif). Idempotent. */
  function refund(tx: VerifiedTx, row: PayRow | undefined): void {
    const t = now();
    if (!row) {
      // Remboursement reçu avant tout justificatif : on le consigne ; le justificatif ne pourra plus créditer
      q.insert.run(tx.provider, tx.ref, null, tx.productId, 0, 'refunded', tx.environment, 1, t, t);
      event(tx.provider, tx.ref, null, 'refunded_before_credit');
      return;
    }
    if (row.state === 'refunded') return;
    let unrecovered = 0;
    if (row.state === 'credited' && row.player_id) {
      const take = Math.min(balancesOf(db, row.player_id).prisms, row.prisms);
      if (take > 0) q.ledgerAdd.run(row.player_id, 'refund', -take, `refund:${row.provider}:${row.provider_ref}`, t, null);
      unrecovered = row.prisms - take;
      if (unrecovered > 0) db.prepare('INSERT INTO payment_debts (player_id, amount) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET amount = amount + excluded.amount').run(row.player_id, unrecovered);
    }
    q.setRefund.run(unrecovered, t, row.id);
    event(row.provider, row.provider_ref, row.player_id, 'refunded', { product: row.product_id, unrecovered });
  }

  async function finalize(tx: VerifiedTx, input: { purchaseToken?: string }): Promise<void> {
    const row = q.row.get(tx.provider, tx.ref) as unknown as PayRow | undefined;
    if (!row || row.state !== 'credited' || row.consumed === 1) return;
    let done = false;
    if (tx.provider === 'google' && google && input.purchaseToken) done = await google.consume(tx.productId, input.purchaseToken);
    // Apple : la transaction est terminée par l'application (finishTransaction) ; rien à faire côté service
    if (tx.provider === 'apple') done = true;
    if (done) q.setConsumed.run(now(), row.id);
  }

  type VerifyInput = { provider?: unknown; productId?: unknown; transactionId?: unknown; purchaseToken?: unknown };

  async function fetchVerified(input: VerifyInput): Promise<VerifiedTx> {
    if (input.provider === 'apple') {
      if (!apple) throw new VerifyError('bad_config', 'Achats Apple non configurés.');
      return apple.fetchTx(String(input.transactionId ?? ''));
    }
    if (input.provider === 'google') {
      if (!google) throw new VerifyError('bad_config', 'Achats Google Play non configurés.');
      return google.fetchTx(String(input.productId ?? ''), String(input.purchaseToken ?? ''));
    }
    throw new VerifyError('bad_input', 'Fournisseur invalide.');
  }

  const mapVerifyError = (e: unknown): HttpResponse => {
    if (e instanceof VerifyError) {
      if (e.code === 'bad_config') return err(503, 'provider_unavailable', 'Achats indisponibles : fournisseur non configuré.');
      if (e.code === 'provider_error') return err(502, 'provider_error', 'Le fournisseur de paiement ne répond pas : réessayez, aucun Prisme n’a été débité ni crédité.');
      if (e.code === 'bad_input') return err(400, 'bad_request', e.message);
      return err(422, 'unverified', 'Achat non confirmé par le fournisseur : aucun Prisme n’a été crédité.');
    }
    // Coupure réseau, délai dépassé, réponse inattendue : jamais un crédit, toujours « réessayez »
    return err(502, 'provider_error', 'Le fournisseur de paiement ne répond pas : réessayez, aucun Prisme n’a été débité ni crédité.');
  };

  /** Vérifie UN justificatif auprès du fournisseur puis l'applique pour `me`. */
  async function verifyOne(me: PlayerRow, input: VerifyInput): Promise<HttpResponse> {
    let tx: VerifiedTx;
    try {
      tx = await fetchVerified(input);
    } catch (e) {
      return mapVerifyError(e);
    }
    const applied = applyTx(tx, me.id);
    if (!applied.ok) return err(applied.status, applied.error, applied.message);
    if (applied.needsFinalize) await finalize(tx, { purchaseToken: typeof input.purchaseToken === 'string' ? input.purchaseToken : undefined });
    return json(200, applied.result);
  }

  function gate(me: PlayerRow, key: string, max: number): HttpResponse | null {
    if (!allow(`${key}:${me.id}`, max, HOUR)) return err(429, 'rate_limited', RATE);
    if (me.moderation === 2) return err(403, 'forbidden', 'Achats indisponibles pour ce profil.');
    if (!isAccount(me.id)) return err(403, 'account_required', 'Un compte connecté est nécessaire pour acheter des Prismes (menu Options → Compte). Vous pouvez continuer à jouer normalement.');
    return null;
  }

  async function verify(req: HttpRequest, me: PlayerRow): Promise<HttpResponse> {
    const denied = gate(me, 'pay-verify', 60);
    if (denied) return denied;
    if (!allow('pay-verify:global', 120, 60_000)) return err(429, 'rate_limited', RATE);
    return verifyOne(me, (req.body ?? {}) as VerifyInput);
  }

  /** Restauration : le client renvoie ses transactions non terminées / retrouvées ; chacune est revérifiée (idempotent : rien n'est crédité deux fois). */
  async function restore(req: HttpRequest, me: PlayerRow): Promise<HttpResponse> {
    const denied = gate(me, 'pay-restore', 20);
    if (denied) return denied;
    const items = (req.body as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > PURCHASE_LIMITS.restoreBatch) return err(400, 'bad_request', 'Requête invalide.');
    const results: unknown[] = [];
    for (const it of items) {
      if (!allow('pay-verify:global', 120, 60_000)) {
        results.push({ error: 'rate_limited' });
        continue;
      }
      const r = await verifyOne(me, (it ?? {}) as VerifyInput);
      results.push(r.status === 200 ? r.body : { error: (r.body as { error: string }).error, message: (r.body as { message: string }).message });
    }
    return json(200, { results, balance: balancesOf(db, me.id) });
  }

  function prepare(me: PlayerRow): HttpResponse {
    const denied = gate(me, 'pay-prepare', 120);
    if (denied) return denied;
    return json(200, {
      apple: { appAccountToken: accountBinding(secret, 'apple', me.id) },
      google: { obfuscatedAccountId: accountBinding(secret, 'google', me.id) },
      web: { reference: accountBinding(secret, 'web', me.id) },
    });
  }

  function history(me: PlayerRow): HttpResponse {
    if (!allow(`pay-history:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', RATE);
    const rows = q.history.all(me.id) as unknown as { provider: string; product_id: string; prisms: number; state: string; created_at: number; updated_at: number }[];
    const d = debtOf(db, me.id);
    return json(200, { purchases: rows.map((r) => ({ provider: r.provider, productId: r.product_id, prisms: r.prisms, state: r.state, at: r.updated_at })), debt: d, balance: balancesOf(db, me.id) });
  }

  async function webCheckout(req: HttpRequest, me: PlayerRow): Promise<HttpResponse> {
    const denied = gate(me, 'pay-web', 30);
    if (denied) return denied;
    if (!web) return err(503, 'provider_unavailable', 'Achats web indisponibles : aucun prestataire de paiement n’est configuré.');
    const productId = (req.body as { productId?: unknown } | undefined)?.productId;
    if (!packByProductId(productId)) return err(400, 'bad_request', 'Produit inconnu.');
    try {
      const s = await web.checkout({ playerId: me.id, productId: productId as string, reference: accountBinding(secret, 'web', me.id) });
      return json(200, { url: s.url });
    } catch {
      return err(502, 'provider_error', 'Le prestataire de paiement ne répond pas : réessayez.');
    }
  }

  // ————————————————————————— notifications des fournisseurs

  /** Notification Apple (App Store Server Notifications V2) : la charge utile n'est PAS crue ; on s'en sert pour savoir QUOI revérifier auprès de l'API. */
  async function notifyApple(req: HttpRequest): Promise<HttpResponse> {
    if (!allow('notify:apple', 600, 60_000)) return err(429, 'rate_limited', RATE);
    if (!apple) return json(200, { ignored: 'unconfigured' });
    const outer = jwsPayload((req.body as { signedPayload?: unknown } | undefined)?.signedPayload);
    const data = outer && typeof outer.data === 'object' && outer.data ? (outer.data as Record<string, unknown>) : null;
    const inner = jwsPayload(data?.signedTransactionInfo);
    const id = inner?.transactionId;
    if (!inner || (typeof id !== 'string' && typeof id !== 'number') || inner.bundleId !== cfg.apple!.bundleId) return json(200, { ignored: 'unrelated' });
    const type = String(outer?.notificationType ?? '');
    if (type !== 'REFUND' && type !== 'REVOKE') return json(200, { ignored: type });
    try {
      const tx = await apple.fetchTx(String(id));
      if (tx.state !== 'refunded') {
        event('apple', tx.ref, null, 'refund_unconfirmed', { type });
        return json(200, { ignored: 'not_revoked' });
      }
      applyTx(tx, null);
      return json(200, { ok: true });
    } catch (e) {
      // Erreur transitoire : réponse d'échec pour que le fournisseur réessaie ; justificatif inconnu : rien à faire
      if (e instanceof VerifyError && e.code === 'not_found') return json(200, { ignored: 'not_found' });
      return err(500, 'retry', 'Traitement différé.');
    }
  }

  /** Notification Google Play (Pub/Sub push, adresse secrète) : remboursements (voided) et achats en attente devenus valides. */
  async function notifyGoogle(req: HttpRequest): Promise<HttpResponse> {
    if (!allow('notify:google', 600, 60_000)) return err(429, 'rate_limited', RATE);
    if (!google || !cfg.playNotifyToken) return json(200, { ignored: 'unconfigured' });
    const given = Buffer.from(req.query.get('token') ?? '');
    const want = Buffer.from(cfg.playNotifyToken);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return err(401, 'unauthorized', 'Jeton de notification invalide.');
    let msg: Record<string, unknown> | null = null;
    try {
      const data = (req.body as { message?: { data?: unknown } } | undefined)?.message?.data;
      msg = typeof data === 'string' ? (JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as Record<string, unknown>) : null;
    } catch {
      msg = null;
    }
    if (!msg || msg.packageName !== cfg.google!.packageName) return json(200, { ignored: 'unrelated' });
    try {
      const voided = msg.voidedPurchaseNotification as { purchaseToken?: string; orderId?: string } | undefined;
      if (voided?.purchaseToken && voided.orderId) {
        const row = q.row.get('google', voided.orderId) as unknown as PayRow | undefined;
        if (!row) {
          refund({ provider: 'google', ref: voided.orderId, productId: 'unknown', state: 'refunded', environment: 'production', binding: null, quantity: 1 }, undefined);
          return json(200, { ok: true });
        }
        const tx = await google.fetchTx(row.product_id, voided.purchaseToken);
        if (tx.state === 'purchased') {
          event('google', row.provider_ref, row.player_id, 'refund_unconfirmed');
          return json(200, { ignored: 'still_purchased' });
        }
        applyTx({ ...tx, state: 'refunded' }, null);
        return json(200, { ok: true });
      }
      const one = msg.oneTimeProductNotification as { purchaseToken?: string; sku?: string; notificationType?: number } | undefined;
      if (one?.purchaseToken && one.sku) {
        const tx = await google.fetchTx(one.sku, one.purchaseToken);
        const row = q.row.get('google', tx.ref) as unknown as PayRow | undefined;
        // Un achat en attente devenu valide (ou annulé) : promu pour son propriétaire connu ; sinon il attend la vérification du joueur
        if (row?.player_id) applyTx(tx, row.player_id);
        return json(200, { ok: true });
      }
      return json(200, { ignored: 'type' });
    } catch (e) {
      if (e instanceof VerifyError && e.code === 'not_found') return json(200, { ignored: 'not_found' });
      return err(500, 'retry', 'Traitement différé.');
    }
  }

  async function notifyWeb(req: HttpRequest, raw: string): Promise<HttpResponse> {
    if (!allow('notify:web', 600, 60_000)) return err(429, 'rate_limited', RATE);
    if (!web) return json(200, { ignored: 'unconfigured' });
    let ev: WebEvent | null;
    try {
      ev = await web.parseNotification(raw, req.headers);
    } catch {
      return err(400, 'bad_signature', 'Notification non authentifiée.');
    }
    if (!ev) return json(200, { ignored: 'unrelated' });
    // Le prestataire a authentifié l'événement (signature) ; la liaison au profil est celle fixée par le service à la création de la session
    const applied = applyTx({ provider: 'web', ref: ev.ref, productId: ev.productId, state: ev.state, environment: ev.environment, binding: accountBinding(secret, 'web', ev.playerId), quantity: 1 }, ev.state === 'refunded' ? null : ev.playerId);
    return applied.ok ? json(200, { ok: true }) : err(applied.status, applied.error, applied.message);
  }

  const bodyText = (req: HttpRequest): string => req.raw ?? JSON.stringify(req.body ?? {});

  return {
    providers,
    handle(req) {
      const route = `${req.method} ${req.path}`;
      const withAuth = (fn: (me: PlayerRow) => HttpResponse): HttpResponse => {
        const me = authenticate(req);
        return me ? fn(me) : err(401, 'unauthorized', 'Authentification requise.');
      };
      switch (route) {
        case 'GET /api/payments/config':
          return json(200, { packs: PRISM_PACKS.map((p) => ({ id: p.id, name: p.name, prisms: p.prisms, priceCents: p.priceCents, productId: p.productId })), providers: providers(), ads: { enabled: (cfg.ads?.adUnits.length ?? 0) > 0 } });
        case 'GET /api/payments/prepare': return withAuth(prepare);
        case 'GET /api/payments/history': return withAuth(history);
        default: return null;
      }
    },
    handleAsync(req) {
      const route = `${req.method} ${req.path}`;
      const withAuth = (fn: (me: PlayerRow) => Promise<HttpResponse>): Promise<HttpResponse> => {
        const me = authenticate(req);
        return me ? fn(me) : Promise.resolve(err(401, 'unauthorized', 'Authentification requise.'));
      };
      switch (route) {
        case 'POST /api/payments/verify': return withAuth((me) => verify(req, me));
        case 'POST /api/payments/restore': return withAuth((me) => restore(req, me));
        case 'POST /api/payments/web/checkout': return withAuth((me) => webCheckout(req, me));
        case 'POST /api/payments/notify/apple': return notifyApple(req);
        case 'POST /api/payments/notify/google': return notifyGoogle(req);
        case 'POST /api/payments/notify/web': return notifyWeb(req, bodyText(req));
        default: return null;
      }
    },
  };
}
