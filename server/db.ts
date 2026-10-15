import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/**
 * Stockage persistant (SQLite, fichier sur disque). Les résultats sont séparés par version d'équilibrage (`balance`) :
 * les records des anciennes versions sont conservés et consultables, jamais mélangés aux nouveaux.
 *
 * Évolution du schéma : `PRAGMA user_version` + liste ordonnée de migrations (jamais modifiées après publication ; on en AJOUTE).
 * Au démarrage, une base plus ancienne est copiée (`<base>.avant-v<N>.bak`, VACUUM INTO) avant d'être migrée ; une base plus récente
 * que le code est REFUSÉE (retour arrière sans perte : on ne touche pas à un schéma inconnu).
 */
export type Db = DatabaseSync;

/** v1 : schéma d'origine (livraison initiale du classement). */
const V1 = `
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

/**
 * v2 : modération et signalements.
 * `players.moderation` : 0 = normal ; 1 = pseudo masqué par l'opérateur (renommé, non modifiable, classé) ; 2 = exclu (absent du classement, soumissions refusées).
 * `reports` : signalements de pseudos par des joueurs authentifiés (un par couple signalant/cible). `moderation_log` : journal des actions de l'opérateur.
 */
const V2 = `
ALTER TABLE players ADD COLUMN moderation INTEGER NOT NULL DEFAULT 0;
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_nickname TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  UNIQUE (reporter_id, target_id)
);
CREATE INDEX reports_open ON reports(handled_at, created_at);
CREATE TABLE moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  player_id TEXT,
  nickname TEXT,
  note TEXT
);
`;

/**
 * v3 : comptes et économie (économie v3).
 * - `players.guest` : pseudo non choisi par le joueur (profil invité, absent du classement public) ; `players.merged_into` : profil fusionné dans un autre (alias).
 * - `identities` : méthodes de connexion associées à un profil (google / apple / email), unique par (fournisseur, sujet).
 * - `sessions` : accès supplémentaires d'un profil (un secret par appareil, empreinte seule) ; le secret d'origine reste dans `players.token_hash`.
 * - `login_requests` : demandes de lien magique (code à usage unique, tentatives limitées) ; `auth_nonces` : nonces OIDC à usage unique (anti-rejeu).
 * - `saves` : sauvegarde de progression conservée par profil (révision) ; `installs` : installations connues et filigrane des gains acceptés.
 * - `ledger` : REGISTRE des opérations de monnaie (import, gains, dépenses, récompenses), idempotent par (joueur, clé) ; `merges` : registre des fusions.
 */
const V3 = `
ALTER TABLE players ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN merged_into TEXT;
CREATE TABLE identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, subject)
);
CREATE INDEX identities_player ON identities(player_id);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  revoked_at INTEGER
);
CREATE INDEX sessions_player ON sessions(player_id);
CREATE TABLE login_requests (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX login_requests_email ON login_requests(email_hash, created_at);
CREATE TABLE auth_nonces (
  nonce TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE saves (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  device TEXT
);
CREATE TABLE installs (
  install_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  earned INTEGER NOT NULL DEFAULT 0,
  bucket INTEGER NOT NULL DEFAULT 0,
  legacy_imported INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_sync INTEGER NOT NULL
);
CREATE INDEX installs_player ON installs(player_id);
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  currency TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  ref TEXT NOT NULL,
  at INTEGER NOT NULL,
  meta TEXT,
  UNIQUE (player_id, ref)
);
CREATE INDEX ledger_player ON ledger(player_id, currency);
CREATE TABLE merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_player TEXT NOT NULL,
  into_player TEXT NOT NULL,
  at INTEGER NOT NULL,
  summary TEXT
);
`;

/**
 * v4 : économie v3, phase 2 (Médailles, bonus). Additif : aucune donnée existante n'est modifiée.
 * - `installs.bonus_boost` / `installs.bonus_gel` : compteur monotone des charges de bonus déjà TRAITÉES (acceptées ou refusées) pour cette installation
 *   (même principe que le filigrane des gains : rejouer une requête ne crée rien).
 * - Le registre `ledger` accueille de nouvelles monnaies/articles dans sa colonne `currency` : « medals » (Médailles de succès, clé `medal:<succès>`),
 *   « boost » et « gel » (charges d'inventaire, clés `bonus:…`). Aucune colonne ni table à ajouter pour cela.
 */
const V4 = `
ALTER TABLE installs ADD COLUMN bonus_boost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE installs ADD COLUMN bonus_gel INTEGER NOT NULL DEFAULT 0;
`;

/**
 * v5 : économie v3, phase 3 — DEUX classements (sans bonus / avec bonus) et usage des charges de bonus. Additif et sans perte :
 * - `bests` reçoit la colonne `category` dans sa clé primaire : la table est reconstruite et TOUS les records existants sont copiés tels quels
 *   (joueur, version d'équilibrage, durée, score, partie, date) dans la catégorie `plain` (« sans bonus » : les anciennes parties n'avaient aucun
 *   pouvoir) ; le classement « avec bonus » commence vide. Aucun score n'est effacé ni attribué deux fois.
 * - `runs` : `category` (déduite du rejeu), `acts` (journal des activations, format de rejeu 2), `powers` (compteurs rejoués) et `replay_v`.
 * - `installs.used_boost` / `used_gel` : compteurs monotones de charges utilisées dans des parties NON validées par le service (usage déclaré).
 * Les charges utilisées dans une partie classée sont consommées par le rejeu lui-même (registre `ledger`, clé `use:<ticket>:<bonus>`).
 */
const V5 = `
CREATE TABLE bests_v5 (
  player_id TEXT NOT NULL REFERENCES players(id),
  balance INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'plain',
  steps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, balance, category)
);
INSERT INTO bests_v5 (player_id, balance, category, steps, score, run_id, achieved_at)
  SELECT player_id, balance, 'plain', steps, score, run_id, achieved_at FROM bests;
DROP TABLE bests;
ALTER TABLE bests_v5 RENAME TO bests;
CREATE INDEX bests_rank ON bests(balance, category, steps DESC, score DESC, achieved_at ASC);
ALTER TABLE runs ADD COLUMN category TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE runs ADD COLUMN acts TEXT;
ALTER TABLE runs ADD COLUMN powers TEXT;
ALTER TABLE runs ADD COLUMN replay_v INTEGER NOT NULL DEFAULT 1;
ALTER TABLE installs ADD COLUMN used_boost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE installs ADD COLUMN used_gel INTEGER NOT NULL DEFAULT 0;
`;

/**
 * Schéma v6 (phase 4 : récompenses gratuites), ADDITIF — aucune table existante n'est reconstruite, aucune donnée n'est modifiée :
 * - `loyalty_cycles` : cycles du calendrier de connexion (jours validés PAR LE SERVICE, UTC ; absences utilisées ; un seul cycle courant par profil) ;
 *   les récompenses réclamées sont des lignes du registre (`loy:<cycle>:<jour>`), le cycle y a un identifiant global (aucune collision à la fusion) ;
 * - `daily_attempts` (début de tentative enregistré par le service : preuve d'horaire), `daily_runs`, `daily_bests` (un record par joueur et par date),
 *   `daily_results` (Top 10 figé à la clôture, avec les Prismes), `daily_closed` (clôture faite : marqueur d'idempotence) ;
 * - `tickets.started_at` (partie de Survie démarrée EN LIGNE : condition du drop rare de Prismes) et `runs.drop_prisms`.
 */
const V6 = `
CREATE TABLE loyalty_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  started_day INTEGER NOT NULL,
  days INTEGER NOT NULL DEFAULT 0,
  absences INTEGER NOT NULL DEFAULT 0,
  last_day INTEGER NOT NULL,
  current INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX loyalty_player ON loyalty_cycles(player_id, current);
CREATE TABLE daily_attempts (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  date TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX daily_attempts_player ON daily_attempts(player_id, date);
CREATE TABLE daily_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  date TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  steps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  flips TEXT NOT NULL,
  client_build TEXT,
  created_at INTEGER NOT NULL,
  late INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX daily_runs_player ON daily_runs(player_id, date);
CREATE TABLE daily_bests (
  player_id TEXT NOT NULL REFERENCES players(id),
  date TEXT NOT NULL,
  steps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, date)
);
CREATE INDEX daily_bests_rank ON daily_bests(date, steps DESC, score DESC, achieved_at ASC);
CREATE TABLE daily_results (
  date TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  rank INTEGER NOT NULL,
  steps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  prisms INTEGER NOT NULL,
  notified_at INTEGER,
  PRIMARY KEY (date, player_id)
);
CREATE TABLE daily_closed (
  date TEXT PRIMARY KEY,
  closed_at INTEGER NOT NULL,
  rewarded INTEGER NOT NULL
);
ALTER TABLE tickets ADD COLUMN started_at INTEGER;
ALTER TABLE runs ADD COLUMN drop_prisms INTEGER NOT NULL DEFAULT 0;
`;

export const MIGRATIONS: readonly string[] = [V1, V2, V3, V4, V5, V6];
export const SCHEMA_VERSION = MIGRATIONS.length;

const userVersion = (db: Db): number => (db.prepare('PRAGMA user_version').get() as unknown as { user_version: number }).user_version;

/** Ouvre (et migre si besoin) la base. `:memory:` accepté pour les tests. */
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  // Verrou concurrent (sauvegarde ou CLI d'administration pendant que le service tourne) : attendre plutôt qu'échouer
  db.exec('PRAGMA busy_timeout = 5000;');
  // WAL + synchronous=NORMAL : sûr contre un arrêt brutal du processus ; au pire les dernières transactions d'une coupure de courant sont perdues, jamais la base
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA journal_size_limit = 67108864;');

  let v = userVersion(db);
  if (v === 0 && (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'players'").get() as unknown)) {
    // Base créée avant le versionnage : c'est le schéma v1
    db.exec('PRAGMA user_version = 1');
    v = 1;
  }
  if (v > SCHEMA_VERSION) {
    db.close();
    throw new Error(`Base de données de version ${v}, plus récente que ce service (version ${SCHEMA_VERSION}) : mettez le service à jour ; aucune donnée n'a été modifiée.`);
  }
  if (v > 0 && v < SCHEMA_VERSION && path !== ':memory:') {
    const bak = `${path}.avant-v${v}.bak`;
    if (!existsSync(bak)) db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
  }
  for (let i = v; i < SCHEMA_VERSION; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
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

/** Copie cohérente de la base en fonctionnement (VACUUM INTO : pas de verrou long, fichier autonome sans -wal/-shm). Refuse d'écraser. */
export function backupTo(db: Db, dest: string): void {
  if (existsSync(dest)) throw new Error(`Le fichier ${dest} existe déjà : choisissez un autre nom (aucune sauvegarde n'est écrasée).`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}

/** Contrôle d'intégrité : renvoie « ok » ou la liste des problèmes. */
export function integrityCheck(db: Db): string[] {
  const rows = db.prepare('PRAGMA integrity_check').all() as unknown as { integrity_check: string }[];
  const fk = db.prepare('PRAGMA foreign_key_check').all() as unknown as { table: string; rowid: number }[];
  const problems = rows.map((r) => r.integrity_check).filter((m) => m !== 'ok');
  for (const f of fk) problems.push(`clé étrangère invalide : table ${f.table}, ligne ${f.rowid}`);
  return problems;
}
