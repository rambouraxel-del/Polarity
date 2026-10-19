# Suivi d'avancement

## Mise à jour du service « refonte cosmétique » (commit du service ; déploiement à lancer sur la machine OVH)
- `server/accounts.ts` : remboursement idempotent des anciens skins (dépense exacte, pack Néon au prorata, table historique `REMOVED_SKINS` sinon ; rien pour les skins gratuits / par succès ; aucun solde remis à zéro) ; catalogue = celui du jeu (dix skins, mêmes prix).
- `deploy/mise-a-jour-service.sh` (sauvegarde sqlite + archive du volume + .env, mise à jour, santé), `deploy/verifier-service.mjs` + `deploy/credit-test-prisms.mjs` (vérification manuelle).
- Répétition locale sur une base « ancien service » (6 comptes) derrière un vrai serveur : A 130→420 Médailles (140+150), B Prismes 250→400 (150), C 200→333 (133), D inchangé, E +170 (table), F inchangé ; stable après 8 synchronisations et un relancement. Vérificateur : tous contrôles verts. **Le serveur OVH réel n'a pas été touché** (aucun accès depuis l'environnement de développement).

## Refonte cosmétique, première partie (travail sur `main`, `BALANCE_VERSION` 4 inchangée)
- **Skins** : les dix anciens skins sont supprimés (config, catalogue, textures recolorées, succès legacy, apparence exclusive « Faille », pack Néon) ; nouveau catalogue = dix PNG de la planche 01 (`src/assets/skins/`), configuration unique `SKIN_CONFIG` (`config/skins.ts` : id, nom, image, prestige, obtention, prix Médailles/Éclats/Prismes, disponibilité, ordre ; **valeurs provisoires**, `SKIN_ECONOMY_PROVISIONAL`). `tole-brute` = gratuit, équipé pour un nouveau joueur et repli de tout id inconnu (sauvegardes anciennes sans erreur). Trois situations d'obtention : Médailles seulement, Éclats OU Prismes (nouveau `Acquire` `choice`, deux boutons ; Prismes débités par le service seul, `buyPremium` accepte les articles `choice`), indisponible. Aucun achat en argent réel.
- **Traînées** : catégorie conservée, « Indisponible pour l'instant », achat/équipement/aperçu désactivés (`TRAILS_ENABLED = false`, données conservées).
- **Orbit** : `config/orbit.ts`, apparence par phase (couleur, opacité, épaisseur, halo, respiration, arcs de la phase 2), plus fine et plus discrète ; indépendante des skins et du garage ; fondu automatique, rien recréé.
- **Vaisseau** : taille visuelle ×1,25 ; hitbox ×1,15 (`HITBOX.playerScale`), cercle commun explicite, jamais déduit des PNG. **Cela modifie la physique (rejeu serveur) sans changer `BALANCE_VERSION`** (à décider par le propriétaire) : le service doit être mis à jour avec ce code avant/avec le jeu.
- Tests : `tests/cosmetics.test.ts` (hitbox, quatre côtés, Orbit), `skins`, `economy*`, `ui`… adaptés ; docs : `docs/APPARENCES.md`.

## Survie à phases (travail sur `main`, `BALANCE_VERSION` 4)
- [x] Config centralisée (`config/phases.ts`), difficulté par paliers (phase 1), mise en rythme par grilles (analyses hors ligne), motifs `beatShots` / `altBeams`
- [x] Traversée de 6 s à 300 s (session gelée), entrée en phase 2 (`Simulation.enterPhase2`), menaces courbes (`ProjectileHazard.path`), faisceaux rotatifs, 9 motifs de phase 2, plafonds et validateur d'évitement
- [x] Musique : analyse du MP3 joint (`scripts/analyze-phase2.py`), boucle sans trou par fondu enchaîné en phase, second tour de la phase 1, fondu pendant la traversée, reprise en phase 2
- [x] Fenêtre développeur « DEV » (contrôles de partie, sauts de temps, effets, diagnostic du classement, remises à zéro locale et mondiale par autorisation administrateur dédiée) ; classements : version actuelle seulement
- [x] Mode développeur (Options, mot de passe configurable, désactivable immédiatement) : vaisseau immortel en Survie, badge TEST, parties de test jamais comptabilisées ni envoyées (docs/MODE_DEVELOPPEUR.md)
- [x] Ambiance : noyau → faille, fissures, passages calmes, impulsions de caméra, traversée, apparence de la phase 2
- [x] Décor animé refait d'après deux références artistiques (dessiné et animé en code) : faille en formation au cœur sombre, traversée qui enveloppe l'écran, tunnel de facettes de la phase 2 (rubans, éclairs, fragments, étincelles, vignette), réactions musicales, qualité mobile — visuel seulement, `BALANCE_VERSION` 4 inchangée
- [x] Récompenses : prime de phase (150 Éclats, idempotente), apparence exclusive « Faille » (`acquire: reward`), archive des records v3 (Survie et « Avec bonus »)
- [ ] **Mise à jour du service OVH (service d'abord) : en attente d'autorisation**

## Allègement de l'interface et diagnostic (travail sur `main`)
- [x] Méthode Git : `scripts/git-backup.sh` (sauvegarde `backup/pre-…`, 3 conservées), règles dans `CLAUDE.md`
- [x] Diagnostic : nouveau jeu face à l'ancien service (reproduit en local) ; détection « service pas à jour » + messages ; `/api/health` annonce `api: 2` ; tests `tests/service-compat.test.ts`
- [x] Préparation compacte, boutique allégée, onglet Packs supprimé, pack premium dans Prismes ; contrôles 360×780 / 390×844 / 844×390 / 1280×800
- [ ] **Mise à jour du service OVH : en attente d'autorisation** (`docs/PUBLICATION_BETA.md`)

## Économie v3 — phase 6 : finalisation (branche `feat/polar-rift-economie-v3`, non poussée, rien sur `main`, rien déployé)
- [x] Audit fonctionnel (chiffres validés figés dans `tests/phase6-spec.test.ts`) et audit de sécurité (paiements, publicités, récompenses, tickets, UTC, invités)
- [x] Corrections : réconciliation Google/Apple + schéma v8, OIDC des notifications Google, drop refusé aux invités, clés de dette uniques, variables de déploiement des achats, limites des notifications
- [x] `scripts/e2e.mjs` modernisé (service local réel, 120 contrôles, migration d'une sauvegarde de `main`), ancien jeu vérifié contre le nouveau service
- [x] `npm run server:migrate-check`, `docs/PUBLICATION_BETA.md` (publication, retour arrière), 767 tests, build, `check:bundle`
- [x] Vérifications finales (invités + pseudo, plafond 3 activations, compteurs au retour arrière, retour arrière serveur v8) : 778 tests, build, `check:bundle`
- [ ] **Publication : en attente de l'accord explicite du propriétaire**

## Économie v3 — phase 5 : monétisation (branche `feat/polar-rift-economie-v3`, non poussée, rien sur `main`, rien déployé)
- [x] Vérifs phase 4 (pseudo suffit pour les récompenses ; preuve de fin des scores quotidiens tardifs par engagement horodaté)
- [x] Serveur : achats Apple / Google / web modulaire, crédit idempotent, remboursement + dette, notifications re-vérifiées, publicité récompensée (SSV), SQLite v7
- [x] Client : onglet Prismes, confirmation de dépense en reprise, reprise par publicité, contrats de plugins natifs (aucun SDK)
- [x] 746 tests (fournisseurs simulés), typecheck, build, `check:bundle`, contrôle navigateur léger ; **non fait** : paiement/publicité réels (configuration externe, `docs/MONETISATION.md`), E2E complet, phase 6

## Économie v3 — phase 4 : récompenses gratuites (branche `feat/polar-rift-economie-v3`, non poussée, rien sur `main`, rien déployé)
- [x] Vérifications phase 3 : reprise sûre, pas de 4ᵉ vie, rejeu exact du Bouclier (tests)
- [x] Calendrier de connexion (10 jours, UTC service, absences, réclamation idempotente, stock plein, Prismes avec pseudo), écran néon + accueil + ouverture quotidienne
- [x] Défi quotidien mondial : rejeu, départ en ligne, grâce 00 h 15, ex æquo, Top 10 en Prismes, clôture rejouable, notifications
- [x] Drop rare de Prismes (0,02 %/balise, HMAC serveur, 1 max, départ en ligne), `PRISM_SOURCES` futures désactivées
- [x] SQLite v6, sauvegarde 10, 689 tests, build, `check:bundle`, contrôle navigateur léger ; **non fait** : E2E complet, achats réels et publicité (phase 5)

## Économie v3 — phase 3 : pouvoirs, deux classements, reprises (branche `feat/polar-rift-economie-v3`, non poussée, rien sur `main`, rien déployé)
- [x] Simulation : Boost (×1,5, 5 s, recharge 10 s), Gel (menaces à 40 %, 6 s, recharge 20 s, par décalage des frises — physique sans bonus identique, `BALANCE_VERSION` inchangée), Bouclier gratuit (18 balises, 8 s, un impact), exclusivité, plafond 3, vies et reprise sécurisée (3 s d'invulnérabilité)
- [x] Protocole de rejeu 2 (activations en pas de simulation), rejeu serveur, catégories `plain` / `bonus` déduites par le service, stocks consommés dans le registre (`use:`), usage déclaré (`bonusUsed`), SQLite v5 additif (anciens records → « Sans bonus »), `POST /api/revive` (5 / 10 Prismes, idempotent)
- [x] Jeu : première mort figée et soumise avant toute reprise, écran de reprise (publicité désactivée honnêtement, Prismes via le service), survie libre non classée, commandes tactiles/clavier, rendu, deux onglets de classement, sauvegarde 9
- [x] 628 tests, build, `check:bundle`, contrôle navigateur léger (390×844, 844×390, 1280×720) ; **non fait** : E2E complet (à réécrire en phase 6), publicité réelle (aucun fournisseur)

## Économie v3 — phase 2 : trois monnaies, Médailles, cosmétiques, bonus (branche `feat/polar-rift-economie-v3`, non poussée, rien sur `main`)
- [x] Correctif phase 1 : parties classées en attente conservées après déconnexion (rattachées à leur profil, jamais envoyées avec une autre identité, sans doublon) ; plantage de démarrage de la phase 1 corrigé
- [x] Médailles : 27 succès = 1 650, à réclamer (« Récupérer »), rétroactif, anciens Éclats et cosmétiques conservés ; cosmétiques non premium en Médailles (1 640), premium en Prismes (Néon 150, Nébuleuse 75, pack 200) ; anciens packs supprimés
- [x] Bonus Boost 50 / Gel 100 Éclats : inventaire persistant, boutique (onglet Bonus), écran « Préparer la partie » ; effets en partie = phase 3
- [x] Sauvegarde format 8, schéma SQLite v4, service : médailles / bonus / achats premium (`POST /api/shop/prisms`), fonds confirmés vs provisoires, rejet des achats non financés
- [x] 574 tests, build, `check:bundle`, contrôle navigateur léger ; **reste** : configuration externe (comptes), phase 3 (effets des bonus), e2e à réécrire (phase 6). Voir `docs/ETAT_MAJ_ECONOMIE.md`

## Économie v3 — phase 1 : comptes, migration, synchronisation (branche `feat/polar-rift-economie-v3`, non poussée, rien sur `main`)
- [x] Sauvegarde v7 (`economy`), migration locale idempotente des anciennes sauvegardes (copie conservée), règles et fusion partagées jeu/serveur
- [x] Serveur : schéma v3 additif, profils invités, accès par appareil, Google/Apple (OIDC, nonce) et lien magique (désactivés sans configuration), registre `ledger`, `/api/migrate`, `/api/sync`, fusion confirmée sans double crédit (38 tests)
- [x] Client : `AccountService` (invité automatique, migration, synchronisation hors ligne), écran Options → Compte, fournisseurs web / Capacitor (19 tests)
- [ ] **À configurer par le propriétaire** : identifiants OAuth Google/Apple, `RESEND_API_KEY` + `MAIL_FROM` + `APP_PUBLIC_URL`, module natif de connexion sociale (non installé), redéploiement du service. Détail : `docs/COMPTES.md`, suivi : `docs/ETAT_MAJ_ECONOMIE.md`

## Consolidation V1 : progression, boutique et interfaces dépendant de la sauvegarde (branche `v1-finalisation-audiovisuelle`, non fusionnée)
- [x] Succès (27) : conditions relues et testées contre la configuration (niveaux, multiplicateur), récompense unique (rechargements, appels répétés, deux onglets, sauvegarde incohérente), aucune dépense requise, campagne exclue
- [x] Boutique : packs partiellement possédés facturés au prorata (plus de double paiement d'un article), refus expliqués, messages annoncés aux lecteurs d'écran, clics répétés sans double débit
- [x] Libellés : Éclats (Survie/boutique) vs Éclats de campagne ; Prismes masqués (« Bientôt disponible », aucun prix) ; accueil « Douze ans de silence » (plus l'ancien sous-titre) ; classement hors ligne en français courant ; honnêteté sur les données locales
- [x] Sauvegarde : stockage refusé signalé, sauvegarde illisible/plus récente signalée, adoption d'une sauvegarde écrite par un autre onglet, effacement qui conserve préférences et profil du classement, malformations couvertes, migrations v1→v6 sans remise à zéro
- [x] Mobile : tailles tactiles ≥ 44 px, onglets sans débordement à 320 px, aperçu de la boutique réduit, pause plus claire ; captures ciblées 390×844 et 320×568
- [x] Tests ciblés (`tests/robustness.test.ts`) ; `src/sim`, difficulté, hitboxes, `BALANCE_VERSION`, identifiants (`polarite`, skins, scènes) inchangés
- [ ] **À tester humainement** : deux onglets réels, navigation privée, vraie boutique sur téléphone, lecteurs d'écran, propositions d'économie (`docs/ECONOMIE.md`)

## Finalisation de la campagne V1 (niveaux 1 à 10, branche `v1-finalisation-audiovisuelle`, non fusionnée)
- [x] Audit des 10 missions : objectifs = conditions de victoire ; **correction** : objectif rempli au dernier pas de la limite = victoire (et non « temps écoulé »)
- [x] Calibrage humain : défis de temps relâchés (N1 120, N4 200, N5 235, N8 195, N9 245, N10 240 s ≈ 1,25 × robot) ; niveau 5 : 90 éclats d'approche (au lieu de 100) ; texte du niveau 8 honnête (« de préférence entre les vagues ») ; popup « Téléchargement x/5 » (plus de « Boîte noire ! »)
- [x] Séquencement testé : `takeIntroScene` / `takeOutroScene` (jamais de conclusion après échec, jamais de double récompense, parcours 1→10, sauvegarde v6 relue à l'identique)
- [x] Récit : anti double-avance (clic double, Entrée maintenue), rendu partiel des répliques, image défaillante masquée, portraits préchargés ; vérifié sur captures 320×568, 390×844, 844×390
- [x] Orthographe et continuité relues (aucune correction : dialogues inchangés) ; fin honnête « Suite du chapitre à venir » après le niveau 10 ; hangar désactivé
- [x] `src/sim/*`, Survie, défi quotidien, défis classiques, classement et `BALANCE_VERSION` inchangés
- [ ] **Validation humaine** : durées et difficulté réelles (surtout niveaux 4, 5, 7, 9), lisibilité des scènes sur téléphones, ressenti des défis secondaires. `scripts/e2e.mjs` mis à jour pour 10 niveaux mais **non rejoué**.

## Audit pré-bêta (branche `release/v1-rc1`, commit local, non poussé)
- [x] **e2e complet rejoué (un seul passage)** : **380 contrôles ✔, 0 ✘, sortie 0** — les six anciens échecs sont résolus (La Survie se joue ; Éclats gagnés / Mort sans recrédit ; ordre des boutons de l'accueil ; niveau 2 débloqué ; aucune erreur console du bureau)
- [x] **P0 trouvé et corrigé** : le workflow Pages de `50a75a4` a échoué (`npm run build`) car `LEADERBOARD_URL` contient un préfixe de chemin (`…/polarity`) que la vérification d'URL refusait ; le site en ligne est resté à `0b72fb6`. Correctif : `sanitizeBaseUrl` accepte un préfixe simple (testé, build de CI reproduit en local). **Rien n'est redéployé tant que `main` n'est pas poussée avec ce correctif.**
- [x] `npm run check` : typecheck + 458 tests + build ; `check:bundle` ; `mobile:sync` idempotent

## V1 candidate — audit final de non-régression (branche `v1-finalisation-audiovisuelle`, commit local ; branche candidate locale `release/v1-rc1`)
Verdict : **NO-GO pour une sortie publique** (bloquants §C du rapport : aucun build natif, aucun serveur public, droits des contenus, juridique, validation humaine) ; **le code est prêt pour une bêta web** dès que vous le décidez (fusion + Pages). Détail : `CHANGELOG.md` (décisions requises, points bloquants).
- [x] Faits vérifiés : `main` = `0b72fb6` contient la campagne 1–10 ; la branche porte 5 commits locaux non poussés ; `src/sim/`, `src/modes/`, `src/core/`, configs de difficulté et `BALANCE_VERSION = 3` **identiques à `main`** (`git diff`)
- [x] `npm run check` : typecheck + **457 tests** + build OK ; `npm run check:bundle` OK (aucun secret/code serveur) ; `npm run mobile:sync` idempotent (aucune dérive des projets natifs)
- [x] `npm run e2e` (**un seul passage**, Chromium) : **323 contrôles passés, 6 en échec** — tous des attentes de test périmées ou fragiles, **aucun défaut de jeu** : ordre des boutons (« Classement » masqué sans service), 10 niveaux de campagne, attente du temps de jeu sur rendu logiciel lent (×0,45), interruption bénigne de `version.json`. Attentes corrigées dans `scripts/e2e.mjs` **mais non rejouées en entier** (couvertes par `tests/v1-regression.test.ts`)
- [x] `npm run e2e:classement` (**un passage**, vrai serveur local) : tous les contrôles passés (rejeu, hors ligne, falsification, démo exclue, persistance, versions)
- [x] Écrans 320×568, 390×844, 844×390, 768×1024, bureau : aucun débordement, aucune erreur console (e2e) ; contrastes WCAG testés
- [x] Corrections : décision du bouton Retour d'Android isolée et testée ; **contrôle de publication** (`mobile:check -- --release`) ; dépendance de développement vulnérable `@capacitor/assets` retirée ; README/ROADMAP réconciliés
- [ ] **Non vérifié ici** : tout ce qui exige un appareil, un SDK Android, un Mac, un compte de magasin ou un serveur public (voir `CHANGELOG.md` §« Points bloquants »)

## Distribution V1 : web, Android, iOS (branche `v1-finalisation-audiovisuelle`, commit local, ni poussée ni fusionnée)
- [x] Web statique : base relative, icônes PNG + apple-touch + manifeste (`public/`), favicon, `version.json` (mise à jour web) ; aucun secret ni appel externe dans le bundle (`check:bundle`)
- [x] Enveloppe **Capacitor 8.5.3** (un seul code) : `capacitor.config.ts` (origines WebView épinglées), projets `android/` (cible/compile 36, minSdk 24, permission `INTERNET` seule) et `ios/` (cible iOS 15, manifeste de confidentialité, chiffrement exempté), icônes et écrans de démarrage générés depuis `art/source/`, plugins `app` + `splash-screen` seulement
- [x] `src/platform/native.ts` : pause + audio suspendu en arrière-plan, bouton Retour d'Android, écran de démarrage masqué au premier affichage, pas de bandeau « Recharger » en natif — inactif sur le web
- [x] CORS strict et WebView : `capacitor://localhost` + `https://localhost` acceptés **exactement** (`src/net/origins.ts`, `server/http.ts`), parcours inscription → tickets → partie validée → suppression de profil testé avec les deux origines (serveur HTTP éphémère)
- [x] Versions et signature : `mobile/release.json` + `package.json` → `build.gradle` / `project.pbxproj` (`mobile:version|bump|set-id|check`), signature Android par `keystore.properties`/variables d'environnement (jamais dans le dépôt)
- [x] Documentation : `docs/BUILD_MOBILE.md` (étapes PC/Mac, sauvegarde web vs app, release/rollback), `docs/CLASSEMENT.md` et guide de déploiement (origines)
- [x] Tests : `tests/native-origins.test.ts`, `tests/mobile-config.test.ts` ; `src/sim/`, gameplay, audio, `BALANCE_VERSION` inchangés
- [ ] **Non produit : APK, AAB, IPA** (pas de SDK Android — dépôts Google inaccessibles —, pas de Mac) ; **non ouvert** dans Android Studio / Xcode
- [ ] **À votre charge** : identifiant d'application définitif (`mobile:set-id`), clé de signature Android, compte Apple/Team, politique de confidentialité, fiches des magasins, essais sur appareil (audio, cycle de vie, WebGL, classement sur WebView), décision « version 2.0.0 vs 1.0.0 » et orientation

## Classement mondial : robustesse et préparation au déploiement (branche `v1-finalisation-audiovisuelle`, commit local, ni poussée ni fusionnée)
- [x] Serveur : couche HTTP durcie (`server/http.ts` : CORS strict, `Content-Type` exigé, HTTPS exigé derrière proxy, IP lue depuis la droite de `X-Forwarded-For`, délais, taille, en-têtes), configuration validée au démarrage, arrêt propre, exceptions fatales journalisées
- [x] Pseudos : lettres latines seulement (anti-homoglyphes), filtre d'insultes/noms réservés (`server/moderation.ts`), courses d'inscription gérées (409)
- [x] Données : `DELETE /api/me` (suppression complète par le joueur, authentifiée), `POST /api/report` (signalement), CLI opérateur `server/admin.ts` (`stats`, `check`, `backup`, `reports`, `hide`, `ban`, `unban`, `export`, `delete-player`, `prune` — simulation par défaut, `--yes` requis) ; **aucune route HTTP d'administration**
- [x] Base : schéma versionné (`user_version`, migration v2 : modération, signalements, journal), sauvegarde auto avant migration, refus d'une base plus récente, sauvegarde à chaud `VACUUM INTO`, contrôle d'intégrité, budget global de rejeux (429 sans consommer le ticket), jamais de purge automatique
- [x] Client : adresse `https` obligatoire (ou `http://localhost`), tickets d'un ancien profil écartés, envoi interrompu sur 429/401, profil non reconnu signalé, suppression de profil et signalement depuis le menu, bouton « Classement » masqué si non configuré
- [x] Construction : `VITE_LEADERBOARD_URL` vérifiée (échec de build si invalide), `npm run check:bundle` (aucun secret ni code serveur dans `dist/`, ajouté au workflow Pages), `npm run build:beta`
- [x] Déploiement prêt à intégrer (rien déployé) : `server/Dockerfile` (non-root, healthcheck), `deploy/` (compose + Caddy HTTPS, `env.example`, `sauvegarde.sh`), `.env.example`, **`docs/GUIDE_DEPLOIEMENT.md`**
- [x] Tests : `tests/leaderboard-hardening.test.ts` (15) + client (6 nouveaux) ; suite complète : 433 tests verts ; `tsc` et build propres. **Aucun e2e, aucun serveur persistant, aucune image Docker construite** (contrainte)
- [ ] **Mise en service — non faite, à votre charge** : serveur + domaine, `deploy/.env` (`TICKET_SECRET` : `openssl rand -hex 32`), variable GitHub `LEADERBOARD_URL`, vérification de production (`docs/GUIDE_DEPLOIEMENT.md` §4). **Le classement n'est pas en ligne.**
- [ ] `scripts/e2e-classement.mjs` non rejoué (la saisie de pseudo, le serveur local et le bouton sont inchangés en principe) ; Dockerfile et compose validés seulement par `docker compose config`

## Finalisation audiovisuelle V1 (branche `v1-finalisation-audiovisuelle`, non fusionnée)
- [x] Carte musicale recalée sur les attaques réelles (+9,1 ms mesurés, écart résiduel ≈ 0 ms) ; grille de battements continue aux raccords
- [x] Silence, sourdine, pause, compte à rebours, contexte suspendu/« interrupted » : aucune réaction musicale, aucun battement manqué rejoué
- [x] Réglages Options : volume général, **Musique**, **Effets sonores** (bus séparés), **Intensité visuelle** (0–100 %), Effets réduits conservé ; écoute d'essai de la musique ; préférences enregistrées
- [x] Faille refaite (fissure irrégulière à ramifications), voile de la zone de jeu opaque jusqu'au-delà de l'orbite, traits en azur/violet (le magenta reste celui des secteurs électriques) — constaté lisible sur captures de jeu réel (stade 5, secteur, laser)
- [x] Qualité adaptative : nébuleuses 3/2/1 ; quadrillage plus fin ; coût JS mesuré ≈ +1,3 ms/image à ×4 de ralentissement
- [x] Niveaux audio mesurés : aucune saturation propre au jeu ; MP3 inchangés ; reprise de l'état « interrupted » (Safari iPhone)
- [x] Tests : 50 tests ciblés (synchro, silence, intensité, bus audio, invariance du gameplay par graphe d'imports) ; `src/sim/` et `BALANCE_VERSION` inchangés
- [ ] **À faire sur de vrais téléphones** : `docs/VERIFICATIONS_MOBILE.md` (Safari iPhone, Android, Bluetooth, réseau lent, fluidité, lisibilité à 0/60/120/180/240+ s)

## Ambiance évolutive de la Survie (livrée sur `main`)
Cinq stades progressifs, faille cosmique, parallaxe, particules, anneaux, ondes, arcs, débris, quadrillage gravitationnel ; synchronisation musicale par position de lecture réelle + carte des morceaux (battements, basses, intensité, montées, drops) ; effets réduits ; qualité adaptative. Survie et défi quotidien uniquement. Voir `docs/AMBIANCE.md`.

## Musique de partie (livrée sur `main`)
- [x] Intro une fois → boucle native (`loopStart`/`loopEnd` du JSON) → outro en fondu 1,2 s à la fin de partie, annulation de la boucle programmée, relance rapide sans superposition, pause/reprise, arrière-plan, volume/sourdine existants, buffers décodés une seule fois
- [x] Tests unitaires (faux contexte) + e2e réel (MP3, rendus hors ligne des raccords)
- [ ] **Écoute sur Safari iPhone à effectuer** (décodage MP3, raccords, déverrouillage)

## Campagne niveaux 6 à 10 (intégrés, à valider en jeu réel)
Dialogues, 5 illustrations WebP, 5 missions (durées 150–200 s pour le joueur parfait), sauvegarde inchangée (format 6, `chapterComplete` recalculé), tests unitaires adaptés. Pas d'e2e ni de monitoring lancés. Voir `docs/CAMPAGNE.md`.

## Campagne « Douze ans de silence », niveaux 1 à 5 (branche `campagne-douze-ans`, livré, à valider en jeu réel)
- [x] Pack narratif intégré : 6 illustrations + 3 portraits (WebP optimisés, masters dans `art/campagne/`), dialogues JSON non altérés (`src/data/`), mapping des portraits
- [x] Écran de récit mobile (illustration au-dessus, boîte de dialogue, portrait, texte progressif, révéler/avancer, passer, relecture, journal, clavier)
- [x] 5 niveaux d'astéroïdes (`config/campaign.ts`), vaisseau Traverse, étoiles, Éclats de campagne séparés, sauvegarde v6 + migration v5 → v6
- [x] Survie, classement, succès, cosmétiques, `src/sim/` et `BALANCE_VERSION` : inchangés
- [x] Tests (faisabilité des 5 niveaux par bot sur 12 graines, progression, sauvegarde, écrans, intégrité des assets) et e2e (mobile 390×844, 320×568, 844×390, bureau, clavier, migration)
- **Reste à valider avec de vrais joueurs** : difficulté de chaque niveau, durée de vie des objets (niveaux 4 et 5), seuils des défis, lisibilité des scènes sur appareils réels (vitesse du texte, tailles), poids réel sur réseau mobile
- **Retiré** (remplacé par la nouvelle histoire) : première campagne « Écho-7 » (10 missions), apparence « Écho », étoile « sans bouclier », écran du hangar

## Version 1.1 — « Néon premium » et courbe de Survie accélérée (terminée)
- [x] Sprites : vaisseau blanc/argent à cockpit cyan et 4 astéroïdes rocheux aux fissures orange (fond transparent, sans aucun effet intégré)
- [x] Effets par code, à l'opposé du déplacement : flamme et étincelles du vaisseau, traînée et braises d'astéroïdes ; inversion instantanée
- [x] Visuels +15 % ; hitboxes +6,5 % (réglage séparé, plage 5–8 %, en retrait des silhouettes) ; impact bref au point de contact
- [x] Survie/défi : d(2 min) = d(5 min v1.0) = 0,77 ; doubles dès 30 s ; combinaisons projectile/secteur dès 60 s ; intensification + brèves respirations après 3 min ; annonces −8 % avec planchers
- [x] Réglages séparés : `config/survival.ts`, `config/hitbox.ts`, `config/visuals.ts` ; plafonds et validateur d'évitement inchangés
- [x] Sauvegarde v2 : progression préservée, anciens records rangés à part, copie de l'ancienne sauvegarde, information unique à l'écran d'accueil
- [x] Tests (97), e2e (≈ 55 contrôles), mesure de performance, documentation (README, ASSETS, EQUILIBRAGE)

## Version 1.2 — vitesse progressive, nouveaux dangers, événements (terminée)
- [x] Vitesse du vaisseau en Survie/défi : 40 % de la référence au départ, +5 points toutes les 30 s (45 % à 30 s … 100 % à 6 min), lissage de 2 s qui se termine au palier, plafond 100 % ; inversion instantanée sans changement de vitesse ; vitesse par niveau configurable (1,0 pour les 12 niveaux)
- [x] Trois nouveaux dangers : astéroïde fragmenté (annonce des fragments, délai de réaction ≥ 0,45 s), convoi (2–3 astéroïdes, même trajectoire), laser balayeur (secteur limité, zone de refuge ≥ 2,4 rad) ; introduits à ≈ 38 s / 75 s / 110 s ; rendu par code, sprites d'astéroïdes réutilisés (fragments à 70 %)
- [x] Événements : pluie de météores (12 s) et tempête électrique (10 s) ; premier entre 45 et 60 s, puis 40–60 s après la fin ; annonce 2 s avant, respiration 3 s ; un seul directeur (machine d'états) ; menaces restantes jamais effacées ; calendrier reproductible (graine dédiée) ; pause = tous les chronomètres arrêtés
- [x] Équilibrage adapté à la vitesse réelle : annonces, décalages, intervalles, largeur des secteurs, vitesse des lasers (`PACE`) ; validateur d'évitement qui suit la vitesse (réseau d'angles, testé contre une exploration exhaustive) ; plafonds et difficulté d(t) inchangés
- [x] Version d'équilibrage 3 : records v1.1 archivés à part (v1.0 intacts), copie `polarite.save.avant-eq2`, information unique à l'accueil ; progression préservée
- [x] 218 tests, e2e étendu (paliers de vitesse, pause à l'annonce, événements, nouveaux motifs), mesure de performance, documentation (`docs/EQUILIBRAGE.md`, `docs/ROADMAP.md`)

## v1.6 — Cosmétiques, succès récompensés, classement mondial (intégration terminée ; service non déployé)
- [x] Menu **Cosmétiques** (Apparences + Boutique fusionnés) : catégories Vaisseaux / Traînées / Packs, filtres Tous / Possédés / À débloquer, aperçu animé, actions Acheter / Équiper / Équipé / Succès requis ; soldes une seule fois ; possessions et équipements préservés
- [x] **27 succès** (découverte, Survie, niveaux, collectes, maîtrise) centralisés (`config/achievements.ts`), objectifs progressifs sans dépense, récompense en Éclats versée une seule fois (notification + sauvegarde), 2 traînées exclusives ; migration (sauvegarde format 4) : succès déjà obtenus récompensés une fois
- [x] **Classement mondial** de Survie : service Node + SQLite (`server/`), identité stable + authentification par secret, tickets de graine signés, **validation par rejeu** (graine + journal des entrées), top 100, résultats séparés par version d'équilibrage (anciens conservés), parties démo/debug exclues, mode hors ligne (résultat « en attente » / « non validé » signalé), aucun secret dans le jeu
- [ ] **Mise en service du classement** : héberger le service, définir `TICKET_SECRET` / `ALLOWED_ORIGINS`, renseigner la variable `LEADERBOARD_URL` du dépôt (voir `docs/GUIDE_DEPLOIEMENT.md`) — **non fait** : le classement n'est pas opérationnel tant que ce n'est pas fait
- [x] Tests (250 unitaires dont 29 de classement), e2e (cosmétiques, succès, migration) et `e2e:classement` (vrai serveur local), documentation (`docs/CLASSEMENT.md`)

## v1.5 — économie : Éclats, Prismes, boutique (terminée)
- [x] Éclat sur l'orbite en Survie (5 s, un seul à la fois, 15–25 s entre deux, +5 Éclats) : générateur dédié, emplacement accessible avec la vitesse réelle, pause respectée, crédit unique et immédiat, visible sur toutes les couleurs d'orbite
- [x] Récompenses de niveau (50 / 15 par étoile / 10), registre anti-doublon, détail au résultat ; sauvegarde format 3 avec migration sans crédit rétroactif
- [x] Prismes : solde séparé (0), catalogue premium « Bientôt disponible », aucune transaction active ; interface `PaymentProvider` pour une future intégration validée côté serveur
- [x] Boutique (Vaisseaux / Traînées / Packs), confirmation, achats atomiques sans double débit, états Acheter / Équiper / Possédé / Solde insuffisant / Succès requis ; soldes sur l'accueil, la boutique et Apparences
- [x] Catalogue centralisé (`config/catalog.ts`), nouvelles apparences (Spectre, Néon) et traînées ; exclusivités de succès conservées ; tests (218), e2e, documentation (`docs/ECONOMIE.md`)

## v1.4 — visibilité du vaisseau et apparences (terminée)
- [x] Vaisseau +20 % (hitbox inchangée), coque plus blanche, cockpit cyan plus vif, lueur discrète et liseré sombre ; contours orange des astéroïdes renforcés (taille inchangée) ; orbite cyan vif
- [x] Aide aux contrôles adaptée (toucher sur mobile ; clic, Espace, Échap sur ordinateur)
- [x] Menu Apparences : grand aperçu animé (figé en effets réduits), cartes Équipé / Disponible / Verrouillé, bouton « Équiper », condition de déblocage précise
- [x] Apparences en configuration extensible (`config/skins.ts`), une texture par apparence, repli sur « classique », réacteurs distincts des dangers (testé), sauvegarde et application dans tous les modes
- [x] Tests (`tests/skins.test.ts`, `tests/ui.test.ts`), e2e (équipement, verrouillage, modes, rechargement, repli), documentation (`docs/APPARENCES.md`)

## Direction artistique « Néon premium » — nom Polar Rift (ex-Polarity) (terminée)
- [x] Nom affiché « Polar Rift » (`config/brand.ts` ; ex-« Polarity ») ; clés de sauvegarde `polarite.*` inchangées (testé)
- [x] Thème centralisé (`ui/theme.ts` → variables CSS → couleurs Phaser), police Orbitron locale, composants et icônes SVG, feuilles de style séparées (`src/styles/`)
- [x] Logo PNG utilisé directement ; planche des menus et maquette d'accueil recréées en HTML/CSS réel (références dans `art/reference/`)
- [x] Écrans : accueil, niveaux (terminé / à jouer / verrouillé), défi quotidien, apparences + succès (onglets), options, confirmation, pause, résultat (3 variantes), HUD harmonisé
- [x] Fond spatial animé par code dans les menus seulement (statique en effets réduits), arène inchangée ; transitions d'écran ; adaptation portrait / paysage / 320 px, zones de sécurité
- [x] Mécaniques, difficulté, vitesses, hitboxes, tailles des sprites : inchangées (`BALANCE_VERSION` inchangé)
- [x] Tests d'interface (`tests/ui.test.ts`), e2e étendu (4 tailles d'écran, tous les écrans, effets réduits, transitions) ; documentation `docs/INTERFACE.md`

## Lisibilité des éléments (terminée)
- [x] Vaisseau ×1,45 et astéroïdes ×1,35 (par rapport à la v1.1) ; contour lumineux orange des astéroïdes renforcé (silhouette orange additive)
- [x] Flamme (largeur 5 → 6,5) et traînées d'astéroïdes plus épaisses, longueurs inchangées (14 et 52) ; effets toujours codés, sans collision
- [x] Hitboxes, difficulté, textes, quadrillage, orientation du vaisseau et inversion immédiate : inchangés (tests et e2e)
- [x] 99 tests, e2e (contrôles de taille +45 % / +35 %, contour orange, inversion), build ; vérifié sur ordinateur (1280×800) et mobile (390×844)

## Version 1.0 (terminée)
Jeu complet : 12 niveaux, Survie, défi quotidien, succès, apparences, sauvegarde, sons, interface mobile, GitHub Pages.

## Restant / pistes
- **Évolutions futures notées, non implémentées** : balise bonus temporaire, secteurs thématiques des niveaux (`docs/ROADMAP.md`)
- Essais avec de vrais joueurs : équilibrage de la courbe v1.1, seuils d'étoiles (à réexaminer avec les hitboxes agrandies)
- Tests sur appareils réels (Safari iOS, Firefox, Android) et mesure GPU mobile
- Classement en ligne : code prêt et durci, **service non déployé** (`docs/GUIDE_DEPLOIEMENT.md`)

## Vérifications exécutées (v1.1)
| Commande | Résultat |
|---|---|
| `npm run check` (typecheck + tests + build) | OK — 218 tests |
| `npm run e2e` (Chromium headless) | tous les contrôles OK : sprites chargés, inversion immédiate, impact, migration v1→v2, menus, 3 modes, pause, tactile, relances, 5 tailles d'écran, aucune erreur console |
| `npm run perf` v1.2 (×4 ralenti, 390×844, charge identique) | app.frame 2,4 ms (avant 2,4–2,6 ms), p95 6,1–6,8 ms ; tas JS stable (≈ 10–11 Mo) |
| `npm run cost` (directeur + validateur, 8 min de Survie) | médiane 0,25 ms, p99 1,6 ms, max 5 ms (démarrage à froid) |
| `npm run sim -- 6` | bots : 12/12 niveaux réussis, Survie 6 min tenue ; d(120 s) = 0,771 ; ≈ 27 → 33 vagues/min après 3 min |
| `npm run perf` (×4 ralenti, 390×844) | app.frame 1,9 → 2,3 ms (moyenne), p95 5,5 → 6,5 ms ; tas JS stable (≈ 9–10 Mo) ; GPU non mesurable (rendu logiciel) |

## Choix d'équilibrage
Voir `docs/EQUILIBRAGE.md`. Assets : `docs/ASSETS.md`.

## Blocages
Voir `CHANGELOG.md` (« Décisions requises » et « Points bloquants restants avant une sortie publique »).

## Effet de vitesse du vaisseau (rendu seulement)
- [x] Halo/lueur permanente supprimé (jeu + aperçu) ; traînées de vitesse discrètes (`src/render/speedLines.ts`, `FX.speedLines`) ; tests `tests/speed-lines.test.ts` ; simulation, hitbox, rejeu, serveur et `BALANCE_VERSION` inchangés.

## iOS sans Mac : Codemagic → TestFlight (préparation)
- [x] `codemagic.yaml` (parcours `ios-verification` sans signature + `ios-testflight` signé, TestFlight interne), `scripts/ios-ci.ts` (garde Bundle ID, numéro de build), `npm run mobile:ios:guard`, tests `tests/ios-ci.test.ts`, guide `docs/CODEMAGIC_IOS.md`.
- [ ] À faire par l'éditeur : Bundle ID définitif, App Store Connect (clé API, fiche, groupe interne), Codemagic (intégration `polar-rift-asc`, groupe `polar_rift_ios`), puis lancer `ios-verification`. **Aucune exécution cloud faite : compilation iOS non prouvée.**
