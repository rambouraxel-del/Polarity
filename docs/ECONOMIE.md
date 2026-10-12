# Économie : Éclats, Prismes, boutique

Deux monnaies, **uniquement cosmétiques** : mêmes vitesses, mêmes hitboxes et même difficulté dans tous les modes. Réglages dans `src/config/economy.ts`,
catalogue et conditions d'obtention dans `src/config/catalog.ts` (+ `skins.ts`, `trails.ts`).

## Éclats (gagnés en jouant)
- **Sur l'orbite (Survie seulement)** : un éclat apparaît à un emplacement aléatoire, disponible **5 s** ; un seul à la fois ; prochaine apparition **15 à 25 s** après sa collecte ou sa disparition
  (première apparition : 15 à 25 s). Gain : **5 Éclats** (`SHARDS.reward`), jamais multiplié par le score ni le combo. Pas d'éclat en Niveaux ni au défi quotidien (`SHARDS.modes`).
- **Générateur dédié** (dérivé de la graine) : les vagues, les événements et la difficulté ne changent pas (testé : mêmes vagues avec ou sans éclats). Reproductible.
- **Accessibilité** : emplacement tiré au hasard mais jamais à moins de 0,6 rad du vaisseau, jamais sur une balise active (0,3 rad), et **atteignable avec la vitesse réelle** du vaisseau
  (`shardReachable` : direction actuelle, ou inversion avec 1 s de marge de réaction). Cela ne garantit pas une collecte sans risque.
- **Temps de jeu actif** : apparition, expiration et animation suivent le temps de simulation ; la pause les suspend.
- **Crédit unique et immédiat** : chaque éclat a un identifiant ; le gain est ajouté et sauvegardé à la collecte. Les Éclats restent acquis à la mort.
- **Lisibilité** : sprite (PNG fourni) au-dessus du rail, disque sombre local, halo violet discret, cœur blanc, anneau qui se vide et pulsation de plus en plus rapide
  (anneau conservé et pulsation coupée en « Effets réduits »). Forme et taille distinctes des six balises (losanges dorés).

## Récompenses de niveau
50 Éclats à la **première réussite**, **15 par étoile** obtenue pour la première fois, **10** par réussite suivante (`LEVEL_REWARDS`). Le registre `paid` de la sauvegarde empêche tout second versement.
Le détail (origine, total, nouveau solde) est affiché au résultat ; l'écran ne crédite rien (le crédit a lieu une fois, à la fin de la partie).

## Prismes (premium)
Solde séparé, **0 au départ**, jamais collecté sur l'orbite. Les articles en Prismes sont affichés « **Bientôt disponible** » : aucun bouton de paiement actif, aucun crédit automatique, aucun débit local
(`purchase()` renvoie `unavailable`). Interface future : `src/monetization/payments.ts` (`PaymentProvider`, `NullPaymentProvider` par défaut). Règles pour une intégration réelle :
- seuls des justificatifs **validés côté serveur ou fournisseur** créditent des Prismes ; la sauvegarde locale est modifiable par le joueur et **ne protège pas** une monnaie payante ;
- chaque transaction a un `transactionId` unique ; le serveur refuse tout crédit répété (idempotence) et renvoie le solde de référence ;
- le client n'affiche « Acheter » pour un article premium que si le fournisseur est disponible.

## Boutique
Onglets **Vaisseaux / Traînées / Packs**. Chaque article : aperçu animé, contenu, prix et monnaie. États : **Acheter**, **Solde insuffisant**, **Succès requis**, **Bientôt disponible** (premium),
**Possédé** / **Équiper** / **Équipé**. Achat en Éclats : confirmation → vérification du solde → débit **et** déblocage dans la même modification (une seule écriture) ; un article possédé n'est jamais débité deux fois.
Prix de départ : 100 (Aurore), 200, 350, 600 (vaisseaux) ; 150, 250, 400 (traînées) ; packs à prix réduit — tous ajustables dans `catalog.ts`. Exclusivités de succès conservées : Glace, Solaire, Prisme.

## Sauvegarde (format 3)
`wallet {shards, prisms}`, `owned` (cosmétiques possédés), `trail` (traînée équipée), `paid` (récompenses de niveau déjà versées). Migration depuis 1 et 2 : soldes à 0 ; cosmétiques déjà obtenus conservés
(succès d'origine + apparence équipée) ; récompenses historiques marquées comme **déjà versées** (aucun crédit rétroactif) ; copie de l'ancienne sauvegarde dans `polarite.save.avant-v<version>`.

## Évolutions préparées (non implémentées)
Améliorations de campagne payées en Éclats : le solde, le registre d'achats et le catalogue sont prêts ; aucune campagne ni amélioration n'existe dans cette version.
