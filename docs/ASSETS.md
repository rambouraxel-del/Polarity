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
- traînée et braises des astéroïdes, contour lumineux orange (silhouette teintée en additif) ;
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
`src/config/visuals.ts` : v1.0 → v1.1 (+15 %) → **v1.1.x lisibilité** (vaisseau ×1,45, astéroïdes ×1,35 par rapport à la v1.1).

| | v1.0 | v1.1 | actuel |
|---|---|---|---|
| Vaisseau (longueur) | 22 | 25,3 | **36,7** (largeur 30,3) |
| Astéroïde (diamètre) | 20 | 23 | **31,1** |

Les balises ne changent pas. Les **hitboxes ne changent pas** (7,46 vaisseau, 8,52 projectile, `src/config/hitbox.ts`) : elles sont maintenant
nettement plus petites que les silhouettes (≈ ½ de la demi-largeur du vaisseau, ≈ ¾ de la plus petite demi-dimension d'un astéroïde),
ce qui rend les collisions plus indulgentes à l'œil. Réglage séparé : on peut les réajuster sans toucher aux visuels.
Astuce : ouvrez le jeu avec `?debug` pour afficher hitboxes (traits pleins) et silhouettes (traits fins).

### Épaisseur des effets (longueurs inchangées)
- Flamme du vaisseau : longueur 14 (inchangée), largeur 5 → 6,5.
- Traînée d'astéroïde : longueur 52 (inchangée), trois couches de largeur 1,0 / 0,68 / 0,36 × le rayon (v1.1 : 0,95 / 0,6 / 0,28),
  donc plus épaisses en valeur absolue puisque le rayon a grandi de 35 %.
- Contour lumineux orange des astéroïdes : silhouette remplie d'orange, légèrement agrandie (×1,16), en additif derrière le sprite
  (`FX.asteroidGlow`), plus un halo diffus. Purement décoratif, sans collision.

## Interface
Logo, thème, police Orbitron (OFL), fond spatial : voir `docs/INTERFACE.md`. Le logo `src/assets/ui/logo.png` est le PNG transparent fourni pour le projet (utilisé tel quel).

## Vaisseau en partie (v1.4)
- Taille : +20 % par rapport à la v1.1.x (`VISUAL.shipScale = 1,45 × 1,2`) ; hitbox inchangée (`config/hitbox.ts`).
- Coque plus blanche, cockpit cyan plus vif (recoloration, `src/render/shipPalette.ts`), lueur discrète de la couleur du cockpit (`FX.shipGlow`) et liseré sombre qui détache le vaisseau de l'orbite (`FX.shipRim`).
- Astéroïdes : taille inchangée, contour orange renforcé (`FX.asteroidGlow.alpha` 0,45 → 0,6).
- Orbite : cyan vif `#00E5FF` (trait plein épais + halo en dégradé, texture générée par code).
- Une texture par apparence : voir `docs/APPARENCES.md`.

## Campagne : scènes illustrées et portraits
Masters PNG dans `art/campagne/` (hors bundle ; `ASSETS.json` = manifeste d'origine). Versions du jeu en WebP dans `src/assets/story/` (mêmes noms, extension `.webp`), chargées à l'affichage de la scène uniquement.
Illustrations : 1200 px de large, qualité 86 (146–286 Ko) ; portraits : 384 px avec alpha (42–46 Ko). Voir `docs/CAMPAGNE.md` pour le mapping et la procédure.
