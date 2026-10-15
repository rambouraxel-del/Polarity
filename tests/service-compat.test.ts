import { describe, expect, it } from 'vitest';
import { INCOMPATIBLE_MESSAGE, LeaderboardClient } from '../src/net/leaderboard';
import { API_LEVEL } from '../src/net/protocol';
import { isServiceIncompatible } from '../src/net/serviceState';
import { MemoryStore, defaultSave } from '../src/save/save';
import * as RW from '../src/ui/rewardsScreens';
import * as S from '../src/ui/screens';
import { createApp, type HttpRequest } from '../server/app';
import { openDb } from '../server/db';

/**
 * Nouveau jeu face à un service d'AVANT l'économie v3 (cas constaté en production : le jeu est publié, le service OVH n'est pas encore mis à jour).
 * Un tel service ne connaît que le classement ; il répond « Route inconnue » (404) aux routes récentes et exige un pseudo à l'inscription.
 * Le jeu doit l'expliquer (« service pas à jour »), ne rien perdre, ne pas insister, et ne pas confondre cela avec une absence de connexion.
 */
const NOW0 = Date.UTC(2026, 9, 15, 12, 0, 0);
const ok = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

/** Service d'avant l'économie v3 : mêmes réponses que le code de `main` à `836be7d`. */
function oldService(): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const legacy = new Set(['GET /api/health', 'GET /api/leaderboard', 'GET /api/me', 'POST /api/tickets', 'POST /api/runs', 'POST /api/register']);
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const key = `${init?.method ?? 'GET'} ${u.pathname}`;
    calls.push(key);
    if (key === 'POST /api/register') {
      const nick = (JSON.parse(String(init?.body ?? '{}')) as { nickname?: string }).nickname;
      if (!nick) return ok({ error: 'bad_nickname', message: 'Pseudo invalide : 3 à 16 caractères (lettres latines, chiffres, espace, point, tiret).' }, 400);
      return ok({ playerId: 'p1', token: 't'.repeat(43), nickname: nick }, 201);
    }
    if (key === 'GET /api/leaderboard') return ok({ balance: 3, category: 'plain', currentBalance: 3, entries: [], total: 0 });
    if (legacy.has(key)) return ok({ ok: true, balance: 3 });
    return ok({ error: 'not_found', message: 'Route inconnue.' }, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

function setup(now = { t: NOW0 }) {
  const svc = oldService();
  const client = new LeaderboardClient({ baseUrl: 'https://svc.example', store: new MemoryStore(), fetchFn: svc.fetchFn, balance: 3, build: 'test', now: () => now.t });
  return { client, now, ...svc };
}

describe('service pas à jour : détecté, expliqué, sans perte', () => {
  it('routes récentes (calendrier, Défi quotidien, synchronisation) : « incompatible » (pas « hors ligne », pas « Route inconnue »)', async () => {
    const { client } = setup();
    client.adoptIdentity({ playerId: 'p1', token: 't'.repeat(43), nickname: 'Axel' });
    const daily = await client.dailyBoard();
    expect(daily).toMatchObject({ ok: false, kind: 'incompatible', message: INCOMPATIBLE_MESSAGE });
    expect(INCOMPATIBLE_MESSAGE).not.toMatch(/Route inconnue/);
    expect(isServiceIncompatible()).toBe(true);
    expect(await client.loyaltyCheckin()).toMatchObject({ ok: false, kind: 'incompatible' });
    expect(await client.api('POST', '/api/sync', { auth: true, body: {} })).toMatchObject({ ok: false, kind: 'incompatible' });
  });

  it('on cesse d’insister : une seule requête vouée à l’échec pendant 5 minutes, puis un nouvel essai', async () => {
    const { client, calls, now } = setup();
    client.adoptIdentity({ playerId: 'p1', token: 't'.repeat(43), nickname: 'Axel' });
    await client.dailyBoard();
    const after = calls.length;
    for (let i = 0; i < 5; i++) await client.loyaltyCheckin();
    expect(calls.length).toBe(after);
    now.t += 5 * 60_000 + 1;
    await client.loyaltyCheckin();
    expect(calls.length).toBe(after + 1);
  });

  it('inscription invité refusée par l’ancien service (pseudo exigé) : « incompatible », pas « Pseudo invalide » ; l’inscription AVEC pseudo marche toujours', async () => {
    const { client } = setup();
    const g = await client.registerGuest();
    expect(g).toMatchObject({ ok: false, kind: 'incompatible' });
    expect((g as { message: string }).message).not.toMatch(/Pseudo invalide/);
    const named = await client.register('Axel');
    expect(named.ok).toBe(true);
  });

  it('le classement (routes historiques) continue de fonctionner face à l’ancien service, même après la détection', async () => {
    const { client } = setup();
    client.adoptIdentity({ playerId: 'p1', token: 't'.repeat(43), nickname: 'Axel' });
    await client.dailyBoard();
    expect(isServiceIncompatible()).toBe(true);
    const lb = await client.top(3, 'plain');
    expect(lb.ok).toBe(true);
  });

  it('un vrai hors ligne reste « hors ligne » (distinct)', async () => {
    const client = new LeaderboardClient({ baseUrl: 'https://svc.example', store: new MemoryStore(), fetchFn: (async () => { throw new Error('réseau'); }) as typeof fetch, balance: 3, build: 'test', now: () => NOW0 });
    client.adoptIdentity({ playerId: 'p1', token: 't'.repeat(43), nickname: 'Axel' });
    expect(await client.dailyBoard()).toMatchObject({ ok: false, kind: 'offline' });
  });

  it('un service à jour répond aux routes récentes : l’indicateur est remis à zéro', async () => {
    const now = { t: NOW0 };
    let upToDate = false;
    const fetchFn = (async (url: string | URL | Request): Promise<Response> => {
      const p = new URL(String(url)).pathname;
      if (!upToDate && p === '/api/daily/leaderboard') return ok({ error: 'not_found', message: 'Route inconnue.' }, 404);
      return ok({ date: '2026-10-15', status: 'open', endsAt: 0, finalAt: 0, entries: [], total: 0, me: null });
    }) as typeof fetch;
    const client = new LeaderboardClient({ baseUrl: 'https://svc.example', store: new MemoryStore(), fetchFn, balance: 3, build: 'test', now: () => now.t });
    client.adoptIdentity({ playerId: 'p1', token: 't'.repeat(43), nickname: 'Axel' });
    expect((await client.dailyBoard()).ok).toBe(false);
    expect(isServiceIncompatible()).toBe(true);
    upToDate = true;
    now.t += 6 * 60_000;
    expect((await client.dailyBoard()).ok).toBe(true);
    expect(isServiceIncompatible()).toBe(false);
  });
});

describe('affichage face à un service pas à jour', () => {
  it('calendrier : message dédié (pas « hors ligne », pas de promesse de présence provisoire)', () => {
    const html = RW.loyaltyScreen({ state: null, online: false, provisional: true, incompatible: true, busy: null, message: null, justClaimed: [], now: NOW0 });
    expect(html).toContain('pas encore à jour');
    expect(html).not.toContain('Hors connexion');
  });

  it('Défi quotidien : le message d’incompatibilité remplace « Classement indisponible : Route inconnue »', () => {
    const html = RW.dailyBoardHtml({ board: null, loading: false, error: INCOMPATIBLE_MESSAGE, configured: true, pending: [], now: NOW0 });
    expect(html).toContain('pas encore à jour');
    expect(html).not.toContain('Route inconnue');
  });

  it('Médailles et Éclats en attente : la raison est donnée, rien n’est dit perdu', () => {
    const save = defaultSave();
    save.economy.managed = true;
    save.wallet.medals = 640;
    save.economy.confirmed = { shards: 0, medals: 0, prisms: 0 };
    const html = S.cosmeticsScreen(save, 'ships', 'all', undefined, undefined, undefined);
    expect(html).toContain('640');
    expect(html).toMatch(/en attente/i);
  });
});

describe('le service à jour annonce son niveau d’API', () => {
  it('GET /api/health : { ok, balance, api } — l’ancien service n’a pas ce champ', () => {
    const app = createApp(openDb(':memory:'), { ticketSecret: 'secret-de-test-pour-les-tickets-0123456789', now: () => NOW0 });
    const r = app({ method: 'GET', path: '/api/health', query: new URLSearchParams(), headers: {}, body: undefined, ip: '10.0.0.1' } as HttpRequest);
    expect(r.body).toMatchObject({ ok: true, balance: 3, api: API_LEVEL });
    expect(API_LEVEL).toBeGreaterThanOrEqual(2);
  });
});
