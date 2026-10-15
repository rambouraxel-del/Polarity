# État de la mise à jour « Économie v3 » (suivi des six phases)

> **Branche de travail : `feat/polar-rift-economie-v3`** (créée depuis `main` = `836be7d`). **Rien n'est poussé sur `main`** : le déploiement se fera en une seule fois après les six phases.
> Ce document est mis à jour **avant chaque arrêt ou fin de session** : lisez d'abord « Où reprendre » ci-dessous.
> La version publique existante (GitHub Pages + éventuel service de classement déjà déployé) doit continuer à fonctionner : tout ce qui est ajouté est **additif et désactivé tant que le service n'est pas configuré**.

## Où reprendre
**Phases 1 et 2 : TERMINÉES** (code, tests, documentation, commits locaux sur `feat/polar-rift-economie-v3` ; **rien poussé**, `main` intacte).
**Prochaine étape : phase 3 — effets de gameplay des bonus** (Boost, Gel temporel) **— À NE PAS COMMENCER sans demande du propriétaire.** Pré-requis déjà en place :
- inventaire `save.inventory {boost, gel}` (reflet du registre du service quand un service est configuré), achats en Éclats idempotents, écran « Préparer la partie », plafond `BONUS.maxActivationsPerRun = 3` et indicateur `BONUS.activationEnabled` (**à passer à `true` en phase 3**, ce qui retire la phrase « effets à venir » de l'interface) ;
- **consommation à écrire** : une charge n'est consommée qu'à une **activation réussie** ; côté local : décrémenter `inventory` et suivre un compteur monotone `used` par bonus (même principe que `bonusBought`) ; côté service : lignes négatives du registre (`currency` = `boost` / `gel`, clé unique par partie et activation, ex. `use:<ticket>:<n>`) — l'inventaire local est « service + écart depuis l'envoi » (`applySyncResult`), il faudra y soustraire les usages locaux non envoyés ;
- **provenance** : `chargeProvenance(save)` (confirmées / provisoires) est prête pour joindre à une partie classée ; les bonus changent les règles de la simulation : ils exigent `BALANCE_VERSION` + **rejeu serveur identique** (les activations deviennent des entrées du journal de la partie, `Simulation.flipLog`), donc une décision d'équilibrage et de format de rejeu (`REPLAY_FORMAT`) à prendre avec le propriétaire (les parties avec bonus sont-elles classées à part ?) ;
- charges offertes (calendrier de connexion futur) : à créditer **par le service** (ligne du registre en `boost` / `gel`) ; `grantCharges` ne vaut que pour le jeu sans service.
Reprise après une coupure : `git status`, `npx tsc --noEmit`, `npx vitest run` (574 tests verts attendus).
Reste à la charge du propriétaire (action externe, voir `docs/COMPTES.md`) : identifiants OAuth Google / Apple, `RESEND_API_KEY` + `MAIL_FROM` + `APP_PUBLIC_URL`, module natif de connexion sociale (Android/iOS), redéploiement du service (**schéma SQLite v4**).

## Les six phases
| # | Phase | État |
|---|---|---|
| **1** | **Fondations : profils invités, comptes (Google / Apple / lien magique e-mail), migration des anciennes sauvegardes, synchronisation, hors ligne, registre serveur** | **TERMINÉE** (configuration externe restante) |
| **2** | **Nouvelle économie : 3 monnaies (Éclats / Médailles / Prismes), Médailles des 27 succès (1 650) réclamables rétroactivement, cosmétiques en Médailles (1 640) ou Prismes, inventaire de bonus (Boost 50 / Gel 100 Éclats), boutique et écran de préparation de la Survie, registre serveur** | **TERMINÉE** |
| 3 | **Effets de gameplay des bonus** (Boost, Gel temporel : activation, consommation, rejeu serveur, provenance dans les parties classées) | à faire *(annoncée par le propriétaire)* |
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

## Phase 2 — ce qui a été fait (résumé, commits `f5a66ea` … dernier)
- **Correctif phase 1** : les parties classées en attente survivent à la déconnexion, rattachées à leur profil (`PendingRun.owner`, alias de fusion confirmé par le service), jamais envoyées avec une autre identité, jamais dupliquées ; bouton de déconnexion réservé aux comptes. **Autre défaut de la phase 1 trouvé et corrigé** : le service de compte était créé par un initialiseur de champ avant le chargement de la sauvegarde → **plantage au lancement** (détecté par une capture de contrôle, test de garde ajouté) ; la synchronisation utilisait aussi la sauvegarde vivante comme « instantané d'envoi » (les gains faits pendant la requête étaient perdus à l'affichage) : instantané réel.
- **Économie** : `config/achievements.ts` (Médailles 20/50/100/200 = 1 650 ; `legacyShards` conservé pour l'historique), `config/catalog.ts` (prix en Médailles 140…200 / 70…110 = 1 190 + 450 = 1 640 ; premium Néon 150, Nébuleuse 75, pack 200 ; anciens packs en Éclats supprimés ; `LEGACY_ACHIEVEMENT_ITEMS`), `config/economy.ts` (bonus, plafond 3 activations, stock 99).
- **Sauvegarde format 8** (`wallet.medals`, `medals.claimed`, `inventory`, `economy.{confirmed, confirmedClaims, managed, bonusBought, bonusProcessed}`), migration additive (cosmétiques d'exclusivité de succès conservés pour les succès déjà obtenus, aucune Médaille créditée, `rewarded` et Éclats intacts).
- **Logique** : `progression/achievements.ts` (déblocage sans versement, `claimMedals` / `claimAllMedals`), `progression/shop.ts` (Médailles ; Prismes jamais débités localement), `economy/funds.ts` (solde confirmé vs provisoire, provenance), `economy/bonus.ts`, `economy/reconcile.ts` (instantané d'envoi, Médailles, inventaire, premium non vérifié retiré), `economy/rules.ts`, `economy/merge.ts`.
- **Service** : schéma SQLite **v4** (`installs.bonus_boost/bonus_gel`), registre `medals` / `boost` / `gel`, `/api/sync` étendu (claims, bonus, prix du catalogue), `POST /api/shop/prisms`, `balancesOf` / `inventoryOf` / `claimedMedals`, protocole `net/accountProtocol.ts`.
- **Interface** : Boutique (onglets Vaisseaux / Traînées / Packs / Bonus, sections En Médailles / Premium · en Prismes), confirmation d'achat de bonus, écran « Préparer la partie » (lancement en tête), Succès (« Récupérer », « Tout récupérer », animation courte, message), notification d'accueil, trois soldes distincts (Médailles : pictogramme or), compte (confirmations en attente).
- **Hors périmètre phase 2 (non fait volontairement)** : effets des bonus en partie, consommation, achats réels de Prismes, calendrier de connexion, interface complète du compte (phase 5), réécriture et relecture de `scripts/e2e.mjs` (parcours économie obsolètes, noté dans l'en-tête du script ; à faire en phase 6).

### Tests exécutés (phase 2)
`npx tsc --noEmit` : OK. `npx vitest run` : **29 fichiers, 574 tests verts** (dont `accounts-server` 52, `accounts-client` 40, `economy-phase2` 16, `economy` 44, `robustness` 34, `ui` 22 ; les tests devenus obsolètes ont été adaptés, pas supprimés). `npm run build` : OK. `npm run check:bundle` : OK. Contrôle navigateur **léger** (une session, captures 390×844 et 1280×800, parcours réclamer → préparer → acheter → lancer → boutique) : 11 vérifications OK, aucune erreur de console. Pas d'e2e complet, pas de simulation massive.

### Limites connues
- Succès **déclarés par le client** : Médailles falsifiables dans la limite de 1 650 (cosmétiques non premium uniquement) ; documenté dans `docs/COMPTES.md`.
- `scripts/e2e.mjs` : parcours Survie adaptés (étape de préparation) mais sections économie/succès obsolètes et **non rejouées**.
- Effacer la progression locale d'un joueur connecté puis synchroniser restaure l'état du service (source de vérité).
- Les achats de Prismes réels, remboursements et le calendrier de connexion n'existent pas encore.

## Journal des étapes (le plus récent en haut)
- **Phase 2 terminée** — voir ci-dessus ; commits de la phase : `f5a66ea` (correctif parties en attente) → … → dernier commit de la branche (voir `git log`).
- **E4/E5 terminés** — client : `src/account/{AccountService,providers}.ts`, `src/economy/reconcile.ts`, écran Options → Compte (`src/ui/accountScreens.ts`), câblage `src/app.ts` (invité automatique, synchronisation différée hors partie, retour en ligne, lien magique `?magic=`), 19 tests client ; docs `docs/COMPTES.md`, `CLASSEMENT.md`, `GUIDE_DEPLOIEMENT.md`, `deploy/env.example` + compose, `CLAUDE.md`, `PROGRESS.md`, `RESUME.md`. Limites connues : sur mobile, Google/Apple exigent le module natif (absent) ; la déconnexion d'un appareil oublie aussi les résultats classés en attente de l'ancien profil.
- **E2/E3 terminés** — serveur : schéma v3, invités (`POST /api/register` sans pseudo), accès par appareil (sessions) et alias de fusion, `/api/auth/{providers,nonce,google,apple,email/request,email/verify,logout,unlink}`, `/api/profile`, `/api/migrate`, `/api/sync`, registre `ledger`, suppression RGPD complète ; 38 tests (`tests/accounts-server.test.ts`).
- **E1 terminé** — sauvegarde v7 (`economy`), `src/economy/{rules,merge,local,ids}.ts`, points de crédit/dépense.
- Création du document et de la branche.
