import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, integrityCheck, openDb } from './db';

/**
 * Contrôle d'une migration SUR UNE COPIE (jamais sur l'original) : `npm run server:migrate-check -- <fichier de base ou sauvegarde>`.
 *
 * 1. L'original n'est PAS modifié : copie cohérente par `VACUUM INTO` depuis une ouverture en lecture seule (fichier autonome, sans -wal/-shm) ;
 *    si l'original ne peut pas être ouvert ainsi (ex. sauvegarde déjà autonome), il est copié tel quel.
 * 2. La copie est migrée par le même code que le service (`openDb`, migrations additives) ;
 * 3. Contrôles : intégrité, versions avant/après, et AUCUNE ligne perdue dans les tables préexistantes (comptage avant/après) ;
 * 4. La copie est supprimée (sauf --keep). Code de sortie non nul au moindre écart.
 */
export interface MigrationReport {
  ok: boolean;
  from: number;
  to: number;
  expected: number;
  /** Tables préexistantes dont le nombre de lignes a changé (doit rester vide). */
  lost: string[];
  /** Nombre de lignes par table préexistante. */
  tables: Record<string, number>;
  problems: string[];
  /** Chemin de la copie conservée (--keep). */
  kept?: string;
}

const userVersion = (db: DatabaseSync): number => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);

function counts(db: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as { name: string }[];
  for (const t of tables) out[t.name] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`).get() as { n: number }).n);
  return out;
}

export function checkMigration(source: string, opts: { keep?: boolean } = {}): MigrationReport {
  if (!existsSync(source)) throw new Error(`Fichier introuvable : ${source} (aucun fichier n'a été créé ni modifié).`);
  const work = mkdtempSync(join(tmpdir(), 'polar-rift-migration-'));
  const copy = join(work, 'copie.sqlite');
  const problems: string[] = [];
  try {
    // Copie : jamais d'écriture sur l'original
    try {
      const ro = new DatabaseSync(source, { readOnly: true });
      try {
        ro.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
      } finally {
        ro.close();
      }
    } catch {
      copyFileSync(source, copy);
    }
    const before = new DatabaseSync(copy);
    const from = userVersion(before);
    const tablesBefore = counts(before);
    before.close();
    if (from > SCHEMA_VERSION) throw new Error(`Base en version ${from}, plus récente que ce code (version ${SCHEMA_VERSION}) : cette migration est impossible avec ce code.`);
    const db = openDb(copy);
    let to = 0;
    let tablesAfter: Record<string, number> = {};
    try {
      to = userVersion(db);
      tablesAfter = counts(db);
      for (const p of integrityCheck(db)) problems.push(p);
    } finally {
      db.close();
    }
    const lost = Object.keys(tablesBefore).filter((t) => tablesAfter[t] !== tablesBefore[t]);
    if (to !== SCHEMA_VERSION) problems.push(`version finale ${to}, attendue ${SCHEMA_VERSION}`);
    if (lost.length > 0) problems.push(`lignes différentes après migration : ${lost.join(', ')}`);
    const report: MigrationReport = { ok: problems.length === 0, from, to, expected: SCHEMA_VERSION, lost, tables: tablesBefore, problems };
    if (opts.keep) report.kept = copy;
    return report;
  } finally {
    if (!opts.keep) rmSync(work, { recursive: true, force: true });
  }
}

// Exécution directe (npm run server:migrate-check -- <fichier> [--keep])
if (process.argv[1] && /migrate-check\.(ts|js)$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  try {
    if (!file) throw new Error('Indiquez le fichier de base (ou de sauvegarde) à contrôler.');
    const r = checkMigration(file, { keep: args.includes('--keep') });
    const size = Math.round(statSync(file).size / 1024);
    console.log(`Original : ${file} (${size} Ko), version ${r.from} → copie migrée en version ${r.to} (attendue : ${r.expected}).`);
    console.log(`Tables préexistantes : ${Object.entries(r.tables).map(([t, n]) => `${t}=${n}`).join(', ') || 'aucune'}`);
    if (r.kept) console.log(`Copie conservée : ${r.kept}`);
    if (r.ok) console.log('MIGRATION VALIDÉE sur la copie : intégrité OK, aucune ligne perdue. L’original n’a pas été modifié.');
    else {
      console.error(`MIGRATION REFUSÉE : ${r.problems.join(' ; ')}`);
      process.exit(2);
    }
  } catch (e) {
    console.error(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
