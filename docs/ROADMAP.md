# Évolutions futures (non implémentées)

Ces idées sont **volontairement exclues** de la v1.2 ; elles sont notées ici pour une prochaine mise à jour.

## Balise bonus temporaire
Une balise supplémentaire, visible quelques secondes, qui récompense un détour risqué (points ou bonus de combo), sans jamais donner d'avantage de survie
(pas de vie, pas de bouclier). À prévoir : emplacement choisi par le générateur avec la graine du défi quotidien, vérification que le détour reste évitable
(validateur d'évitement), bonus plafonné, effet visuel distinct des balises normales (forme, pas seulement la couleur), son discret.

## Secteurs thématiques des niveaux
Donner à chaque niveau (ou groupe de niveaux) un décor de secteurs électriques ou de zones thématiques mémorisables (par exemple un secteur « courant » fixe au niveau 3),
pour différencier davantage les 12 niveaux au-delà des motifs et du rythme. À prévoir : données dans `config/levels.ts`, annonces lisibles, seuils d'étoiles à recalibrer
avec `npm run sim`, tests de non-régression de la sauvegarde.

## Autres pistes déjà notées
- Classement en ligne (aucune dépendance serveur dans cette version).
- Vitesse du vaisseau au-delà de 100 % de la référence (plafonnée à 100 % pour cette version).
- Mesure GPU sur appareils mobiles réels.

## Campagne : niveaux 6 à 15
Les niveaux 1 à 5 de « Douze ans de silence » sont livrés (`docs/CAMPAGNE.md`) ; la suite du chapitre est annoncée « À venir ». Procédure d'ajout : `docs/CAMPAGNE.md`, « Ajouter les niveaux suivants ». Amélioration progressive du vaisseau (hangar) prévue : données conservées, désactivées.

## Améliorations de campagne payées en Éclats de campagne (logique prête, hangar fermé)
L'économie (v1.5) fournit le solde d'Éclats, les achats atomiques et le catalogue. Une future campagne pourrait proposer des améliorations achetées en Éclats ;
à définir : nature des améliorations (sans toucher aux interdits de conception : pas de statistiques de vaisseau ni d'avantage de survie), rattachement à `BALANCE_VERSION`,
migration de sauvegarde. **Non implémenté** dans cette version.

## Classement : durcissement anti-triche (pistes)
Le rejeu serveur garantit la cohérence avec les règles, pas l'humanité du joueur (voir `docs/CLASSEMENT.md`). Pistes : temps minimal entre ticket et soumission, détection statistique d'entrées trop régulières,
signalements, comptes vérifiés, files de rejeu et threads de travail pour la montée en charge.
