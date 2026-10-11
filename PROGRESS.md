# Suivi d'avancement

## Version 1.1 — « Néon premium » et courbe de Survie accélérée (terminée)
- [x] Sprites : vaisseau blanc/argent à cockpit cyan et 4 astéroïdes rocheux aux fissures orange (fond transparent, sans aucun effet intégré)
- [x] Effets par code, à l'opposé du déplacement : flamme et étincelles du vaisseau, traînée et braises d'astéroïdes ; inversion instantanée
- [x] Visuels +15 % ; hitboxes +6,5 % (réglage séparé, plage 5–8 %, en retrait des silhouettes) ; impact bref au point de contact
- [x] Survie/défi : d(2 min) = d(5 min v1.0) = 0,77 ; doubles dès 30 s ; combinaisons projectile/secteur dès 60 s ; intensification + brèves respirations après 3 min ; annonces −8 % avec planchers
- [x] Réglages séparés : `config/survival.ts`, `config/hitbox.ts`, `config/visuals.ts` ; plafonds et validateur d'évitement inchangés
- [x] Sauvegarde v2 : progression préservée, anciens records rangés à part, copie de l'ancienne sauvegarde, information unique à l'écran d'accueil
- [x] Tests (97), e2e (≈ 55 contrôles), mesure de performance, documentation (README, ASSETS, EQUILIBRAGE)

## Version 1.0 (terminée)
Jeu complet : 12 niveaux, Survie, défi quotidien, succès, apparences, sauvegarde, sons, interface mobile, GitHub Pages.

## Restant / pistes
- Essais avec de vrais joueurs : équilibrage de la courbe v1.1, seuils d'étoiles (à réexaminer avec les hitboxes agrandies)
- Tests sur appareils réels (Safari iOS, Firefox, Android) et mesure GPU mobile
- Classement en ligne : évolution future (non prévu)

## Vérifications exécutées (v1.1)
| Commande | Résultat |
|---|---|
| `npm run check` (typecheck + tests + build) | OK — 97 tests |
| `npm run e2e` (Chromium headless) | tous les contrôles OK : sprites chargés, inversion immédiate, impact, migration v1→v2, menus, 3 modes, pause, tactile, relances, 5 tailles d'écran, aucune erreur console |
| `npm run sim -- 6` | bots : 12/12 niveaux réussis, Survie 6 min tenue ; d(120 s) = 0,771 ; ≈ 27 → 33 vagues/min après 3 min |
| `npm run perf` (×4 ralenti, 390×844) | app.frame 1,9 → 2,3 ms (moyenne), p95 5,5 → 6,5 ms ; tas JS stable (≈ 9–10 Mo) ; GPU non mesurable (rendu logiciel) |

## Choix d'équilibrage
Voir `docs/EQUILIBRAGE.md`. Assets : `docs/ASSETS.md`.

## Blocages
Aucun.
