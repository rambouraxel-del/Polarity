# État de la mise à jour « Économie v3 » (suivi des six phases)

> **Branche de travail : `feat/polar-rift-economie-v3`** (créée depuis `main` = `836be7d`). **Rien n'est poussé sur `main`** : le déploiement se fera en une seule fois après les six phases.
> Ce document est mis à jour **avant chaque arrêt ou fin de session** : lisez d'abord « Où reprendre » ci-dessous.
> La version publique existante (GitHub Pages + éventuel service de classement déjà déployé) doit continuer à fonctionner : tout ce qui est ajouté est **additif et désactivé tant que le service n'est pas configuré**.

## Où reprendre
**Phases 1, 2, 3 et 4 : TERMINÉES** (code, tests, documentation, commits locaux sur `feat/polar-rift-economie-v3` ; **rien poussé**, `main` intacte, **rien déployé**).
**Prochaine étape : phase 5 — achats réels (Prismes en argent) et publicités récompensées** — **À NE PAS COMMENCER sans demande du propriétaire.** Pré-requis en place :
- le service est la seule source des Prismes (registre `ledger`, monnaie `prisms`) ; sources déjà actives : calendrier jour 10 (`loy:<cycle>:10`), Top 10 quotidien (`daily:<date>`), drop rare (`drop:<ticket>`) ; dépenses : cosmétiques premium (`spend:`), reprises (`revive:`). La phase 5 ajoutera les crédits d'achat (`iap:<reçu>`), la vérification des reçus Apple / Google et les remboursements ;
- `config/rewards.ts › PRISM_SOURCES` : sources futures déclarées, **désactivées** (clé de registre `<préfixe>:<occurrence>`) ;
- publicité récompensée : `monetization/ads.ts` (`NoAdProvider`), la 2ᵉ chance par publicité reste « Indisponible dans cette version » tant qu'aucun fournisseur réel n'est validé ; `monetization/payments.ts` = interface prévue, aucun paiement actif ;
- anti-abus des profils invités : les Prismes (jour 10, Top 10) exigent un pseudo ou un compte ; la phase 5 devra exiger un compte connecté pour tout achat réel.
Reprise après une coupure : `git status`, `npx tsc --noEmit`, `npx vitest run` (**689 tests verts attendus**, 35 fichiers).
Reste à la charge du propriétaire (action externe, voir `docs/COMPTES.md`) : identifiants OAuth Google / Apple, `RESEND_API_KEY` + `MAIL_FROM` + `APP_PUBLIC_URL`, module natif de connexion sociale, redéploiement du service (**schéma SQLite v6**, une fois toute la mise à jour prête ; le service doit tourner en continu ou être relancé : la clôture des défis est rejouable au démarrage).

## Les six phases
| # | Phase | État |
|---|---|---|
| **1** | **Fondations : profils invités, comptes (Google / Apple / lien magique e-mail), migration des anciennes sauvegardes, synchronisation, hors ligne, registre serveur** | **TERMINÉE** (configuration externe restante) |
| **2** | **Nouvelle économie : 3 monnaies (Éclats / Médailles / Prismes), Médailles des 27 succès (1 650) réclamables rétroactivement, cosmétiques en Médailles (1 640) ou Prismes, inventaire de bonus (Boost 50 / Gel 100 Éclats), boutique et écran de préparation de la Survie, registre serveur** | **TERMINÉE** |
| **3** | **Effets de gameplay : Boost, Gel temporel, Bouclier gratuit ; deux classements mondiaux (Sans bonus / Avec bonus) ; première mort = résultat classé figé ; deuxième et troisième chances ; survie libre non classée ; rejeu serveur étendu** | **TERMINÉE** (publicité récompensée : interface seulement, aucun fournisseur) |
| **4** | **Récompenses gratuites : calendrier de connexion (10 jours), classement mondial du Défi quotidien (Top 10 récompensé en Prismes), drop rare de Prismes en Survie** | **TERMINÉE** |
| 5 | Achats réels de Prismes (compte obligatoire, reçus Apple / Google, remboursements) et publicités récompensées | à faire *(annoncée par le propriétaire)* |
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

## Phase 4 — ce qui a été fait (commits `de9d5c7`, `419f1f1` + derniers)
### Vérifications de la phase 3 (aucune lacune trouvée) — `tests/phase4-verify.test.ts`
Reprise : menaces écartées, 3 s d'invulnérabilité sans entrée, vaisseau resté sur son orbite, aucun Bouclier consommé ; aucune quatrième vie (simulation et `POST /api/revive` vie 4 → 400) ; rejeu serveur exact d'une partie où le Bouclier **absorbe réellement** un impact (même durée, score, compteurs ; sans l'activation la partie ne serait pas la même).
### Calendrier de connexion (`config/rewards.ts › LOYALTY`, `server/rewards.ts`)
- Cycle de 10 jours : 20 Éclats, 1 Boost, 30 Éclats, 1 Gel, 40 Éclats, 1 Boost, 50 Éclats, 1 Gel, 60 Éclats, 5 Prismes (total 200 / 2 / 2 / 5).
- **Le service fait seul autorité** sur les jours UTC (00 h 00). `POST /api/loyalty/checkin` valide la présence du jour du SERVICE (jamais une date envoyée) ; une connexion suffit, rien à récupérer tout de suite. Une absence tolérée par cycle ; la deuxième (même non consécutive, ou deux jours d'un coup) réinitialise ; après le jour 10, nouveau cycle au prochain jour UTC éligible (`nextPresence`, fonction pure testée).
- Réclamation manuelle `POST /api/loyalty/claim {cycle, day}` : atomique, **idempotente** (clé de registre `loy:<cycle>:<jour>`, identifiant de cycle global), une fois ; les récompenses débloquées restent récupérables indéfiniment, même après réinitialisation (anciens cycles conservés). Boost/Gel : inventaire existant, plafond 99 — **stock plein : refus `stock_full`, rien consommé, la récompense reste disponible**. Prismes : réservés aux profils avec pseudo ou compte (`account_required` pour un invité : protection contre les profils invités en série ; la récompense reste disponible).
- **Hors ligne** : présence **provisoire** uniquement (`save.loyalty.localDay`, affichage) : elle n'est jamais créditée ; seule la validation du service le même jour UTC compte. Aucun Prisme ne repose sur l'horloge de l'appareil. Réclamer exige une connexion.
- Interface : `ui/rewardsScreens.ts` (écran Récompenses : 10 cellules, statuts, « Récupérer », absence restante, compte à rebours, anciens cycles, animation spéciale des 5 Prismes), bouton à l'accueil avec nombre à récupérer, ouverture automatique à la première ouverture de chaque jour UTC, revalidation au retour en ligne / visibilité.
### Classement mondial du Défi quotidien
- Gameplay, graine (date UTC) et difficulté **inchangés** ; aucun pouvoir (`replayDaily` : inversions seules). Survie : deux classements intacts.
- Flux : `POST /api/daily/start {date}` (en ligne, jour UTC du service : le service **enregistre l'heure de début**) → partie → `POST /api/daily/runs` (journal, rejoué par le service) ; tentative à usage unique, liée au joueur et à la date. Hors ligne au départ : résultat local expliqué, jamais classé. Tentative terminée mais non envoyée : conservée « en attente » (`polarite.classement.quotidien`) et renvoyée.
- Preuves d'horaire (jamais un ticket ancien ni un horodatage client) : début enregistré par le service ; durée active rejouée ≤ temps écoulé depuis ce début (`too_fast`) ; **soumission tardive 00 h 00 – 00 h 15** acceptée seulement si le début est avant minuit **et** début + durée active ≤ minuit (`late_unproven` sinon) ; après 00 h 15 : `closed`. Limite assumée : la fin réelle n'est pas observable par le service ; la fenêtre d'abus est bornée par la grâce de 15 min et ne donne aucune information nouvelle (graine identique pour tous).
- Classement par rangs « compétition » : ex æquo = durée **et** score identiques ⇒ même rang, même récompense, rangs suivants sautés ; tous les ex æquo du 10ᵉ rang sont récompensés. Prismes : 15 / 10 / 5 / 2×4 / 1×3 (41 par jour standard). Invités et profils exclus par la modération : ni classés ni récompensés.
- **Clôture à 00 h 15 UTC** (`tick`, au démarrage du service, chaque minute, et à la consultation) : Top 10 figé dans `daily_results`, Prismes au registre (`daily:<date>`, unique par profil) dans UNE transaction avec le marqueur `daily_closed` ; **rejouable après une panne** (rien n'est dupliqué, les jours échus pendant l'arrêt sont clos au redémarrage).
- Consultation : `GET /api/daily/leaderboard?date=` (rang, ex æquo, Prismes, rang personnel, `open | grace | final`, heures de fin), notifications au prochain lancement `GET /api/daily/notices` + `POST /api/daily/ack`. Écran : section « Classement mondial du jour » dans le Défi quotidien.
### Drop rare de Prismes (`config/rewards.ts › DROPS`, `server/rewards.ts › rollDrop`)
- Survie seulement, première vie seulement (le rejeu s'arrête à la première mort), 0,02 % par balise collectée, **1 Prisme au plus par partie**. Tirage = HMAC(secret du service, ticket, index de balise) : déterministe, non prévisible ni contrôlable par le client ; collectes vérifiées par le rejeu (`replaySurvival().beacons`). Jamais de drop au Défi quotidien, en Campagne ni après la première mort.
- Condition « en ligne » : `POST /api/tickets/start` enregistre l'heure de démarrage côté service ; sans elle (partie hors ligne), ou si la durée rejouée dépasse le temps écoulé, **aucun tirage**, et jamais rétroactivement (démarrage refusé une fois le ticket utilisé). Ticket à usage unique, signé, lié à sa graine : pas de reroll (changer la graine, rejouer le ticket ou soumettre deux fois ne change rien).
- Crédit : ligne `drop:<ticket>` du registre dans la transaction d'acceptation ; réponse `drop: {prisms: 1}` ; animation « Prisme trouvé » **seulement après confirmation du service** (statut provisoire = « en attente de validation »), annoncée au lancement si reçue tard.
- Sources futures : `PRISM_SOURCES` (déclarées, désactivées) ; les 27 succès et leurs 1 650 Médailles ne sont pas touchés.
### Migration SQLite v6 (additive, copie `.avant-v5.bak` automatique)
`loyalty_cycles`, `daily_attempts`, `daily_runs`, `daily_bests`, `daily_results`, `daily_closed`, `tickets.started_at`, `runs.drop_prisms`. Aucune table existante reconstruite, aucune donnée modifiée. Effacement RGPD et fusion de profils étendus (cycles déplacés, un seul cycle courant, meilleur résultat par date, registre dédupliqué par clé : aucun double crédit).
### Sauvegarde format 10
`loyalty { shownDay, localDay, snapshot }` (affichage seulement, instantané validé champ par champ, récompenses toujours lues dans la configuration) ; exclue de la synchronisation. Migration additive depuis la v9.
### Tests exécutés (phase 4)
`npx tsc --noEmit` : OK. `npx vitest run` : **35 fichiers, 689 tests verts** (nouveaux : `rewards-server` 42, `rewards-client` 14, `phase4-verify` 4, 1 fusion dans `accounts-server` ; adaptés : migration, versions de sauvegarde). `npm run build` : OK. `npm run check:bundle` : OK. Contrôle navigateur **léger** avec vrai service local (390×844, 1280×800) : calendrier automatique, réclamation, classement du Défi, aucune erreur de page. **Non fait volontairement** : E2E complet, monitoring, simulation massive.
### Limites connues (phase 4)
- Preuve d'horaire du Défi quotidien : voir ci-dessus (fin réelle non observable ; bornée à 15 min, début obligatoirement en ligne).
- Le Défi quotidien classé exige d'être en ligne au démarrage ; sans cela, résultat local seulement.
- Les Prismes du calendrier (jour 10) et du Top 10 exigent un pseudo ou un compte ; un invité garde ses récompenses en attente.
- `scripts/e2e.mjs` toujours obsolète côté économie (à réécrire en phase 6).

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
- **Phase 4 terminée** — calendrier, Défi quotidien mondial, drop rare, schéma v6, sauvegarde 10 (voir ci-dessus).
- **Phase 3 terminée** — pouvoirs, classements, reprises, protocole v2, SQLite v5 (voir ci-dessus).
- **Phase 2 terminée** — voir ci-dessus ; commits de la phase : `f5a66ea` (correctif parties en attente) → … → dernier commit de la branche (voir `git log`).
- **E4/E5 terminés** — client : `src/account/{AccountService,providers}.ts`, `src/economy/reconcile.ts`, écran Options → Compte (`src/ui/accountScreens.ts`), câblage `src/app.ts` (invité automatique, synchronisation différée hors partie, retour en ligne, lien magique `?magic=`), 19 tests client ; docs `docs/COMPTES.md`, `CLASSEMENT.md`, `GUIDE_DEPLOIEMENT.md`, `deploy/env.example` + compose, `CLAUDE.md`, `PROGRESS.md`, `RESUME.md`. Limites connues : sur mobile, Google/Apple exigent le module natif (absent) ; la déconnexion d'un appareil oublie aussi les résultats classés en attente de l'ancien profil.
- **E2/E3 terminés** — serveur : schéma v3, invités (`POST /api/register` sans pseudo), accès par appareil (sessions) et alias de fusion, `/api/auth/{providers,nonce,google,apple,email/request,email/verify,logout,unlink}`, `/api/profile`, `/api/migrate`, `/api/sync`, registre `ledger`, suppression RGPD complète ; 38 tests (`tests/accounts-server.test.ts`).
- **E1 terminé** — sauvegarde v7 (`economy`), `src/economy/{rules,merge,local,ids}.ts`, points de crédit/dépense.
- Création du document et de la branche.
