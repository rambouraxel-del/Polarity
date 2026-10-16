import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { backupTo, transaction, type Db } from './db';

/**
 * Remise à zéro d'un CLASSEMENT (jamais des profils, monnaies, achats, cosmétiques ni du registre) — opération d'administration, uniquement :
 * - par la commande `npm run server:admin -- reset-board …` sur la machine du service, ou
 * - par la route `POST /api/admin/reset-board`, qui exige une autorisation administrateur DÉDIÉE (`ADMIN_RESET_SECRET`, vérifiée côté service ;
 *   absente = route désactivée) : le mot de passe du mode développeur du navigateur n'ouvre jamais cette route.
 * Une copie cohérente de toute la base est écrite AVANT l'effacement ; si elle échoue, rien n'est effacé. L'opération est journalisée.
 *
 * Portée :
 * - `plain` / `bonus` : les records (`bests`) de la version d'équilibrage courante pour cette catégorie ; les versions archivées ne sont pas touchées ;
 * - `daily` : les classements des défis quotidiens NON clos (ceux dont les Prismes n'ont pas encore été crédités) ; les défis clos restent intacts.
 * Les parties validées (`runs`) et leurs journaux sont conservés (archive).
 */
export type Board = 'plain' | 'bonus' | 'daily';
export const BOARDS: readonly Board[] = ['plain', 'bonus', 'daily'];
export const isBoard = (x: unknown): x is Board => typeof x === 'string' && (BOARDS as readonly string[]).includes(x);

/** Phrase de confirmation exigée (interface et service). */
export const RESET_CONFIRMATION = 'REMETTRE À ZÉRO';

export interface ResetPlan {
  board: Board;
  /** Lignes de classement qui seraient effacées. */
  rows: number;
}

export interface ResetResult extends ResetPlan {
  /** Nom du fichier de sauvegarde écrit avant l'effacement (dans le dossier de sauvegardes). */
  backup: string;
}

export function planReset(db: Db, board: Board, balance: number): ResetPlan {
  const n =
    board === 'daily'
      ? (db.prepare('SELECT COUNT(*) AS n FROM daily_bests WHERE date NOT IN (SELECT date FROM daily_closed)').get() as unknown as { n: number }).n
      : (db.prepare('SELECT COUNT(*) AS n FROM bests WHERE balance = ? AND category = ?').get(balance, board) as unknown as { n: number }).n;
  return { board, rows: n };
}

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[:.]/g, '-');

export function resetBoard(db: Db, opts: { board: Board; balance: number; backupDir: string; now: () => number; source: string }): ResetResult {
  const at = opts.now();
  mkdirSync(opts.backupDir, { recursive: true });
  const backup = `avant-remise-a-zero-${opts.board}-${stamp(at)}.sqlite`;
  // 1. Sauvegarde cohérente de toute la base : échec = aucune suppression
  backupTo(db, join(opts.backupDir, backup));
  // 2. Effacement + journal, dans une seule transaction
  return transaction(db, () => {
    const plan = planReset(db, opts.board, opts.balance);
    if (opts.board === 'daily') db.prepare('DELETE FROM daily_bests WHERE date NOT IN (SELECT date FROM daily_closed)').run();
    else db.prepare('DELETE FROM bests WHERE balance = ? AND category = ?').run(opts.balance, opts.board);
    db.prepare('INSERT INTO moderation_log (at, action, player_id, nickname, note) VALUES (?, ?, NULL, NULL, ?)').run(at, 'remise_a_zero', `${opts.board} · ${plan.rows} lignes · ${opts.source} · ${backup}`);
    return { ...plan, backup };
  });
}
