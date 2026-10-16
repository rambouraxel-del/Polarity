# Survie à phases : phase 1, faille, phase 2

Mode **Survie** uniquement (le défi quotidien garde ses règles : `survivalProfile(shards, phased = false)`). Tous les réglages : `src/config/phases.ts`, `src/config/survival.ts` (`stages`, `beat`, `phase2`), `src/config/hazards.ts` (menaces de la phase 2), `src/config/ambience.ts` (`core`, `phase2`, `script`, `calm`). `BALANCE_VERSION` = **4**.

## Déroulement
| Temps de survie ACTIVE | Contenu |
|---|---|
| 0 – 300 s | **Phase 1** : décor spatial et orbite inchangés, difficulté **par paliers** (accueil accessible, premier palier à 12 s) + vague de tension ; calme avant chaque palier ; respirations. Noyau (petite sphère) au centre dès le départ. |
| 270 – 300 s | Le noyau devient progressivement une faille (annonce **uniquement visuelle et musicale**, aucun texte, aucun compte à rebours). Plus de vague dans les 2,5 dernières secondes. |
| 300 s exactement | **Traversée de 6 s** : l'arène est aspirée. Commandes, dangers, collisions, chronomètre, score, compteurs et bonus sont **suspendus** (la session n'avance pas la simulation ; rien n'est gagné ni consommé). Pause et retour d'arrière-plan : le décompte s'arrête et reprend. |
| ≥ 300 s | **Phase 2 infinie** : univers sombre, fracturé, électrique ; nouvelles menaces ; mêmes commandes, orbite toujours circulaire. La phase 3 viendra plus tard. |

## Simulation (reproductible, rejouée par le service)
- La traversée n'est **pas** dans la simulation : `GameSession` gèle l'horloge (`transitLeft`). Le temps de survie, la durée classée et le journal des entrées (en pas de simulation) n'en contiennent donc jamais les 6 s : `server/verify.ts` rejoue la même simulation sans rien savoir de la traversée.
- Au pas 36 000 (300 s), `Simulation.enterPhase2()` efface toutes les menaces (rien ne peut toucher le vaisseau au retour), redémarre le directeur (première vague 2,4 s plus tard, calendrier d'événements de la phase 1 arrêté) et émet l'événement `phase`. Score, combo, balises, bonus, vitesse et vies sont conservés ; aucune recharge de bonus.
- Mise en rythme : une part des vagues est **décalée** (jamais avancée) pour que leur premier contact avec l'orbite tombe sur un moment fort (drop) puis un battement de la **grille de rythme** (`nextBeat`, `nextAccent`), calculée à partir des analyses hors ligne (`src/data/*.json`) — jamais de l'audio en direct : volume coupé, mêmes instants. Tirage par un générateur dédié (`rhythmRng`). Motifs `beatShots` (tirs sur battements consécutifs) et `altBeams` (faisceaux alternés sur les battements).
- Phase 1 : le second tour de musique entre dans la boucle à `PHASE1_PLAN.secondPassFrom`, de sorte que la montée finale de la boucle tombe sur 300 s.

## Menaces de la phase 2 (introduites une à une, puis combinées)
Grands arcs (`arcShot`) · spirales (`spiral`, 1–3 bras) · faisceaux rotatifs (`rotBeam`) · faisceaux balayeurs (`sweepBeam`) · faisceaux alternés (`altBeams`) · puis combinaisons et variantes transformées des obstacles existants (`arcConvoy`, `arcSector`, `spiralArc`, `beamShot`). Les projectiles courbes sont des `ProjectileHazard` avec `path` (arc / spirale) : mêmes collisions continues, même validateur d'évitement, même Gel. Préavis tracés en entier (courbe pointillée, chevrons, repères d'orbite avec anneau qui se resserre). Chaque vague passe par le validateur d'évitement ; plafonds propres à la phase 2 (`PHASE2_CAPS`). Difficulté : reprise au dernier palier, hausse lente bornée par `dMax` (0,93) — aucune configuration impossible, aucune hausse brutale.

## Musique de la phase 2 (MP3 joint, `src/assets/audio/polar-rift-phase2.mp3`)
Analyse hors ligne `python3 -I scripts/analyze-phase2.py` → `src/data/polar-rift-phase2.json` (fichier non réencodé) : **134,04 pulsations/min** (période 0,44764 s, phase stable à 12 ms près sur tout le morceau ; le pic d'autocorrélation à 0,67 s est une syncope ternaire, pas la pulsation), contenu jusqu'à 296,9 s (≈ 2,3 s de silence final), extinction dès 294,3 s. **Boucle** : `loopStart` 129,35 s → `loopEnd` 294,08 s (368 temps = 23 phrases, ressemblance spectrale 0,996) ; le fondu enchaîné de 2 s superpose la fin de la boucle et le passage qui précède `loopStart`, **en phase de battement** et à puissance constante ; le silence final n'est jamais lu. Le morceau entre en fondu pendant toute la traversée (la phase 1 sort en 3,5 s) ; il est décodé tardivement (200 s de survie, budget mémoire ≈ 115 Mo une fois décodé, conservé ensuite). `Music.maintain()` programme les passes suivantes sur l'horloge audio (aucun minuteur). Une boucle ne réinitialise ni la phase, ni la difficulté, ni les récompenses (rien de ce que lit le gameplay ne dépend de l'audio).

## Récompenses
- **Prime d'Éclats par nouvelle phase** : `PHASE_BONUS` = **150 Éclats** à l'entrée en phase 2 (≈ deux fois les Éclats d'orbite collectés pendant les 5 premières minutes, soit trois Boost), 300 prévus pour la phase 3. Une seule fois par partie et par phase (`save.economy.phaseClaims`, clé « identifiant de partie:phase »), première vie d'une partie non assistée seulement ; gain répétable envoyé au service par le compteur monotone existant (seau à jetons) : aucun double versement lors des reprises ou des synchronisations.
- **Apparence exclusive « Faille »** (`PHASE_REWARD_SKIN`) : débloquée à la première traversée réussie du profil, une seule fois (`save.owned`), jamais achetable (`acquire: { type: 'reward' }`, état « À débloquer en jouant »).

## Ambiance (décorative)
Noyau → faille, fissures, ondes et arcs sur les battements (moments forts préparés `AMBIENCE.script` + analyse musicale), passages calmes qui calment l'ambiance, légères impulsions de caméra (jamais lues par la simulation), traversée (zoom arrière + rotation + voile blanc, effets réduits : voile seul), apparence de la phase 2 fondue sous le flash. Les menaces, le vaisseau et les objets restent au-dessus et lisibles.

## Déploiement
Le service doit être mis à jour **avant** le jeu (`BALANCE_VERSION` 4 : un jeu v4 face à un service v3 verrait ses parties refusées `unsupported_balance`). Aucun changement de schéma SQLite. Un rejeu de partie longue coûte davantage de calcul (validateur d'évitement sur toute la durée) ; `MAX_REPLAYS_PER_MINUTE` borne déjà la charge.
