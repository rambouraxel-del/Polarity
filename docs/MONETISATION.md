# Monétisation (phase 5) : achats de Prismes et publicité récompensée

> **État honnête.** Tout le code est écrit et testé **avec des fournisseurs simulés** (tests unitaires). **Aucun paiement réel ni aucune publicité réelle n'a été essayé.**
> Sans configuration externe (ci-dessous), les achats et la publicité sont **désactivés** et l'interface l'explique ; aucun succès fictif n'existe en production.

## Principes
- Accès gratuit et complet ; aucun avantage de jeu à l'achat. Les Prismes servent aux cosmétiques « au choix Éclats / Prismes » (long-courrier 60, basalte 80, arcade-84 120, provisoires) et aux reprises (5 puis 10). Tarifs **inchangés**.
- Prismes achetés et gagnés (calendrier, podium quotidien, drop) : **identiques**. Éclats et Médailles : intacts, jamais convertis.
- Les Prismes ne sont crédités **que par le service**, après vérification auprès du fournisseur. Aucune valeur (montant, produit, quantité) envoyée par le client ne fait autorité : le service retrouve le pack d'après l'identifiant de produit **vérifié chez le fournisseur** (`src/config/monetization.ts`).
- Compte connecté obligatoire pour acheter (l'invité joue sans paiement, l'interface propose d'ouvrir Compte).

## Packs (prix publics indicatifs ; le prix final vient du magasin)
| Pack | Prix | Prismes | Produit |
|---|---|---|---|
| Découverte | 0,99 € | 30 | `polar_rift_prisms_30` |
| Intermédiaire | 2,99 € | 100 | `polar_rift_prisms_100` |
| Grand | 9,99 € | 380 | `polar_rift_prisms_380` |

Produits **consommables**, quantité 1.

## Achats (serveur : `server/payments.ts`, schéma SQLite v7)
- Routes : `GET /api/payments/config|prepare|history`, `POST /api/payments/verify|restore|web/checkout`, notifications `POST /api/payments/notify/apple`, `notify/google` (jeton OIDC Pub/Sub ou `?token=…`), `notify/web`.
- **Apple** : appel authentifié à l'API App Store Server (JWT ES256), contrôle du `bundleId`, du produit et de l'`appAccountToken` (dérivé du profil par HMAC : un reçu ne sert qu'à son profil). Bac à sable refusé sauf `APPLE_IAP_ACCEPT_SANDBOX=1`.
- **Google Play** : compte de service, `purchases.products.get`, `obfuscatedExternalAccountId` lié au profil, consommation (`:consume`) après crédit. Achats de test refusés sauf `GOOGLE_PLAY_ACCEPT_TEST=1`.
- **Web** : interface `WebProvider` (création de paiement + vérification de signature sur le corps brut). **Aucun prestataire choisi ni intégré** : achats web indisponibles tant qu'un module n'est pas fourni.
- États : acheté / en attente / annulé / échoué / remboursé / restauré. Crédit **atomique et idempotent** (`UNIQUE(player_id, ref)` du registre `ledger`, identifiant de transaction fournisseur unique). Répétition d'une vérification = même résultat, jamais de double crédit.
- Notifications des fournisseurs : **jamais crues** ; chaque notification déclenche une re-vérification par appel d'API. Remboursement : écriture de reprise dans `payment_debts` ; si les Prismes sont déjà dépensés, le solde **ne devient jamais négatif** (dette réglée sur les crédits suivants, `settleDebt`).
- Journal `payment_events` : aucune donnée personnelle ni secret ; à l'effacement du profil, le justificatif est conservé sans lien avec le joueur (`player_id` NULL).

## Réconciliation des remboursements (phase 6) : pas de simple relecture ponctuelle
Une relecture de l'état d'un achat n'est **pas** une protection exhaustive (un achat remboursé ou rétrofacturé peut encore répondre « acheté », un jeton ancien peut ne plus répondre, une notification peut se perdre). Le service s'appuie donc sur les mécanismes officiels, **au démarrage puis toutes les 15 minutes** (`App.reconcile`, curseur et état en base : table `provider_sync`, schéma v8) :
- **Google Play** : API **« Voided Purchases »** (`purchases.voidedpurchases.list`, achats annulés / remboursés / rétrofacturés, paginée, fenêtre de 29 jours recouvrante de 3 jours). Chaque achat annulé est rapproché de nos justificatifs par `orderId` **ou** empreinte du jeton d'achat (`payments.token_hash`, jamais le jeton lui-même) ; un annulé inconnu est consigné (il ne pourra plus jamais créditer). Une notification « voided » (Pub/Sub) n'est qu'un **déclencheur** : le contenu du message n'est jamais cru, c'est la liste officielle qui décide. Échec du fournisseur = rien d'appliqué, curseur conservé, nouvel essai ; la notification reçoit alors une réponse d'échec pour être renvoyée.
- **Apple** : **historique des notifications** (`/inApps/v1/notifications/history`, types `REFUND` et `REVOKE`) pour rattraper une notification perdue ; chaque transaction est **revérifiée** par l'API (`revocationDate`) avant tout débit.
- Effet d'un remboursement : débit limité au solde, le reste devient une dette recouvrée sur les crédits suivants (jamais de solde négatif ; clés du registre uniques par profil, même après fusion).
- Authentification des notifications Google : **jeton OIDC signé par Google** (variables `PLAY_NOTIFY_AUDIENCE` + `PLAY_NOTIFY_SERVICE_ACCOUNT_EMAIL`, e-mail obligatoire) — recommandé ; à défaut, jeton secret dans l'adresse (`PLAY_NOTIFY_TOKEN`), qui apparaît dans les journaux d'accès du proxy : ajouter dans le bloc `log` de Caddy un filtre qui l'écarte (`format filter { request>uri query { replace token REDACTED } }`, **à valider au déploiement**, non testé ici).
- Limites documentées : l'achat non consommé que le joueur ne revérifie jamais est remboursé par Google au bout de 3 jours, puis retiré par la réconciliation ; un remboursement Apple « annulé » (`REFUND_REVERSED`) n'est pas rétabli automatiquement ; la demande d'information de consommation d'Apple (`CONSUMPTION_REQUEST`) n'est pas traitée (Apple décide seul) ; **aucun de ces mécanismes n'a été exercé contre les vrais services**.

## Intégrations natives : évaluation (phase 6)
- **Mise à jour (publicité)** : le plugin `PolarRiftAds` est maintenant **fourni** (`plugins/polar-rift-ads`, AdMob + UMP, SDK officiels autorisés dans les applications natives seulement ; voir `docs/PUBLICITE.md`). Le plugin `PolarRiftBilling` reste à écrire ou adapter par l'éditeur (aucun SDK d'achat dans le dépôt). **Non fabriqués ici** : leur finalisation exige un identifiant d'application définitif, des comptes développeur, des produits et un identifiant d'application AdMob (sans lequel le SDK publicitaire plante au lancement), et une compilation Android/iOS impossible dans cet environnement.
- Pistes de plugins maintenus (à **valider sur appareil**, rien n'a été installé) : `@capgo/native-purchases` (StoreKit / Google Play Billing ; son exemple transmet un `appAccountToken` à l'achat — la prise en charge du `obfuscatedAccountId` Android, indispensable à la liaison de compte du service, reste à confirmer dans son code) et `@capacitor-community/admob` (récompensé avec options de vérification serveur `userId` / `customData`, et formulaire de consentement UMP — forme exacte de l'option à confirmer). Chacun serait enveloppé dans un petit plugin local respectant les contrats `BillingPlugin` / `AdsPlugin` (`src/monetization/`), sans changer le service.
- Contraintes à traiter avec ces plugins : consentement (UMP/ATT) avant toute publicité ; déclaration des données dans les fiches Play/App Store ; bouton « Restaurer mes achats » (présent) ; permissions Android supplémentaires (identifiant publicitaire) à déclarer.
- **Le web ne simule jamais un paiement** : sans plugin, `NullPaymentProvider` (aucun achat) ; le prestataire web (`WebProvider`) est une interface sans implémentation.

## Publicité récompensée (2ᵉ chance : `server/ads.ts`)
- 1ʳᵉ mort : publicité **ou** 5 Prismes ; 2ᵉ mort : 10 Prismes seulement ; 3ᵉ mort : fin. Jamais de 4ᵉ vie. Le record de la première vie n'est jamais touché.
- Le client demande une **session** au service (`POST /api/ads/session`, unique par joueur + partie + vie) **avant** la publicité ; la récompense n'est accordée que sur confirmation **serveur à serveur** (AdMob SSV, signature ECDSA vérifiée, unité d'annonce autorisée), consommée une seule fois (`POST /api/ads/claim`). Publicité fermée / échouée / non confirmée = aucune reprise ; jamais de minuterie.
- L'option n'est affichée que si une publicité est prête ; sinon « indisponible » avec explication.

## Ce que le dépôt NE contient PAS (à fournir)
Le **jeu web** n'embarque aucun SDK. Les applications natives attendent deux **plugins Capacitor** : `PolarRiftAds` est fourni par ce dépôt (`docs/PUBLICITE.md`) ; `PolarRiftBilling` reste à écrire/installer par l'éditeur (détection : `registerNativePlugin` pour la publicité, `nativePlugin` d'origine pour la facturation) :
- `PolarRiftBilling` : `isAvailable()`, `purchase({productId, accountToken})`, `pendingPurchases()`, `finish({…})` (StoreKit 2 / Google Play Billing).
- `PolarRiftAds` (**fourni**) : `requestConsent()`, `getConsentState()`, `showPrivacyOptions()`, `load({placement})`, `show({placement, userId, customData})` (AdMob, SSV : `userId` = profil, `customData` = identifiant de session).
Sans eux : build web = achats et publicité **indisponibles** (message explicatif, aucun bouton factice).

## Configuration externe exacte (à faire par le propriétaire)
**Apple** : compte développeur, app dans App Store Connect, 3 produits consommables (ci-dessus) approuvés, clé « In-App Purchase » (`APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY` en .p8, `APPLE_BUNDLE_ID`), URL de notifications serveur → `/api/payments/notify/apple`.
**Google** : compte Play Console, app et 3 produits consommables actifs, compte de service autorisé dans l'API Play (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PACKAGE_NAME`), notifications temps réel du développeur (Pub/Sub, abonnement *push* → `/api/payments/notify/google`, authentifié par jeton OIDC : `PLAY_NOTIFY_AUDIENCE` + `PLAY_NOTIFY_SERVICE_ACCOUNT_EMAIL`, ou à défaut `?token=<PLAY_NOTIFY_TOKEN>`) ; **la réconciliation périodique fonctionne même sans notifications** (API « achats annulés », compte de service avec droit de lecture financier à accorder dans la Play Console).
**AdMob** : compte, application, bloc récompensé avec vérification côté serveur (SSV) → `/api/ads/ssv` ; `ADMOB_AD_UNIT_IDS` ; consentement (RGPD/UMP) géré par `PolarRiftAds.requestConsent`.
**Identifiant d'application** définitif (`com.example.polarrift` est provisoire) : requis par les deux magasins. Service hébergé en HTTPS, schéma v8, sauvegarde de la base avant redéploiement. **Politique de confidentialité** publique et déclarations des magasins (achats, publicité).
Variables : `deploy/env.example`. **Limite à vérifier en réel** : le remboursement Google n'est détecté que si l'API répond « annulé/remboursé » à la re-vérification.

## Tests
`tests/payments-server.test.ts` (33), `tests/payments-client.test.ts` (22), `tests/phase4-verify.test.ts` : fournisseurs **simulés** ; ils prouvent la logique (idempotence, falsification, autre profil, remboursement, coupures, pub validée/interrompue/dupliquée), **pas** un paiement réel.
