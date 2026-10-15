# Guide de déploiement du classement mondial (Survie)

> **État : rien n'est déployé.** Ce guide décrit ce que **vous** devez faire pour mettre le classement en ligne. Tant que ce n'est pas fait, le jeu fonctionne normalement
> (GitHub Pages) et le bouton « Classement » est **masqué** : aucune partie du jeu ne dépend du service.

## 0. Vue d'ensemble (3 minutes)
```
Joueur ──▶ jeu sur GitHub Pages ──HTTPS──▶ Caddy (HTTPS auto) ──▶ service de classement (Docker) ──▶ base SQLite (volume « donnees »)
```
- Le **jeu** est publié par GitHub Pages comme aujourd'hui ; il ne connaît que l'**adresse publique** du service (variable GitHub, pas un secret).
- Le **service** tourne sur UN petit serveur à vous (Docker). Il détient le seul secret : `TICKET_SECRET`.
- Si le service tombe ou n'existe pas : le jeu reste jouable, les résultats éligibles restent « en attente » et partent au retour du service.

> **Mise à jour « Économie v3 »** : la procédure complète de publication (ordre serveur puis jeu, sauvegarde, migration sur copie, contrôle, retour arrière) est dans **`docs/PUBLICATION_BETA.md`**. Contrôle d'une migration sur une copie : `npm run server:migrate-check -- <sauvegarde.sqlite>`. Attention : `server:admin` ouvre la base avec le code courant et la **migre** si son schéma est plus ancien.

## 1. Prérequis
| Quoi | Détail |
|---|---|
| Un petit serveur Linux (VPS) | 1 vCPU, 1 Go de RAM, 10 Go de disque suffisent pour démarrer ; accessible depuis Internet sur les ports **80 et 443** |
| Docker + plugin Compose | `docker --version` et `docker compose version` doivent répondre |
| Un nom de domaine (ou sous-domaine) | ex. `classement.mon-domaine.fr`, avec un enregistrement DNS **A** (et **AAAA** si IPv6) vers l'adresse du serveur. Sans domaine, pas de HTTPS, donc **pas de classement** (les secrets des joueurs ne doivent jamais circuler en clair) |
| Le dépôt cloné sur ce serveur | `git clone …` puis `cd Polarity/deploy` |
| Accès aux réglages du dépôt GitHub | pour créer la variable `LEADERBOARD_URL` |

## 2. Secrets et valeurs que VOUS créez
| Valeur | Où elle vit | Comment la créer | Secret ? |
|---|---|---|---|
| `TICKET_SECRET` | **uniquement** dans le fichier `deploy/.env` du serveur (et une copie dans votre gestionnaire de mots de passe) | `openssl rand -hex 32` (64 caractères) | **OUI** — jamais dans GitHub, jamais dans le dépôt, jamais dans un message |
| `LEADERBOARD_DOMAIN` | `deploy/.env` | le domaine choisi (sans `https://`) | non |
| `ALLOWED_ORIGINS` | `deploy/.env` | l'origine du jeu : `https://<utilisateur>.github.io` (le domaine seulement, sans le nom du dépôt ni `/` final). **Si vous publiez les applications mobiles**, ajoutez exactement `https://localhost` (Android) et `capacitor://localhost` (iOS) : `https://<utilisateur>.github.io,https://localhost,capacitor://localhost` (voir `docs/BUILD_MOBILE.md`) | non |
| `LEADERBOARD_URL` | **variable** du dépôt GitHub (*Settings → Secrets and variables → Actions → onglet Variables*) | `https://classement.mon-domaine.fr` | non (publique : visible dans le jeu). Un **préfixe de chemin** est accepté (`https://hôte/polarity`) à condition que votre reverse proxy le **retire** avant de transmettre au service (Caddy : `handle_path /polarity/* { reverse_proxy classement:8787 }`) ; l'origine CORS (`ALLOWED_ORIGINS`) ne contient jamais de chemin |

| `RESEND_API_KEY`, `MAIL_FROM`, `APP_PUBLIC_URL` | `deploy/.env` | compte Resend (courriels de connexion) ; adresse publique du jeu | `RESEND_API_KEY` : **OUI** |
| `GOOGLE_CLIENT_IDS`, `GOOGLE_WEB_CLIENT_ID`, `APPLE_CLIENT_IDS`, `APPLE_WEB_CLIENT_ID` | `deploy/.env` | consoles Google / Apple (voir `docs/COMPTES.md`) | non (identifiants clients publics) |

Comptes joueurs (facultatifs, économie v3) : toute méthode sans valeur reste désactivée ; le service a besoin d'être redéployé (schéma v3 additif, sauvegarde automatique avant migration). Détail : `docs/COMPTES.md`. Achats et publicités (facultatifs, désactivés sans variables) : `docs/MONETISATION.md` ; adresses à déclarer chez les fournisseurs : `/api/payments/notify/apple`, `/api/payments/notify/google`, `/api/ads/ssv`.

Règles : un secret **différent** par instance (bêta ≠ production) ; ne le réutilisez nulle part ; ne le collez jamais dans une conversation (y compris avec une IA).
Perte ou fuite du `TICKET_SECRET` : générez-en un nouveau, mettez à jour `deploy/.env`, `docker compose up -d` — les tickets en cours deviennent invalides (les joueurs en reçoivent de nouveaux automatiquement) ; profils et records ne sont pas touchés.

## 3. Mise en service (une fois)
```sh
cd Polarity/deploy
cp env.example .env           # puis éditer .env : TICKET_SECRET, LEADERBOARD_DOMAIN, ALLOWED_ORIGINS
docker compose up -d --build  # construit le service et lance Caddy (le certificat HTTPS est obtenu automatiquement au premier accès)
docker compose ps             # les deux services doivent être « running », « classement » en « healthy »
```
Puis dans GitHub : créer la variable `LEADERBOARD_URL` (voir §2) et relancer le workflow « Publier sur GitHub Pages » (*Actions → Run workflow*).
Le workflow **refuse de publier** si l'adresse est mal formée (pas en `https`, chemin ajouté…) ou si le bundle contient un secret.

## 4. Vérification ponctuelle en production (10 minutes, à faire une fois)
1. **Service vivant** : `curl https://classement.mon-domaine.fr/api/health` → `{"ok":true,"balance":N}` où `N` est la `BALANCE_VERSION` du code déployé.
2. **HTTPS obligatoire** : `curl -i http://classement.mon-domaine.fr/api/health` doit rediriger vers https (Caddy).
3. **CORS strict** : `curl -si -H "Origin: https://pirate.example" https://classement.mon-domaine.fr/api/leaderboard | grep -i access-control` → **aucune ligne** ; avec `-H "Origin: https://<utilisateur>.github.io"` → une ligne `access-control-allow-origin` avec exactement cette origine.
4. **Aucune route d'administration** : `curl -i https://classement.mon-domaine.fr/api/admin` → 404.
5. **Dans le jeu publié** (téléphone ou ordinateur) : bouton *Classement* présent → créer un profil (pseudo) → jouer une partie de Survie jusqu'au bout → l'écran de résultat doit indiquer « **validé** — rang 1 » → le menu Classement affiche votre ligne.
6. **Hors ligne** : couper le réseau, jouer une partie → « en attente » ; rétablir → la partie passe à « validé » (menu Classement → *Envoyer maintenant* si besoin).
7. **Sur le serveur** : `docker compose exec classement node node_modules/tsx/dist/cli.mjs server/admin.ts stats` → 1 joueur, 1 partie ; puis supprimez ce profil de test depuis le jeu (*Supprimer mon profil du classement*).
8. **Pas de secret dans le jeu** : fait automatiquement par `npm run check:bundle` dans le workflow.

## 5. Commandes d'exploitation
Toutes se lancent dans `Polarity/deploy` sur le serveur. Raccourci utilisé ci-dessous : `ADMIN="docker compose exec classement node node_modules/tsx/dist/cli.mjs server/admin.ts"`.
| Besoin | Commande |
|---|---|
| État / journaux | `docker compose ps` · `docker compose logs -f --tail 100 classement` |
| Chiffres (joueurs, parties, tickets, signalements, taille des journaux) | `$ADMIN stats` |
| Contrôle d'intégrité de la base | `$ADMIN check` |
| Signalements en attente | `$ADMIN reports` |
| Masquer un pseudo offensant (remplacé par `Joueur-xxxxxx`, non modifiable) | `$ADMIN hide <pseudo ou identifiant>` |
| Exclure / réintégrer un joueur (hors classement, parties refusées) | `$ADMIN ban <joueur>` · `$ADMIN unban <joueur>` |
| Données d'un joueur (demande d'accès) | `$ADMIN export <joueur>` |
| Supprimer **toutes** les données d'un joueur (demande de suppression) | `$ADMIN delete-player <joueur>` (simulation) puis `… --yes` pour appliquer |

**Il n'existe aucune route HTTP de modération ni de suppression** : pour agir, il faut un accès à la machine. Un joueur peut seulement (1) **signaler** un pseudo, (2) **supprimer son propre profil**, avec son secret, depuis le menu Classement.
Les signalements ne produisent aucun effet automatique : c'est vous qui décidez, avec `reports` puis `hide`/`ban`.

## 6. Sauvegarde et restauration
**Sauvegarder** (à chaud, sans arrêter le service) : `sh sauvegarde.sh` → crée une copie cohérente vérifiée dans `deploy/sauvegardes/classement-AAAAMMJJ-HHMMSS.sqlite`.
Recommandé : une fois par jour (tâche `cron`) **et avant toute mise à jour** ; copier ensuite les fichiers **hors du serveur** (autre machine, stockage externe).
Ne copiez jamais le fichier `leaderboard.sqlite` « à la main » pendant que le service tourne (mode WAL : la copie serait incohérente) : utilisez la commande ci-dessus.

**Restaurer** (remplace la base actuelle ; la base remplacée est conservée dans `/data/avant-restauration/`). `VOL` = nom du volume : `<COMPOSE_PROJECT_NAME>_donnees`, soit `polar-rift-prod_donnees` avec le `.env` fourni (`docker volume ls` le confirme).
```sh
VOL=polar-rift-prod_donnees
FICHIER=classement-AAAAMMJJ-HHMMSS.sqlite          # dans deploy/sauvegardes/
docker compose stop classement
docker run --rm -v "$VOL":/data -v "$PWD/sauvegardes":/s:ro node:22-slim sh -c '
  mkdir -p /data/avant-restauration && cp -a /data/leaderboard.sqlite* /data/avant-restauration/ 2>/dev/null;
  rm -f /data/leaderboard.sqlite-wal /data/leaderboard.sqlite-shm;
  cp /s/'"$FICHIER"' /data/leaderboard.sqlite && chown 1000:1000 /data/leaderboard.sqlite'
docker compose start classement
docker compose exec classement node node_modules/tsx/dist/cli.mjs server/admin.ts check
```
Supprimer les fichiers `-wal` et `-shm` est indispensable : ils appartiennent à l'ancienne base. Test conseillé : restaurer une fois à blanc (bêta) avant d'en avoir besoin.

## 7. Mise à jour du service et retour arrière
**Mettre à jour** (nouveau code, sans changement de règles) : `sh sauvegarde.sh` → `git pull` → `docker compose up -d --build` → `curl …/api/health`. Au démarrage, une base d'un schéma plus ancien est **copiée** (`leaderboard.sqlite.avant-vN.bak`, dans le volume) puis migrée automatiquement.
**Retour arrière** : `git checkout <ancien commit>` → `docker compose up -d --build`. Si la base a été migrée entre-temps, l'ancien code **refuse de démarrer** (« base plus récente que ce service ») sans rien modifier : restaurez alors la sauvegarde faite avant la mise à jour (§6), ou le fichier `.avant-vN.bak`, puis relancez.
Évolution du schéma (pour un développeur) : ajouter une migration à la fin de `MIGRATIONS` dans `server/db.ts` (jamais modifier une existante), puis un test ; `PRAGMA user_version` suit la version.

## 8. Quand `BALANCE_VERSION` change (règles de Survie modifiées)
Le serveur ne rejoue que les parties de **sa** version ; les anciennes versions du jeu seraient refusées (« version non prise en charge », ticket conservé). Donc, **dans cet ordre** :
1. `sh sauvegarde.sh` (les records de l'ancienne version restent en base et consultables, jamais mélangés).
2. Mettre à jour le serveur : `git pull && docker compose up -d --build` ; `curl …/api/health` doit renvoyer la **nouvelle** valeur `balance`.
3. Publier le jeu (merge sur `main` → GitHub Pages). Les joueurs qui ont encore l'ancienne page reçoivent le bandeau « mise à jour disponible » ; leurs parties non envoyées d'ancienne version sont signalées « non validées ».
4. Le classement de la nouvelle version repart vide ; l'ancien reste visible dans le menu (« Version N · ancien »).
Ne jamais déployer le jeu avant le serveur (les joueurs verraient leurs parties refusées).

## 9. Séparer développement, bêta, production
Une **instance = un domaine, un `TICKET_SECRET`, une base** (volumes séparés par `COMPOSE_PROJECT_NAME`). Ne jamais partager un secret ni une base entre instances.
| | Développement | Bêta | Production |
|---|---|---|---|
| Service | `npm run server` en local, `TICKET_SECRET` jetable, `ALLOWED_ORIGINS=http://localhost:5173`, base `./data/` | autre domaine (ex. `classement-beta.…`), **autre serveur ou autre dossier de déploiement** (Caddy occupe les ports 80/443 de la machine) | `deploy/` ci-dessus |
| Jeu | `VITE_LEADERBOARD_URL=http://localhost:8787 npm run dev` | `.env.beta` puis `npm run build:beta` → dossier `dist-beta/` à publier sur un hébergement de test | variable GitHub `LEADERBOARD_URL` (workflow Pages) |
`.env.example` à la racine documente la variable du jeu ; `deploy/env.example` celle du service. Les fichiers `.env*` réels sont ignorés par git.

## 10. Croissance de la base — et ce qui n'est jamais fait automatiquement
La table `runs` conserve le **journal des entrées** de chaque partie validée (preuve et audit). Ordre de grandeur : quelques Ko par partie ; `$ADMIN stats` donne la taille cumulée.
**Aucune purge automatique** : rien n'est jamais supprimé sans votre commande. Si la base devient trop grosse : `sh sauvegarde.sh`, puis `$ADMIN prune --older-than-days 365` (simulation : affiche ce qui serait supprimé),
puis le même avec `--yes`. Les parties qui sont des records en cours, tous les joueurs et tous les records sont toujours conservés. Les journaux de journalisation Docker sont plafonnés (5 × 10 Mo).

## 11. Si quelque chose ne va pas
| Symptôme | Cause probable | Action |
|---|---|---|
| Le service refuse de démarrer, « Configuration invalide » | variable manquante ou mal formée (`TICKET_SECRET` < 32 car., origine avec `/` final, `http://` en production…) | lire `docker compose logs classement` ; corriger `.env` |
| « base plus récente que ce service » | retour arrière de code après migration | §7 |
| Caddy n'obtient pas de certificat | DNS pas encore propagé, ports 80/443 fermés | vérifier le DNS et le pare-feu du serveur |
| Dans le jeu : « Classement indisponible » | service arrêté ou injoignable | le jeu reste jouable ; `docker compose ps` ; les résultats sont envoyés au retour |
| Erreur CORS dans la console du navigateur | `ALLOWED_ORIGINS` ne correspond pas exactement à l'origine du jeu | corriger `.env`, `docker compose up -d` |
| Joueurs bloqués derrière la même adresse (réseau d'école…) | limites par adresse IP : 5 inscriptions/h | normal ; réessayer plus tard |
| Parties refusées avec « Trop de requêtes : réessayez plus tard. » pour tout le monde | plafond global de rejeux atteint | attendre 1 minute ; augmenter `MAX_REPLAYS_PER_MINUTE` si la machine le permet |

## Achats et publicités récompensées (phase 5, facultatif)
Schéma SQLite **v8** (migration additive automatique, copie `.avant-vN.bak`). Variables : `deploy/env.example` (section phase 5) ; chaque fournisseur reste désactivé si une variable manque. Adresses à déclarer chez les fournisseurs : `/api/payments/notify/apple`, `/api/payments/notify/google` (authentification : jeton OIDC Pub/Sub recommandé, ou `?token=`), `/api/ads/ssv`. Le service doit rester joignable en HTTPS et en continu. Détail et liste complète : `docs/MONETISATION.md`.
