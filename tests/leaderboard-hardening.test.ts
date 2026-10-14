import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { REPLAY_FORMAT, normalizeNickname, validNickname, type LeaderboardResponse, type RegisterResponse, type RunResponse, type RunSubmission, type Ticket, type TicketsResponse } from '../src/net/protocol';
import { BALANCE_VERSION } from '../src/config/version';
import { createApp, type HttpRequest, type HttpResponse } from '../server/app';
import { runAdmin } from '../server/admin';
import { SCHEMA_VERSION, backupTo, integrityCheck, openDb, type Db } from '../server/db';
import { checkOrigins, clientIp, createHttpServer } from '../server/http';
import { checkNickname, fold, maskedNickname } from '../server/moderation';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';

function ctx(opts: { replaysPerMinute?: number } = {}, db: Db = openDb(':memory:'), now = { t: 1_700_000_000_000 }) {
  const app = createApp(db, { ticketSecret: SECRET, now: () => now.t, balance: BALANCE_VERSION, limits: opts.replaysPerMinute ? { replaysPerMinute: opts.replaysPerMinute } : undefined });
  const call = (method: string, path: string, o: { body?: unknown; token?: string; ip?: string } = {}): HttpResponse => {
    const req: HttpRequest = { method, path, query: new URLSearchParams(), headers: { authorization: o.token ? `Bearer ${o.token}` : undefined }, body: o.body, ip: o.ip ?? '10.0.0.1' };
    return app(req);
  };
  return { db, now, call };
}
type Ctx = ReturnType<typeof ctx>;

function register(c: Ctx, nickname: string, ip = '10.0.0.1'): { playerId: string; auth: string } {
  const res = c.call('POST', '/api/register', { body: { nickname }, ip });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const b = res.body as RegisterResponse;
  return { playerId: b.playerId, auth: `${b.playerId}.${b.token}` };
}

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

const submission = (ticket: Ticket, run: { flips: number[]; time: number; score: number }): RunSubmission => ({
  ticket,
  replay: { v: REPLAY_FORMAT, flips: run.flips },
  claimed: { time: run.time, score: run.score },
  client: { balance: BALANCE_VERSION, build: 'test' },
});

describe('classement : pseudos durcis', () => {
  it('lettres latines seulement : alphabets trompeurs (cyrillique, grec), caractères invisibles ou de contrôle refusés', () => {
    for (const bad of ['Аxel', 'Αxel', 'Ax​el', 'Ax‮el', 'Ax＠el']) expect(validNickname(normalizeNickname(bad)), JSON.stringify(bad)).toBe(false);
    expect(validNickname('Éléa-7')).toBe(true);
  });

  it('filtre : insultes, graphies détournées et noms trompeurs refusés ; mots courants acceptés', () => {
    for (const bad of ['Putain42', 'f.u.c.k', 'FuUuCk', 'M3rde', 'Admin', 'Support', 'Polar Rift', 'Joueur', 'nazi']) expect(checkNickname(bad).ok, bad).toBe(false);
    for (const ok of ['Computer', 'Axel', 'Scunthorpe', 'Pilote Nova', 'Hélène']) expect(checkNickname(ok).ok, ok).toBe(true);
    expect(checkNickname('Zorgblatt', ['zorgblatt']).ok).toBe(false);
    expect(fold('Éé 3')).toBe('e');
  });

  it('inscription et renommage refusent un pseudo interdit (400, message clair), sans l’enregistrer', () => {
    const c = ctx();
    const res = c.call('POST', '/api/register', { body: { nickname: 'Putain42' } });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain('pas autorisé');
    const a = register(c, 'Axel');
    expect(c.call('PATCH', '/api/me', { token: a.auth, body: { nickname: 'Admin' } }).status).toBe(400);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 1 });
  });
});

describe('classement : signalement, modération et suppression', () => {
  it('signalement : authentification requise, un seul par couple, pas d’auto-signalement, cible inconnue → 404', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const b = register(c, 'Bea', '10.0.0.2');
    expect(c.call('POST', '/api/report', { body: { nickname: 'Bea' } }).status).toBe(401);
    expect(c.call('POST', '/api/report', { token: a.auth, body: { nickname: 'Bea', reason: 'x\u0000y'.repeat(300) } }).status).toBe(202);
    expect(c.call('POST', '/api/report', { token: a.auth, body: { nickname: 'Bea' } }).status).toBe(202);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 1 });
    expect(c.call('POST', '/api/report', { token: b.auth, body: { nickname: 'Bea' } }).status).toBe(400);
    expect(c.call('POST', '/api/report', { token: a.auth, body: { nickname: 'Inconnu' } }).status).toBe(404);
    const stored = c.db.prepare('SELECT reason FROM reports').get() as { reason: string };
    expect(stored.reason.length).toBeLessThanOrEqual(200);
    expect(stored.reason).not.toContain('\u0000');
  });

  it('DELETE /api/me : jamais sans authentification ; supprime profil, tickets, parties, records et signalements', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const b = register(c, 'Bea', '10.0.0.2');
    expect(c.call('DELETE', '/api/me').status).toBe(401);
    expect(c.call('DELETE', '/api/me', { token: `${a.playerId}.${'A'.repeat(43)}` }).status).toBe(401);
    // Bea ne peut pas supprimer Axel : la suppression ne vise que le profil authentifié
    expect(c.call('DELETE', '/api/me', { token: b.auth }).status).toBe(200);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 1 });
    const tix = (c.call('POST', '/api/tickets', { token: a.auth }).body as TicketsResponse).tickets;
    const run = playRun(tix[0].seed);
    c.now.t += 5000;
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(tix[0], run) }).status).toBe(200);
    c.call('POST', '/api/report', { token: a.auth, body: { nickname: 'Axel' } });
    expect(c.call('DELETE', '/api/me', { token: a.auth }).status).toBe(200);
    for (const t of ['players', 'tickets', 'runs', 'bests', 'reports']) expect(c.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
    // Le profil n'existe plus : le même secret est refusé, et le classement est vide
    expect(c.call('GET', '/api/me', { token: a.auth }).status).toBe(401);
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries).toHaveLength(0);
    // La trace conservée est anonyme
    expect(c.db.prepare('SELECT action, player_id, nickname FROM moderation_log').get()).toMatchObject({ action: 'suppression_par_le_joueur', player_id: null, nickname: null });
  });

  it('aucune route HTTP de modération : tout chemin d’administration est inconnu', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    for (const [m, p] of [['POST', '/api/admin/ban'], ['DELETE', '/api/players/x'], ['POST', '/api/moderate'], ['DELETE', '/api/runs'], ['GET', '/api/reports']] as const) {
      expect([404, 401]).toContain(c.call(m, p, { token: a.auth }).status);
      expect(c.call(m, p).status).toBe(m === 'GET' ? 404 : c.call(m, p).status);
    }
  });

  it('CLI opérateur : hide masque et verrouille le pseudo, ban exclut du classement et des soumissions, unban rétablit', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const [t0, t1] = (c.call('POST', '/api/tickets', { token: a.auth }).body as TicketsResponse).tickets;
    c.now.t += 5000;
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t0, playRun(t0.seed)) }).status).toBe(200);
    c.call('POST', '/api/report', { token: register(c, 'Bea', '10.0.0.2').auth, body: { nickname: 'Axel' } });
    expect(runAdmin(c.db, ['reports']).join('\n')).toContain('Axel');

    runAdmin(c.db, ['hide', 'axel']);
    const masked = maskedNickname(a.playerId);
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries[0].nickname).toBe(masked);
    expect(c.call('PATCH', '/api/me', { token: a.auth, body: { nickname: 'Nouveau' } }).status).toBe(403);
    expect(runAdmin(c.db, ['reports'])).toEqual(['Aucun signalement.']);

    runAdmin(c.db, ['ban', masked]);
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries).toHaveLength(0);
    c.now.t += 5000;
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t1, playRun(t1.seed)) }).status).toBe(403);
    runAdmin(c.db, ['unban', masked]);
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries).toHaveLength(1);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM moderation_log').get()).toEqual({ n: 3 });
  });

  it('CLI opérateur : suppression et purge simulées sans --yes (aucune donnée perdue), appliquées avec --yes', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const [t0] = (c.call('POST', '/api/tickets', { token: a.auth }).body as TicketsResponse).tickets;
    c.now.t += 5000;
    c.call('POST', '/api/runs', { token: a.auth, body: submission(t0, playRun(t0.seed)) });
    expect(runAdmin(c.db, ['delete-player', 'Axel'])[0]).toContain('SIMULATION');
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 1 });
    expect(() => runAdmin(c.db, ['prune'])).toThrow();
    expect(() => runAdmin(c.db, ['prune', '--older-than-days', '3'])).toThrow();
    // Les parties qui sont des records ne sont jamais purgées, même très anciennes
    const far = () => Date.now() + 400 * 86_400_000;
    expect(runAdmin(c.db, ['prune', '--older-than-days', '30', '--yes'], far)[0]).toContain('Supprimé');
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 1 });
    expect(runAdmin(c.db, ['export', 'Axel'])[0]).not.toContain('token');
    expect(runAdmin(c.db, ['delete-player', 'Axel', '--yes'])[0]).toContain('Supprimé');
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 0 });
    expect(() => runAdmin(c.db, ['hide', 'Inconnu'])).toThrow('introuvable');
  });
});

describe('classement : budget global de rejeu', () => {
  it('au-delà du plafond, 429 SANS consommer le ticket (le joueur le rejouera plus tard)', () => {
    const c = ctx({ replaysPerMinute: 1 });
    const a = register(c, 'Axel');
    const b = register(c, 'Bea', '10.0.0.2');
    const ta = (c.call('POST', '/api/tickets', { token: a.auth }).body as TicketsResponse).tickets[0];
    const tb = (c.call('POST', '/api/tickets', { token: b.auth }).body as TicketsResponse).tickets[0];
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(ta, playRun(ta.seed)) }).status).toBe(200);
    const res = c.call('POST', '/api/runs', { token: b.auth, body: submission(tb, playRun(tb.seed)) });
    expect(res.status).toBe(429);
    expect(c.db.prepare('SELECT used_at FROM tickets WHERE id = ?').get(tb.id)).toEqual({ used_at: null });
    c.now.t += 61_000;
    expect(c.call('POST', '/api/runs', { token: b.auth, body: submission(tb, playRun(tb.seed)) }).status).toBe(200);
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).entries).toHaveLength(2);
    expect((res.body as RunResponse).status).toBe('rejected');
  });
});

describe('classement : base de données', () => {
  it('migration v1 → v2 : sauvegarde automatique avant migration, données intactes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-mig-'));
    const file = join(dir, 'lb.sqlite');
    try {
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE players (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, nickname_key TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE tickets (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), seed INTEGER NOT NULL, exp INTEGER NOT NULL, issued_at INTEGER NOT NULL, used_at INTEGER);
        CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, balance INTEGER NOT NULL, ticket_id TEXT NOT NULL UNIQUE, seed INTEGER NOT NULL, steps INTEGER NOT NULL, score INTEGER NOT NULL, flips TEXT NOT NULL, client_build TEXT, created_at INTEGER NOT NULL);
        CREATE TABLE bests (player_id TEXT NOT NULL, balance INTEGER NOT NULL, steps INTEGER NOT NULL, score INTEGER NOT NULL, run_id INTEGER NOT NULL, achieved_at INTEGER NOT NULL, PRIMARY KEY (player_id, balance));
        INSERT INTO players VALUES ('p1', 'Axel', 'axel', 'h', 1);`);
      old.close();
      const db = openDb(file);
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
      expect(db.prepare('SELECT nickname, moderation FROM players').get()).toEqual({ nickname: 'Axel', moderation: 0 });
      expect(existsSync(`${file}.avant-v1.bak`)).toBe(true);
      expect(integrityCheck(db)).toEqual([]);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une base plus récente que le service est refusée sans être modifiée', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-new-'));
    const file = join(dir, 'lb.sqlite');
    try {
      const db = openDb(file);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      db.close();
      expect(() => openDb(file)).toThrow('plus récente');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sauvegarde à chaud : copie autonome et lisible, jamais d’écrasement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-bak-'));
    try {
      const db = openDb(join(dir, 'lb.sqlite'));
      const c = ctx({}, db);
      register(c, 'Axel');
      const dest = join(dir, 'copie.sqlite');
      backupTo(db, dest);
      expect(() => backupTo(db, dest)).toThrow('existe déjà');
      const copy = openDb(dest);
      expect(copy.prepare('SELECT nickname FROM players').get()).toEqual({ nickname: 'Axel' });
      copy.close();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('classement : couche HTTP', () => {
  it('clientIp : compte depuis la droite ; l’en-tête falsifié par le client est ignoré', () => {
    expect(clientIp('1.1.1.1, 2.2.2.2', '9.9.9.9', 0)).toBe('9.9.9.9');
    expect(clientIp('6.6.6.6, 2.2.2.2', '9.9.9.9', 1)).toBe('2.2.2.2');
    expect(clientIp('6.6.6.6, 2.2.2.2, 3.3.3.3', '9.9.9.9', 2)).toBe('2.2.2.2');
    expect(clientIp(undefined, '9.9.9.9', 1)).toBe('9.9.9.9');
  });

  it('origines CORS : jamais « * », https obligatoire hors machine locale', () => {
    expect(checkOrigins(['https://joueur.github.io'], true)).toEqual([]);
    expect(checkOrigins(['*'], false)).not.toEqual([]);
    expect(checkOrigins(['https://joueur.github.io/'], true)).not.toEqual([]);
    expect(checkOrigins(['http://exemple.org'], false)).not.toEqual([]);
    expect(checkOrigins(['http://localhost:5173'], false)).toEqual([]);
    expect(checkOrigins(['http://localhost:5173'], true)).not.toEqual([]);
  });

  it('serveur HTTP (éphémère, port aléatoire) : CORS strict, HTTPS exigé, 415, 405, 413, DELETE sans secret refusé', async () => {
    const c = ctx();
    const origin = 'https://joueur.github.io';
    const server = createHttpServer((req) => createApp(c.db, { ticketSecret: SECRET, balance: BALANCE_VERSION })(req), { allowedOrigins: [origin], trustProxy: 1, requireHttps: true });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const https = { 'x-forwarded-proto': 'https' };
    try {
      const get = (path: string, h: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> => fetch(base + path, { ...init, headers: { ...h, ...(init.headers as Record<string, string> | undefined) } });
      // Clair → refusé ; sonde de santé exemptée
      expect((await get('/api/leaderboard')).status).toBe(426);
      expect((await get('/api/health')).status).toBe(200);
      // CORS : origine autorisée seulement
      const ok = await get('/api/leaderboard', { ...https, origin });
      expect(ok.headers.get('access-control-allow-origin')).toBe(origin);
      expect(ok.headers.get('strict-transport-security')).toBeTruthy();
      expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
      const other = await get('/api/leaderboard', { ...https, origin: 'https://pirate.example' });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      const pre = await get('/api/me', { ...https, origin }, { method: 'OPTIONS' });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-methods')).toContain('DELETE');
      // Corps : type obligatoire, taille bornée, méthode inconnue
      expect((await get('/api/register', https, { method: 'POST', body: '{"nickname":"Axel"}', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
      expect((await get('/api/register', https, { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })).status).toBe(400);
      expect((await get('/api/register', https, { method: 'POST', body: 'x'.repeat(300_000), headers: { 'content-type': 'application/json' } }).catch(() => ({ status: 413 }))).status).toBe(413);
      expect((await get('/api/leaderboard', https, { method: 'TRACE' as string }).catch(() => ({ status: 405 }))).status).toBe(405);
      // Suppression : sans secret → 401, et rien n'est supprimé
      const reg = await get('/api/register', https, { method: 'POST', body: '{"nickname":"Axel"}', headers: { 'content-type': 'application/json' } });
      expect(reg.status).toBe(201);
      expect((await get('/api/me', https, { method: 'DELETE' })).status).toBe(401);
      expect(c.db.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 1 });
    } finally {
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    }
  });
});
