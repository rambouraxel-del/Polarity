# Apparences du vaisseau (cosmétiques)

Purement esthétiques : aucune statistique, aucun effet sur la difficulté, les vitesses ou les hitboxes. Pas de boutique ni de monnaie.

## Où sont-elles définies ?
`src/config/skins.ts` (données) ; `src/progression/skins.ts` (déblocage, repli) ; `src/render/shipPalette.ts` (recoloration, fonction pure testée) ;
`src/render/shipTextures.ts` (textures Phaser) ; `src/render/skinSprites.ts` (canevas et miniatures pour les menus) ; `src/ui/shipPreview.ts` (grand aperçu).

## Ajouter une apparence
Ajouter une entrée à `SKINS` dans `src/config/skins.ts` :

```ts
{
  id: 'nebuleuse',            // identifiant stable : enregistré dans la sauvegarde, ne jamais le changer ni le réutiliser
  name: 'Nébuleuse',
  asset: 'classic',           // modèle de vaisseau (clé de SHIP_MODELS)
  unlock: { type: 'achievement', id: 'cycles_100' },   // ou { type: 'default' }
  colors: {
    hull: 0xf4f0ff,           // coque (fuselage)
    wings: 0xb79bff,          // extrémité des ailes
    cockpit: 0xffffff,        // verrière et liserés lumineux
    thruster: { core: 0xf2f6ff, glow: 0x7dd0ff },      // réacteur (flamme, halo, étincelles)
    orbit: 0xb79bff, beacon: 0xffd84a, trail: 0xe0d4ff,
  },
}
```

`npm test` vérifie automatiquement : identifiant unique, succès existant, aucun champ de gameplay, couleurs coque/ailes/cockpit distinctes des autres apparences,
et **réacteur à plus de 30° de teinte des dangers** (corail 0°, orange des astéroïdes 22°, magenta des secteurs 303° ; blancs et gris acceptés).

## Modèle et gabarit
Toutes les apparences dérivent du même sprite (`src/assets/sprites/ship.png`, 128 × 128, nez en haut) : même silhouette, même taille d'affichage, **même hitbox** (`config/hitbox.ts`).
Les textures `ship-<id>` sont générées au démarrage par recoloration : cockpit (pixels bleu/cyan, y compris les liserés des ailes), coque et ailes (pixels clairs, fondu selon la distance à l'axe), métal sombre conservé.
Pour un nouveau modèle (forme différente) : ajouter une entrée à `SHIP_MODELS`, charger sa texture dans `render/GameScene.ts`, en gardant le même gabarit (128 px, dessin de 120 px) et en vérifiant que la hitbox reste en retrait de la silhouette.

## Repli sur le modèle classique
- identifiant inconnu (apparence retirée dans une version ultérieure) ou verrouillée → `classique`, y compris dans la sauvegarde chargée (`resolveEquipped`) ;
- texture ou modèle indisponible → sprite de base (`shipTextureFor`).

## Menu Apparences
Grand aperçu (canevas 2D : rotation lente, réacteur animé par code ; fixe avec « Effets réduits » ou `prefers-reduced-motion`), grille de cartes (miniature, nom, état *Équipé / Disponible / Verrouillé*).
Toucher une carte affiche son aperçu **sans l'équiper** ; le bouton « Équiper » applique une apparence disponible. Une apparence verrouillée affiche sa condition précise
(nom et description du succès) et un bouton inactif. L'apparence équipée est enregistrée (`skin` dans la sauvegarde) et utilisée en Niveaux, Survie et défi quotidien.
