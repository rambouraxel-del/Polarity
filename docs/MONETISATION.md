# Monétisation (phase 5) : achats de Prismes et publicité récompensée

> **État honnête.** Tout le code est écrit et testé **avec des fournisseurs simulés** (tests unitaires). **Aucun paiement réel ni aucune publicité réelle n'a été essayé.**
> Sans configuration externe (ci-dessous), les achats et la publicité sont **désactivés** et l'interface l'explique ; aucun succès fictif n'existe en production.

## Principes
- Accès gratuit et complet ; aucun avantage de jeu à l'achat. Les Prismes servent aux cosmétiques premium (Néon 150, Nébuleuse 75, pack 200) et aux reprises (5 puis 10). Tarifs **inchangés**.
- Prismes achetés et gagnés (calendrier, Top 10 quotidien, drop) : **identiques**. Éclats et Médailles : intacts, jamais convertis.
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
- Routes : `GET /api/payments/config|prepare|history`, `POST /api/payments/verify|restore|web/checkout`, notifications `POST /api/payments/notify/apple`, `notify/google?token=…`, `notify/web`.
- **Apple** : appel authentifié à l'API App Store Server (JWT ES256), contrôle du `bundleId`, du produit et de l'`appAccountToken` (dérivé du profil par HMAC : un reçu ne sert qu'à son profil). Bac à sable refusé sauf `APPLE_IAP_ACCEPT_SANDBOX=1`.
- **Google Play** : compte de service, `purchases.products.get`, `obfuscatedExternalAccountId` lié au profil, consommation (`:consume`) après crédit. Achats de test refusés sauf `GOOGLE_PLAY_ACCEPT_TEST=1`.
- **Web** : interface `WebProvider` (création de paiement + vérification de signature sur le corps brut). **Aucun prestataire choisi ni intégré** : achats web indisponibles tant qu'un module n'est pas fourni.
- États : acheté / en attente / annulé / échoué / remboursé / restauré. Crédit **atomique et idempotent** (`UNIQUE(player_id, ref)` du registre `ledger`, identifiant de transaction fournisseur unique). Répétition d'une vérification = même résultat, jamais de double crédit.
- Notifications des fournisseurs : **jamais crues** ; chaque notification déclenche une re-vérification par appel d'API. Remboursement : écriture de reprise dans `payment_debts` ; si les Prismes sont déjà dépensés, le solde **ne devient jamais négatif** (dette réglée sur les crédits suivants, `settleDebt`).
- Journal `payment_events` : aucune donnée personnelle ni secret ; à l'effacement du profil, le justificatif est conservé sans lien avec le joueur (`player_id` NULL).

## Publicité récompensée (2ᵉ chance : `server/ads.ts`)
- 1ʳᵉ mort : publicité **ou** 5 Prismes ; 2ᵉ mort : 10 Prismes seulement ; 3ᵉ mort : fin. Jamais de 4ᵉ vie. Le record de la première vie n'est jamais touché.
- Le client demande une **session** au service (`POST /api/ads/session`, unique par joueur + partie + vie) **avant** la publicité ; la récompense n'est accordée que sur confirmation **serveur à serveur** (AdMob SSV, signature ECDSA vérifiée, unité d'annonce autorisée), consommée une seule fois (`POST /api/ads/claim`). Publicité fermée / échouée / non confirmée = aucune reprise ; jamais de minuterie.
- L'option n'est affichée que si une publicité est prête ; sinon « indisponible » avec explication.

## Ce que le dépôt NE contient PAS (à fournir)
Le jeu n'embarque **aucun SDK** (règle de projet). Il attend deux **plugins Capacitor** natifs, à écrire/installer par l'éditeur (détection par `window.Capacitor`, `src/platform/plugins.ts`) :
- `PolarRiftBilling` : `isAvailable()`, `purchase({productId, accountToken})`, `pendingPurchases()`, `finish({…})` (StoreKit 2 / Google Play Billing).
- `PolarRiftAds` : `requestConsent()`, `load()`, `show({placement, userId, customData})` (AdMob, SSV : `userId` = profil, `customData` = identifiant de session).
Sans eux : build web = achats et publicité **indisponibles** (message explicatif, aucun bouton factice).

## Configuration externe exacte (à faire par le propriétaire)
**Apple** : compte développeur, app dans App Store Connect, 3 produits consommables (ci-dessus) approuvés, clé « In-App Purchase » (`APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY` en .p8, `APPLE_BUNDLE_ID`), URL de notifications serveur → `/api/payments/notify/apple`.
**Google** : compte Play Console, app et 3 produits consommables actifs, compte de service autorisé dans l'API Play (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PACKAGE_NAME`), notifications (Pub/Sub → `/api/payments/notify/google?token=<PLAY_NOTIFY_TOKEN>`).
**AdMob** : compte, application, bloc récompensé avec vérification côté serveur (SSV) → `/api/ads/ssv` ; `ADMOB_AD_UNIT_IDS` ; consentement (RGPD/UMP) géré par `PolarRiftAds.requestConsent`.
**Identifiant d'application** définitif (`com.example.polarrift` est provisoire) : requis par les deux magasins. Service hébergé en HTTPS, schéma v7, sauvegarde de la base avant redéploiement. **Politique de confidentialité** publique et déclarations des magasins (achats, publicité).
Variables : `deploy/env.example`. **Limite à vérifier en réel** : le remboursement Google n'est détecté que si l'API répond « annulé/remboursé » à la re-vérification.

## Tests
`tests/payments-server.test.ts` (33), `tests/payments-client.test.ts` (22), `tests/phase4-verify.test.ts` : fournisseurs **simulés** ; ils prouvent la logique (idempotence, falsification, autre profil, remboursement, coupures, pub validée/interrompue/dupliquée), **pas** un paiement réel.
