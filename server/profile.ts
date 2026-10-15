import { transaction, type Db } from './db';

/** Soldes d'un profil : somme du registre (`ledger`). Les Prismes ne proviennent QUE de lignes écrites par le serveur (jamais d'une donnée du client). */
export function balancesOf(db: Db, playerId: string): { shards: number; prisms: number } {
  const rows = db.prepare('SELECT currency, COALESCE(SUM(amount), 0) AS total FROM ledger WHERE player_id = ? GROUP BY currency').all(playerId) as unknown as { currency: string; total: number }[];
  const get = (c: string): number => Math.max(0, Number(rows.find((r) => r.currency === c)?.total ?? 0));
  return { shards: get('shards'), prisms: get('prisms') };
}

/** Pseudo de profil invité : « Joueur-xxxxxx » (dérivé de l'identifiant ; allongé en cas de collision). */
export function guestNickname(playerId: string, attempt = 0): string {
  return `Joueur-${playerId.replace(/-/g, '').slice(0, 6 + attempt * 2)}`;
}

/**
 * Suppression complète d'un profil et de TOUTES ses données (RGPD) : pseudo, accès, méthodes de connexion, sauvegarde, installations, registre,
 * parties et journaux, records, signalements, alias de fusion. Une seule transaction. Renvoie vrai si le profil existait.
 * Aucune trace nominative n'est conservée (le registre des fusions garde seulement des identifiants supprimés).
 */
export function eraseProfile(db: Db, playerId: string): boolean {
  return transaction(db, () => {
    const exists = db.prepare('SELECT 1 AS x FROM players WHERE id = ?').get(playerId);
    if (!exists) return false;
    const aliases = (db.prepare('SELECT id FROM players WHERE merged_into = ?').all(playerId) as unknown as { id: string }[]).map((r) => r.id);
    for (const id of [playerId, ...aliases]) {
      for (const sql of [
        'DELETE FROM tickets WHERE player_id = ?',
        'DELETE FROM bests WHERE player_id = ?',
        'DELETE FROM runs WHERE player_id = ?',
        'DELETE FROM identities WHERE player_id = ?',
        'DELETE FROM sessions WHERE player_id = ?',
        'DELETE FROM saves WHERE player_id = ?',
        'DELETE FROM installs WHERE player_id = ?',
        'DELETE FROM ledger WHERE player_id = ?',
      ]) {
        db.prepare(sql).run(id);
      }
      db.prepare('DELETE FROM reports WHERE reporter_id = ? OR target_id = ?').run(id, id);
      db.prepare('DELETE FROM merges WHERE from_player = ? OR into_player = ?').run(id, id);
    }
    for (const id of aliases) db.prepare('DELETE FROM players WHERE id = ?').run(id);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
    return true;
  });
}
