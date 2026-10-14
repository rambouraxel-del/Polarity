import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';
import { BALANCE_VERSION } from '../src/config/version';
import { GameSession } from '../src/game/session';
import { sanitizeBaseUrl } from '../src/net/baseUrl';
import { NATIVE_APP_ORIGINS } from '../src/net/origins';
import { REPLAY_FORMAT, type LeaderboardResponse, type RegisterResponse, type RunResponse, type RunSubmission, type TicketsResponse } from '../src/net/protocol';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import { checkOrigins, createHttpServer } from '../server/http';

const PAGES = 'https://utilisateur.github.io';
const SECRET = 'secret-de-test-pour-les-tickets-0123456789';

describe('origines des applications natives (WebView) et classement', () => {
  it('capacitor.config.ts épingle exactement les origines attendues par le serveur', () => {
    const s = config.server!;
    expect(s.hostname).toBe('localhost');
    expect([`${s.androidScheme}://${s.hostname}`, `${s.iosScheme}://${s.hostname}`]).toEqual([...NATIVE_APP_ORIGINS]);
    expect(s.cleartext).toBe(false);
    expect(config.android?.allowMixedContent).toBe(false);
  });

  it('ALLOWED_ORIGINS : origines WebView acceptées telles quelles ; aucun joker ni variante', () => {
    expect(checkOrigins([PAGES, ...NATIVE_APP_ORIGINS], true)).toEqual([]);
    for (const bad of ['*', 'capacitor://*', 'capacitor://localhost/', 'capacitor://autre', 'ionic://localhost', 'file://', 'http://localhost', 'http://localhost:3000', 'https://*.github.io']) {
      expect(checkOrigins([bad], true), bad).not.toEqual([]);
    }
  });

  it('l’adresse HTTPS du service reste vérifiée sans confusion avec l’origine locale de l’application', () => {
    // L'adresse du service (VITE_LEADERBOARD_URL) est publique en https ; l'origine locale de l'app n'est jamais une adresse de service valide
    expect(sanitizeBaseUrl('https://classement.exemple.org')).toBe('https://classement.exemple.org');
    expect(sanitizeBaseUrl('capacitor://localhost')).toBe('');
    expect(sanitizeBaseUrl('https://localhost')).toBe('https://localhost');
  });

  it('parcours complet depuis chaque origine WebView : préalable CORS, inscription, tickets, partie validée, signalement, suppression du profil', async () => {
    const db = openDb(':memory:');
    const app = createApp(db, { ticketSecret: SECRET, balance: BALANCE_VERSION });
    const server = createHttpServer(app, { allowedOrigins: [PAGES, ...NATIVE_APP_ORIGINS], trustProxy: 1, requireHttps: true });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      let n = 0;
      for (const origin of NATIVE_APP_ORIGINS) {
        n++;
        const ip = `10.1.0.${n}`;
        const hdr = (extra: Record<string, string> = {}): Record<string, string> => ({ origin, 'x-forwarded-proto': 'https', 'x-forwarded-for': ip, 'content-type': 'application/json', ...extra });
        const call = (method: string, path: string, body?: unknown, auth?: string): Promise<Response> =>
          fetch(base + path, { method, headers: hdr(auth ? { authorization: `Bearer ${auth}` } : {}), body: body === undefined ? undefined : JSON.stringify(body) });

        // Pré-requête CORS du navigateur (en-têtes Authorization + Content-Type, méthode DELETE)
        const pre = await fetch(`${base}/api/me`, { method: 'OPTIONS', headers: { origin, 'x-forwarded-proto': 'https', 'access-control-request-method': 'DELETE', 'access-control-request-headers': 'authorization,content-type' } });
        expect(pre.status).toBe(204);
        expect(pre.headers.get('access-control-allow-origin')).toBe(origin);
        expect(pre.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
        expect(pre.headers.get('access-control-allow-methods')).toContain('DELETE');

        const reg = await call('POST', '/api/register', { nickname: `Pilote${n}` });
        expect(reg.status).toBe(201);
        expect(reg.headers.get('access-control-allow-origin')).toBe(origin);
        const me = (await reg.json()) as RegisterResponse;
        const auth = `${me.playerId}.${me.token}`;

        const tk = await call('POST', '/api/tickets', undefined, auth);
        expect(tk.status).toBe(200);
        const ticket = ((await tk.json()) as TicketsResponse).tickets[0];

        const session = new GameSession({ mode: 'survival', seed: ticket.seed });
        let f = 0;
        while (session.phase === 'running') {
          if (f % 29 === 7) session.action();
          session.frame(1 / 60);
          if (++f > 60 * 600) throw new Error('la partie ne se termine pas');
        }
        const sub: RunSubmission = {
          ticket,
          replay: { v: REPLAY_FORMAT, flips: [...session.sim.flipLog] },
          claimed: { time: session.sim.time, score: session.sim.scoring.score },
          client: { balance: BALANCE_VERSION, build: 'test-native' },
        };
        const run = await call('POST', '/api/runs', sub, auth);
        expect(((await run.json()) as RunResponse).status).toBe('accepted');

        const top = (await (await call('GET', '/api/leaderboard')).json()) as LeaderboardResponse;
        expect(top.entries.some((e) => e.nickname === `Pilote${n}`)).toBe(true);

        // Autorisation inchangée : DELETE sans secret refusé même depuis une origine autorisée
        expect((await call('DELETE', '/api/me')).status).toBe(401);
        expect((await call('DELETE', '/api/me', undefined, auth)).status).toBe(200);
      }
      // Une autre origine « de type application » reste sans en-tête CORS
      const other = await fetch(`${base}/api/leaderboard`, { headers: { origin: 'capacitor://pirate', 'x-forwarded-proto': 'https' } });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    }
  });
});
