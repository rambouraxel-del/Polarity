# Comptes, migration et synchronisation (économie v3 — phase 1)

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
