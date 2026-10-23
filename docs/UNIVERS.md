# Voyage à travers les univers (refonte de la Survie, en validation)

Branche : `feat/survie-univers` (jamais fusionnée dans `main` sans validation du propriétaire).
État : **mode de test isolé**. Il se lance seulement depuis la fenêtre DEV (mode développeur actif). Toute partie du voyage est une
**partie de test** : aucun record, aucun gain, aucun succès, aucun ticket ni envoi au service. La Survie officielle (`BALANCE_VERSION` 4),
le défi quotidien, les défis classiques et la campagne ne changent pas.

## Les quatre univers

| # | Univers | Temps actif | Mécanique | Menaces propres | Musique |
|---|---------|-------------|-----------|-----------------|---------|
| 1 | Orbite originelle | 0 – 120 s | aucune | motifs historiques, événements (pluie, tempête) | morceau de la phase 1 monté sur 120 s |
| 2 | L'Entre-deux | 120 – 240 s | aucune | orbes de faille, arcs de surtension, spirales, faisceaux | morceau de la phase 2 |
| 3 | Mer nébulaire | 240 – 360 s | nuages lents, ondes de pression, bulles d'ombre (décor) | masses gazeuses, débris nébulaires | aucun morceau : fond procédural |
| 4 | Monde des vents | 360 s → ∞ | hémisphères 120 % / 50 %, inversions de courant, tourbillons | éclats portés par le vent, rafales (arcs mouvants), traînées de braises | aucun morceau : fond procédural |

Au-delà de 480 s, le dernier univers continue. La difficulté est plafonnée (`extension.dMax`) et oscille lentement. La vitesse est fixe
(`extension.speed`). Il n'y a jamais de « phase 5 » vide.

## Transition (4 s, hors temps de jeu)

La session gèle la simulation pendant `WORLDS.transition` secondes : aucun pas, aucune collision, aucune collecte, aucun score, aucun bonus,
aucune recharge. Les commandes sont refusées.

**Chronologie** (`WORLDS.timeline`) :
1. **Ouverture** (0 – 1,2 s) : la faille s'ouvre.
2. **Aspiration** (1,2 – 2,2 s) : le vaisseau est aspiré, visuellement seulement. Ses coordonnées de jeu ne changent pas.
3. **Traversée** (2,2 – 3,2 s) : tunnel teinté vers le monde d'arrivée.
4. **Émergence** (3,2 – 4 s) : l'orbite se reconstitue.

**Variantes** : 1→2 faille violette, 2→3 brume turquoise, 3→4 spirale orange.

**À l'arrivée** : l'arène est vide. La première vague arrive après `firstWaveDelay` s. Aucune vague ne naît dans les `quietBefore` s qui
précèdent une faille.

**Robustesse** : la pause, le retour d'arrière-plan (image plafonnée) et une reprise juste avant une frontière sont gérés. Dans tous ces cas,
il y a une seule transition par frontière.

## Fichiers

- `src/config/worlds.ts` : **source unique** (calendrier, univers, palettes, vitesses, paliers, motifs, mécaniques `CLOUDS` et `CURRENTS`,
  dangers `WORLD_HAZARDS`). Contient aussi deux propositions inactives : `WORLDS_BALANCE_VERSION` (5) et `WORLD_BONUS_PROPOSAL`.
- `src/config/worldMusic.ts` : musique par univers, montage de l'univers 1, transition audio, grille de rythme `WORLDS_RHYTHM` (déterministe).
- `src/modes/worlds.ts` : profil de difficulté isolé (`worldsProfile`) ; `src/modes/run.ts` : `RunConfig.worlds` (Survie seulement).
- `src/sim/field.ts` : champs de vitesse (`WorldsField`), fonctions pures de la graine et du temps.
- `src/sim/simulation.ts` : `world`, `field` et `enterWorld`. Sans champ, le calcul est strictement l'ancien.
- `src/sim/safety.ts` : validateur à vitesse variable (`hasEscapePathField`). Sans champ, l'algorithme historique est inchangé.
- `src/sim/hazards.ts`, `src/sim/collision.ts` : trajectoire `wave` et secteurs mouvants (`morph`, balayage relatif).
- `src/sim/patterns.ts` : motifs des univers 2 à 4, ajoutés à la fin (l'ordre historique est conservé).
- `src/game/session.ts` : transition générique (`transitTotal`, `transitTo`, `transitProgress`).
- `src/audio/worldMusic.ts` : platines par univers, fondus de 4 s sur l'horloge Web Audio, fonds procéduraux ; mêmes buffers que `Music`.
- `src/ambience/*`, `src/render/ambience/WorldDecor.ts`, `src/render/ArenaRenderer.ts`, `src/config/orbit.ts` : décor, mécaniques visibles,
  transitions, orbite par univers et calques de diagnostic.
- `src/dev/devTools.ts` : section « Voyage des univers ».
- `scripts/worlds-sim.ts` : outil d'équilibrage (`npx tsx scripts/worlds-sim.ts [minutes] [parties]`).
- `tests/worlds.test.ts` : 35 tests.

## Outils DEV (fenêtre « DEV », mode développeur actif)

- **Lancer le voyage** : interrupteur Pouvoirs, vaisseau mortel par défaut. L'immortalité reste disponible dans la fenêtre.
- **Aller à un univers** (1 à 4), **Avant la transition** (saut à 3 s de la faille), **Transition maintenant**.
- **Contrôle** : calques de diagnostic (anneau des facteurs de vitesse, hitboxes, trajectoire prévue sur 2 s).
- **Diagnostic** : univers en cours, phase de transition, platines audio actives, particules et FPS.

## Ajouter un univers

1. Ajouter une entrée à `WORLD_LIST` (`config/worlds.ts`) : identité, palette, vitesse, paliers, motifs, mécanique, transition d'entrée.
2. Ajouter ses motifs à la **fin** de `PATTERNS` (`sim/patterns.ts`). Toute nouvelle menace doit passer par le validateur d'évitement.
3. Pour une nouvelle mécanique : un nouveau `FieldKind` et son calcul dans `WorldsField.factor`. Il doit être progressif, borné par
   `CURRENTS.clamp`, et rester une fonction pure de la graine et du temps.
4. Décor : `WorldDecor` (calque du monde) et `ArenaRenderer.hazardLook` (apparence des dangers).
5. Musique : entrée `WORLD_MUSIC` (voir ci-dessous).
6. Tests : frontières, transition, champ, validateur, bot sur l'univers.

## Intégrer une musique pour l'univers 3 ou 4

1. Déposer le MP3 dans `src/assets/audio/`.
2. L'analyser (`scripts/analyze-phase2.py` comme modèle) pour obtenir un JSON de battements et de moments forts.
3. Renseigner `WORLD_MUSIC[n].track` et brancher le buffer dans `WorldMusic.play`. Ajouter ses battements à `WORLDS_RHYTHM` (et `beatChance` > 0
   dans l'univers). La grille du gameplay reste calculée hors ligne : le gameplay ne lit jamais l'audio.

## Conséquences pour le service (AUCUNE action réalisée)

- Le service ne rejoue pas encore ce mode. Avant toute activation classée :
  1. `server/verify.ts` doit accepter un marqueur de mode « univers » dans le rejeu et utiliser `worldsProfile`.
  2. Passer à `WORLDS_BALANCE_VERSION` (5), sans remise à zéro des classements v4 archivés.
  3. Déployer le service **avant** le jeu, avec accord explicite.
- Les primes proposées (`WORLD_BONUS_PROPOSAL` : 60 / 90 / 120 Éclats) ne sont **pas** versées. Elles sont à valider, puis à créditer par le
  service seulement.
- Rien n'a été déployé, redémarré ni migré. Aucun classement ni aucune donnée OVH n'ont été touchés.

## Mesures (bot, ordinateur de développement)

- Bot sur 9 minutes, trois graines : aucune mort, les 4 univers franchis.
  - Vagues par univers : environ 38 / 45 / 38 / 62 (sur 180 s pour le dernier univers).
  - Environ 11 ms de calcul par seconde simulée, bot compris.
- Coût d'un pas de simulation (trois graines, 480 s, vaisseau immortel, sans bot) :

  | Mode | Moyenne | p99,9 | Maximum |
  |------|---------|-------|---------|
  | Officiel | 4 – 8 µs | ≤ 2,7 ms | 23 ms |
  | Univers 1 | 9 µs | 2,5 ms | 17 ms |
  | Univers 2 | 9 µs | 2,5 ms | 8 ms |
  | Univers 3 | 40 µs | 14,5 ms | 38 ms |
  | Univers 4 | 18 µs | 5,6 ms | 31 ms |

  L'univers 3 est le plus coûteux : trajectoires courbes et lentes, plus plusieurs tentatives de vague validées. Il faut **le mesurer sur
  téléphone** (`npm run perf`) avant toute activation, et l'optimiser si des saccades apparaissent (par exemple en filtrant les projectiles
  par fenêtre de contact avec l'orbite).

## Limites connues

- L'équilibrage est provisoire et validé par bot seulement : à tester par des joueurs humains (ressenti des nuages, des hémisphères et des
  inversions).
- Univers 3 et 4 sans musique : fond procédural seulement, aucune réaction rythmique (voulu).
- Les captures sont générées en navigateur sans GPU (fps réduits). Le rendu final est à vérifier sur un vrai téléphone.

## Prévisualisation sur téléphone (hors site officiel)

- `npm run build:preview` construit `dist-preview/` (mode « preview » de `vite.config.ts`). L'adresse du service y est **forcée à vide**, même si
  `VITE_LEADERBOARD_URL` est défini. Conséquences : aucun classement, aucun compte, aucune récompense du service, aucun score envoyé. Le contrôle des
  secrets (`check:bundle`) est lancé automatiquement.
- Chemins relatifs : le dossier fonctionne sous n'importe quelle URL HTTPS.
- Hébergement actuel : page Claude privée « Polar Rift Univers ». Elle est ouverte depuis le compte Claude du propriétaire ; sa sauvegarde locale
  est séparée de celle du jeu officiel.
- Pour jouer au voyage : Options → mode développeur (mot de passe habituel) → fenêtre DEV → « Voyage des univers ».
- Le site GitHub Pages ne se publie que depuis `main` (`.github/workflows/pages.yml`) : pousser cette branche ne change rien au jeu officiel.
