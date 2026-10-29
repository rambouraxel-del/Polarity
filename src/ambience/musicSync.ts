import map from '../data/polar-rift-music-map.json';
import phase2Map from '../data/polar-rift-phase2.json';
import world2Map from '../data/polar-rift-world2.json';
import world3Map from '../data/polar-rift-world3.json';
import { PHASE2_MUSIC } from '../config/phases';
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
  /** Cartes détaillées (univers 2) : percussions, force des impacts, passages calmes. */
  hits?: number[];
  hitStrength?: number[];
  dropStrength?: number[];
  calm?: number[][];
}

export interface TrackMap {
  duration: number;
  beats: Float64Array;
  strength: Float32Array;
  bass: Float32Array;
  intensity: Float32Array;
  drops: Float64Array;
  builds: Float64Array; // paires [début, fin]
  /** Percussions (temps, force 0–1) : présentes seulement dans les cartes détaillées ; leur absence active la détection de coups de basse. */
  hits?: Float64Array;
  hitStrength?: Float32Array;
  /** Force (0–1) de chaque impact de `drops`. */
  dropStrength?: Float32Array;
  /** Passages calmes (paires [début, fin]). */
  calm?: Float64Array;
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
  /** Attaque de basse franche (coup de grosse caisse) depuis l'image précédente, entre les battements cartographiés (0 = aucune ; 0–1 = force). */
  hit?: number;
  /** Un passage fort (drop) a été franchi depuis l'image précédente. */
  drop: boolean;
  /** Carte détaillée (univers 2) : force (0–1) de la percussion franchie depuis l'image précédente (0 si aucune). */
  perc?: number;
  /** Carte détaillée : force (0–1) du grand impact franchi depuis l'image précédente (0 si aucun). */
  impact?: number;
  /** Carte détaillée : 1 dans un passage calme du morceau, 0 sinon. */
  calm?: number;
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
    hits: t.hits ? Float64Array.from(t.hits) : undefined,
    hitStrength: t.hitStrength ? Float32Array.from(t.hitStrength) : undefined,
    dropStrength: t.dropStrength ? Float32Array.from(t.dropStrength) : undefined,
    calm: t.calm ? Float64Array.from(t.calm.flat()) : undefined,
  };
}

export const MUSIC_MAP = {
  envFps: map.envFps,
  beatPeriod: map.beatPeriod,
  tracks: {
    intro: parse(map.tracks.intro),
    loop: parse(map.tracks.loop),
    outro: parse(map.tracks.outro),
    // Phase 2 : le fichier entier (la position fournie par Music.position est déjà ramenée dans la région en boucle)
    p2: parse({ duration: phase2Map.fileDuration, beats: phase2Map.beats, strength: phase2Map.strength, bass: phase2Map.bass, intensity: phase2Map.intensity, drops: phase2Map.drops, builds: phase2Map.builds }),
    // Univers 2 « La Faille » : carte du MONTAGE (temps monotone, phrase répétée dépliée)
    w2: parse({
      duration: world2Map.plan.duration,
      beats: world2Map.beats,
      strength: world2Map.strength,
      bass: world2Map.bass,
      intensity: world2Map.intensity,
      drops: world2Map.drops,
      builds: world2Map.builds,
      hits: world2Map.hits,
      hitStrength: world2Map.hitStrength,
      dropStrength: world2Map.dropStrength,
      calm: world2Map.calm,
    }),
    // Univers 3 « La Mer nébulaire » : carte du morceau joué tel quel (temps du fichier)
    w3: parse({
      duration: world3Map.plan.duration,
      beats: world3Map.beats,
      strength: world3Map.strength,
      bass: world3Map.bass,
      intensity: world3Map.intensity,
      drops: world3Map.drops,
      builds: world3Map.builds,
      hits: world3Map.hits,
      hitStrength: world3Map.hitStrength,
      dropStrength: world3Map.dropStrength,
      calm: world3Map.calm,
    }),
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
  readonly frame: MusicFrame = { active: false, track: null, bass: 0, intensity: 0, beat: 0, hit: 0, drop: false, perc: 0, impact: 0, calm: 0, build: 0 };
  private lastTrack: MusicTrack | null = null;
  private lastTime = 0;
  /** Dernier coup de basse détecté (position dans le morceau, s). */
  private lastHit = -10;
  /** Instant (dans le morceau) du dernier battement cartographié franchi : filtre des doubles détections. */
  private lastBeatT = -10;

  constructor(private readonly maps: Record<MusicTrack, TrackMap> = MUSIC_MAP.tracks, private readonly fps: number = MUSIC_MAP.envFps) {}

  /** Oublie la position précédente (nouvelle partie). */
  reset(): void {
    this.lastTrack = null;
    this.lastTime = 0;
    this.lastHit = -10;
    this.lastBeatT = -10;
  }

  /**
   * Met à jour `frame` depuis la position de lecture entendue. Sans allocation.
   * `audible` faux (sourdine, volume de la musique à zéro) : aucune réaction, comme sans musique. En pause ou pendant le compte
   * à rebours la position ne progresse pas (`playing` faux) : les réactions retombent, on ne rejoue jamais un battement figé.
   */
  update(pos: MusicPosition, audible = true): MusicFrame {
    const f = this.frame;
    f.beat = 0;
    f.hit = 0;
    f.drop = false;
    f.perc = 0;
    f.impact = 0;
    if (!pos.track || !pos.playing || !audible) {
      f.active = false;
      f.track = null;
      f.bass = 0;
      f.intensity = 0;
      f.build = 0;
      f.calm = 0;
      this.lastTrack = null;
      return f;
    }
    const m = this.maps[pos.track];
    const ahead = pos.time + AMBIENCE.music.lead;
    const t = pos.track === 'loop' ? ahead % m.duration : Math.min(m.duration, ahead);
    f.active = true;
    f.track = pos.track;
    f.bass = envAt(m.bass, this.fps, t);
    // Attaque de basse : montée franche de l'enveloppe en 0,1 s (coup de grosse caisse), au moins `hitGap` après le précédent
    const mu = AMBIENCE.music;
    const rise = f.bass - envAt(m.bass, this.fps, Math.max(0, t - 0.1));
    // (carte détaillée : les percussions cartographiées remplacent cette détection, jamais les deux)
    if (!m.hits && this.lastTrack === pos.track && rise >= mu.hitRise && f.bass >= mu.hitLevel && t - this.lastHit >= mu.hitGap) {
      f.hit = Math.min(1, 0.4 + rise * 2.5);
      this.lastHit = t;
    }
    f.intensity = envAt(m.intensity, this.fps, t);
    f.build = 0;
    f.calm = 0;
    if (m.calm) for (let i = 0; i < m.calm.length; i += 2) if (t >= m.calm[i] && t < m.calm[i + 1]) f.calm = 1;
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
      } else if (pos.track === 'p2' && t < prev && prev - t > 1 && t - PHASE2_MUSIC.loopStart <= AMBIENCE.music.maxCatchUp) {
        // Passe de boucle de la phase 2 : le fondu enchaîné ramène la lecture à loopStart
        this.cross(m, prev, PHASE2_MUSIC.loopEnd);
        this.cross(m, PHASE2_MUSIC.loopStart - 1e-6, t);
      }
    } else if (pos.playing && this.lastTrack !== null && pos.time <= AMBIENCE.music.maxCatchUp) {
      // Changement de morceau (intro → boucle, → outro) : battements du tout début du nouveau morceau
      this.cross(m, -1, t);
    }
    // Doubles détections : un coup de basse qui coïncide avec un battement cartographié (± `hitGap`) n'est pas une seconde impulsion
    if (f.beat > 0) {
      this.lastBeatT = t;
      if (f.hit) {
        f.hit = 0;
        this.lastHit = t;
      }
    } else if (f.hit && this.lastTrack === pos.track && Math.abs(t - this.lastBeatT) < mu.hitGap) {
      f.hit = 0;
    }
    this.lastTrack = pos.track;
    this.lastTime = t;
    return f;
  }

  /** Battements et passages forts dans ]a, b]. */
  private cross(m: TrackMap, a: number, b: number): void {
    const f = this.frame;
    for (let i = upperBound(m.beats, a), n = upperBound(m.beats, b); i < n; i++) f.beat = Math.max(f.beat, m.strength[i]);
    if (upperBound(m.drops, b) > upperBound(m.drops, a)) {
      f.drop = true;
      if (m.dropStrength) for (let i = upperBound(m.drops, a), n = upperBound(m.drops, b); i < n; i++) f.impact = Math.max(f.impact ?? 0, m.dropStrength[i]);
    }
    if (m.hits && m.hitStrength) for (let i = upperBound(m.hits, a), n = upperBound(m.hits, b); i < n; i++) f.perc = Math.max(f.perc ?? 0, m.hitStrength[i]);
  }
}
