import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { LIMITS } from '../src/net/protocol';
import { createApp } from './app';
import { openDb } from './db';

/**
 * Serveur HTTP du classement mondial (Survie). Configuration par variables d'environnement :
 *   TICKET_SECRET     secret de signature des tickets (obligatoire, ≥ 32 caractères aléatoires) — jamais dans le jeu
 *   DATABASE_PATH     fichier SQLite (défaut : ./data/leaderboard.sqlite) — à placer sur un disque persistant
 *   ALLOWED_ORIGINS   origines autorisées (CORS), séparées par des virgules, ex. https://utilisateur.github.io
 *   PORT              port d'écoute (défaut 8787)
 *   TRUST_PROXY       « 1 » pour lire l'IP client dans X-Forwarded-For (derrière un proxy fiable)
 * Aucune route d'administration : rien à protéger côté jeu.
 */
const secret = process.env.TICKET_SECRET ?? '';
if (secret.length < 32) {
  console.error('TICKET_SECRET manquant ou trop court (32 caractères minimum). Exemple : openssl rand -hex 32');
  process.exit(1);
}
const dbPath = process.env.DATABASE_PATH ?? './data/leaderboard.sqlite';
mkdirSync(dirname(dbPath), { recursive: true });
const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const trustProxy = process.env.TRUST_PROXY === '1';
const port = Number(process.env.PORT ?? 8787);

const app = createApp(openDb(dbPath), { ticketSecret: secret });

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  const cors: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    cors['Access-Control-Allow-Origin'] = origin;
    cors['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    cors['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS';
    cors['Access-Control-Max-Age'] = '600';
  }
  const send = (status: number, body?: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);

  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > LIMITS.maxBodyBytes) tooBig = true;
    else chunks.push(c);
  });
  req.on('end', () => {
    if (tooBig) return send(413, { error: 'too_large', message: 'Requête trop volumineuse.' });
    let body: unknown;
    if (chunks.length > 0) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { error: 'bad_json', message: 'Corps JSON invalide.' });
      }
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const fwd = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    const out = app({
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: { authorization: req.headers.authorization },
      body,
      ip: fwd || req.socket.remoteAddress || 'inconnue',
    });
    send(out.status, out.body);
  });
});

server.listen(port, () => console.log(`Classement : écoute sur le port ${port} (base : ${dbPath}, origines : ${allowed.join(', ') || 'aucune'})`));
