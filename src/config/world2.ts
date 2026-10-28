import data from '../data/polar-rift-world2.json';

/**
 * L'UNIVERS 2 « LA FAILLE » — feuille de route MUSICALE et réglages des cinq attaques, SOURCE UNIQUE.
 *
 * La carte musicale (`src/data/polar-rift-world2.json`, générée hors ligne par `scripts/analyze-world2.py` à partir du MP3 « Portal Surge ») est exprimée
 * dans le temps du MONTAGE (0 = première note). Le montage répète une phrase de trois mesures : sa position de lecture est donc monotone.
 *
 * Calage : le dernier coup sec du morceau tombe exactement sur l'ouverture de la faille de sortie (fin des 120 s de jeu actif). Tous les instants
 * « locaux » ci-dessous sont des secondes de jeu actif depuis le début de l'univers (0 = émergence de la transition d'entrée).
 *
 * Le gameplay lit UNIQUEMENT ces tableaux préparés à l'avance (reproductibles à l'identique par le service qui rejouerait la partie), jamais le son :
 * le jeu reste identique musique coupée, sourdine, pause, ou sans décodage du fichier.
 *
 * Ce module ne dépend d'aucun autre module de configuration (il est importé par `config/worlds.ts`).
 */

/** Fin des 120 s de jeu actif de l'univers (= `WORLDS.span`, vérifié par les tests). */
export const WORLD2_SPAN = 120;
/** Durée de la transition d'entrée (= `WORLDS.transition`, vérifié par les tests) : le montage démarre avant l'émergence. */
export const WORLD2_ENTRY_TRANSITION = 4;

export const WORLD2_FILE = data.file;

export interface MontageSegment {
  /** Portion du fichier jouée : [from, to) en secondes du MP3. */
  from: number;
  to: number;
  /** Instant du montage où commence ce segment. */
  at: number;
}

/** Plan du montage (lu par `audio/worldMusic.ts`) : segments, fondu de raccord, durée totale, dernier coup sec. */
export const WORLD2_PLAN: {
  segments: readonly MontageSegment[];
  crossfade: number;
  duration: number;
  cut: number;
  repeat: { from: number; to: number; length: number; beats: number };
} = data.plan;

/** Temps local (s de jeu actif) de l'instant 0 du montage : négatif, la musique démarre pendant la transition d'entrée. */
export const WORLD2_AT = WORLD2_SPAN - data.plan.cut;

/** Position de lecture (s depuis le début de la transition d'entrée) à laquelle le montage démarre. */
export const WORLD2_START = WORLD2_ENTRY_TRANSITION + WORLD2_AT;

const local = (a: readonly number[]): number[] => a.map((t) => +(t + WORLD2_AT).toFixed(4));
const localIv = (a: readonly (readonly number[])[]): [number, number][] => a.map(([s, e]) => [+(s + WORLD2_AT).toFixed(4), +(e + WORLD2_AT).toFixed(4)]);

/** Repères en temps LOCAL de l'univers. */
export const W2_BEATS: readonly number[] = local(data.beats);
export const W2_HITS: readonly number[] = local(data.hits);
export const W2_HIT_STRENGTH: readonly number[] = data.hitStrength;
export const W2_DROPS: readonly number[] = local(data.drops);
export const W2_DROP_STRENGTH: readonly number[] = data.dropStrength;
export const W2_BUILDS: readonly (readonly [number, number])[] = localIv(data.builds);
export const W2_CALM: readonly (readonly [number, number])[] = localIv(data.calm);
export const W2_BEAT_PERIOD: number = data.beatPeriod;

const ENV_FPS = data.envFps;
const hex = (h: string): Float32Array => {
  const out = new Float32Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16) / 255;
  return out;
};
const INTENSITY = hex(data.intensity);
const BASS = hex(data.bass);

function envLocal(env: Float32Array, l: number): number {
  const x = (l - WORLD2_AT) * ENV_FPS;
  if (x <= 0) return env[0] ?? 0;
  const i = Math.floor(x);
  if (i >= env.length - 1) return env[env.length - 1] ?? 0;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

/** Intensité du morceau (0–1, énergie lissée ~2 s) au temps local `l` : sert à répartir les attaques (spirales surtout sur les passages intenses). */
export const intensityAt = (l: number): number => envLocal(INTENSITY, l);
export const bassAt = (l: number): number => envLocal(BASS, l);

/** Délai maximal (s) entre le lancement d'une attaque et son premier contact avec l'orbite (annonce de la fissure + calage sur un battement), retiré des passages calmes. */
export const CALM_LEAD = 3.6;

/** Premier élément ≥ t d'une liste triée (Infinity si aucun). */
export function nextIn(list: readonly number[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? list[lo] : Infinity;
}

/** Premier impact (temps local) ≥ t dont la force atteint `minStrength` (Infinity si aucun). */
export function nextImpactIn(t: number, minStrength: number): number {
  for (let i = 0; i < W2_DROPS.length; i++) if (W2_DROPS[i] >= t && W2_DROP_STRENGTH[i] >= minStrength) return W2_DROPS[i];
  return Infinity;
}

/** Force du prochain impact (≥ t, ≥ minStrength) ; 0 si aucun. */
export function nextImpactStrength(t: number, minStrength: number): number {
  for (let i = 0; i < W2_DROPS.length; i++) if (W2_DROPS[i] >= t && W2_DROP_STRENGTH[i] >= minStrength) return W2_DROP_STRENGTH[i];
  return 0;
}

/** Un passage calme commence-t-il dans les `CALM_LEAD` s qui suivent `l`, ou est-il en cours ? (une attaque lancée maintenant ne doit pas toucher l'orbite pendant un calme) */
export function calmAhead(l: number): boolean {
  for (const [a, b] of W2_CALM) if (a < l + CALM_LEAD && b > l) return true;
  return false;
}

/** Le temps local `l` est-il dans un passage calme du morceau (les attaques s'arrêtent) ? */
export function inCalm(l: number): boolean {
  for (const [a, b] of W2_CALM) if (l >= a && l < b) return true;
  return false;
}

/** Le temps local `l` est-il dans une montée du morceau ? (les fissures s'étendent) */
export function inBuild(l: number): boolean {
  for (const [a, b] of W2_BUILDS) if (l >= a && l < b) return true;
  return false;
}

// ————————————————————————————————————————————— les cinq attaques de La Faille

/**
 * Cinq familles, pas une de plus (voir docs/UNIVERS.md) :
 *   1. Fissure d'orbite (`orbitCrack`)  : portion d'orbite dangereuse 4 à 8 s ; s'ouvre progressivement pendant l'annonce, s'élargit pendant une montée.
 *   2. Arc rampant (`surgeArc`)         : décharge qui glisse le long de l'orbite ; son apparition est calée sur une percussion.
 *   3. Orbe de faille (`riftOrb`)       : sphère d'énergie qui traverse l'arène ; première traversée calée sur certains battements.
 *   4. Onde de rupture (`riftWave`)     : la faille centrale se charge, puis déclenche une onde sur un secteur au moment d'un grand impact.
 *   5. Spirale fracturée (`fractureSpiral`) : fragments en spirale, réservés aux passages les plus intenses.
 * Deux combinaisons modérées (`crackOrb`, `waveSpiral`) n'assemblent que ces familles, uniquement en fin d'univers.
 */
export const W2_ATTACKS = {
  crack: {
    /** Demi-largeur (rad) de la fissure, durée active (s) et durée d'ouverture annoncée (s). */
    half: { min: 0.3, max: 0.42 },
    active: { min: 4, max: 8 },
    warn: { min: 2.4, max: 3.2 },
    /** Pendant une montée, la fissure s'élargit de ce facteur sur sa durée active. */
    buildGrow: 1.35,
    /** Distance angulaire (rad) entre la position prévue du vaisseau et le centre de la fissure. */
    offset: { min: 0.5, max: 1.7 },
  },
  /** Arc rampant : annonce, déplacement lent (rad/s) et décalage maximal pour attendre une percussion (s, retard seulement). */
  creep: { warn: 1.7, drift: { min: 0.14, max: 0.26 }, half: { min: 0.26, max: 0.36 }, active: { min: 2.6, max: 3.8 }, maxHitWait: 0.45 },
  /** Onde de rupture : charge de la faille centrale (s, de l'annonce au déclenchement), demi-largeurs de l'onde et durée. */
  wave: { warn: { min: 2.0, max: 3.4 }, halfFrom: 0.16, halfTo: 0.46, active: 1.2, minImpact: 0.5, maxWait: 5.2 },
  /** Spirale fracturée : bras maximum, intensité minimale du morceau pour l'autoriser. */
  spiral: { maxArms: 2, minIntensity: 0.42 },
} as const;

/**
 * Poids des attaques selon le temps local, calés sur la structure RÉELLE du morceau (carte musicale) : 0–30 s introduction (orbes, premières fissures),
 * premier grand impact vers 37 s puis plateau (arcs rampants, ondes sur les impacts), pause vers 73 s, seconde moitié plus dense (spirales dès que le
 * morceau est intense, combinaisons modérées en fin d'univers) jusqu'au dernier coup sec.
 */
export function world2Weights(l: number): Partial<Record<'riftOrb' | 'orbitCrack' | 'surgeArc' | 'riftWave' | 'fractureSpiral' | 'crackOrb' | 'waveSpiral', number>> {
  const ramp = (from: number, span: number): number => {
    const x = Math.min(1, Math.max(0, (l - from) / span));
    return x * x * (3 - 2 * x);
  };
  const inten = intensityAt(l);
  const intense = Math.min(1, Math.max(0, (inten - 0.3) / 0.2));
  // Passage calme du morceau : plus aucune nouvelle attaque (le décor s'apaise)
  // (marge : rien ne doit toucher l'orbite pendant un passage calme)
  const calm = calmAhead(l) ? 0 : 1;
  const late = ramp(88, 14);
  // Onde de rupture : seulement quand un grand impact du morceau tombera dans la fenêtre de charge (2 à 5,2 s) et pas dans un calme ; plus l'impact est fort, plus l'onde est probable
  const w = W2_ATTACKS.wave;
  const impact = nextImpactIn(l + w.warn.min, w.minImpact);
  let wave = 0;
  if (impact - l <= w.maxWait && !inCalm(impact)) wave = 2.2 + 2 * (nextImpactStrength(l + w.warn.min, w.minImpact) - w.minImpact);
  return {
    riftOrb: 1.0 * ramp(0, 6) * (1 - 0.4 * ramp(36, 20)) * calm,
    orbitCrack: 0.8 * ramp(7, 8) * calm,
    surgeArc: 0.85 * ramp(24, 12) * calm,
    riftWave: wave * ramp(24, 6) * calm,
    fractureSpiral: 0.9 * ramp(48, 14) * intense * calm,
    crackOrb: 0.55 * late * calm,
    waveSpiral: 0.8 * wave * late * intense * calm,
  };
}
