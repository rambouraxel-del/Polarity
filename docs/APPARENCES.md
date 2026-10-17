# Apparences du vaisseau (cosmétiques)

Purement esthétiques : aucune statistique, aucun effet sur la difficulté, les vitesses ou les performances. **Même hitbox pour toutes** (`config/hitbox.ts`).
Refonte « planche 01 » : les anciens skins ont été supprimés ; le catalogue contient dix vaisseaux (PNG 256 × 256 dans `src/assets/skins/`).

## Où est tout ?
| Fichier | Rôle |
|---|---|
| `src/config/skins.ts` | **Configuration unique** (`SKIN_CONFIG`) : id stable, nom, chemin de l'image, prestige, méthode d'obtention, prix Médailles / Éclats / Prismes, disponibilité, ordre. Couleurs d'effets communes (`SHIP_FX_COLORS`), `DEFAULT_SKIN_ID`, `CAMPAIGN_SKIN` |
| `src/config/catalog.ts` | Articles de la boutique, **déduits** de `SKIN_CONFIG` (ne pas y recopier les prix) |
| `src/progression/skins.ts` | `skinById`, `resolveEquipped`, repli sur `tole-brute` |
| `src/render/skinImages.ts` · `shipTextures.ts` · `skinSprites.ts` | URL des PNG (Vite), chargement et canevas des aperçus de menus |
| `src/ui/shipPreview.ts` | grand aperçu animé du garage |

## Les dix apparences (économie PROVISOIRE : `SKIN_ECONOMY_PROVISIONAL`)
| Ordre | Id (stable) | Nom | Prestige | Obtention | Prix |
|---|---|---|---|---|---|
| 1 | `tole-brute` | Tôle brute | 0 | gratuit, équipé d'emblée, repli de tout id inconnu | — |
| 2 | `chantier-orbital` | Chantier orbital | 1 | Médailles seulement | 100 Médailles |
| 3 | `carbone-utilitaire` | Carbone utilitaire | 1 | Médailles seulement | 150 Médailles |
| 4 | `dipole` | Dipôle | 1 | Médailles seulement | 200 Médailles |
| 5 | `circuit` | Circuit | 1 | Médailles seulement | 250 Médailles |
| 6 | `cartographe` | Cartographe | 1 | Médailles seulement | 300 Médailles |
| 7 | `long-courrier` | Long-courrier | 1 | au choix : Éclats OU Prismes | 1 500 Éclats / 60 Prismes |
| 8 | `basalte` | Basalte | 1 | au choix : Éclats OU Prismes | 2 000 Éclats / 80 Prismes |
| 9 | `arcade-84` | Arcade 84 | 1 | au choix : Éclats OU Prismes | 3 000 Éclats / 120 Prismes |
| 10 | `porcelaine` | Porcelaine | 2 | indisponible (« Indisponible pour l'instant ») | — |

Les Prismes sont la monnaie interne premium : **aucun achat en argent réel** dans la boutique de cosmétiques. Pour changer une valeur (ou rendre un skin disponible) : modifier `SKIN_CONFIG`, rien d'autre.

## Trois situations d'obtention
- **Médailles seulement** (`acquisition: 'medals'`) : `Acquire` `price` en Médailles (jamais achetées : gagnées par les succès).
- **Éclats OU Prismes** (`'shards_or_prisms'`) : `Acquire` `choice`. Deux boutons dans le garage. Éclats : achat local (déjà synchronisé par `checkPurchase`, prix du catalogue) ; Prismes : requête au service (`POST /api/shop/prisms`, débit atomique idempotent, jamais local).
- **Indisponible** (`'unavailable'` ou `available: false`) : jamais proposé ; un skin déjà possédé reste équipable.

## Repli et sauvegardes
Identifiant inconnu (ancien skin supprimé, valeur corrompue) ou non possédé → `tole-brute`, sans erreur : à la lecture (`sanitize` dans `save/save.ts`) et à l'équipement (`resolveEquipped`). Une sauvegarde neuve équipe `tole-brute`.
Les anciens identifiants dans `owned` sont ignorés (inconnus du catalogue).
**Remboursement** : les Médailles dépensées pour les anciens vaisseaux en Médailles (`REMOVED_MEDAL_SKINS`) sont rendues, une seule fois — par le registre du service (ligne `refund:<id>` pour chaque `spend:<id>`, à la première synchronisation) ou, sans service, localement depuis `economy.purchases` (`refundRemovedSkins`). Un ancien skin obtenu par un succès (sans dépense) ne donne rien ; l'ancien Néon (Prismes) n'est pas remboursé.

**Service pas à jour** : si le service refuse un article comme « inconnu » (ancien catalogue), l'achat est annulé à la synchronisation ; le jeu affiche alors « Service pas à jour » et bloque l'achat de cet article (état `stale`, `net/serviceState.ts`) au lieu de le laisser se rejouer sans débit.

## Gabarit, hitbox, Orbit
- Les PNG : 256 × 256, vaisseau centré, nez en haut, silhouette ≈ 240 px (même rapport 120/128 que l'ancien sprite : `VISUAL.spriteContent / spriteCanvas`). Taille visuelle : `VISUAL.shipScale` (×1,25 depuis la refonte).
- La **hitbox est un cercle commun** (`HITBOX.playerScale = 1,15` en plus de l'agrandissement `growth`), **jamais déduite des PNG** (ni de leurs dimensions, ni de leurs zones transparentes).
- L'**Orbit ne dépend d'aucune apparence** : voir `config/orbit.ts` (apparence par phase de la partie).
- Les lueurs de tuyères et témoins de polarité (cyan à gauche, magenta à droite) sont dans les PNG ; la flamme et les étincelles dessinées par code restent à l'opposé du déplacement (décoratives).
- La Traverse (campagne, `CAMPAIGN_SKIN`) reste hors catalogue : sprite de base recoloré (`render/shipPalette.ts`).

## Ajouter une apparence
Copier le PNG (256 × 256) dans `src/assets/skins/`, ajouter une entrée à `SKIN_CONFIG` (id unique et définitif). `npm test` vérifie : ids uniques, fichiers présents et au bon format, un seul skin par défaut gratuit, aucun paramètre de gameplay, catalogue déduit de la configuration.

## Traînées (catégorie fermée)
`TRAILS_ENABLED = false` (`config/trails.ts`) : l'onglet Traînées reste visible mais affiche « Indisponible pour l'instant » ; achat, équipement et aperçu sont désactivés, la traînée affichée est toujours la traînée par défaut. Les données (définitions, prix d'origine, traînées déjà possédées) sont conservées : passer la valeur à `true` rouvre la catégorie.
