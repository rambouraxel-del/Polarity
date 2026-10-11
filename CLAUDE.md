# Polarité — instructions de travail

## Produit
Jeu d'arcade web (ordinateur + mobile). Un vaisseau tourne seul sur une orbite circulaire ; une seule commande
(clic / toucher dans l'arène / Espace) inverse sa direction. Éviter les menaces, collecter 6 balises, enchaîner les combos.
Modes : **Niveaux** (12 × 90 s, déblocage par la survie, étoiles au score), **Survie** (sans fin, record = temps),
**Défi quotidien** (règles de Survie, graine = date UTC). Succès + apparences cosmétiques. Tout en local, sans serveur.

Interdits de conception : tir, déplacement libre, dash, multijoueur, narration, barre de vie, équipement à statistiques,
coût ou recharge sur l'inversion, publicité obligatoire, « continue » payant/publicitaire.

## Pile technique
TypeScript 5.9 · Phaser 3.90 (rendu uniquement) · Vite 8 · Vitest 5. Sprites PNG locaux (src/assets/sprites), effets générés par code. Dépendances verrouillées (`package-lock.json`).

## Commandes
```
npm install          # installation
npm run dev          # serveur de développement
npm run build        # vérification TypeScript + build de production (dist/)
npm run typecheck    # TypeScript seul
npm test             # tests unitaires (Vitest)
npm run sim          # outil d'équilibrage (bot) : npm run sim -- 5   (minutes de Survie)
npm run e2e          # test navigateur (Chromium/Playwright) après npm run build ; captures dans screenshots/
npm run perf         # coût CPU en émulation mobile (--dist <dossier> pour comparer deux builds)
npm run sprites      # textures 128 px depuis art/source/ (Pillow)
npm run check        # typecheck + tests + build
```

## Architecture (src/)
- `config/balance.ts` — paramètres globaux (vitesse du joueur, annonces, cadence, combo, répit, **plafonds** CAPS).
- `config/survival.ts` — difficulté de la Survie/défi (courbe τ, calendrier des motifs, intensification, annonces réduites).
- `config/hitbox.ts` — hitboxes (+6,5 %, `setHitboxGrowth` pour tester) ; `config/visuals.ts` — tailles des visuels (+15 %) et effets (`FX`).
  Ces trois réglages sont **indépendants** : les modifier séparément.
- `config/version.ts` — `BALANCE_VERSION` : à incrémenter quand les règles qui influencent les performances changent (les records sont rattachés à cette version).
- `config/levels.ts` — les 12 niveaux (données : difficulté début/fin, rythme, poids des motifs, seuils d'étoiles).
- `core/` — RNG à graine (mulberry32), maths d'angles et de collision continue.
- `sim/` — simulation pure, sans rendu : `simulation.ts` (pas fixe 1/120 s), `beacons.ts`, `scoring.ts`, `hazards.ts`
  (menaces = fonctions pures du temps), `collision.ts` (détection continue), `patterns.ts` (11 motifs, 3 familles),
  `director.ts` (vagues, plafonds, répit), `safety.ts` (validateur d'évitement), `difficulty.ts`, `bot.ts` (joueur auto pour tests).
- `modes/` — profils de difficulté (Survie / Niveau), défi quotidien, fabrique de simulation.
- `game/` — `session.ts` (horloge, pause, compte à rebours, fin unique), `input.ts` (Pointer Events + Espace).
- `progression/` — progression/records (`progress.ts`), succès, apparences.
- `save/save.ts` — sauvegarde localStorage versionnée, validation champ par champ, repli si corrompue.
- `audio/sfx.ts` — sons Web Audio procéduraux.
- `render/` — `ArenaRenderer.ts` (sprites vaisseau/astéroïdes + effets par code), `geometry.ts` (sens du déplacement et du réacteur, testé),
  `GameScene.ts` (chargement des textures).
- `ui/` — écrans HTML (`screens.ts`), HUD, formatage. `app.ts` orchestre le tout.
- `monetization/ads.ts` — interface publicitaire facultative, désactivée (aucun SDK).

## Règles de travail
- Gameplay déterministe : seul `Rng` (graine) sert au gameplay ; les effets décoratifs utilisent `Math.random`.
- Les sprites ne contiennent aucun effet : réacteur, traînées, particules et impact sont codés, **à l'opposé du déplacement**, purement décoratifs.
- Changer la difficulté ou les hitboxes : incrémenter `BALANCE_VERSION` et vérifier la migration de sauvegarde (`tests/progress.test.ts`).
- Ne jamais mettre de logique de gameplay dans le rendu ou l'UI. Les trois modes partagent la même `Simulation`.
- Tout nouveau paramètre d'équilibrage va dans `config/`.
- Textes utilisateur en français. Pas de bouton factice.
- Après une modification : `npm run check`, et `npm run build && npm run e2e` si l'interface change.
- Mettre à jour `PROGRESS.md` et `RESUME.md` à chaque jalon.
- Pas de reset Git, de force push, de déploiement ni de publication sans demande explicite.
