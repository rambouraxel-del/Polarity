# Guide de construction mobile (Android / iOS) — BUILD_MOBILE

> **État : préparé, pas publié.** Les projets `android/` et `ios/` existent, le jeu embarqué est construit et synchronisé, mais **aucun APK/AAB/IPA n'a été produit** (pas de SDK Android ni de Mac dans l'environnement de développement)
> et **rien n'est signé ni publié**. Ce guide donne les étapes exactes à faire sur votre PC / Mac. Section « Ce qui est compilé vs ce qui exige vos machines » en bas.

## 1. Principe : un seul code
```
src/  (le jeu : Phaser + TypeScript)  ──npm run build──────────▶ dist/         ──▶ GitHub Pages (web)
                                      ──npm run build:native──▶ dist-native/  ──cap sync──▶ android/ (AAB)  et  ios/ (IPA)
```
- Les trois versions sont **la même construction** ; seule la variable `VITE_LEADERBOARD_URL` peut différer (`.env.native`). Le gameplay, la simulation, l'audio et la sauvegarde sont identiques.
- Capacitor 8.5.3 n'est qu'une enveloppe : une vue web (WebView) qui contient `dist-native/` (tous les assets sont **embarqués** : MP3, WebP, polices — le jeu marche sans réseau).
- Seul code spécifique : `src/platform/native.ts` (bouton Retour d'Android, pause en arrière-plan, écran de démarrage) — inactif sur le web, jamais chargé par une page web.
- Plugins : `@capacitor/app` (cycle de vie, bouton Retour) et `@capacitor/splash-screen` seulement. **Aucune publicité, aucun achat intégré, aucune statistique. Seule permission Android : `INTERNET`** ; iOS : aucune « usage description » (ni caméra, ni micro, ni position, ni photos).

## 2. Paramètres en attente de votre décision
| Paramètre | Valeur provisoire (dans le dépôt) | À faire |
|---|---|---|
| **Identifiant d'application** (Android `applicationId` = iOS Bundle ID) | `com.example.polarrift` — **refusé par les magasins, volontairement** | Choisir, puis `npm run mobile:set-id -- <identifiant>`. **Définitif après la 1re publication** (il identifie l'application pour toujours). |
| Version affichée | `2.0.0` (= `package.json`, la même que dans le jeu) | Si vous voulez `1.0.0` au lancement des magasins : changer `version` dans `package.json`, puis `npm run mobile:version` |
| Orientation | portrait sur téléphone (iPad et tablettes Android : libre) | Voir §7 ; modifiable (`AndroidManifest.xml`, `Info.plist`) |
| Nom affiché | « Polar Rift » | — |
| Équipe Apple / clé de signature Android | aucune | §5 et §6 |
| Politique de confidentialité (URL publique) | aucune | **Obligatoire** pour les deux magasins (le classement transmet un pseudo) ; à héberger (ex. GitHub Pages) |

**Propositions d'identifiant** (minuscules, chiffres, `_` ; sans tiret) :
1. `io.github.rambouraxeldel.polarrift` — sans achat de domaine (dérivé de votre compte GitHub) ; correct pour démarrer.
2. `com.<votrestudio>.polarrift` — si vous avez un nom de studio/marque.
3. `fr.<votredomaine>.polarrift` — si vous possédez un domaine (recommandé à long terme : l'identifiant reflète le domaine).
Vérifiez la disponibilité dans Play Console / Apple Developer avant de vous engager.

`npm run mobile:check` liste ces points « EN ATTENTE » et vérifie la cohérence (identifiant, version, numéros de build, origines du classement) entre `mobile/release.json`, `package.json`, `capacitor.config.ts`, Android et iOS.

## 3. Prérequis
| | Pour | Détail |
|---|---|---|
| Node 22+ et `npm ci` | tout | déjà requis par le projet |
| Android Studio « Otter » (2025.2.1) ou plus récent | Android | fournit le SDK (plateforme **36**), le JDK et l'émulateur ; Java 21 convient en ligne de commande |
| Compte **Google Play Console** | publier Android | frais d'inscription uniques ; Play App Signing |
| Un **Mac** avec **Xcode 26** ou plus | iOS | exigence d'Apple pour tout envoi (SDK iOS 26 depuis le 28 avril 2026) ; ni Windows ni Linux ne peuvent produire l'IPA |
| Compte **Apple Developer Program** | TestFlight / App Store | abonnement annuel |

## 4. Commandes (depuis la racine du dépôt)
| Commande | Effet |
|---|---|
| `npm run mobile:icons` | régénère les visuels sources (`assets/*.png`, icônes web) depuis `art/source/` (Pillow) |
| `npm run mobile:assets` | décline icônes et écrans de démarrage Android/iOS depuis `assets/` (déjà fait et commité ; à relancer si vous changez `assets/`) |
| `npm run build:native` | construit le jeu dans `dist-native/` (lit `.env.native`) |
| `npm run mobile:sync` | `build:native` + contrôle « aucun secret dans le bundle » + `cap sync` (copie dans `android/` et `ios/`, met à jour les plugins) |
| `npm run mobile:check` | cohérence + paramètres en attente |
| `npm run mobile:set-id -- <id>` / `mobile:version` / `mobile:bump` | identifiant, version, numéros de build (un seul endroit : `mobile/release.json` + `package.json`) |
| `npm run mobile:android:debug` | APK de test (non signé par vous : signé avec la clé de débogage d'Android) |
| `npm run mobile:android:aab` | AAB de publication (exige la clé de signature, §5) |
| `npm run mobile:open:android` / `mobile:open:ios` | ouvre Android Studio / Xcode |

**À chaque changement du jeu** : `npm run mobile:sync`, puis reconstruire dans Android Studio / Xcode. Les dossiers copiés (`android/app/src/main/assets/public`, `ios/App/App/public`) ne sont pas commités.

## 5. Android : de l'APK de test à l'AAB Play Store
1. **Essai sur téléphone** (activez « Options pour les développeurs → Débogage USB ») : `npm run mobile:android:debug`, puis `adb install android/app/build/outputs/apk/debug/app-debug.apk` (ou ouvrez le dossier `android/` dans Android Studio → ▶).
2. **Choisir l'identifiant** (§2) et `npm run mobile:check`.
3. **Créer votre clé d'import** (UNE fois, sur votre PC ; **sauvegardez-la hors du dépôt**, par ex. dans un gestionnaire de mots de passe/coffre ; ne la committez ni ne la partagez jamais) :
   ```
   keytool -genkeypair -v -storetype PKCS12 -keystore polar-rift-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Puis copiez `android/keystore.properties.example` en `android/keystore.properties` (ignoré par git) et remplissez chemin et mots de passe. Variante sans fichier : variables d'environnement `POLAR_RIFT_KEYSTORE`, `POLAR_RIFT_KEYSTORE_PASSWORD`, `POLAR_RIFT_KEY_ALIAS`, `POLAR_RIFT_KEY_PASSWORD`.
4. **Numéros** : `npm run mobile:bump` avant chaque nouvel envoi (le `versionCode` doit croître à chaque envoi, sinon Play refuse).
5. `npm run mobile:android:aab` → `android/app/build/outputs/bundle/release/app-release.aab`.
6. **Play Console** : créer l'application (identifiant du §2), activer **Play App Signing** (Google garde la clé finale ; la vôtre n'est que la clé d'import, remplaçable en cas de perte), remplir *Sécurité des données* (déclarer : pseudo et parties de Survie envoyés au service de classement, facultatif ; aucun suivi, aucune publicité), classification du contenu, URL de politique de confidentialité, puis publier d'abord en **test interne** et l'envoyer à quelques testeurs.
- **Niveau d'API cible : 36 (Android 16)** — c'est ce qu'exige Google Play pour les nouvelles applications et mises à jour depuis le 31 août 2026 ([source](https://developer.android.com/google/play/requirements/target-sdk)) ; il est déjà réglé (`android/variables.gradle`, vérifié par `npm test`). À chaque saison, vérifiez la règle en vigueur ; mise à jour : `npx cap migrate` ou mise à jour des paquets `@capacitor/*`.
- Avec la cible 36, Android **ignore le verrouillage d'orientation sur les écrans larges** (tablettes, pliables ≥ 600 dp) : le jeu s'y adapte (mise en page responsive).
- Sauvegarde automatique Android (`allowBackup`) : conservée, voir §9.

## 6. iOS : Xcode → TestFlight (sur un Mac)
1. `git pull`, `npm ci`, `npm run mobile:sync`, `npm run mobile:open:ios`.
2. Xcode → cible **App** → *Signing & Capabilities* : choisir votre **Team** (compte Apple Developer). L'identifiant doit être celui du §2 (déjà appliqué par `mobile:set-id`). Xcode récupère le paquet Swift de Capacitor au premier lancement (réseau requis).
3. Choisir un iPhone réel ou un simulateur → ▶ pour tester.
4. Dans App Store Connect : *Apps → +* → créer l'app avec le même Bundle ID.
5. Xcode : destination *Any iOS Device (arm64)* → **Product → Archive** → *Distribute App → App Store Connect → Upload*. Le build apparaît dans **TestFlight** après traitement ; ajoutez-vous comme testeur interne.
6. Avant l'envoi en revue : *App Privacy* (mêmes déclarations que Play : pseudo et parties de Survie pour le classement, aucun suivi), URL de politique de confidentialité, captures d'écran, classification d'âge.
- Déjà fait pour vous : manifeste de confidentialité (`ios/App/App/PrivacyInfo.xcprivacy` : aucun suivi), `ITSAppUsesNonExemptEncryption = false` (HTTPS système seulement : pas de question d'exportation à chaque envoi), iPhone en portrait, icône opaque 1024 px, cible iOS 15.
- Numéro de build : `npm run mobile:bump` avant chaque nouvel envoi du même numéro de version.

## 7. WebView, orientation, zones sûres, tactile
- **Orientation** : iPhone et téléphones Android en **portrait** ; tablettes libres. Pour autoriser le paysage sur téléphone : retirer `android:screenOrientation="userPortrait"` (`AndroidManifest.xml`) et ajouter les deux orientations paysage à `UISupportedInterfaceOrientations` (`Info.plist`) — la mise en page paysage existe déjà (`docs/VERIFICATIONS_MOBILE.md`, point 14).
- **Zones sûres** : `viewport-fit=cover` + `env(safe-area-inset-*)` (variables `--sat/--sab/--sal/--sar`). iOS : `contentInset: 'never'` (vue pleine page). Android (cible ≥ 35 : bord à bord imposé) : `SystemBars.insetsHandling = 'native'` — les anciennes vues web sont décalées sous les barres, les récentes (Chromium ≥ 140) donnent les vraies valeurs `env()`.
- **Tactile** : Pointer Events (inchangés), `touch-action: none` dans l'arène, pas de zoom, pas de menu contextuel ni de sélection.
- **Écran de démarrage** : fond nuit `#070b1f` + logo (Android 12+ : icône sur fond nuit, imposé par le système), masqué par le jeu dès l'accueil prêt (délai de sécurité de 3 s).
- **Bouton Retour d'Android** : en partie → pause ; dans un menu → écran précédent ; résultat → accueil ; à l'accueil → ferme l'application.
- **Arrière-plan** : pause automatique de la partie + suspension audio (à la fois par `appStateChange` natif et `visibilitychange`) ; reprise de l'audio au retour (iPhone : au premier toucher, état « interrupted »).
- **Mise à jour** : pas de bandeau « Recharger » dans l'application native (la mise à jour passe par le magasin).
- **Audio** : musique et effets WebAudio, déverrouillés au premier geste (inchangé) ; fichiers MP3 embarqués (pas de téléchargement). **iPhone : l'interrupteur silencieux coupe le son du jeu** (comportement standard de WebAudio dans une WebView) ; décision produit à prendre après essai réel (docs/VERIFICATIONS_MOBILE.md, point 1).

## 8. Classement mondial et origines WebView (CORS strict)
L'origine d'une application Capacitor n'est ni GitHub Pages ni l'adresse du service : c'est `<schéma>://<hôte local>`. Valeurs **épinglées** dans `capacitor.config.ts` (et égales aux défauts de Capacitor 8) :
| Plateforme | Origine envoyée par la WebView | Réglage |
|---|---|---|
| Android | `https://localhost` | `server.androidScheme: 'https'`, `server.hostname: 'localhost'` |
| iOS | `capacitor://localhost` | `server.iosScheme: 'capacitor'` |
| Web (GitHub Pages) | `https://<utilisateur>.github.io` | — |
(`http://localhost` n'est utilisé que si `androidScheme` vaut `http` : **non retenu**, aucun trafic en clair.)

- **Serveur** : `ALLOWED_ORIGINS=https://<utilisateur>.github.io,https://localhost,capacitor://localhost` — origines **exactes**, jamais de joker. `capacitor://localhost` est la seule origine non https acceptée par `server/http.ts` (liste unique dans `src/net/origins.ts`). L'authentification (secret du profil en `Authorization`) est inchangée : l'origine n'est pas une preuve d'identité. Le plugin `CapacitorHttp` (qui contournerait CORS) n'est **pas** activé.
- **Client** : `VITE_LEADERBOARD_URL` = adresse HTTPS **publique du service** (jamais `capacitor://…` ni une adresse locale) ; la vérification de cette adresse (`src/net/baseUrl.ts`) ne dépend pas de l'origine de la page.
- **Ne jamais changer** `hostname`, `androidScheme`, `iosScheme` après une publication : la **sauvegarde locale est rattachée à l'origine** (§9) et le serveur n'autoriserait plus l'application.
- `npm run mobile:check` et `tests/native-origins.test.ts` vérifient la cohérence entre `capacitor.config.ts`, la liste d'origines et le serveur ; ce test rejoue **inscription → tickets → partie validée → classement → suppression du profil** avec les deux origines sur un vrai serveur HTTP éphémère.
- **À tester pour de vrai** (non faisable ici, aucun appareil ni serveur public) — sur un appareil Android et un iPhone, avec un service de **bêta** (jamais la production) : (1) créer un profil (pseudo) ; (2) jouer une Survie : « validé — rang N » ; (3) mode avion → partie « en attente », réseau rétabli → validée ; (4) menu Classement : top 100, votre rang ; (5) renommer ; (6) signaler un pseudo ; (7) *Supprimer mon profil du classement*, puis vérifier côté serveur (`server:admin stats`) ; (8) en cas d'erreur CORS : Safari → Développement → appareil → Console ; Chrome → `chrome://inspect` (le débogage de la vue web n'est actif que dans l'APK de test, jamais en publication).

## 9. Sauvegarde : web ≠ application (aucune synchronisation)
| | Où | Survit à | Se perd si |
|---|---|---|---|
| **Web** | `localStorage` du navigateur, pour l'origine `https://<utilisateur>.github.io` | fermeture, redémarrage | données du site effacées, navigation privée, autre navigateur/appareil |
| **Android** | `localStorage` de la WebView de l'application (origine `https://localhost`) | mises à jour de l'application ; **sauvegarde automatique Android** (activée) peut la restaurer à la réinstallation/changement de téléphone | désinstallation sans restauration, « Effacer les données », changement d'identifiant ou d'origine |
| **iOS** | `localStorage` de la WKWebView (origine `capacitor://localhost`) | mises à jour ; probablement la sauvegarde iCloud/Finder de l'appareil (à vérifier) | suppression de l'application, nettoyage du stockage par iOS en cas de saturation extrême |

- **La progression ne passe pas toute seule du web à l'application** (origines différentes = stockages séparés) ni d'un appareil à l'autre : **ce n'est pas une sauvegarde dans le cloud**. L'application native démarre donc vierge, même pour un joueur qui a une progression sur le web. Pas d'export/import dans cette version (piste d'évolution : code de transfert ; non fait pour ne pas élargir le périmètre).
- Le profil du classement (identité + secret) suit la même règle : un profil par stockage.
- **Mise à jour sans perte** : (1) mêmes identifiant, même origine épinglée, même clé de signature ; (2) `versionCode`/build en hausse ; (3) la sauvegarde est **versionnée** (format 6) avec migration champ par champ testée (`tests/progress.test.ts`) : une version plus récente lit l'ancienne ; ne jamais changer `STORAGE_NAMESPACE` (`'polarite'`). Une mise à jour **ne remet pas à zéro** les données ; seule la désinstallation le fait.

## 10. Publier et revenir en arrière (court)
**Publier** : (1) `npm run check` ; (2) fusion sur `main` → le workflow Pages publie le web ; (3) service de classement à jour **avant** (`docs/GUIDE_DEPLOIEMENT.md` §8, surtout si `BALANCE_VERSION` change) ; (4) `npm run mobile:bump && npm run mobile:sync && npm run mobile:check` ; (5) Android : `mobile:android:aab` → Play Console, test interne puis déploiement progressif ; iOS : Archive → TestFlight → revue ; (6) commit des numéros de build (`mobile/release.json`, `build.gradle`, `project.pbxproj`).
**Revenir en arrière** : un numéro de build ne se réutilise ni ne se retire. Android : *arrêter le déploiement progressif* dans Play Console puis publier une **nouvelle** version (code supérieur) reconstruite depuis le commit précédent. iOS : retirer le build de la revue / suspendre la sortie progressive, soumettre un nouveau build. Web : `git revert` du commit fautif puis fusion (Pages republie). Le serveur de classement ne revient en arrière qu'avec sa propre procédure (`GUIDE_DEPLOIEMENT.md` §7).

## 11. À vérifier sur appareil (liste courte ; complète `docs/VERIFICATIONS_MOBILE.md`)
Premier toucher → musique démarre ; verrouillage/appel/retour au menu du téléphone pendant une partie → partie en pause, musique coupée, reprise propre ; rotation (tablette) ; encoche et barre d'accueil : HUD et boutons jamais masqués ; WebGL fluide au stade 5 de l'ambiance (chauffe) ; images WebP des scènes de campagne ; sauvegarde conservée après fermeture complète de l'application ; Retour (Android) ; classement (§8).

## 12. Publicité récompensée (AdMob + UMP) — plugin local `polar-rift-ads`
Configuration unique `mobile/ads.json` (mode `demo` par défaut), plugin dans `plugins/polar-rift-ads/` (branché par `npx cap sync`), garde de production (Gradle `verifyAdsConfigRelease`, phase Xcode, `npm run mobile:ads -- --release`, déjà inclus dans `mobile:check -- --release`), procédure sur appareil et limites : **`docs/PUBLICITE.md`**. Après un changement de `mobile/ads.json` : `npm run mobile:ads -- --apply` (iOS) puis `npm run mobile:sync`. Le build web reste sans SDK.

## Ce qui est compilé vs ce qui exige vos machines
| Élément | Statut |
|---|---|
| Jeu web (`npm run build`) et jeu embarqué (`npm run build:native`), contrôle des secrets du bundle, `cap sync` Android + iOS | ✅ **exécutés ici** (7,5 Mo, MP3/WebP/polices inclus) |
| Tests unitaires (config mobile, origines/CORS WebView avec parcours complet sur serveur HTTP éphémère, couche native), typecheck | ✅ exécutés |
| Projets natifs générés par Capacitor 8.5.3 (Android : cible/compile 36, minSdk 24 ; iOS : cible 15), icônes et écrans de démarrage, manifeste de confidentialité iOS | ✅ générés et validés statiquement (plist, structure) — **non ouverts dans Android Studio / Xcode** |
| Plugin publicitaire `polar-rift-ads` (Java/Swift) : code écrit, JavaScript et garde-fous testés, sources Java vérifiées par `javac` contre des fausses classes | ⚠️ **non compilé contre les vrais SDK Google** (`docs/PUBLICITE.md`) |
| APK de débogage, AAB, IPA | ❌ **non produits** : pas de SDK Android (les dépôts Google sont inaccessibles depuis l'environnement), pas de Mac |
| Signature Android (clé d'import), équipe Apple, identifiant définitif | ❌ **à vous** |
| Essais sur appareil (audio, cycle de vie, WebGL, classement) | ❌ **à vous** (§8, §11) |
| Fiches Play Console / App Store Connect, politique de confidentialité | ❌ **à vous** |
