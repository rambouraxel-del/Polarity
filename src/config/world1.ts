import data from '../data/polar-rift-world1.json';

/**
 * L'UNIVERS 1 « L'ORBITE ORIGINELLE » — feuille de route MUSICALE, SOURCE UNIQUE.
 *
 * Musique : « Neon Arpeggio » (≈ 123 s, ≈ 143 pulsations/min très régulières), analysée hors ligne par `scripts/analyze-world1.py` →
 * `src/data/polar-rift-world1.json` (temps exprimés dans le temps du FICHIER). Le morceau est joué TEL QUEL dès le départ de la partie (aucun montage, aucune
 * répétition) : sa dernière phrase tombe en fin d'univers (impact à 118,9 s) et son fondu final (120,3 → 122,9 s) se perd dans la transition vers La Faille.
 * Les instants « locaux » ci-dessous sont des secondes de jeu actif depuis le début de la partie (= début de l'univers 1).
 *
 * Le gameplay lit UNIQUEMENT ces tableaux préparés à l'avance (identiques chez le joueur et chez le service qui rejouerait la partie), jamais le son : le jeu
 * reste identique musique coupée, sourdine, pause, ou sans décodage du fichier. Les motifs de l'univers 1 sont ceux de la Survie (phase 1) ; ils sont calés sur
 * ces battements et ces impacts (`config/worldMusic.ts` → `WORLDS_RHYTHM`).
 *
 * Ce module ne dépend d'aucun autre module du jeu : il est importé par `config/worldMusic.ts`.
 */

export const WORLD1_FILE = data.file;

/** Plan de lecture (lu par `audio/worldMusic.ts`) : un seul segment, aucun raccord ; `fadeStart` = début du fondu final du morceau. */
export const WORLD1_PLAN: {
  segments: readonly { from: number; to: number; at: number }[];
  crossfade: number;
  duration: number;
  fadeStart: number;
  endAudible: number;
} = data.plan;

/** Temps local (s de jeu actif) de la première note du morceau : il démarre avec la partie. */
export const WORLD1_AT = 0;
/** Position de la platine (s depuis le début de la partie) à laquelle démarre le morceau : l'univers 1 n'a pas de transition d'entrée. */
export const WORLD1_START = WORLD1_AT;

/** Force minimale (0–1) d'un impact de la carte pour devenir un MOMENT FORT (accent du gameplay et passage fort du décor) : les plus francs, une dizaine par partie. */
export const W1_ACCENT_MIN = 0.7;

const local = (a: readonly number[]): number[] => a.map((t) => +(t + WORLD1_AT).toFixed(4));

/** Battements en temps LOCAL de l'univers (tous, avec leur force). */
export const W1_BEATS: readonly number[] = local(data.beats);
export const W1_BEAT_STRENGTH: readonly number[] = data.strength;
/** Tous les impacts de la carte et leur force. */
export const W1_IMPACTS: readonly number[] = local(data.drops);
export const W1_IMPACT_STRENGTH: readonly number[] = data.dropStrength;
/** Moments forts : les impacts d'au moins `W1_ACCENT_MIN`. */
export const W1_ACCENTS: readonly number[] = W1_IMPACTS.filter((_, i) => W1_IMPACT_STRENGTH[i] >= W1_ACCENT_MIN);
export const W1_BEAT_PERIOD: number = data.beatPeriod;
/** Début local du fondu final du morceau et fin audible. */
export const W1_FADE_START = data.plan.fadeStart + WORLD1_AT;
export const W1_END_AUDIBLE = data.plan.endAudible + WORLD1_AT;
