/**
 * Aide aux contrôles adaptée à l'appareil : toucher sur mobile ; clic, Espace et Échap sur ordinateur.
 * Le choix suit le pointeur principal du système (`pointer: coarse` = écran tactile).
 */
export function isTouchPrimary(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
}

/** Aide de l'accueil (HTML : les touches sont mises en forme). */
export function homeHelp(touch: boolean): string {
  return touch
    ? 'Touchez l’écran pour inverser la direction. Bouton ❚❚ : pause.'
    : 'Cliquez ou appuyez sur <span class="kbd">Espace</span> pour inverser la direction. <span class="kbd">Échap</span> : pause.';
}

/** Bandeau de la première partie (HTML). */
export function bannerHelp(touch: boolean): string {
  return touch
    ? 'Touchez l’écran pour inverser la direction.'
    : 'Cliquez ou appuyez sur <strong>Espace</strong> pour inverser la direction. <strong>Échap</strong> : pause.';
}
