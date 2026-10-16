import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BALANCE_VERSION } from '../src/config/version';
import type { RegisterResponse } from '../src/net/protocol';
import { createApp, type HttpRequest, type HttpResponse } from '../server/app';
import { runAdmin } from '../server/admin';
import { RESET_CONFIRMATION, planReset } from '../server/boards';
import { openDb, type Db } from '../server/db';

const dir = mkdtempSync(join(tmpdir(), 'polarity-reset-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ADMIN = 'autorisation-admin-dediee-pour-les-tests-0123456789';

function setup(withAdmin = true): { db: Db; call: (token: string | undefined, body: unknown, ip?: string) => HttpResponse; backupDir: string; pid: string } {
  const backupDir = mkdtempSync(join(dir, 'sauv-'));
  const db = openDb(join(backupDir, '..', `base-${Math.random().toString(36).slice(2)}.sqlite`));
  const app = createApp(db, { ticketSecret: 'secret-de-test-pour-les-tickets-0123456789', now: () => 1_700_000_000_000, admin: withAdmin ? { resetSecret: ADMIN, backupDir } : undefined });
  const reg = app({ method: 'POST', path: '/api/register', query: new URLSearchParams(), headers: {}, body: { nickname: 'Testeur' }, ip: '10.0.0.9' } as HttpRequest);
  const pid = (reg.body as RegisterResponse).playerId;
  const ins = db.prepare('INSERT INTO bests (player_id, balance, category, steps, score, run_id, achieved_at) VALUES (?, ?, ?, ?, ?, 1, 1)');
  ins.run(pid, BALANCE_VERSION, 'plain', 5000, 100);
  ins.run(pid, BALANCE_VERSION, 'bonus', 6000, 200);
  ins.run(pid, BALANCE_VERSION - 1, 'plain', 7000, 300); // version archivée
  const dd = db.prepare('INSERT INTO daily_bests (player_id, date, steps, score, run_id, achieved_at) VALUES (?, ?, 4000, 50, 1, 1)');
  dd.run(pid, '2026-10-10'); // clos
  dd.run(pid, '2026-10-16'); // en cours
  db.prepare('INSERT INTO daily_closed (date, closed_at, rewarded) VALUES (?, 1, 1)').run('2026-10-10');
  db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at, meta) VALUES (?, 'prisms', 'drop', 5, 'x', 1, NULL)").run(pid);
  const call = (token: string | undefined, body: unknown, ip = '10.0.0.1'): HttpResponse => app({ method: 'POST', path: '/api/admin/reset-board', query: new URLSearchParams(), headers: { authorization: token ? `Bearer ${token}` : undefined }, body, ip } as HttpRequest);
  return { db, call, backupDir, pid };
}
const n = (db: Db, sql: string): number => (db.prepare(sql).get() as unknown as { n: number }).n;

describe('remise à zéro d’un classement : autorisation administrateur dédiée', () => {
  it('route désactivée sans autorisation configurée (service non mis à jour ou non configuré)', () => {
    const s = setup(false);
    expect(s.call(ADMIN, { board: 'plain', confirm: RESET_CONFIRMATION }).status).toBe(404);
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM bests')).toBe(3);
  });

  it('refusée sans autorisation, avec un jeton de joueur, ou avec une valeur proche : rien n’est effacé', () => {
    const s = setup();
    for (const t of [undefined, 'faux', `${s.pid}.jeton-de-joueur`, ADMIN.slice(0, -1), 'Dev!2026']) {
      const r = s.call(t, { board: 'plain', confirm: RESET_CONFIRMATION });
      expect(r.status, String(t)).toBe(403);
    }
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM bests')).toBe(3);
    expect(n(s.db, "SELECT COUNT(*) AS n FROM moderation_log WHERE action = 'remise_a_zero_refusee'")).toBe(5);
    expect(readdirSync(s.backupDir)).toEqual([]);
  });

  it('confirmation écrite et classement valides exigés', () => {
    const s = setup();
    expect(s.call(ADMIN, { board: 'plain' }).status).toBe(400);
    expect(s.call(ADMIN, { board: 'plain', confirm: 'oui' }).status).toBe(400);
    expect(s.call(ADMIN, { board: 'tout', confirm: RESET_CONFIRMATION }).status).toBe(400);
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM bests')).toBe(3);
  });

  it('Sans bonus : seuls les records de la version actuelle sont effacés, après une sauvegarde lisible ; profils et monnaies intacts', () => {
    const s = setup();
    const r = s.call(ADMIN, { board: 'plain', confirm: RESET_CONFIRMATION });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const body = r.body as { removed: number; backup: string };
    expect(body.removed).toBe(1);
    expect(n(s.db, "SELECT COUNT(*) AS n FROM bests WHERE category = 'plain' AND balance = " + BALANCE_VERSION)).toBe(0);
    expect(n(s.db, "SELECT COUNT(*) AS n FROM bests WHERE category = 'bonus'")).toBe(1);
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM bests WHERE balance = ' + (BALANCE_VERSION - 1))).toBe(1); // archive conservée
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM players')).toBe(1);
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM ledger')).toBe(1);
    // La sauvegarde contient encore les records effacés
    const file = join(s.backupDir, body.backup);
    expect(existsSync(file)).toBe(true);
    const copy = openDb(file);
    expect(n(copy, 'SELECT COUNT(*) AS n FROM bests')).toBe(3);
    copy.close();
    expect(n(s.db, "SELECT COUNT(*) AS n FROM moderation_log WHERE action = 'remise_a_zero'")).toBe(1);
  });

  it('Avec bonus et Défi quotidien : portée distincte, défis clos (Prismes crédités) préservés', () => {
    const s = setup();
    expect(s.call(ADMIN, { board: 'bonus', confirm: RESET_CONFIRMATION }).status).toBe(200);
    expect(n(s.db, "SELECT COUNT(*) AS n FROM bests WHERE category = 'bonus'")).toBe(0);
    expect(n(s.db, "SELECT COUNT(*) AS n FROM bests WHERE category = 'plain'")).toBe(2);
    expect(planReset(s.db, 'daily', BALANCE_VERSION).rows).toBe(1);
    const d = s.call(ADMIN, { board: 'daily', confirm: RESET_CONFIRMATION });
    expect((d.body as { removed: number }).removed).toBe(1);
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM daily_bests')).toBe(1);
    expect(n(s.db, "SELECT COUNT(*) AS n FROM daily_bests WHERE date = '2026-10-10'")).toBe(1);
  });

  it('tentatives limitées (force brute)', () => {
    const s = setup();
    let last = 0;
    for (let i = 0; i < 8; i++) last = s.call('x'.repeat(40), { board: 'plain', confirm: RESET_CONFIRMATION }, '10.9.9.9').status;
    expect(last).toBe(429);
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM bests')).toBe(3);
  });

  it('autorisation trop courte refusée au démarrage', () => {
    const db = openDb(':memory:');
    expect(() => createApp(db, { ticketSecret: 'secret-de-test-pour-les-tickets-0123456789', admin: { resetSecret: 'court', backupDir: dir } })).toThrow();
  });

  it('ligne de commande : simulation par défaut, application avec --yes et sauvegarde préalable', () => {
    const s = setup();
    const sim = runAdmin(s.db, ['reset-board', 'plain']);
    expect(sim[0]).toContain('SIMULATION');
    expect(n(s.db, 'SELECT COUNT(*) AS n FROM bests')).toBe(3);
    expect(() => runAdmin(s.db, ['reset-board', 'plain', '--yes'])).toThrow();
    const out = runAdmin(s.db, ['reset-board', 'plain', s.backupDir, '--yes']);
    expect(out[0]).toContain('remis à zéro');
    expect(n(s.db, "SELECT COUNT(*) AS n FROM bests WHERE category = 'plain' AND balance = " + BALANCE_VERSION)).toBe(0);
    expect(readdirSync(s.backupDir).length).toBe(1);
  });
});
