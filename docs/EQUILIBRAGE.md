# Équilibrage et règles de jeu

Tous les paramètres sont dans `src/config/balance.ts` (globaux) et `src/config/levels.ts` (niveaux).
Les valeurs sont des **points de départ** à confirmer par des essais humains.

## Simulation
- Pas fixe de 1/120 s, temps actif = nombre de pas × dt (aucune dérive). Une image de plus de 0,1 s est tronquée.
- Résultats identiques quelle que soit la fréquence d'affichage ; le rendu interpole seulement l'affichage.
- Aléatoire de gameplay : `Rng` à graine (mulberry32). Les effets décoratifs utilisent `Math.random` et ne décalent jamais les tirages.

## Joueur
- Vitesse angulaire constante 2,0 rad/s (un tour ≈ 3,1 s), ne change jamais : ce sont les menaces qui évoluent.
- Hitbox de 7 unités pour un visuel de 11 (indulgente). Projectile : hitbox 8, visuel 10. Secteurs : 0,03 rad de tolérance à chaque bord.
- Collision continue : distance minimale exacte entre le mouvement du vaisseau et celui du projectile sur chaque pas ;
  balayage angulaire pour les secteurs. Testé avec un projectile à 20 000 unités/s.

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

## Survie
d(t) = 0,93 × (1 − e^(−t/170)) : apprentissage les premières minutes, puis plateau sous le plafond (jamais d = 1).
Déblocage progressif des familles (secteurs 18 s, doubles 40 s, combinaisons 70 s, motifs avancés 130 s), respirations
de 1,2 à 2 s toutes les 6 à 9 vagues, modulation lente du rythme (±12 %, période 37 s). Aucune fin cachée : un test simule
25 minutes et vérifie plafonds, absence d'accumulation d'objets et production continue de vagues.

| d | Intervalle de vague | Annonce tir | Annonce secteur | Vitesse tir |
|---|---|---|---|---|
| 0 | 2,2 s | 1,05 s | 1,3 s | 320 |
| 0,93 | 0,99 s | 0,63 s | 0,76 s | 543 |

## Niveaux
Chaque niveau : difficulté de début et de fin, rythme (régulier, pulsé, crescendo), poids des motifs, introduction en
cours de partie (niveau 4). Plus de nouvelle vague dans la dernière seconde.

**Règle collision / fin du chrono** : dans un pas de simulation, la collision est évaluée avant la fin du chronomètre.
Une collision pendant le pas qui atteint 90 s est donc un échec. Règle déterministe, testée.

**Étoiles** : seuils par niveau calibrés avec `npm run sim` : 1★ ≈ 35 % et 2★ ≈ 70 % du score médian d'un bot
« prudent » (esquive seulement), 3★ ≈ 70 % d'un bot « expert » (chasse aux balises). Les étoiles ne s'obtiennent que sur
un niveau réussi ; le déblocage du niveau suivant ne dépend que de la survie.

## À vérifier en priorité lors des essais humains
- Lisibilité des annonces sur petit écran et en mouvement ; densité en Survie au-delà de 5 minutes.
- Faisabilité ressentie des Tenailles et Rafales aux niveaux 10–12.
- Seuils d'étoiles (probablement à abaisser si les joueurs inversent souvent).
