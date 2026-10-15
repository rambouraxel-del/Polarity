import { transaction, type Db } from './db';

export interface Balances {
  shards: number;
  medals: number;
  prisms: number;
}

function sums(db: Db, playerId: string): Map<string, number> {
  const rows = db.prepare('SELECT currency, COALESCE(SUM(amount), 0) AS total FROM ledger WHERE player_id = ? GROUP BY currency').all(playerId) as unknown as { currency: string; total: number }[];
  return new Map(rows.map((r) => [r.currency, Math.max(0, Number(r.total))]));
}

/**
 * Soldes d'un profil : somme du registre (`ledger`). Les Médailles et les Prismes ne proviennent QUE de lignes écrites par le serveur
 * (jamais d'une valeur annoncée par le client).
 */
export function balancesOf(db: Db, playerId: string): Balances {
  const m = sums(db, playerId);
  return { shards: m.get('shards') ?? 0, medals: m.get('medals') ?? 0, prisms: m.get('prisms') ?? 0 };
}

/** Charges de bonus possédées : somme du registre (achats + éventuelles consommations de la phase 3). */
export function inventoryOf(db: Db, playerId: string): { boost: number; gel: number } {
  const m = sums(db, playerId);
  return { boost: m.get('boost') ?? 0, gel: m.get('gel') ?? 0 };
}

/** Succès dont les Médailles ont été créditées (clés `medal:<identifiant>` du registre). */
export function claimedMedals(db: Db, playerId: string): string[] {
  const rows = db.prepare("SELECT ref FROM ledger WHERE player_id = ? AND currency = 'medals' AND ref LIKE 'medal:%' ORDER BY id").all(playerId) as unknown as { ref: string }[];
  return rows.map((r) => r.ref.slice('medal:'.length));
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
        'DELETE FROM loyalty_cycles WHERE player_id = ?',
        'DELETE FROM daily_attempts WHERE player_id = ?',
        'DELETE FROM daily_runs WHERE player_id = ?',
        'DELETE FROM daily_bests WHERE player_id = ?',
        'DELETE FROM daily_results WHERE player_id = ?',
        'DELETE FROM ad_sessions WHERE player_id = ?',
        'DELETE FROM payment_debts WHERE player_id = ?',
        // Justificatifs de paiement : conservés SANS donnée personnelle (le justificatif reste « utilisé » : il ne peut pas être rejoué sur un autre profil)
        'UPDATE payments SET player_id = NULL WHERE player_id = ?',
        'UPDATE payment_events SET player_id = NULL WHERE player_id = ?',
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
