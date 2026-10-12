import { describe, expect, it } from 'vitest';
import { BALANCE_VERSION } from '../src/config/version';
import { GameSession } from '../src/game/session';
import { IDENTITY_KEY, LeaderboardClient, PENDING_KEY, TICKETS_KEY } from '../src/net/leaderboard';
import { MemoryStore, defaultSave } from '../src/save/save';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import * as S from '../src/ui/screens';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';

/** « Réseau » en mémoire : les requêtes du client sont traitées directement par le service. */
function network(online: { value: boolean }, clock: { t: number }) {
  const app = createApp(openDb(':memory:'), { ticketSecret: SECRET, now: () => clock.t });
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!online.value) throw new TypeError('Failed to fetch');
    const u = new URL(String(url));
    const h = (init?.headers ?? {}) as Record<string, string>;
    const out = app({ method: init?.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: { authorization: h.Authorization }, body: init?.body ? JSON.parse(String(init.body)) : undefined, ip: '1.2.3.4' });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { app, fetchFn };
}

function setup(configured = true) {
  const online = { value: true };
  const clock = { t: 1_700_000_000_000 };
  const net = network(online, clock);
  const store = new MemoryStore();
  const client = new LeaderboardClient({ baseUrl: configured ? 'http://classement.test' : '', store, fetchFn: net.fetchFn, balance: BALANCE_VERSION, build: 'test', now: () => clock.t });
  return { online, clock, store, client };
}

function playRun(seed: number): { flips: number[]; time: number; score: number } {
  const session = new GameSession({ mode: 'survival', seed });
  let frame = 0;
  while (session.phase === 'running') {
    if (frame % 31 === 5) session.action();
    session.frame(1 / 60);
    frame++;
  }
  return { flips: [...session.sim.flipLog], time: session.sim.time, score: session.sim.scoring.score };
}

describe('classement : client', () => {
  it('sans service configuré : indisponible, aucune requête, aucun ticket, aucune donnée fictive', async () => {
    const { client, store } = setup(false);
    expect(client.configured).toBe(false);
    expect(client.takeTicket()).toBeNull();
    expect((await client.top()).ok).toBe(false);
    expect(await client.flush()).toEqual([]);
    await client.ensureTickets();
    expect(store.get(TICKETS_KEY)).toBeNull();
    const view = { configured: false, identity: null, loading: false, error: null, top: null, me: null, balances: null, balance: BALANCE_VERSION, pending: [], nickMessage: null, localBest: { time: 84.6, score: 1234 } };
    const html = S.leaderboardScreen(view);
    expect(html).toContain('pas encore activé');
    expect(html).toContain('1:24,6');
    expect(html).not.toContain('lb-table');
    expect(html).not.toContain('nick-form');
  });

  it('profil : pseudo validé, identité conservée à part de la sauvegarde, tickets de partie', async () => {
    const { client, store } = setup();
    expect((await client.register('x')).ok).toBe(false);
    expect(client.identity()).toBeNull();
    const reg = await client.register('Axel');
    expect(reg.ok).toBe(true);
    expect(client.identity()?.nickname).toBe('Axel');
    expect(store.get(IDENTITY_KEY)).toContain('playerId');
    // Le profil est refusé si le pseudo existe déjà
    const other = setup();
    expect(other.client.identity()).toBeNull();
    await client.ensureTickets();
    expect(client.ticketCount()).toBeGreaterThanOrEqual(2);
    const t = client.takeTicket();
    expect(t?.seed).toBeTypeOf('number');
    expect(client.ticketCount()).toBeLessThan(5);
    // Renommage
    expect((await client.rename('Axel Prime')).ok).toBe(true);
    expect(client.identity()?.nickname).toBe('Axel Prime');
  });

  it('partie éligible : en attente jusqu’à validation, puis classée avec son rang', async () => {
    const { client } = setup();
    await client.register('Axel');
    await client.ensureTickets();
    const ticket = client.takeTicket()!;
    const run = playRun(ticket.seed);
    const rec = client.recordRun(ticket, run.flips, { time: run.time, score: run.score });
    expect(rec.status).toBe('pending');
    expect(client.pending()).toHaveLength(1);
    const list = await client.flush();
    expect(list[0]).toMatchObject({ status: 'accepted', result: { time: run.time, score: run.score, rank: 1, personalBest: true } });
    const top = await client.top();
    expect(top.ok && top.data.entries[0]).toMatchObject({ nickname: 'Axel', time: run.time, you: true });
    const me = await client.me();
    expect(me.ok && me.data.best?.rank).toBe(1);
  });

  it('hors ligne : le résultat reste en attente (jamais perdu), envoyé au retour de la connexion', async () => {
    const { client, online, store } = setup();
    await client.register('Axel');
    await client.ensureTickets();
    const ticket = client.takeTicket()!;
    const run = playRun(ticket.seed);
    online.value = false;
    client.recordRun(ticket, run.flips, { time: run.time, score: run.score });
    const offline = await client.flush();
    expect(offline[0].status).toBe('pending');
    expect(offline[0].lastError).toBe('Hors ligne');
    expect(JSON.parse(store.get(PENDING_KEY)!)).toHaveLength(1);
    online.value = true;
    const back = await client.flush();
    expect(back[0].status).toBe('accepted');
  });

  it('résultat falsifié : « non validé » avec le motif du serveur, jamais classé, pas de nouvel essai', async () => {
    const { client } = setup();
    await client.register('Axel');
    await client.ensureTickets();
    const ticket = client.takeTicket()!;
    const run = playRun(ticket.seed);
    client.recordRun(ticket, run.flips, { time: run.time + 100, score: run.score * 5 });
    const list = await client.flush();
    expect(list[0]).toMatchObject({ status: 'rejected', reason: 'divergence' });
    expect(list[0].message).toContain('non validé');
    const top = await client.top();
    expect(top.ok && top.data.total).toBe(0);
    const again = await client.flush();
    expect(again[0].attempts).toBe(1);
    client.clearDone();
    expect(client.pending()).toEqual([]);
  });

  it('sans profil : aucun ticket, donc aucune partie éligible', async () => {
    const { client } = setup();
    expect(client.takeTicket()).toBeNull();
    await client.ensureTickets();
    expect(client.ticketCount()).toBe(0);
  });

  it('tickets expirés ignorés localement', async () => {
    const { client, clock } = setup();
    await client.register('Axel');
    await client.ensureTickets();
    expect(client.ticketCount()).toBeGreaterThan(0);
    clock.t += 30 * 86_400_000;
    expect(client.ticketCount()).toBe(0);
    expect(client.takeTicket()).toBeNull();
  });

  it('statuts affichés : en attente, non validé, validé, aucun ticket, assisté', () => {
    expect(S.runLbStatusHtml({ kind: 'pending', offline: true })).toContain('en attente');
    expect(S.runLbStatusHtml({ kind: 'rejected', message: 'x' })).toContain('non validé');
    expect(S.runLbStatusHtml({ kind: 'accepted', rank: 7, best: true })).toContain('rang 7');
    expect(S.runLbStatusHtml({ kind: 'no-ticket' })).toContain('cet appareil');
    expect(S.runLbStatusHtml({ kind: 'assisted' })).toContain('non éligible');
    expect(S.runLbStatusHtml({ kind: 'hidden' })).toBe('');
    // Le résultat de Survie n'affiche la ligne que si le classement est concerné
    const save = defaultSave();
    expect(S.homeScreen(save, '2026-10-12')).toContain('data-action="leaderboard"');
  });

  it('menu avec service : saisie du pseudo, top 100, rang, résultats en attente', () => {
    const view = {
      configured: true,
      identity: { nickname: 'Axel' },
      loading: false,
      error: null,
      top: { balance: BALANCE_VERSION, currentBalance: BALANCE_VERSION, total: 2, entries: [{ rank: 1, nickname: 'Nova', time: 120.5, score: 9000, at: 1 }, { rank: 2, nickname: 'Axel', time: 80, score: 4000, at: 2, you: true }] },
      me: { playerId: 'p', nickname: 'Axel', balance: BALANCE_VERSION, best: { time: 80, score: 4000, rank: 2 }, total: 2 },
      balances: { current: BALANCE_VERSION, versions: [{ balance: BALANCE_VERSION - 1, players: 4 }] },
      balance: BALANCE_VERSION,
      pending: [{ id: 't', submission: { ticket: { id: 't', seed: 1, exp: 1, sig: 's' }, replay: { v: 1 as const, flips: [] }, claimed: { time: 90, score: 100 }, client: { balance: BALANCE_VERSION, build: 'x' } }, createdAt: 1, status: 'pending' as const, attempts: 1, lastError: 'Hors ligne' }],
      nickMessage: null,
      localBest: null,
    };
    const html = S.leaderboardScreen(view);
    expect(html).toContain('Nova');
    expect(html).toContain('(vous)');
    expect(html).toContain('2 / 2');
    expect(html).toContain('lb-row--you');
    expect(html).toContain('En attente de connexion');
    expect(html).toContain('ancien');
    expect(html).toContain('data-action="lb-flush"');
    expect(html).toContain('data-form="lb-rename"');
    expect(S.leaderboardScreen({ ...view, identity: null })).toContain('data-form="lb-register"');
    expect(S.leaderboardScreen({ ...view, top: null, error: 'Service injoignable' })).toContain('Classement indisponible');
  });
});
