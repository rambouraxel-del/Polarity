# Vérifications manuelles — Safari iPhone et Android

À faire **sur de vrais téléphones** (aucune de ces vérifications n'a été effectuée : l'environnement de développement n'a pas d'appareil).
Version à tester : l'adresse de la branche ou du déploiement ; la version est affichée en bas de l'écran Options.
Astuce : ajouter `?stade=1` à `?stade=5` à l'adresse lance l'ambiance directement au début du stade choisi (la partie, elle, est normale).

## Audio
1. **Déverrouillage** : première partie après ouverture de la page → la musique démarre-t-elle au premier toucher, sans second geste ? Sur iPhone, interrupteur « silencieux » activé : le comportement attendu est celui d'Apple (sons Web Audio coupés) ; vérifier qu'il n'y a pas de blocage au retour.
2. **Qualité perçue** : intro → boucle (raccord à ≈ 24 s : aucun clic, aucune coupure), boucle sur plusieurs tours (≈ 2 min 33 s : aucun silence ni saut), fin de partie → outro en fondu. Écoute au casque filaire et aux haut-parleurs.
3. **Saturation / niveaux** : volume général à 100 % puis 70 % : musique et effets sans distorsion ; équilibre musique / effets (réglages « Musique » et « Effets sonores »).
4. **Bluetooth** (écouteurs, enceinte) : les pulsations visuelles tombent-elles sur les battements ? Si elles arrivent **trop tôt** (latence Bluetooth plus grande que celle annoncée), augmenter le retard dans `src/config/ambience.ts` (`AMBIENCE.music.lead`, valeur négative) ; trop tard : valeur positive.
5. **Interruptions** : appel entrant ou verrouillage d'écran pendant une partie → au retour, la partie est en pause ; reprendre : musique et pulsations repartent ensemble (iPhone : l'état audio « interrupted » est repris au premier toucher).
6. **Sourdine** et curseurs : « Son » coupé → plus de musique, plus de pulsation visuelle ; « Musique » à 0 % ; écoute d'essai au relâchement du curseur « Musique » ; réglages conservés après fermeture et réouverture.
7. Pause / reprise / Recommencer / retour à l'accueil : pas de double musique, pas de coupure sèche, pas de reste d'outro au démarrage d'une nouvelle partie.

## Réseau lent
8. Réseau 3G simulé ou mode Économiseur de données : l'écran d'accueil est utilisable avant la fin du chargement des MP3 (≈ 2,7 Mo, téléchargés au premier toucher) ; la première partie démarre sans musique si le décodage n'est pas fini, puis la musique arrive (l'ambiance ne pulse qu'avec la musique).

## Fluidité et chaleur
9. Survie de 5 minutes ou plus sur un appareil moyen puis ancien : fluidité (60 images/s si l'appareil le permet), pas de ralentissement visible au stade 4–5 ; l'appareil ne chauffe pas anormalement. Si la fluidité baisse, l'ambiance réduit d'elle-même ses effets (3 niveaux) : noter si cela se voit trop.
10. Option « Effets réduits » et réglage « Intensité visuelle » (0 %, 50 %, 100 %) : le jeu reste lisible, l'ambiance s'atténue comme annoncé.

## Luminosité et lisibilité (0 s, 60 s, 120 s, 180 s, 240 s et plus)
11. À chaque stade, en plein jour (luminosité élevée) et dans le noir : le vaisseau, les **six balises**, les annonces de menaces (croix, pointillés), les astéroïdes, fragments, convois, secteurs électriques et lasers restent immédiatement identifiables. La faille et les lueurs ne doivent **jamais** se confondre avec une menace.
12. Les transitions entre stades (≈ 10 s) sont progressives : aucun changement brutal de fond ni apparition soudaine d'effet.
13. Les passages forts de la boucle (≈ 1 min 05, 1 min 49, 2 min 16) sont spectaculaires sans gêner : pas de flash agressif, pas de gêne visuelle ; sinon baisser `AMBIENCE.caps` ou conseiller « Intensité visuelle ».
14. Orientation paysage et portrait, petit écran (≈ 320 px de large) : la zone de jeu reste lisible.
