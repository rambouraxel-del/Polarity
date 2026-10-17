import audio from '../data/polar-rift-audio.json';
import musicMap from '../data/polar-rift-music-map.json';
import phase2 from '../data/polar-rift-phase2.json';

/**
 * Phases de la Survie — TOUS les réglages sont ici (source unique).
 *
 *  Phase 1 : 0 → 300 s de survie ACTIVE (décor spatial, orbite, palette stable).
 *  Faille : le noyau central existe dès le départ, devient une faille dès `coreGrowFrom` ; à 300 s de survie active, la TRAVERSÉE
 *           (`transit`, 6 s) aspire l'arène. La traversée n'est pas du temps de jeu : la simulation n'avance pas (voir game/session.ts).
 *  Phase 2 : infinie, univers fracturé et électrique, nouvelles menaces (config/survival.ts, sim/patterns.ts).
 *  Phase 3 : arrivera plus tard (la table des primes la prévoit déjà, sans effet).
 *
 * Reproductibilité : le gameplay ne lit JAMAIS l'audio. Les accents « sur le rythme » viennent des grilles ci-dessous, calculées une fois
 * depuis les analyses hors ligne (src/data/*.json) : mêmes instants chez le joueur et chez le service qui rejoue la partie, volume coupé ou non.
 */

/** Pas de simulation par seconde (voir SIM.dt = 1/120). */
const HZ = 120;

export const PHASES = {
  /** Passage en phase 2 : secondes de survie ACTIVE. */
  phase2At: 300,
  /** Pas de simulation auquel la phase 2 commence (la traversée a lieu juste avant). */
  phase2Step: 300 * HZ,
  /** Durée de la traversée (s) : tout est suspendu (commandes, dangers, collisions, chronomètre, score, bonus). */
  transit: 6,
  /** Le noyau devient progressivement une faille à partir de cet instant (s de survie active) ; rien n'est affiché en texte. */
  coreGrowFrom: 270,
  /** Plus aucune vague dans les dernières secondes avant la traversée (le noyau domine l'écran). */
  quietBefore: 2.5,
  /** Phase 2 : délai avant la première vague après la traversée (s) et difficulté de reprise (sans hausse brutale). */
  firstWaveDelay: 2.4,
} as const;

/** Prime d'Éclats par NOUVELLE phase franchie (première vie d'une partie admissible, une fois par partie). Croissante selon la phase. */
export const PHASE_BONUS: Readonly<Record<number, number>> = {
  /** ≈ deux fois les Éclats collectés sur l'orbite pendant les 5 premières minutes (~70) ; trois Boost. */
  2: 150,
  /** Phase 3 : à venir (valeur prévue, sans effet tant que la phase n'existe pas). */
  3: 300,
};

// ————————————————————————————————————————————— grilles de rythme (instants de jeu actif, en secondes)

/**
 * Lecture de la musique de phase 1 sur cinq minutes : intro, un tour de boucle complet, puis un second tour qui ENTRE dans la boucle à
 * `secondPassFrom` (secondes depuis le début de la région en boucle, calé sur un battement) pour que la montée finale de la boucle
 * (intensité maximale vers 150 s) tombe sur 300 s, au moment où le noyau s'ouvre. Raccord : fondu enchaîné court, en phase.
 */
export const PHASE1_PLAN = {
  secondPassFrom: 27.614,
  crossfade: 0.5,
} as const;

const INTRO = audio.files.intro.decodedDurationSeconds;
const LOOP = audio.files.loop.loopDurationSeconds;

function phase1Beats(): number[] {
  const out: number[] = [];
  for (const b of musicMap.tracks.intro.beats) out.push(b);
  const loop = musicMap.tracks.loop.beats;
  for (const b of loop) out.push(INTRO + b);
  // Second tour : la boucle reprend à `secondPassFrom`
  const t2 = INTRO + LOOP;
  for (const b of loop) if (b >= PHASE1_PLAN.secondPassFrom) out.push(t2 + (b - PHASE1_PLAN.secondPassFrom));
  return out.filter((t) => t < PHASES.phase2At + 1);
}

function phase1Drops(): number[] {
  const out: number[] = [];
  for (const d of musicMap.tracks.intro.drops) out.push(d);
  for (const d of musicMap.tracks.loop.drops) out.push(INTRO + d);
  const t2 = INTRO + LOOP;
  for (const d of musicMap.tracks.loop.drops) if (d >= PHASE1_PLAN.secondPassFrom) out.push(t2 + (d - PHASE1_PLAN.secondPassFrom));
  return out.filter((t) => t < PHASES.phase2At);
}

/** Position de lecture (s de fichier) correspondant à l'instant de jeu 0 de la phase 2 : la traversée consomme les 6 premières secondes du morceau. */
export const PHASE2_ENTRY_POSITION = PHASES.transit;

export const PHASE2_MUSIC = {
  file: phase2.file,
  beatPeriod: phase2.beatPeriod,
  firstBeat: phase2.firstBeat,
  loopStart: phase2.loopStart,
  loopEnd: phase2.loopEnd,
  loopDuration: phase2.loopEnd - phase2.loopStart,
  /** Fondu enchaîné de boucle (s) : les deux zones superposées sont alignées sur la grille de battements. */
  crossfade: phase2.crossfade,
  /** Fondu sortant à la fin de partie en phase 2 (s). */
  endFade: 1.6,
  /** Fondus de la traversée : la musique de phase 1 sort pendant `fadeOut`, celle de phase 2 entre pendant toute la traversée. */
  fadeOut: 3.5,
  fadeIn: PHASES.transit,
} as const;

/** Instants de jeu (phase 2) correspondant à une position de fichier `p` pendant la première lecture (avant le premier raccord de boucle). */
const g2 = (p: number): number => PHASES.phase2At + (p - PHASE2_ENTRY_POSITION);

function phase2Drops(until: number): number[] {
  const out: number[] = [];
  const L = PHASE2_MUSIC.loopDuration;
  for (const d of phase2.drops) if (d > PHASE2_ENTRY_POSITION && d < PHASE2_MUSIC.loopEnd) out.push(g2(d));
  // Tours de boucle suivants : seuls les repères de la région en boucle reviennent
  for (let n = 1; g2(PHASE2_MUSIC.loopEnd) + (n - 1) * L < until; n++) {
    for (const d of phase2.drops) if (d >= PHASE2_MUSIC.loopStart && d < PHASE2_MUSIC.loopEnd) out.push(g2(d) + n * L);
  }
  return out;
}

const BEATS1 = phase1Beats();
const DROPS1 = phase1Drops();
/** Les repères de phase 2 sont précalculés pour 4 heures de survie (au-delà, on retombe sur la grille régulière). */
const DROPS2 = phase2Drops(PHASES.phase2At + 4 * 3600);

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

/** Premier battement de la grille de rythme à l'instant `t` ou après. Phase 1 : battements réels de la musique ; phase 2 : grille régulière. */
export function nextBeat(t: number): number {
  if (t < PHASES.phase2At) {
    const b = nextIn(BEATS1, t);
    if (b < PHASES.phase2At) return b;
    t = PHASES.phase2At;
  }
  const P = PHASE2_MUSIC.beatPeriod;
  const t0 = g2(PHASE2_MUSIC.firstBeat);
  return t0 + Math.max(0, Math.ceil((t - t0) / P - 1e-9)) * P;
}

/** Premier « moment fort » (drop de la carte musicale) à l'instant `t` ou après (Infinity s'il n'y en a plus). */
export function nextAccent(t: number): number {
  const a = nextIn(DROPS1, t);
  if (a < PHASES.phase2At) return a;
  return nextIn(DROPS2, Math.max(t, PHASES.phase2At));
}

/** Période de battement à l'instant t (s) : pour caler des séquences (alternance de faisceaux, rafales). */
export function beatPeriodAt(t: number): number {
  return t < PHASES.phase2At ? musicMap.beatPeriod : PHASE2_MUSIC.beatPeriod;
}
