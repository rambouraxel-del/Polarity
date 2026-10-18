/**
 * Publicité récompensée (application native seulement) — constantes PUBLIQUES côté jeu. Les identifiants AdMob par plateforme (mode démonstration ou
 * compte) vivent dans mobile/ads.json, lus par les projets natifs ; le code web ne contient et ne charge aucun SDK publicitaire.
 */
/** Emplacement de la publicité de deuxième chance (côté plugin : bloc récompensé de la plateforme). */
export const REWARDED_PLACEMENT = 'revive';

/** Politique de confidentialité publique (texte à compléter par l'éditeur : aucune conformité n'est supposée acquise par ce lien). */
export const PRIVACY_POLICY_URL = 'https://rambouraxel-del.github.io/Polarity/confidentialite.html';

/** Une annonce chargée expire après environ une heure : au-delà, elle est rechargée (aucune annonce périmée n'est présentée). */
export const AD_MAX_AGE_MS = 55 * 60 * 1000;
