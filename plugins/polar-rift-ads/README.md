# polar-rift-ads (plugin Capacitor local)

Publicité récompensée **AdMob** + consentement **UMP**, pour les applications natives Android et iOS de Polar Rift. Le build web ne contient ni ce plugin ni aucun SDK publicitaire.

Contrat JavaScript (`src/monetization/ads.ts`, `AdsPlugin`) : `requestConsent()`, `getConsentState()`, `showPrivacyOptions()`, `load({placement})`, `show({placement,userId,customData})`.

- **Android** : `android/` (Java, `polarrift.ads.PolarRiftAdsPlugin`) ; SDK `play-services-ads` et `user-messaging-platform`.
- **iOS** : `ios/Sources/PolarRiftAdsPlugin/` (Swift) ; SDK `GoogleMobileAds` et `GoogleUserMessagingPlatform` par Swift Package Manager (`Package.swift`).
- Configuration (identifiants publics, mode démonstration / compte, appareils de test) : `mobile/ads.json` (voir `scripts/ads-config.ts` et `docs/BUILD_MOBILE.md`).

Règles : chaque chargement et chaque affichage recontrôlent `canRequestAds` ; `userId` et `customData` de la session serveur sont transmis à la régie AVANT l'affichage ; chaque appel est résolu une seule fois ; la récompense du jeu n'est JAMAIS accordée d'après ce plugin (la vérification serveur à serveur fait seule autorité).
