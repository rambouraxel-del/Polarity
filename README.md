# Polar Rift

(le dépôt GitHub et les clés de sauvegarde gardent l'identifiant historique « polarite »)

Jeu d'arcade web au néon, jouable sur ordinateur et mobile. Un petit vaisseau tourne seul sur une orbite :
**un clic, un toucher ou Espace inverse sa direction**. Évitez les tirs et les secteurs électriques, collectez
les six balises pour enchaîner les cycles et faire monter le multiplicateur.

- **Niveaux** : 12 niveaux de 90 secondes. Survivre jusqu'au bout débloque le suivant ; le score donne jusqu'à 3 étoiles.
- **Survie** : sans limite de durée, la difficulté monte progressivement. Le record est le temps de survie. Le vaisseau part à **40 % de sa vitesse de référence**
  et gagne 5 points de pourcentage toutes les 30 s (100 % à 6 min). Des **événements** rythment la partie : *pluie de météores* (12 s) et *tempête électrique* (10 s),
  annoncés 2 s avant, suivis de 3 s de respiration. Trois dangers s'y ajoutent peu à peu : **astéroïde fragmenté**, **convoi d'astéroïdes**, **laser balayeur**.
- **Défi quotidien** : règles de la Survie, mêmes motifs et mêmes événements (graine = date UTC) pour tous. Meilleur résultat conservé par date.
- **Éclats et boutique** : en Survie, un éclat apparaît 5 s sur l'orbite (+5 Éclats), les niveaux rapportent 50 / +15 par étoile / 10 ; les Éclats achètent des vaisseaux, traînées et packs cosmétiques. Les Prismes (monnaie premium) sont préparés mais **non achetables** (« Bientôt disponible »). Voir `docs/ECONOMIE.md`.
- **Cosmétiques** : un seul menu (Vaisseaux / Traînées / Packs, filtres Tous / Possédés / À débloquer, aperçu animé, achat ou équipement, soldes une seule fois). **Succès** : 27 objectifs progressifs (découverte, Survie, niveaux, collectes, maîtrise), chacun rapporte des Éclats (versés une fois, avec notification) ; certains débloquent un cosmétique. **Classement mondial** (Survie) : intégration prête (profil à pseudo, top 100, résultats validés par rejeu serveur) mais **non opérationnel tant qu'aucun service n'est déployé** (`docs/CLASSEMENT.md`).
- **Apparences et succès (v1.4)** : 9 succès, 7 apparences purement cosmétiques (coque, ailes, cockpit et réacteur de couleurs différentes, même hitbox). Menu avec grand aperçu animé, cartes *Équipé / Disponible / Verrouillé*, bouton « Équiper » et condition de déblocage précise (`docs/APPARENCES.md`).

Style graphique « Néon premium » (v1.1) : vrai vaisseau blanc/argent à cockpit cyan et astéroïdes rocheux aux fissures orange,
en sprites ; réacteur, traînées, étincelles et impact sont générés par code (voir `docs/ASSETS.md`).

Interface « Néon premium » (v1.3) : logo, thème centralisé (`src/ui/theme.ts`), police Orbitron locale, fond spatial discret dans les menus
(masqué pendant les parties, statique avec l'option « Effets réduits »), écrans accueil / niveaux / pause / résultat / options / apparences / succès
harmonisés. Voir `docs/INTERFACE.md`. Pour renommer le jeu : `src/config/brand.ts` (`GAME_NAME`) ; ne pas toucher à `STORAGE_NAMESPACE` (progression).

Aucun serveur, aucun compte : les sprites sont des fichiers locaux, les sons sont générés (Web Audio).
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

## Publication sur GitHub Pages

Le workflow `.github/workflows/pages.yml` lance les tests, construit le jeu et le publie à chaque push sur `main`
(ou à la demande depuis l'onglet Actions). Réglage unique dans le dépôt : **Settings → Pages → Source : GitHub Actions**.
Le jeu est ensuite disponible sur `https://<utilisateur>.github.io/<dépôt>/`. Les chemins du build sont relatifs :
il fonctionne dans n'importe quel sous-dossier.

## Applications Android et iOS
Le même jeu est prêt à être encapsulé (Capacitor) : projets `android/` et `ios/`, un seul code source. Rien n'est publié ; les étapes de construction, de signature et de publication sont dans `docs/BUILD_MOBILE.md`.

## Vérifications

```bash
npm run typecheck  # TypeScript
npm test           # tests unitaires (Vitest)
npm run check      # typecheck + tests + build
npm run e2e        # test navigateur Chromium (Playwright requis, non inclus) après npm run build
npm run e2e:classement  # classement mondial : vrai serveur local + navigateur
npm run server     # service de classement (voir docs/CLASSEMENT.md ; Node 22.13+)
npm run sim        # outil d'équilibrage : bots sur les 12 niveaux, courbe et mix de motifs de la Survie
npm run cost       # coût du directeur de vagues (validateur d'évitement inclus)
npm run perf       # coût processeur en émulation mobile (node scripts/perf.mjs --dist <dossier> pour comparer deux builds)
npm run sprites    # recrée les textures 128 px depuis art/source/ (Python + Pillow)
```

`npm run e2e` utilise Playwright s'il est installé (localement ou globalement) et écrit des captures dans `screenshots/`.
Paramètres d'URL de contrôle : `?demo` laisse le joueur automatique jouer (observer les motifs) ; `?debug` affiche les hitboxes
(traits pleins) et les silhouettes (traits fins).

## Commandes de jeu

| Action | Ordinateur | Mobile |
|---|---|---|
| Inverser la direction | Clic dans l'arène ou **Espace** | Toucher l'écran |
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
- **Astéroïde fragmenté** : une étoile marque l'endroit où il se divisera ; les trajectoires des deux fragments (plus petits) sont déjà annoncées, avec leurs croix de passage.
- **Convoi** : plusieurs astéroïdes sur la même ligne pointillée, l'un après l'autre : anticipez les suivants.
- **Laser balayeur** : un rayon part du centre et pivote sur l'arc pointillé annoncé (chevrons = sens du balayage). Le reste de l'orbite est la zone de refuge.

Les annonces se distinguent des dangers actifs par la forme (pointillés/contours contre formes pleines), pas seulement par la couleur.

## Sauvegarde et records

Sauvegarde locale versionnée (format 2). Les **records de Survie et du défi quotidien dépendent de la version d'équilibrage** (3 depuis la v1.2 :
vitesse progressive, nouveaux dangers, événements) : les anciens records (v1.0 et v1.1) sont **conservés à part** (« ancien équilibrage »),
affichés à titre indicatif et jamais comparés aux nouveaux ; les nouveaux records repartent de zéro. Niveaux débloqués, étoiles, meilleurs
scores, succès, apparences et options sont **préservés tels quels**. Une copie de l'ancienne sauvegarde est gardée dans le navigateur
(`polarite.save.avant-v1`, puis `polarite.save.avant-eq2` pour le passage v1.1 → v1.2) et supprimée seulement par « Effacer toute la progression ».

## Options

Son (coupure), volume, effets réduits (sans secousse, flash ni traînées), réaffichage de l'astuce de départ,
effacement de la progression (avec confirmation). Les options sont sauvegardées.

## Structure

Voir `CLAUDE.md` (architecture et règles), `docs/EQUILIBRAGE.md` (paramètres, générateur, règles), `docs/ASSETS.md` (sprites et effets), `docs/INTERFACE.md` (direction artistique, thème, écrans), `docs/APPARENCES.md` (ajouter une apparence), `docs/ECONOMIE.md` (Éclats, Prismes, boutique, succès), `docs/CLASSEMENT.md` (classement mondial : architecture, triche, mise en service), `docs/ROADMAP.md` (évolutions futures : balise bonus temporaire, secteurs thématiques des niveaux) et
`docs/MONETISATION.md` (pistes de rentabilité). Suivi : `PROGRESS.md`, reprise : `RESUME.md`.

## Limites connues

- L'équilibrage (vitesses, cadences, seuils d'étoiles, ambition de 15–20 min en Survie) est calibré avec des bots aux
  réflexes parfaits, **pas encore validé par des joueurs**. La courbe de Survie v1.1 est ~2,5× plus rapide : à confirmer en jeu
  (par exemple, vérifier qu'elle reste jouable pour de bons joueurs vers 2–3 minutes). Réglages dans `src/config/` :
  `survival.ts` (difficulté), `hitbox.ts` (hitboxes), `visuals.ts` (tailles et effets), `balance.ts` (plafonds, score, combo).
- Le validateur d'évitement écarte les combinaisons manifestement inévitables selon un modèle de joueur (décision toutes
  les 0,125 s, marge de sécurité) ; ce n'est pas une garantie mathématique pour un humain.
- Tests réalisés en Chromium (bureau et émulation mobile). Safari iOS et Firefox n'ont pas été testés sur appareil réel.
- Le rendu utilise WebGL (repli Canvas automatique via Phaser) ; le paquet JS fait ~1,3 Mo (≈ 340 Ko gzip), essentiellement Phaser,
  plus ≈ 125 Ko de sprites.
- La vitesse progressive du vaisseau, les événements et les nouveaux dangers sont calibrés avec des robots et par tests : à valider par des joueurs (début de partie plus lent, montée de vitesse, lisibilité des lasers et des fragments sur petit écran).
- Performances mobiles : mesurées seulement en émulation processeur (×4 ralenti, rendu logiciel) : le coût GPU d'un vrai téléphone n'a pas été mesuré.
- Les sprites sont générés par IA (voir `docs/ASSETS.md`) : vérifier les conditions d'usage du fournisseur avant commercialisation.
