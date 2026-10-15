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
| **R2 — code du service** | bug du service, schéma inchangé | `git checkout <commit précédent de la branche>` puis `docker compose up -d --build` | Intactes (même schéma v8) |
| **R3 — service antérieur à la mise à jour** (dernier recours) | seulement si R0–R2 impossibles | 1) `sh sauvegarde.sh` (= `ETAT_COURANT`, **conservée**) ; 2) `docker compose stop classement` ; 3) restaurer `SAUVEGARDE_AVANT` (§ 6 du guide de déploiement : la base remplacée est copiée dans `/data/avant-restauration/`) ; 4) `git checkout <ancien commit>` ; `docker compose up -d --build` | Les données créées depuis la mise à jour ne sont **pas** dans la base active mais **intactes dans `ETAT_COURANT`** (et dans `/data/avant-restauration/`). Pour les récupérer plus tard : redéployer le nouveau service sur `ETAT_COURANT` (les deux périodes ne se fusionnent pas automatiquement : prévoir une reprise manuelle si des joueurs ont joué entre-temps). |

Un ancien code **refuse de démarrer** sur une base plus récente (« base plus récente que ce service ») sans la modifier : c'est la protection prévue ; il ne faut donc jamais « forcer » : on passe par R3.
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
