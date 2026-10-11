# Équilibrage et règles de jeu

Tous les paramètres sont dans `src/config/balance.ts` (globaux) et `src/config/levels.ts` (niveaux).
Les valeurs sont des **points de départ** à confirmer par des essais humains.

## Simulation
- Pas fixe de 1/120 s, temps actif = nombre de pas × dt (aucune dérive). Une image de plus de 0,1 s est tronquée.
- Résultats identiques quelle que soit la fréquence d'affichage ; le rendu interpole seulement l'affichage.
- Aléatoire de gameplay : `Rng` à graine (mulberry32). Les effets décoratifs utilisent `Math.random` et ne décalent jamais les tirages.

## Joueur et hitboxes
- Vitesse angulaire constante 2,0 rad/s (un tour ≈ 3,1 s), ne change jamais : ce sont les menaces qui évoluent.
- **Hitboxes** (`src/config/hitbox.ts`, réglage indépendant des visuels et de la difficulté) : rayons d'origine 7 (vaisseau) et 8 (projectile)
  **+ 6,5 %** par défaut (plage prévue 5–8 %) → 7,46 et 8,52. Elles restent **en retrait des silhouettes** : le vaisseau fait
  ≈ 10,4 de demi-largeur, le plus petit astéroïde ≈ 9,0 de demi-dimension (tests : valable de +5 % à +8 %).
  Secteurs : 0,03 rad de tolérance à chaque bord. `setHitboxGrowth()` permet de tester une autre valeur (tests, outils).
- **Visuels** (`src/config/visuals.ts`) : +15 % par rapport à la v1.0. Les modifier ne change aucune collision.
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

## Menaces : 11 motifs, 3 familles
| Famille | Motifs |
|---|---|
| Projectiles traversants | Tir, Tir diamétral, Doublé (parallèles), Croix, Rafale (3 tirs balayant) |
| Secteurs électriques | Arc électrique, Arcs jumeaux (opposés), Poursuite (deux arcs successifs) |
| Attaques combinées | Tir + arc, Tenaille (deux arcs + tir dans la poche), Écho (aller-retour sur la même ligne) |

## Générateur et garde-fous
Pour chaque vague, le directeur tire un motif pondéré, puis vérifie :
1. **Plafonds** : nombre de menaces encore dangereuses (2 → 6 selon la difficulté, 8 au maximum absolu), au plus
   2 secteurs simultanés couvrant au plus 36 % du cercle.
2. **Trajet atteignable** (`sim/safety.ts`) : modèle de joueur qui décide toutes les 0,125 s (continuer ou inverser),
   continue tout droit pendant 0,25 s (temps de réaction) puis cherche un trajet sans collision, avec une hitbox
   élargie de 10 unités et 0,06 s de marge autour des secteurs, jusqu'à disparition de toutes les menaces connues.
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
jamais plus de 5 s sans vague. Modulation lente du rythme (±12 %, période 37 s) introduite dès 40 s.

**Annonces réduites de 8 %** (`warnScale` 0,92), avec les planchers inchangés : 0,55 s (projectile) et 0,65 s (secteur).
À la difficulté maximale : 0,58 s (tir) et 0,70 s (secteur). Les niveaux ne sont pas concernés.

Inchangés : vitesse du joueur, vitesse maximale des projectiles (580), nombre maximal de menaces (8), secteurs simultanés (2, 36 % du cercle),
validateur d'évitement (modèle de joueur, marges), répit de cycle, déblocage des familles aux niveaux. Aucune fin cachée : un test simule
25 minutes (plafonds, nettoyage des objets, production continue de vagues).

## Records et versions d'équilibrage
`BALANCE_VERSION` (`src/config/version.ts`) vaut 2. Les records de Survie et de défi sont rattachés à une version d'équilibrage ;
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
