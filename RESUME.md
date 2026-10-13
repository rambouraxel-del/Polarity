# Reprise

**Ajustements campagne (niveaux 1 à 5) :** durées de 90 à 300 s (≈ 95 → 240 s), objectifs et compteurs revus (84 / 114 éclats, survie 150 s, 6 fragments, approche 100 éclats puis 5 passages), scènes centrées en un bloc compact. Vérifié seulement par compilation, types et tests unitaires ciblés (pas d'e2e relancé : `scripts/e2e.mjs` a été mis à jour pour les nouveaux textes mais **non rejoué**). Détail : `docs/CAMPAGNE.md`.

**Dernière étape (musique) :** intro → boucle → outro (3 MP3, 2,71 Mo) intégrés sur `main` (`src/audio/music.ts`, `docs/MUSIQUE.md`) ; raccords programmés sur l'horloge Web Audio, vérifiés par tests et rendus hors ligne. **Reste : écoute sur Safari iPhone.**

**Dernière étape (campagne « Douze ans de silence », niveaux 1 à 5) — branche `campagne-douze-ans` (non fusionnée dans `main`) :** récit illustré (illustration au-dessus, dialogue au-dessous, portrait, texte progressif, révéler/avancer, passer, relire), 5 niveaux d'astéroïdes, étoiles, **Éclats de campagne séparés** du portefeuille, vaisseau « Traverse », sauvegarde **format 6** (migration v5 → v6), « Suite du chapitre à venir ». **`src/sim/` non modifié, `BALANCE_VERSION` inchangée, Survie et classement intacts.** Hangar/améliorations : logique conservée, **non proposés** (`HANGAR_ENABLED = false`). `main` porte encore la première campagne « Écho-7 » (10 missions), remplacée sur la branche. Fichiers clés : `src/data/campagne_niveaux_01_05.fr.json`, `src/config/{story,campaign}.ts`, `src/campaign/*`, `src/ui/campaignScreens.ts`, `src/assets/story/`, `art/campagne/`, `docs/CAMPAGNE.md`, `tests/{story,campaign-*}.test.ts`, section « Campagne » de `scripts/e2e.mjs`. **Reste :** validation d'équilibrage et de lisibilité par de vrais joueurs ; décision de fusion sur `main` ; niveaux 6 à 15 (voir `docs/CAMPAGNE.md`, « Ajouter les niveaux suivants »).

**Dernière étape (v1.6) :** menu Cosmétiques (fusion), 27 succès récompensés (sauvegarde format 4), classement mondial de Survie **intégré mais non déployé** : service `server/` (Node 22 + SQLite, rejeu des parties), client `src/net/`, menu Classement. Reste à faire : héberger le service et renseigner `LEADERBOARD_URL` (voir `docs/CLASSEMENT.md`). Fichiers clés : `src/config/achievements.ts`, `src/progression/achievements.ts`, `src/net/{protocol,leaderboard}.ts`, `server/*`, `tests/{leaderboard-server,leaderboard-client,economy}.test.ts`, `scripts/e2e-classement.mjs`.

**Dernière étape (v1.5) :** économie à deux monnaies (Éclats gagnés en jouant, Prismes premium non achetables), éclat sur l'orbite en Survie, récompenses de niveau, boutique cosmétique, sauvegarde format 3. Voir `docs/ECONOMIE.md` ; fichiers clés : `src/config/{economy,catalog,trails}.ts`, `src/sim/shards.ts`, `src/progression/shop.ts`, `src/monetization/payments.ts`, `tests/economy.test.ts`.

**Dernière étape (v1.4) :** vaisseau +20 %, orbite cyan vif, menu Apparences refait, apparences en configuration extensible (`src/config/skins.ts`, `docs/APPARENCES.md`). Gameplay et équilibrage inchangés.

**Dernière étape (v1.3, interface) :** refonte artistique « Néon premium », nom affiché **Polar Rift** (ex-Polarity). Voir `docs/INTERFACE.md`. Fichiers clés : `src/config/brand.ts`,
`src/ui/{theme,components,icons,screens,space}.ts`, `src/styles/*.css`, `src/assets/ui/logo.webp`, `tests/ui.test.ts`. Règles : couleurs uniquement via le thème ;
`STORAGE_NAMESPACE` ('polarite') ne change jamais. Gameplay et équilibrage inchangés (v1.2 ci-dessous).

**Dernière étape vérifiée :** v1.2 complète (vitesse progressive du vaisseau, astéroïde fragmenté, convoi, laser balayeur, événements, équilibrage adapté à la vitesse,
version d'équilibrage 3). `npm run check` (218 tests) et `npm run e2e` verts. Branches de sauvegarde : `sauvegarde-v1.0.0`, `sauvegarde-v1.1.1`.

**Fichiers clés :** `src/config/{playerSpeed,hazards,events,survival,version}.ts`, `src/sim/{director,safety,speed,hazards,collision,patterns}.ts`,
`src/render/ArenaRenderer.ts` (fragments, laser), `src/app.ts` (bandeau d'événement), `src/save/save.ts` (archive des records),
`tests/{speed,hazards-new,events,progress}.test.ts`, `docs/EQUILIBRAGE.md`, `docs/ROADMAP.md`.

**Prochaine action :** essais avec de vrais joueurs (début de partie à 40 % de vitesse, montée jusqu'à 100 % à 6 min, lisibilité des lasers/fragments sur mobile),
ajuster `src/config/playerSpeed.ts` (courbe, `PACE`), `hazards.ts`, `events.ts` ; incrémenter `BALANCE_VERSION` si les règles changent ; puis
`npm run check && npm run build && npm run e2e`. Idées reportées (ne pas implémenter sans demande) : balise bonus temporaire, secteurs thématiques des niveaux.
