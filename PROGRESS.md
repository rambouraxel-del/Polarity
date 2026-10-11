# Suivi d'avancement

## Terminé
- [x] Initialisation Vite 8 + TypeScript 5.9 + Phaser 3.90 + Vitest 5 (dépendances verrouillées, `npm audit` : 0 vulnérabilité)
- [x] Simulation à pas fixe (1/120 s) : orbite, inversion, balises, score/combo, collisions continues
- [x] 11 motifs en 3 familles, directeur de vagues avec plafonds, validateur d'évitement, répit de cycle borné
- [x] Survie (courbe plafonnée, respirations, modulation du rythme, introductions des familles), 12 niveaux en données, défi quotidien UTC
- [x] Session : pause (bouton, Échap/P, onglet masqué, perte de focus), reprise volontaire avec compte à rebours
- [x] Interface complète en français (accueil, niveaux, défi, apparences/succès, options, pause, résultat), HUD, adaptation mobile et marges de sécurité
- [x] Rendu néon Phaser (primitives), effets désactivables, sons Web Audio procéduraux (activés après interaction)
- [x] Sauvegarde versionnée et robuste, 9 succès, 7 apparences, effacement confirmé
- [x] Interface publicitaire facultative désactivée (aucun SDK), docs de monétisation
- [x] Calibrage initial des étoiles par bots (`npm run sim`)
- [x] Mode démo `?demo` (bot) pour inspecter les motifs
- [x] Documentation : README, CLAUDE.md, docs/EQUILIBRAGE.md, docs/MONETISATION.md

## Restant / pistes
- Essais avec de vrais joueurs (équilibrage, seuils d'étoiles, ambition 15–20 min en Survie)
- Tests sur appareils réels (Safari iOS, Firefox, Android)
- Classement en ligne : évolution future (non prévu dans cette livraison)

## Vérifications exécutées (dernière passe)
| Commande | Résultat |
|---|---|
| `npm run check` (typecheck + tests + build) | OK — 64/64 tests |
| `npm run e2e` (Chromium headless) | 33/33 contrôles OK : menus, 3 modes, pause/échap/onglet masqué, reprise, tactile sans double inversion, bouton pause sans inversion, relance clic + Espace, 20 relances sans croissance du tas, sauvegarde persistée et corrompue, 5 tailles d'écran, aucune erreur console ni requête manquante |
| `npm run sim -- 3` | bots : 12/12 niveaux réussis (2 bots × 6 graines), Survie 3 min tenue |

## Choix d'équilibrage
Voir `docs/EQUILIBRAGE.md`.

## Blocages
Aucun.
