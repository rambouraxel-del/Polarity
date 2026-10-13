# Ambiance évolutive de la Survie

L'univers de la Survie (et du défi quotidien, qui suit ses règles) se transforme à mesure que le joueur survit : une faille cosmique
se réveille derrière l'orbite, l'espace se charge de poussières, d'anneaux et d'arcs d'énergie, et tout réagit à la musique.
**Purement décoratif** : simulation, collisions, vitesse, difficulté, hitbox, scores, monnaies et classement sont inchangés
(`src/sim/` non modifié, `BALANCE_VERSION` inchangée). Jamais appliqué à la Campagne ni aux Défis classiques (décor fixe d'origine).

## Les cinq stades (temps de survie actif, la pause l'arrête)
| Stade | Début | Ce qui change |
|---|---|---|
| 1 · Vide stellaire | 0 s | Ciel profond, étoiles en parallaxe (3 profondeurs), poussières rares, faille = trait à peine perceptible, pulsations très légères |
| 2 · Activation | 60 s | Poussières cosmiques, premières lueurs cyan et violettes, la faille s'entrouvre, pulsations sur les battements, quelques arcs |
| 3 · Rupture | 120 s | Faille nettement ouverte, anneaux d'énergie sur les battements forts, particules plus présentes, ciel plus rapide |
| 4 · Surcharge | 180 s | Faille très active, quadrillage déformé par la gravité, arcs plus fréquents, débris décoratifs à plusieurs profondeurs |
| 5 · Apogée | 240 s | Tout au maximum (plafonné), couleurs chaudes violet/magenta ; au-delà, variations lentes (périodes 47, 71, 113 s) pour ne jamais figer |

Chaque seuil est franchi en **10 s** (courbe douce) : tous les paramètres sont interpolés, rien n'apparaît d'un coup
(les densités de particules et de débris montent par fondu individuel).

Aperçu sans jouer 4 minutes : ajouter `?stade=3` (1 à 5) à l'adresse du jeu. Seule l'ambiance est décalée, la partie est normale.

## Synchronisation musicale (méthode utilisée)
**Timeline musicale à la position de lecture réelle + carte des morceaux calculée hors ligne.**

1. `scripts/analyze-music.py` (`npm run music-map`, ffmpeg + numpy) décode les trois MP3 **sans les modifier** et produit
   `src/data/polar-rift-music-map.json` (29 Ko) :
   - **battements** : enveloppe d'attaques (flux spectral, basses renforcées) ; période **mesurée** par autocorrélation
     (0,4203 s ≈ 142,8 pulsations/min — aucun BPM supposé) ; placement par programmation dynamique sur les attaques réelles ;
     chaque battement a une **force** mesurée (un passage sans pulsation donne des battements faibles, ignorés) ;
   - **basses** (30–150 Hz) et **intensité** (énergie lissée ~2 s), 30 valeurs/s ;
   - **passages forts** (« drops ») : sauts d'énergie et de basses — boucle : 65,6 s, 108,9 s, 136,1 s ;
   - **montées** : intervalles où l'intensité croît nettement.
   La boucle est analysée dans son contexte circulaire (intro + boucle + boucle), avec exactement la région `loopStart`/`loopEnd`.
2. `Music.position()` (`src/audio/music.ts`) donne la position **entendue** : horodatage de sortie du contexte audio
   (`getOutputTimestamp`) ou horloge audio moins la latence annoncée. Intro, puis boucle (modulo la région en boucle), puis outro.
   Recalculée à chaque image depuis l'horloge audio : **aucun décalage cumulatif**, quel que soit le nombre de tours.
3. `MusicSync` (`src/ambience/musicSync.ts`) lit la carte à cette position : un battement « arrive » quand la position le franchit.
   Pause = position figée (rien ne réagit) ; reprise, saut ou changement de morceau = pas de rafale de battements manqués ;
   tour de boucle = fin puis début de la région. Sans musique (pas encore décodée, pas de contexte), **rien ne pulse** :
   on ne simule jamais une fausse synchronisation.
4. `AmbienceDirector` (`src/ambience/director.ts`) transforme cela en impulsions : battement (pic puis décroissance 0,16 s),
   basses (attaque 40 ms, relâchement 220 ms), intensité, montée, passage fort (1,4 s), demandes d'anneau/onde/arc.

Réactions : battement → pulsation de la faille, halos légèrement agrandis, étoiles et poussières plus lumineuses, quadrillage plus net,
anneau d'énergie occasionnel ; basses → luminosité des halos, des nébuleuses et de la faille, légère ondulation du quadrillage ;
montée → couleurs plus chaudes, particules plus nombreuses et plus rapides, faille plus active ; passage fort → onde qui traverse le
fond et bombe le quadrillage, dilatation de la faille, arcs supplémentaires. Pas d'analyse audio en temps réel : rien de lourd par image,
et fonctionnement identique sur Safari iPhone (pas d'`AnalyserNode`, pas de second chemin audio, volume et qualité inchangés).

Si la musique change un jour : remplacer les MP3 et leurs repères, puis relancer `npm run music-map`.

## Architecture
| Fichier | Rôle |
|---|---|
| `src/config/ambience.ts` | **Source unique** : stades, paramètres par stade, couleurs, durées, seuils musicaux, plafonds de lisibilité, effets réduits, niveaux de qualité |
| `src/ambience/musicSync.ts` | Lecture de la carte musicale à la position entendue |
| `src/ambience/director.ts` | Progression des stades, réactions musicales, qualité adaptative (`QualityGovernor`) — logique pure, testée |
| `src/render/ambience/AmbienceRenderer.ts` | Assemble les calques (tous derrière l'orbite, les menaces et le vaisseau) |
| `src/render/ambience/StarField.ts` · `Rift.ts` · `Particles.ts` · `Effects.ts` · `textures.ts` | Parallaxe · faille et nébuleuses · poussières et débris · anneaux, ondes, arcs, quadrillage · textures générées par code |
| `src/render/ArenaRenderer.ts` · `src/app.ts` | Branchement (Survie et défi seulement) |
| `scripts/analyze-music.py` → `src/data/polar-rift-music-map.json` | Carte musicale |
| `tests/ambience.test.ts` | Stades, transitions, pause, plafonds, carte, synchronisation, position de lecture |

Ordre des calques : nébuleuses → étoiles → faille → débris → poussières → anneaux/ondes/arcs → **voile sombre de la zone de jeu**
→ quadrillage → orbite, menaces, vaisseau (inchangés).

## Lisibilité et confort
- Tout est derrière le jeu ; un **voile sombre** (couleur du fond, rayon 410) protège la zone de jeu et s'épaissit avec l'ambiance.
- Couleurs de l'ambiance (cyan, violet, magenta doux, glace) distinctes des menaces : jamais l'orange des astéroïdes, jamais
  l'éclair magenta et blanc des secteurs électriques sur l'orbite. Arcs décoratifs toujours **hors** de la zone de jeu ;
  débris petits, sombres, sans lueur, hors de la zone de jeu.
- Aucun flash blanc plein écran, aucun tremblement de caméra, aucune déformation du jeu lui-même (seul le quadrillage du fond ondule).
- Plafonds absolus (`AMBIENCE.caps`) quelle que soit la musique : opacités, dilatation de la faille, pulsation, déformation.
- **Effets réduits** (option du jeu ou préférence système « réduire les animations ») : mêmes stades, réactions à 25 %,
  mouvements à 30 %, ni onde, ni arc, ni déformation.

## Performances
- Pools fixes (tableaux typés pour étoiles et poussières, images pour les débris, anneaux et arcs pré-alloués) : aucune allocation
  dans la boucle de rendu, aucun calcul audio par image (une recherche binaire dans la carte).
- Textures générées une fois ; pas de shader de post-traitement.
- **Qualité adaptative** : 3 niveaux (étoiles 220/150/90, poussières 150/90/45, débris 12/8/4, anneaux 6/4/2, arcs 3/2/1,
  segments du quadrillage 96/64/40). Descente si les images dépassent ~22 ms pendant 3 s ; remontée après 20 s fluides.
  Départ en qualité moyenne sur les appareils à 4 cœurs ou moins.
- Pause : tout est figé ; arrière-plan : la partie se met en pause (comportement existant).

## Limites connues
- Vérifié par compilation, tests unitaires et build ; **aucun test navigateur ni session de jeu automatisée** n'a été lancé :
  le rendu réel (lisibilité, intensité, fluidité sur iPhone et Android) reste à valider à l'œil. Réglages : `src/config/ambience.ts`.
- La position entendue dépend de la latence annoncée par le navigateur ; sur certains casques Bluetooth la latence réelle est plus
  grande que l'annoncée (décalage visible possible, corrigeable par `AMBIENCE.music.lead`).
- Le début de l'intro est peu rythmé : peu de battements y dépassent le seuil (voulu, pas de fausse pulsation).
