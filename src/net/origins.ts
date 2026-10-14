/**
 * Origines web d'une application native Capacitor (WebView) : `<scheme>://<hostname>`, épinglées dans capacitor.config.ts
 * (server.androidScheme = https, server.iosScheme = capacitor, server.hostname = localhost ; ce sont aussi les défauts de Capacitor 8).
 *
 * À AJOUTER, EXACTEMENT, à `ALLOWED_ORIGINS` du service de classement en plus de l'origine GitHub Pages — aucun joker :
 *   ALLOWED_ORIGINS=https://<utilisateur>.github.io,https://localhost,capacitor://localhost
 * Distinct de l'adresse du SERVICE (VITE_LEADERBOARD_URL, https publique) : ce sont deux choses différentes (voir src/net/baseUrl.ts).
 * Un test (tests/native-origins.test.ts) vérifie que cette liste, capacitor.config.ts et le contrôle CORS du serveur restent cohérents.
 */
export const NATIVE_APP_ORIGINS: readonly string[] = ['https://localhost', 'capacitor://localhost'];
