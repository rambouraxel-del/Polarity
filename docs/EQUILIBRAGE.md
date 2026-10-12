# Équilibrage et règles de jeu

Tous les paramètres sont dans `src/config/` : `balance.ts` (globaux, plafonds), `survival.ts` (difficulté de la Survie), `playerSpeed.ts` (vitesse du vaisseau
et adaptation), `hazards.ts` (nouveaux dangers), `events.ts` (événements), `hitbox.ts`, `visuals.ts`, `levels.ts` (niveaux), `version.ts`.
Les valeurs sont des **points de départ** à confirmer par des essais humains.

## Simulation
- Pas fixe de 1/120 s, temps actif = nombre de pas × dt (aucune dérive). Une image de plus de 0,1 s est tronquée.
- Résultats identiques quelle que soit la fréquence d'affichage ; le rendu interpole seulement l'affichage.
- Aléatoire de gameplay : `Rng` à graine (mulberry32). Les effets décoratifs utilisent `Math.random` et ne décalent jamais les tirages.

## Joueur et hitboxes
- **Vitesse du vaisseau** (`src/config/playerSpeed.ts`) : la référence (facteur 1,0) est la vitesse d'avant la v1.2, 2,0 rad/s.
  En **Survie et au défi quotidien** : départ à **40 %** (0,8 rad/s), **+5 points de pourcentage de la référence toutes les 30 s** de jeu actif,
  plafonné à **100 %** (atteint à 6 min). Chaque hausse est lissée sur 2 s (smoothstep) et **se termine à l'instant du palier** :
  45 % à 30 s, 50 % à 1 min, 60 % à 2 min, 70 % à 3 min… 100 % à 6 min (le lissage de 28 s à 30 s fait que la valeur annoncée est atteinte à l'instant dit).
  Le facteur ne dépend que du temps actif : la pause le fige. L'inversion ne change que le sens (pas de délai, pas de saut de vitesse).
  **Niveaux** : chaque niveau a sa vitesse (`speed` dans `config/levels.ts`, 1,0 = référence pour les 12 niveaux actuels) et n'utilise pas cette courbe.
- **Hitboxes** (`src/config/hitbox.ts`, réglage indépendant des visuels et de la difficulté) : rayons d'origine 7 (vaisseau) et 8 (projectile)
  **+ 6,5 %** par défaut (plage prévue 5–8 %) → 7,46 et 8,52. Elles restent **en retrait des silhouettes** : avec les visuels actuels
  (vaisseau ×1,45, astéroïdes ×1,35 depuis la v1.1.x), le vaisseau fait ≈ 15,1 de demi-largeur et le plus petit astéroïde ≈ 12,2 de demi-dimension
  (tests : valable de +5 % à +8 %). Les hitboxes n'ont pas été modifiées par ce changement visuel, pour pouvoir l'évaluer séparément.
  Secteurs : 0,03 rad de tolérance à chaque bord. `setHitboxGrowth()` permet de tester une autre valeur (tests, outils).
- **Visuels** (`src/config/visuals.ts`) : +15 % par rapport à la v1.0, puis vaisseau ×1,45 et astéroïdes ×1,35. Les modifier ne change aucune collision.
- Collision continue : distance minimale exacte entre le mouvement du vaisseau et celui du projectile sur chaque pas ;
  balayage angulaire pour les secteurs. Testé avec un projectile à 20 000 unités/s, y compris hitbox +8 %.
- Point d'impact : à la mort, la simulation fournit le point de contact (frontière des deux hitboxes, ou position du vaisseau
  pour un secteur) ; le rendu y déclenche l'impact.

## Balises, score, combo
- 6 balises ; une balise traversée s'éteint jusqu'à la fin du cycle (pas de gain par oscillation). Détection par
  balayage d'arc : deux sens, passage de zéro, grands pas.
- 100 pts × multiplicateur par balise ; 500 pts × multiplicateur par cycle complet.
- Multiplicateur ×1 à ×5 : +1 palier toutes les 6 collectes espacées de moins de 1,6 s. Après 1,6 s sans collecte, le
  multiplicateur perd un palier, puis un autre chaque seconde. L'inversion n'a aucun effet sur le combo.

## Répit de cycle (Survie uniquement)
Un cycle complet retarde la prochaine vague de 0,8 s, au plus une fois toutes les 5 s, et au plus 1,2 s cumulées par
vague en attente. Rien n'est stocké si aucune vague n'est en attente. Les menaces présentes restent actives, le temps
et la difficulté continuent.

## Menaces : 14 motifs
| Famille | Motifs |
|---|---|
| Projectiles traversants | Tir, Tir diamétral, Doublé (parallèles), Croix, Rafale (3 tirs balayant) |
| Secteurs électriques | Arc électrique, Arcs jumeaux (opposés), Poursuite (deux arcs successifs) |
| Attaques combinées | Tir + arc, Tenaille (deux arcs + tir dans la poche), Écho (aller-retour sur la même ligne) |
| **Astéroïde fragmenté** (v1.2) | un astéroïde traverse l'orbite, se divise près du centre en deux fragments (70 % de la taille, hitbox à l'échelle) |
| **Convoi d'astéroïdes** (v1.2) | 2 ou 3 astéroïdes sur la même trajectoire, décalés dans le temps (même vitesse) |
| **Laser balayeur** (v1.2) | après l'annonce, un rayon part du centre et pivote sur un secteur limité |

**Astéroïde fragmenté** (`config/hazards.ts`, `FRAGMENT`) : trajectoire presque diamétrale (écart de 2,6 à 3,1 rad entre entrée et sortie), division au milieu
de la corde (≤ 80 unités du centre). Annonce complète dès le début : ligne pointillée de l'astéroïde, repère de division (étoile), et trajectoires pointillées
des deux fragments avec leurs croix de passage. **Délai de réaction** : un fragment ne peut pas atteindre l'orbite moins de 0,45 s après la division (sa vitesse est
réduite si besoin, minimum 140 u/s), en plus de toute l'annonce qui précède. L'astéroïde d'origine disparaît à la division (il ne revient pas sur l'orbite).

**Convoi** (`CONVOY`) : même trajectoire et même vitesse, décalage de départ = `comboStagger` de la difficulté (adapté à la vitesse du vaisseau) × 0,95–1,2,
minimum 0,32 s. La ligne d'annonce est commune ; le décalage se retrouve au passage sur l'orbite : il faut anticiper les suivants.

**Laser balayeur** (`LASER`) : demi-largeur du rayon 0,03 rad (≈ 9 unités) + hitbox du vaisseau. Annonce (1,7 s → 1,15 s selon la difficulté, plancher 0,9 s) :
rayon de départ pointillé, arc pointillé du secteur balayé avec chevrons de sens et jauge, émetteur au centre. Étendue 1,2 → 2,0 rad, vitesse 0,9 → 1,5 rad/s.
**Zone de refuge** : le motif impose au moins 2,4 rad hors du secteur balayé (testé) ; le validateur d'évitement vérifie en plus qu'elle est atteignable.
Un laser compte comme un secteur dans les plafonds (2 simultanés, 36 % du cercle). Détection continue : le balayage relatif vaisseau/rayon est testé à chaque pas
(un rayon à 9 rad/s ne « saute » pas le vaisseau ; testé).

## Générateur et garde-fous
Pour chaque vague, le directeur tire un motif pondéré, puis vérifie :
1. **Plafonds** : nombre de menaces encore dangereuses (2 → 6 selon la difficulté, 8 au maximum absolu), au plus
   2 secteurs simultanés couvrant au plus 36 % du cercle.
2. **Trajet atteignable** (`sim/safety.ts`) : modèle de joueur qui décide (continuer ou inverser) à intervalles **d'angle** constants
   (≈ toutes les 0,125 s à la vitesse de l'instant), continue tout droit pendant 0,25 s (temps de réaction) puis cherche un trajet
   sans collision, avec une hitbox élargie de 10 unités et 0,06 s de marge autour des secteurs et lasers, jusqu'à disparition de toutes les menaces
   connues. **Il suit la vitesse réelle du vaisseau** (courbe de Survie, y compris pendant les rampes de 2 s) : les durées des pas s'allongent quand le
   vaisseau est lent. Testé contre une exploration exhaustive de toutes les séquences de décisions (vitesses constantes et rampe).
   Cela couvre les doubles croisements et les dangers de part et d'autre du joueur.
3. Si 8 tentatives échouent, la vague est reportée de 0,25 s (respiration naturelle).

Les annonces ont des durées minimales (projectile 0,55 s + temps d'approche, secteur 0,65 s). Ce dispositif écarte les
situations manifestement inévitables ; il ne constitue pas une preuve formelle pour un joueur humain.

## Survie et défi quotidien (équilibrage v1.1)
Réglages dans `src/config/survival.ts`, indépendants des hitboxes. Les plafonds absolus ne changent pas (voir ci-dessus).

**Courbe accélérée** : d(t) = 0,93 × (1 − e^(−t/τ)) avec **τ = 68 s** (v1.0 : 170 s, soit ×2,5). La difficulté que le jeu atteignait vers
5 minutes (d = 0,771) est atteinte vers **2 minutes**. Départ inchangé (d = 0), plafond inchangé (0,93, jamais 1), aucun saut (test).

| t | 30 s | 60 s | 2 min | 3 min | 5 min | 10 min |
|---|---|---|---|---|---|---|
| d v1.1 | 0,33 | 0,55 | **0,77** | 0,86 | 0,92 | 0,93 |
| d v1.0 | 0,15 | 0,28 | 0,47 | 0,61 | **0,77** | 0,90 |

**Calendrier des motifs** (poids qui montent progressivement, de 0 à leur valeur) :
| Dès | Motifs |
|---|---|
| 8 s | Arc électrique (v1.0 : 18 s) |
| **30 s** | Doubles attaques : Doublé, Croix (v1.0 : 40 s) |
| 45 s | Autres doubles : Arcs jumeaux, Écho, Poursuite |
| **60 s** | Combinaisons projectile + secteur : Tir + arc (v1.0 : 70 s) ; leur poids augmente encore jusqu'à ×1,5 vers 2 min 15 |
| 90 s | Rafale, Tenaille (v1.0 : 130 s) |

Mesuré avec le simulateur (`npm run sim`, 10 graines) : 0 % de doubles avant 30 s, ≈ 24 % entre 30 et 60 s, ≈ 53 % entre 1 et 2 min ;
combinaisons projectile/secteur 0 % avant 1 min, ≈ 8 % puis ≈ 25 % à partir de 2 min.

**Intensification après 3 minutes** (rampe de 20 s) : intervalle entre vagues × 0,82 (borné par `CAPS.minWaveInterval` = 0,85 s,
désormais imposé explicitement), motifs complexes ×1,3, motifs simples ×0,75. Respirations : avant 3 min, 1,2–2,0 s toutes les
6–9 vagues ; après 3 min, **brèves** (0,9–1,4 s) mais plus fréquentes (toutes les 4–6 vagues). Résultat mesuré : ≈ 27 → 33 vagues/min,
jamais plus de 8 s sans vague (annonce + respiration d'un événement comprises). Modulation lente du rythme (±12 %, période 37 s) introduite dès 40 s.

**Annonces réduites de 8 %** (`warnScale` 0,92), avec les planchers inchangés : 0,55 s (projectile) et 0,65 s (secteur).
À la difficulté maximale : 0,58 s (tir) et 0,70 s (secteur). Les niveaux ne sont pas concernés.

Inchangés : vitesse du joueur, vitesse maximale des projectiles (580), nombre maximal de menaces (8), secteurs simultanés (2, 36 % du cercle),
validateur d'évitement (modèle de joueur, marges), répit de cycle, déblocage des familles aux niveaux. Aucune fin cachée : un test simule
25 minutes (plafonds, nettoyage des objets, production continue de vagues).

**Introduction des nouveaux dangers (Survie/défi, `config/survival.ts`)** : convoi dès ≈ 38 s (rampe de 22 s, aussi présent dans la pluie de météores),
astéroïde fragmenté dès 75 s, laser balayeur dès 110 s ; les motifs complexes (×1,3 après 3 min) s'appliquent aussi à eux. Mesuré (4 graines × 8 min) : 36–45 convois,
9–19 fragmentés, 8–15 lasers ; premiers fragments vers 100 s, premiers lasers vers 120–200 s. Les niveaux n'en contiennent pas.

## Adaptation à la vitesse réelle du joueur
Ralentir le vaisseau allonge le temps nécessaire pour franchir un même angle : les réglages de temps sont allongés par `(1 / facteur)^exposant`
(`PACE` dans `config/playerSpeed.ts`) ; à pleine vitesse rien ne change (testé), et les planchers de CAPS ne sont jamais abaissés.
| Réglage | Exposant | À 40 % de vitesse |
|---|---|---|
| Annonces (projectiles, secteurs, lasers) | 0,8 | ×2,1 |
| Décalage des attaques combinées et des convois | 0,8 | ×2,1 |
| Intervalle entre vagues | 0,4 | ×1,44 |
| Largeur des secteurs électriques | −0,4 | ×0,69 |
| Vitesse de balayage des lasers | −0,8 | ×0,48 |
La vitesse des projectiles et la courbe de difficulté d(t) ne changent pas. Contrôles : validateur à la vitesse réelle (ci-dessus), plafonds inchangés, et un robot
moins vif que le modèle du validateur (décision 0,2 s, réaction 0,3 s) meurt moins souvent qu'en v1.1 (6/12 contre 7/12 sur 5 minutes ; `npm run sim`).
Cela ne remplace pas des essais humains : le début de partie (vaisseau à 40 %) est plus lent et plus indulgent qu'avant, la difficulté perçue vient surtout de la montée de vitesse.

## Événements (Survie et défi quotidien, `config/events.ts`)
Un **seul directeur de vagues** gère une machine d'états : `normal → annonce → événement → respiration → normal`. Aucune vague normale en dehors de la phase `normal`.
- **Calendrier** (temps de jeu actif) : premier début entre 45 et 60 s, puis 40 à 60 s après la **fin** de la phase active de l'événement précédent (la respiration de 3 s est
  comprise dans cet intervalle). Annonce affichée **2 s avant** le début (« Pluie de météores ! dans 2 s »), libellé et compte à rebours pendant l'événement.
- **Pluie de météores** (12 s) : vagues d'astéroïdes simples et de convois. **Tempête électrique** (10 s) : secteurs électriques successifs (arcs, arcs jumeaux, poursuite)
  et quelques astéroïdes. Intervalle entre vagues ×0,85 / ×0,8 (borné par `CAPS.minWaveInterval`).
- **Menaces restantes** : jamais effacées ; dès l'annonce plus aucune nouvelle attaque normale, les menaces présentes finissent normalement, et les vagues de l'événement
  tiennent compte d'elles (plafonds + validateur d'évitement) : pas de cumul incontrôlé. **Respiration** : 3 s sans nouvelle attaque, sans effacer l'existant ; le répit de cycle
  est inactif hors phase normale.
- **Reproductibilité** : le calendrier (instants et types) vient d'un générateur dédié dérivé de la graine : identique pour tous à date UTC égale, quelles que soient les actions du joueur
  (testé). Les vagues elles-mêmes dépendent, comme avant, de la graine et de la position du joueur.
- **Pause** : tous les chronomètres (événements, annonce, respiration, vitesse, bandeau) sont en temps actif et s'arrêtent.

## Records et versions d'équilibrage
`BALANCE_VERSION` (`src/config/version.ts`) vaut 3 (v1.2 : vitesse progressive, nouveaux dangers, événements). Les records de l'équilibrage 2 (v1.1) rejoignent `archive['2']`, ceux de
la v1.0 restent dans `archive['1']` ; une copie de la sauvegarde d'origine est conservée (`polarite.save.avant-eq2`). Les records de Survie et de défi sont rattachés à une version d'équilibrage ;
ceux d'un ancien équilibrage sont rangés dans `archive` (affichés « ancien équilibrage », jamais comparés ni écrasés). Détails : section Sauvegarde du README.

## Niveaux
Chaque niveau : difficulté de début et de fin, rythme (régulier, pulsé, crescendo), poids des motifs, introduction en
cours de partie (niveau 4). Plus de nouvelle vague dans la dernière seconde.

**Règle collision / fin du chrono** : dans un pas de simulation, la collision est évaluée avant la fin du chronomètre.
Une collision pendant le pas qui atteint 90 s est donc un échec. Règle déterministe, testée.

**Niveaux v1.1** : difficulté, annonces et rythme inchangés ; seuls le rendu et les hitboxes (+6,5 %) changent. Les seuils d'étoiles
restent ceux de la v1.0. Les scores médians des bots varient de −18 % à +18 % selon le niveau avec les hitboxes agrandies (6 graines par niveau, donc bruyant) : seuils à réexaminer avec des joueurs.

**Étoiles** : seuils par niveau calibrés avec `npm run sim` : 1★ ≈ 35 % et 2★ ≈ 70 % du score médian d'un bot
« prudent » (esquive seulement), 3★ ≈ 70 % d'un bot « expert » (chasse aux balises). Les étoiles ne s'obtiennent que sur
un niveau réussi ; le déblocage du niveau suivant ne dépend que de la survie.

## À vérifier en priorité lors des essais humains
- Lisibilité des annonces sur petit écran et en mouvement ; densité en Survie au-delà de 5 minutes.
- Faisabilité ressentie des Tenailles et Rafales aux niveaux 10–12.
- Seuils d'étoiles (probablement à abaisser si les joueurs inversent souvent).
