#!/usr/bin/env node
// Vérification manuelle (≈ 1 minute) du service après une mise à jour « refonte cosmétique ». Aucune dépendance : Node 22, fetch.
//
//   node deploy/verifier-service.mjs --url https://classement.mon-domaine.fr [--old-account <idJoueur.secret>] [--credit-prisms "<commande>"] [--restart "<commande>"]
//
// - crée un profil invité de TEST, le vérifie, puis le SUPPRIME (DELETE /api/me) : aucun profil réel n'est touché ;
// - --old-account : « idJoueur.secret » d'un VRAI ancien compte (le secret est dans la sauvegarde du jeu) ; seulement lu/synchronisé, jamais modifié ;
// - --credit-prisms : commande shell qui crédite 200 Prismes au profil de test (l'identifiant est passé dans la variable d'environnement TEST_PLAYER_ID) ;
//   les Prismes ne se créent jamais par l'API (c'est voulu) : sur la machine du service, voir docs/PUBLICATION_BETA.md § 9 ter ;
// - --restart : commande qui relance le service (ex. « docker compose restart classement ») pour contrôler la persistance.
// Sortie : une ligne ✔ / ✘ par contrôle ; code de sortie 1 s'il y a un échec.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = (arg('url') ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage : node deploy/verifier-service.mjs --url https://… [--old-account id.secret] [--credit-prisms "cmd"] [--restart "cmd"]');
  process.exit(2);
}
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
};
async function api(method, path, { auth, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  return { status: res.status, data };
}
const bal = async (auth) => (await api('GET', '/api/profile', { auth })).data?.balance;
const sync = (auth, installId, o = {}) =>
  api('POST', '/api/sync', { auth, body: { installId, earned: 0, purchases: {}, claims: [], bonusBought: { boost: 0, gel: 0 }, save: { version: 10 }, ...o } });

// Catalogue attendu : mêmes identifiants et mêmes prix que le jeu (src/config/skins.ts)
const SKINS = [
  ['tole-brute', 'default'], ['chantier-orbital', 100], ['carbone-utilitaire', 150], ['dipole', 200], ['circuit', 250], ['cartographe', 300],
  ['long-courrier', 1500], ['basalte', 2000], ['arcade-84', 3000], ['porcelaine', 'unavailable'],
];

// 1. Santé
const health = await api('GET', '/api/health');
check(health.status === 200 && health.data?.ok === true, 'Santé de l’API', JSON.stringify(health.data));

// 2. Profil de test
const reg = await api('POST', '/api/register', { body: {} });
check(reg.status === 201 && reg.data?.playerId, 'Nouveau compte invité créé (test)');
if (!reg.data?.playerId) process.exit(1);
const auth = `${reg.data.playerId}.${reg.data.token}`;
const install = `verif-${randomBytes(6).toString('hex')}`;
check(JSON.stringify(await bal(auth)) === JSON.stringify({ shards: 0, medals: 0, prisms: 0 }), 'Nouveau compte : soldes à 0, aucun remboursement parasite');

// 3. Reconnaissance des dix identifiants : aucun ne doit être « inconnu » (un solde nul donne « insufficient », jamais un débit)
const probe = await sync(auth, install, { purchases: Object.fromEntries(SKINS.filter(([, p]) => typeof p === 'number').map(([id, p]) => [id, p])) });
const reasons = Object.fromEntries((probe.data?.rejected ?? []).map((r) => [r.item, r.reason]));
for (const [id, price] of SKINS) {
  if (typeof price === 'number') check(reasons[id] === 'insufficient', `Identifiant reconnu : ${id} (${price})`, `réponse : ${reasons[id] ?? 'acceptée ?!'}`);
}
const free = await sync(auth, install, { purchases: { 'tole-brute': 0, porcelaine: 0 } });
const r2 = Object.fromEntries((free.data?.rejected ?? []).map((r) => [r.item, r.reason]));
check(r2['tole-brute'] === 'not_purchasable' && r2.porcelaine === 'not_purchasable', 'tole-brute (gratuit) et porcelaine (indisponible) reconnus, non achetables');
const wrong = await sync(auth, install, { purchases: { 'chantier-orbital': 1 } });
check(wrong.data?.rejected?.[0]?.reason === 'bad_price', 'Prix falsifié refusé (le service débite toujours le prix du catalogue)');
check((await bal(auth)).medals === 0 && (await bal(auth)).shards === 0, 'Aucun débit pendant ces essais');

// 4. Achat en Médailles : « survive_300 » = 100 Médailles = chantier-orbital
const ach = { version: 10, achievements: { survive_300: Date.now() }, medals: { claimed: ['survive_300'] } };
const m1 = await sync(auth, install, { claims: ['survive_300'], purchases: { 'chantier-orbital': 100 }, save: { ...ach, owned: ['chantier-orbital'] } });
check(m1.data?.acknowledged?.some((a) => a.item === 'chantier-orbital' && a.charged) && m1.data?.balance?.medals === 0, 'Achat en Médailles : chantier-orbital (100) débité', JSON.stringify(m1.data?.balance));
for (let i = 0; i < 3; i++) await sync(auth, install, { claims: ['survive_300'], purchases: { 'chantier-orbital': 100 }, save: { ...ach, owned: ['chantier-orbital'] } });
check((await bal(auth)).medals === 0, 'Pas de double débit en Médailles (3 synchronisations répétées)');

// 5. Achat en Éclats : 1 500 Éclats = long-courrier
const s1 = await sync(auth, install, { earned: 1500, purchases: { 'long-courrier': 1500 }, save: { version: 10, owned: ['long-courrier', 'chantier-orbital'] } });
check(s1.data?.acknowledged?.some((a) => a.item === 'long-courrier' && a.charged) && s1.data?.balance?.shards === 0, 'Achat en Éclats : long-courrier (1 500) débité', JSON.stringify(s1.data?.balance));
for (let i = 0; i < 3; i++) await sync(auth, install, { earned: 1500, purchases: { 'long-courrier': 1500 }, save: { version: 10, owned: ['long-courrier', 'chantier-orbital'] } });
check((await bal(auth)).shards === 0, 'Pas de double débit en Éclats (3 synchronisations répétées)');

// 6. Achat en Prismes (route directe en ligne) : crédit de test fourni par l'opérateur sur la machine du service
const credit = arg('credit-prisms');
if (!credit) {
  console.log('… Achat en Prismes NON vérifié (aucune --credit-prisms fournie)');
} else {
  execSync(credit, { stdio: 'inherit', env: { ...process.env, TEST_PLAYER_ID: reg.data.playerId } });
  const before = (await bal(auth)).prisms;
  check(before === 200, 'Crédit de test de 200 Prismes présent', `solde ${before}`);
  const p1 = await api('POST', '/api/shop/prisms', { auth, body: { item: 'basalte' } });
  check(p1.status === 200 && p1.data?.charged === true && p1.data?.price === 80 && p1.data?.balance?.prisms === 120, 'Achat en Prismes : basalte (80) débité par le service', JSON.stringify(p1.data?.balance));
  for (let i = 0; i < 3; i++) await api('POST', '/api/shop/prisms', { auth, body: { item: 'basalte' } });
  check((await bal(auth)).prisms === 120, 'Pas de double débit en Prismes (requête répétée 3 fois : « déjà possédé »)');
  const porc = await api('POST', '/api/shop/prisms', { auth, body: { item: 'porcelaine' } });
  check(porc.status === 400, 'Porcelaine (indisponible) : refus en Prismes');
}

// 7. Persistance après relancement
const restart = arg('restart');
const snapshot = JSON.stringify(await bal(auth));
if (!restart) {
  console.log('… Persistance après relancement NON vérifiée (aucune --restart fournie)');
} else {
  execSync(restart, { stdio: 'inherit' });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    up = await api('GET', '/api/health').then((r) => r.status === 200).catch(() => false);
  }
  check(up, 'Service de nouveau en ligne après relancement');
  check(JSON.stringify(await bal(auth)) === snapshot, 'Persistance : soldes identiques après relancement', snapshot);
  const again = await sync(auth, install, { earned: 1500, claims: ['survive_300'], purchases: { 'chantier-orbital': 100, 'long-courrier': 1500 }, save: { ...ach, owned: ['long-courrier', 'chantier-orbital'] } });
  check(JSON.stringify(again.data?.balance) === snapshot || (again.data?.balance?.shards === 0 && again.data?.balance?.medals === 0), 'Après relancement : aucune nouvelle dépense ni nouveau débit');
}

// 8. Ancien compte (lecture + synchronisations répétées : les remboursements ne se multiplient jamais)
const old = arg('old-account');
if (!old) {
  console.log('… Ancien compte NON vérifié (aucune --old-account fournie)');
} else {
  const before = await bal(old);
  check(!!before, 'Ancien compte : profil lu', JSON.stringify(before));
  const oinstall = `verif-old-${randomBytes(4).toString('hex')}`;
  const a1 = await sync(old, oinstall, { save: { version: 10 } });
  const b1 = await bal(old);
  for (let i = 0; i < 4; i++) await sync(old, oinstall, { save: { version: 10 } });
  const b2 = await bal(old);
  check(a1.status === 200, 'Ancien compte : synchronisation acceptée');
  check(JSON.stringify(b1) === JSON.stringify(b2), 'Ancien compte : soldes stables après 4 synchronisations de plus (aucun double remboursement)', `avant ${JSON.stringify(before)} → après 1ʳᵉ synchro ${JSON.stringify(b1)} → après 5 ${JSON.stringify(b2)}`);
  check(b1.shards >= before.shards && b1.medals >= before.medals && b1.prisms >= before.prisms, 'Ancien compte : aucun solde n’a baissé (jamais de remise à zéro)');
}

// 9. Nettoyage : suppression du profil de test
const del = await api('DELETE', '/api/me', { auth });
check(del.status === 200, 'Profil de test supprimé');
console.log(failed === 0 ? '\nTous les contrôles sont verts.' : `\n${failed} contrôle(s) en échec.`);
process.exit(failed === 0 ? 0 : 1);
