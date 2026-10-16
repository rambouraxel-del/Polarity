# Mode développeur (parties de test)

Réglage des **Options** (section « Mode développeur »), **désactivé par défaut**. Il sert à explorer et tester les phases de la Survie sans mourir.

## Ce qu'il fait
- **Survie seulement** : le vaisseau est immortel (`RunConfig.test` → option `invincible` déjà existante de `Simulation` ; aucune ligne de `src/sim/` modifiée, rejeu du service et parties normales strictement identiques, `BALANCE_VERSION` 4 inchangée).
- Obstacles, avertissements, animations, ambiance et réactions musicales fonctionnent normalement. Aucun pouvoir ni charge de bonus n'est utilisé (« Sans bonus » forcé).
- Badge permanent **« TEST »** dans le HUD (`#hud-test`) pendant toute la partie, et mention « TEST » sur l'écran de préparation.

## Ce qu'une partie de test ne fait JAMAIS
Le réglage est relu **au départ de chaque partie** et figé dans `RunConfig.test` : une partie lancée avec le mode actif reste une partie de test jusqu'à sa fin, même si le mode est désactivé ensuite (on ne peut pas ouvrir les options pendant une partie ; « Recommencer » relit le réglage).
- aucune statistique, aucun record, aucun gain d'Éclats (collecte sur l'orbite, prime de phase), aucun succès, aucun cosmétique (apparence « Faille » comprise) : `applyRun` rend un rapport vide si `RunSummary.test`, et `app.ts` ne crédite rien (`s.config.test`) ;
- aucun classement et aucun envoi au service : pas de ticket consommé (il reste pour la prochaine partie normale), pas de départ enregistré, pas de reprise payante, jamais de `recordRun` ;
- la fin d'une partie de test ramène à l'accueil sans écran de résultat ; le compteur d'Éclats du HUD reste masqué ; aucun « Nouveau record ! ».

## Fenêtre de contrôle (bouton « DEV »)
Bouton discret en bas à gauche, **visible seulement quand le mode est activé** ; ouvre une fenêtre à trois onglets (`src/dev/devTools.ts`, aucune logique de jeu : tout passe par `GameSession` et `App`) :
- **Partie** : FPS, phase, temps actif, vitesse, immortalité ; immortalité on/off ; pause/reprise du temps ; +0,1 / +1 / +10 / +30 s ; vitesse ×0,25 à ×4 ; aller à 4:30, juste avant la traversée ou en phase 2 (les pas sont rejoués sans rendu ni son ; si la cible est dans le passé, une nouvelle partie de test repart) ; déclencher un obstacle (`injectPattern`), un éclair, une vague d'énergie, un anneau, des filaments ; intensité visuelle ; qualité (auto/haute/moyenne/basse, jamais enregistrée) ; relancer une partie de test. La musique n'est pas recalée par les sauts.
- **Classement** : diagnostic en lecture seule (service configuré / à jour, connexion, profil, tickets, parties en attente, validées/refusées, dernier motif de refus, dernière erreur réseau), test de connexion, renvoi des résultats en attente.
- **Remise à zéro** : voir ci-dessous.
Chaque commande de partie appelle `GameSession.markTest()` : la partie est de test pour toujours (`session.isTest`), même si le mode est désactivé ensuite ; les contrôles sont refusés sur une partie normale. Les sauts, aperçus et effets ne produisent aucune progression réelle (`applyRun` n'enregistre rien, aucun gain n'est crédité).

## Remise à zéro (jamais pendant le développement ni les vérifications automatiques)
Sélection de la portée, portée affichée, puis confirmation écrite **« REMETTRE À ZÉRO »** (bouton inactif sinon) :
- **Records locaux** : meilleurs temps/scores de Survie (Sans bonus, Avec bonus) et du Défi quotidien de CET appareil. Une copie est écrite avant (`polarite.sauvegarde-records.<date>`, 3 copies conservées ; stockage refusé = rien n'est effacé). Profil, monnaies, achats, cosmétiques, succès, statistiques, niveaux, campagne, options et archives des anciennes versions sont préservés.
- **Classement mondial** (Sans bonus, Avec bonus, Défi quotidien) : exige une **autorisation administrateur dédiée vérifiée par le service** (`ADMIN_RESET_SECRET`, route `POST /api/admin/reset-board`). Le mot de passe développeur du navigateur ne suffit pas ; l'autorisation est saisie à l'instant, envoyée en HTTPS, jamais stockée, jamais dans le jeu ni dans le dépôt. Le service écrit une copie de sa base avant d'effacer, journalise l'opération et ne touche ni aux profils, ni au registre des monnaies, ni aux achats, ni aux cosmétiques (voir `docs/GUIDE_DEPLOIEMENT.md` § 7 bis et `server/boards.ts`).

## Classements affichés
Le menu Classement n'affiche que la **version actuelle** (plus de sélecteur de version ni d'accès aux anciens classements dans l'interface ; leurs données restent archivées dans le service). Catégories : Survie Sans bonus, Avec bonus, Défi quotidien — chacune montre son classement actuel. **Les mises à jour futures conservent les records par défaut** : aucun changement de `BALANCE_VERSION` ni remise à zéro automatique sans accord explicite.

## Mot de passe
- Verrou d'accès à l'**interface** uniquement : sans lien avec les secrets du service, jamais envoyé nulle part. Mot de passe d'origine fourni par l'éditeur (stocké seulement sous forme de condensat SHA-256 salé : `DEFAULT_DEV_LOCK`).
- **Configurable** depuis l'écran des options quand le mode est actif (mot de passe actuel + nouveau, 8 à 64 caractères) ; le nouveau verrou est un condensat salé aléatoire (`options.dev.lock`).
- **Désactivation immédiate**, sans mot de passe, depuis le même écran ; l'activation exige le mot de passe. Après 5 échecs d'affilée : attente de 30 s (qui double ensuite).
- Sauvegarde : `options.dev = { enabled, lock }` (`save.ts`, validation champ par champ ; verrou illisible = mot de passe d'origine ; format de sauvegarde inchangé).

## Fichiers
`src/dev/devMode.ts` (verrou, validation, limitation d'essais), `src/dev/sha256.ts`, `src/modes/run.ts` (`test`), `src/game/session.ts` (`summary().test`), `src/progression/progress.ts` (`applyRun`), `src/app.ts` (garde-fous, formulaires), `src/ui/screens.ts` (`devModeSection`), `src/ui/hud.ts` + `src/styles/hud.css` (badge), `tests/devmode.test.ts`.
