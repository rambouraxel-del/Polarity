# Suivi d'avancement

## Version 1.1 — « Néon premium » et courbe de Survie accélérée (terminée)
- [x] Sprites : vaisseau blanc/argent à cockpit cyan et 4 astéroïdes rocheux aux fissures orange (fond transparent, sans aucun effet intégré)
- [x] Effets par code, à l'opposé du déplacement : flamme et étincelles du vaisseau, traînée et braises d'astéroïdes ; inversion instantanée
- [x] Visuels +15 % ; hitboxes +6,5 % (réglage séparé, plage 5–8 %, en retrait des silhouettes) ; impact bref au point de contact
- [x] Survie/défi : d(2 min) = d(5 min v1.0) = 0,77 ; doubles dès 30 s ; combinaisons projectile/secteur dès 60 s ; intensification + brèves respirations après 3 min ; annonces −8 % avec planchers
- [x] Réglages séparés : `config/survival.ts`, `config/hitbox.ts`, `config/visuals.ts` ; plafonds et validateur d'évitement inchangés
- [x] Sauvegarde v2 : progression préservée, anciens records rangés à part, copie de l'ancienne sauvegarde, information unique à l'écran d'accueil
- [x] Tests (97), e2e (≈ 55 contrôles), mesure de performance, documentation (README, ASSETS, EQUILIBRAGE)

## Version 1.2 — vitesse progressive, nouveaux dangers, événements (terminée)
- [x] Vitesse du vaisseau en Survie/défi : 40 % de la référence au départ, +5 points toutes les 30 s (45 % à 30 s … 100 % à 6 min), lissage de 2 s qui se termine au palier, plafond 100 % ; inversion instantanée sans changement de vitesse ; vitesse par niveau configurable (1,0 pour les 12 niveaux)
- [x] Trois nouveaux dangers : astéroïde fragmenté (annonce des fragments, délai de réaction ≥ 0,45 s), convoi (2–3 astéroïdes, même trajectoire), laser balayeur (secteur limité, zone de refuge ≥ 2,4 rad) ; introduits à ≈ 38 s / 75 s / 110 s ; rendu par code, sprites d'astéroïdes réutilisés (fragments à 70 %)
- [x] Événements : pluie de météores (12 s) et tempête électrique (10 s) ; premier entre 45 et 60 s, puis 40–60 s après la fin ; annonce 2 s avant, respiration 3 s ; un seul directeur (machine d'états) ; menaces restantes jamais effacées ; calendrier reproductible (graine dédiée) ; pause = tous les chronomètres arrêtés
- [x] Équilibrage adapté à la vitesse réelle : annonces, décalages, intervalles, largeur des secteurs, vitesse des lasers (`PACE`) ; validateur d'évitement qui suit la vitesse (réseau d'angles, testé contre une exploration exhaustive) ; plafonds et difficulté d(t) inchangés
- [x] Version d'équilibrage 3 : records v1.1 archivés à part (v1.0 intacts), copie `polarite.save.avant-eq2`, information unique à l'accueil ; progression préservée
- [x] 218 tests, e2e étendu (paliers de vitesse, pause à l'annonce, événements, nouveaux motifs), mesure de performance, documentation (`docs/EQUILIBRAGE.md`, `docs/ROADMAP.md`)

## v1.5 — économie : Éclats, Prismes, boutique (terminée)
- [x] Éclat sur l'orbite en Survie (5 s, un seul à la fois, 15–25 s entre deux, +5 Éclats) : générateur dédié, emplacement accessible avec la vitesse réelle, pause respectée, crédit unique et immédiat, visible sur toutes les couleurs d'orbite
- [x] Récompenses de niveau (50 / 15 par étoile / 10), registre anti-doublon, détail au résultat ; sauvegarde format 3 avec migration sans crédit rétroactif
- [x] Prismes : solde séparé (0), catalogue premium « Bientôt disponible », aucune transaction active ; interface `PaymentProvider` pour une future intégration validée côté serveur
- [x] Boutique (Vaisseaux / Traînées / Packs), confirmation, achats atomiques sans double débit, états Acheter / Équiper / Possédé / Solde insuffisant / Succès requis ; soldes sur l'accueil, la boutique et Apparences
- [x] Catalogue centralisé (`config/catalog.ts`), nouvelles apparences (Spectre, Néon) et traînées ; exclusivités de succès conservées ; tests (218), e2e, documentation (`docs/ECONOMIE.md`)

## v1.4 — visibilité du vaisseau et apparences (terminée)
- [x] Vaisseau +20 % (hitbox inchangée), coque plus blanche, cockpit cyan plus vif, lueur discrète et liseré sombre ; contours orange des astéroïdes renforcés (taille inchangée) ; orbite cyan vif
- [x] Aide aux contrôles adaptée (toucher sur mobile ; clic, Espace, Échap sur ordinateur)
- [x] Menu Apparences : grand aperçu animé (figé en effets réduits), cartes Équipé / Disponible / Verrouillé, bouton « Équiper », condition de déblocage précise
- [x] Apparences en configuration extensible (`config/skins.ts`), une texture par apparence, repli sur « classique », réacteurs distincts des dangers (testé), sauvegarde et application dans tous les modes
- [x] Tests (`tests/skins.test.ts`, `tests/ui.test.ts`), e2e (équipement, verrouillage, modes, rechargement, repli), documentation (`docs/APPARENCES.md`)

## Direction artistique « Néon premium » — nom Polarity (terminée)
- [x] Nom affiché « Polarity » (`config/brand.ts`) ; clés de sauvegarde `polarite.*` inchangées (testé)
- [x] Thème centralisé (`ui/theme.ts` → variables CSS → couleurs Phaser), police Orbitron locale, composants et icônes SVG, feuilles de style séparées (`src/styles/`)
- [x] Logo PNG utilisé directement ; planche des menus et maquette d'accueil recréées en HTML/CSS réel (références dans `art/reference/`)
- [x] Écrans : accueil, niveaux (terminé / à jouer / verrouillé), défi quotidien, apparences + succès (onglets), options, confirmation, pause, résultat (3 variantes), HUD harmonisé
- [x] Fond spatial animé par code dans les menus seulement (statique en effets réduits), arène inchangée ; transitions d'écran ; adaptation portrait / paysage / 320 px, zones de sécurité
- [x] Mécaniques, difficulté, vitesses, hitboxes, tailles des sprites : inchangées (`BALANCE_VERSION` inchangé)
- [x] Tests d'interface (`tests/ui.test.ts`), e2e étendu (4 tailles d'écran, tous les écrans, effets réduits, transitions) ; documentation `docs/INTERFACE.md`

## Lisibilité des éléments (terminée)
- [x] Vaisseau ×1,45 et astéroïdes ×1,35 (par rapport à la v1.1) ; contour lumineux orange des astéroïdes renforcé (silhouette orange additive)
- [x] Flamme (largeur 5 → 6,5) et traînées d'astéroïdes plus épaisses, longueurs inchangées (14 et 52) ; effets toujours codés, sans collision
- [x] Hitboxes, difficulté, textes, quadrillage, orientation du vaisseau et inversion immédiate : inchangés (tests et e2e)
- [x] 99 tests, e2e (contrôles de taille +45 % / +35 %, contour orange, inversion), build ; vérifié sur ordinateur (1280×800) et mobile (390×844)

## Version 1.0 (terminée)
Jeu complet : 12 niveaux, Survie, défi quotidien, succès, apparences, sauvegarde, sons, interface mobile, GitHub Pages.

## Restant / pistes
- **Évolutions futures notées, non implémentées** : balise bonus temporaire, secteurs thématiques des niveaux (`docs/ROADMAP.md`)
- Essais avec de vrais joueurs : équilibrage de la courbe v1.1, seuils d'étoiles (à réexaminer avec les hitboxes agrandies)
- Tests sur appareils réels (Safari iOS, Firefox, Android) et mesure GPU mobile
- Classement en ligne : évolution future (non prévu)

## Vérifications exécutées (v1.1)
| Commande | Résultat |
|---|---|
| `npm run check` (typecheck + tests + build) | OK — 218 tests |
| `npm run e2e` (Chromium headless) | tous les contrôles OK : sprites chargés, inversion immédiate, impact, migration v1→v2, menus, 3 modes, pause, tactile, relances, 5 tailles d'écran, aucune erreur console |
| `npm run perf` v1.2 (×4 ralenti, 390×844, charge identique) | app.frame 2,4 ms (avant 2,4–2,6 ms), p95 6,1–6,8 ms ; tas JS stable (≈ 10–11 Mo) |
| `npm run cost` (directeur + validateur, 8 min de Survie) | médiane 0,25 ms, p99 1,6 ms, max 5 ms (démarrage à froid) |
| `npm run sim -- 6` | bots : 12/12 niveaux réussis, Survie 6 min tenue ; d(120 s) = 0,771 ; ≈ 27 → 33 vagues/min après 3 min |
| `npm run perf` (×4 ralenti, 390×844) | app.frame 1,9 → 2,3 ms (moyenne), p95 5,5 → 6,5 ms ; tas JS stable (≈ 9–10 Mo) ; GPU non mesurable (rendu logiciel) |

## Choix d'équilibrage
Voir `docs/EQUILIBRAGE.md`. Assets : `docs/ASSETS.md`.

## Blocages
Aucun.
