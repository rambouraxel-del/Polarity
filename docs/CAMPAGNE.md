# Campagne — chapitre 1 « Douze ans de silence » (niveaux 1 à 5)

Mode narratif jouable, centré sur l'histoire : scène illustrée avant et après chaque niveau, gameplay au service de la narration. Il **réutilise** les mécaniques existantes
(orbite, inversion, balises, directeur de vagues, validateur d'évitement) : pas de nouveau déplacement, pas de tir. Seuls les **niveaux 1 à 5** sont livrés ; la suite du chapitre
(environ quinze niveaux prévus) est annoncée « À venir ». Scénario complet : `docs/CAMPAGNE_SCENARIO.md` (copie lisible fournie avec le pack).

## Où est quoi ?
| Fichier | Rôle |
|---|---|
| `src/data/campagne_niveaux_01_05.fr.json` | **Dialogues** (source éditable, séparée de la logique, transcription fournie, textes non altérés) |
| `src/config/story.ts` | Séquences `n<N>-before` / `n<N>-after` (IDs stables, enregistrés dans la sauvegarde), mapping locuteur → nom/portrait, résolution des assets WebP, vitesse du texte (`STORY_UI`) |
| `src/config/campaign.ts` | **Source unique** des niveaux (objectif, limite, vitesse, script de difficulté, défi secondaire), récompenses (`CAMPAIGN_REWARDS`), chapitre, hangar prévu (`HANGAR_ENABLED = false`) |
| `src/campaign/simulation.ts` | `CampaignSimulation` (sous-classe de `Simulation`, **`src/sim/` intact**) : objectifs, objets de mission, améliorations (inactives), événements |
| `src/campaign/progress.ts` | Étoiles, récompenses uniques, déblocages, réserve d'Éclats de campagne, scènes vues |
| `src/campaign/bot.ts` | Joueur automatique pour les tests de faisabilité |
| `src/ui/campaignScreens.ts`, `src/styles/campaign.css` | Écrans : campagne, carte des niveaux, fiche, journal, **récit**, bilan |
| `src/app.ts` | Orchestration : scène → niveau → victoire → scène de conclusion → bilan ; texte progressif ; clavier |
| `src/config/skins.ts` (`CAMPAIGN_SKIN`) | La Traverse, vaisseau d'Élias (hors catalogue et boutique) |
| `art/campagne/` | **Masters PNG** (hors bundle) + `ASSETS.json` |
| `src/assets/story/*.webp` | Assets du jeu (WebP) |
| `tests/story.test.ts`, `tests/campaign-*.test.ts`, `scripts/e2e.mjs` (section Campagne) | Tests |

## Niveaux (choix d'équilibrage, à valider avec de vrais joueurs)
Dangers : **astéroïdes uniquement** (pas de secteur électrique ni de laser avant les niveaux suivants). Aucune transmission n'est affichée pendant une esquive. « Éclats » = les balises de l'orbite.

| # | Titre | Objectif | Vitesse | Difficulté (début → fin) | Défi secondaire |
|---|---|---|---|---|---|
| 1 | De quoi rentrer | Récolter 6 éclats (champ peu dense) | 45 % | 0,02 → 0,10 | < 40 s |
| 2 | Une bonne journée | Récolter 12 éclats (champ plus dense, trajectoires moins prévisibles) | 50 % | 0,06 → 0,20 | multiplicateur ×3 |
| 3 | Tenir | Survivre 60 s à la première tempête d'astéroïdes (aucun quota de récolte) | 55 % | 0,14 → 0,30 | ≥ 6 éclats |
| 4 | Ce que la tempête a laissé | Suivre 3 fragments d'épave (rythme redescendu, astéroïdes fragmentés) | 50 % | 0,10 → 0,22 | < 45 s |
| 5 | Douze ans de silence | Télécharger les données de la balise de la capsule : 3 passages (adaptation de « rester à proximité » au moteur) | 55 % | 0,14 → 0,30 | < 55 s |

Mécanique commune : respirations (aucune nouvelle vague), vitesse réglée par niveau, trajectoires issues de la graine de la tentative, tous les niveaux validés par le validateur d'évitement du directeur.

## Récit (écran dédié)
- Illustration fixe en haut (`object-fit: contain`, jamais étirée ni recadrée), boîte de dialogue en bas : nom, petit portrait à gauche, texte français. Mise en page adaptée à la hauteur et aux safe areas ; paysage bas : illustration à gauche, dialogue à droite.
- Une réplique à la fois, texte progressif (48 car./s ; instantané avec « effets réduits »). **Premier toucher : révèle toute la réplique ; toucher suivant : avance.** Toucher dans la zone narrative (illustration comprise) fonctionne. Un seul événement `click` (pas de double avance) ; les boutons consomment leur propre événement. Clavier : Entrée/Espace (mêmes règles), Échap = passer.
- **Passer la scène** : ferme la scène seulement (ni victoire ni récompense). Les scènes sont jouées automatiquement **une seule fois** (introduction avant le niveau, conclusion après la victoire), puis **relisibles** depuis la fiche du niveau (« Revoir l'introduction / la conclusion ») et le **Journal des scènes**. Rejouer ou réessayer ne les répète pas ; un échec ne montre jamais la conclusion.
- Pendant une scène, aucune partie n'est en cours : jeu, chrono, dégâts et commandes sont à l'arrêt ; les touchers de la scène n'atteignent jamais le jeu.
- Didascalies du scénario : conservées dans le JSON, **jamais affichées** comme parole. Message système : nom neutre « Système », cadre distinct, sans portrait. Voix enregistrée : portrait de la radio, sans visage ni étiquette.
- Niveau 5 : `05a_capsule_exterieur` à l'introduction, `05b_capsule_interieur` à la conclusion.

## Mapping des assets
| Master (`art/campagne/`) | Jeu (`src/assets/story/`) | Usage |
|---|---|---|
| illustrations/01_de_quoi_rentrer.png | 01_de_quoi_rentrer.webp | Niveau 1, avant et après |
| illustrations/02_une_bonne_journee.png | 02_une_bonne_journee.webp | Niveau 2 |
| illustrations/03_tenir.png | 03_tenir.webp | Niveau 3 |
| illustrations/04_ce_que_la_tempete_a_laisse.png | 04_ce_que_la_tempete_a_laisse.webp | Niveau 4 |
| illustrations/05a_capsule_exterieur.png | 05a_capsule_exterieur.webp | Niveau 5, introduction |
| illustrations/05b_capsule_interieur.png | 05b_capsule_interieur.webp | Niveau 5, conclusion |
| portraits/elias.png, nora.png, transmission_inconnue.png | elias.webp, nora.webp, transmission_inconnue.webp | Portraits (vrai canal alpha) |

Export (Pillow) : illustrations 1200 px de large, WebP qualité 86 (**146 à 286 Ko** mesurés) ; portraits 384 px, WebP avec alpha (**42 à 46 Ko**). Les images sont des URL résolues par nom (Vite, chemin compatible sous-chemin GitHub Pages) et ne sont **chargées qu'à l'affichage de la scène** ; l'illustration de la scène suivante est préchargée. Aucun base64, aucun chargement de toutes les images au lancement.
Pour régénérer : redimensionner depuis `art/campagne/` avec les mêmes paramètres (voir l'historique du commit).

## Progression, récompenses, sauvegarde
- Introduction → niveau → victoire → conclusion → déblocage du niveau suivant. Aucun score minimal.
- Étoile 1 : objectif. Étoile 2 : défi secondaire du niveau.
- **Éclats de campagne** (`save.campaign.reserve`) : **réserve séparée** du portefeuille de la Survie et des cosmétiques ; première réussite **30**, défi secondaire **10** (une seule fois chacun), réussites suivantes **0**. Jamais convertis ; aucun lien avec les Prismes. La campagne ne touche ni aux succès, ni aux statistiques, ni aux records, ni au classement.
- Sauvegarde **format 6** : champ `campaign` (niveaux, scènes vues, réserve, améliorations prévues, fin des niveaux livrés). Migration v5 → v6 : la première campagne « Écho-7 » (jamais diffusée au-delà de la branche de développement) est remise à neuf ; **tout le reste est conservé** ; copie `polarite.save.avant-v5`. Une apparence « Écho » de cette première version n'existe plus.
- Vaisseau de campagne : **la Traverse** (coque sable usée, ailes bleu-vert, verrière ambre, réacteur bleu-vert), propre à la campagne ; l'apparence équipée de la Survie n'y est pas appliquée.

## Garanties (Survie, classement)
`src/sim/*` n'est **pas modifié** : la Survie, le défi quotidien, les niveaux classiques et le rejeu du serveur restent identiques ; `BALANCE_VERSION` inchangée. `createSimulation` (utilisée par le serveur) refuse le mode `campaign`. Aucune partie de campagne n'est envoyée au classement. Hébergement VPS non touché.

## Ajouter les niveaux suivants (6 à 15)
1. Ajouter les dialogues au JSON (ou un nouveau fichier de chapitre) : `levels[]` avec `before` / `after` (`dialogue`, `direction`, `system`) et les illustrations (WebP dans `src/assets/story/`, master dans `art/campagne/`).
2. Ajouter une entrée à `MISSIONS` dans `src/config/campaign.ts` (`before: 'n<N>-before'`, `after: 'n<N>-after'`), avec objectif, vitesse, script. Les secteurs électriques et lasers (`arc`, `chase`, `laser`…) ne sont autorisés que pour les niveaux où l'histoire les introduit (le test `astéroïdes seulement` est à relâcher à ce moment-là).
3. Ajouter la faisabilité au test (`tests/campaign-simulation.test.ts` boucle sur `MISSIONS`).
4. Hangar et améliorations : données et logique conservées (`UPGRADES`, `UPGRADE_EFFECTS`, `CampaignSimulation`, `buyUpgrade`) ; passer `HANGAR_ENABLED` à `true` et recréer l'écran du hangar (retiré pour ces cinq niveaux) quand l'histoire y arrive.

## À valider avec de vrais joueurs
Les bots (joueur parfait) réussissent les cinq niveaux sur toutes les graines testées : cela prouve la **faisabilité**, pas le ressenti. À régler dans `config/campaign.ts` : `speed`, `difficulty`, `phases`/`weights`, durée de vie des objets (niveaux 4 et 5), seuils des défis, récompenses. Proposition d'intégration à confirmer : vitesse du texte, tailles de police et de portrait, taille de la boîte de dialogue.
