# Ambiance évolutive de la Survie

L'univers de la Survie (et du défi quotidien, qui suit ses règles) se transforme à mesure que le joueur survit : une faille cosmique
se réveille derrière l'orbite, l'espace se charge de poussières, d'anneaux et d'arcs d'énergie, et tout réagit à la musique.
**Purement décoratif** : simulation, collisions, vitesse, difficulté, hitbox, scores, monnaies et classement sont inchangés
(`src/sim/` non modifié, `BALANCE_VERSION` inchangée). Jamais appliqué à la Campagne ni aux Défis classiques (décor fixe d'origine).

## Phases (noyau, faille, phase 2)
Le noyau central, les fissures, la traversée et l'apparence de la phase 2 sont décrits dans `docs/PHASES.md` (`render/ambience/Hole.ts` et `Tunnel.ts`, `AmbienceDirector` : `core`, `look`, `calm`, moments forts préparés `AMBIENCE.script`). Les passages calmes de la musique calment aussi l'ambiance.

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
     **calage** : le flux spectral (fenêtres de 46 ms) détectait les attaques ~9 ms trop tôt ; le script mesure l'écart médian avec la
     montée réelle de l'enveloppe large bande (échantillon par échantillon) et corrige la carte de cette valeur (+9,1 ms, auto-calibrée).
     Contrôle sur l'audio : écart médian résiduel 0,2 ms (boucle), 1,6 ms (outro), 3,3 ms (intro, peu rythmée) ; la grille de
     battements est continue au raccord intro → boucle et au tour de boucle (écart 0,43 s pour une période de 0,42 s) ;
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
4. `AmbienceDirector` (`src/ambience/director.ts`) transforme cela en impulsions : battement (attaque immédiate, courbe 0,65, décroissance 0,1 s),
   basses (attaque 40 ms, relâchement 220 ms), intensité, montée, passage fort (1,4 s), demandes d'anneau/onde/arc.

**Quand rien ne doit pulser** (`MusicSync.update(position, audible)`) : musique non décodée ou absente, **sourdine**, volume général ou
musique à 0, **pause**, compte à rebours de reprise, contexte audio suspendu ou « interrupted » (arrière-plan, appel sur iPhone) →
image musicale inactive : aucun battement, aucune montée ; les valeurs retombent en quelques dixièmes de seconde. Au retour du son,
aucun battement manqué n'est rejoué (la synchronisation repart de la position entendue).

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
| `src/render/ambience/StarField.ts` · `Rift.ts` · `Particles.ts` · `Effects.ts` · `textures.ts` | Parallaxe · nébuleuses · poussières/étincelles et débris · anneaux, ondes, quadrillage · textures générées par code |
| `src/render/ambience/Hole.ts` · `Tunnel.ts` · `Ribbons.ts` · `Bolts.ts` · `Shards.ts` | Faille en formation (phase 1) · tunnel de facettes (phase 2) · rubans d'énergie · éclairs ramifiés · fragments aspirés ou entraînés |
| `src/render/ArenaRenderer.ts` · `src/app.ts` | Branchement (Survie et défi seulement) |
| `scripts/analyze-music.py` → `src/data/polar-rift-music-map.json` | Carte musicale |
| `tests/ambience.test.ts` | Stades, transitions, pause, plafonds, carte, synchronisation, position de lecture |

Ordre des calques : nébuleuses → étoiles → tunnel → débris → rubans → poussières/étincelles → anneaux/ondes → vignette → **voile sombre de la zone de jeu**
→ fragments → faille (halo, cœur sombre, liseré, sphère) → éclairs → quadrillage → orbite, menaces, vaisseau (inchangés).

## Décor animé : faille, traversée, tunnel (tout est dessiné en code)
Références artistiques : « espace avec faille en formation » (phase 1) et « intérieur électrique de la faille » (phase 2). Aucune image n'est affichée :
les textures sont générées au lancement (canvas 2D, graine fixe) et animées par le moteur existant. Tous les réglages sont dans `config/ambience.ts`
(`hole`, `transit`, `tunnel`, `ribbons`, `bolts`, `shards`, `phase2.flow`, qualité).
- **Phase 1** : espace bleu nuit, étoiles discrètes, quelques courants d'énergie (rubans très faibles), petite sphère lumineuse au centre dès le départ.
  De 4 min 30 à 5 min (`PHASES.coreGrowFrom` → `phase2At`) elle s'ouvre en un **cœur sombre au contour irrégulier** (harmoniques qui tournent, sommets
  qui respirent, pointes cristallines) bordé d'un liseré bleu/violet dont l'éclat circule ; des filaments électriques jaillissent du bord (toujours à
  l'intérieur de l'orbite), des fragments sont aspirés en spirale de plus en plus vite. Elle pulse sur les battements et les basses.
- **Traversée (6 s existantes)** : le liseré traverse l'écran et la faille l'enveloppe (`transit.engulfBy`) ; étoiles, poussières, rubans et nébuleuses sont
  aspirés en spirale (traînées) ; le cœur sombre devient transparent à mesure que le **tunnel** apparaît dessous, sous le voile blanc existant. L'ambiance
  compense le zoom arrière de la caméra de jeu (`AmbienceRenderer.draw(…, zoom)`) : le décor reste plein écran pendant que l'arène est « avalée ».
- **Phase 2** : tunnel de **plans de facettes brisées** (faces sombres, bleu électrique ou violet, arêtes lumineuses) qui défilent vers la profondeur
  (échelle exponentielle, rotation propre à chaque plan, un sur deux en sens inverse), vignette sombre sur les bords, grands rubans d'énergie ondulants,
  éclairs ramifiés entre les structures (apparition rapide, tracé retiré plusieurs fois, extinction courte), fragments flottants et étincelles entraînées
  vers l'avant, anneaux et ondes sur la musique. La vitesse du défilement, l'éclat des plans, la largeur des rubans et la fréquence des éclairs suivent
  battements, basses, montées et passages forts (mêmes signaux `MusicFrame` que le reste de l'ambiance).
- **Lisibilité** : tout est derrière l'orbite, les menaces et le vaisseau ; voile allégé en phase 2 (`tunnel.veilAlpha`) mais jamais retiré ; fragments
  atténués près de l'orbite ; éclairs décoratifs bleu azur/glace (jamais le magenta-blanc des secteurs électriques, ni le corail/orange des dangers) et
  jamais sur le rail de l'orbite. Position de l'orbite, commandes et collisions inchangées.
- **Pause, reprise, redimensionnement** : le pas d'animation est nul en pause (tout se fige) ; `layout()` recalcule le repère à chaque redimensionnement.
  **Effets réduits** : mouvements à 30 %, ni éclair, ni onde. **Intensité visuelle** : `state.user` multiplie l'opacité de la faille, du tunnel, des
  rubans et des éclairs (0 % = ciel étoilé seul).
- **Mobile** : pools fixes (images, tableaux typés), quatre textures de 1 024² au plus, profondeurs des plans recalculées seulement quand un plan boucle,
  niveaux de qualité (`tunnel` 8/6/4 plans, `ribbons`, `bolts`, `shards`, `holePoints`) pilotés par `QualityGovernor`.

## Réglages du joueur (écran Options)
| Réglage | Effet |
|---|---|
| Son (interrupteur) | Sourdine de la musique **et** des effets ; coupe aussi les réactions musicales de l'ambiance |
| Volume général | Sortie unique (`Sfx`), courbe quadratique |
| Musique | Mixage de la musique (bus propre, courbe quadratique, 0–100 %) ; écoute d'essai de 2,5 s au relâchement du curseur |
| Effets sonores | Mixage des effets (bus propre `sfxBus`) |
| Intensité visuelle | 100 % = ambiance complète ; moins = faille, nébuleuses, particules, anneaux, ondes, arcs et réactions atténués proportionnellement ; 0 % = ciel étoilé seul. Les stades évoluent toujours |
| Effets réduits | Existant : réactions à 25 %, mouvements à 30 %, ni onde, ni arc, ni déformation ; suivi aussi de `prefers-reduced-motion` |

Préférences enregistrées dans `save.options` (`musicVolume`, `sfxVolume`, `visualIntensity` ; défauts 1 ; anciennes sauvegardes conservées).

## Lisibilité et confort
- Tout est derrière le jeu ; un **voile sombre** (couleur du fond, rayon 410, **entièrement opaque jusqu'à 80 % du rayon** soit au-delà de
  l'orbite et des marges des menaces, puis fondu) fait de la zone de jeu un disque sombre dont la faille, les anneaux et les arcs sont exclus ;
  son opacité (plafond 90 %) croît de 50 % à 100 % avec les stades. Constaté sur des captures de jeu réel (stade 5, secteur électrique,
  laser, projectiles annoncés) : balises, vaisseau, annonces, secteurs et lasers restent parfaitement lisibles.
- Traits de l'ambiance (anneaux, ondes, arcs) en azur et violet : le **magenta** est réservé aux secteurs électriques (danger) et à de
  très larges lueurs de nébuleuse ; la faille est azur → violet, distincte du cyan de l'orbite.
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
- Textures générées une fois ; pas de shader de post-traitement. Les plans du tunnel et les fragments ont
  une graine fixe (même aspect à chaque lancement) ; la faille de la phase 1 est un polygone redessiné à chaque image (56 points au plus).
- Coût mesuré (`scripts/perf.mjs`, émulation mobile ×4 ralentie, rendu logiciel, 10 s) : `app.frame` 2,6 ms (sans ambiance) → 3,5 ms
  (stade 1) → 3,9 ms (stade 5), soit ≈ +1,3 ms par image à ×4 de ralentissement. Le coût GPU réel (remplissage des lueurs additives) n'est
  **pas** mesurable sans téléphone : les niveaux de qualité réduisent le nombre de nébuleuses (3/2/1) en plus des particules.
- **Qualité adaptative** : 3 niveaux (étoiles 220/150/90, poussières 150/90/45, débris 12/8/4, anneaux 6/4/2, arcs 3/2/1,
  nébuleuses 3/2/1, segments du quadrillage 128/96/64). Descente si les images dépassent ~22 ms pendant 3 s ; remontée après 20 s fluides.
  Départ en qualité moyenne sur les appareils à 4 cœurs ou moins.
- Pause : tout est figé ; arrière-plan : la partie se met en pause (comportement existant).

## Limites connues
- Vérifié par compilation, tests unitaires, build, **captures ponctuelles de jeu réel** (Chromium sans GPU, 390×844 et 1280×720, stades 1 à 5,
  secteur, laser, options) et **une session de 35 s** mesurant dérive (rapport position musicale / horloge : 1,0000), pause (position figée,
  aucune réaction), compte à rebours et passage intro → boucle. Le rendu sur iPhone et Android (luminosité, fluidité, lisibilité, qualité
  sonore) reste à valider sur appareils : voir `docs/VERIFICATIONS_MOBILE.md`. Réglages : `src/config/ambience.ts`.
- La position entendue dépend de la latence annoncée par le navigateur ; sur certains casques Bluetooth la latence réelle est plus
  grande que l'annoncée (décalage visible possible, corrigeable par `AMBIENCE.music.lead`).
- Le début de l'intro est peu rythmé : peu de battements y dépassent le seuil (voulu, pas de fausse pulsation).
