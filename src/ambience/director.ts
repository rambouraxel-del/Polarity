import { AMBIENCE, STAGES, STAGE_PARAMS, type QualitySpec, type QualityTier, type StageParam } from '../config/ambience';
import type { MusicFrame } from './musicSync';

/**
 * Directeur de l'ambiance de la Survie : logique PURE (aucun rendu), testable.
 * - Progression : stade continu 0 → 4 piloté par le temps de survie actif, transitions lissées (`AMBIENCE.transition`).
 * - Réactions : impulsions de battement, basses, intensité, montées et passages forts issus de `MusicSync`.
 * - Demandes ponctuelles au rendu (anneau, onde, arc) : le rendu ne décide de rien, il dessine.
 * Décoratif uniquement : le hasard utilisé ici n'est jamais celui du jeu (`Math.random` par défaut).
 */

const PARAM_KEYS = Object.keys(STAGE_PARAMS) as StageParam[];
const LAST = STAGES.length - 1;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Stade continu (0 à 4) au temps de survie `t` : chaque seuil est franchi en douceur sur `AMBIENCE.transition` secondes. */
export function stageAt(t: number): number {
  let s = 0;
  for (let k = 1; k < STAGES.length; k++) s += smoothstep((t - STAGES[k].from) / AMBIENCE.transition);
  return s;
}

/** Valeur d'un paramètre au stade continu `stage` (interpolation linéaire entre deux stades). */
export function paramAt(key: StageParam, stage: number): number {
  const v = STAGE_PARAMS[key];
  const s = Math.max(0, Math.min(LAST, stage));
  const i = Math.min(LAST - 1, Math.floor(s));
  const f = s - i;
  return v[i] * (1 - f) + v[i + 1] * f;
}

export interface AmbienceState {
  /** Stade continu (0 = Vide stellaire … 4 = Apogée). */
  stage: number;
  /** Paramètres du stade (interpolés, variations lentes de l'apogée comprises). */
  p: Record<StageParam, number>;
  /** Impulsion de battement (0–1, décroît rapidement). */
  beat: number;
  /** Basses lissées (0–1, déjà pondérées par le stade). */
  bass: number;
  /** Intensité musicale lissée (0–1). */
  intensity: number;
  /** Montée en cours (0–1, lissée). */
  build: number;
  /** Impulsion de passage fort (0–1, décroît en ~1,4 s). */
  drop: number;
  /** Temps d'animation (s) : n'avance pas en pause. */
  time: number;
  reduced: boolean;
  tier: QualityTier;
  quality: QualitySpec;
  /** Demandes de l'image : force d'un nouvel anneau (0 = aucun), d'une onde (passage fort), nombre d'arcs. */
  spawnRing: number;
  spawnWave: number;
  spawnArcs: number;
}

export class AmbienceDirector {
  readonly state: AmbienceState;

  constructor(private readonly rand: () => number = Math.random) {
    const p = {} as Record<StageParam, number>;
    for (const k of PARAM_KEYS) p[k] = STAGE_PARAMS[k][0];
    this.state = {
      stage: 0,
      p,
      beat: 0,
      bass: 0,
      intensity: 0,
      build: 0,
      drop: 0,
      time: 0,
      reduced: false,
      tier: 'high',
      quality: AMBIENCE.quality.tiers.high,
      spawnRing: 0,
      spawnWave: 0,
      spawnArcs: 0,
    };
  }

  /** Nouvelle partie : tout repart du Vide stellaire. */
  reset(): void {
    const s = this.state;
    s.stage = 0;
    s.beat = s.bass = s.intensity = s.build = s.drop = 0;
    s.time = 0;
    s.spawnRing = s.spawnWave = s.spawnArcs = 0;
  }

  /**
   * @param survival temps de survie actif (s) — la pause l'arrête
   * @param dt pas d'animation (s) — 0 en pause
   * @param music image musicale courante
   */
  update(survival: number, dt: number, music: MusicFrame, reduced: boolean): AmbienceState {
    const s = this.state;
    s.reduced = reduced;
    s.spawnRing = s.spawnWave = s.spawnArcs = 0;
    s.time += dt;
    s.stage = stageAt(survival);
    for (const k of PARAM_KEYS) s.p[k] = paramAt(k, s.stage);

    // Apogée : variations lentes pour que l'ambiance ne se fige jamais
    const apex = clamp01(s.stage - (LAST - 1));
    if (apex > 0) {
      const per = AMBIENCE.apex.periods;
      let w = 0;
      for (let i = 0; i < per.length; i++) w += Math.sin((survival / per[i]) * Math.PI * 2 + i * 1.7);
      const v = 1 + AMBIENCE.apex.amplitude * apex * (w / per.length);
      s.p.nebula *= v;
      s.p.riftGlow = Math.min(1, s.p.riftGlow * v);
      s.p.dust = Math.min(1, s.p.dust * v);
      s.p.arcRate *= v;
      s.p.heat = clamp01(s.p.heat * (2 - v));
    }

    const reaction = reduced ? AMBIENCE.reduced.reaction : 1;
    if (reduced && !AMBIENCE.reduced.gridWarp) s.p.gridWarp = 0;
    if (dt > 0) this.react(dt, music, reduced, reaction); // pause : tout reste figé
    // Montées et passages forts : couleurs plus intenses
    s.p.heat = clamp01(s.p.heat + 0.25 * s.build + 0.15 * s.drop + 0.1 * s.intensity);
    return s;
  }

  private react(dt: number, music: MusicFrame, reduced: boolean, reaction: number): void {
    const s = this.state;
    const cfg = AMBIENCE.music;

    // Basses (attaque rapide, relâchement plus lent), intensité et montée lissées
    const bassTarget = music.active ? music.bass * s.p.bassGain * reaction : 0;
    const tau = bassTarget > s.bass ? cfg.bassAttack : cfg.bassRelease;
    s.bass += (bassTarget - s.bass) * (1 - Math.exp(-dt / tau));
    const intTarget = music.active ? music.intensity : 0;
    s.intensity += (intTarget - s.intensity) * (1 - Math.exp(-dt / cfg.intensitySmooth));
    const buildTarget = music.active ? music.build : 0;
    s.build += (buildTarget - s.build) * (1 - Math.exp(-dt / cfg.buildSmooth));

    // Battements significatifs : impulsion qui décroît vite
    s.beat *= Math.exp(-dt / cfg.beatDecay);
    if (music.beat >= cfg.beatThreshold) {
      s.beat = Math.max(s.beat, Math.min(1, music.beat) * s.p.beatGain * reaction);
      if (music.beat >= cfg.strongBeat && this.rand() < s.p.ringChance * (1 + s.build)) s.spawnRing = music.beat * s.p.beatGain * reaction;
    }

    // Passage fort : impulsion longue, onde, arcs
    s.drop *= Math.exp(-dt / cfg.dropDecay);
    if (music.drop) {
      s.drop = Math.max(s.drop, s.p.waveGain * reaction);
      if (!reduced || AMBIENCE.reduced.waves) s.spawnWave = s.p.waveGain;
      if ((!reduced || AMBIENCE.reduced.arcs) && s.p.arcRate > 0) s.spawnArcs += 2;
    }

    // Arcs occasionnels : plus fréquents avec l'intensité, les montées et les passages forts
    if (!reduced || AMBIENCE.reduced.arcs) {
      const rate = s.p.arcRate * (1 + s.intensity * 0.6 + s.build + s.drop * 2);
      if (this.rand() < rate * dt) s.spawnArcs += 1;
    }
  }

  setQuality(tier: QualityTier): void {
    this.state.tier = tier;
    this.state.quality = AMBIENCE.quality.tiers[tier];
  }
}

const TIERS: QualityTier[] = ['high', 'medium', 'low'];

/**
 * Qualité adaptative : observe la durée moyenne des images ; descend d'un niveau si elles sont durablement lentes,
 * remonte seulement après une longue période fluide (pas d'oscillation).
 */
export class QualityGovernor {
  private avg = 1 / 60;
  private slow = 0;
  private fast = 0;

  constructor(public tier: QualityTier = 'high') {}

  /** @returns vrai si le niveau a changé */
  update(realDt: number): boolean {
    if (realDt <= 0 || realDt > 0.2) return false; // onglet en arrière-plan, reprise : ignoré
    const q = AMBIENCE.quality;
    this.avg += (realDt - this.avg) * 0.05;
    const i = TIERS.indexOf(this.tier);
    if (this.avg > q.slowFrame) {
      this.slow += realDt;
      this.fast = 0;
      if (this.slow >= q.slowFor && i < TIERS.length - 1) {
        this.tier = TIERS[i + 1];
        this.slow = 0;
        return true;
      }
    } else if (this.avg < q.fastFrame) {
      this.fast += realDt;
      this.slow = 0;
      if (this.fast >= q.fastFor && i > 0) {
        this.tier = TIERS[i - 1];
        this.fast = 0;
        return true;
      }
    } else {
      this.slow = Math.max(0, this.slow - realDt);
    }
    return false;
  }
}
