# Campagne — chapitre 1 « Le signal impossible » (Écho-7)

Mode narratif jouable : 10 missions reliées, histoire courte (transmissions passables et relisibles), progression par étoiles, hangar d'améliorations.
Il **réutilise** les mécaniques existantes (orbite, inversion, balises, directeur de vagues, validateur d'évitement) : pas de nouveau déplacement, pas de tir.

## Où est quoi ?
| Fichier | Rôle |
|---|---|
| `src/config/campaign.ts` | **Source unique** : missions (objectif, limite, vitesse, script, défi secondaire), récompenses, améliorations et leurs effets, objets de mission |
| `src/config/story.ts` | Dialogues (15 séquences de 2–4 répliques), personnages (NOVA, SIGNAL, DÉFENSES, SYSTÈME) — identifiants de séquence enregistrés dans la sauvegarde : ne jamais les changer |
| `src/campaign/simulation.ts` | `CampaignSimulation` (hérite de `Simulation`, **sans modifier `src/sim/`**) : objectifs, objets, bouclier, collecteur, stabilisateur, transmissions |
| `src/campaign/progress.ts` | Étoiles, récompenses uniques, déblocages, journal, hangar (achat / activation), fin de chapitre |
| `src/campaign/bot.ts` | `MissionBot` : joueur automatique pour les tests de faisabilité |
| `src/ui/campaignScreens.ts`, `src/styles/campaign.css` | Écrans : campagne, carte des missions, fiche, hangar, journal, dialogue, bilan |
| `src/render/ArenaRenderer.ts` | Objets de mission (triangle / losange / hexagone vert menthe), anneau et clignotement du bouclier — effets codés |
| `tests/campaign-*.test.ts`, `scripts/e2e.mjs` (section Campagne) | Tests |

## Garanties (Survie, classement)
- `src/sim/*` n'est **pas modifié** : la Survie, le défi quotidien, les niveaux et la simulation de rejeu du serveur restent identiques. `BALANCE_VERSION` inchangée.
- `createSimulation` (utilisée par le serveur) refuse le mode `campaign`. Aucune partie de campagne n'est envoyée au classement (le ticket de Survie n'est jamais attribué à une mission).
- Les améliorations ne sont lues que par `CampaignSimulation` (`RunConfig.upgrades`, renseigné seulement pour `mode: 'campaign'`).
- Sauvegarde **format 5** : champ `campaign` (missions, transmissions vues, améliorations, fin de chapitre). Migration v4 → v5 : champ vide, tout le reste conservé ; copie `polarite.save.avant-v4`.

## Missions
Durées = temps de jeu actif (la pause les arrête). Les missions de collecte se terminent dès l'objectif atteint (limite 90 s sauf indication).

| # | Titre | Objectif | Défi secondaire |
|---|---|---|---|
| 1 | Réveil en orbite | Survivre 45 s (astéroïdes simples) | ≥ 12 balises |
| 2 | Remettre le relais en ligne | 6 balises en < 60 s | < 25 s |
| 3 | Des coordonnées effacées | 3 fragments temporaires successifs (un fragment manqué réapparaît) | < 35 s |
| 4 | Le passage des convois | Survivre 60 s (convois) | multiplicateur ×3 |
| 5 | La boîte noire | 2 cycles de balises, puis récupérer la boîte noire | < 50 s |
| 6 | Tempête ionique | Survivre 3 séquences électriques (75 s) | ≥ 14 balises |
| 7 | Débris instables | 3 données au milieu d'astéroïdes fragmentés | < 55 s |
| 8 | Les défenses d'Écho-7 | 3 verrous (1 cycle chacun) ; laser balayeur | < 55 s |
| 9 | Une voix derrière la porte | Survivre 90 s (pluie de météores, tempête, respirations) | ≥ 5 cycles |
| 10 | Ouvrir le sas | 3 verrous, 3 phases : astéroïdes → électricité → combinaison | < 55 s |

Mécanique commune : difficulté croissante avec **respirations** (aucune nouvelle vague), vitesse du vaisseau **réglée par mission** (pas la courbe temporelle de la Survie), phases scénarisées par fenêtres de motifs (ou par cycles, mission 10) validées par le validateur d'évitement du directeur, trajectoires issues de la graine de la tentative (reproductibles, variées d'une tentative à l'autre). Les transmissions affichées en jeu tombent dans des respirations.

## Progression et récompenses (modifiables dans `config/campaign.ts`)
- Étoile 1 : objectif principal (aucun score minimal) → débloque la mission suivante. Étoile 2 : défi propre à la mission. Étoile 3 : réussir **sans déclencher le bouclier** (aussi sans le posséder).
- Éclats : première réussite **30** (**60** mission 10) ; chaque étoile secondaire obtenue pour la première fois **10** ; réussites suivantes **5** (aucun bonus unique répété). Étoile et récompense passent de faux à vrai dans la même modification de la sauvegarde : jamais de double crédit.
- Fin du chapitre : apparence **Écho** (coque blanche, accents violets) dans les cosmétiques (« Campagne requise » avant).

## Hangar (améliorations permanentes, un seul niveau, activables, campagne uniquement)
| Amélioration | Prix | Présentée après | Effet (`UPGRADE_EFFECTS`) |
|---|---|---|---|
| Bouclier de secours | 100 | mission 3 | Absorbe 1 collision par tentative, puis 1 s d'invulnérabilité (une collision pendant ce délai ne consomme rien). Anneau, clignotement, son, bandeau HUD |
| Collecteur amélioré | 75 | mission 5 | Arc de collecte des balises +0,05 rad, rayon des objets de mission ×1,5 (la collision avec les dangers est inchangée) |
| Stabilisateur orbital | 75 | mission 5 | +0,4 s de répit après les cycles qui en accordent déjà un (base 0,8 s), cumul borné par `RESPITE.maxPerWave` ; ne retire aucune menace active |

Achat en Éclats avec confirmation (solde vérifié, débit et possession dans la même modification). Amélioration activée à l'achat ; (dés)activation libre ; relue à chaque tentative.

## Menus
Accueil : **Campagne** (remplace « Niveaux ») → carte des chapitres (Écho-7 ; chapitre 2 « À venir ») → carte des missions → fiche → Lancer. Depuis la campagne : Hangar, Journal des transmissions, **Défis classiques** (les 12 niveaux d'origine, progression et récompenses inchangées).
Transmissions : montrées automatiquement une seule fois (introduction avant la mission, conclusion après la réussite), passables, relisibles au journal ; rejouer ne les répète pas.

## À valider avec de vrais joueurs
Les bots (joueur parfait) réussissent les 10 missions sur toutes les graines testées : cela prouve la **faisabilité**, pas le ressenti. À régler dans `config/campaign.ts` si besoin : `speed`, `difficulty`, `phases`/`weights`, durées de vie des objets, seuils des défis, prix et effets des améliorations. Voir `PROGRESS.md`.
