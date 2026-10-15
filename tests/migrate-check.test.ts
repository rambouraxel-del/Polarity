import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, SCHEMA_VERSION } from '../server/db';
import { checkMigration } from '../server/migrate-check';

/** Procédure de publication : la migration se contrôle sur une COPIE, l'original n'est jamais touché. */
function oldBase(version: number, dir: string): string {
  const path = join(dir, 'prod.sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  for (let i = 0; i < version; i++) db.exec(MIGRATIONS[i]);
  db.exec(`PRAGMA user_version = ${version}`);
  db.prepare("INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES ('p1', 'Axel', 'axel', 'h', 1)").run();
  db.prepare("INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES ('p1', 'shards', 'earn', 120, 'earn:x', 1)").run();
  db.close();
  return path;
}

describe('Contrôle de migration sur copie', () => {
  it('une base de version 3 est migrée sur la copie jusqu’au schéma actuel, sans perte, l’original reste intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-mc-'));
    try {
      const path = oldBase(3, dir);
      const sizeBefore = statSync(path).size;
      const r = checkMigration(path);
      expect(r).toMatchObject({ ok: true, from: 3, to: SCHEMA_VERSION, expected: SCHEMA_VERSION, lost: [], problems: [] });
      expect(r.tables.players).toBe(1);
      expect(r.tables.ledger).toBe(1);
      // L'original : même version, même taille, aucune copie .bak créée à côté
      const orig = new DatabaseSync(path, { readOnly: true });
      expect((orig.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
      orig.close();
      expect(statSync(path).size).toBe(sizeBefore);
      expect(existsSync(`${path}.avant-v3.bak`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('base déjà à jour : validée sans changement ; --keep conserve la copie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-mc-'));
    try {
      const path = oldBase(SCHEMA_VERSION, dir);
      const r = checkMigration(path, { keep: true });
      expect(r).toMatchObject({ ok: true, from: SCHEMA_VERSION, to: SCHEMA_VERSION });
      expect(r.kept && existsSync(r.kept)).toBe(true);
      rmSync(r.kept!.replace(/copie\.sqlite$/, ''), { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refus : fichier absent, base plus récente que le code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polar-rift-mc-'));
    try {
      expect(() => checkMigration(join(dir, 'absent.sqlite'))).toThrow(/introuvable/);
      const path = oldBase(SCHEMA_VERSION, dir);
      const db = new DatabaseSync(path);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      db.close();
      expect(() => checkMigration(path)).toThrow(/plus récente/);
      writeFileSync(join(dir, 'x'), '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
