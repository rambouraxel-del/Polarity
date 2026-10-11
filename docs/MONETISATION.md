# Pistes de rentabilité (non implémentées)

Cette version ne contient **aucune** publicité réelle, aucun achat intégré et aucune connexion à un service commercial.

## Principes retenus
- Accès gratuit et complet : tous les modes, niveaux et records sont disponibles sans paiement.
- Les performances ne dépendent jamais d'un paiement ou d'une publicité : pas de bonus de jeu, pas de vie supplémentaire.
- Aucun « continue » publicitaire dans une tentative comptant pour un record.
- Pas de publicité imposée après chaque partie courte.

## Possibilités futures
1. **Cosmétiques facultatifs** : apparences et palettes supplémentaires (le système `progression/skins.ts` existe déjà ;
   les couleurs des menaces restent réservées pour préserver la lisibilité).
2. **Publicités récompensées choisies par le joueur**, uniquement contre des récompenses cosmétiques
   (ex. débloquer une palette plus tôt), depuis l'écran Apparences — jamais pendant une partie.

## Interface technique prévue
`src/monetization/ads.ts` définit `RewardedAdProvider` (`isAvailable()`, `showRewarded(placement)`).
Par défaut `NoAdProvider` est actif : aucun SDK chargé, aucune requête réseau. Un intégrateur pourrait appeler
`setAdProvider(...)` au démarrage avec un adaptateur vers un fournisseur réel ; l'interface n'affiche alors un bouton
que si `isAvailable()` est vrai. Aucun bouton de ce type n'existe dans cette version (pas de bouton factice).

Aucun revenu n'est estimé ici : il faudrait des données d'audience réelles.
