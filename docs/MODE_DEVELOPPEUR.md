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

## Mot de passe
- Verrou d'accès à l'**interface** uniquement : sans lien avec les secrets du service, jamais envoyé nulle part. Mot de passe d'origine fourni par l'éditeur (stocké seulement sous forme de condensat SHA-256 salé : `DEFAULT_DEV_LOCK`).
- **Configurable** depuis l'écran des options quand le mode est actif (mot de passe actuel + nouveau, 8 à 64 caractères) ; le nouveau verrou est un condensat salé aléatoire (`options.dev.lock`).
- **Désactivation immédiate**, sans mot de passe, depuis le même écran ; l'activation exige le mot de passe. Après 5 échecs d'affilée : attente de 30 s (qui double ensuite).
- Sauvegarde : `options.dev = { enabled, lock }` (`save.ts`, validation champ par champ ; verrou illisible = mot de passe d'origine ; format de sauvegarde inchangé).

## Fichiers
`src/dev/devMode.ts` (verrou, validation, limitation d'essais), `src/dev/sha256.ts`, `src/modes/run.ts` (`test`), `src/game/session.ts` (`summary().test`), `src/progression/progress.ts` (`applyRun`), `src/app.ts` (garde-fous, formulaires), `src/ui/screens.ts` (`devModeSection`), `src/ui/hud.ts` + `src/styles/hud.css` (badge), `tests/devmode.test.ts`.
