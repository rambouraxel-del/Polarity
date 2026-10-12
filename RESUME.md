# Reprise

**Dernière étape (v1.4) :** vaisseau +20 %, orbite cyan vif, menu Apparences refait, apparences en configuration extensible (`src/config/skins.ts`, `docs/APPARENCES.md`). Gameplay et équilibrage inchangés.

**Dernière étape (v1.3, interface) :** refonte artistique « Néon premium », nom affiché **Polarity**. Voir `docs/INTERFACE.md`. Fichiers clés : `src/config/brand.ts`,
`src/ui/{theme,components,icons,screens,space}.ts`, `src/styles/*.css`, `src/assets/ui/logo.png`, `tests/ui.test.ts`. Règles : couleurs uniquement via le thème ;
`STORAGE_NAMESPACE` ('polarite') ne change jamais. Gameplay et équilibrage inchangés (v1.2 ci-dessous).

**Dernière étape vérifiée :** v1.2 complète (vitesse progressive du vaisseau, astéroïde fragmenté, convoi, laser balayeur, événements, équilibrage adapté à la vitesse,
version d'équilibrage 3). `npm run check` (179 tests) et `npm run e2e` verts. Branches de sauvegarde : `sauvegarde-v1.0.0`, `sauvegarde-v1.1.1`.

**Fichiers clés :** `src/config/{playerSpeed,hazards,events,survival,version}.ts`, `src/sim/{director,safety,speed,hazards,collision,patterns}.ts`,
`src/render/ArenaRenderer.ts` (fragments, laser), `src/app.ts` (bandeau d'événement), `src/save/save.ts` (archive des records),
`tests/{speed,hazards-new,events,progress}.test.ts`, `docs/EQUILIBRAGE.md`, `docs/ROADMAP.md`.

**Prochaine action :** essais avec de vrais joueurs (début de partie à 40 % de vitesse, montée jusqu'à 100 % à 6 min, lisibilité des lasers/fragments sur mobile),
ajuster `src/config/playerSpeed.ts` (courbe, `PACE`), `hazards.ts`, `events.ts` ; incrémenter `BALANCE_VERSION` si les règles changent ; puis
`npm run check && npm run build && npm run e2e`. Idées reportées (ne pas implémenter sans demande) : balise bonus temporaire, secteurs thématiques des niveaux.
