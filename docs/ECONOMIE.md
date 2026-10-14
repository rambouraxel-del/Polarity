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

## Succès récompensés (v1.6)
27 succès dans `src/config/achievements.ts` (découverte, Survie, niveaux, collectes, maîtrise) : durées de survie (1, 2, 3, 5, 8, 10 min), cycles (1, 10, 100, 500), événements traversés (1, 10, 30), étoiles (3★, 18, 36), niveaux (1, 3, 6, 12), Éclats collectés au total (50, 250, 1 000), multiplicateur maximal, score 100 000.
Aucun objectif ne demande de dépenser (« Éclats collectés » = gains cumulés, pas le solde). Chaque succès verse ses Éclats **une seule fois** au déblocage (registre `rewarded`), avec notification au résultat, sauvegarde immédiate.
Cosmétiques liés (catalogue) : Glace (Pleine charge), Solaire (Endurance), Prisme (Maître de l'orbite), traînées Citron (Chasseur d'éclats) et Boréale (Maître des éléments).
**Migration (format 4)** : les succès déjà obtenus sont récompensés une seule fois (Éclats ajoutés au solde, notification à l'accueil) ; les nouveaux objectifs déjà atteints grâce à la progression existante se débloquent au démarrage (`reconcileAchievements`).

## Consolidation V1 (fiabilité, libellés, propositions)
**Corrigé (fiabilité) :**
- **Packs partiellement possédés** : le prix est **au prorata** de ce qu'il reste à obtenir, avec la même remise que le pack complet (`effectivePrice`, `progression/shop.ts`). Exemple : Aurore (100) déjà possédée → Pack Aurore 220 × 150 / 250 = **132** (au lieu de 220 pour recevoir une traînée à 150). Le prix affiché, l'état « Solde insuffisant » et le débit utilisent la même fonction.
- **Succès** : déblocage et versement dans la même modification ; le registre `rewarded` est la garantie finale (un identifiant déjà versé n'est jamais re-versé **ni re-notifié**, même sur une sauvegarde incohérente).
- **Achats** : « Confirmer » refusé avec un motif lisible (déjà possédé, solde insuffisant, succès requis, bientôt disponible) ; message de succès ou d'erreur annoncé aux lecteurs d'écran ; un clic répété ne paie jamais deux fois.
- **Plusieurs onglets** : une sauvegarde enregistrée par un autre onglet est **adoptée** (événement `storage`, `parseSave`) au lieu d'être écrasée ; aucune récompense ni débit ne peut ainsi être dupliqué entre onglets.
- **Stockage refusé** (navigation privée, quota) : avertissement à l'accueil (« votre progression ne sera pas conservée ») ; sauvegarde illisible ou plus récente que le jeu : avertissement, copie conservée à part (`polarite.save.corrompue`).
- **Effacement confirmé** (`resetProgress`) : supprime la progression et toutes les copies (`avant-v0…v6`, `avant-eq*`, `corrompue`), conserve les **préférences** et le **profil du classement** ; l'écran de confirmation liste ce qui est supprimé et conservé.

**Libellés :** « Éclats » = monnaie de la Survie, des niveaux classiques, des succès et de la boutique ; « **Éclats de campagne** » = réserve séparée de la campagne (aucune conversion, usage prévu avec la suite : hangar désactivé en V1). **Prismes** : solde non affiché, aucun prix en Prismes à l'écran ; les articles premium disent seulement « Bientôt disponible » (bouton inactif). Le solde de Prismes n'apparaît que si un fournisseur de paiement est actif (jamais en V1). Aucune publicité, aucun achat intégré.

**Chiffres de l'économie (constatés, inchangés) :** succès = 27 pour **2 020 Éclats** au total ; récompenses de niveau = 50 + 3 × 15 par niveau soit **1 140** pour les 12 ; orbite en Survie ≤ **15 Éclats/min** (5 Éclats, une apparition toutes ~20–25 s) ; boutique en Éclats = **2 050** (hors packs) et exclusivités gratuites par succès (Glace, Solaire, Prisme, Citron, Boréale). Premier achat (100) atteint en une à trois sessions grâce aux succès de découverte (110 Éclats).

**Propositions non appliquées (à décider après tests humains)** — aucune n'est une correction de fiabilité :
1. Orbite : si le rythme de gain paraît lent (≈ 7 Éclats/min réalistes, soit 85 min de collecte pour Spectre à 600), relever `SHARDS.reward` de 5 à 8, ou raccourcir `SHARDS.nextDelay` (15–25 s → 12–20 s). Ne touche pas à la difficulté (générateur dédié).
2. Prix des vaisseaux (100 / 200 / 350 / 600) : l'écart 350 → 600 est le plus raide ; 100 / 200 / 300 / 500 donnerait un rythme plus régulier.
3. Remise des packs (12 % et 10 %) : correcte ; pas de changement proposé.
4. Éclats de campagne : sans usage en V1, ils s'accumulent (≈ 400 au maximum) ; prévoir leur dépense (hangar) avant d'ajouter des niveaux, sinon les rendre explicitement « cumulés pour la suite ».
