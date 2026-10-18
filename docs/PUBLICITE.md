# Publicité récompensée : AdMob + UMP (applications Android / iOS)

**Autorisation** : l'éditeur autorise explicitement les SDK officiels **Google Mobile Ads (AdMob)** et **UMP** dans les applications natives, et les permissions strictement nécessaires. **Le jeu web (GitHub Pages, PWA) ne contient aucun SDK ni publicité** (`npm run check:bundle` l'impose : `ca-app-pub-`, `googlesyndication`, `GoogleMobileAds`… interdits dans `dist/`).

## État honnête (à lire d'abord)
| | Statut |
|---|---|
| Code implémenté (plugin Android Java, plugin iOS Swift, pont JS, réglages, garde-fous) | ✅ |
| Logique JavaScript, configuration et garde-fous testés (`tests/ads-native.test.ts`, `tests/ads-config.test.ts`) ; garde Gradle exécutée dans un vrai Gradle isolé | ✅ (fournisseurs **simulés** : aucun appel à Google) |
| Sources Java vérifiées par `javac` contre des **fausses classes** écrites à la main d'après le code du plugin communautaire `capacitor-community/admob` 8.2.1 | ✅ syntaxe/types seulement — **pas** une compilation contre les vrais SDK |
| Compilation Android réelle (`assembleDebug`) · compilation iOS (Xcode, Mac) | ❌ **non faites** : essai réel de `./gradlew assembleDebug` (synchronisation Capacitor réussie) → refus 403 de `dl.google.com` (plugin Gradle Android 8.13.0, Google Maven) et aucun Android SDK installé ; pas de Mac. **Aucun APK n'existe.** Commande à lancer sur votre PC : section suivante |
| Versions et signatures vérifiées dans les sources officielles Google | ⚠️ partiellement : exemple officiel `googleads-mobile-android-examples` (cloné) → `play-services-ads 25.5.0`, UMP `4.0.0`, bloc récompensé de démonstration `ca-app-pub-3940256099942544/5224354917`, ID d'application de démonstration `~3347511713`, appels `RewardedAd.load/show`, `UserMessagingPlatform`, `ConsentDebugSettings`, `ServerSideVerificationOptions`. Pages `developers.google.com` et Google Maven inaccessibles |
| Mode démo effectif malgré les ID réels dans `mobile/ads.json` | ✅ vérifié dans un vrai Gradle (logique du `build.gradle`) et par test : `appId` et bloc résolus = démonstration Google |
| Essai sur appareil · message UMP publié affiché · annonce de test · circuit SSV complet | ❌ **non faits** |

Les deux callbacks SSV validés dans AdMob et le message européen publié sont des opérations **rapportées par l'éditeur**, pas une preuve de fonctionnement sur téléphone.

## Architecture
- **Plugin local** `plugins/polar-rift-ads/` (Capacitor 8, `polar-rift-ads` dans `package.json`, branché par `npx cap sync`) : Android `polarrift.ads.PolarRiftAdsPlugin` (Java), iOS `PolarRiftAdsPlugin` (Swift, Swift Package Manager). SDK : Android `play-services-ads` + `user-messaging-platform` ; iOS `GoogleMobileAds` 13.11.0 + UMP 3.1.x (branche maintenue pour Capacitor 8 d'après `capacitor-community/admob` 8.2.x). **Aucun SDK de statistiques ni de médiation.**
- **Pont JS** (`src/platform/plugins.ts`, `registerNativePlugin`) : `@capacitor/core` importé dynamiquement (rien sur le web), `Capacitor.isNativePlatform()` + `isPluginAvailable('PolarRiftAds')` + `registerPlugin` (vrai mécanisme ; l'ancien accès à `window.Capacitor.Plugins` ne fonctionnait que si un code avait déjà enregistré le plugin). Le proxy est enveloppé (`{ plugin }`) : renvoyé tel quel par une fonction `async`, il serait pris pour un « thenable » et ne se résoudrait jamais.
- **Contrat** (`AdsPlugin`, `src/monetization/ads.ts`) : `requestConsent()`, `getConsentState()`, `showPrivacyOptions()`, `load({placement})`, `show({placement,userId,customData})`.
- **Flux de la deuxième chance** : consentement (UMP) → préchargement → au choix du joueur : **session créée par le service** (`POST /api/ads/session`) → `show` avec son `userId` et son `customData` **posés sur l'annonce avant la présentation** → AdMob appelle le callback SSV du service → `POST /api/ads/claim`. Le résultat « rewarded » du plugin **n'accorde jamais rien** : seule la confirmation serveur (signature ECDSA, bloc autorisé, usage unique) fait autorité. Aucun crédit direct, aucune minuterie, aucun contournement si le SSV tarde ou échoue.
- Règles de reprise inchangées : 1ʳᵉ reprise publicité facultative ou 5 Prismes, suivante 10 Prismes, pas de 4ᵉ vie, première vie seule classée. Sans publicité, réseau ou consentement : le jeu reste jouable.

### Garanties du plugin (identiques Android / iOS)
- tout l'état sur le fil principal ; **une seule** demande de consentement et **un seul** chargement à la fois (les appels simultanés partagent le résultat) ; une seule projection à la fois (`busy`) ;
- `canRequestAds` (UMP) **recontrôlé avant chaque chargement et chaque affichage**, jamais mémorisé ; erreur UMP = état officiel, jamais d'autorisation forcée ;
- chaque `show` résolu **une seule fois**, à la fermeture : `rewarded` si la récompense a été gagnée (la fermeture ne l'efface pas), `dismissed` sinon (une fermeture avant récompense ne peut jamais produire `rewarded`), `failed` si rien n'a pu être présenté ; destruction de l'activité pendant l'affichage gérée ;
- annonce chargée : expire après 55 min ; changement de choix de confidentialité = annonce préchargée **invalidée**, chargement en cours abandonné, possibilités réévaluées ; le formulaire de consentement n'est demandé **qu'une fois par lancement** (ensuite : relecture de l'état, pas de boucle après chaque publicité) ;
- **aucun reset du consentement** à aucun lancement.

## Configuration : `mobile/ads.json` (identifiants PUBLICS, aucun secret)
| Champ | Rôle |
|---|---|
| `mode` | `demo` (défaut) : **identifiants de démonstration officiels de Google**, aucun identifiant du compte utilisé ; `live` : identifiants du compte |
| `android.appId` / `ios.appId` | **ID d'application AdMob** (`ca-app-pub-…~…`) — **à récupérer dans AdMob** (jamais déduits des ID de blocs) ; vides pour l'instant |
| `android.rewardedUnitId` | `ca-app-pub-4635509667785777/7300498334` (configuré) |
| `ios.rewardedUnitId` | `ca-app-pub-4635509667785777/7641252998` (configuré) |
| `unitAssociationConfirmed` | `false` : **à confirmer dans AdMob** (association bloc ↔ application) avant toute activation réelle |
| `testDeviceIds` | appareils de test déclarés (identifiant lu dans le journal du téléphone) : annonces de test + débogage UMP |
| `umpDebugGeography` | `off` \| `eea` \| `not_eea` (**débogage seulement** : ignoré par un build non « debuggable » / hors DEBUG) |

Identifiants de démonstration (rewarded) : Android `ca-app-pub-3940256099942544/5224354917`, iOS `…/1712485313` (relevés dans le code du plugin communautaire ; la documentation Google n'était pas accessible : **à recouper dans la documentation courante**) ; ID d'application d'exemple : Android `…~3347511713`, iOS `…~1458002511`. **Valeurs fournies par l'éditeur à compléter : les deux ID d'application AdMob** (Android et iOS) puis `mode: "live"` et `unitAssociationConfirmed: true`.

Application aux projets : Android lit le JSON dans Gradle (`manifestPlaceholders` → `com.google.android.gms.ads.APPLICATION_ID` + métadonnées du plugin ; **sans ID valide le SDK planterait au démarrage : le mode demo fournit l'ID d'exemple, donc aucun plantage**) ; iOS : `npm run mobile:ads -- --apply` écrit `GADApplicationIdentifier`, `SKAdNetworkItems` (identifiant Google `cstr6suwn9.skadnetwork` : **recouper avec la liste courante du guide Google**) et un bloc `PolarRiftAds` dans `Info.plist`.

### Production : une compilation provisoire ou de debug ÉCHOUE
- Android : `./gradlew bundleRelease` / `assembleRelease` → tâche `verifyAdsConfigRelease` (liée à `preReleaseBuild`) ; **toute** compilation → `verifyAdsConfig` (mode live sans ID réel, association non confirmée, etc.). Règles testées dans un Gradle isolé : demo + release = refusé ; live valide = accepté ; appareil de test ou débogage UMP + release = refusé.
- iOS : phase de compilation Xcode « Controle de la configuration publicitaire (production) » : en configuration **Release**, échec si `mode ≠ live`, ID de démonstration, appareil de test ou débogage UMP ; en plus, le plugin iOS en Release avec une configuration provisoire **n'affiche aucune publicité** (échec fermé).
- Dépôt : `npm run mobile:ads -- --release` et `npm run mobile:check -- --release` (déjà exigé par `mobile:android:aab`).

## Consentement (UMP), confidentialité
- Au lancement : actualisation UMP, formulaire **seulement si requis**, chargement **seulement si `canRequestAds`** ; recontrôle avant chaque chargement et affichage.
- **Réglages → Confidentialité** : lien vers la politique publique (`https://rambouraxel-del.github.io/Polarity/confidentialite.html`, texte à compléter par l'éditeur : **aucune conformité n'est affirmée**) ; **« Choix de confidentialité »** (application native, seulement quand UMP l'exige) : rouvre le formulaire, invalide la publicité préchargée, réévalue.
- Refus de personnalisation ≠ `canRequestAds` ≠ autorisation ATT : trois notions distinctes, seul `canRequestAds` décide du chargement.
- **Public** : général (adolescents et adultes). Le code ne déclare **ni** « enfants » (TFCD) **ni** âge de consentement (TFUA) **ni** classe de contenu : aucune limite d'âge inventée ; à compléter par l'éditeur dans AdMob / les fiches des magasins selon sa propre évaluation.
- **iOS / ATT** : non demandée. Le jeu ne fait aucun suivi propre ; sans autorisation ATT, AdMob sert des annonces sans IDFA. Pas de `NSUserTrackingUsageDescription`. Si l'éditeur veut des annonces personnalisées sur iOS, il faudra ajouter la demande ATT (après UMP) et le texte d'usage, selon les règles Apple.
- Android : permissions fusionnées par le SDK (état du réseau, identifiant publicitaire `AD_ID`) ; aucune permission ajoutée à la main hors `INTERNET`.

## SSV (service) : ce qui doit être vrai côté VPS (rien n'a été modifié ici)
- Callback : `https://vps-f5907180.vps.ovh.net/polarity/api/ads/ssv` (route `GET /api/ads/ssv`). Le service vérifie la signature ECDSA avec les clés publiques de Google, le bloc (`ADMOB_AD_UNIT_IDS`), le `custom_data` (identifiant de session, 32 hex) et le `user_id` (HMAC du profil).
- `ADMOB_AD_UNIT_IDS` : le paramètre `ad_unit` du callback est l'**identifiant numérique du bloc** (partie après `/`) : attendu `7300498334` (Android), `7641252998` (iOS). **Jamais** `1234567890` (outil de test de callback d'AdMob), **jamais** un bloc de démonstration de Google sur le backend de production ; **ne jamais désactiver la vérification de signature**.
- **Limite du mode démo** : une annonce de démonstration Google ne prouve pas le circuit SSV complet (son bloc n'est pas autorisé par le service de production, et c'est voulu). **Méthode isolée** : instance **de test** du service (jamais la production) avec `ADMOB_AD_UNIT_IDS=1234567890`, puis « Vérifier l'URL » d'AdMob (callback signé de test) → `POST /api/ads/claim` doit répondre `granted` une seule fois. Le circuit réel exige l'ID d'application du compte, un appareil de test déclaré et les blocs réels ; **je n'affirme pas** que des annonces de test sur un bloc réel déclenchent un callback signé : à observer dans les journaux du service.

## Compiler l'APK de débogage sur votre PC (Android)
Cet environnement n'a **ni Android SDK ni accès à `dl.google.com`** (Google Maven et dépôt du SDK : réponse 403 du réseau de la session ; ni `play-services-ads`, ni UMP, ni même le plugin Gradle Android ne peuvent être téléchargés). **Aucun APK n'a donc été produit ici.** Sur votre PC (Windows : `gradlew.bat`) :
1. Installer **Android Studio** (il apporte le JDK 21 et l'Android SDK ; ouvrir une fois *SDK Manager* et installer « Android SDK Platform 36 » + « Build-Tools »).
2. À la racine du dépôt, branche `feat/admob-ump-rewarded` : `npm ci` puis `npm run mobile:sync` (construit le jeu embarqué, contrôle le bundle, synchronise Capacitor : le plugin `polar-rift-ads` doit apparaître dans « Found 3 Capacitor plugins for android »).
3. `cd android` puis `./gradlew assembleDebug` (Windows : `gradlew.bat assembleDebug`). Mode `demo` : le build n'utilise que les identifiants de démonstration Google, malgré les ID réels de `mobile/ads.json`.
4. APK produit : `android/app/build/outputs/apk/debug/app-debug.apk`.
5. Installer : téléphone en mode développeur + débogage USB, puis `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` (ou copier le fichier sur le téléphone et l'ouvrir).
6. En cas d'erreur de compilation, copier le message complet : il portera sur la version exacte `25.5.0` des SDK ou sur une signature d'API réelle (jamais vérifiées ici).

## Procédure courte sur appareil
1. **Installation de test (mode demo)** : `npm run mobile:sync`, puis Android `cd android && ./gradlew assembleDebug` (installer l'APK) / iOS Xcode → appareil. Au premier lancement : aucun plantage ; en Survie, mourir une fois → l'option publicité apparaît **seulement** si une annonce est prête et le service la prend en charge.
2. **Relever l'identifiant de l'appareil** : Android `adb logcat | grep -i "test device"` (« Use RequestConfiguration.Builder().setTestDeviceIds(…) ») ; iOS : journal Xcode (« To get test ads on this device, set… »). Le déclarer dans `mobile/ads.json` → `testDeviceIds`.
3. **Géographie européenne UMP (debug)** : `umpDebugGeography: "eea"` (+ appareil déclaré), reconstruire en debug : le formulaire s'affiche. **Notre message publié** : mode `live` avec **notre ID d'application AdMob** + appareil déclaré (distinct du mode démo Google : en démo, le message spécifique de notre compte ne peut pas apparaître).
4. **Acceptation / refus / modification** : accepter → annonce chargée ; relancer → pas de nouveau formulaire (consentement conservé) ; Réglages → *Choix de confidentialité* → refuser → l'option publicité disparaît (annonce invalidée), puis ré-accepter → elle revient.
5. **Publicité** : fermer avant la fin → aucune reprise ; regarder jusqu'au bout → reprise accordée **après** confirmation serveur (quelques secondes) ; couper le réseau pendant/après → aucune reprise, jeu jouable, option « Connexion requise ».
6. **Vérification serveur** : journal du service (`payment_events`, provider `ads`) : `ad_rewarded` puis `ad_consumed` (une seule fois par session) ; `docker compose exec classement node node_modules/tsx/dist/cli.mjs server/admin.ts …` ou requête SQL en lecture sur `payment_events`.
7. **Avant toute publication** : repasser en `live` avec les valeurs du compte, **vider** `testDeviceIds`, `umpDebugGeography: "off"`, `npm run mobile:ads -- --apply`, `npm run mobile:ads -- --release`.

## Ce que je n'ai pas pu vérifier (annoncé)
Versions Android : `play-services-ads 25.5.0` + `user-messaging-platform 4.0.0` (exemple officiel Google `googleads-mobile-android-examples`, commit `eac5db1` du 18/09/2026 ; Google Maven reste inaccessible depuis l'environnement, leur disponibilité est à confirmer par le premier build réel) ; iOS épinglé 13.11.0 / UMP 3.1.x d'après le plugin communautaire) ; documentation officielle Google (inaccessible : signatures reprises du code compilé du plugin communautaire 8.2.1 et du comportement documenté de l'API) ; compilation Android/iOS ; comportement réel de l'API (`DebugGeography`, `customRewardText`…) sur appareil.
