# Classement mondial (Survie)

**État de cette livraison : le code est prêt, durci et testé, mais le classement n'est PAS en ligne** : aucun service n'est déployé (il faut un serveur, un domaine et un secret que
seul le propriétaire peut créer). Tant que `LEADERBOARD_URL` n'est pas renseigné, le bouton « Classement » est **masqué** dans le jeu, qui reste entièrement jouable ; si l'adresse est
configurée mais le service injoignable, le menu l'indique clairement (« Classement indisponible ») et les résultats éligibles restent en attente. Le pas à pas est dans **`docs/GUIDE_DEPLOIEMENT.md`**.

## Architecture
```
Navigateur (jeu, GitHub Pages)  ──HTTPS──▶  Service de classement (Node 22 + SQLite sur disque persistant)
   src/net/leaderboard.ts                      server/ : index.ts (configuration, arrêt propre) · http.ts (transport durci) · app.ts (routes) · verify.ts (rejeu) · db.ts (schéma versionné) · auth.ts · moderation.ts · admin.ts (CLI opérateur)
   src/net/protocol.ts  ◀──── types et règles partagés ────▶  src/net/protocol.ts
```
Le serveur embarque le **même code de simulation** que le jeu (`src/sim`, `src/modes`, `src/config`) : c'est ce qui permet de rejouer une partie à l'identique.

## Ce qui est classé
Parties de **Survie** uniquement. Critère principal : **durée de survie** ; **score** en départage ; à égalité parfaite, le résultat le plus ancien passe devant.
Top 100 public (`GET /api/leaderboard`), rang et meilleur résultat personnels (`GET /api/me`), pseudo choisi par le joueur (3–16 caractères, **lettres latines**, chiffres, espace, point, tiret, tiret bas ; unique, modifiable, filtré : insultes et noms trompeurs comme « Admin » refusés).

## Identité et authentification
- À l'inscription (`POST /api/register`), le serveur crée un `playerId` (UUID) et un **secret aléatoire de 256 bits**, remis **une seule fois**. Le serveur ne garde que l'empreinte SHA-256 du secret.
- Le navigateur conserve `playerId` + secret dans `localStorage` (clé `polarite.classement.identite`, séparée de la sauvegarde de progression) et les envoie en `Authorization: Bearer <playerId>.<secret>`.
- Comparaisons en temps constant. **Aucune clé d'administration et aucune route d'administration HTTP** : la modération se fait en ligne de commande sur la machine (`server/admin.ts`). Le jeu n'embarque aucun secret : vérifié par `npm run check:bundle` (workflow Pages) et `npm run e2e:classement`.
- Limite assumée : identité anonyme liée à un navigateur. Perdre le stockage du navigateur fait perdre le profil (pas de récupération par e-mail dans cette version).

## Validation des parties (rejeu côté serveur)
Le navigateur n'envoie **pas** un résultat à croire. Il envoie :
1. un **ticket de partie** : graine attribuée par le serveur (`POST /api/tickets`), liée au joueur, signée (HMAC-SHA256 avec `TICKET_SECRET`), à usage unique, valable 7 jours — des tickets d'avance permettent de jouer hors ligne ;
2. le **journal des entrées** : pas de simulation (120 Hz) auxquels chaque inversion a été appliquée (`Simulation.flipLog`) ;
3. les valeurs annoncées (durée, score), **jamais utilisées** : seulement comparées pour détecter une divergence.

Le serveur (`server/verify.ts`) rejoue la partie avec la graine du ticket et les entrées, jusqu'à la mort, et **calcule lui-même** durée et score. Refus (`422`) si : ticket invalide, expiré, déjà utilisé ou d'un autre joueur ;
journal incohérent ; partie qui ne se termine pas ; entrées après la mort ; version d'équilibrage non prise en charge ; valeurs annoncées différentes du rejeu (`divergence`). Le ticket est consommé dès qu'un rejeu a eu lieu
(pas d'essais répétés). L'usage du ticket, l'enregistrement de la partie et la mise à jour du meilleur résultat sont **une seule transaction**.

Parties **démo/debug** : `?demo` (joueur automatique) et `?debug` n'obtiennent jamais de ticket et ne sont jamais envoyées ; toute aide de test (`invincible`, motif injecté) marque la partie `assisted`.
Elles ne passeraient de toute façon pas le rejeu (le serveur n'a pas d'invincibilité).

## Versions d'équilibrage
Chaque résultat est rattaché à `BALANCE_VERSION`. Le serveur n'accepte que la version de son code (une partie d'une autre version ne peut pas être rejouée : `unsupported_balance`, ticket non consommé).
Les résultats des anciennes versions **restent en base** et sont consultables (`GET /api/leaderboard?balance=N`, `GET /api/balances`) ; le menu propose de basculer entre les versions. **À chaque changement de `BALANCE_VERSION`,
redéployer le serveur avec le nouveau code** : les nouveaux résultats repartent d'un classement vide, les anciens sont conservés.

## Jeu hors ligne
Le jeu fonctionne sans service. Avec un profil et des tickets en réserve, une partie de Survie éligible est conservée **« en attente »** (`polarite.classement.attente`, 20 au plus) puis envoyée au retour de la connexion
(au démarrage, à l'événement `online`, ou depuis le menu). L'écran de résultat indique clairement : *en attente*, *envoi en cours*, *validé — rang N*, *non validé — motif*, *résultat local seulement* (aucun ticket) ou *non éligible* (démo/test).

## Sécurité du service (ce qui est en place)
| Risque | Parade |
|---|---|
| Score inventé | jamais cru : graine du serveur + rejeu des entrées ; valeurs annoncées seulement comparées |
| Ticket rejoué, volé ou fabriqué | HMAC lié au joueur, usage unique (transaction ticket + partie + record), expiration 7 jours |
| Secret du serveur dans le jeu | le jeu ne connaît que l'adresse publique ; `check:bundle` échoue si `TICKET_SECRET`, `node:sqlite`… apparaissent dans `dist/` |
| Secret d'un joueur en clair | le serveur ne stocke que l'empreinte SHA-256 ; `REQUIRE_HTTPS=1` refuse (426) toute requête arrivée en clair (le secret voyage en `Authorization`) ; le client n'accepte qu'une adresse `https` (ou `http://localhost`) |
| Autre site utilisant le service | CORS strict : origines exactes listées (jamais `*`), corps JSON exigeant `Content-Type: application/json` (pré-requête CORS) |
| Fausse adresse IP (limites contournées) | `X-Forwarded-For` lu depuis la **droite** et seulement derrière `TRUST_PROXY` proxys de confiance |
| Abus de requêtes | limites par IP / joueur / globales (inscriptions, tickets, parties, signalements, suppressions, lectures), **budget global de rejeux** par minute (protège le processeur ; 429 sans consommer le ticket), corps ≤ 256 Ko, délais de requête et d'en-têtes |
| Pseudos trompeurs ou offensants | lettres latines seulement (pas de cyrillique/grec imitant des lettres, pas de caractères invisibles), filtre d'insultes et de noms réservés (extensible : `BLOCKED_WORDS`), unicité insensible casse/accents, signalement par les joueurs, masquage/exclusion par l'opérateur |
| Erreurs internes | jamais de détail renvoyé (500 générique) ; exceptions fatales journalisées puis redémarrage propre (le conteneur redémarre, la base est transactionnelle) ; arrêt propre sur SIGTERM |
| Entêtes | `Cache-Control: no-store`, `nosniff`, CSP `default-src 'none'`, HSTS en production, `Referrer-Policy: no-referrer` |

## Modération et données personnelles
- **Joueur** (authentifié par son secret) : `POST /api/report {nickname, reason?}` signale un pseudo ; `DELETE /api/me` supprime **tout** son profil (pseudo, empreinte, tickets, parties et journaux, records, signalements) en une transaction, irréversiblement. Depuis le jeu : menu Classement → « Mon profil et signalements ».
- **Opérateur** (accès à la machine) : `npm run server:admin -- <commande>` (voir `docs/GUIDE_DEPLOIEMENT.md` §5) : `reports`, `hide` (pseudo remplacé par `Joueur-xxxxxx`, non modifiable), `ban`/`unban` (hors classement, parties refusées), `export` (demande d'accès), `delete-player` (demande de suppression), `stats`, `check`, `backup`, `prune`. Toute action destructrice est **simulée sans `--yes`**. Les actions de modération sont tracées (table `moderation_log`) ; la trace d'une suppression est anonyme.
- **Aucune route HTTP non authentifiée** ne modère, supprime ou administre (testé : tout chemin d'administration répond 404/401 ; `DELETE /api/me` sans secret → 401 et rien n'est supprimé).
- Données conservées : pseudo, empreinte du secret, date d'inscription, graines et journaux d'entrées des parties validées, records. Aucune adresse IP, aucun e-mail n'est stocké (les adresses ne servent qu'aux limites en mémoire).

## Base de données
SQLite (module `node:sqlite`), fichier sur volume persistant, mode **WAL** (`synchronous=NORMAL`, `busy_timeout`, `foreign_keys`). `PRAGMA user_version` + liste de migrations (`MIGRATIONS` dans `server/db.ts`) : au démarrage une base ancienne est copiée (`<base>.avant-vN.bak`) puis migrée ; une base **plus récente** que le code est refusée sans modification. Sauvegarde à chaud cohérente par `VACUUM INTO` (`server:admin backup`, `deploy/sauvegarde.sh`) ; **ne jamais copier le fichier à la main pendant que le service tourne**. Restauration, retour arrière et évolution : `docs/GUIDE_DEPLOIEMENT.md` §6-7.
La table `runs` (journal des entrées de chaque partie validée) est la seule qui croît avec l'usage ; **aucune purge automatique** — `prune` (simulation par défaut, jamais les records) ne se lance que sur ordre du propriétaire.

## Limites restantes contre la triche (à connaître)
- **Un robot peut produire un journal valide.** Le rejeu prouve que la partie respecte les règles et que le résultat est celui de la simulation ; il ne prouve pas qu'un humain a joué. Un script qui calcule des entrées parfaites pour une graine connue sera accepté (le projet fournit lui-même un bot d'équilibrage).
  Atténuations en place : graines attribuées par le serveur (pas de choix de graine ni de partie fabriquée de toutes pièces), usage unique, limites de débit (30 parties/h par joueur, 1 toutes les 3 s), 5 inscriptions/h par adresse et plafond global d'inscriptions, filtrage et signalement des pseudos, exclusion par l'opérateur.
  Pistes (non faites) : temps minimal entre l'émission du ticket et l'envoi, détection statistique d'entrées trop régulières, comptes vérifiés.
- **Comptes jetables** : l'inscription est anonyme ; une personne motivée peut en créer beaucoup en changeant d'adresse (limité par adresse et par plafond global). Pas de vérification par e-mail dans cette version.
- **Coût de calcul** : un rejeu de dix minutes demande de l'ordre de la seconde de processeur, exécuté dans le processus du serveur ; le budget global de rejeux borne l'abus. Au-delà d'un trafic modeste : files de rejeu, threads de travail.
- **Limites de débit en mémoire** (réinitialisées au redémarrage, une seule instance du service) : ne pas faire tourner plusieurs copies derrière un répartiteur sans les déplacer dans la base.
- **Filtre de pseudos « au mieux »** : il n'arrête ni toutes les insultes ni les contournements inventifs ; il est complété par signalement et modération manuelle.
- Profil lié au navigateur : perte du stockage = perte du profil (pas de récupération).

## Mise en service
Tout est décrit pas à pas dans **`docs/GUIDE_DEPLOIEMENT.md`** : prérequis, secrets à créer, variable GitHub `LEADERBOARD_URL`, vérification en production, sauvegarde/restauration, retour arrière, redéploiement lors d'un changement de `BALANCE_VERSION`.
Livrables intégrables : `server/Dockerfile` (utilisateur non privilégié, sonde de santé), `deploy/docker-compose.yml` + `deploy/Caddyfile` (HTTPS automatique), `deploy/env.example`, `deploy/sauvegarde.sh`, `.env.example` (jeu), `scripts/check-bundle.mjs`, `.github/workflows/pages.yml`.

Variables du service : `TICKET_SECRET` (obligatoire, ≥ 32 car.), `ALLOWED_ORIGINS` (obligatoire pour qu'un navigateur l'utilise), `DATABASE_PATH`, `PORT`, `HOST`, `TRUST_PROXY` (nombre de proxys de confiance ; 1 avec Caddy), `REQUIRE_HTTPS` (1 en production, exige `TRUST_PROXY ≥ 1`), `BLOCKED_WORDS`, `MAX_REPLAYS_PER_MINUTE`. Une configuration incohérente (secret court, origine `*` ou en clair, port invalide) empêche le démarrage avec un message clair.
Variable du jeu : `VITE_LEADERBOARD_URL` (publique ; `https://hôte` sans chemin, ou `http://localhost…` en développement). Une valeur invalide **fait échouer la construction** (`vite.config.ts`) ; vide = classement désactivé. `npm run build:beta` construit une version de test (`.env.beta`, dossier `dist-beta/`).

## API (JSON)
| Route | Accès | Rôle |
|---|---|---|
| `GET /api/health` | public | état, base lisible, version d'équilibrage |
| `POST /api/register` `{nickname}` | public (5/h/IP) | crée le profil ; renvoie `playerId` et secret (une fois) |
| `PATCH /api/me` `{nickname}` | joueur | change le pseudo (refusé si le pseudo a été masqué par l'opérateur) |
| `DELETE /api/me` | joueur (secret) | supprime tout le profil et ses données (irréversible) |
| `POST /api/report` `{nickname, reason?}` | joueur (10/h) | signale un pseudo à l'opérateur |
| `GET /api/me?balance=N` | joueur | rang et meilleur résultat |
| `POST /api/tickets` | joueur | lot de 5 tickets (10 ouverts au plus) |
| `POST /api/runs` | joueur | soumet `{ticket, replay:{v,flips}, claimed, client}` ; renvoie `accepted` (durée, score, rang) ou `rejected` (motif) |
| `GET /api/leaderboard?balance=N&limit=100` | public | top 100 (le joueur authentifié est marqué `you`) |
| `GET /api/balances` | public | versions disponibles |

## Développement
`TICKET_SECRET=$(openssl rand -hex 32) ALLOWED_ORIGINS=http://localhost:5173 npm run server` ; jeu : `VITE_LEADERBOARD_URL=http://localhost:8787 npm run dev`.
Tests : `tests/leaderboard-server.test.ts`, `tests/leaderboard-hardening.test.ts` (pseudos, modération, suppression, migration, couche HTTP), `tests/leaderboard-client.test.ts` (inclus dans `npm test`) ; bout en bout : `npm run e2e:classement`.
