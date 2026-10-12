import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { LIMITS, REPLAY_FORMAT, nicknameKey, validFlips, validNickname, type LeaderboardResponse, type MeResponse, type RegisterResponse, type RunResponse, type RunSubmission, type Ticket, type TicketsResponse } from '../src/net/protocol';
import { BALANCE_VERSION } from '../src/config/version';
import { createApp, type HttpRequest, type HttpResponse } from '../server/app';
import { openDb, type Db } from '../server/db';
import { replaySurvival } from '../server/verify';
import { createSimulation } from '../src/modes/run';
import { SIM } from '../src/config/balance';

const SECRET = 'secret-de-test-pour-les-tickets-0123456789';

interface Ctx {
  db: Db;
  now: { t: number };
  call: (method: string, path: string, opts?: { body?: unknown; token?: string; query?: string; ip?: string }) => HttpResponse;
  app: ReturnType<typeof createApp>;
}

function ctx(db: Db = openDb(':memory:'), balance = BALANCE_VERSION, now = { t: 1_700_000_000_000 }): Ctx {
  const app = createApp(db, { ticketSecret: SECRET, now: () => now.t, balance });
  const call: Ctx['call'] = (method, path, o = {}) => {
    const req: HttpRequest = {
      method,
      path,
      query: new URLSearchParams(o.query ?? ''),
      headers: { authorization: o.token ? `Bearer ${o.token}` : undefined },
      body: o.body,
      ip: o.ip ?? '10.0.0.1',
    };
    return app(req);
  };
  return { db, now, call, app };
}

function register(c: Ctx, nickname: string, ip = '10.0.0.1'): { playerId: string; auth: string } {
  const res = c.call('POST', '/api/register', { body: { nickname }, ip });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const b = res.body as RegisterResponse;
  return { playerId: b.playerId, auth: `${b.playerId}.${b.token}` };
}

function getTickets(c: Ctx, auth: string): Ticket[] {
  const res = c.call('POST', '/api/tickets', { token: auth });
  expect(res.status).toBe(200);
  return (res.body as TicketsResponse).tickets;
}

/** Joue réellement une partie de Survie avec le code du jeu (GameSession), en inversant à intervalles variés. */
function playRun(seed: number, every = 29): { flips: number[]; time: number; score: number } {
  const session = new GameSession({ mode: 'survival', seed });
  let frame = 0;
  while (session.phase === 'running') {
    if (frame % every === 7) session.action();
    session.frame(1 / 60);
    frame++;
    if (frame > 60 * 600) throw new Error('la partie ne se termine pas');
  }
  return { flips: [...session.sim.flipLog], time: session.sim.time, score: session.sim.scoring.score };
}

const submission = (ticket: Ticket, run: { flips: number[]; time: number; score: number }, balance = BALANCE_VERSION): RunSubmission => ({
  ticket,
  replay: { v: REPLAY_FORMAT, flips: run.flips },
  claimed: { time: run.time, score: run.score },
  client: { balance, build: 'test' },
});

describe('classement : règles du protocole', () => {
  it('pseudo : 3 à 16 caractères, lettres/chiffres/espace/point/tiret, unicité insensible à la casse et aux accents', () => {
    for (const ok of ['Axel', 'Léa-2', 'ab1', 'Pilote Nova', 'x.y_z']) expect(validNickname(ok), ok).toBe(true);
    for (const bad of ['ab', 'a'.repeat(17), ' Axel', 'Axel ', 'A  B', '<b>x</b>', '-abc', 'emoji😀', '', 42 as unknown]) expect(validNickname(bad), String(bad)).toBe(false);
    expect(nicknameKey('LÉA')).toBe(nicknameKey('lea'));
  });

  it('journal des entrées : entiers croissants et bornés', () => {
    expect(validFlips([0, 5, 5, 120])).toBe(true);
    expect(validFlips([5, 3])).toBe(false);
    expect(validFlips([-1])).toBe(false);
    expect(validFlips([1.5])).toBe(false);
    expect(validFlips(new Array(LIMITS.maxFlips + 1).fill(1))).toBe(false);
    expect(validFlips('x')).toBe(false);
  });
});

describe('classement : rejeu côté serveur', () => {
  it('la partie rejouée donne exactement la durée et le score du jeu (déterminisme graine + entrées)', () => {
    for (const [seed, every] of [[11, 29], [4242, 17], [987654, 41]] as const) {
      const run = playRun(seed, every);
      const rep = replaySurvival(seed, run.flips);
      expect(rep.ok).toBe(true);
      if (rep.ok) {
        expect(rep.time).toBe(run.time);
        expect(rep.score).toBe(run.score);
        expect(rep.flips).toBe(run.flips.length);
      }
    }
  });

  it('un journal modifié change le résultat ; une entrée après la mort est refusée ; une partie non terminée aussi', () => {
    const run = playRun(31, 23);
    const base = replaySurvival(31, run.flips);
    expect(base.ok).toBe(true);
    const altered = replaySurvival(31, run.flips.slice(1));
    expect(altered.ok && base.ok && (altered.time !== base.time || altered.score !== base.score)).toBe(true);
    const lastStep = Math.round(run.time / SIM.dt);
    expect(replaySurvival(31, [...run.flips, lastStep + 50])).toEqual({ ok: false, reason: 'inputs_after_end' });
    expect(replaySurvival(31, run.flips, 10)).toEqual({ ok: false, reason: 'not_finished' });
    expect(replaySurvival(-5, []).ok).toBe(false);
  });

  it('les parties assistées (invincibilité, motif injecté) sont marquées et ne passent jamais le rejeu', () => {
    const sim = createSimulation({ mode: 'survival', seed: 5 });
    sim.invincible = true;
    sim.step();
    expect(sim.assisted).toBe(true);
    // Un rejeu serveur n'a pas d'invincibilité : la même partie ne survit pas à l'identique
    const normal = createSimulation({ mode: 'survival', seed: 5 });
    for (let i = 0; i < 120 * 600 && normal.state === 'running'; i++) {
      normal.step();
      normal.events.length = 0;
    }
    expect(normal.assisted).toBe(false);
    expect(normal.state).toBe('dead');
  });
});

describe('classement : service', () => {
  it('inscription, pseudo unique, renommage', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    expect(c.call('POST', '/api/register', { body: { nickname: 'axel' }, ip: '10.0.0.2' }).status).toBe(409);
    expect(c.call('POST', '/api/register', { body: { nickname: 'x' }, ip: '10.0.0.2' }).status).toBe(400);
    const b = register(c, 'Bea', '10.0.0.3');
    expect(c.call('PATCH', '/api/me', { token: b.auth, body: { nickname: 'Axel' } }).status).toBe(409);
    expect(c.call('PATCH', '/api/me', { token: a.auth, body: { nickname: 'Axel' } }).status).toBe(200);
    expect(c.call('PATCH', '/api/me', { token: a.auth, body: { nickname: 'Axel Prime' } }).status).toBe(200);
    expect((c.call('GET', '/api/me', { token: a.auth }).body as MeResponse).nickname).toBe('Axel Prime');
  });

  it('authentification : jeton absent, malformé ou faux → 401 ; aucune route d’administration', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    for (const path of ['/api/me', '/api/tickets', '/api/runs']) {
      const method = path === '/api/me' ? 'GET' : 'POST';
      expect(c.call(method, path).status).toBe(401);
      expect(c.call(method, path, { token: 'nimporte' }).status).toBe(401);
      expect(c.call(method, path, { token: `${a.playerId}.${'A'.repeat(43)}` }).status).toBe(401);
    }
    for (const p of ['/api/admin', '/api/players', '/api/reset', '/admin']) expect(c.call('GET', p).status).toBe(404);
    expect(c.call('POST', '/api/leaderboard').status).toBe(404);
  });

  it('le serveur ne stocke que l’empreinte du jeton ; jamais renvoyée', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const token = a.auth.split('.')[1];
    const row = c.db.prepare('SELECT token_hash FROM players').get() as { token_hash: string };
    expect(row.token_hash).not.toContain(token);
    expect(JSON.stringify(c.call('GET', '/api/leaderboard').body)).not.toContain(row.token_hash);
    expect(JSON.stringify(c.call('GET', '/api/me', { token: a.auth }).body)).not.toContain(row.token_hash);
  });

  it('tickets : lots de 5, au plus 10 ouverts, graines distinctes, signés pour le joueur', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const t1 = getTickets(c, a.auth);
    expect(t1).toHaveLength(LIMITS.ticketBatch);
    expect(new Set(t1.map((t) => t.seed)).size).toBe(t1.length);
    expect(getTickets(c, a.auth)).toHaveLength(LIMITS.ticketBatch);
    expect(getTickets(c, a.auth)).toHaveLength(0);
  });

  it('partie valide : acceptée avec la durée et le score du serveur, rang 1, visible au classement', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const [ticket] = getTickets(c, a.auth);
    const run = playRun(ticket.seed);
    const res = c.call('POST', '/api/runs', { token: a.auth, body: submission(ticket, run) });
    expect(res.status).toBe(200);
    const body = res.body as Extract<RunResponse, { status: 'accepted' }>;
    expect(body).toMatchObject({ status: 'accepted', time: run.time, score: run.score, rank: 1, personalBest: true, balance: BALANCE_VERSION });
    const lb = c.call('GET', '/api/leaderboard').body as LeaderboardResponse;
    expect(lb.total).toBe(1);
    expect(lb.entries[0]).toMatchObject({ rank: 1, nickname: 'Axel', time: run.time, score: run.score });
    const me = c.call('GET', '/api/me', { token: a.auth }).body as MeResponse;
    expect(me.best).toMatchObject({ time: run.time, score: run.score, rank: 1 });
  });

  it('les valeurs annoncées par le client ne comptent pas : divergence refusée, ticket consommé', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const [t1, t2] = getTickets(c, a.auth);
    const run = playRun(t1.seed);
    const cheat = c.call('POST', '/api/runs', { token: a.auth, body: { ...submission(t1, run), claimed: { time: run.time + 60, score: run.score * 10 } } });
    expect(cheat.status).toBe(422);
    expect(cheat.body).toMatchObject({ status: 'rejected', reason: 'divergence' });
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).total).toBe(0);
    // Le ticket est consommé : pas d'essais répétés sur la même graine
    c.now.t += 5000;
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t1, run) }).body).toMatchObject({ reason: 'ticket_used' });
    // Journal falsifié (entrées retirées) : le rejeu donne un autre résultat → divergence
    c.now.t += 5000;
    const run2 = playRun(t2.seed);
    const forged = { ...submission(t2, run2), replay: { v: REPLAY_FORMAT, flips: run2.flips.slice(2) } };
    expect(c.call('POST', '/api/runs', { token: a.auth, body: forged }).body).toMatchObject({ status: 'rejected' });
    expect((c.call('GET', '/api/leaderboard').body as LeaderboardResponse).total).toBe(0);
  });

  it('ticket : usage unique, lié au joueur, signature, expiration', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const b = register(c, 'Bea', '10.0.0.3');
    const [t1, t2, t3] = getTickets(c, a.auth);
    const run = playRun(t1.seed);
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t1, run) }).status).toBe(200);
    c.now.t += 5000;
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t1, run) }).body).toMatchObject({ reason: 'ticket_used' });
    // Ticket d'un autre joueur
    c.now.t += 5000;
    const run2 = playRun(t2.seed);
    expect(c.call('POST', '/api/runs', { token: b.auth, body: submission(t2, run2) }).body).toMatchObject({ reason: 'bad_ticket' });
    // Graine modifiée : signature invalide
    c.now.t += 5000;
    const forged = { ...t3, seed: 123456 };
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(forged, playRun(123456)) }).body).toMatchObject({ reason: 'bad_ticket' });
    // Expiré
    c.now.t += (LIMITS.ticketDays + 1) * 86_400_000;
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t3, playRun(t3.seed)) }).body).toMatchObject({ reason: 'ticket_expired' });
  });

  it('version d’équilibrage : une ancienne version du client est refusée (sans consommer le ticket)', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const [t] = getTickets(c, a.auth);
    const run = playRun(t.seed);
    const res = c.call('POST', '/api/runs', { token: a.auth, body: submission(t, run, BALANCE_VERSION - 1) });
    expect(res.body).toMatchObject({ status: 'rejected', reason: 'unsupported_balance' });
    c.now.t += 5000;
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t, run) }).status).toBe(200);
  });

  it('limites de débit : une partie toutes les 3 s au plus ; 5 inscriptions par heure et par adresse', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const [t1, t2] = getTickets(c, a.auth);
    const r1 = playRun(t1.seed);
    const r2 = playRun(t2.seed);
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t1, r1) }).status).toBe(200);
    expect(c.call('POST', '/api/runs', { token: a.auth, body: submission(t2, r2) }).body).toMatchObject({ reason: 'rate_limited' });
    for (let i = 0; i < 5; i++) expect(c.call('POST', '/api/register', { body: { nickname: `Joueur${i}` }, ip: '9.9.9.9' }).status).toBe(201);
    expect(c.call('POST', '/api/register', { body: { nickname: 'Joueur9' }, ip: '9.9.9.9' }).status).toBe(429);
  });

  it('classement : durée d’abord, score en départage, puis ancienneté ; meilleur résultat seulement', () => {
    const c = ctx();
    const names = ['A', 'B', 'C', 'D'].map((n, i) => ({ n: `Pilote ${n}`, ...register(c, `Pilote ${n}`, `10.1.0.${i}`) }));
    const ins = c.db.prepare('INSERT INTO bests (player_id, balance, steps, score, run_id, achieved_at) VALUES (?, ?, ?, ?, 0, ?)');
    ins.run(names[0].playerId, BALANCE_VERSION, 6000, 100, 1000); // 50 s, score 100
    ins.run(names[1].playerId, BALANCE_VERSION, 12000, 10, 2000); // 100 s
    ins.run(names[2].playerId, BALANCE_VERSION, 6000, 900, 3000); // 50 s, meilleur score
    ins.run(names[3].playerId, BALANCE_VERSION, 6000, 900, 500); // 50 s, même score, plus ancien
    const lb = c.call('GET', '/api/leaderboard', { token: names[0].auth }).body as LeaderboardResponse;
    expect(lb.entries.map((e) => e.nickname)).toEqual(['Pilote B', 'Pilote D', 'Pilote C', 'Pilote A']);
    expect(lb.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(lb.entries.find((e) => e.you)?.nickname).toBe('Pilote A');
    expect((c.call('GET', '/api/me', { token: names[0].auth }).body as MeResponse).best?.rank).toBe(4);
  });

  it('un résultat inférieur ne remplace pas le meilleur ; un meilleur le remplace', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    const tickets = getTickets(c, a.auth);
    const runs = tickets.slice(0, 3).map((t, i) => ({ t, run: playRun(t.seed, [29, 11, 53][i]) }));
    runs.sort((x, y) => x.run.time - y.run.time);
    const [low, mid, high] = runs;
    expect(low.run.time).toBeLessThan(high.run.time);
    const send = (r: (typeof runs)[number]): Extract<RunResponse, { status: 'accepted' }> => {
      c.now.t += 5000;
      return c.call('POST', '/api/runs', { token: a.auth, body: submission(r.t, r.run) }).body as Extract<RunResponse, { status: 'accepted' }>;
    };
    expect(send(mid).personalBest).toBe(true);
    const lower = send(low);
    if (low.run.time < mid.run.time) expect(lower.personalBest).toBe(false);
    expect(send(high).personalBest).toBe(high.run.time > mid.run.time);
    const me = c.call('GET', '/api/me', { token: a.auth }).body as MeResponse;
    expect(me.best?.time).toBe(Math.max(low.run.time, mid.run.time, high.run.time));
  });

  it('top 100 : jamais plus de 100 lignes, même avec davantage de joueurs', () => {
    const c = ctx();
    const ins = c.db.prepare('INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES (?, ?, ?, ?, 0)');
    const best = c.db.prepare('INSERT INTO bests (player_id, balance, steps, score, run_id, achieved_at) VALUES (?, ?, ?, ?, 0, ?)');
    for (let i = 0; i < 130; i++) {
      ins.run(`id-${i}`, `Joueur ${i}`, `joueur ${i}`, 'x');
      best.run(`id-${i}`, BALANCE_VERSION, 1000 + i, i, i);
    }
    const lb = c.call('GET', '/api/leaderboard').body as LeaderboardResponse;
    expect(lb.entries).toHaveLength(100);
    expect(lb.total).toBe(130);
    expect(lb.entries[0].nickname).toBe('Joueur 129');
    expect((c.call('GET', '/api/leaderboard', { query: 'limit=5' }).body as LeaderboardResponse).entries).toHaveLength(5);
  });

  it('séparation par version d’équilibrage : les anciens records sont conservés et consultables', () => {
    const db = openDb(':memory:');
    const old = ctx(db, BALANCE_VERSION - 1);
    const a = register(old, 'Axel');
    const [t] = getTickets(old, a.auth);
    const run = playRun(t.seed);
    expect(old.call('POST', '/api/runs', { token: a.auth, body: submission(t, run, BALANCE_VERSION - 1) }).status).toBe(200);
    // Le serveur passe à la version suivante : même base de données
    const now = ctx(db, BALANCE_VERSION, { t: old.now.t + 10_000 });
    const lbNow = now.call('GET', '/api/leaderboard').body as LeaderboardResponse;
    expect(lbNow).toMatchObject({ balance: BALANCE_VERSION, total: 0, entries: [] });
    const lbOld = now.call('GET', '/api/leaderboard', { query: `balance=${BALANCE_VERSION - 1}` }).body as LeaderboardResponse;
    expect(lbOld.total).toBe(1);
    expect(lbOld.entries[0].nickname).toBe('Axel');
    expect(now.call('GET', '/api/balances').body).toEqual({ current: BALANCE_VERSION, versions: [{ balance: BALANCE_VERSION - 1, players: 1 }] });
    // Les nouvelles parties comptent pour la nouvelle version seulement
    const [t2] = getTickets(now, a.auth);
    const run2 = playRun(t2.seed);
    expect(now.call('POST', '/api/runs', { token: a.auth, body: submission(t2, run2) }).status).toBe(200);
    expect((now.call('GET', '/api/leaderboard').body as LeaderboardResponse).total).toBe(1);
    expect((now.call('GET', '/api/leaderboard', { query: `balance=${BALANCE_VERSION - 1}` }).body as LeaderboardResponse).entries[0].time).toBe(run.time);
  });

  it('persistance : les données survivent à la fermeture et à la réouverture de la base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polarity-lb-'));
    const file = join(dir, 'lb.sqlite');
    try {
      const db1 = openDb(file);
      const c1 = ctx(db1);
      const a = register(c1, 'Axel');
      const [t] = getTickets(c1, a.auth);
      const run = playRun(t.seed);
      expect(c1.call('POST', '/api/runs', { token: a.auth, body: submission(t, run) }).status).toBe(200);
      db1.close();
      const c2 = ctx(openDb(file));
      const lb = c2.call('GET', '/api/leaderboard').body as LeaderboardResponse;
      expect(lb.entries[0]).toMatchObject({ nickname: 'Axel', time: run.time });
      // Identité stable : le même jeton fonctionne après redémarrage
      expect((c2.call('GET', '/api/me', { token: a.auth }).body as MeResponse).best?.time).toBe(run.time);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requêtes mal formées : jamais de plantage ni de détail interne', () => {
    const c = ctx();
    const a = register(c, 'Axel');
    for (const body of [undefined, null, 5, 'x', {}, { ticket: 1 }, { ticket: { id: 'a', sig: 'b', seed: 1.5, exp: 2 }, replay: {}, claimed: {}, client: {} }]) {
      const res = c.call('POST', '/api/runs', { token: a.auth, body, query: '' });
      expect([400, 422, 429]).toContain(res.status);
    }
    expect(c.call('GET', '/api/leaderboard', { query: 'balance=abc&limit=-3' }).status).toBe(200);
  });
});
