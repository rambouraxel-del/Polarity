# Économie : Éclats, Médailles, Prismes, bonus, boutique

> **Économie v3 (phase 2)** : trois monnaies séparées, **jamais converties** l'une en l'autre. Suivi : `docs/ETAT_MAJ_ECONOMIE.md` ; comptes, synchronisation et sécurité : `docs/COMPTES.md`.
> Les cosmétiques sont **purement cosmétiques** (mêmes vitesses, hitboxes et difficulté) ; les bonus sont des charges d'inventaire dont les effets en partie arrivent en phase 3.
> Réglages : `src/config/economy.ts` (bonus, récompenses de niveau, éclat d'orbite), `src/config/achievements.ts` (Médailles), `src/config/catalog.ts` (prix).

| Monnaie | Gagnée par | Dépensée pour |
|---|---|---|
| **Éclats** (violet) | gameplay : éclat sur l'orbite (Survie), récompenses de niveau | **bonus** : Boost 50, Gel temporel 100 (par charge) |
| **Médailles** (or) | **réclamer** les 27 succès (1 650 au total) | cosmétiques **non premium** uniquement (1 640 pour tout) |
| **Prismes** (rose) | très rarement, ou achat (phase 4/5) ; **toujours contrôlés par le service** | cosmétiques **premium** (Néon 150, Nébuleuse 75, Pack 200) ; plus tard secondes chances |

La réserve d'**Éclats de campagne** reste indépendante (campagne inchangée).

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

## Médailles et succès
- Les succès ne versent **plus** d'Éclats ni de cosmétique. Un succès accompli affiche **« Récupérer »** (ou « Tout récupérer ») ; les Médailles ne sont créditées qu'à la réclamation, **une seule fois** par succès (registre `medals.claimed`, identifiants historiques immuables ; distinct de `rewarded`, le registre des **anciens Éclats**).
- Grille : 10 succès à 20, 9 à 50, 6 à 100, 2 à 200 = **1 650** (config : `medals` ; `legacyShards` = anciens montants en Éclats, comptabilité historique uniquement).
- **Rétroactivité** : tous les succès déjà accomplis avant la mise à jour sont réclamables ; les anciens Éclats versés et les anciens cosmétiques débloqués sont **conservés** (jamais re-versés ni re-facturés).
- Collection non premium : vaisseaux Aurore 140, Menthe 150, Ambre 160, Spectre 170, Glace 180, Solaire 190, Prisme 200 (= **1 190**) ; traînées Émeraude 70, Glacier 80, Ultraviolet 90, Citron 100, Boréale 110 (= **450**) ; total **1 640** → **10 Médailles** de reste. Classique et Assortie restent gratuits. Plus aucun pack en Médailles (aucun contournement).

## Bonus (Boost, Gel temporel)
Inventaire persistant (`inventory`), 50 / 100 Éclats par charge, jamais supprimé, maximum 99 par bonus. **Acheter ne consomme rien** ; la consommation aura lieu à une activation réussie (phase 3, 3 activations par bonus et par partie pendant la première vie). Section « Bonus » de la Boutique et écran **« Préparer la partie »** avant la Survie (stocks, solde, achats avec confirmation, limite de 3, lancement possible sans aucun bonus). Les charges du futur calendrier de connexion s'ajouteront au même inventaire (`grantCharges`).

## Fonds dépensables (confirmé / provisoire)
Avec un service configuré (`economy.managed`), un achat n'est financé que par le **solde confirmé** à la dernière synchronisation (+ solde hérité à importer, − dépenses non confirmées) : les gains **provisoires** (éclats d'orbite, Médailles réclamées hors ligne) ne se dépensent qu'après confirmation (`economy/funds.ts`). Les achats hors ligne restent provisoires ; le service les traite **dans l'ordre de réception**, refuse ceux que le solde réel ne finance pas (jamais de solde négatif) et l'application retire alors l'article ou les charges. Provenance des charges (`chargeProvenance` : confirmées / provisoires) conservée pour la validation des parties classées (phase 3). Sans service : tout le portefeuille local est dépensable.

## Prismes (premium)
Solde séparé, **0 au départ**, jamais collecté sur l'orbite, **jamais créé ni débité localement** : le solde affiché est le reflet du service. Sans service de comptes, les articles premium restent « **Bientôt disponible** ». Avec un service, un article premium s'achète **en ligne** (`POST /api/shop/prisms`) : le service vérifie le solde et débite de façon atomique et idempotente (pack à 200 : 25 d'économie ; prorata si un élément est déjà possédé) ; l'achat réel de Prismes n'existe pas encore (phases 4/5). Interface future : `src/monetization/payments.ts` (`PaymentProvider`, `NullPaymentProvider` par défaut). Règles pour une intégration réelle :
- seuls des justificatifs **validés côté serveur ou fournisseur** créditent des Prismes ; la sauvegarde locale est modifiable par le joueur et **ne protège pas** une monnaie payante ;
- chaque transaction a un `transactionId` unique ; le serveur refuse tout crédit répété (idempotence) et renvoie le solde de référence ;
- le client n'affiche « Acheter » pour un article premium que si le fournisseur est disponible.

## Boutique
Onglets **Vaisseaux / Traînées / Packs / Bonus**. Les cosmétiques sont présentés en deux sections : **En Médailles** et **Premium · en Prismes** ; les bonus en Éclats. États : **Acheter**, **Médailles insuffisantes**, **Bientôt disponible** (premium sans service), **Possédé** / **Équiper** / **Équipé**. Achat : confirmation → vérification des fonds dépensables → débit **et** déblocage dans la même modification (une seule écriture) ; un article possédé n'est jamais débité deux fois. Prix : voir ci-dessus, ajustables dans `catalog.ts`.

## Sauvegarde (format 8 ; historique ci-dessous)
Format 8 : `wallet {shards, medals, prisms}`, `medals.claimed`, `inventory {boost, gel}`, `economy` (comptabilité de synchronisation, voir `docs/COMPTES.md`). Format 3 : `wallet {shards, prisms}`, `owned` (cosmétiques possédés), `trail` (traînée équipée), `paid` (récompenses de niveau déjà versées). Migration depuis 1 et 2 : soldes à 0 ; cosmétiques déjà obtenus conservés
(succès d'origine + apparence équipée) ; récompenses historiques marquées comme **déjà versées** (aucun crédit rétroactif) ; copie de l'ancienne sauvegarde dans `polarite.save.avant-v<version>`.

## Évolutions préparées (non implémentées)
Améliorations de campagne payées en Éclats : le solde, le registre d'achats et le catalogue sont prêts ; aucune campagne ni amélioration n'existe dans cette version.

## Succès (historique v1.6 — remplacé par les Médailles en v8)
> Les paragraphes suivants décrivent l'**ancien** système (succès → Éclats + cosmétiques directs), conservé pour la migration ; voir « Médailles et succès » ci-dessus pour les règles actuelles.
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
