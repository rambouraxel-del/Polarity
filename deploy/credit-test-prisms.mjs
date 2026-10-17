// Crédite 200 Prismes à UN profil de TEST (variable TEST_PLAYER_ID), pour vérifier l'achat en Prismes. Les Prismes ne se créent jamais par l'API : c'est
// voulu, donc cette écriture directe dans le registre se fait sur la machine du service. À utiliser avec deploy/verifier-service.mjs (qui supprime ensuite
// le profil de test). Idempotent (clé unique). Ne touche à aucun autre profil.
//   docker compose exec -T -e TEST_PLAYER_ID classement node --input-type=module < credit-test-prisms.mjs
import { DatabaseSync } from 'node:sqlite';
const id = process.env.TEST_PLAYER_ID ?? '';
if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error('TEST_PLAYER_ID manquant ou invalide');
const db = new DatabaseSync(process.env.DB ?? '/data/leaderboard.sqlite');
db.exec('PRAGMA busy_timeout = 5000');
const p = db.prepare('SELECT nickname FROM players WHERE id = ?').get(id);
if (!p || !/^Joueur-/.test(String(p.nickname))) throw new Error('Ce profil n’est pas un profil invité de test : refusé');
db.prepare("INSERT OR IGNORE INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, 'prisms', 'test', 200, ?, ?)").run(id, `test:verif:${id}`, Date.now());
console.log('200 Prismes de test crédités à', id);
