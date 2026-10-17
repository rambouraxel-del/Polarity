# Publication de la mise à jour « Économie v3 » sur la bêta actuelle

> **Statut : rien n'est publié.** Ce document est la procédure à suivre APRÈS l'accord explicite du propriétaire. Aucune commande de ce document n'a été exécutée sur la production.
> Branche prête : `feat/polar-rift-economie-v3` (commit exact indiqué dans le rapport final et dans `RESUME.md`). `main` n'est pas modifiée tant que l'étape 4 n'est pas autorisée.

## 0. Principes
- **Une seule bêta, pas de staging public** : on réduit le risque par l'ordre (serveur d'abord), la sauvegarde cohérente avant tout, un contrôle court, et un retour arrière prévu.
- **Ne jamais écraser la base existante** : le service migre en AJOUTANT des tables/colonnes (schéma v8) après avoir copié l'ancienne base (`.avant-vN.bak`) ; la restauration ne remplace jamais sans avoir d'abord conservé la base courante.
- **Le `TICKET_SECRET` de production ne change pas** (sinon les tickets en cours sont invalidés). Aucun secret n'est copié dans GitHub.
- `BALANCE_VERSION` reste **3** : les records existants restent valides, aucun classement n'est remis à zéro.
- Les achats réels et les publicités restent **désactivés** tant que les prérequis externes (§ 9) ne sont pas configurés : la bêta est entièrement jouable sans eux.

## 1. Inventaire de l'existant (à faire AVANT, 5 minutes, rien ne change)
| Quoi | Commande / endroit | Valeur à noter |
|---|---|---|
| Jeu publié (version, build) | `curl -s https://<utilisateur>.github.io/Polarity/version.json` | `version`, `build` |
| Commit publié | GitHub → Actions → dernier « Publier sur GitHub Pages » vert ; `git log -1 main` | SHA (attendu : `836be7d` ou plus récent) |
| Variable `LEADERBOARD_URL` | GitHub → Settings → Secrets and variables → Actions → **Variables** | adresse https du service (**doit exister** : sans elle, le jeu publié n'aura AUCUNE fonction en ligne) |
| Service en marche | `curl -s https://<service>/api/health` | `{"ok":true,"balance":3}` |
| Commit du service | sur le serveur : `cd Polarity && git rev-parse HEAD && git status --short` | SHA ; l'arbre doit être propre |
| Conteneurs / image | `cd deploy && docker compose ps && docker compose images` | état « healthy » |
| Version du schéma SQLite et du moteur | `docker compose exec classement node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/leaderboard.sqlite',{readOnly:true});console.log(d.prepare('PRAGMA user_version').get(),d.prepare('select sqlite_version() v').get(),process.version)"` | `user_version` (attendu 2 à 7 selon l'âge du service), version SQLite, version Node |
| Espace disque et taille de la base | `docker compose exec classement ls -la /data` ; `df -h` | taille ; la migration crée une copie : prévoir ≥ 2 × la taille de la base |

Ne lancez **pas** `server:admin` avant la mise à jour : il ouvre la base avec le code courant et la **migrerait** (copie `.bak` incluse) plus tôt que prévu.

## 2. Compatibilité ascendante des API (vérifiée)
- Toutes les évolutions de l'API depuis `main` sont **additives** (nouvelles routes, champs en plus ; format de rejeu 1 toujours accepté ; `GET /api/leaderboard` sans catégorie = « Sans bonus » = anciens records).
- **Vérifié par exécution** : le jeu publié aujourd'hui (code de `main`, `836be7d`) a été construit puis piloté dans un navigateur contre le NOUVEAU service (script `e2e-classement` de `main` : inscription, tickets, partie rejouée et validée, hors ligne, résultat falsifié refusé, redémarrage) : **20/20 contrôles passés**. Donc, pendant l'intervalle entre l'étape 2 (serveur) et l'étape 4 (jeu), les joueurs actuels ne voient aucune régression.
- Sens inverse (nouveau jeu face à l'ancien service) : **non pris en charge** (les nouvelles routes y répondent 404 : les fonctions de compte, calendrier, boutique en ligne seraient indisponibles). D'où la règle : **service d'abord, jeu ensuite, jamais l'inverse**.
- Sauvegardes locales des joueurs : le nouveau jeu migre l'ancien format (6 → 10) une seule fois, conserve une copie dans le navigateur (`polarite.save.avant-v6`) ; testé sur une sauvegarde produite par le code de `main` (fixture `tests/fixtures/save-main-v6.json`, e2e section 0).

## 3. Préparation (sans rien toucher en production)
1. **Contrôles locaux** sur le commit à publier : `git checkout feat/polar-rift-economie-v3 && npm ci && npm run check && npm run check:bundle && npm run e2e` (≈ 4 minutes ; tout doit passer).
2. **Sauvegarde cohérente de la base de production** (à chaud, sans arrêt) : sur le serveur, `cd Polarity/deploy && sh sauvegarde.sh` → `deploy/sauvegardes/classement-AAAAMMJJ-HHMMSS.sqlite` (copie `VACUUM INTO` vérifiée par `check`). **Copiez-la hors du serveur** (autre machine). Notez son nom : c'est le point de restauration `SAUVEGARDE_AVANT`.
3. **Migration jusqu'au schéma actuel, sur une COPIE** (l'original n'est jamais touché) — sur votre machine, avec le fichier de sauvegarde copié :
   `npm ci && npm run server:migrate-check -- classement-AAAAMMJJ-HHMMSS.sqlite`
   Attendu : `MIGRATION VALIDÉE sur la copie : intégrité OK, aucune ligne perdue` (versions avant/après affichées). Un refus (code 2) **bloque la publication**.
   Variante sur le serveur avec la nouvelle image, sans redémarrer le service : `docker compose build` puis
   `docker compose run --rm --no-deps -v "$PWD/sauvegardes":/s:ro classement node node_modules/tsx/dist/cli.mjs server/migrate-check.ts /s/classement-….sqlite`.
4. **Variables d'environnement** : `deploy/.env` existant **reste valable tel quel**. Les nouvelles variables (achats, publicité, notifications) sont **facultatives** et vides par défaut (`deploy/env.example`, `docs/MONETISATION.md`) : ne rien ajouter pour la bêta sans paiement. Vérifier que `deploy/docker-compose.yml` est celui de la branche (il transmet désormais ces variables au conteneur).
5. **Repères de retour arrière** (tags, locaux tant qu'ils ne sont pas poussés — à créer seulement avec votre accord) : `git tag beta-avant-eco-v3 <SHA de main actuel>` ; `git tag beta-eco-v3 <commit publié>`.
6. Vérifier que la variable GitHub `LEADERBOARD_URL` est bien définie (§ 1) : le workflow `pages.yml` refuse de publier si elle est mal formée.

## 4. Déploiement coordonné (ordre obligatoire)
### Étape A — Service (≈ 10 min, coupure de quelques secondes)
```sh
cd Polarity/deploy
sh sauvegarde.sh                                   # dernière sauvegarde juste avant (copiée hors du serveur)
git fetch origin feat/polar-rift-economie-v3        # la branche doit avoir été poussée (autorisation requise)
git checkout <RELEASE_SHA>                          # commit exact annoncé dans le rapport final
docker compose build                                # construit sans redémarrer
docker compose up -d                                # redémarre : migration v→8 automatique, copie .avant-vN.bak créée dans /data
docker compose ps                                   # « classement » doit devenir healthy
curl -s https://<service>/api/health                # {"ok":true,"balance":3}
docker compose logs --tail 40 classement            # « Achats : Apple désactivé, Google Play désactivé… » ; aucune erreur
docker compose exec classement ls -la /data         # présence de leaderboard.sqlite.avant-vN.bak
docker compose exec classement node node_modules/tsx/dist/cli.mjs server/admin.ts check   # « Base intègre »
```
Contrôle immédiat avec le jeu ACTUEL (toujours en ligne) : ouvrir la bêta, jouer une partie de Survie → « validé — rang… » (la compatibilité ascendante en conditions réelles). **Attendre au moins quelques heures** avant l'étape B si possible (observation des journaux).
Si l'étape A échoue : voir § 6 (le jeu actuel n'a pas changé, rien n'est perdu).

### Étape B — Jeu (GitHub Pages ; ≈ 5 min)
Uniquement après accord explicite et étape A saine :
```sh
git checkout main && git merge --no-ff feat/polar-rift-economie-v3   # ou une Pull Request (recommandé : revue visible)
git push origin main                                                  # déclenche « Publier sur GitHub Pages » : npm test → build → check:bundle → déploiement
```
Suivre l'exécution dans GitHub → Actions. Puis `curl -s …/version.json` : le champ `build` change. Les joueurs qui gardent l'ancienne page reçoivent le bandeau « mise à jour disponible ».

## 5. Contrôle manuel court après publication (≈ 10 minutes, avec votre vrai profil de bêta)
1. **Service** : `/api/health` (balance 3) ; `docker compose logs --tail 100 classement` sans erreur 500 ; `server:admin stats` cohérent (joueurs, parties, registre).
2. **Votre progression** : ouvrir le jeu ; pseudo, records, Éclats, cosmétiques identiques à avant (migration unique) ; l'écran « Compte » indique votre profil ; **ne jamais vider les données du navigateur** pendant ce contrôle.
3. **Boutique** : soldes affichés ; onglet **Prismes** = packs 30/100/380 à 0,99/2,99/9,99 € **achats désactivés avec explication** (aucun fournisseur configuré) ; acheter 1 Boost (50 Éclats) avec confirmation.
4. **Survie** : préparation → partie avec Boost → mort → écran « Deuxième chance » (publicité « indisponible dans cette version », 5 Prismes ; « Prismes insuffisants » si solde nul) → terminer.
5. **Calendrier** : ouvrir, réclamer le jour 1 (20 Éclats), une seule fois.
6. **Classements** : « Sans bonus » (vos anciens records), « Avec bonus », **Défi quotidien**.
7. **Console du navigateur** vide d'erreurs ; sur téléphone : portrait puis paysage.
Un échec bloquant → retour arrière (§ 6). Les anomalies non bloquantes sont notées, pas de retour arrière.

## 6. Retour arrière (préserve les nouvelles données)
**Règle d'or** : avant toute opération destructive, `sh sauvegarde.sh` (nom `ETAT_COURANT`) : la base courante, avec les données créées depuis la mise à jour, est ainsi conservée ; on ne supprime ni n'écrase jamais rien sans cette copie.

| Niveau | Quand | Action | Données nouvelles |
|---|---|---|---|
| **R0 — jeu seul** | problème d'interface | `git revert -m 1 <SHA du merge>` sur `main` → push (nouvelle révision, pas de réécriture d'historique) → Pages republie l'ancien jeu | Intactes : le service (nouveau) reste compatible avec l'ancien jeu (§ 2). Les sauvegardes locales v10 sont lues par l'ancien jeu comme « version plus récente » : l'original est copié tel quel dans `polarite.save.corrompue` et la sauvegarde active est réécrite au format ancien à la première modification ; les monnaies viennent du service. Limite : le compteur local d'usage de Boost/Gel peut repartir de zéro au retour du nouveau jeu (au pire quelques charges non déduites, jamais de perte de monnaie). |
| **R1 — configuration** | un fournisseur de paiement/pub se comporte mal | vider ses variables dans `deploy/.env` puis `docker compose up -d` : fournisseur désactivé, achats indisponibles | Intactes |
| **R2 — code du service** | bug du service, schéma inchangé | `git checkout <commit précédent de la branche, au plus tôt c13d3ad (introduction du schéma v8)>` puis `docker compose up -d --build` | Intactes (même schéma v8) ; un commit antérieur à `c13d3ad` refuse la base v8 : voir R3 |
| **R3 — service antérieur à la mise à jour** (dernier recours) | seulement si R0–R2 impossibles | voir « Procédure R3 » ci-dessous | Les données créées depuis la mise à jour ne sont **pas** dans la base active mais **intactes dans `ETAT_COURANT`** et dans le dossier daté `avant-restauration-…`. |

### Un ancien service ne peut pas ouvrir une base v8
Après la mise à jour, la base est au schéma **v8**. Le service d'avant la mise à jour (et tout code antérieur à v8) **refuse de démarrer** sur elle : « Base de données de version 8, plus récente que ce service… aucune donnée n'a été modifiée » (garde présente dans le code de production actuel : `openDb` s'arrête AVANT toute migration ; vérifié sur `main` et par test). Conséquences :
- un simple `git checkout <ancien commit>` + `docker compose up -d --build` **ne fonctionne pas** (le conteneur redémarre en boucle, la base n'est pas touchée) ; ne **jamais** forcer en modifiant `PRAGMA user_version` à la main (l'ancien code travaillerait sur un schéma qu'il ne connaît pas) ;
- revenir à un service antérieur impose de **restaurer un fichier de base antérieur** : seule la procédure R3 ci-dessous le fait, et **sans rien écraser** ;
- tout retour au niveau R2 (code plus récent ou égal à l'introduction du schéma v8) reste possible sans toucher aux données.

### Procédure R3 (aucune donnée écrasée silencieusement)
1. **Figer l'état courant** : `sh sauvegarde.sh` → `ETAT_COURANT` (copie cohérente vérifiée par `check` ; le script **refuse d'écraser** un fichier existant et horodate le nom). Copier ce fichier **hors du serveur**. Ne pas continuer sans lui.
2. `docker compose stop classement` (plus aucune écriture).
3. **Restaurer `SAUVEGARDE_AVANT`** avec la commande du § 6 du guide de déploiement : la base active est d'abord copiée dans un dossier **daté** `/data/avant-restauration-AAAAMMJJ-HHMMSS/` (jamais réutilisé, la commande s'arrête si la copie échoue ou si le dossier existe) ; ensuite seulement la sauvegarde la remplace. (Alternative sans remplacement : le fichier `leaderboard.sqlite.avant-vN.bak` créé par la migration est exactement l'état d'avant.)
4. `git checkout <ancien commit du service>` puis `docker compose up -d --build` (et non `start`), puis `curl …/api/health` et `server:admin check`.
5. Noter dans `RESUME.md` le nom de `ETAT_COURANT` : il contient les parties, profils et monnaies créés depuis la mise à jour. Pour les retrouver plus tard : redéployer le service récent sur `ETAT_COURANT` (la période pendant laquelle l'ancien service a tourné n'est pas fusionnée automatiquement : prévoir une reprise manuelle des joueurs ayant joué entre-temps, par `server:admin export`).
Interdits : supprimer le volume `donnees`, `docker compose down -v`, copier un fichier sur `leaderboard.sqlite` sans l'étape 3.

Ordre en cas de retour arrière complet : jeu (R0) **puis** service (R3).

## 7. Après publication
- Noter dans `RESUME.md` : date, SHA du service et du jeu, version du schéma, résultat du contrôle.
- Sauvegarde quotidienne conseillée (cron) + copie hors serveur ; la clôture du Défi quotidien (00 h 15 UTC) et la réconciliation des paiements tournent dans le service (minuterie) : le service doit rester démarré en continu (relancé automatiquement par Docker).
- Aucun achat réel n'est actif : voir § 9 avant toute activation.

## 8. Ce qui a été vérifié ici, et ce qui ne l'a pas été
| Vérifié (local, simulateurs) | NON vérifié (nécessite la production ou des comptes externes) |
|---|---|
| typecheck, ≈ 770 tests unitaires, build, contrôle du bundle (aucun secret) | Déploiement Docker/Caddy réel (pas de Docker ici) : les commandes sont celles du guide existant |
| Parcours navigateur complet contre un service local réel (économie, pouvoirs, reprises, calendrier, classements, 3 tailles d'écran) | Configuration de Caddy pour masquer le jeton d'adresse des notifications dans les journaux (voir `docs/MONETISATION.md`) |
| Migration sur copie (versions 3 → 8 testées), ancien jeu contre nouveau service, ancienne sauvegarde dans le nouveau jeu | Tout paiement ou publicité réels (Apple, Google Play, AdMob), plugins natifs, applications Android/iOS |

## 9. Prérequis externes restant à configurer (aucun n'est requis pour publier la bêta)
1. **Rien d'obligatoire** pour la bêta web : le service et le jeu fonctionnent sans achats ni publicités.
2. **Comptes (facultatif, déjà prévu depuis la phase 1)** : identifiants Google/Apple, `RESEND_API_KEY` + `MAIL_FROM` + `APP_PUBLIC_URL` (`docs/COMPTES.md`) ; sans cela, seul le profil invité/pseudo existe (ce qui suffit aux récompenses gratuites).
3. **Achats réels** : identifiant d'application définitif, comptes développeur Apple/Google, 3 produits consommables, clés serveur, plugin natif de facturation, politique de confidentialité (`docs/MONETISATION.md`).
4. **Publicité récompensée** : compte AdMob, bloc récompensé avec vérification côté serveur, plugin natif, consentement.
5. **Prestataire de paiement web** : choix du propriétaire (aucun n'est intégré).

## 9 bis. Mise à jour « Survie à phases » (BALANCE_VERSION 4)
Aucun schéma SQLite à migrer. **Service d'abord, jeu ensuite** : le jeu v4 envoie `balance: 4` ; un service v3 refuserait ses parties (`unsupported_balance`), et un service v4 refuse les parties d'un jeu v3. Les records de la v3 restent consultables (sélecteur de version du classement) ; côté joueur, les records locaux de la v3 sont rangés dans l'archive (Survie et « Avec bonus » ; le défi quotidien, inchangé, garde ses records). Le rejeu de parties longues (phase 2) coûte plus de calcul : surveiller le CPU du service après publication.

## 9 ter. Mise à jour « refonte cosmétique » (hitbox +15 %, nouveau catalogue de skins)
À faire **sur autorisation**, service d'abord, jeu ensuite (aucune étape n'a été exécutée) :
1. **Le rejeu serveur doit utiliser le même code `src/`** : la hitbox du vaisseau est passée à ×1,15 (`HITBOX.playerScale`, `config/hitbox.ts`) alors que `BALANCE_VERSION` reste **4** (décision du propriétaire attendue : rester à 4 ou passer à 5). Un service resté sur l'ancienne hitbox pourrait refuser certaines parties du nouveau jeu (rejeu différent).
2. Le service doit aussi connaître le **nouveau catalogue** (`config/catalog.ts` / `config/skins.ts`) : sans cela, les achats de skins (Éclats en différé, Prismes via `/api/shop/prisms`) sont rejetés « article inconnu » et `server/accounts.ts` ne sait pas encore débiter un article « au choix ».
3. Procédure habituelle : sauvegarde de la base (`server:migrate-check` sur une copie), mise à jour du conteneur, vérification, puis publication du jeu (`git push origin main`, GitHub Pages). Aucun changement de schéma SQLite.
4. Les anciens skins n'existent plus : une sauvegarde qui en équipe un retombe sur « Tôle brute » ; les Médailles déjà dépensées pour d'anciens skins ne sont pas remboursées.

## 10. Jeu publié avant le service (cas constaté) : diagnostic et résolution
**Constat** : la branche `feat/polar-rift-economie-v3` a été fusionnée dans `main` (PR n° 1) : GitHub Pages publie donc le **nouveau jeu**, alors que le service OVH est resté **à l'ancienne version** (celle de `836be7d` : classement seulement). L'ordre prévu au § 4 (service d'abord) n'a pas été suivi ; ce n'est pas un défaut du nouveau code.
**Reproduit en local** (ancien service lancé sur une base de test + nouveau jeu construit pour lui) : les trois anomalies apparaissent exactement :
| Anomalie observée | Cause | Preuve |
|---|---|---|
| Défi quotidien : « Classement indisponible : Route inconnue » | `GET /api/daily/leaderboard` n'existe pas dans l'ancien service (404) | réponse `{"error":"not_found","message":"Route inconnue."}` |
| Calendrier : présence « provisoire », aucune récompense | `POST /api/loyalty/checkin` absent (404) ; l'ancien service n'a pas non plus de profil invité (`POST /api/register` sans pseudo → 400) | idem |
| 640 Médailles « en attente de confirmation » | `POST /api/sync` absent (404) : rien ne peut être confirmé | idem |
Routes du jeu absentes de l'ancien service : `/api/{profile,sync,migrate,loyalty/*,daily/*,tickets/start,shop/prisms,revive,payments/*,ads/*,auth/*}`. URL configurée, versions : le jeu utilise la variable publique `LEADERBOARD_URL` (celle du service OVH) ; le service répond bien (`/api/health` → `{"ok":true,"balance":3}` **sans champ `api`** = version d'avant l'économie v3).
**Aucune logique de synchronisation n'a été modifiée artificiellement.** Ce qui a été ajouté au jeu : détection explicite d'un service pas à jour (réponse « route inconnue » à une route récente, ou inscription invité refusée), message dédié **distinct de « hors ligne »** (« Le service en ligne n'est pas encore à jour pour cette version du jeu… rien n'est perdu »), arrêt des requêtes vouées à l'échec pendant 5 minutes, calendrier non ouvert automatiquement ; le service à jour annonce `api: 2` dans `/api/health`.
**Données préservées** : Médailles réclamées, achats, charges, présence et parties classées en attente restent sur l'appareil (file « en attente », compteurs monotones) et sont confirmés **dès que le service est mis à jour** (migration unique de l'ancienne sauvegarde, idempotente). Aucun effacement, aucun crédit artificiel.
**Pour résoudre (aucune de ces étapes n'a été faite : le VPS n'a pas été touché)** — suivre §§ 1 à 5 : (1) inventaire (`curl …/api/health` : pas de champ `api` = ancien service) ; (2) sauvegarde `sh sauvegarde.sh` copiée hors du serveur ; (3) `server:migrate-check` sur la copie ; (4) sur le VPS : `git fetch && git checkout <commit de main>` puis `docker compose build && docker compose up -d` (migration v→8 automatique avec copie `.avant-vN.bak`) ; (5) vérifier `curl …/api/health` → `{"ok":true,"balance":3,"api":2}` ; (6) rouvrir le jeu : Défi quotidien, calendrier, Médailles se débloquent seuls (bouton « Synchroniser maintenant » dans Options → Compte pour forcer). Les variables du service (`TICKET_SECRET`, `ALLOWED_ORIGINS`…) restent celles de la production ; les nouvelles sont facultatives. Tant que le service n'est pas à jour, le jeu reste jouable et le classement historique continue de fonctionner.

**Diagnostic en lecture seule avant la mise à jour** : `sh deploy/diagnostic-vps.sh` (sur le VPS, depuis `deploy/`) vérifie commit, version API, conteneurs, volume et chemin de la base, `user_version`, disque, sauvegardes, `.env` (TICKET_SECRET jamais affiché : seulement « identique au conteneur » oui/non) et outils. Il n'ouvre la base qu'en lecture seule et ne lance pas `server:admin`.
