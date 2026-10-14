import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Enveloppe native (Android / iOS) du MÊME jeu web : aucun code de jeu n'est dupliqué, l'application embarque simplement le dossier construit
 * par `npm run build:native` (dist-native/). Voir docs/BUILD_MOBILE.md.
 *
 * Valeurs PROVISOIRES (à décider par l'éditeur avant toute publication) : `appId` ci-dessous est volontairement un identifiant « exemple » que les
 * stores refusent ; il se remplace par `npm run mobile:set-id -- <identifiant>` (qui met aussi à jour les projets android/ et ios/).
 *
 * ORIGINES DU CLASSEMENT : l'origine web d'une application Capacitor est `<scheme>://<hostname>`. Elles sont ÉPINGLÉES ici (elles valent aussi les
 * défauts de Capacitor 8) car le serveur du classement n'accepte que des origines exactes (ALLOWED_ORIGINS, jamais `*`), et car le stockage local (sauvegarde)
 * est rattaché à l'origine : la changer plus tard ferait perdre les sauvegardes des joueurs. Ne JAMAIS modifier ces trois valeurs après une première publication.
 *   Android : https://localhost        iOS : capacitor://localhost        (src/net/origins.ts, testé)
 */
const config: CapacitorConfig = {
  appId: 'com.example.polarrift',
  appName: 'Polar Rift',
  webDir: 'dist-native',
  backgroundColor: '#070b1f',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    iosScheme: 'capacitor',
    // Jamais de trafic non chiffré : aucune adresse http n'est autorisée vers le service
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    // Débogage de la vue web (chrome://inspect) : actif seulement dans l'APK de test (comportement par défaut de Capacitor), jamais dans la version de publication
  },
  ios: {
    // Le jeu gère lui-même les zones sûres (encoche, barre d'accueil) via env(safe-area-inset-*) : la vue web occupe tout l'écran
    contentInset: 'never',
    scrollEnabled: false,
    allowsLinkPreview: false,
    backgroundColor: '#070b1f',
  },
  plugins: {
    SplashScreen: {
      // Masqué par le jeu dès que l'accueil est prêt (src/platform/native.ts) ; le délai ci-dessous n'est qu'un filet de sécurité
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: '#070b1f',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    SystemBars: {
      // « native » : les anciennes vues web sont décalées sous les barres ; les récentes (Chromium ≥ 140) s'étendent derrière et fournissent env(safe-area-inset-*)
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
};

export default config;
