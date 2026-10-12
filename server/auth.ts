import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Ticket } from '../src/net/protocol';

/**
 * Identité et authentification.
 * - Identité stable : `playerId` (UUID) créé à l'inscription, conservé dans le navigateur du joueur.
 * - Authentification : secret aléatoire de 256 bits remis une seule fois ; le serveur n'en stocke que l'empreinte SHA-256
 *   (valeur à forte entropie : une empreinte rapide suffit). Transmis en `Authorization: Bearer <playerId>.<secret>` sur HTTPS.
 * - Il n'existe AUCUNE clé ni route d'administration : rien de sensible n'est jamais embarqué dans le jeu.
 */
export function newPlayerId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Analyse « Bearer <playerId>.<secret> ». */
export function parseBearer(header: string | undefined): { playerId: string; token: string } | null {
  if (!header) return null;
  const m = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,64})$/.exec(header.trim());
  return m ? { playerId: m[1], token: m[2] } : null;
}

/** Signature d'un ticket : lie identifiant, graine, expiration et joueur (HMAC-SHA256 avec le secret du serveur). */
export function signTicket(secret: string, t: Omit<Ticket, 'sig'>, playerId: string): string {
  return createHmac('sha256', secret).update(`${t.id}.${t.seed}.${t.exp}.${playerId}`).digest('hex');
}

export function verifyTicketSig(secret: string, t: Ticket, playerId: string): boolean {
  const expected = Buffer.from(signTicket(secret, t, playerId), 'hex');
  let given: Buffer;
  try {
    given = Buffer.from(t.sig, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function newTicketParts(): { id: string; seed: number } {
  return { id: randomBytes(16).toString('hex'), seed: randomInt(0, 2 ** 32) };
}
