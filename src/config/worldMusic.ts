import audio from '../data/polar-rift-audio.json';
import musicMap from '../data/polar-rift-music-map.json';
import { WORLDS, worldIndexAt, worldStart } from './worlds';
import { W2_BEATS, W2_BEAT_PERIOD, W2_DROPS, W2_DROP_STRENGTH, W2_HITS, WORLD2_START } from './world2';
import { W3_BEATS, W3_BEAT_PERIOD, W3_DROPS, W3_DROP_STRENGTH, W3_HITS, WORLD3_START } from './world3';
import type { Rhythm } from '../sim/patterns';

/**
 * Musique du VOYAGE DES UNIVERS — un morceau (ou aucun) par univers, SOURCE UNIQUE.
 *
 * Montage temporel virtuel (jamais d'accélération du MP3) : chaque univers dure 120 s de jeu actif ; on choisit des portions du fichier,
 * raccordées sur des battements réels, pour que les moments forts tombent aux bons instants (montée finale juste avant la faille).
 * Univers 1 : morceau de la phase 1 (ci-dessous). Univers 2 : « Portal Surge », montage décrit par `config/world2.ts` (carte `polar-rift-world2.json`). Univers 3 : « Cosmic Impact », joué tel quel
 * (`config/world3.ts`, carte `polar-rift-world3.json`).
 * Univers sans morceau (`track: null`) : aucun battement inventé, l'ambiance visuelle tourne sans réaction musicale ; un fond atmosphérique
 * procédural discret (`pad`) peut jouer à la place (désactivable : `pad: null`).
 *
 * Intégrer un futur morceau (univers 3 ou 4) :
 *   1. déposer le MP3 dans src/assets/audio/, l'analyser (`npm run music-map`, ou scripts/analyze-phase2.py comme modèle) → JSON de repères ;
 *   2. remplir l'entrée de l'univers : `track`, `entry` (position de fichier à l'arrivée), `loop` éventuelle, `beats`/`drops` (depuis le JSON) ;
 *   3. rien d'autre à changer : la grille de rythme du gameplay (déterministe) et l'ambiance s'en servent automatiquement.
 */

export type TrackId = 'phase1' | 'world2' | 'world3';
export type PadId = 'nebula' | 'winds';

export interface WorldMusicDef {
  /** Morceau joué (null = aucun fichier disponible pour l'instant). */
  track: TrackId | null;
  /** Fond atmosphérique procédural (null = silence musical). */
  pad: PadId | null;
  /** Niveau de mixage relatif (1 = niveau de référence de la musique). */
  gain: number;
}

export const WORLD_MUSIC: Readonly<Record<number, WorldMusicDef>> = {
  1: { track: 'phase1', pad: null, gain: 1 },
  2: { track: 'world2', pad: null, gain: 1 },
  3: { track: 'world3', pad: null, gain: 1 },
  4: { track: null, pad: 'winds', gain: 0.6 },
};

/**
 * Univers 1 (morceau de la phase 1) : intro complète, puis la région en boucle reprise à `loopEntry` s (battement réel), raccord en fondu court.
 * Ainsi le passage fort de la boucle (136,1 s) tombe vers 108 s et la dernière montée (143,98 → 147,71 s) s'achève à ~119,9 s, sur la faille.
 */
export const WORLD1_PLAN = {
  loopEntry: 52.144,
  crossfade: 0.35,
} as const;

/**
 * Transition audio de 4 s (horloge Web Audio, jamais de minuteur) : l'ancien morceau baisse et se filtre pendant `fadeOut` s, un souffle
 * d'aspiration accompagne l'ouverture, le nouveau morceau entre filtré à partir de `fadeInFrom` s et atteint son plein niveau à l'arrivée.
 */
export const WORLD_TRANSITION_AUDIO = {
  fadeOut: 2.4,
  fadeInFrom: 1.6,
  /** Fréquence de coupure de départ du filtre passe-bas du nouveau morceau (Hz) puis ouverture complète à l'arrivée. */
  filterFrom: 700,
  /** Niveau du souffle d'aspiration (effet sonore). */
  whoosh: 0.5,
} as const;

/**
 * Garde de synchronisation jeu/musique (`audio/syncGuard.ts`) : écart toléré (s), durée pendant laquelle il doit persister avant un recalage (s) et délai
 * minimal entre deux recalages (s). Sur un appareil fluide l'écart reste à quelques millisecondes : la garde n'intervient jamais.
 */
export const WORLD_MUSIC_SYNC = { tolerance: 0.1, hold: 1.2, cooldown: 6 } as const;

/** Position de lecture (s depuis le début de la transition d'entrée) à laquelle démarre le montage de l'univers 2 (voir `config/world2.ts`). */
export { WORLD2_START, WORLD3_START };

const INTRO = audio.files.intro.decodedDurationSeconds;

function world1Beats(): number[] {
  const out: number[] = [];
  for (const b of musicMap.tracks.intro.beats) out.push(b);
  for (const b of musicMap.tracks.loop.beats) if (b >= WORLD1_PLAN.loopEntry) out.push(INTRO + (b - WORLD1_PLAN.loopEntry));
  return out.filter((t) => t < WORLDS.span);
}

function world1Drops(): number[] {
  const out: number[] = [...musicMap.tracks.intro.drops];
  for (const d of musicMap.tracks.loop.drops) if (d >= WORLD1_PLAN.loopEntry) out.push(INTRO + (d - WORLD1_PLAN.loopEntry));
  return out.filter((t) => t < WORLDS.span);
}

const BEATS1 = world1Beats();
const DROPS1 = world1Drops();

/** Repères de l'univers 2 en temps de jeu actif absolu (le temps local + le début de l'univers). */
const W2_T0 = worldStart(1);
const abs2 = (a: readonly number[]): number[] => a.map((t) => t + W2_T0);
const BEATS2 = abs2(W2_BEATS);

/** Repères de l'univers 3 en temps de jeu actif absolu (le morceau est joué tel quel : aucun montage). */
const W3_T0 = worldStart(2);
const abs3 = (a: readonly number[]): number[] => a.map((t) => t + W3_T0);
const BEATS3 = abs3(W3_BEATS);
const HITS3 = abs3(W3_HITS);
const DROPS3 = abs3(W3_DROPS);
const HITS2 = abs2(W2_HITS);
const DROPS2 = abs2(W2_DROPS);

function nextIn(list: readonly number[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? list[lo] : Infinity;
}

/**
 * Grille de rythme des univers (gameplay, DÉTERMINISTE) : battements et moments forts réels des morceaux, remis à l'échelle du montage.
 * Univers sans morceau : aucun battement (le premier « battement » est l'instant demandé : aucun décalage), aucun moment fort.
 */
export const WORLDS_RHYTHM: Rhythm = {
  nextBeat(t: number): number {
    const i = worldIndexAt(t);
    if (i === 0) {
      const b = nextIn(BEATS1, t);
      return b < WORLDS.span ? b : t;
    }
    if (i === 1) {
      const b = nextIn(BEATS2, t);
      return b < worldStart(2) ? b : t;
    }
    if (i === 2) {
      const b = nextIn(BEATS3, t);
      return b < worldStart(3) ? b : t;
    }
    return t;
  },
  nextAccent(t: number): number {
    const i = worldIndexAt(t);
    if (i === 0) return nextIn(DROPS1, t);
    if (i === 1) {
      const d = nextIn(DROPS2, t);
      return d < worldStart(2) ? d : Infinity;
    }
    if (i === 2) {
      const d = nextIn(DROPS3, t);
      return d < worldStart(3) ? d : Infinity;
    }
    return Infinity;
  },
  beatPeriodAt(t: number): number {
    const i = worldIndexAt(t);
    return i === 0 ? musicMap.beatPeriod : i === 1 ? W2_BEAT_PERIOD : i === 2 ? W3_BEAT_PERIOD : 0.5;
  },
  /** Prochaine percussion (univers 2 et 3 ; Infinity ailleurs) : attaque des arcs rampants. */
  nextHit(t: number): number {
    const i = worldIndexAt(t);
    if (i === 1) {
      const h = nextIn(HITS2, t);
      return h < worldStart(2) ? h : Infinity;
    }
    if (i === 2) {
      const h = nextIn(HITS3, t);
      return h < worldStart(3) ? h : Infinity;
    }
    return Infinity;
  },
  /** Prochain GRAND impact d'au moins `minStrength` (0–1) : déclenchement des ondes de rupture. */
  nextImpact(t: number, minStrength: number): number {
    const w = worldIndexAt(t);
    if (w === 1) {
      for (let i = 0; i < DROPS2.length; i++) if (DROPS2[i] >= t && W2_DROP_STRENGTH[i] >= minStrength) return DROPS2[i];
    } else if (w === 2) {
      for (let i = 0; i < DROPS3.length; i++) if (DROPS3[i] >= t && W3_DROP_STRENGTH[i] >= minStrength) return DROPS3[i];
    }
    return Infinity;
  },
};

/** Repères exposés aux tests et aux outils. */
export const WORLD_RHYTHM_DATA = { beats1: BEATS1, drops1: DROPS1, beats2: BEATS2, hits2: HITS2, drops2: DROPS2, beats3: BEATS3, hits3: HITS3, drops3: DROPS3 } as const;
