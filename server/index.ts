import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { mailerFromEnv } from './mailer';
import { openDb } from './db';
import { checkOrigins, createHttpServer } from './http';

/**
 * Point d'entrée du service de classement mondial (Survie). Configuration par variables d'environnement (voir docs/GUIDE_DEPLOIEMENT.md) :
 *   TICKET_SECRET     secret de signature des tickets (obligatoire, ≥ 32 caractères aléatoires) — jamais dans le jeu ni dans le dépôt
 *   DATABASE_PATH     fichier SQLite (défaut : ./data/leaderboard.sqlite) — à placer sur un disque persistant
 *   ALLOWED_ORIGINS   origines CORS exactes, séparées par des virgules (ex. https://utilisateur.github.io) ; jamais « * ». Applications natives : ajouter https://localhost (Android) et capacitor://localhost (iOS), seules origines non https acceptées (src/net/origins.ts)
 *   PORT              port d'écoute (défaut 8787) ; HOST : interface d'écoute (défaut 0.0.0.0 ; 127.0.0.1 derrière un proxy sur la même machine)
 *   TRUST_PROXY       nombre de proxys de confiance devant le service (0 = aucun, défaut ; « 1 » avec Caddy/Nginx)
 *   REQUIRE_HTTPS     « 1 » : refuser toute requête arrivée en clair (exige TRUST_PROXY ≥ 1 ; en production : toujours 1)
 *   BLOCKED_WORDS     mots interdits supplémentaires dans les pseudos (séparés par des virgules)
 *   MAX_REPLAYS_PER_MINUTE   plafond global de rejeux (défaut 30)
 * Comptes (facultatifs ; chaque méthode reste DÉSACTIVÉE tant que sa configuration est absente — voir docs/COMPTES.md) :
 *   GOOGLE_CLIENT_IDS / GOOGLE_WEB_CLIENT_ID   identifiants clients OAuth Google acceptés (web, Android, iOS) et identifiant « web » exposé au navigateur
 *   APPLE_CLIENT_IDS / APPLE_WEB_CLIENT_ID     identifiants Apple acceptés (service web, application iOS) et identifiant de service exposé
 *   RESEND_API_KEY + MAIL_FROM                 service d'envoi des liens magiques par courriel (secrets : jamais dans le jeu)
 *   APP_PUBLIC_URL                             adresse publique du jeu (lien du courriel), ex. https://utilisateur.github.io/Polarity/
 * Aucune route d'administration HTTP : la modération se fait en ligne de commande sur la machine (server/admin.ts).
 */
const fail = (msg: string): never => {
  console.error(`Configuration invalide : ${msg}`);
  process.exit(1);
};

const secret = process.env.TICKET_SECRET ?? '';
if (secret.length < 32) fail('TICKET_SECRET manquant ou trop court (32 caractères minimum). Exemple : openssl rand -hex 32');
const dbPath = process.env.DATABASE_PATH ?? './data/leaderboard.sqlite';
const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const trustProxy = Math.max(0, Math.floor(Number(process.env.TRUST_PROXY === 'true' ? 1 : (process.env.TRUST_PROXY ?? 0))) || 0);
const requireHttps = process.env.REQUIRE_HTTPS === '1';
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const blocked = (process.env.BLOCKED_WORDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const maxReplays = Number(process.env.MAX_REPLAYS_PER_MINUTE ?? 30);

if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT invalide.');
if (requireHttps && trustProxy < 1) fail('REQUIRE_HTTPS=1 exige TRUST_PROXY=1 (HTTPS terminé par un proxy de confiance devant le service).');
if (allowed.length === 0) console.warn('Attention : ALLOWED_ORIGINS est vide : aucun navigateur ne pourra utiliser le service (CORS).');
const originProblems = checkOrigins(allowed, requireHttps);
if (originProblems.length > 0) fail(originProblems.join(' ; '));

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const list = (v: string | undefined): string[] => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const googleIds = list(process.env.GOOGLE_CLIENT_IDS);
const appleIds = list(process.env.APPLE_CLIENT_IDS);
const mailer = mailerFromEnv(process.env);
const appUrl = process.env.APP_PUBLIC_URL?.trim();
if (appUrl && !/^https:\/\//i.test(appUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(appUrl)) fail('APP_PUBLIC_URL doit être en https.');
const app = createApp(db, {
  ticketSecret: secret,
  blockedWords: blocked,
  limits: { replaysPerMinute: Number.isFinite(maxReplays) && maxReplays > 0 ? maxReplays : 30 },
  accounts: {
    google: googleIds.length > 0 ? { audiences: googleIds, web: process.env.GOOGLE_WEB_CLIENT_ID?.trim() || googleIds[0] } : undefined,
    apple: appleIds.length > 0 ? { audiences: appleIds, web: process.env.APPLE_WEB_CLIENT_ID?.trim() || appleIds[0] } : undefined,
    mailer,
    appUrl,
  },
});
// Clôture des défis quotidiens (00 h 15 UTC) : au démarrage (createApp) puis chaque minute ; une panne n'en perd aucune
setInterval(() => {
  try {
    app.tick(true);
  } catch (e) {
    console.error('Clôture des défis quotidiens :', e);
  }
}, 60_000).unref();
const server = createHttpServer(app, { allowedOrigins: allowed, trustProxy, requireHttps });

server.listen(port, host, () => {
  console.log(`Comptes : Google ${googleIds.length > 0 ? 'activé' : 'désactivé'}, Apple ${appleIds.length > 0 ? 'activé' : 'désactivé'}, courriel ${mailer ? 'activé' : 'désactivé'}`);
  console.log(`Classement : écoute sur ${host}:${port} (base : ${dbPath}, origines : ${allowed.join(', ') || 'aucune'}, https exigé : ${requireHttps ? 'oui' : 'non'}, proxys de confiance : ${trustProxy})`);
});

// Arrêt propre (docker stop, redémarrage) : on finit les requêtes en cours puis on ferme la base (point de contrôle WAL)
let stopping = false;
const stop = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} reçu : arrêt du service.`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* déjà fermée */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
// Une exception imprévue ne doit pas laisser un service à moitié vivant : journal puis sortie (le conteneur redémarre, la base est transactionnelle)
process.on('uncaughtException', (e) => {
  console.error('Exception non rattrapée :', e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('Promesse rejetée non gérée :', e);
  process.exit(1);
});
