import timing from '../data/polar-rift-audio.json';
import introUrl from '../assets/audio/polar-rift-intro.mp3';
import loopUrl from '../assets/audio/polar-rift-loop.mp3';
import outroUrl from '../assets/audio/polar-rift-outro.mp3';

/**
 * Musique de partie : intro (une fois) → boucle (aussi longtemps que la partie dure) → outro (à la fin de la partie).
 *
 * Les repères viennent de `src/data/polar-rift-audio.json` (fournis avec les fichiers) et sont utilisés EXACTEMENT :
 * la boucle contient 120 ms de garde de chaque côté, on ne répète jamais le MP3 entier (`loopStart` / `loopEnd`).
 * Voir docs/MUSIQUE.md.
 */
export const MUSIC = {
  urls: { intro: introUrl, loop: loopUrl, outro: outroUrl },
  /** Durée de lecture de l'intro (s). */
  introDuration: timing.files.intro.decodedDurationSeconds,
  /** Région en boucle du fichier de boucle (s dans le fichier décodé). */
  loopStart: timing.files.loop.loopStartSeconds,
  loopEnd: timing.files.loop.loopEndSeconds,
  loopDuration: timing.files.loop.loopDurationSeconds,
  /** Fondu enchaîné intro → boucle (s) : la boucle démarre dans sa garde, 20 ms avant la fin de l'intro. */
  introCrossfade: timing.crossfadeIntroSeconds,
  /** Fondu de la musique active vers l'outro à la fin de la partie (s). */
  outroCrossfade: timing.crossfadeOutroSeconds,
  /** Niveau de la musique avant le volume du joueur (le volume et la sourdine du jeu s'appliquent ensuite). */
  gain: 0.5,
  /** Décalage de démarrage dans le futur (s) pour que le raccord soit programmé sur l'horloge audio. */
  startDelay: 0.06,
  /** Fondu court de l'outro (ou de la musique) quand une nouvelle partie démarre (s). */
  restartFade: 0.15,
  /** Fondu à la mise en pause (s). */
  pauseFade: 0.06,
  /** Fondu quand la partie est quittée sans résultat (retour au menu) (s). */
  quitFade: 0.6,
  /** Écoute d'essai du réglage « Musique » (options) : durée (s) et position dans la boucle (s après loopStart) — un passage dense de la boucle. */
  auditionSeconds: 2.5,
  auditionFrom: 70,
} as const;

/** Offset de départ du nœud de boucle (s) : dans la garde, juste avant le point de boucle. */
export const LOOP_ENTRY_OFFSET = MUSIC.loopStart - MUSIC.introCrossfade;
