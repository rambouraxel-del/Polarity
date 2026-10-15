import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Vérification d'un jeton d'identité OpenID Connect (Google, Apple) — SANS dépendance : signature RS256 vérifiée avec les clés publiques du fournisseur
 * (JWKS), puis émetteur, audience (identifiants clients configurés), expiration et nonce (anti-rejeu, délivré par le service).
 * Désactivé tant que les identifiants clients ne sont pas configurés (voir docs/COMPTES.md).
 */
export interface OidcProvider {
  name: 'google' | 'apple';
  issuers: readonly string[];
  jwksUri: string;
  /** Audiences acceptées : identifiants clients (web, Android, iOS…) configurés par l'exploitant. */
  audiences: readonly string[];
}

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;
export const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
export const APPLE_ISSUERS = ['https://appleid.apple.com'] as const;
export const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';

export interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}
export type JwksFetcher = (uri: string) => Promise<{ keys: Jwk[] }>;

export interface VerifiedToken {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  nonce?: string;
}

export class OidcError extends Error {
  constructor(readonly code: 'malformed' | 'bad_signature' | 'bad_issuer' | 'bad_audience' | 'expired' | 'unknown_key' | 'jwks_unavailable' | 'bad_nonce') {
    super(code);
  }
}

const b64u = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Récupération des clés publiques : délai court, taille bornée. */
export const defaultJwksFetcher: JwksFetcher = async (uri) => {
  const res = await fetch(uri, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new OidcError('jwks_unavailable');
  const text = await res.text();
  if (text.length > 65536) throw new OidcError('jwks_unavailable');
  const body = JSON.parse(text) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new OidcError('jwks_unavailable');
  return { keys: body.keys };
};

/** Cache de clés (1 h) : une clé inconnue déclenche UN rechargement (rotation des clés du fournisseur). */
export class JwksCache {
  private readonly cache = new Map<string, { at: number; keys: Jwk[] }>();
  constructor(private readonly fetcher: JwksFetcher, private readonly now: () => number, private readonly ttlMs = 3_600_000) {}

  async key(uri: string, kid: string): Promise<Jwk | undefined> {
    const hit = this.cache.get(uri);
    const fresh = hit && this.now() - hit.at < this.ttlMs;
    if (fresh) {
      const k = hit.keys.find((x) => x.kid === kid);
      if (k) return k;
    }
    // Clé absente ou cache périmé : un rechargement, au plus un par minute et par fournisseur (évite l'amplification par des jetons falsifiés)
    if (hit && this.now() - hit.at < 60_000) return undefined;
    let jwks: { keys: Jwk[] };
    try {
      jwks = await this.fetcher(uri);
    } catch {
      throw new OidcError('jwks_unavailable');
    }
    this.cache.set(uri, { at: this.now(), keys: jwks.keys });
    return jwks.keys.find((x) => x.kid === kid);
  }
}

export interface VerifyOptions {
  now: () => number;
  jwks: JwksCache;
}

/** Vérifie un jeton d'identité. Lève `OidcError` ; ne renvoie un résultat que si TOUT est valide. Le nonce est vérifié par l'appelant (usage unique en base). */
export async function verifyIdToken(token: string, provider: OidcProvider, opts: VerifyOptions): Promise<VerifiedToken> {
  if (typeof token !== 'string' || token.length > 8192) throw new OidcError('malformed');
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('malformed');
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64u(parts[0]).toString('utf8')) as { alg?: string; kid?: string };
    payload = JSON.parse(b64u(parts[1]).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new OidcError('malformed');
  }
  // Algorithme imposé : jamais « none » ni un secret partagé
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new OidcError('malformed');
  if (provider.audiences.length === 0) throw new OidcError('bad_audience');
  const jwk = await opts.jwks.key(provider.jwksUri, header.kid);
  if (!jwk || jwk.kty !== 'RSA') throw new OidcError('unknown_key');
  let ok = false;
  try {
    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64u(parts[2]));
  } catch {
    ok = false;
  }
  if (!ok) throw new OidcError('bad_signature');

  if (typeof payload.iss !== 'string' || !provider.issuers.includes(payload.iss)) throw new OidcError('bad_issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some((a) => typeof a === 'string' && provider.audiences.includes(a))) throw new OidcError('bad_audience');
  const nowS = Math.floor(opts.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + 60 < nowS) throw new OidcError('expired');
  if (typeof payload.iat === 'number' && payload.iat > nowS + 300) throw new OidcError('expired');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) throw new OidcError('malformed');
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase().slice(0, 254) : undefined,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
  };
}

/** Le nonce du jeton doit être celui délivré par le service, tel quel ou haché (SHA-256 hexadécimal : flux natifs Apple). */
export function nonceMatches(tokenNonce: string | undefined, issued: string): boolean {
  if (!tokenNonce) return false;
  return tokenNonce === issued || tokenNonce === createHash('sha256').update(issued).digest('hex');
}
