import { createServer, type IncomingMessage, type Server } from 'node:http';
import { NATIVE_APP_ORIGINS } from '../src/net/origins';
import { LIMITS } from '../src/net/protocol';
import type { HttpRequest, HttpResponse } from './app';

/**
 * Couche HTTP du service de classement (transport seulement : la logique est dans app.ts).
 *
 * Durcissement :
 * - CORS strict : seules les origines listées reçoivent des en-têtes CORS ; aucune origine générique (« * ») n'est acceptée.
 * - Les corps JSON exigent `Content-Type: application/json` (déclenche une pré-requête CORS : aucun formulaire d'un autre site ne peut écrire).
 * - Adresse du client : lue dans X-Forwarded-For seulement derrière `trustProxy` saut(s) de proxy de confiance, en comptant depuis la DROITE
 *   (la valeur ajoutée par notre proxy), jamais la valeur de gauche, que le client peut falsifier.
 * - HTTPS exigé (`requireHttps`) derrière un proxy fiable : une requête arrivée en clair est refusée AVANT d'être traitée (les secrets des joueurs
 *   voyagent dans l'en-tête Authorization). Seule la sonde de santé est exemptée.
 * - Délais de requête, taille de corps bornée (coupure immédiate), URL illisible → 400, jamais d'exception non rattrapée.
 */
export interface HttpOptions {
  allowedOrigins: readonly string[];
  /** Nombre de proxys de confiance devant le service (0 = aucun). */
  trustProxy: number;
  requireHttps: boolean;
}

const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);
const BODY_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/** Adresse du client d'après X-Forwarded-For et le nombre de proxys de confiance (voir ci-dessus). */
export function clientIp(forwardedFor: string | undefined, socketAddress: string | undefined, trustProxy: number): string {
  if (trustProxy > 0 && forwardedFor) {
    const parts = forwardedFor.split(',').map((s) => s.trim()).filter(Boolean);
    const pick = parts[parts.length - trustProxy] ?? parts[0];
    if (pick) return pick.slice(0, 64);
  }
  return socketAddress ?? 'inconnue';
}

/**
 * Valide la liste d'origines CORS : origines exactes en https (ou http local pour le développement), plus les origines WebView des applications
 * natives (`capacitor://localhost` pour iOS ; `https://localhost` pour Android est déjà du https). Ce sont les SEULS schémas non https acceptés, et uniquement tels quels.
 * Renvoie les erreurs.
 */
export function checkOrigins(origins: readonly string[], production: boolean): string[] {
  const problems: string[] = [];
  for (const o of origins) {
    if (NATIVE_APP_ORIGINS.includes(o)) continue;
    if (o === '*' || o.includes('*')) problems.push(`origine générique refusée : ${o}`);
    else if (!/^https?:\/\/[^/\s]+$/i.test(o)) problems.push(`origine invalide (attendu https://hôte, sans chemin ni slash final) : ${o}`);
    else if (/^http:\/\//i.test(o) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o)) problems.push(`origine en clair refusée (https obligatoire hors machine locale) : ${o}`);
    else if (production && /^http:\/\//i.test(o)) problems.push(`origine locale en clair refusée en production : ${o}`);
  }
  return problems;
}

export function createHttpServer(app: (req: HttpRequest) => HttpResponse, opts: HttpOptions): Server {
  const server = createServer((req: IncomingMessage, res) => {
    const origin = req.headers.origin;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-site',
    };
    if (opts.requireHttps) headers['Strict-Transport-Security'] = 'max-age=31536000';
    if (origin && opts.allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
      headers['Access-Control-Max-Age'] = '600';
    }
    let answered = false;
    const send = (status: number, body?: unknown): void => {
      if (answered) return;
      answered = true;
      res.writeHead(status, headers);
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    req.on('error', () => send(400, { error: 'bad_request', message: 'Requête interrompue.' }));

    const method = req.method ?? 'GET';
    if (!METHODS.has(method)) return send(405, { error: 'method_not_allowed', message: 'Méthode non autorisée.' });
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return send(400, { error: 'bad_request', message: 'Adresse illisible.' });
    }
    // HTTPS : refusé avant toute lecture du corps ; la sonde de santé du conteneur (sans proxy) reste possible
    if (opts.requireHttps && url.pathname !== '/api/health') {
      const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
      if (proto !== 'https') return send(426, { error: 'https_required', message: 'HTTPS obligatoire.' });
    }
    if (method === 'OPTIONS') return send(204);

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > LIMITS.maxBodyBytes) {
        send(413, { error: 'too_large', message: 'Requête trop volumineuse.' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (answered) return;
      let body: unknown;
      if (chunks.length > 0) {
        if (BODY_METHODS.has(method) && !/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
          return send(415, { error: 'unsupported_media_type', message: 'Content-Type application/json requis.' });
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: 'bad_json', message: 'Corps JSON invalide.' });
        }
      }
      const out = app({
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: { authorization: req.headers.authorization },
        body,
        ip: clientIp(String(req.headers['x-forwarded-for'] ?? ''), req.socket.remoteAddress, opts.trustProxy),
      });
      send(out.status, out.body);
    });
  });
  // Délais : un client lent ne peut pas garder des connexions ouvertes indéfiniment
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server;
}
