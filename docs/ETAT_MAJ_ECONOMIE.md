# État de la mise à jour « Économie v3 » (suivi des six phases)

> **Branche de travail : `feat/polar-rift-economie-v3`** (créée depuis `main` = `836be7d`). **Rien n'est poussé sur `main`** : le déploiement se fera en une seule fois après les six phases.
> Ce document est mis à jour **avant chaque arrêt ou fin de session** : lisez d'abord « Où reprendre » ci-dessous.
> La version publique existante (GitHub Pages + éventuel service de classement déjà déployé) doit continuer à fonctionner : tout ce qui est ajouté est **additif et désactivé tant que le service n'est pas configuré**.

## Où reprendre
*(mis à jour à chaque étape — voir le journal en bas)*

## Les six phases
| # | Phase | État |
|---|---|---|
| **1** | **Fondations : profils invités, comptes (Google / Apple / lien magique e-mail), migration des anciennes sauvegardes, synchronisation, hors ligne, registre serveur** | **EN COURS** (cette session) |
| 2 | Médailles : réclamation rétroactive des anciens succès (les succès déjà obtenus donnent droit à des Médailles) ; registre des récompenses côté serveur | à faire (annoncée par le propriétaire) |
| 3 | Achats d'Éclats validés par le serveur (catalogue serveur, prix, packs au prorata) et réconciliation complète | à faire *(proposition de découpage)* |
| 4 | Prismes : achats en argent réel (compte connecté obligatoire), reçus Apple / Google, remboursements | à faire *(proposition)* |
| 5 | Interface compte et économie : écrans complets, fusion guidée, support, messages | à faire *(proposition)* |
| 6 | Intégration finale, essais, configuration de production (OAuth, e-mail), **déploiement unique** | à faire *(proposition)* |

Les phases 3 à 6 sont un découpage **proposé** (le propriétaire n'a fixé explicitement que la phase 2 : les Médailles) ; à confirmer ou corriger.

## Phase 1 — périmètre et décisions
### Principes (non négociables)
1. **Le serveur est la source de vérité des monnaies** ; le portefeuille local est **provisoire** tant qu'il n'est pas synchronisé. Aucune donnée locale n'est une preuve suffisante pour créer des Prismes : **aucun point d'entrée ne crédite des Prismes depuis le client** (ils sont toujours 0 côté local, ignorés à l'import).
2. **Migration exceptionnelle de confiance** : les anciennes sauvegardes (formats ≤ 6, avant les comptes) sont acceptées **intégralement** (Éclats, succès, cosmétiques, statistiques, records locaux) à la première synchronisation. Risque assumé et documenté : un joueur peut avoir falsifié sa sauvegarde locale historique. Mesures de limitation : un import par installation (idempotent), 3 installations héritées par profil, plafond de monnaie, **jamais de Prismes**, articles premium refusés. Cette politique **ne s'applique pas aux nouvelles transactions** (gains, achats), toutes bornées et vérifiées.
3. **Idempotence partout** : chaque opération sensible porte une clé unique (`ledger.ref`, unique par profil) ; rejouer une requête ne crée jamais un second crédit.
4. **Pas de secret dans le frontend** : seuls les identifiants *clients* OAuth (publics par nature) sont exposés ; les clés d'API e-mail et les secrets de signature restent côté serveur.
5. **Tout ce qui exige des clés externes reste désactivé** tant qu'elles ne sont pas configurées (aucune fausse connexion).
6. **La réserve d'Éclats de campagne reste séparée** : jamais convertie, jamais dans le registre des Éclats de la Survie.
7. **Identifiants historiques conservés** : `polarite.save`, `polarite.classement.*`, `STORAGE_NAMESPACE = 'polarite'`, identifiants d'apparences et de scènes, profil de classement existant (pseudo et records conservés).

### Modèle de monnaie (Éclats)
Solde serveur = Σ du **registre** (`ledger`) :
| Nature | Clé d'idempotence | Montant |
|---|---|---|
| Import hérité | `import:<installId>` | solde local de l'ancienne sauvegarde (une fois par installation) |
| Récompense unique (succès, niveau) | `ach:<id>`, `lvl:<n>:first`, `lvl:<n>:star<k>` | fixé par la configuration du jeu (pas par le client) ; marqueurs à 0 pour ce que l'import couvre déjà |
| Gain répétable (éclat d'orbite, réussite répétée) | `earn:<installId>:<filigrane>` | écart entre le compteur monotone du client et le **filigrane** déjà accepté, borné par un plafond horaire |
| Dépense (achat cosmétique) | `spend:<article>` | prix vérifié sur le catalogue ; refusé si solde insuffisant ; article déjà possédé = jamais débité |
| (phase 2+) Médailles, Prismes | à définir | **serveur uniquement** |

Fusion de deux profils : registre dédupliqué **par clé** (récompense : on garde le plus petit montant ; dépense : le plus petit débit) → jamais de double crédit ; les filigranes d'installation changent de propriétaire.

## Journal des étapes (le plus récent en haut)
- *(création du document ; aucune étape terminée)*
