# Voyage à travers les univers (refonte de la Survie, en validation)

Branche : `feat/survie-univers` (jamais fusionnée dans `main` sans validation du propriétaire).
État : **mode de test isolé**. Il se lance seulement depuis la fenêtre DEV (mode développeur actif). Toute partie du voyage est une
**partie de test** : aucun record, aucun gain, aucun succès, aucun ticket ni envoi au service. La Survie officielle (`BALANCE_VERSION` 4),
le défi quotidien, les défis classiques et la campagne ne changent pas.

## Les quatre univers

| # | Univers | Temps actif | Mécanique | Menaces propres | Musique |
|---|---------|-------------|-----------|-----------------|---------|
| 1 | Orbite originelle | 0 – 120 s | aucune | motifs historiques, événements (pluie, tempête) | morceau de la phase 1 monté sur 120 s |
| 2 | La Faille | 120 – 240 s | aucune | **cinq attaques** : fissure d'orbite, arc rampant, orbe de faille, onde de rupture, spirale fracturée | « Portal Surge » monté sur 120 s (voir ci-dessous) |
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
- `src/config/worldMusic.ts` : musique par univers, montage de l'univers 1, transition audio, grille de rythme `WORLDS_RHYTHM` (déterministe), garde de synchronisation.
- `src/config/world2.ts` : **La Faille** — feuille de route musicale (repères en temps local), poids des attaques selon la structure du morceau, réglages des cinq attaques.
- `src/data/polar-rift-world2.json` : carte musicale de « Portal Surge » (générée par `scripts/analyze-world2.py`).
- `src/modes/worlds.ts` : profil de difficulté isolé (`worldsProfile`) ; `src/modes/run.ts` : `RunConfig.worlds` (Survie seulement).
- `src/sim/field.ts` : champs de vitesse (`WorldsField`), fonctions pures de la graine et du temps.
- `src/sim/simulation.ts` : `world`, `field` et `enterWorld`. Sans champ, le calcul est strictement l'ancien.
- `src/sim/safety.ts` : validateur à vitesse variable (`hasEscapePathField`). Sans champ, l'algorithme historique est inchangé.
- `src/sim/hazards.ts`, `src/sim/collision.ts` : trajectoire `wave` et secteurs mouvants (`morph`, balayage relatif).
- `src/sim/patterns.ts` : motifs des univers 2 à 4, ajoutés à la fin (l'ordre historique est conservé) ; `PatternDef.timed` : le motif cale lui-même son instant sur la carte musicale.
- `src/game/session.ts` : transition générique (`transitTotal`, `transitTo`, `transitProgress`).
- `src/audio/worldMusic.ts` : platines par univers, montage de La Faille (`playMontage`), fondus de 4 s sur l'horloge Web Audio, fonds procéduraux ; mêmes buffers que `Music`. `src/audio/syncGuard.ts` : garde jeu/musique.
- `src/ambience/*`, `src/render/ambience/WorldDecor.ts`, `src/render/ArenaRenderer.ts`, `src/config/orbit.ts` : décor, mécaniques visibles,
  transitions, orbite par univers et calques de diagnostic.
- `src/dev/devTools.ts` : section « Voyage des univers ».
- `scripts/worlds-sim.ts` : outil d'équilibrage (`npx tsx scripts/worlds-sim.ts [minutes] [parties]`).
- `scripts/analyze-world2.py` (analyse), `scripts/check-world2.py` (contrôle indépendant du montage rendu), `scripts/world2-timeline.ts` (chronologie des attaques et calage), `scripts/perf-worlds.mjs` (`npm run perf:worlds`), `scripts/e2e-world2.mjs` (contrôle navigateur avec la vraie musique).
- `tests/worlds.test.ts` (35 tests), `tests/world2.test.ts` (40 tests : carte, montage, grille, attaques, synchro, décor, garde).

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


## La Faille (univers 2) : musique, décor et attaques liés

Principe : **la musique influence le calendrier et la mise en scène, jamais la validité d'une partie**. Le gameplay ne lit que des tableaux préparés à l'avance
(`polar-rift-world2.json` via `config/world2.ts`), identiques pour le joueur et pour un service qui rejouerait la partie ; coupée, en sourdine, en pause ou
non décodée, la musique ne change rien aux collisions.

### Le morceau et son montage

« Portal Surge » (MP3 fourni, 118,8 s, ≈ 140 pulsations/min, jamais réencodé). L'analyse hors ligne (`python3 -I scripts/analyze-world2.py`) produit :
battements (277 dans le fichier, 289 dans le montage, chacun sur une attaque réelle), 495 percussions (518 dans le montage : caisses, charleston, claquements), 16 impacts avec leur force, 5 montées, 6 passages calmes,
enveloppes de basses et d'intensité à 30 images/s.

Structure réelle (temps du montage) : introduction presque silencieuse (0–3 s) puis rythmique clairsemée jusqu'à 14 s ; rupture à 14–17 s ; groove calme
jusqu'à 34 s ; montée 33–35 s puis 38–41 s ; **premier grand drop à 38,6 s** ; plateau 40–73 s ; **rupture à 74–76 s** ; second plateau plus dense jusqu'à 108 s ;
**montée finale 115–120 s** et dernier coup sec à 121,8 s, suivi d'une queue de réverbération.

Montage sur les 120 s de jeu actif : le morceau dure moins que l'univers (transition d'entrée comprise). Une **phrase de 3 mesures (12 battements, 5,14 s)** est
répétée : le lecteur saute du battement 85,41 s au battement 80,27 s du fichier (raccord choisi pour que ce qui précède et ce qui suit se ressemblent le plus :
distance spectrale 0,017 avant et 0,009 après), avec un fondu de 80 ms terminé avant l'attaque du battement de raccord. Le dernier coup sec tombe **exactement
sur l'ouverture de la faille de sortie** (fin des 120 s) ; la musique démarre 1,8 s avant l'émergence, pendant la transition d'entrée.

### Contrôles de synchronisation

- Carte vs attaques réelles du fichier : écart médian +0,4 ms ; 96 % des battements forts à ± 25 ms (`analyze-world2.py`).
- Carte vs **montage rendu** comme le lecteur le programme (`check-world2.py`) : battements forts +0,1 ms médian, 96 % à ± 25 ms ; **autour du raccord** : écart
  maximal 48 ms ; 16 impacts +0,7 ms médian ; coup sec final à 121,81 s (énergie ÷ 3) ; aucun trou ; saut d'énergie au raccord (0,086) inférieur à celui d'une
  fenêtre ordinaire du morceau (médiane 0,095).
- Lecture à 60 images/s de toute la carte (`tests/world2.test.ts`) : chaque battement, percussion et impact est franchi **une seule fois**, **jamais en avance** et au
  plus **une image après** l'instant entendu ; pause, reprise et saut de position ne rattrapent aucun repère (pas de rafale).
- Sur un appareil très lent, le jeu peut prendre du retard sur la musique (l'horloge de jeu avance de l'image réelle, plafonnée à 0,1 s). `MusicSyncGuard` recale
  alors la **musique** sur le temps de jeu (écart > 100 ms pendant 1,2 s, au plus une fois toutes les 6 s). L'écart jeu/son est affiché dans la fenêtre DEV.

### Cinq attaques, pas une de plus

| Attaque | Identifiant | Comportement | Calage musical |
|---------|-------------|--------------|----------------|
| Fissure d'orbite | `orbitCrack` | portion d'orbite dangereuse 4 à 8 s ; s'ouvre progressivement pendant l'annonce (2,4–3,2 s) | ouverture terminée sur un battement ; **s'élargit pendant une montée** |
| Arc rampant | `surgeArc` | décharge qui glisse lentement le long de l'orbite (0,14–0,26 rad/s) | activation sur une percussion (attente ≤ 0,45 s, annonce jamais raccourcie) ; bande qui pulse sur les percussions |
| Orbe de faille | `riftOrb` | sphère d'énergie sur une trajectoire courbe annoncée | première traversée calée sur certains battements (65 %) |
| Onde de rupture | `riftWave` | la faille centrale se charge (2–5,2 s), puis une onde s'élargit sur un secteur (1,2 s) | **déclenchée exactement sur un grand impact** (force ≥ 0,5) ; jamais sans impact proche |
| Spirale fracturée | `fractureSpiral` | 1 à 2 bras de fragments en spirale | seulement quand le morceau est intense (> 0,3) |

Deux combinaisons modérées n'assemblent que ces familles, en fin d'univers : `crackOrb` (fissure + orbe) et `waveSpiral` (onde + spirale). Les anciens motifs de
l'univers (faisceaux, orbes jumelles, arc + orbe) sont retirés. Aucune attaque ne touche l'orbite pendant un passage calme du morceau (marge de 3,6 s) ; chaque
danger est annoncé au moins 0,55 s à l'avance et validé par le validateur d'évitement ; densité mesurée : environ 30 attaques en 120 s (robot, 5 graines), jamais plus de 8 menaces actives.

Progression (poids dans `world2Weights`, calés sur la structure du morceau) : 0–30 s orbes puis premières fissures ; 24 s arcs rampants ; ondes dès 30 s sur les grands
impacts (dont le premier drop à 36,8 s de jeu) ; spirales dès 48 s quand l'intensité le permet ; combinaisons dès 88 s ; point culminant sur la montée finale.

### Décor réactif (décoratif seulement)

- **Basses** : la déchirure centrale pulse (gain `AMBIENCE.world2.hole.pulse`) et le noyau vibre ; lueurs plus vives.
- **Percussions** : impulsion proportionnelle à la force (décroissance 0,09 s) ; éclairs ramifiés seulement sur les percussions franches (≥ 0,6), fragments plus lumineux.
- **Montées** : instabilité croissante (contour de la faille plus déchiré, pointes plus longues, fissures qui s'étendent, particules et tunnel plus vifs).
- **Impacts** : décharge (onde, éclairs, fissures du bord) **proportionnelle à la force de l'impact**.
- **Passages calmes** (carte, pas une estimation) : tout ralentit (particules, tunnel, rubans), éclairs rares.
- **Direction artistique** : violet profond / magenta électrique / bleu lumineux ; déchirure centrale permanente au cœur sombre ; orbite partiellement corrompue (tronçons qui se
  dédoublent et crépitent) ; fragments facettés ; éclairs et rubans. Danger toujours corail/magenta, jamais confondu avec le décor.
- **Sortie** : après le dernier coup, la faille se **stabilise** (éclairs et pulsations s'éteignent), l'énergie violette cède la place à la brume turquoise de la Mer nébulaire.
- Sans musique audible (sourdine, volume nul, pause, fichier non décodé) : **aucune réaction** (jamais de fausse pulsation) ; effets réduits et intensité visuelle respectés.

### Remplacer ou régler la musique de l'univers 2

1. Remplacer `src/assets/audio/polar-rift-world2.mp3`.
2. `python3 -I scripts/analyze-world2.py` (régénère la carte et choisit un nouveau raccord), puis `python3 -I scripts/check-world2.py` (doit afficher OK).
3. Ajuster si besoin `config/world2.ts` (`W2_ATTACKS`, `world2Weights`) et `AMBIENCE.world2`, relancer `npx tsx scripts/world2-timeline.ts <graine>` pour contrôler le calage des attaques.

### Mesures et limites (La Faille)

- Coût de simulation (pas de 1/120 s) : moyenne 7 µs, p99,9 2,2 ms, maximum 12,5 ms (la Survie officielle monte à 23 ms au pire).
- Coût JS d'une image en émulation mobile (processeur ×4, `npm run perf:worlds`) : 5 à 13 ms en moyenne, du même ordre que les univers 1 et 3 ; le coût GPU d'un
  téléphone n'est pas mesurable sans appareil.
- Mémoire : le morceau décodé pèse ≈ 46 Mo ; la musique de la phase 2 (295 s) n'est plus chargée dans le voyage.
- **À valider sur un vrai téléphone** : ressenti des attaques, lisibilité du décor, calage perçu (latence de sortie variable selon l'appareil).
