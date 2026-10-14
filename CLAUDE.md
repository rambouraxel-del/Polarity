# Polar Rift — instructions de travail

## Produit
Jeu d'arcade web (ordinateur + mobile). Un vaisseau tourne seul sur une orbite circulaire ; une seule commande
(clic / toucher dans l'arène / Espace) inverse sa direction. Éviter les menaces, collecter 6 balises, enchaîner les combos.
Modes : **Campagne** (chapitre 1 « Douze ans de silence » : niveaux 1 à 10 livrés, récit illustré, étoiles, Éclats de campagne ; voir `docs/CAMPAGNE.md`),
**Défis classiques** (12 niveaux × 90 s, déblocage par la survie, étoiles au score ; sous-menu de la Campagne), **Survie** (sans fin, record = temps),
**Défi quotidien** (règles de Survie, graine = date UTC). Succès + apparences cosmétiques. Tout en local, sauf le classement mondial de Survie (facultatif).

Interdits de conception : tir, déplacement libre, dash, multijoueur, barre de vie, équipement à statistiques,
coût ou recharge sur l'inversion, publicité obligatoire, « continue » payant/publicitaire. Exception voulue, **réservée à la Campagne** : la narration (scènes illustrées avant et après chaque niveau).
Les améliorations de campagne (bouclier, collecteur, stabilisateur) existent en données et en logique mais **ne sont pas proposées** (`HANGAR_ENABLED = false`) ; elles ne s'appliqueraient jamais à la Survie, au défi quotidien ni aux défis classiques.

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
npm run e2e:classement # classement mondial (vrai serveur local)
npm run server       # service de classement (Node 22.13+)
npm run cost         # coût du directeur de vagues (validateur d'évitement inclus)
npm run perf         # coût CPU en émulation mobile (--dist <dossier> pour comparer deux builds)
npm run sprites      # textures 128 px depuis art/source/ (Pillow)
npm run music-map    # carte musicale (battements, basses, drops) depuis les MP3 (ffmpeg + numpy)
npm run check        # typecheck + tests + build
```

## Architecture (src/)
- `config/balance.ts` — paramètres globaux (vitesse du joueur, annonces, cadence, combo, répit, **plafonds** CAPS).
- `config/survival.ts` — difficulté de la Survie/défi (courbe τ, calendrier des motifs, intensification, annonces réduites).
- `config/hitbox.ts` — hitboxes (+6,5 %, `setHitboxGrowth` pour tester) ; `config/visuals.ts` — tailles des visuels (+15 %) et effets (`FX`).
  Ces trois réglages sont **indépendants** : les modifier séparément.
- `config/playerSpeed.ts` — vitesse du vaisseau (courbe de Survie 40 %→100 %, vitesse par niveau) et adaptation de l'équilibrage à la vitesse (`PACE`).
- `config/hazards.ts` — fragmenté, convoi, laser ; `config/events.ts` — pluie de météores, tempête électrique, calendrier.
- `config/version.ts` — `BALANCE_VERSION` : à incrémenter quand les règles qui influencent les performances changent (les records sont rattachés à cette version).
- `config/levels.ts` — les 12 niveaux (données : difficulté début/fin, rythme, poids des motifs, seuils d'étoiles).
- `core/` — RNG à graine (mulberry32), maths d'angles et de collision continue.
- `sim/` — simulation pure, sans rendu : `simulation.ts` (pas fixe 1/120 s), `beacons.ts`, `scoring.ts`, `hazards.ts`
  (menaces = fonctions pures du temps), `collision.ts` (détection continue), `patterns.ts` (14 motifs),
  `director.ts` (UN directeur : phases normal/annonce/événement/respiration, plafonds, répit), `speed.ts` (intégration de la vitesse), `safety.ts` (validateur d'évitement), `difficulty.ts`, `bot.ts` (joueur auto pour tests).
- `modes/` — profils de difficulté (Survie / Niveau), défi quotidien, fabrique de simulation.
- `game/` — `session.ts` (horloge, pause, compte à rebours, fin unique), `input.ts` (Pointer Events + Espace).
- `progression/` — progression/records (`progress.ts`), succès, apparences.
- `save/save.ts` — sauvegarde localStorage versionnée, validation champ par champ, repli si corrompue.
- `audio/sfx.ts` — sons Web Audio procéduraux (et contexte audio, volume, sourdine partagés) ; `audio/music.ts` + `config/music.ts` + `data/polar-rift-audio.json` — musique de partie (intro → boucle → outro, raccords sur l'horloge audio, jamais de `setTimeout`/`ended` pour relancer ; voir `docs/MUSIQUE.md`).
- `config/ambience.ts` (**source unique** de l'ambiance évolutive de la Survie : 5 stades, réactions musicales, plafonds, qualité), `ambience/` (`musicSync.ts` : carte musicale lue à la position de lecture réelle ; `director.ts` : stades et réactions, logique pure), `render/ambience/` (calques derrière le jeu), `data/polar-rift-music-map.json` (généré par `scripts/analyze-music.py`). Survie et défi quotidien seulement. Voir `docs/AMBIANCE.md`.
- `render/` — `ArenaRenderer.ts` (sprites vaisseau/astéroïdes + effets par code), `geometry.ts` (sens du déplacement et du réacteur, testé),
  `GameScene.ts` (chargement des textures).
- `ui/` — `theme.ts` (**source unique** des couleurs, polices, rayons, durées → variables CSS), `components.ts` (boutons, en-têtes, réglages…), `icons.ts` (SVG), `screens.ts` (écrans HTML), `space.ts` (fond spatial des menus), HUD, formatage. `app.ts` orchestre le tout.
- `styles/` — `index.css`, `base.css`, `components.css`, `screens.css`, `hud.css` : aucune couleur en dur (variables `--c-*`, voir `docs/INTERFACE.md`).
- `config/skins.ts` — apparences (identifiant stable, nom, modèle, couleurs coque/ailes/cockpit/réacteur, déblocage) : cosmétiques uniquement, hitbox et gabarit identiques, réacteur distinct des dangers (testé) ; `progression/skins.ts` (déblocage, repli sur « classique ») ; `render/{shipPalette,shipTextures,skinSprites}.ts` ; `ui/shipPreview.ts`. Voir `docs/APPARENCES.md`.
- `config/economy.ts` (éclat sur l'orbite, récompenses de niveau, soldes), `config/catalog.ts` (**source unique** du catalogue et des conditions d'obtention), `config/trails.ts` ; `progression/shop.ts` (possession, achats en Éclats, équipement) ; `sim/shards.ts` (éclat sur l'orbite, générateur dédié) ; `monetization/payments.ts` (interface de paiement future, aucun paiement actif). Voir `docs/ECONOMIE.md`.
- `config/achievements.ts` — **source unique** des 27 succès (objectif, catégorie, récompense en Éclats) ; `progression/achievements.ts` (progression, déblocage, récompense unique via `save.rewarded`). Les cosmétiques liés à un succès sont décrits au catalogue.
- `net/protocol.ts` (types/règles partagés jeu ↔ serveur), `net/leaderboard.ts` (client : profil, tickets, file « en attente », jamais de secret), `server/` (service de classement Node + SQLite : validation par REJEU de la partie ; voir `docs/CLASSEMENT.md`). `Simulation.flipLog` = journal des entrées ; `Simulation.assisted` = aide de test (jamais éligible).
- `config/campaign.ts` — **source unique** de la campagne (niveaux 1 à 10, récompenses en Éclats de campagne, hangar prévu) ; `config/story.ts` + `data/campagne_niveaux_01_05.fr.json` et `_06_10.fr.json` — dialogues (source éditable séparée ; identifiants de scène `n<N>-before|after` = clés de sauvegarde, ne jamais les changer) ;
  `campaign/simulation.ts` (`CampaignSimulation extends Simulation`, **sans toucher à `src/sim/`**), `campaign/progress.ts` (étoiles, récompenses uniques, réserve de campagne), `campaign/bot.ts` ; `ui/campaignScreens.ts` (dont l'écran de récit) + `styles/campaign.css` ; assets `assets/story/*.webp`, masters PNG dans `art/campagne/` (hors bundle). Voir `docs/CAMPAGNE.md`.
- `config/brand.ts` — `GAME_NAME` (nom affiché, « Polar Rift ») et `STORAGE_NAMESPACE` (**'polarite', ne jamais changer** : clés de sauvegarde).
- `monetization/ads.ts` — interface publicitaire facultative, désactivée (aucun SDK).

## Règles de travail
- Gameplay déterministe : seul `Rng` (graine) sert au gameplay ; les effets décoratifs utilisent `Math.random`.
- Les sprites ne contiennent aucun effet : réacteur, traînées, particules et impact sont codés, **à l'opposé du déplacement**, purement décoratifs.
- Changer la difficulté ou les hitboxes : incrémenter `BALANCE_VERSION` et vérifier la migration de sauvegarde (`tests/progress.test.ts`).
- Ne jamais mettre de logique de gameplay dans le rendu ou l'UI. Les trois modes partagent la même `Simulation`.
- La vitesse du vaisseau et tous les chronomètres (événements, annonces, respiration) dépendent du temps actif : la pause les arrête. Le validateur d'évitement doit suivre la vitesse réelle (`speed` dans `EscapeQuery`).
- Un seul directeur de vagues à la fois ; le calendrier des événements utilise un générateur dédié dérivé de la graine (reproductible).
- Idées reportées (ne pas implémenter sans demande) : balise bonus temporaire, secteurs thématiques des niveaux (voir `docs/ROADMAP.md`).
- Tout nouveau paramètre d'équilibrage va dans `config/`.
- Couleurs, polices et rayons de l'interface : uniquement via `ui/theme.ts` (ou les variables CSS) ; pas de style en ligne ni de couleur hexadécimale dans `styles/` (testé). Les assets de référence (`art/reference/`) ne sont jamais affichés.
- Les identifiants d'apparence sont enregistrés dans la sauvegarde : ne jamais les changer ni les réutiliser ; une apparence sans effet de jeu (aucune statistique, pas de boutique ni de monnaie).
- Économie : cosmétiques seulement, aucun avantage de jeu ; achat = vérification du solde + débit + déblocage dans la même modification ; Prismes jamais débités ni crédités localement (paiements non actifs) ; sauvegarde versionnée (format 6) : toute nouvelle donnée de progression passe par `save.ts` (sanitize + migration).
- Classement : le serveur ne croit jamais le client (rejeu graine + entrées) ; aucune clé secrète ni route d'administration dans le jeu ; toute modification des règles de simulation exige `BALANCE_VERSION` + redéploiement du serveur ; le serveur doit rester déterministe-identique au client (même code `src/`). Succès : objectifs sans dépense, récompenses versées une seule fois.
- Campagne : ne jamais modifier `src/sim/*` pour elle (Survie et rejeu serveur identiques, `BALANCE_VERSION` inchangée) ; `createSimulation` refuse le mode `campaign` ; aucune partie de campagne n'est envoyée au classement ; les gains vont dans la **réserve de campagne** (`save.campaign.reserve`), jamais dans le portefeuille de la Survie, et la campagne ne touche ni aux succès ni aux statistiques ni aux cosmétiques (le vaisseau de campagne est `CAMPAIGN_SKIN`) ; étoile et récompense passent de faux à vrai dans la même modification de sauvegarde (jamais de double crédit) ; sauvegarde format 6 (champ `campaign`). Récit : une réplique à la fois, premier toucher = révéler, suivant = avancer, jamais de transmission pendant une esquive, scènes jouées une seule fois puis relisibles ; niveaux 1 à 5 : astéroïdes seulement ; niveaux 6 à 10 : aucun laser hostile (premiers lasers au niveau 11).
- Ambiance de la Survie : décorative uniquement (jamais de lecture par la simulation), jamais en Campagne ni en Défis classiques ; synchronisée sur `Music.position()` + carte musicale (pas de BPM supposé, pas de minuteur, rien sans musique) ; tout réglage dans `config/ambience.ts` ; menaces, vaisseau et objets toujours au-dessus et lisibles (voile, plafonds, pas de flash plein écran ni de tremblement) ; effets réduits respectés.
- Réglages audio/visuels du joueur : volume général, Musique, Effets sonores (bus séparés dans `Sfx`/`Music`), Intensité visuelle et Effets réduits vivent dans `save.options` ; l'ambiance ne réagit que si la musique est réellement audible (pas de sourdine, volume > 0, position en lecture) ; vérifications sur téléphone : `docs/VERIFICATIONS_MOBILE.md`.
- Progression et boutique (V1) : un pack partiellement possédé est facturé au prorata (`effectivePrice`) ; un succès n'est versé qu'une fois (`rewarded`) ; une sauvegarde écrite par un autre onglet est adoptée (`parseSave`), jamais écrasée ; stockage refusé et sauvegarde illisible sont signalés à l'accueil ; l'effacement confirmé (`resetProgress`) conserve les préférences et le profil du classement ; les Prismes ne sont ni affichés ni achetables en V1 ; « Éclats » (Survie, niveaux, succès, boutique) ≠ « Éclats de campagne » (réserve séparée).
- Musique : repères du JSON utilisés exactement (boucle `loopStart`/`loopEnd`, jamais le MP3 entier) ; raccords programmés sur l'horloge Web Audio ; un seul ensemble de buffers, jamais rechargé ; fin de partie = fondu vers l'outro (jamais d'attente du tour de boucle) ; réutiliser le contexte, le volume et la sourdine de `Sfx`.
- Textes utilisateur en français. Pas de bouton factice.
- Après une modification : `npm run check`, et `npm run build && npm run e2e` si l'interface change.
- Mettre à jour `PROGRESS.md` et `RESUME.md` à chaque jalon.
- Pas de reset Git, de force push, de déploiement ni de publication sans demande explicite.
