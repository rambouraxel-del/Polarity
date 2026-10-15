# Comptes, migration et synchronisation (économie v3 — phases 1 et 2)

> Suivi des six phases : `docs/ETAT_MAJ_ECONOMIE.md`. Cette page décrit ce qui est **implémenté** en phase 1 et ce qu'il faut **configurer** pour l'activer.
> **Rien de tout cela ne change le jeu tant que le service n'est pas configuré** : sans `LEADERBOARD_URL`, le jeu reste local, complet, sans compte (l'entrée « Compte » est masquée).

## Ce que voit le joueur
- **Profil invité automatique** : dès que le service est joignable, un profil anonyme est créé (aucune saisie, aucune inscription). Il est absent du classement public tant que le joueur n'a pas choisi de pseudo.
- **Connexion facultative** (Options → Compte) : Google, Apple ou **lien magique par courriel**. Plusieurs méthodes peuvent être associées à un même profil (jamais la dernière retirée). Un compte connecté sera **obligatoire pour les futurs achats de Prismes** (phase 4) ; pas pour jouer.
- **Plusieurs appareils** : se connecter sur un autre appareil retrouve le profil ; la progression est fusionnée (union des succès et cosmétiques, meilleurs records vérifiés, monnaies sans double crédit). La **réserve d'Éclats de campagne reste séparée**.
- **Hors ligne** : le jeu fonctionne comme avant. Les Éclats gagnés et les achats sont **provisoires** (enregistrés sur l'appareil) et confirmés à la synchronisation suivante ; aucun Prisme n'est jamais gagné hors ligne. Une partie classée interrompue garde son résultat provisoire, validé plus tard par le rejeu complet du serveur.
- Aucune requête pendant une partie ; synchronisation regroupée (≥ 10 s entre deux, différée 45 s après une écriture) et au retour en ligne.

## Migration des anciennes sauvegardes
- Au premier lancement après la mise à jour, la sauvegarde (formats ≤ 6) est migrée **localement** en format 7 (copie `polarite.save.avant-v6` conservée par le mécanisme existant), même sans Internet. Le solde d'Éclats hérité est mémorisé dans `economy.legacy`.
- À la première synchronisation (`POST /api/migrate`), elle est importée **intégralement** : Éclats, succès, cosmétiques, statistiques, records. **Une seule fois par installation** (idempotent : `ledger.ref = import:<installId>`), 3 installations héritées au plus par profil. La réserve de campagne est conservée telle quelle (séparée).
- Les Médailles des anciens succès seront réclamables rétroactivement en **phase 2** (le registre `rewarded` et les succès sont déjà importés).
- **Risque documenté (migration exceptionnelle)** : une ancienne sauvegarde locale est, par nature, falsifiable ; elle est acceptée telle quelle UNE fois pour ne pas pénaliser les joueurs existants. Limites : plafond de solde (2 000 000), jamais de Prismes, articles premium refusés, une installation = un seul profil. **Cette confiance ne s'applique pas aux nouvelles transactions** (voir ci-dessous).

## Modèle de sécurité
- **Le serveur est la source de vérité des monnaies** : solde = somme du registre `ledger` (unique par `(profil, ref)` → idempotence). Le portefeuille local est provisoire.
- Gains répétables : compteur monotone du client + **filigrane** accepté par installation, borné par un seau (3000, +1500/h, rechargé par le temps, pas par le nombre de requêtes). Récompenses uniques (succès, niveaux) : montants fixés par la configuration du jeu côté serveur.
- Achats : prix vérifié sur le catalogue, solde vérifié, jamais deux débits ; articles premium (Prismes) toujours refusés ; cosmétiques « possédés » sans achat vérifié retirés de la progression synchronisée.
- **Prismes** : aucune route ne les crédite depuis le client.
- Authentification : `Authorization: Bearer <playerId>.<secret>` ; accès par appareil (empreinte seule stockée, révocable) ; anciens accès conservés après fusion (alias).
- Fusion : seul un invité (sans méthode de connexion) peut être fusionné dans le compte retrouvé par une **preuve vérifiée** ; conflit = 409 puis confirmation explicite ; compte ↔ compte refusé ; registre `merges`.
- OIDC (Google/Apple) : signature RS256 vérifiée via JWKS, émetteur / audience / expiration contrôlés, **nonce à usage unique** délivré par le serveur (anti-rejeu). Lien magique : code de 8 caractères (empreinte seule), 5 essais, 15 min, 3 demandes/h par adresse, réponse toujours identique (pas d'énumération), adresse effacée après usage (seule une empreinte reste pour reconnaître le compte).
- Aucun secret dans le jeu : seuls des **identifiants clients publics** sont servis par `GET /api/auth/providers`. `npm run check:bundle` le vérifie.

## Configuration (ce que le propriétaire doit fournir)
Variables du service (`deploy/env.example`, relayées par `deploy/docker-compose.yml`). Une méthode sans configuration reste **désactivée** et masquée (« non configurée sur le service »).

| Méthode | Variables | Où l'obtenir |
|---|---|---|
| Google | `GOOGLE_CLIENT_IDS` (web, Android, iOS, séparés par des virgules), `GOOGLE_WEB_CLIENT_ID` | Google Cloud Console → Identifiants → ID client OAuth ; origine JavaScript autorisée = domaine du jeu |
| Apple | `APPLE_CLIENT_IDS`, `APPLE_WEB_CLIENT_ID` | Apple Developer → identifiant de service (web) et identifiant d'application (iOS) ; adresse de retour = adresse du jeu |
| Courriel | `RESEND_API_KEY` (**secret**), `MAIL_FROM` (expéditeur vérifié), `APP_PUBLIC_URL` (https) | Compte Resend + domaine vérifié (SPF/DKIM) |

Application native (Capacitor) : l'interface cherche le module de connexion sociale `Capacitor.Plugins.SocialLogin` (ex. `@capgo/capacitor-social-login`). **Il n'est pas installé** dans cette version : sur mobile, Google/Apple sont affichés « module natif non inclus » ; le lien magique par courriel fonctionne partout. L'installation du module exige les identifiants natifs ci-dessus et un nouveau build (`docs/BUILD_MOBILE.md`).

Le service doit être **redéployé** (schéma SQLite v3, additif ; sauvegarde avant : `deploy/sauvegarde.sh`). L'API publique existante (`/api/register` avec pseudo, classement, tickets) reste compatible.

## Code
`src/account/` (`AccountService` : invité, migration, synchronisation hors ligne ; `providers.ts` : Google / Apple / natif), `src/economy/` (règles, fusion, réconciliation, identifiants — partagés avec le serveur), `src/ui/accountScreens.ts`, `server/accounts.ts` (routes, registre), `oidc.ts`, `mailer.ts`, `profile.ts`. Tests : `tests/accounts-server.test.ts`, `tests/accounts-client.test.ts`.

## Phase 2 : Médailles, bonus, articles premium (sauvegarde v8, schéma SQLite v4)

### Sauvegarde locale : format 8
Ajouts (migration additive, `save.ts` : sanitize + migrate ; copie `polarite.save.avant-v<n>` conservée) :
- `wallet.medals` (Médailles) ; `wallet.prisms` reste un **reflet du service** ;
- `medals.claimed` : succès dont les Médailles ont été réclamées (identifiants historiques immuables) ; **distinct** de `rewarded` (anciens Éclats) ;
- `inventory {boost, gel}` : charges de bonus possédées (0–99) ;
- `economy` : `confirmed` (derniers soldes confirmés par le service), `confirmedClaims`, `managed` (service configuré), `bonusBought` / `bonusProcessed` (compteurs monotones des charges achetées / traitées par le service).
Migration v<8 : les cosmétiques que les succès débloquaient directement (glace, solaire, prisme, citron, boréale) passent dans `owned` pour les succès **déjà obtenus** ; aucune Médaille créditée ; `rewarded`, Éclats, `economy.legacy` inchangés.

### Service : schéma SQLite v4 (additif, `MIGRATIONS` dans `server/db.ts`)
`installs.bonus_boost`, `installs.bonus_gel` (compteurs des charges traitées par installation). Le registre `ledger` accueille de nouvelles valeurs de `currency` : **`medals`** (clé `medal:<succès>`), **`boost`** et **`gel`** (clés `bonus:<bonus>:<installation>:<compteur>:pay|grant`) et des `spend:<article>` en `medals` ou `prisms`. Base d'un schéma plus ancien : copie `…avant-v3.bak` puis migration automatique (testé). Redéploiement du service requis.

### Règles du service (`POST /api/sync`, dans l'ordre de réception)
1. **Médailles** : un crédit unique par succès (`medal:<id>`), montant de la configuration, si le succès figure dans la progression ; sinon la réclamation est refusée (`rejectedClaims`) et retirée localement. Un succès importé d'une ancienne sauvegarde reste réclamable ; deux appareils ou deux profils fusionnés ne créditent qu'une fois.
2. Gains d'Éclats (phase 1), 3. récompenses historiques (phase 1), 4. **achats de cosmétiques** : article du catalogue, payable en Médailles, **le service débite le prix du catalogue** (jamais le montant annoncé), solde réel suffisant sinon refus (`insufficient`) ; jamais de solde négatif ; article déjà possédé jamais débité ; articles premium refusés en différé.
5. **Bonus** : seul l'écart avec le compteur déjà traité compte ; financé par le solde réel d'Éclats, dans la limite du stock (99) ; la part refusée est comptée (`bonusRejected`) et le compteur avance (pas de réessai) ; l'application retire les charges refusées.
6. Fusion de la progression. La réponse porte les soldes, l'inventaire et les Médailles réclamées **du registre** (source de vérité).
`POST /api/shop/prisms { item }` : achat d'un article **premium**, en ligne uniquement ; le solde de Prismes vient du registre ; débit atomique dans une transaction, idempotent (`spend:<article>` unique), prorata si un élément du pack est déjà possédé, 409 si solde insuffisant. **Aucune route ne crédite des Prismes.**

### Côté jeu
`economy/funds.ts` : avec un service configuré, un achat n'est financé que par le solde **confirmé** (les gains provisoires — éclats d'orbite, Médailles réclamées hors ligne — attendent leur confirmation) ; sans service, tout le portefeuille local est dépensable. À chaque synchronisation (`reconcile.ts`), l'application s'aligne sur le service avec l'**instantané** envoyé (les gains faits pendant la requête sont conservés) ; un article premium que le service ne reconnaît pas est retiré de la sauvegarde locale.

### Risques et limites documentés
- Les **succès sont déclarés par le client** (statistiques locales) : un joueur qui falsifie sa sauvegarde peut déclarer des succès et réclamer des Médailles. Le dommage est borné (1 650 Médailles au total, une seule fois par succès et par profil, uniquement des cosmétiques non premium, aucun avantage de jeu). Un contrôle par rejeu serveur des succès de survie est envisageable (phase 6) ; les Prismes, eux, ne dépendent jamais d'une donnée locale.
- Effacer la progression locale d'un joueur **connecté** puis se synchroniser restaure les soldes et possessions du service (le service est la source de vérité).
- Les effets des bonus en partie, la consommation des charges et leur provenance dans les parties classées sont **hors phase 2** (phase 3).

## Phase 3 : usage des charges et reprises payées (sauvegarde v9, schéma SQLite v5)
- **Sauvegarde format 9** : `survivalBonus` (record local « avec bonus »), `economy.bonusUsed` (compteur monotone des charges consommées), `economy.liveUse` (part de la partie en cours, remise à zéro au chargement). Migration additive depuis la v8.
- **`POST /api/sync`** : nouveau champ facultatif `bonusUsed` (charges consommées dans des parties NON envoyées ; seul l'écart avec le compteur de l'installation consomme des charges, une fois, jamais sous zéro). Les charges d'une partie classée passent par son rejeu (`use:<ticket>:<kind>`), jamais par ce champ ; la partie en cours n'est jamais déclarée.
- **Réconciliation** (`applySyncResult`, option `pendingUse`) : l'inventaire local = inventaire du service − charges des parties classées encore en attente (+ écart local depuis l'envoi). Partie validée → le service fait foi ; partie refusée → les charges reviennent.
- **`POST /api/revive`** : reprise payée en Prismes (5 puis 10), débit atomique et idempotent par `(partie, vie)`, jamais local. Le solde confirmé renvoyé met à jour `wallet.prisms` et `economy.confirmed.prisms`.
- Schéma SQLite **v5** (voir `docs/CLASSEMENT.md`) : `bests.category`, `runs.category/acts/powers/replay_v`, `installs.used_boost/used_gel` ; copie de sauvegarde automatique avant migration.

## Phase 4 : récompenses gratuites (sauvegarde v10, schéma SQLite v6)
- **Sauvegarde format 10** : `loyalty { shownDay, localDay, snapshot }` (affichage seulement ; jamais synchronisé ni crédité). Les jours, absences et récompenses du calendrier appartiennent au service.
- **Calendrier** : `POST /api/loyalty/checkin` (présence du jour UTC du service), `POST /api/loyalty/claim` (atomique, idempotent, clé `loy:<cycle>:<jour>`), `GET /api/loyalty`. Boost/Gel respectent le plafond de 99 (`stock_full`, la récompense reste disponible) ; les Prismes exigent un pseudo ou un compte (`account_required`).
- **Fusion de profils** : cycles déplacés vers le profil conservé (un seul cycle courant, les autres restent récupérables), récompenses déjà réclamées jamais recréditées (clés du registre), meilleur résultat quotidien par date, résultats de classement figés dédupliqués (`daily:<date>`).
- **Effacement du profil** : cycles, tentatives, parties, records et résultats quotidiens supprimés avec le reste.
