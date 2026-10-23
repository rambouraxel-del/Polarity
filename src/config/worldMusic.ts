import audio from '../data/polar-rift-audio.json';
import musicMap from '../data/polar-rift-music-map.json';
import phase2 from '../data/polar-rift-phase2.json';
import { WORLDS, worldIndexAt, worldStart } from './worlds';
import type { Rhythm } from '../sim/patterns';

/**
 * Musique du VOYAGE DES UNIVERS — un morceau (ou aucun) par univers, SOURCE UNIQUE.
 *
 * Montage temporel virtuel (jamais d'accélération du MP3) : chaque univers dure 120 s de jeu actif ; on choisit des portions du fichier,
 * raccordées sur des battements réels, pour que les moments forts tombent aux bons instants (montée finale juste avant la faille).
 * Univers sans morceau (`track: null`) : aucun battement inventé, l'ambiance visuelle tourne sans réaction musicale ; un fond atmosphérique
 * procédural discret (`pad`) peut jouer à la place (désactivable : `pad: null`).
 *
 * Intégrer un futur morceau (univers 3 ou 4) :
 *   1. déposer le MP3 dans src/assets/audio/, l'analyser (`npm run music-map`, ou scripts/analyze-phase2.py comme modèle) → JSON de repères ;
 *   2. remplir l'entrée de l'univers : `track`, `entry` (position de fichier à l'arrivée), `loop` éventuelle, `beats`/`drops` (depuis le JSON) ;
 *   3. rien d'autre à changer : la grille de rythme du gameplay (déterministe) et l'ambiance s'en servent automatiquement.
 */

export type TrackId = 'phase1' | 'phase2';
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
  2: { track: 'phase2', pad: null, gain: 1 },
  3: { track: null, pad: 'nebula', gain: 0.55 },
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

/** Position de fichier du morceau de l'univers 2 au temps 0 de cet univers : la transition consomme ses 4 premières secondes. */
export const WORLD2_ENTRY = WORLDS.transition;

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

/** Instant de jeu (univers 2) d'une position de fichier `p` (première lecture). */
const w2 = (p: number): number => worldStart(1) + (p - WORLD2_ENTRY);

function world2Drops(): number[] {
  return phase2.drops.filter((d) => d > WORLD2_ENTRY).map(w2).filter((t) => t < worldStart(2));
}

const BEATS1 = world1Beats();
const DROPS1 = world1Drops();
const DROPS2 = world2Drops();

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
      const P = phase2.beatPeriod;
      const t0 = w2(phase2.firstBeat);
      return t0 + Math.max(0, Math.ceil((t - t0) / P - 1e-9)) * P;
    }
    return t;
  },
  nextAccent(t: number): number {
    const i = worldIndexAt(t);
    if (i === 0) return nextIn(DROPS1, t);
    if (i === 1) return nextIn(DROPS2, t);
    return Infinity;
  },
  beatPeriodAt(t: number): number {
    const i = worldIndexAt(t);
    return i === 0 ? musicMap.beatPeriod : i === 1 ? phase2.beatPeriod : 0.5;
  },
};

/** Repères exposés aux tests et aux outils. */
export const WORLD_RHYTHM_DATA = { beats1: BEATS1, drops1: DROPS1, drops2: DROPS2 } as const;
