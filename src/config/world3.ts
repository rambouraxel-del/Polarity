import data from '../data/polar-rift-world3.json';
import { nextIn } from './world2';

/**
 * L'UNIVERS 3 « LA MER NÉBULAIRE » — feuille de route MUSICALE et réglages des cinq familles de gameplay, SOURCE UNIQUE.
 *
 * La carte musicale (`src/data/polar-rift-world3.json`, générée hors ligne par `scripts/analyze-world3.py` à partir du MP3 « Cosmic Impact ») est exprimée
 * dans le temps du FICHIER. Le morceau dure ≈ 119,2 s : il est joué TEL QUEL (aucun montage, aucune répétition), démarré `-WORLD3_AT` s avant l'émergence
 * (pendant la transition d'entrée) ; son fondu final se termine juste avant la faille de sortie. Les instants « locaux » ci-dessous sont des secondes de
 * jeu actif depuis le début de l'univers (0 = émergence de la transition d'entrée).
 *
 * Le gameplay lit UNIQUEMENT ces tableaux préparés à l'avance (reproductibles à l'identique par le service qui rejouerait la partie), jamais le son :
 * le jeu reste identique musique coupée, sourdine, pause, ou sans décodage du fichier. L'éclipse est purement visuelle (temps de jeu, jamais l'audio).
 *
 * Les cinq familles (voir docs/UNIVERS.md) :
 *   1. Brumes et courants nébulaires : nappes qui dérivent le long de l'orbite et ralentissent le vaisseau (`CLOUDS`, config/worlds.ts) ;
 *   2. Ondes de pression : fronts gazeux déclenchés SUR de grands impacts de la carte (`W3_PRESSURE`) ;
 *   3. Monolithes voyageurs : grands blocs de pierre, seuls ou en procession sur les battements (`W3_ATTACKS.monolith`, `.procession`) ;
 *   4. Effondrement minéral : un monolithe se fissure, puis se brise sur un impact en libérant des fragments (`W3_ATTACKS.collapse`) ;
 *   5. Puits gravitationnels : anomalies autour de blocs flottants, vitesse selon le sens de déplacement (`W3_WELLS`).
 * Événement spécial purement visuel : l'Éclipse des géants (`W3_ECLIPSE`).
 *
 * Ce module ne dépend que de `config/world2.ts` (outil de recherche) : il est importé par `config/worlds.ts`.
 */

/** Fin des 120 s de jeu actif de l'univers (= `WORLDS.span`, vérifié par les tests). */
export const WORLD3_SPAN = 120;
/** Durée de la transition d'entrée (= `WORLDS.transition`, vérifié par les tests) : le morceau démarre avant l'émergence. */
export const WORLD3_ENTRY_TRANSITION = 4;

export const WORLD3_FILE = data.file;

/** Plan de lecture (lu par `audio/worldMusic.ts`) : un seul segment, aucun fondu de raccord ; `fadeStart` = début du fondu final du morceau. */
export const WORLD3_PLAN: {
  segments: readonly { from: number; to: number; at: number }[];
  crossfade: number;
  duration: number;
  fadeStart: number;
  endAudible: number;
} = data.plan;

/** Temps local (s de jeu actif) de la première note du morceau : négatif (le morceau démarre pendant la transition d'entrée). */
export const WORLD3_AT = -0.3;
/** Position de la platine (s depuis le début de la transition d'entrée) à laquelle démarre le morceau. */
export const WORLD3_START = WORLD3_ENTRY_TRANSITION + WORLD3_AT;
/** Fondu d'entrée de la voix (s) : le morceau commence par une note tenue, jamais de claquement. */
export const WORLD3_FADE_IN = 0.4;

const local = (a: readonly number[]): number[] => a.map((t) => +(t + WORLD3_AT).toFixed(4));
const localIv = (a: readonly (readonly number[])[]): [number, number][] => a.map(([s, e]) => [+(s + WORLD3_AT).toFixed(4), +(e + WORLD3_AT).toFixed(4)]);

/** Repères en temps LOCAL de l'univers. */
export const W3_BEATS: readonly number[] = local(data.beats);
export const W3_BEAT_STRENGTH: readonly number[] = data.strength;
export const W3_HITS: readonly number[] = local(data.hits);
export const W3_HIT_STRENGTH: readonly number[] = data.hitStrength;
export const W3_DROPS: readonly number[] = local(data.drops);
export const W3_DROP_STRENGTH: readonly number[] = data.dropStrength;
export const W3_BUILDS: readonly (readonly [number, number])[] = localIv(data.builds);
export const W3_CALM: readonly (readonly [number, number])[] = localIv(data.calm);
export const W3_BEAT_PERIOD: number = data.beatPeriod;
/** Début local du fondu final du morceau et fin audible. */
export const W3_FADE_START = data.plan.fadeStart + WORLD3_AT;
export const W3_END_AUDIBLE = data.plan.endAudible + WORLD3_AT;

const ENV_FPS = data.envFps;
const hex = (h: string): Float32Array => {
  const out = new Float32Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16) / 255;
  return out;
};
const INTENSITY = hex(data.intensity);
const BASS = hex(data.bass);

function envLocal(env: Float32Array, l: number): number {
  const x = (l - WORLD3_AT) * ENV_FPS;
  if (x <= 0) return env[0] ?? 0;
  const i = Math.floor(x);
  if (i >= env.length - 1) return env[env.length - 1] ?? 0;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

/** Intensité du morceau (0–1, énergie lissée ~2 s) et basses (0–1) au temps local `l`. */
export const intensity3At = (l: number): number => envLocal(INTENSITY, l);
export const bass3At = (l: number): number => envLocal(BASS, l);

/**
 * Délai (s) entre le lancement d'un danger et son premier contact avec l'orbite (annonce longue, vol lent, calage sur un battement ou un impact) : bornes mesurées
 * sur les parties de test (tests/world3.test.ts) avec une marge. Une vague n'est lancée que si son premier contact tombe HORS d'un passage calme : l'annonce, elle,
 * peut très bien se faire pendant le calme (rien ne touche l'orbite).
 */
export const CONTACT_LEAD3 = { min: 2.0, max: 5.8 } as const;

/** Une vague lancée au temps local `l` risque-t-elle de toucher l'orbite pendant un passage calme ? */
export function calmAhead3(l: number): boolean {
  for (const [a, b] of W3_CALM) if (a < l + CONTACT_LEAD3.max && b > l + CONTACT_LEAD3.min) return true;
  return false;
}

export function inCalm3(l: number): boolean {
  for (const [a, b] of W3_CALM) if (l >= a && l < b) return true;
  return false;
}

export function inBuild3(l: number): boolean {
  for (const [a, b] of W3_BUILDS) if (l >= a && l < b) return true;
  return false;
}

/** Premier impact (temps local) ≥ t dont la force atteint `minStrength` (Infinity si aucun). */
export function nextImpact3(t: number, minStrength: number): number {
  for (let i = 0; i < W3_DROPS.length; i++) if (W3_DROPS[i] >= t && W3_DROP_STRENGTH[i] >= minStrength) return W3_DROPS[i];
  return Infinity;
}

// ————————————————————————————————————————————— famille 2 : ondes de pression (calées sur les grands impacts)

/**
 * Ondes de pression : le front part EXACTEMENT sur un grand impact de la carte (annonce `warn` s avant). On retient les impacts les plus forts, au moins
 * `spacing` s les uns des autres, ni dans un passage calme ni trop près de la fin (le front doit terminer son tour avant la faille de sortie).
 */
export const W3_PRESSURE = { minStrength: 0.5, spacing: 6.5, from: 20, until: 108 } as const;

function pickPressureImpacts(): number[] {
  const order = W3_DROPS.map((t, i) => ({ t, s: W3_DROP_STRENGTH[i] })).filter((x) => x.s >= W3_PRESSURE.minStrength && x.t >= W3_PRESSURE.from && x.t <= W3_PRESSURE.until && !inCalm3(x.t));
  order.sort((a, b) => b.s - a.s);
  const kept: number[] = [];
  for (const x of order) if (kept.every((k) => Math.abs(k - x.t) >= W3_PRESSURE.spacing)) kept.push(x.t);
  return kept.sort((a, b) => a - b);
}

/** Instants locaux de départ des ondes de pression (impacts retenus). */
export const W3_WAVE_AT: readonly number[] = pickPressureImpacts();

// ————————————————————————————————————————————— famille 5 : puits gravitationnels (calés sur des battements)

/**
 * Puits gravitationnels : anomalies de vitesse autour d'un bloc flottant. Chaque puits s'annonce `warn` s, agit `life` s, et son départ est calé sur un
 * battement fort de la carte (premier battement fort après l'instant nominal). Un seul puits à la fois.
 */
export const W3_WELLS = {
  nominal: [71.9, 82.6, 92.2, 110.5] as readonly number[],
  warn: 2.3,
  life: { min: 6, max: 7.5 },
  half: 0.34,
  edge: 0.14,
  /** Vitesse du vaisseau dans le sens du puits (accéléré) et à contre-sens (freiné), à son cœur. */
  with: 1.28,
  against: 0.72,
  minBeatStrength: 0.55,
} as const;

function pickWellStarts(): number[] {
  return W3_WELLS.nominal.map((n) => {
    let t = n;
    for (let k = 0; k < 40; k++) {
      t = nextIn(W3_BEATS, t);
      const i = W3_BEATS.indexOf(t);
      if (i >= 0 && W3_BEAT_STRENGTH[i] >= W3_WELLS.minBeatStrength) return t;
      t += 1e-6;
    }
    return n;
  });
}
export const W3_WELL_AT: readonly number[] = pickWellStarts();

// ————————————————————————————————————————————— événement spécial : l'Éclipse des géants (visuel seulement)

/**
 * Éclipse des géants : une masse rocheuse colossale traverse lentement le fond et masque la source de lumière ; le décor plonge dans la pénombre (la
 * pénombre est la plus profonde pendant le creux du morceau, vers 98–100 s du fichier), puis la masse se brise sur le grand impact suivant et révèle
 * une nébuleuse illuminée. Événement UNIQUE, décoratif : jamais lu par la simulation, il ne cache ni l'orbite, ni les dangers, ni leurs annonces.
 * Instants en secondes du FICHIER (convertis en temps local par `eclipseAt`).
 */
export const W3_ECLIPSE = {
  /** La masse commence à entrer (fichier, s). */
  start: 84,
  /** Impact de la révélation (fichier, s) : la masse se brise et la lumière revient. */
  reveal: 100.37,
  /** Part de la lumière masquée au plus profond de la pénombre (0–1). */
  depth: 0.62,
  /** Durée de la dispersion de la masse après la révélation (s) et de l'éclat lumineux (s). */
  scatter: 7,
  glow: 14,
} as const;

export interface EclipseState {
  /** Avancement de la masse (0 = hors champ à gauche, 1 = centrée devant la lumière) ; jusqu'à la révélation. */
  mass: number;
  /** Part de la lumière masquée (0 = aucune, `W3_ECLIPSE.depth` au plus profond). */
  dark: number;
  /** Dispersion des morceaux de la masse (0 avant la révélation → 1 après `scatter` s). */
  scatter: number;
  /** Éclat de la révélation (1 sur l'impact, décroît) et lumière supplémentaire qui persiste (0 → 1 → 0). */
  flash: number;
  glow: number;
  /** Une éclipse est en cours (masse visible). */
  active: boolean;
}

const sm = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** Éclipse au temps local `l` (rempli dans `out`, sans allocation). Avant `start` et après `scatter` : inactive. */
export function eclipseAt(l: number, out: EclipseState): EclipseState {
  const e = W3_ECLIPSE;
  const t0 = e.start + WORLD3_AT;
  const tr = e.reveal + WORLD3_AT;
  out.mass = 0;
  out.dark = 0;
  out.scatter = 0;
  out.flash = 0;
  out.glow = 0;
  out.active = false;
  if (l < t0 || l > tr + e.scatter) return out;
  out.active = true;
  if (l < tr) {
    out.mass = sm((l - t0) / (tr - t0));
    // La pénombre s'installe lentement puis s'approfondit sur la fin (la masse couvre la source)
    out.dark = e.depth * sm((l - t0) / (tr - t0)) * (0.35 + 0.65 * sm((l - (t0 + 6)) / (tr - t0 - 6)));
    return out;
  }
  const d = l - tr;
  out.mass = 1;
  out.scatter = sm(d / e.scatter);
  out.flash = Math.exp(-d / 0.45);
  out.glow = d < e.glow ? Math.sin((Math.PI * Math.min(1, d / e.glow)) ** 0.9) : 0;
  return out;
}

// ————————————————————————————————————————————— familles 3 et 4 : dangers (monolithes, effondrement)

export const W3_ATTACKS = {
  /** Monolithe voyageur : bloc de pierre lent sur une corde de l'orbite, longuement annoncé ; sa menace dure tant que son bord peut encore toucher l'orbite. */
  monolith: { speedScale: 0.46, scale: 2.2, extraWarn: 0.55, sep: { min: 1.6, max: 2.7 }, beatShare: 0.7 },
  /** Procession : 2 ou 3 monolithes sur la même trajectoire, chacun franchissant l'orbite sur un battement (`beats` battements d'intervalle). */
  procession: { count: { min: 2, max: 3 }, beats: 2, scale: 1.9, maxShift: 0.9 },
  /**
   * Effondrement minéral : le monolithe se fissure en avançant (fissures de plus en plus visibles), se brise près du centre SUR un impact de la carte
   * (retard seulement : jamais d'annonce raccourcie) puis libère 2 ou 3 fragments dont les trajectoires sont annoncées.
   */
  collapse: { speedScale: 0.5, scale: 2.0, extraWarn: 0.65, fragments: { min: 2, max: 3 }, fragScale: 0.78, spread: { min: 0.5, max: 0.95 }, minImpact: 0.4, maxWait: 3.0, beatWait: 0.7 },
} as const;

/**
 * Poids des motifs selon le temps local, calés sur la structure RÉELLE du morceau (carte musicale) : 0–30 s introduction (brumes, premiers monolithes),
 * 30–70 s plateau (effondrements ; les ondes de pression suivent les impacts), creux du morceau vers 68 s, 70–100 s puits gravitationnels et éclipse,
 * 100–120 s procession minérale et montée finale. Aucun danger ne touche l'orbite pendant un passage calme du morceau (`CONTACT_LEAD3`).
 */
export function world3Weights(l: number): Partial<Record<'monolith' | 'procession' | 'collapse' | 'processionCollapse', number>> {
  const ramp = (from: number, span: number): number => {
    const x = Math.min(1, Math.max(0, (l - from) / span));
    return x * x * (3 - 2 * x);
  };
  const calm = calmAhead3(l) ? 0 : 1;
  const finale = ramp(98, 6);
  return {
    monolith: 1.0 * ramp(0, 6) * (1 - 0.55 * ramp(30, 25)) * (1 - 0.4 * finale) * calm,
    procession: 0.8 * ramp(14, 10) * (0.7 + 0.5 * finale) * calm,
    collapse: 1.7 * ramp(24, 8) * calm,
    processionCollapse: 0.7 * ramp(96, 8) * calm,
  };
}
