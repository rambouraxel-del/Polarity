/**
 * Identité du jeu.
 *
 * Le nom affiché (« Polar Rift ») se change ici (et nulle part ailleurs dans le code). `index.html` le reçoit au build
 * (marqueur %GAME_NAME%, voir vite.config.ts). Les textes de documentation sont à mettre à jour à la main.
 *
 * ⚠ Le nom d'affichage n'a AUCUN lien avec les clés de sauvegarde : elles gardent l'espace de noms historique
 * `polarite.*` (voir `save/save.ts`) pour que le changement de nom ne fasse jamais perdre la progression.
 */
export const GAME_NAME = 'Polar Rift';

/** Espace de noms historique des clés de sauvegarde (ne pas changer : la progression des joueurs en dépend). */
export const STORAGE_NAMESPACE = 'polarite';
