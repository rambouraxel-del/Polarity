# Suivi d'avancement

## Terminé
- [x] Initialisation Vite + TypeScript + Phaser + Vitest (dépendances verrouillées, 0 vulnérabilité npm audit)
- [x] Simulation à pas fixe : orbite, inversion, balises, score/combo, menaces (projectiles, secteurs), collisions continues
- [x] 11 motifs en 3 familles, directeur de vagues avec plafonds, validateur d'évitement, répit de cycle borné
- [x] Survie (courbe plafonnée, respirations, modulation du rythme), 12 niveaux en données, défi quotidien
- [x] Session : pause (bouton, Échap, onglet masqué, perte de focus), reprise volontaire avec compte à rebours
- [x] Interface DOM complète (accueil, niveaux, défi, apparences/succès, options, pause, résultat), HUD
- [x] Rendu néon Phaser, effets (particules, anneaux, secousse/flash désactivables), sons Web Audio
- [x] Sauvegarde versionnée et robuste, succès, 7 apparences
- [x] Tests unitaires (64) et test navigateur Playwright

## En cours
- Calibrage des seuils d'étoiles et relecture visuelle des motifs

## Restant
- Documentation finale (README), bilan

## Vérifications exécutées
| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | OK |
| `npm test` | 64/64 tests OK |
| `npm run build` | OK |
| `node scripts/e2e.mjs` | contrôles fonctionnels OK (menus, 3 modes, pause, onglet masqué, tactile, relances, 5 tailles d'écran) |

## Choix d'équilibrage (points de départ, à confirmer par des essais humains)
Voir `docs/EQUILIBRAGE.md`.

## Blocages
Aucun.
