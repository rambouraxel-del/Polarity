# État de la mise à jour « Économie v3 » (suivi des six phases)

> **Branche de travail : `feat/polar-rift-economie-v3`** (créée depuis `main` = `836be7d`). **Rien n'est poussé sur `main`** : le déploiement se fera en une seule fois après les six phases.
> Ce document est mis à jour **avant chaque arrêt ou fin de session** : lisez d'abord « Où reprendre » ci-dessous.
> La version publique existante (GitHub Pages + éventuel service de classement déjà déployé) doit continuer à fonctionner : tout ce qui est ajouté est **additif et désactivé tant que le service n'est pas configuré**.

## Où reprendre
**Phases 1, 2 et 3 : TERMINÉES** (code, tests, documentation, commits locaux sur `feat/polar-rift-economie-v3` ; **rien poussé**, `main` intacte, **rien déployé**).
**Prochaine étape : phase 4 — Prismes : achats en argent réel** (compte connecté obligatoire, reçus Apple / Google, remboursements) **— À NE PAS COMMENCER sans demande du propriétaire.** Pré-requis déjà en place :
- le service est la seule source des Prismes : solde du registre (`ledger`, monnaie `prisms`), débit idempotent par clé (`spend:<article>`, `revive:<partie>:<vie>`) ; **aucune ligne de crédit de Prismes n'existe encore** (aucun achat réel) : la phase 4 ajoute les crédits (`iap:<reçu>`), la vérification des reçus et les remboursements (ligne négative / blocage) ;
- l'interface de reprise (`reviveScreen`) et la boutique lisent déjà le solde CONFIRMÉ (`economy.confirmed.prisms`) ; `monetization/payments.ts` est l'interface prévue (aucun paiement actif) ;
- la publicité récompensée n'a **aucun fournisseur** (`NoAdProvider`) : la deuxième chance par publicité reste affichée « Indisponible dans cette version » jusqu'à l'intégration d'un SDK validé (hors périmètre jusqu'ici).
Reprise après une coupure : `git status`, `npx tsc --noEmit`, `npx vitest run` (**628 tests verts attendus**, 32 fichiers).
Reste à la charge du propriétaire (action externe, voir `docs/COMPTES.md`) : identifiants OAuth Google / Apple, `RESEND_API_KEY` + `MAIL_FROM` + `APP_PUBLIC_URL`, module natif de connexion sociale (Android/iOS), redéploiement du service (**schéma SQLite v5**, une fois toute la mise à jour prête).

## Les six phases
| # | Phase | État |
|---|---|---|
| **1** | **Fondations : profils invités, comptes (Google / Apple / lien magique e-mail), migration des anciennes sauvegardes, synchronisation, hors ligne, registre serveur** | **TERMINÉE** (configuration externe restante) |
| **2** | **Nouvelle économie : 3 monnaies (Éclats / Médailles / Prismes), Médailles des 27 succès (1 650) réclamables rétroactivement, cosmétiques en Médailles (1 640) ou Prismes, inventaire de bonus (Boost 50 / Gel 100 Éclats), boutique et écran de préparation de la Survie, registre serveur** | **TERMINÉE** |
| **3** | **Effets de gameplay : Boost, Gel temporel, Bouclier gratuit ; deux classements mondiaux (Sans bonus / Avec bonus) ; première mort = résultat classé figé ; deuxième et troisième chances ; survie libre non classée ; rejeu serveur étendu** | **TERMINÉE** (publicité récompensée : interface seulement, aucun fournisseur) |
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

## Phase 3 — ce qui a été fait (commits `8d782e6`, `86ce56c` + dernier)
### Règles de jeu (simulation, `src/sim/powers.ts`, `src/config/powers.ts`)
- **Boost** : vitesse du vaisseau × 1,5 (sur la vitesse courante) pendant 5 s, recharge 10 s **dès l'activation** ; **Gel** : les menaces avancent à 40 % (ralenties de 60 %) pendant 6 s, recharge 20 s. Prix : 50 / 100 Éclats la charge (inchangé). Exclusivité : jamais deux pouvoirs Boost/Gel en même temps ; une tentative bloquée ne consomme aucune charge.
- **Bouclier gratuit** : jauge de 18 balises (une seule charge stockée, jauge figée tant qu'elle est pleine), activation manuelle, absorbe UN impact calculé par la simulation (8 s au plus), compatible avec Boost et Gel.
- Première vie : activation manuelle, **3 activations au plus par bonus**, une charge consommée par activation réussie. Après reprise : Boost/Gel gratuits et illimités (mêmes recharges).
- **Le Gel ne ralentit pas le temps global** : chaque menace est une fonction pure du temps ; à chaque pas gelé, tous ses champs temporels sont retardés de `(1 − 0,4)·dt` (`shiftHazard`). Collisions, rejeu et chronomètres (annonces, événements) restent sur l'horloge de jeu. **Sans Gel, le décalage est nul : la simulation est identique à l'ancienne, bit à bit → `BALANCE_VERSION` inchangée** (anciens records et rejeux restent valides).
- Vies (`Simulation.life` 1..3) : `revive()` écarte les menaces en cours, 3 s d'invulnérabilité clignotante (distincte du Bouclier : aucune charge consommée), plus d'Éclats d'orbite après la première vie. `firstLife` = copie figée des journaux, score, durée à la première mort.
### Classements, rejeu et protocole (`src/net/protocol.ts`, `server/verify.ts`, `server/app.ts`)
- **Format de rejeu 2** : `{ v: 2, flips, acts: [[pas, code]…] }` (code 0 Boost, 1 Gel, 2 Bouclier ; seulement les activations RÉUSSIES de la première vie). **Le format 1 (inversions seules) reste accepté** : anciens clients et parties en attente intacts. Les activations avec un format 1 sont refusées (400).
- Le service **rejoue** la partie (`replaySurvival`) avec des charges illimitées : chaque activation est jugée par la même simulation (recharge, exclusivité, plafond, jauge, durée). Une activation que la simulation refuserait ⇒ `bad_powers`. **La catégorie est déduite par le service** (`plain` = aucune activation réussie ; `bonus` = au moins une) : jamais fournie par le client. Durée et score viennent du rejeu (annonces du client comparées seulement : `divergence`).
- **Stocks** : chaque charge utilisée est une ligne négative du registre (`use:<ticket>:<kind>`, monnaie `boost`/`gel`), dans la transaction d'acceptation : les mêmes charges ne financent jamais deux records. Inventaire insuffisant : `409 bonus_sync_required` si les achats hors ligne du client (`installId` + `bonusBought`) ne sont pas encore traités (le ticket est conservé, on réessaie après synchronisation) ; sinon `422 bonus_unfunded` (ticket consommé, record refusé — les records indépendants du même joueur restent valides).
- **Usage déclaré** (`POST /api/sync`, champ `bonusUsed`) : compteurs monotones des charges consommées dans des parties NON envoyées (non classées, sans ticket, abandonnées) ; seul l'écart consomme des charges, une fois (`use:decl:<install>:<kind>:<total>`), sans jamais passer sous zéro (`installs.used_boost/used_gel`).
- **Deux classements** : `GET /api/leaderboard?category=plain|bonus` (défaut : `plain`, les anciens records y figurent avec scores, joueurs, pseudos et versions d'équilibrage), `GET /api/me?category=…` (+ `bests` des deux catégories). Un record par joueur, par version et par catégorie.
- **SQLite v5 (additif, sans perte)** : table `bests` reconstruite avec `category` dans la clé primaire (anciens records copiés en `plain`), `runs.category/acts/powers/replay_v`, `installs.used_boost/used_gel`. Ancien ticket toujours valable ; classement « avec bonus » vide au départ.
- **Reprise payée** : `POST /api/revive { runId, life: 2|3 }` — 5 Prismes (2ᵉ vie) / 10 (3ᵉ), prix imposé par le service, débit idempotent par clé `revive:<partie>:<vie>` (rejouer ne débite jamais deux fois), 409 si solde insuffisant, jamais de solde négatif. Aucun paiement n'influence le classement.
### Client (jeu)
- `GameSession` : première mort ⇒ `onFirstDeath` (résumé de la **première vie**, figé) — records locaux par catégorie (`save.survival` = sans bonus, `save.survivalBonus` = avec bonus), succès, soumission au classement (en attente si hors ligne ; sans ticket : résultat local expliqué, aucune éligibilité inventée) **avant** toute offre ; phase `offer` (le temps n'avance pas) ; `revive()` + compte à rebours ; trois vies au plus.
- Écran de reprise (`reviveScreen`) : publicité récompensée **désactivée honnêtement** (aucun fournisseur : `NoAdProvider`, jamais de publicité simulée) ; paiement en Prismes via le service seulement, en ligne ; sans réponse confirmée ⇒ aucune reprise, rien de débité localement ; hors ligne / sans profil / solde insuffisant ⇒ indisponibilité expliquée ; Échap/Retour n'abandonnent pas l'offre.
- Survie libre : non classée, aucun Éclat, aucune progression de succès, aucun record ; affichée comme complément du résultat. Chaque nouvelle partie recommence à la première vie.
- Commandes (`ui/powers.ts`, `#powers`) : trois boutons HORS de l'aire de jeu (jamais d'inversion), portrait (barre basse), paysage bas (colonne à droite), PC ; raccourcis **B / G / S** (Espace, Échap, P intacts) ; états Disponible / Actif (durée) / En recharge / Stock vide / Plafond atteint / Indisponible, utilisations restantes (première vie) ou « gratuit » (après reprise), jauge du Bouclier x/18.
- Rendu : anneaux Boost (or), Gel (glacé), Bouclier (clignote 2 s avant la fin), vaisseau clignotant pendant l'invulnérabilité de reprise ; effets réduits respectés.
- **Sauvegarde format 9** : `survivalBonus`, `economy.bonusUsed` (compteur monotone), `economy.liveUse` (partie en cours, remis à zéro au chargement) ; migration additive depuis la v8 ; `PendingRun.bonusUse` (charges d'une partie classée en attente, déduites de l'inventaire du service tant qu'elle n'est pas validée ; si elle est refusée, les charges reviennent).
### Tests exécutés (phase 3)
`npx tsc --noEmit` : OK. `npx vitest run` : **32 fichiers, 628 tests verts** (nouveaux : `powers` 21, `powers-server` 14, `powers-client` 19 ; adaptés : leaderboard, comptes, robustesse, économie phase 2). `npm run build` : OK. `npm run check:bundle` : OK. Contrôle navigateur **léger** (390×844, 844×390, 1280×720) : commandes visibles et utilisables, états Boost/Gel exclusifs, inventaire local décrémenté, aucune erreur de page. **Non fait volontairement** : E2E complet, monitoring, simulation massive.
### Limites connues (phase 3)
- **Publicité récompensée : indisponible** (aucun fournisseur ni SDK ; seule l'interface existe).
- Un joueur hors ligne qui a acheté des charges et joue une partie classée avant la synchronisation : si l'achat est finalement refusé par le service, le record qui en dépendait est refusé (`bonus_unfunded`) ; les parties sans bonus ne sont pas touchées.
- Les compteurs d'usage déclaré sont déclaratifs (le service ne voit pas les parties non classées) : ils ne servent qu'à ne pas laisser un stock « fantôme » ; ils ne créent jamais de crédit.
- `scripts/e2e.mjs` : toujours obsolète côté économie/pouvoirs (à réécrire en phase 6).

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
- **Phase 3 terminée** — pouvoirs, classements, reprises, protocole v2, SQLite v5 (voir ci-dessus).
- **Phase 2 terminée** — voir ci-dessus ; commits de la phase : `f5a66ea` (correctif parties en attente) → … → dernier commit de la branche (voir `git log`).
- **E4/E5 terminés** — client : `src/account/{AccountService,providers}.ts`, `src/economy/reconcile.ts`, écran Options → Compte (`src/ui/accountScreens.ts`), câblage `src/app.ts` (invité automatique, synchronisation différée hors partie, retour en ligne, lien magique `?magic=`), 19 tests client ; docs `docs/COMPTES.md`, `CLASSEMENT.md`, `GUIDE_DEPLOIEMENT.md`, `deploy/env.example` + compose, `CLAUDE.md`, `PROGRESS.md`, `RESUME.md`. Limites connues : sur mobile, Google/Apple exigent le module natif (absent) ; la déconnexion d'un appareil oublie aussi les résultats classés en attente de l'ancien profil.
- **E2/E3 terminés** — serveur : schéma v3, invités (`POST /api/register` sans pseudo), accès par appareil (sessions) et alias de fusion, `/api/auth/{providers,nonce,google,apple,email/request,email/verify,logout,unlink}`, `/api/profile`, `/api/migrate`, `/api/sync`, registre `ledger`, suppression RGPD complète ; 38 tests (`tests/accounts-server.test.ts`).
- **E1 terminé** — sauvegarde v7 (`economy`), `src/economy/{rules,merge,local,ids}.ts`, points de crédit/dépense.
- Création du document et de la branche.
