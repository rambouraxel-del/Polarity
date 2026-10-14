import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { backupTo, integrityCheck, openDb, transaction, type Db } from './db';
import { maskedNickname } from './moderation';

/**
 * Outil d'administration du classement — EN LIGNE DE COMMANDE, à lancer sur la machine qui héberge la base (il n'existe aucune route HTTP
 * d'administration : sans accès à la machine, personne ne peut modérer ni supprimer). Toute action destructrice est SIMULÉE par défaut ;
 * elle n'est appliquée qu'avec --yes. Aucune purge automatique : rien n'est supprimé sans commande explicite de l'opérateur.
 *
 *   npm run server:admin -- stats
 *   npm run server:admin -- reports [--all]
 *   npm run server:admin -- hide <pseudo|id>            masque un pseudo offensant (remplacé par « Joueur-xxxxxx », non modifiable)
 *   npm run server:admin -- ban <pseudo|id>             retire du classement et refuse les nouvelles parties
 *   npm run server:admin -- unban <pseudo|id>
 *   npm run server:admin -- export <pseudo|id>          données liées à un profil (demande d'accès)
 *   npm run server:admin -- delete-player <pseudo|id> [--yes]   suppression complète d'un profil et de ses données
 *   npm run server:admin -- backup <fichier>            copie cohérente de la base (refuse d'écraser)
 *   npm run server:admin -- check                       contrôle d'intégrité
 *   npm run server:admin -- prune --older-than-days N [--yes]   tickets périmés non utilisés et journaux de parties anciennes (hors records)
 */

const DAY_MS = 86_400_000;

interface PlayerRow {
  id: string;
  nickname: string;
  moderation: number;
  created_at: number;
}

const iso = (ms: number | null | undefined): string => (ms ? new Date(ms).toISOString() : '—');
const one = (db: Db, sql: string, ...p: (string | number)[]): Record<string, unknown> => (db.prepare(sql).get(...p) ?? {}) as Record<string, unknown>;

function findPlayer(db: Db, ref: string | undefined): PlayerRow {
  if (!ref) throw new Error('Indiquez un pseudo ou un identifiant de joueur.');
  const row = (db.prepare('SELECT id, nickname, moderation, created_at FROM players WHERE id = ? OR nickname_key = ?').get(ref, ref.toLowerCase()) ??
    db.prepare('SELECT id, nickname, moderation, created_at FROM players WHERE lower(nickname) = ?').get(ref.toLowerCase())) as unknown as PlayerRow | undefined;
  if (!row) throw new Error(`Joueur introuvable : « ${ref} ».`);
  return row;
}

const log = (db: Db, action: string, p: PlayerRow | null, note: string | null): void => {
  db.prepare('INSERT INTO moderation_log (at, action, player_id, nickname, note) VALUES (?, ?, ?, ?, ?)').run(Date.now(), action, p?.id ?? null, p?.nickname ?? null, note);
};

function setModeration(db: Db, p: PlayerRow, level: number, action: string): void {
  transaction(db, () => {
    db.prepare('UPDATE players SET moderation = ? WHERE id = ?').run(level, p.id);
    log(db, action, p, null);
  });
}

/** Exécute une commande ; renvoie les lignes à afficher. Exception = message d'erreur pour l'opérateur. */
export function runAdmin(db: Db, args: string[], now: () => number = Date.now): string[] {
  const [cmd, ...rest] = args;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const pos = rest.filter((a) => !a.startsWith('--'));
  const yes = flags.has('--yes');

  switch (cmd) {
    case 'stats': {
      const n = (sql: string): number => Number(one(db, sql).n ?? 0);
      return [
        `Joueurs : ${n('SELECT COUNT(*) AS n FROM players')} (masqués : ${n('SELECT COUNT(*) AS n FROM players WHERE moderation = 1')}, exclus : ${n('SELECT COUNT(*) AS n FROM players WHERE moderation = 2')})`,
        `Parties enregistrées : ${n('SELECT COUNT(*) AS n FROM runs')} (journaux d'entrées : ${Math.round(n('SELECT COALESCE(SUM(LENGTH(flips)), 0) AS n FROM runs') / 1024)} Ko)`,
        `Records : ${n('SELECT COUNT(*) AS n FROM bests')} ; versions d'équilibrage : ${n('SELECT COUNT(DISTINCT balance) AS n FROM bests')}`,
        `Tickets : ${n('SELECT COUNT(*) AS n FROM tickets')} (non utilisés : ${n('SELECT COUNT(*) AS n FROM tickets WHERE used_at IS NULL')})`,
        `Signalements ouverts : ${n('SELECT COUNT(*) AS n FROM reports WHERE handled_at IS NULL')}`,
      ];
    }
    case 'check': {
      const problems = integrityCheck(db);
      return problems.length === 0 ? ['Base intègre : aucun problème.'] : ['PROBLÈMES DÉTECTÉS :', ...problems];
    }
    case 'backup': {
      const dest = pos[0];
      if (!dest) throw new Error('Indiquez le fichier de destination.');
      mkdirSync(dirname(dest), { recursive: true });
      backupTo(db, dest);
      return [`Sauvegarde écrite : ${dest} (${Math.round(statSync(dest).size / 1024)} Ko). Conservez-la hors de la machine.`];
    }
    case 'reports': {
      const rows = db
        .prepare(`SELECT target_id, target_nickname, COUNT(*) AS n, MAX(created_at) AS last, GROUP_CONCAT(reason, ' | ') AS reasons FROM reports ${flags.has('--all') ? '' : 'WHERE handled_at IS NULL'} GROUP BY target_id ORDER BY n DESC, last DESC LIMIT 100`)
        .all() as unknown as { target_id: string; target_nickname: string; n: number; last: number; reasons: string }[];
      if (rows.length === 0) return ['Aucun signalement.'];
      return rows.map((r) => `${r.n} × « ${r.target_nickname} » (${r.target_id}) — dernier : ${iso(r.last)} — motifs : ${r.reasons}`);
    }
    case 'hide': {
      const p = findPlayer(db, pos[0]);
      const masked = maskedNickname(p.id);
      transaction(db, () => {
        db.prepare('UPDATE players SET nickname = ?, nickname_key = ?, moderation = MAX(moderation, 1) WHERE id = ?').run(masked, masked.toLowerCase(), p.id);
        db.prepare('UPDATE reports SET handled_at = ? WHERE target_id = ? AND handled_at IS NULL').run(now(), p.id);
        log(db, 'pseudo_masque', p, `remplacé par ${masked}`);
      });
      return [`Pseudo « ${p.nickname} » remplacé par « ${masked} » (le joueur ne peut plus le modifier). Signalements correspondants clos.`];
    }
    case 'ban': {
      const p = findPlayer(db, pos[0]);
      setModeration(db, p, 2, 'exclusion');
      return [`« ${p.nickname} » exclu : absent du classement, nouvelles parties refusées. Ses données sont conservées (annulable : unban).`];
    }
    case 'unban': {
      const p = findPlayer(db, pos[0]);
      setModeration(db, p, p.nickname === maskedNickname(p.id) ? 1 : 0, 'levee_exclusion');
      return [`« ${p.nickname} » de nouveau classé.`];
    }
    case 'export': {
      const p = findPlayer(db, pos[0]);
      const data = {
        profil: { id: p.id, pseudo: p.nickname, moderation: p.moderation, cree_le: iso(p.created_at) },
        records: db.prepare('SELECT balance, steps, score, achieved_at FROM bests WHERE player_id = ?').all(p.id),
        parties: db.prepare('SELECT id, balance, seed, steps, score, client_build, created_at FROM runs WHERE player_id = ? ORDER BY id').all(p.id),
        signalements_emis: db.prepare('SELECT target_nickname, reason, created_at FROM reports WHERE reporter_id = ?').all(p.id),
        signalements_recus: db.prepare('SELECT reason, created_at FROM reports WHERE target_id = ?').all(p.id),
      };
      return [JSON.stringify(data, null, 2)];
    }
    case 'delete-player': {
      const p = findPlayer(db, pos[0]);
      const counts = {
        parties: Number(one(db, 'SELECT COUNT(*) AS n FROM runs WHERE player_id = ?', p.id).n),
        records: Number(one(db, 'SELECT COUNT(*) AS n FROM bests WHERE player_id = ?', p.id).n),
        tickets: Number(one(db, 'SELECT COUNT(*) AS n FROM tickets WHERE player_id = ?', p.id).n),
      };
      const what = `« ${p.nickname} » (${p.id}) : ${counts.parties} parties, ${counts.records} records, ${counts.tickets} tickets, signalements liés`;
      if (!yes) return [`SIMULATION — serait supprimé : ${what}.`, 'Relancez avec --yes pour appliquer (irréversible : faites d’abord « backup »).'];
      transaction(db, () => {
        db.prepare('DELETE FROM tickets WHERE player_id = ?').run(p.id);
        db.prepare('DELETE FROM bests WHERE player_id = ?').run(p.id);
        db.prepare('DELETE FROM runs WHERE player_id = ?').run(p.id);
        db.prepare('DELETE FROM reports WHERE reporter_id = ? OR target_id = ?').run(p.id, p.id);
        db.prepare('DELETE FROM players WHERE id = ?').run(p.id);
        log(db, 'suppression_par_operateur', null, `profil supprimé (${counts.parties} parties)`);
      });
      return [`Supprimé : ${what}.`];
    }
    case 'prune': {
      const i = rest.indexOf('--older-than-days');
      const days = i >= 0 ? Number(rest[i + 1]) : NaN;
      if (!Number.isFinite(days) || days < 30) throw new Error('Indiquez --older-than-days N avec N ≥ 30 (jours).');
      const cutoff = now() - days * DAY_MS;
      const tix = Number(one(db, 'SELECT COUNT(*) AS n FROM tickets WHERE used_at IS NULL AND exp * 1000 < ?', cutoff).n);
      // Les journaux des parties qui sont des records en cours sont toujours conservés (preuve de chaque classement affiché)
      const runs = Number(one(db, 'SELECT COUNT(*) AS n FROM runs WHERE created_at < ? AND id NOT IN (SELECT run_id FROM bests)', cutoff).n);
      const line = `tickets périmés non utilisés : ${tix} ; parties anciennes hors records : ${runs} (plus de ${days} jours)`;
      if (!yes) return [`SIMULATION — serait supprimé : ${line}.`, 'Relancez avec --yes pour appliquer (irréversible : faites d’abord « backup »).'];
      transaction(db, () => {
        db.prepare('DELETE FROM tickets WHERE used_at IS NULL AND exp * 1000 < ?').run(cutoff);
        db.prepare('DELETE FROM runs WHERE created_at < ? AND id NOT IN (SELECT run_id FROM bests)').run(cutoff);
        log(db, 'purge', null, line);
      });
      return [`Supprimé : ${line}. Pour récupérer l'espace disque : « backup » puis remplacement du fichier (voir le guide).`];
    }
    default:
      return [
        'Commandes : stats | check | backup <fichier> | reports [--all] | hide <joueur> | ban <joueur> | unban <joueur> | export <joueur> | delete-player <joueur> [--yes] | prune --older-than-days N [--yes]',
        '<joueur> = pseudo exact ou identifiant. Les commandes destructrices sont simulées sans --yes.',
      ];
  }
}

// Exécution directe (npm run server:admin -- …)
if (process.argv[1] && /admin\.(ts|js)$/.test(process.argv[1])) {
  const dbPath = process.env.DATABASE_PATH ?? './data/leaderboard.sqlite';
  try {
    if (dbPath !== ':memory:' && !existsSync(dbPath)) throw new Error(`Base introuvable : ${dbPath} (variable DATABASE_PATH). Aucun fichier n'a été créé.`);
    const db = openDb(dbPath);
    try {
      for (const line of runAdmin(db, process.argv.slice(2))) console.log(line);
    } finally {
      db.close();
    }
  } catch (e) {
    console.error(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
