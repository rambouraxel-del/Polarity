# Classement mondial (Survie)

**État de cette livraison : l'intégration est terminée et testée, mais le classement n'est PAS opérationnel en production** : aucun service n'est déployé
(il faut un hébergement et des secrets que ce dépôt ne peut pas fournir). Tant que `LEADERBOARD_URL` n'est pas renseigné, le jeu affiche « Le classement mondial n'est pas encore activé »
et n'invente aucune ligne. Voir « Mise en service » ci-dessous pour la configuration restante.

## Architecture
```
Navigateur (jeu, GitHub Pages)  ──HTTPS──▶  Service de classement (Node 22 + SQLite sur disque persistant)
   src/net/leaderboard.ts                      server/ : index.ts (HTTP) · app.ts (routes) · verify.ts (rejeu) · db.ts · auth.ts
   src/net/protocol.ts  ◀──── types et règles partagés ────▶  src/net/protocol.ts
```
Le serveur embarque le **même code de simulation** que le jeu (`src/sim`, `src/modes`, `src/config`) : c'est ce qui permet de rejouer une partie à l'identique.

## Ce qui est classé
Parties de **Survie** uniquement. Critère principal : **durée de survie** ; **score** en départage ; à égalité parfaite, le résultat le plus ancien passe devant.
Top 100 public (`GET /api/leaderboard`), rang et meilleur résultat personnels (`GET /api/me`), pseudo choisi par le joueur (3–16 caractères, unique, modifiable).

## Identité et authentification
- À l'inscription (`POST /api/register`), le serveur crée un `playerId` (UUID) et un **secret aléatoire de 256 bits**, remis **une seule fois**. Le serveur ne garde que l'empreinte SHA-256 du secret.
- Le navigateur conserve `playerId` + secret dans `localStorage` (clé `polarite.classement.identite`, séparée de la sauvegarde de progression) et les envoie en `Authorization: Bearer <playerId>.<secret>`.
- Comparaisons en temps constant. **Aucune clé d'administration** : le serveur n'a aucune route d'administration, et le jeu n'embarque aucun secret (vérifié par `npm run e2e:classement`).
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

## Limites restantes contre la triche (à connaître)
- **Un robot peut produire un journal valide.** Le rejeu prouve que la partie respecte les règles et que le résultat est celui de la simulation ; il ne prouve pas qu'un humain a joué. Un script qui calcule des entrées parfaites pour une graine connue sera accepté.
  Atténuations en place : graines attribuées par le serveur (pas de choix de graine ni de partie fabriquée de toutes pièces), usage unique, limites de débit (30 parties/h par joueur, 1 toutes les 3 s), une inscription limitée par adresse IP.
  Pistes : temps minimal entre l'émission du ticket et l'envoi, détection statistique d'entrées trop régulières, signalement par les joueurs, comptes vérifiés.
- **Coût de calcul** : un rejeu de dix minutes demande de l'ordre de la seconde de processeur, exécuté dans le processus du serveur ; adapté à un trafic modeste. Au-delà : files de rejeu, threads de travail.
- Les limites de débit sont en mémoire (réinitialisées au redémarrage) et supposent une seule instance.
- Pas de modération des pseudos au-delà du format et de l'unicité.
- Le journal des entrées est conservé en base pour audit (table `runs`) ; prévoir une purge si la base grossit.

## Mise en service (configuration restante)
1. **Héberger le service** (Node ≥ 22.13, disque persistant) : Fly.io, Render, un VPS… Exemple avec Docker : `docker build -f server/Dockerfile -t polar-rift-classement .` puis lancer avec un volume monté sur `/data`.
2. **Variables d'environnement du serveur** : `TICKET_SECRET` (≥ 32 caractères aléatoires : `openssl rand -hex 32`, **ne jamais le committer**), `ALLOWED_ORIGINS` (origine du jeu, ex. `https://<utilisateur>.github.io`), `DATABASE_PATH` (défaut `./data/leaderboard.sqlite`), `PORT`, `TRUST_PROXY=1` derrière un proxy fiable.
3. **HTTPS obligatoire** (les secrets des joueurs transitent dans l'en-tête `Authorization`).
4. **Sauvegardes** : copier régulièrement le fichier SQLite (mode WAL : utiliser `sqlite3 .backup`).
5. **Jeu** : dans les réglages du dépôt GitHub → *Settings → Secrets and variables → Actions → Variables*, créer `LEADERBOARD_URL` = adresse publique du service (sans slash final). Le workflow Pages la transmet à la construction (`VITE_LEADERBOARD_URL`). Adresse publique seulement : aucune clé.
6. Vérifier : `npm run build && npm run e2e:classement` (démarre un vrai serveur local) puis un essai manuel en production.

## API (JSON)
| Route | Accès | Rôle |
|---|---|---|
| `GET /api/health` | public | état et version d'équilibrage |
| `POST /api/register` `{nickname}` | public (5/h/IP) | crée le profil ; renvoie `playerId` et secret (une fois) |
| `PATCH /api/me` `{nickname}` | joueur | change le pseudo |
| `GET /api/me?balance=N` | joueur | rang et meilleur résultat |
| `POST /api/tickets` | joueur | lot de 5 tickets (10 ouverts au plus) |
| `POST /api/runs` | joueur | soumet `{ticket, replay:{v,flips}, claimed, client}` ; renvoie `accepted` (durée, score, rang) ou `rejected` (motif) |
| `GET /api/leaderboard?balance=N&limit=100` | public | top 100 (le joueur authentifié est marqué `you`) |
| `GET /api/balances` | public | versions disponibles |

## Développement
`TICKET_SECRET=$(openssl rand -hex 32) ALLOWED_ORIGINS=http://localhost:5173 npm run server` ; jeu : `VITE_LEADERBOARD_URL=http://localhost:8787 npm run dev`.
Tests : `tests/leaderboard-server.test.ts`, `tests/leaderboard-client.test.ts` (inclus dans `npm test`) ; bout en bout : `npm run e2e:classement`.
