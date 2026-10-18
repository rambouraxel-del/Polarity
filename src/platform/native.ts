/**
 * Couche native (application Android / iOS Capacitor). Le jeu est le MÊME code que sur le web : rien ici n'est du gameplay.
 *
 * Principes :
 * - détection par l'objet global injecté par l'enveloppe native (`window.Capacitor`) : sur le web, aucun module Capacitor n'est chargé ;
 * - les plugins sont importés dynamiquement (jamais dans le bundle d'une page web) ;
 * - toute erreur de plugin est ignorée : le jeu fonctionne sans cette couche (elle ne fait qu'améliorer le cycle de vie, le bouton Retour d'Android et l'écran de démarrage).
 * Ce module n'utilise aucun plugin de statistiques, de stockage externe, de caméra ou de position ; la publicité récompensée a son propre plugin local
 * (plugins/polar-rift-ads, AdMob + UMP, application native seulement : src/monetization/ads.ts). Voir docs/BUILD_MOBILE.md et docs/PUBLICITE.md.
 */
export type NativePlatform = 'android' | 'ios';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/** Plateforme native courante, ou null (navigateur, GitHub Pages, PWA). */
export function nativePlatform(root: { Capacitor?: CapacitorGlobal } = globalThis as { Capacitor?: CapacitorGlobal }): NativePlatform | null {
  const cap = root.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  const p = cap.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : null;
}

export interface NativeHooks {
  /** L'application passe en arrière-plan (écran verrouillé, retour à l'accueil du téléphone, appel). */
  onBackground(): void;
  /** L'application revient au premier plan. */
  onForeground(): void;
  /** Bouton Retour d'Android : vrai si le jeu l'a utilisé (pause, écran précédent) ; faux à l'accueil (l'application se ferme alors). */
  onBack(): boolean;
}

/**
 * Branche la couche native. Renvoie la plateforme, ou null sur le web (rien n'est alors chargé).
 * Le marquage de `<html>` (classes `native` et `native-android` / `native-ios`) permet d'ajuster le style sans condition dans le code de jeu.
 */
export async function initNative(hooks: NativeHooks): Promise<NativePlatform | null> {
  const platform = nativePlatform();
  if (!platform) return null;
  document.documentElement.classList.add('native', `native-${platform}`);
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appStateChange', ({ isActive }) => (isActive ? hooks.onForeground() : hooks.onBackground()));
    if (platform === 'android') {
      await App.addListener('backButton', () => {
        if (!hooks.onBack()) void App.exitApp();
      });
    }
  } catch {
    /* plugin indisponible : visibilitychange (app.ts) assure déjà la pause en arrière-plan */
  }
  try {
    // Texte clair sur fond nuit
    const { SystemBars, SystemBarsStyle } = await import('@capacitor/core');
    await SystemBars.setStyle({ style: SystemBarsStyle.Dark });
  } catch {
    /* sans effet visible */
  }
  return platform;
}

/** Masque l'écran de démarrage natif (appelé quand l'accueil est affiché). Sans effet sur le web. */
export async function hideNativeSplash(): Promise<void> {
  if (!nativePlatform()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    /* le délai de sécurité de capacitor.config.ts le masquera de toute façon */
  }
}

export type BackAction = 'exit' | 'home' | 'escape';

/**
 * Bouton Retour d'Android — décision pure (testée) : en partie ou dans un menu = même effet que la touche Échap (pause, reprise, écran précédent) ;
 * sur un écran de résultat = accueil ; à l'accueil sans partie = l'application se ferme.
 */
export function backAction(inRun: boolean, screen: string | null): BackAction {
  if (!inRun && (screen === 'home' || screen === null)) return 'exit';
  if (!inRun && (screen === 'result' || screen === 'campaign-result')) return 'home';
  return 'escape';
}
