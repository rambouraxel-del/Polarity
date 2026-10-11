# Reprise

**Dernière étape vérifiée :** v1.1 complète (sprites « Néon premium », effets codés, Survie accélérée, hitboxes séparées, sauvegarde v2).
`npm run check` (97 tests) et `npm run e2e` verts. Branche de sauvegarde de la v1.0 : `sauvegarde-v1.0.0`.

**Fichiers clés :** `src/render/ArenaRenderer.ts`, `src/render/geometry.ts`, `src/config/{survival,hitbox,visuals,version}.ts`,
`src/modes/profiles.ts`, `src/sim/director.ts`, `src/save/save.ts`, `tests/{hitbox,survival-tuning,progress}.test.ts`, `docs/ASSETS.md`.

**Prochaine action :** recueillir les retours de joueurs sur la nouvelle courbe (trop rapide ? trop lente ?) et sur la lisibilité mobile,
ajuster `src/config/survival.ts` / `hitbox.ts` (incrémenter `BALANCE_VERSION` si les règles changent), puis
`npm run check && npm run build && npm run e2e`.
