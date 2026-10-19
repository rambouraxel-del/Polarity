# iOS sans Mac : Codemagic → TestFlight (guide)

**Statut honnête :** les fichiers sont prêts (`codemagic.yaml`, `scripts/ios-ci.ts`, tests), **mais aucune compilation iOS n'a encore été exécutée** : il n'y a pas de Mac dans l'environnement de développement. « Compilation iOS réussie » signifie uniquement *le parcours `ios-verification` est vert dans Codemagic*. Rien dans ce dépôt ne le prouve à l'avance.

## Ce que fait le pipeline
| Parcours | Compte Apple | Produit | Quand |
|---|---|---|---|
| `ios-verification` | **non requis** | rapport + journal (pas d'IPA) : prouve que le projet iOS et ses paquets Swift compilent, que le jeu est embarqué, que l'identifiant/versions/confidentialité sont corrects | à lancer **en premier**, dès que Codemagic est relié au dépôt |
| `ios-testflight` | requis (§ ci-dessous) | IPA signée, envoyée à App Store Connect → **TestFlight interne** | seulement quand le **Bundle ID définitif** est choisi et appliqué |

Les deux se lancent **à la main** (*Start new build*) : aucun déclenchement automatique, aucun envoi à chaque commit. Jamais de soumission à l'App Store ni de revue bêta externe (`submit_to_testflight: false`).

## Audit de l'état réel du projet iOS (statique)
| Point | État |
|---|---|
| Gestionnaire de dépendances | Swift Package Manager seulement (`ios/App/CapApp-SPM`, Capacitor `8.5.3` + plugins locaux `@capacitor/app` et `@capacitor/splash-screen` lus dans `node_modules/` : **`npm ci` obligatoire avant Xcode**, fait par le pipeline). Aucun CocoaPods. |
| Cible / versions | iOS 15 minimum ; version `2.0.0` (= `package.json`), build `1` (`mobile/release.json`) ; iPhone + iPad |
| Jeu embarqué | `ios/App/App/public/` est **généré** par `npm run mobile:sync` (non commité, c'est voulu) : le pipeline le construit puis vérifie sa présence |
| Réseau | aucune exception ATS (HTTPS seulement), `cleartext: false`, origine WebView `capacitor://localhost` épinglée ; le classement exige `VITE_LEADERBOARD_URL` en `https://` (variable Codemagic, publique ; vide = classement désactivé, le jeu reste jouable) |
| Confidentialité / export | `PrivacyInfo.xcprivacy` (aucun suivi), `ITSAppUsesNonExemptEncryption = false` (pas de question d'exportation à chaque envoi) |
| Icône / écran de démarrage | icône 1024 px **opaque** (pas de canal alpha, sinon refus Apple), écrans de démarrage présents |
| Schéma Xcode | pas de schéma partagé commité : Xcode utilise le schéma implicite `App` ; l'étape « lister les schémas » du pipeline l'affiche. Si Codemagic dit « scheme not found », envoyez-moi le journal. |
| **Bundle ID** | **provisoire** `com.example.polarrift` : le parcours signé **refuse de démarrer** tant qu'un identifiant définitif n'est pas fourni *et* appliqué au dépôt (`npm run mobile:ios:guard`). Je n'en invente aucun. |
| SDK publicitaires / achats | **aucun dans `main`** : les contrats `PolarRiftAds` / `PolarRiftBilling` n'ont pas de plugin natif, les deux fonctions restent désactivées et expliquées dans le jeu. Rien n'est activé fictivement. Le plugin AdMob/UMP (Swift + SwiftPM Google) vit sur la branche `feat/admob-ump-rewarded`, **jamais compilé** : s'il est fusionné plus tard, Codemagic récupérera ses paquets, et il faudra y ajouter `npm run mobile:ads` (voir `docs/PUBLICITE.md`). Aucune capacité (push, achats) n'est déclarée dans le projet : rien à activer côté Apple. |
| Numéro de build | calculé à chaque compilation signée : `max(mobile/release.json, dernier build TestFlight + 1)`, appliqué à l'espace de travail seulement (jamais commité) |

## À faire par vous (dans l'ordre)

### A. Apple Developer (developer.apple.com → *Account*)
1. Vérifiez que l'adhésion au **Apple Developer Program** est active et que les contrats sont acceptés (bandeau en haut de la page).
2. **Certificates, Identifiers & Profiles → Identifiers → +** → *App IDs* → *App* → **Explicit Bundle ID** : saisissez votre identifiant définitif (propositions : `docs/BUILD_MOBILE.md` §2 ; minuscules, chiffres, `_`, sans tiret), description « Polar Rift », **aucune capacité à cocher**. L'identifiant est **définitif** : il identifie l'app pour toujours.
3. Rien d'autre : le certificat et le profil de distribution sont créés par Codemagic.

### B. App Store Connect (appstoreconnect.apple.com)
1. **Utilisateurs et accès → Intégrations → API App Store Connect → Clés d'équipe → +** : nom « Codemagic », accès **App Manager**. Notez l'**Issuer ID** et l'**ID de clé**, puis **téléchargez le fichier `.p8` (une seule fois possible)**. Gardez-le hors de Git.
2. **Apps → + → Nouvelle app** : plateforme iOS, nom, langue, **le Bundle ID de l'étape A**, un SKU libre.
3. Dans l'app : **Informations sur l'app → Identifiant Apple** (un nombre) : notez-le (`APP_STORE_APPLE_ID`).
4. **TestFlight → Test interne → +** : créez un groupe (ex. « Équipe »), ajoutez-vous (vous devez être un utilisateur de l'équipe) et activez **« Distribution automatique des builds »**. Pas besoin de revue Apple pour les testeurs internes.

### C. Codemagic (codemagic.io)
1. Connectez-vous avec GitHub, **Add application** → dépôt `rambouraxel-del/Polarity` → type de configuration **codemagic.yaml**, branche `main`.
2. **Teams → Personal account → Integrations → App Store Connect → Connect** : nom **exactement `polar-rift-asc`**, collez Issuer ID et ID de clé, importez le `.p8`.
3. Créez la clé privée du certificat (sur Windows, dans *Git Bash*) :
   `ssh-keygen -t rsa -b 2048 -m PEM -f polar_rift_cert -q -N ""` → le fichier `polar_rift_cert` (sans extension) contient la clé. **Ne le commitez jamais.**
4. Application → **Environment variables** → groupe **`polar_rift_ios`** :
   | Variable | Valeur | Secure |
   |---|---|---|
   | `BUNDLE_ID` | le Bundle ID définitif (étape A) | non |
   | `APP_STORE_APPLE_ID` | le nombre noté en B.3 | non |
   | `CERTIFICATE_PRIVATE_KEY` | tout le contenu de `polar_rift_cert` (de `-----BEGIN` à `-----END`) | **oui** |
   | `VITE_LEADERBOARD_URL` | adresse HTTPS du service de classement (facultatif) | non |

### D. Dans le dépôt (à me demander quand l'identifiant est choisi)
`npm run mobile:set-id -- <Bundle ID>` puis commit/push : cela aligne `mobile/release.json`, le projet Xcode, Android et `capacitor.config.ts`. Tant que ce n'est pas fait, `ios-testflight` s'arrête avec un message clair (c'est voulu).

### E. Lancer
1. **Dès maintenant (aucun compte Apple nécessaire)** : Codemagic → l'application → **Start new build** → branche `main` → workflow **`ios-verification`**. Succès = toutes les étapes vertes + artefact `rapport-ios.txt` (identifiant, versions, « Jeu embarqué : oui », etc.). Un échec ici se corrige avant tout le reste : envoyez-moi le journal.
2. Quand A à D sont faits : workflow **`ios-testflight`**. Le build apparaît dans **TestFlight** après le traitement Apple (quelques minutes à une demi-heure) ; installez l'app **TestFlight** sur l'iPhone, acceptez l'invitation interne.
3. Chaque nouvelle compilation reprend un numéro de build supérieur automatiquement. Pour une nouvelle version affichée : modifiez `version` dans `package.json` puis `npm run mobile:version`.

## Sécurité
- Aucun certificat, clé privée, `.p8`, jeton ou mot de passe dans Git (testé : `tests/ios-ci.test.ts`). Les secrets restent dans Codemagic (variables *Secure* + intégration).
- Si la clé `.p8` ou `CERTIFICATE_PRIVATE_KEY` fuite : révoquez la clé dans App Store Connect / le certificat dans Apple Developer et recréez-les.
- Un compte Apple limite le nombre de certificats de distribution : ne recréez pas `CERTIFICATE_PRIVATE_KEY` sans raison.

## Si ça échoue (cas probables, non vérifiés faute de Mac)
- *Scheme not found* / paquet Swift introuvable : journal de l'étape « Résoudre les paquets Swift » ; à me transmettre.
- *No profiles / certificate* : le Bundle ID n'est pas enregistré (A.2) ou ≠ `BUNDLE_ID`.
- *Build number must be higher* : normalement impossible (calculé), sinon vérifier `APP_STORE_APPLE_ID`.
- Xcode « latest » trop récent pour Capacitor 8.5.3 : fixer `xcode: 26.x` dans `codemagic.yaml`.
- Minutes macOS : voir l'offre sur codemagic.io/pricing ; la vérification dure de l'ordre d'une dizaine de minutes.
