import { createPublicKey, createVerify, randomBytes } from 'node:crypto';
import { AD_REVIVE_LIFE, PURCHASE_LIMITS } from '../src/config/monetization';
import type { HttpRequest, HttpResponse, PlayerRow } from './app';
import { transaction, type Db } from './db';
import { accountBinding, type AdsConfig } from './payments';

/**
 * Publicités récompensées pour la DEUXIÈME CHANCE (phase 5), confirmées de serveur à serveur (SSV AdMob) :
 * 1. `POST /api/ads/session` : le service crée une session (liée au profil, à la partie et à la vie), usage unique ;
 * 2. l'application affiche la publicité avec `userId` et `customData` (identifiants de la session) ;
 * 3. AdMob appelle `GET /api/ads/ssv` (signature ECDSA vérifiée avec les clés publiques de Google, unité publicitaire autorisée, transaction jamais rejouée) :
 *    la session passe à « récompensée » ;
 * 4. `POST /api/ads/claim` : la session récompensée est CONSOMMÉE (une seule fois) → l'application peut reprendre.
 * Aucune minuterie ni simulation ne remplace la confirmation : sans appel signé de Google, aucune reprise. Aucun Prisme n'est débité.
 */
export interface AdsDeps {
  db: Db;
  now: () => number;
  secret: string;
  allow: (key: string, max: number, windowMs: number) => boolean;
  authenticate: (req: HttpRequest) => PlayerRow | null;
  cfg: AdsConfig | undefined;
  fetch?: typeof fetch;
}

export interface Ads {
  handle(req: HttpRequest): HttpResponse | null;
  handleAsync(req: HttpRequest): Promise<HttpResponse> | null;
}

export const ADS_ASYNC_ROUTES: ReadonlySet<string> = new Set(['GET /api/ads/ssv']);

const json = (status: number, body: unknown): HttpResponse => ({ status, body });
const err = (status: number, error: string, message: string): HttpResponse => json(status, { error, message });
const HOUR = 3_600_000;
const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

export function createAds(deps: AdsDeps): Ads {
  const { db, now, secret, allow, authenticate, cfg } = deps;
  const f = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const enabled = (cfg?.adUnits.length ?? 0) > 0;
  let cached: { keys: Record<string, string>; at: number } | null = null;

  const keys = async (): Promise<Record<string, string>> => {
    if (cfg?.keys) return cfg.keys();
    if (cached && now() - cached.at < 24 * HOUR) return cached.keys;
    const res = await f(KEYS_URL);
    if (!res.ok) throw new Error('clés AdMob indisponibles');
    const j = (await res.json()) as { keys?: { keyId: number | string; pem: string }[] };
    const out: Record<string, string> = {};
    for (const k of j.keys ?? []) out[String(k.keyId)] = k.pem;
    cached = { keys: out, at: now() };
    return out;
  };

  const q = {
    byRun: db.prepare('SELECT id, state FROM ad_sessions WHERE player_id = ? AND run_id = ? AND life = ?'),
    insert: db.prepare("INSERT INTO ad_sessions (id, player_id, run_id, life, state, created_at) VALUES (?, ?, ?, ?, 'created', ?)"),
    byId: db.prepare('SELECT id, player_id, state, created_at FROM ad_sessions WHERE id = ?'),
    reward: db.prepare("UPDATE ad_sessions SET state = 'rewarded', rewarded_at = ?, ssv_tx = ? WHERE id = ? AND state = 'created'"),
    consume: db.prepare("UPDATE ad_sessions SET state = 'consumed', consumed_at = ? WHERE id = ? AND state = 'rewarded' AND player_id = ?"),
    ssvSeen: db.prepare('SELECT id FROM ad_sessions WHERE ssv_tx = ?'),
    event: db.prepare('INSERT INTO payment_events (at, provider, provider_ref, player_id, kind, detail) VALUES (?, ?, ?, ?, ?, ?)'),
  };
  const log = (playerId: string | null, kind: string, detail?: Record<string, unknown>): void => void q.event.run(now(), 'ads', null, playerId, kind, detail ? JSON.stringify(detail) : null);

  /** Identifiant d'utilisateur transmis à AdMob : liaison HMAC du profil (jamais l'identifiant du profil en clair). */
  const userIdOf = (playerId: string): string => accountBinding(secret, 'google', `ads|${playerId}`);

  function session(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!enabled) return err(503, 'ads_unavailable', 'Publicité récompensée indisponible : fournisseur non configuré.');
    if (!allow(`ads-session:${me.id}`, 30, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    if (me.moderation === 2) return err(403, 'forbidden', 'Indisponible pour ce profil.');
    const b = req.body as { runId?: unknown; life?: unknown } | undefined;
    if (typeof b?.runId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.runId) || b.life !== AD_REVIVE_LIFE) return err(400, 'bad_request', 'Requête invalide.');
    const runId = b.runId;
    return transaction(db, () => {
      const cur = q.byRun.get(me.id, runId, AD_REVIVE_LIFE) as unknown as { id: string; state: string } | undefined;
      if (cur?.state === 'consumed') return err(409, 'already_used', 'La reprise par publicité de cette partie a déjà été utilisée.');
      const id = cur?.id ?? randomBytes(16).toString('hex');
      if (!cur) q.insert.run(id, me.id, runId, AD_REVIVE_LIFE, now());
      return json(200, { sessionId: id, userId: userIdOf(me.id), customData: id });
    });
  }

  /** Callback SSV d'AdMob : signature ECDSA (SHA-256) sur la chaîne de requête précédant `&signature=`. */
  async function ssv(req: HttpRequest): Promise<HttpResponse> {
    if (!enabled) return err(503, 'ads_unavailable', 'Publicité non configurée.');
    if (!allow('ads-ssv', 600, 60_000)) return err(429, 'rate_limited', 'Trop de requêtes.');
    const qs = req.rawQuery ?? [...req.query.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const idx = qs.indexOf('&signature=');
    const signature = req.query.get('signature');
    const keyId = req.query.get('key_id');
    if (idx < 0 || !signature || !keyId) return err(400, 'bad_request', 'Requête invalide.');
    const message = qs.slice(0, idx);
    let pem: string | undefined;
    try {
      pem = (await keys())[keyId];
    } catch {
      return err(503, 'keys_unavailable', 'Clés de vérification indisponibles.');
    }
    if (!pem) return err(401, 'unknown_key', 'Clé inconnue.');
    let valid = false;
    try {
      valid = createVerify('SHA256').update(message).verify(createPublicKey(pem), Buffer.from(signature, 'base64url'));
    } catch {
      valid = false;
    }
    if (!valid) {
      log(null, 'ssv_bad_signature');
      return err(401, 'bad_signature', 'Signature invalide.');
    }
    const adUnit = req.query.get('ad_unit') ?? '';
    const tx = req.query.get('transaction_id') ?? '';
    const custom = req.query.get('custom_data') ?? '';
    const userId = req.query.get('user_id') ?? '';
    if (!cfg!.adUnits.includes(adUnit) || !tx || !/^[0-9a-f]{32}$/.test(custom)) {
      log(null, 'ssv_refused', { reason: 'unit_or_fields' });
      return err(400, 'bad_request', 'Unité publicitaire ou champs invalides.');
    }
    return transaction(db, () => {
      if (q.ssvSeen.get(tx)) return json(200, { ok: true, repeated: true }); // même confirmation rejouée : sans effet
      const s = q.byId.get(custom) as unknown as { id: string; player_id: string; state: string; created_at: number } | undefined;
      if (!s || userId !== userIdOf(s.player_id)) {
        log(s?.player_id ?? null, 'ssv_refused', { reason: 'session_or_user' });
        return err(400, 'bad_request', 'Session inconnue.');
      }
      if (now() - s.created_at > PURCHASE_LIMITS.adSessionMs) {
        log(s.player_id, 'ssv_refused', { reason: 'expired' });
        return err(410, 'expired', 'Session expirée.');
      }
      if (s.state !== 'created') return json(200, { ok: true, repeated: true });
      q.reward.run(now(), tx, s.id);
      log(s.player_id, 'ad_rewarded');
      return json(200, { ok: true });
    });
  }

  /** Le joueur réclame sa reprise : la confirmation serveur est CONSOMMÉE (usage unique). Pas encore confirmée : 202, il réessaie un court instant. */
  function claim(req: HttpRequest, me: PlayerRow): HttpResponse {
    if (!allow(`ads-claim:${me.id}`, 120, HOUR)) return err(429, 'rate_limited', 'Trop de requêtes : réessayez plus tard.');
    const id = (req.body as { sessionId?: unknown } | undefined)?.sessionId;
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return err(400, 'bad_request', 'Requête invalide.');
    return transaction(db, () => {
      const s = q.byId.get(id) as unknown as { id: string; player_id: string; state: string; created_at: number } | undefined;
      if (!s || s.player_id !== me.id) return err(400, 'bad_request', 'Session inconnue.');
      if (s.state === 'consumed') return err(409, 'already_used', 'Cette confirmation a déjà servi.');
      if (s.state === 'created') return now() - s.created_at > PURCHASE_LIMITS.adSessionMs ? err(410, 'expired', 'Session expirée.') : json(202, { status: 'pending' });
      if (Number(q.consume.run(now(), id, me.id).changes) !== 1) return err(409, 'already_used', 'Cette confirmation a déjà servi.');
      log(me.id, 'ad_consumed');
      return json(200, { status: 'granted' });
    });
  }

  return {
    handle(req) {
      const route = `${req.method} ${req.path}`;
      const withAuth = (fn: (me: PlayerRow) => HttpResponse): HttpResponse => {
        const me = authenticate(req);
        return me ? fn(me) : err(401, 'unauthorized', 'Authentification requise.');
      };
      switch (route) {
        case 'POST /api/ads/session': return withAuth((me) => session(req, me));
        case 'POST /api/ads/claim': return withAuth((me) => claim(req, me));
        default: return null;
      }
    },
    handleAsync(req) {
      return `${req.method} ${req.path}` === 'GET /api/ads/ssv' ? ssv(req) : null;
    },
  };
}
