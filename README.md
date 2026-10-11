# Polarité

Jeu d'arcade web au néon, jouable sur ordinateur et mobile. Un petit vaisseau tourne seul sur une orbite :
**un clic, un toucher ou Espace inverse sa direction**. Évitez les tirs et les secteurs électriques, collectez
les six balises pour enchaîner les cycles et faire monter le multiplicateur.

- **Niveaux** : 12 niveaux de 90 secondes. Survivre jusqu'au bout débloque le suivant ; le score donne jusqu'à 3 étoiles.
- **Survie** : sans limite de durée, la difficulté monte progressivement. Le record est le temps de survie.
- **Défi quotidien** : règles de la Survie, mêmes motifs pour tous à une date UTC donnée. Meilleur résultat conservé par date.
- **Apparences et succès** : 9 succès, 7 apparences purement cosmétiques.

Aucun serveur, aucun compte, aucune ressource externe : tout est généré dans le jeu (formes Phaser, sons Web Audio).
Les records sont enregistrés localement (navigateur) ; il n'existe pas de classement en ligne.

## Installation et lancement

Prérequis : Node.js 20.19+ ou 22.12+.

```bash
npm install
npm run dev        # http://localhost:5173 (ajoutez --host pour tester sur un téléphone du même réseau)
```

Build de production (dossier `dist/`, statique, servable depuis n'importe quel hébergement ou sous-dossier) :

```bash
npm run build
npm run preview    # aperçu local du build
```

## Vérifications

```bash
npm run typecheck  # TypeScript
npm test           # tests unitaires (Vitest)
npm run check      # typecheck + tests + build
npm run e2e        # test navigateur Chromium (Playwright requis, non inclus) après npm run build
npm run sim        # outil d'équilibrage : bots sur les 12 niveaux et en Survie
```

`npm run e2e` utilise Playwright s'il est installé (localement ou globalement) et écrit des captures dans `screenshots/`.
Ajoutez `?demo` à l'URL (ex. `http://localhost:5173/?demo`) pour laisser le joueur automatique jouer : utile pour observer les motifs.

## Commandes de jeu

| Action | Ordinateur | Mobile |
|---|---|---|
| Inverser la direction | Clic dans l'arène ou **Espace** | Toucher l'arène |
| Pause | **Échap** / **P** ou bouton ❚❚ | Bouton ❚❚ |
| Rejouer (écran de résultat) | **Espace** / **Entrée** ou bouton | Bouton |

L'inversion est instantanée, sans coût ni délai. Le jeu se met en pause automatiquement si l'onglet est masqué ou si la
fenêtre perd le focus ; la reprise est volontaire et précédée d'un compte à rebours. Le temps en pause ne compte jamais.

## Lecture des menaces

- **Projectile** : une ligne pointillée avec chevrons annonce sa trajectoire, des croix marquent les deux points où il
  coupe l'orbite, un trait plein se remplit jusqu'au départ. Le projectile actif est un disque plein.
- **Secteur électrique** : contours pointillés de part et d'autre de l'orbite et jauge de remplissage pendant l'annonce ;
  une fois actif, bande pleine épaisse et éclair en zigzag. On peut le quitter ou le traverser avant son activation.
- **Attaques combinées** : deux menaces décalées dans le temps.

Les annonces se distinguent des dangers actifs par la forme (pointillés/contours contre formes pleines), pas seulement par la couleur.

## Options

Son (coupure), volume, effets réduits (sans secousse, flash ni traînées), réaffichage de l'astuce de départ,
effacement de la progression (avec confirmation). Les options sont sauvegardées.

## Structure

Voir `CLAUDE.md` (architecture et règles), `docs/EQUILIBRAGE.md` (paramètres, générateur, règles) et
`docs/MONETISATION.md` (pistes de rentabilité). Suivi : `PROGRESS.md`, reprise : `RESUME.md`.

## Limites connues

- L'équilibrage (vitesses, cadences, seuils d'étoiles, ambition de 15–20 min en Survie) est calibré avec des bots aux
  réflexes parfaits, **pas encore validé par des joueurs**. Tous les réglages sont dans `src/config/`.
- Le validateur d'évitement écarte les combinaisons manifestement inévitables selon un modèle de joueur (décision toutes
  les 0,125 s, marge de sécurité) ; ce n'est pas une garantie mathématique pour un humain.
- Tests réalisés en Chromium (bureau et émulation mobile). Safari iOS et Firefox n'ont pas été testés sur appareil réel.
- Le rendu utilise WebGL (repli Canvas automatique via Phaser) ; le paquet JS fait ~1,3 Mo (≈ 340 Ko gzip), essentiellement Phaser.
