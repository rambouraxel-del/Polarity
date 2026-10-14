import map from '../data/polar-rift-music-map.json';
import { AMBIENCE } from '../config/ambience';
import type { MusicPosition, MusicTrack } from '../audio/music';

/**
 * Synchronisation musicale de l'ambiance : lit la carte des morceaux (analyse hors ligne, `scripts/analyze-music.py`)
 * à la position de lecture RÉELLE (`Music.position`). Aucun BPM supposé, aucun minuteur : un battement « arrive » quand
 * la position entendue franchit son instant. Pause = position figée ; boucle = repli au début de la région ; reprise
 * ou changement de morceau = pas de rattrapage des battements manqués (pas de rafale).
 * Sans musique (non décodée), rien ne réagit : on ne simule jamais une fausse pulsation.
 */

interface RawTrack {
  duration: number;
  beats: number[];
  strength: number[];
  bass: string;
  intensity: string;
  drops: number[];
  builds: number[][];
}

export interface TrackMap {
  duration: number;
  beats: Float64Array;
  strength: Float32Array;
  bass: Float32Array;
  intensity: Float32Array;
  drops: Float64Array;
  builds: Float64Array; // paires [début, fin]
}

/** Ce que la musique produit pour l'image courante (objet réutilisé). */
export interface MusicFrame {
  /** Une musique de partie est entendue (sinon toutes les valeurs sont nulles). */
  active: boolean;
  track: MusicTrack | null;
  /** Basses (0–1) et intensité (0–1, énergie lissée ~2 s) à l'instant entendu. */
  bass: number;
  intensity: number;
  /** Force du battement franchi depuis l'image précédente (0 si aucun). */
  beat: number;
  /** Un passage fort (drop) a été franchi depuis l'image précédente. */
  drop: boolean;
  /** Avancement dans une montée en cours (0 hors montée, 0→1 pendant). */
  build: number;
}

const hexBytes = (hex: string): Float32Array => {
  const out = new Float32Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16) / 255;
  return out;
};

function parse(t: RawTrack): TrackMap {
  return {
    duration: t.duration,
    beats: Float64Array.from(t.beats),
    strength: Float32Array.from(t.strength),
    bass: hexBytes(t.bass),
    intensity: hexBytes(t.intensity),
    drops: Float64Array.from(t.drops),
    builds: Float64Array.from(t.builds.flat()),
  };
}

export const MUSIC_MAP = {
  envFps: map.envFps,
  beatPeriod: map.beatPeriod,
  tracks: {
    intro: parse(map.tracks.intro),
    loop: parse(map.tracks.loop),
    outro: parse(map.tracks.outro),
  } as Record<MusicTrack, TrackMap>,
};

/** Premier indice i tel que a[i] > t (recherche binaire). */
export function upperBound(a: Float64Array, t: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Valeur d'une enveloppe à l'instant t (interpolation linéaire). */
export function envAt(env: Float32Array, fps: number, t: number): number {
  if (env.length === 0) return 0;
  const x = Math.max(0, t * fps);
  const i = Math.floor(x);
  if (i >= env.length - 1) return env[env.length - 1];
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

export class MusicSync {
  readonly frame: MusicFrame = { active: false, track: null, bass: 0, intensity: 0, beat: 0, drop: false, build: 0 };
  private lastTrack: MusicTrack | null = null;
  private lastTime = 0;

  constructor(private readonly maps: Record<MusicTrack, TrackMap> = MUSIC_MAP.tracks, private readonly fps: number = MUSIC_MAP.envFps) {}

  /** Oublie la position précédente (nouvelle partie). */
  reset(): void {
    this.lastTrack = null;
    this.lastTime = 0;
  }

  /**
   * Met à jour `frame` depuis la position de lecture entendue. Sans allocation.
   * `audible` faux (sourdine, volume de la musique à zéro) : aucune réaction, comme sans musique. En pause ou pendant le compte
   * à rebours la position ne progresse pas (`playing` faux) : les réactions retombent, on ne rejoue jamais un battement figé.
   */
  update(pos: MusicPosition, audible = true): MusicFrame {
    const f = this.frame;
    f.beat = 0;
    f.drop = false;
    if (!pos.track || !pos.playing || !audible) {
      f.active = false;
      f.track = null;
      f.bass = 0;
      f.intensity = 0;
      f.build = 0;
      this.lastTrack = null;
      return f;
    }
    const m = this.maps[pos.track];
    const ahead = pos.time + AMBIENCE.music.lead;
    const t = pos.track === 'loop' ? ahead % m.duration : Math.min(m.duration, ahead);
    f.active = true;
    f.track = pos.track;
    f.bass = envAt(m.bass, this.fps, t);
    f.intensity = envAt(m.intensity, this.fps, t);
    f.build = 0;
    for (let i = 0; i < m.builds.length; i += 2) {
      const a = m.builds[i];
      const b = m.builds[i + 1];
      if (t >= a && t < b) f.build = (t - a) / Math.max(0.001, b - a);
    }
    if (pos.playing && this.lastTrack === pos.track) {
      const prev = this.lastTime;
      if (t >= prev && t - prev <= AMBIENCE.music.maxCatchUp) {
        this.cross(m, prev, t);
      } else if (pos.track === 'loop' && t < prev && t + m.duration - prev <= AMBIENCE.music.maxCatchUp) {
        // Tour de boucle : fin de la région puis début
        this.cross(m, prev, m.duration);
        this.cross(m, -1, t);
      }
    } else if (pos.playing && this.lastTrack !== null && pos.time <= AMBIENCE.music.maxCatchUp) {
      // Changement de morceau (intro → boucle, → outro) : battements du tout début du nouveau morceau
      this.cross(m, -1, t);
    }
    this.lastTrack = pos.track;
    this.lastTime = t;
    return f;
  }

  /** Battements et passages forts dans ]a, b]. */
  private cross(m: TrackMap, a: number, b: number): void {
    const f = this.frame;
    for (let i = upperBound(m.beats, a), n = upperBound(m.beats, b); i < n; i++) f.beat = Math.max(f.beat, m.strength[i]);
    if (upperBound(m.drops, b) > upperBound(m.drops, a)) f.drop = true;
  }
}
