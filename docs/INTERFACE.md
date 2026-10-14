# Interface — direction artistique « Néon premium » (nom affiché : Polar Rift)

## Références et assets
| Fichier | Usage |
|---|---|
| `src/assets/ui/logo.webp` (master PNG : `art/source/logo.png`) | Logo « Polar Rift » transparent fourni (WebP 1200 px), **utilisé directement** sur l'accueil (jamais recadré ni redessiné) |
| `art/reference/menus.jpg`, `art/reference/accueil.jpg` | Planche des menus et maquette d'accueil : **références visuelles uniquement**, jamais affichées dans le jeu |

Les écrans sont reconstruits en HTML/CSS réel (vrais textes, vrais boutons, états survol / focus / actif / désactivé). Scores, étoiles,
niveaux, apparences et succès viennent toujours de la sauvegarde (`SaveData`) : les illustrations de la planche n'en remplacent aucun.

## Nom et sauvegarde
- `src/config/brand.ts` : `GAME_NAME` (« Polar Rift » : un seul endroit à modifier ; repris dans `index.html` par `vite.config.ts`, l'accueil, les options, le titre de l'onglet).
- `STORAGE_NAMESPACE = 'polarite'` : **ne jamais le changer** — les clés `polarite.save`, `polarite.save.avant-v1`, `polarite.save.avant-eq2`, `polarite.save.corrompue` gardent la progression (testé).

## Tokens centralisés (`src/ui/theme.ts`)
Couleurs, polices, rayons et durées sont définis **une seule fois** dans `THEME`, écrits en variables CSS (`--c-*`, `--c-*-rgb`, `--font-*`, `--r-*`, `--t-*`) par `applyTheme()`
avant l'affichage. Les feuilles CSS n'ont aucune couleur en dur (tests : `tests/ui.test.ts`) ; le rendu Phaser lit les mêmes couleurs via `hexNum()`.
Les couleurs de l'arène (fond `#070B1F`, quadrillage `#16204A`, orbite `#39F3FF`, menaces) sont inchangées.

Palette : bleu nuit, cyan (interface), blanc (texte), or (étoiles, records), corail (dangers, échec), panneaux sombres translucides.
Contraste du texte sur panneau et sur bouton principal ≥ 4,5 (WCAG AA), vérifié par test.

## Organisation
- `src/styles/` : `index.css` (point d'entrée), `base.css`, `components.css` (boutons, panneaux, étoiles, interrupteurs, curseur, onglets, réglages…), `screens.css`, `hud.css`.
- `src/ui/components.ts` : composants HTML (`button`, `screenHead`, `stat`, `switchButton`, `setting`, `notice`, `tabs`) ; `src/ui/icons.ts` : icônes SVG en ligne ; `src/ui/screens.ts` : écrans.
- Police **Orbitron** (SIL OFL 1.1) embarquée localement par `@fontsource/orbitron` (graisses 700 et 800, latin) : aucune requête externe. Texte courant : polices du système.

## Écrans
Accueil (logo, Survie dominante, Niveaux, Défi quotidien, puis Apparences / Succès / Options), Niveaux (grille 12 cartes : terminé, à jouer, verrouillé), Défi quotidien,
Apparences et Succès (onglets d'un même écran), Options, confirmation d'effacement, Pause (Reprendre en premier), Résultat (Rejouer en premier). HUD : même mise en page et mêmes tailles qu'avant, harmonisé par les variables.

## Fond spatial et transitions
- `src/ui/space.ts` : fond 2D dans `<canvas id="space">`, **visible seulement dans les menus** (masqué pendant une partie : l'arène garde son décor sobre et son quadrillage). Étoiles, nébuleuse et planète lointaine
  prérendues ; scintillement léger limité à 30 i/s, résolution plafonnée (DPR ≤ 1,5). Décor purement décoratif (`Math.random`, jamais le générateur du jeu).
- **Effets réduits** (option, ou `prefers-reduced-motion`) : fond statique, pas d'animation d'écran (`html[data-fx='reduced']`).
- Transitions d'écran : fondu + léger glissement (`screen-in`, `pop-in`) ; pas de rejeu lors des mises à jour sur place (onglets, interrupteurs).

## Adaptation
Portrait mobile (320 px et plus), paysage bas (accueil sur deux colonnes), ordinateur ; marges de sécurité (`env(safe-area-inset-*)`), cibles tactiles ≥ 40 px (vérifié en e2e), aucun défilement horizontal (vérifié en e2e sur 4 tailles).

## Aide aux contrôles
`src/ui/controls.ts` choisit le texte selon le pointeur principal (`pointer: coarse`) : mobile « Touchez l'écran pour inverser la direction » ; ordinateur « Cliquez ou appuyez sur Espace… Échap : pause ». Utilisé par l'accueil et le bandeau de la première partie / du niveau 1.

## Apparences
Grand aperçu animé, grille de cartes, bouton « Équiper », conditions de déblocage : voir `docs/APPARENCES.md`.

## Menus Cosmétiques, Succès, Classement (v1.6)
- **Cosmétiques** remplace Apparences + Boutique : catégories Vaisseaux / Traînées / Packs, filtres Tous / Possédés / À débloquer, grand aperçu animé, description, prix ou condition, action Acheter / Équiper / Équipé / Succès requis (+ Solde insuffisant, Bientôt disponible). Soldes affichés une seule fois en haut.
- **Succès** : par catégorie, progression (n / objectif), gain en Éclats, cosmétique lié, état (obtenu, récompense reçue).
- **Classement** : état du service, profil (pseudo), top 100, rang, résultats récents (en attente / validé / non validé), version d'équilibrage. Voir `docs/CLASSEMENT.md`.

## Consolidation V1 (sauvegarde et interfaces associées)
- **Accueil** : avertissements éventuels (`SaveNotices`) — stockage refusé (`role="alert"`), sauvegarde illisible ou plus récente ; bandeau de rattrapage des récompenses de succès (une fois lu, il ne revient pas) ; sous-titre de la campagne « Chapitre 1 · Douze ans de silence ».
- **Cosmétiques** : message d'achat (succès ou refus, `role="status"` / `role="alert"`), prix ajusté des packs partiels, aperçu réduit sur téléphone (`24dvh`) pour que prix, note et bouton restent à l'écran. États **toujours en texte** (Acheter, Solde insuffisant, Succès requis, Bientôt disponible, Possédé, Équiper, Équipé) : la couleur ne porte jamais seule l'information ; boutons inactifs réellement `disabled`.
- **Options** : sections Son / Musique / Effets sonores / Intensité visuelle / Effets réduits (voir `docs/AMBIANCE.md`) et **« Sauvegarde et données »** : la progression est enregistrée dans ce navigateur, sur cet appareil ; pas de synchronisation automatique avec un autre appareil, un autre navigateur ni une application native ; navigation privée ou vidage des données = effacement ; le profil du classement est lui aussi lié au navigateur.
- **Classement hors ligne ou non activé** (non configuré : bouton « Classement » masqué à l’accueil) : message en français courant (aucun chemin de document ni variable technique), « Réessayer » seulement, record local toujours visible, résultats « en attente » envoyés plus tard ; aucun faux bouton.
- **Tailles tactiles** : toutes les cibles ≥ 44 px (filtres et curseurs relevés) ; onglets de la boutique sans débordement à 320 px. Vérifié sur captures 390×844 et 320×568 (accueil, campagne, boutique, succès, options, effacement, classement, pause, résultat).
- **Pause** : précise que « Recommencer » et le retour au menu abandonnent la partie en cours (non enregistrée).
