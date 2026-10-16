import { AMBIENCE, STAGES, STAGE_PARAMS, type QualitySpec, type QualityTier, type StageParam } from '../config/ambience';
import { PHASES } from '../config/phases';
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
/** Paramètres que le réglage « intensité visuelle » du joueur atténue (le ciel étoilé et le décor de base restent). */
const USER_SCALED: StageParam[] = ['nebula', 'riftGlow', 'dust', 'debris', 'arcRate', 'ringChance', 'gridWarp', 'waveGain', 'beatGain', 'bassGain'];

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
  /** Phase de la Survie (1 ou 2) et avancement de la traversée (0 hors traversée, 0 → 1 pendant). Décoratif : copie lue, jamais écrite vers la simulation. */
  phase: 1 | 2;
  transit: number;
  /** Noyau central : 0 = petite sphère, 1 = faille ouverte (phase 1, de 4 min 30 à 5 min). */
  core: number;
  /** Apparence de la phase 2 (0 = phase 1, 1 = phase 2) : fondue sous le flash de la traversée. */
  look: number;
  /** Passage calme de la musique (0 = énergique, 1 = très calme). */
  calm: number;
  /** Demandes de l'image : force d'une fissure (0 = aucune). */
  spawnFissure: number;
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
      phase: 1,
      transit: 0,
      core: 0,
      look: 0,
      calm: 0,
      spawnFissure: 0,
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
    s.spawnRing = s.spawnWave = s.spawnArcs = s.spawnFissure = 0;
    s.phase = 1;
    s.transit = 0;
    s.core = 0;
    s.look = 0;
    s.calm = 0;
    this.scriptIdx = 0;
    this.lastSurvival = 0;
  }

  private scriptIdx = 0;
  private lastSurvival = 0;

  /**
   * @param survival temps de survie actif (s) — la pause l'arrête
   * @param dt pas d'animation (s) — 0 en pause
   * @param music image musicale courante
   * @param intensity réglage du joueur (0–1) : 1 = ambiance complète ; 0 = ciel étoilé seul (ni faille, ni nébuleuses, ni réaction musicale)
   */
  update(survival: number, dt: number, music: MusicFrame, reduced: boolean, intensity = 1, ph: { phase: 1 | 2; transit: number; phased?: boolean } = { phase: 1, transit: 0 }): AmbienceState {
    const s = this.state;
    s.reduced = reduced;
    s.spawnRing = s.spawnWave = s.spawnArcs = s.spawnFissure = 0;
    s.time += dt;
    s.phase = ph.phase;
    s.transit = ph.transit;
    // Noyau : petite sphère, puis faille de 4 min 30 à 5 min ; en phase 2 il reste un foyer de fissures. Apparence de la phase 2 : fondue sous le flash.
    s.core = ph.phase === 2 ? 0.35 : ph.phased === false ? 0 : smoothstep((survival - PHASES.coreGrowFrom) / (PHASES.phase2At - PHASES.coreGrowFrom));
    const look = ph.phase === 2 ? 1 : ph.transit > 0 ? smoothstep((ph.transit - AMBIENCE.phase2.flash.from) / (AMBIENCE.phase2.flash.peak - AMBIENCE.phase2.flash.from)) : 0;
    s.look = look;
    s.stage = stageAt(survival);
    for (const k of PARAM_KEYS) s.p[k] = paramAt(k, s.stage);
    const user = clamp01(intensity);
    if (user < 1) for (const k of USER_SCALED) s.p[k] *= user;

    // Phase 2 : ciel assombri (la rupture visuelle vient de la faille, des cassures et de l'orbite électrique)
    if (s.look > 0) {
      const dim = AMBIENCE.phase2.dimSky * s.look;
      s.p.stars *= 1 - dim;
      s.p.nebula *= 1 - 1.1 * dim;
      s.p.riftGlow *= 1 - 0.9 * dim;
      s.p.debris *= 1 - dim;
    }

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

    // Passages calmes de la musique : l'ambiance se calme aussi (jamais sans musique : elle ne réagit alors à rien)
    const cm = AMBIENCE.calm;
    s.calm = music.active ? 1 - smoothstep((s.intensity - cm.low) / (cm.high - cm.low)) : 0;
    // Moments forts préparés (instants de survie active) : ondes et fissures, en plus des réactions issues de l'analyse
    if (dt > 0 && ph.transit === 0) {
      const prev = this.lastSurvival;
      this.lastSurvival = survival;
      const sc = AMBIENCE.script;
      if (survival < prev) this.scriptIdx = 0;
      while (this.scriptIdx < sc.length && sc[this.scriptIdx].at <= survival) {
        const ev = sc[this.scriptIdx++];
        // Un grand saut de temps (aperçu, reprise) n'enchaîne pas les événements manqués
        if (survival - ev.at < 2) {
          s.spawnWave = Math.max(s.spawnWave, ev.wave);
          s.spawnFissure = Math.max(s.spawnFissure, ev.fissure);
          s.drop = Math.max(s.drop, ev.wave * 0.8);
        }
      }
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
    // Passage calme : impulsions réduites, anneaux et fissures rares
    const quiet = 1 - AMBIENCE.calm.reaction * s.calm;
    if (music.beat >= cfg.beatThreshold) {
      s.beat = Math.max(s.beat, Math.pow(Math.min(1, music.beat), cfg.beatCurve) * s.p.beatGain * reaction * quiet);
      if (music.beat >= cfg.strongBeat && this.rand() < s.p.ringChance * (1 + s.build) * quiet) s.spawnRing = music.beat * s.p.beatGain * reaction;
      if (music.beat >= cfg.strongBeat && this.rand() < (s.p.fissure + 0.25 * s.look) * quiet * (1 - s.calm)) s.spawnFissure = Math.max(s.spawnFissure, music.beat);
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
      const rate = s.p.arcRate * (1 + s.intensity * 0.6 + s.build + s.drop * 2) * (1 - 0.85 * s.calm) * (1 + 0.8 * s.look);
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
