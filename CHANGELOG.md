# Journal des changements — Polar Rift

Format inspiré de « Keep a Changelog ». **Numéro public de version : décision requise** (`package.json` indique `2.0.0`, affiché dans le jeu ; voir « Décisions requises »). Cette entrée décrit la **V1 candidate** : le contenu de la branche locale `v1-finalisation-audiovisuelle`, **non fusionnée dans `main`, non poussée, non publiée**.

## V1 candidate (non publiée)

### Ajouté
- **Campagne « Douze ans de silence »**, chapitre 1, **niveaux 1 à 10** : récit illustré avant et après chaque niveau (scènes jouées une fois, relisibles au journal), objectifs variés, étoiles (objectif + défi), **Éclats de campagne** (réserve séparée de la Survie), vaisseau « Traverse ». Niveaux 1 à 5 : astéroïdes seulement ; 6 à 10 : aucun laser hostile. Détail : `docs/CAMPAGNE.md`.
- **Musique de partie** (intro → boucle → outro, raccords sur l'horloge Web Audio) et **ambiance évolutive de la Survie** (5 stades, faille cosmique, parallaxe, réactions synchronisées sur la position de lecture réelle, purement décorative ; Survie et défi quotidien seulement). Réglages **Musique**, **Effets sonores**, **Intensité visuelle**, **Effets réduits**. `docs/MUSIQUE.md`, `docs/AMBIANCE.md`.
- **Économie et cosmétiques** : Éclats (Survie, niveaux, succès), boutique de vaisseaux/traînées/packs (achat atomique, prorata des packs partiellement possédés), **27 succès** à récompense unique. Prismes préparés, **masqués** (« Bientôt disponible »). `docs/ECONOMIE.md`.
- **Classement mondial de Survie** (facultatif) : service Node + SQLite validant chaque partie par **rejeu** (graine du serveur + journal des entrées), top 100, rang personnel, résultats séparés par `BALANCE_VERSION`, file « en attente » hors ligne, signalement d'un pseudo, **suppression de son propre profil**. Durci : HTTPS exigé, CORS à origines exactes (jamais `*`), limites de débit, pseudos filtrés, base versionnée, modération **par ligne de commande sur la machine** (aucune route HTTP d'administration). **Non déployé.** `docs/CLASSEMENT.md`, `docs/GUIDE_DEPLOIEMENT.md`, `deploy/`.
- **Applications Android et iOS** (Capacitor 8.5.3, même code que le web) : projets `android/` et `ios/`, icônes et écrans de démarrage, bouton Retour d'Android, pause en arrière-plan, origines WebView `https://localhost` et `capacitor://localhost` autorisées **exactement** par le service de classement. **Aucun APK/AAB/IPA produit.** `docs/BUILD_MOBILE.md`.
- Web : icônes PNG, apple-touch-icon, manifeste, détection d'une page ancienne (« Recharger »).

### Changé
- Accueil : le bouton « Classement » est **masqué** tant qu'aucun service n'est configuré.
- Sauvegarde **format 6** (migration de toutes les anciennes versions, copies de sécurité conservées) ; l'effacement confirmé conserve préférences et profil du classement ; stockage refusé ou sauvegarde illisible signalés à l'accueil ; sauvegarde d'un autre onglet adoptée sans écrasement.
- Campagne : durées et défis recalibrés pour des humains (150–300 s), victoire détectée au dernier pas, récit sans double avance.

### Corrigé / durci (audit final)
- Bouton « Retour » d'Android : décision pure testée (`backAction`).
- Contrôle de publication : `npm run mobile:check -- --release` **échoue** tant que l'identifiant d'application est un identifiant « exemple » ou que la clé de signature manque ; la construction de l'AAB l'exécute en premier.
- Dépendance de développement `@capacitor/assets` retirée (elle apportait `sharp` et `tar` avec des avis de sécurité critiques/élevés ; usage ponctuel via `npx`). Reste 3 avis *modérés* (`uuid` via `@capacitor/cli`, outil de développement, sans effet sur le jeu ni sur le bundle ; `npm audit --omit=dev` : 0).
- **Déploiement Pages en échec (P0, découvert à l'audit pré-bêta)** : la variable GitHub `LEADERBOARD_URL` du dépôt vaut `https://vps-f5907180.vps.ovh.net/polarity` (avec un préfixe de chemin) ; la vérification ajoutée à la construction (`vite.config.ts`) refusait tout chemin et faisait **échouer `npm run build` dans le workflow** — le site publié est resté sur l'ancienne version (`0b72fb6`). `src/net/baseUrl.ts` accepte maintenant un **préfixe de chemin simple** (`https://hôte/préfixe`, le reverse proxy devant le retirer ; jamais `..`, `//`, paramètres, ancre ni identifiants). Reproduit puis corrigé localement avec la vraie valeur de la variable ; tests ajoutés.
- `scripts/e2e.mjs` : attentes périmées ou fragiles corrigées (ordre des boutons de l'accueil, 10 niveaux de campagne, attente active du temps de jeu sur rendu logiciel lent, interruption bénigne de `version.json`).

### Inchangé (volontairement)
- Gameplay, difficulté, hitboxes, scores, simulation (`src/sim/`, `src/modes/`, `src/core/`) et **`BALANCE_VERSION = 3`** : aucun écart depuis `main` (vérifié par `git diff`). `STORAGE_NAMESPACE = 'polarite'`, identifiants d'apparences et de scènes inchangés.

## Décisions requises (ne pas improviser)
| Décision | État | Où |
|---|---|---|
| **Identifiant d'application** (Android `applicationId` = iOS Bundle ID) | provisoire `com.example.polarrift`, **refusé par les magasins** | `npm run mobile:set-id -- <id>` ; propositions dans `docs/BUILD_MOBILE.md` §2 |
| **Numéro public de version** | `2.0.0` (dans `package.json`, affiché dans le jeu) ou `1.0.0` | `package.json` puis `npm run mobile:version` |
| Orientation sur téléphone | portrait ; tablettes libres | `docs/BUILD_MOBILE.md` §7 |
| Son sur iPhone avec l'interrupteur silencieux | coupé (comportement standard WebView) | à décider après essai réel |
| Hébergement du service de classement (serveur, domaine, `TICKET_SECRET`) | non fait | `docs/GUIDE_DEPLOIEMENT.md` |

## Points bloquants restants avant une sortie publique
1. **Aucun build natif** : pas d'APK/AAB/IPA (pas de SDK Android ni de Mac dans l'environnement). Signature Android et équipe Apple à votre charge.
2. **Pas de serveur public** : le classement n'est pas en ligne (le jeu reste complet sans lui).
3. **Droits des contenus** : l'origine et la licence de la **musique**, des **illustrations de campagne**, du **logo** et des **sprites** (générés par IA pour les sprites : `docs/ASSETS.md`) ne sont pas documentées dans le dépôt ; à établir et à déclarer si un magasin le demande.
4. **Juridique** : politique de confidentialité (URL publique) et RGPD (le classement traite un pseudo ; suppression disponible), fiches Play Console / App Store Connect (sécurité des données, App Privacy, classification d'âge, captures, icône 512 px, image de présentation).
5. **Validation humaine** : difficulté des niveaux (surtout 7 et 9), équilibrage de la Survie, lisibilité sur petits écrans réels, FPS et chauffe sur appareils, écoute iPhone réel (raccords, interrupteur silencieux, Bluetooth), comportement WebView (cycle de vie, retour Android, zones sûres), classement via WebView sur un service de bêta.
