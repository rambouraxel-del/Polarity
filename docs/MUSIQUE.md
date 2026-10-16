# Musique de partie

Intro (une fois) → boucle (aussi longtemps que la partie dure) → outro (à la fin de la partie). Trois MP3 stéréo 44,1 kHz / 112 kbit/s, **2,71 Mo au total** :

| Fichier (`src/assets/audio/`) | Durée utile | Poids |
|---|---:|---:|
| `polar-rift-intro.mp3` | 24,285 s | 340 890 o |
| `polar-rift-loop.mp3` | 153,170 s (+ 2 × 120 ms de garde) | 2 148 615 o |
| `polar-rift-outro.mp3` | 15,695 s | 220 570 o |

## Où est quoi ?
- `src/data/polar-rift-audio.json` : repères fournis avec les fichiers, **utilisés tels quels** ; `src/config/music.ts` : constantes (niveau, fondus) dérivées du JSON.
- `src/audio/music.ts` : classe `Music` (programmation Web Audio) ; `src/audio/sfx.ts` : contexte, volume et sourdine **réutilisés** (la musique se branche sur la sortie du jeu) ; `src/app.ts` : points d'appel.
- `tests/music.test.ts` (faux contexte audio) et section « Musique » de `scripts/e2e.mjs` (vrai navigateur, vrais MP3, rendus hors ligne).

## Fonctionnement
- **Au lancement d'une partie** (`startRun`, tous les modes) : intro à `t0` (dans le futur, `currentTime + 60 ms`), arrêt à `T = t0 + 24,285 s`. Le nœud de boucle est programmé à `T − 20 ms`, offset `0,100 s` (dans sa garde), avec des rampes de gain complémentaires sur `[T − 20 ms, T]`.
- **Boucle** : un seul nœud `loop = true`, `loopStart = 0,12`, `loopEnd = 153,29002267573696` — jamais le MP3 entier. Aucun `setTimeout`, aucun `ended`, aucune boucle de rendu ne relance la musique : une partie d'une heure ne crée **aucun** nœud ni buffer supplémentaire.
- **Fin de partie** (`ending`, dès l'impact ou la victoire — l'écran de résultat n'attend pas) : fondu de 1,2 s de la musique active vers l'outro ; une boucle programmée mais pas encore démarrée (défaite pendant l'intro) est annulée et libérée. L'outro joue jusqu'au bout pendant l'écran de résultat ; **Rejouer** reste actif.
- **Relance immédiate** : l'outro (ou la musique) sort en 150 ms, l'intro repart ensuite : aucune superposition.
- **Partie quittée** sans résultat (retour au menu) : fondu de 0,6 s, sans outro.
- **Pause** : la musique s'arrête avec un fondu de 60 ms ; **reprise** (après le compte à rebours) : elle repart de la même position musicale (raccord intro → boucle recalé si on est dans l'intro ; décalage dans la région en boucle sinon).
- **Arrière-plan** : la partie se met en pause (donc la musique) et le contexte audio est suspendu par `Sfx` ; au retour la reprise reste volontaire.
- **Volume et sourdine** : ceux du jeu (nœud maître de `Sfx`) ; niveau de la musique réglable dans `MUSIC.gain`.
- **Mobile** : le contexte est créé et repris au premier geste du joueur (`Sfx.unlock()`), qui lance aussi le téléchargement et le décodage (intro, boucle, puis outro). Rien n'est chargé avant. Si le décodage n'est pas fini au tout premier lancement, la musique démarre dès qu'il l'est (et seulement si la partie est toujours en cours).
- **Mémoire** : un seul jeu de buffers décodés, jamais dupliqué ni rechargé (≈ 68 Mo de PCM à 44,1 kHz, dont ≈ 54 Mo pour la boucle ; plus si le contexte tourne à 48 kHz).

## Séquence de cinq minutes et phase 2
Phase 1 : intro, un tour de boucle, puis un second tour qui **entre dans la boucle à `PHASE1_PLAN.secondPassFrom`** (fondu enchaîné de 0,5 s calé sur un battement, programmé tardivement par `Music.maintain()`) : la montée finale de la boucle (intensité maximale vers 150 s) tombe sur 300 s. Phase 2 : le morceau joint (`polar-rift-phase2.mp3`, jamais réencodé) entre en fondu pendant la traversée et boucle sans trou (fondu enchaîné de 2 s à puissance constante, en phase de battement, entre `loopStart` et `loopEnd` ; le silence final n'est jamais lu) ; fin de partie en phase 2 : fondu sans l'outro de la phase 1. **Reprise payée (2ᵉ ou 3ᵉ vie)** : la musique repart là où elle s'était arrêtée à la mort (`Music.resumeAfterDeath()` : même morceau, même position), jamais du début. Détails, valeurs analysées et budget mémoire : `docs/PHASES.md`.

## Mixage, niveaux et saturation
- Chaîne : voix de la musique → **bus musique** (`MUSIC.gain` 0,5 × mixage joueur²) → **sortie générale** (volume général² × 0,5, sourdine) → destination ;
  effets sonores → **bus effets** (mixage joueur²) → même sortie générale. Un seul contexte, un seul volume général, une seule sourdine.
- Niveaux mesurés des MP3 décodés (`ffmpeg`) : crêtes −5,4 / −4,0 / −3,7 dBFS (intro / boucle / outro), aucun échantillon > 1,0, RMS −21 / −17,7 / −15,7 dBFS.
  Pire cas simultané (musique + effets les plus forts) ≈ (0,65 × 0,5 + 0,75 + 0,25) × 0,5 < 1 : **aucune saturation propre au jeu** (testé).
  Les écarts de sonie entre morceaux (intro plus douce, outro plus forte) sont ceux du mastering : volontaires (montée puis final), non corrigés.
- Raccord de boucle vérifié sur l'audio : saut au point de boucle = 0,8 × le pas médian du signal (inaudible) ; longueurs décodées = repères du JSON.
- **Écoute d'essai** : relâcher le curseur « Musique » des options joue 2,5 s de la boucle (`Music.audition`), sans effet pendant une partie.

## Position de lecture (ambiance visuelle)
`Music.position(out)` donne la position **entendue** (latence de sortie déduite) : intro, puis boucle (temps dans la région en boucle), puis outro ; figée en pause, nulle sans musique décodée ; `playing` faux si le contexte audio n'est pas « running » (suspendu, ou « interrupted » sur Safari iPhone). Lecture seule : elle ne programme rien et ne change pas le son. Utilisée par l'ambiance de la Survie avec la carte `src/data/polar-rift-music-map.json` (voir `docs/AMBIANCE.md`).

## Vérifications
- Tests unitaires (`npm test`) : repères exacts du JSON, poids des fichiers, programmation (intro/boucle/rampes), absence de minuteur, un seul nœud en boucle après une heure simulée, buffers uniques, fin pendant l'intro / la boucle, relances rapides, pause/reprise.
- `npm run e2e` (Chromium, vrais fichiers) : MP3 chargés une fois et seulement après le premier geste, défaite pendant l'intro et la boucle, résultat et Rejouer pendant l'outro, ×4 redémarrages rapides, pause/reprise, arrière-plan, sourdine, passage intro → boucle en temps réel, partie quittée, puis **rendus hors ligne** des raccords : saut maximal au raccord intro → boucle et au retour de boucle (≈ 177,5 s) de l'ordre de 0,4 × le pas normal du signal, aucun silence, outro seule puis silence après une défaite (la boucle ne démarre jamais), relances rapides sans superposition, reprise à la même position (corrélation ≈ 1).
- **À faire : écoute sur Safari iPhone** (décodage MP3, respect du délai/padding LAME, raccords audibles, déverrouillage du son, pause en arrière-plan). Non validé sur appareil réel.
