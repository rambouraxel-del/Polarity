# Interface — direction artistique « Néon premium » (nom affiché : Polarity)

## Références et assets
| Fichier | Usage |
|---|---|
| `src/assets/ui/logo.png` (copie : `art/source/logo.png`) | Logo PNG transparent fourni, **utilisé directement** sur l'accueil (jamais recadré ni redessiné) |
| `art/reference/menus.jpg`, `art/reference/accueil.jpg` | Planche des menus et maquette d'accueil : **références visuelles uniquement**, jamais affichées dans le jeu |

Les écrans sont reconstruits en HTML/CSS réel (vrais textes, vrais boutons, états survol / focus / actif / désactivé). Scores, étoiles,
niveaux, apparences et succès viennent toujours de la sauvegarde (`SaveData`) : les illustrations de la planche n'en remplacent aucun.

## Nom et sauvegarde
- `src/config/brand.ts` : `GAME_NAME` (« Polarity », provisoire : un seul endroit à modifier ; repris dans `index.html` par `vite.config.ts`, l'accueil, les options, le titre de l'onglet).
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
