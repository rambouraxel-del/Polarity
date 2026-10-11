# Assets graphiques — style « Néon premium »

## Contenu
| Fichier (src/assets/sprites) | Rôle |
|---|---|
| `ship.png` | Vaisseau vu de dessus, **nez vers le haut** : coque blanche/argent, cockpit cyan |
| `ast1.png` … `ast4.png` | 4 astéroïdes rocheux sombres aux fissures orange (projectiles) |

Chaque texture fait **128 × 128 px**, fond transparent, dessin centré dont la plus grande dimension occupe 120 px
(puissance de deux : mipmaps activés dans `main.ts`, pour éviter le scintillement quand le sprite est réduit à 20–50 px).

**Aucun effet n'est intégré aux sprites** : ni flamme de réacteur, ni halo, ni traînée, ni particule. Ces effets sont
générés et animés par code (`src/render/ArenaRenderer.ts`, paramètres dans `src/config/visuals.ts`, section `FX`) :
- flamme du vaisseau, étincelles, traînée courte : toujours **à l'opposé du déplacement** (`src/render/geometry.ts`, testé) ;
  l'inversion retourne instantanément le sprite, la flamme et efface l'ancienne traînée ;
- traînée et braises des astéroïdes, lueur orangée légère ;
- impact bref au point de contact (éclair, deux ondes de choc, éclats) ; en « effets réduits » : sans secousse ni flash, éclats réduits.

## Origine
Sprites **créés pour le projet** (pas découpés ni extraits de la planche de référence « Néon premium », utilisée comme
simple inspiration de style). Générés avec l'API d'images d'OpenAI (modèle `gpt-image-1.5`, fond transparent, 1024 × 1024),
à partir de descriptions textuelles uniquement (aucune image de référence envoyée), puis recadrés et réduits.
Les droits d'usage relèvent des conditions du fournisseur : à vérifier avant toute commercialisation.

Palette : fond nuit `#081426`, cyan `#00E5FF`, blanc `#EAF6FF`, corail `#FF5B5B`, or `#FFD751`.

### Descriptions utilisées
- **Vaisseau** : « sleek spaceship seen from directly above, pointing straight up, perfectly symmetric, white and brushed-silver hull,
  swept-back angular wings, glossy cyan-blue glass cockpit, thin cyan accent lines, dark gunmetal engine housings with the engines
  switched OFF… absolutely no engine flame, no exhaust glow, no light trail, no particles, no motion blur, no halo, no cast shadow, no text, no background. »
- **Astéroïdes** : « a single space asteroid seen from above, roughly round irregular faceted silhouette, dark charcoal and slate-grey
  mineral rock, angular plates, small craters, glowing molten-orange cracks (light from inside the cracks)… no motion trail,
  no flame, no tail, no particles, no halo, no cast shadow, no text, no background », avec quatre variantes de forme
  (grand cratère, ovale à fissure diagonale, éclat anguleux, deux blocs soudés).

## Régénérer / modifier
1. Les sources recadrées (512 px, fond transparent) sont dans `art/source/`.
2. `npm run sprites` (Python + Pillow) recrée les textures 128 px dans `src/assets/sprites/`.
3. Si la forme ou les proportions changent, adapter `VISUAL` dans `src/config/visuals.ts`
   (`shipWidthRatio`, `asteroidMinExtent`) : les tests vérifient que les hitboxes restent en retrait des silhouettes.

## Tailles à l'écran (unités monde, orbite = 300)
Visuels agrandis de **15 %** par rapport à la v1.0 (`VISUAL.scale`) : vaisseau 25,3 de long (22 avant), astéroïdes 23 de diamètre (20 avant).
Les balises ne changent pas. Les hitboxes se règlent **séparément** (`src/config/hitbox.ts`).
Astuce : ouvrez le jeu avec `?debug` pour afficher hitboxes (traits pleins) et silhouettes (traits fins).
