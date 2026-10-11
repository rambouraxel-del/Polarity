# Reprise

**Dernière étape vérifiée :** livraison complète. `npm run check` (64 tests) et `npm run e2e` (33 contrôles) verts.

**Fichiers clés :** `src/app.ts` (orchestration), `src/sim/*` (gameplay), `src/config/balance.ts` et `src/config/levels.ts`
(équilibrage), `src/ui/screens.ts` (écrans), `scripts/e2e.mjs` (test navigateur), `scripts/balance.ts` (bots).

**Prochaine action :** recueillir les retours de joueurs, ajuster `src/config/*`, relancer `npm run sim` pour
recalibrer les étoiles, puis `npm run check && npm run build && npm run e2e`.
