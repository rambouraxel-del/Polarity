import { DatabaseSync } from 'node:sqlite';

/**
 * Stockage persistant (SQLite, fichier sur disque). Les résultats sont séparés par version d'équilibrage (`balance`) :
 * les records des anciennes versions sont conservés et consultables, jamais mélangés aux nouveaux.
 */
export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  seed INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS tickets_player ON tickets(player_id, used_at);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  balance INTEGER NOT NULL,
  ticket_id TEXT NOT NULL UNIQUE,
  seed INTEGER NOT NULL,
  steps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  flips TEXT NOT NULL,
  client_build TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bests (
  player_id TEXT NOT NULL REFERENCES players(id),
  balance INTEGER NOT NULL,
  steps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, balance)
);
CREATE INDEX IF NOT EXISTS bests_rank ON bests(balance, steps DESC, score DESC, achieved_at ASC);
`;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Transaction : tout ou rien (sert à lier l'usage d'un ticket, la partie enregistrée et le meilleur résultat). */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
