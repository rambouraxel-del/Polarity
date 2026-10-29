import { AMBIENCE, STAGES, STAGE_PARAMS, type QualitySpec, type QualityTier, type StageParam } from '../config/ambience';
import { PHASES } from '../config/phases';
import { eclipseAt, type EclipseState } from '../config/world3';
import { WORLD_LIST, WORLDS, type TransitionVariant } from '../config/worlds';
import type { MusicFrame } from './musicSync';

/**
 * Directeur de l'ambiance de la Survie : logique PURE (aucun rendu), testable.
 * - Progression : stade continu 0 → 4 piloté par le temps de survie actif, transitions lissées (`AMBIENCE.transition`).
 * - Réactions : impulsions de battement, basses, intensité, montées et passages forts issus de `MusicSync`.
 * - Demandes ponctuelles au rendu (anneau, onde, arc) : le rendu ne décide de rien, il dessine.
 * Décoratif uniquement : le hasard utilisé ici n'est jamais celui du jeu (`Math.random` par défaut).
 */

const PARAM_KEYS = Object.keys(STAGE_PARAMS) as StageParam[];
const AMBIENCE_COLORS_AZURE = 0x3d8bff;
const AMBIENCE_COLORS_VIOLET = 0x7a4dff;
const LAST = STAGES.length - 1;
/** Paramètres que le réglage « intensité visuelle » du joueur atténue (le ciel étoilé et le décor de base restent). */
const USER_SCALED: StageParam[] = ['nebula', 'riftGlow', 'dust', 'debris', 'arcRate', 'ringChance', 'gridWarp', 'waveGain', 'beatGain', 'bassGain', 'boltChance', 'waveChance'];

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
  /** Réglage « intensité visuelle » du joueur (0–1) : multiplie l'opacité de la faille, du tunnel, des rubans et des éclairs. */
  user: number;
  /** Passage calme de la musique (0 = énergique, 1 = très calme). */
  calm: number;
  /**
   * La Faille (univers 2), lu par le rendu : impulsion de percussion (0–1, décroît en ~0,1 s), instabilité (montées et passages intenses : fissures qui
   * s'étendent), stabilisation à la sortie (0 → 1 après le dernier coup : éclairs et pulsations s'éteignent), gain de pulsation de la faille centrale.
   */
  perc: number;
  instab: number;
  stab: number;
  pulse: number;
  /** Demandes de l'image : force d'une fissure (0 = aucune). */
  spawnFissure: number;
  /** Demandes de l'image : force d'un nouvel anneau (0 = aucun), d'une onde (passage fort), nombre d'arcs. */
  spawnRing: number;
  spawnWave: number;
  spawnArcs: number;
  /**
   * Voyage des univers : univers affiché (1–4 ; 0 = Survie historique), destination pendant une transition, présence de chaque décor (0–1, fondus
   * pendant la traversée), ouverture de la faille, variante et couleurs de la transition. Décoratif seulement.
   */
  world: number;
  worldTo: number;
  worldMix: number;
  amt: [number, number, number, number];
  /** Mer nébulaire : Éclipse des géants (masse, pénombre, dispersion, éclat de la révélation), fonction du temps de jeu local (jamais de l'audio). */
  eclipse: EclipseState;
  holeOpen: number;
  variant: TransitionVariant | null;
  riftFrom: number;
  riftTo: number;
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
      user: 1,
      calm: 0,
      perc: 0,
      instab: 0,
      stab: 0,
      pulse: 1,
      spawnFissure: 0,
      spawnRing: 0,
      spawnWave: 0,
      spawnArcs: 0,
      world: 0,
      worldTo: 0,
      worldMix: 0,
      amt: [1, 0, 0, 0],
      eclipse: { mass: 0, dark: 0, scatter: 0, flash: 0, glow: 0, active: false },
      holeOpen: 1,
      variant: null,
      riftFrom: AMBIENCE_COLORS_AZURE,
      riftTo: AMBIENCE_COLORS_VIOLET,
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
    s.perc = s.instab = s.stab = 0;
    s.pulse = 1;
    this.w2Open = 0;
    s.world = 0;
    s.worldTo = 0;
    s.worldMix = 0;
    s.amt = [1, 0, 0, 0];
    eclipseAt(-1e9, s.eclipse);
    s.holeOpen = 1;
    s.variant = null;
    this.scriptIdx = 0;
    this.lastSurvival = 0;
    this.prevCalm = 0;
  }

  private scriptIdx = 0;
  private lastSurvival = 0;
  /** Effets demandés à la main (outils du mode développeur) : appliqués à la prochaine image. */
  private manual: ('bolt' | 'wave' | 'ring' | 'fissure')[] = [];
  /** Passage calme de l'image précédente (détection de la reprise). */
  private prevCalm = 0;
  /** La Faille : ouverture de la faille centrale, lissée (elle se rouvre doucement à l'émergence). */
  private w2Open = 0;

  /**
   * @param survival temps de survie actif (s) — la pause l'arrête
   * @param dt pas d'animation (s) — 0 en pause
   * @param music image musicale courante
   * @param intensity réglage du joueur (0–1) : 1 = ambiance complète ; 0 = ciel étoilé seul (ni faille, ni nébuleuses, ni réaction musicale)
   */
  private lastDt = 0;

  update(
    survival: number,
    dt: number,
    music: MusicFrame,
    reduced: boolean,
    intensity = 1,
    ph: { phase: 1 | 2; transit: number; phased?: boolean; world?: { index: number; to: number } } = { phase: 1, transit: 0 },
  ): AmbienceState {
    const s = this.state;
    s.reduced = reduced;
    this.lastDt = dt;
    s.spawnRing = s.spawnWave = s.spawnArcs = s.spawnFissure = 0;
    for (const k of this.manual.splice(0)) {
      if (k === 'bolt') s.spawnArcs += 2;
      else if (k === 'wave') {
        s.spawnWave = Math.max(s.spawnWave, 1);
        s.drop = Math.max(s.drop, 0.9);
      } else if (k === 'ring') s.spawnRing = Math.max(s.spawnRing, 1);
      else s.spawnFissure = Math.max(s.spawnFissure, 1);
    }
    s.time += dt;
    s.phase = ph.phase;
    s.transit = ph.transit;
    // Noyau : petite sphère, puis faille de 4 min 30 à 5 min ; en phase 2 il reste un foyer de fissures. Apparence de la phase 2 : fondue sous le flash.
    s.core = ph.phase === 2 ? 0.35 : ph.phased === false ? 0 : smoothstep((survival - PHASES.coreGrowFrom) / (PHASES.phase2At - PHASES.coreGrowFrom));
    const look = ph.phase === 2 ? 1 : ph.transit > 0 ? smoothstep((ph.transit - AMBIENCE.phase2.flash.from) / (AMBIENCE.phase2.flash.peak - AMBIENCE.phase2.flash.from)) : 0;
    s.look = look;
    s.stage = stageAt(survival);
    if (ph.world) this.worldLook(survival, ph.transit, ph.world);
    else s.world = 0;
    for (const k of PARAM_KEYS) s.p[k] = paramAt(k, s.stage);
    // La Faille et la Mer nébulaire : les paramètres du stade sont remplacés, en fondu avec la présence du décor, par ceux du morceau
    if (s.world > 0 && s.amt[1] > 0) {
      const w2 = AMBIENCE.world2.params;
      for (const k of PARAM_KEYS) s.p[k] += (w2[k] - s.p[k]) * s.amt[1];
    }
    if (s.world > 0 && s.amt[2] > 0) {
      const w3 = AMBIENCE.world3.params;
      for (const k of PARAM_KEYS) s.p[k] += (w3[k] - s.p[k]) * s.amt[2];
    }
    const user = clamp01(intensity);
    s.user = user;
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
    if (music.active && (music.track === 'w2' || music.track === 'w3')) {
      // Carte détaillée : le calme est celui du morceau (pas une estimation par seuil d'intensité), apaisé en douceur (figé en pause)
      if (dt > 0) s.calm += ((music.calm ?? 0) - s.calm) * (1 - Math.exp(-dt / AMBIENCE.world2.calmSmooth));
    } else s.calm = music.active ? 1 - smoothstep((s.intensity - cm.low) / (cm.high - cm.low)) : 0;
    // Univers : les décors des mondes 3 et 4 éteignent les couches de l'espace d'origine (nébuleuses, poussières, arcs)
    if (s.world > 0) {
      const legacy = Math.min(1, s.amt[0] + s.amt[1]);
      s.p.nebula *= legacy;
      s.p.dust *= 0.35 + 0.65 * legacy;
      s.p.debris *= legacy;
      s.p.arcRate *= legacy;
      s.p.stars *= 0.45 + 0.55 * legacy;
      s.p.gridWarp *= legacy;
    }
    // Moments forts préparés (instants de survie active) : ondes et fissures, en plus des réactions issues de l'analyse
    if (dt > 0 && ph.transit === 0 && s.world === 0) {
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

  /**
   * Univers : présence des décors (fondus pendant la TRAVERSÉE de la transition), faille qui se forme dans les 25 dernières secondes de chaque univers
   * puis enveloppe l'écran pendant la transition, stade d'ambiance étalé sur les 8 minutes, couleurs de la faille selon la variante.
   */
  private worldLook(survival: number, transit: number, w: { index: number; to: number }): void {
    const s = this.state;
    const tl = WORLDS.timeline;
    s.world = w.index;
    s.worldTo = w.to;
    const k = transit > 0 ? smoothstep((transit - tl.pull) / (tl.cross - tl.pull)) : 0;
    s.worldMix = k;
    for (let i = 0; i < 4; i++) {
      const id = i + 1;
      s.amt[i] = (id === w.index ? 1 - k : 0) + (transit > 0 && id === w.to && w.to !== w.index ? k : 0);
    }
    s.look = s.amt[1];
    s.stage = stageAt(survival * 0.5);
    const local = survival - (w.index - 1) * WORLDS.span;
    // Faille : se forme à la fin de chaque univers (sauf le dernier, prolongé), engloutit l'écran pendant la transition, se referme à l'arrivée
    const last = w.index >= WORLD_LIST.length;
    const forming = last ? 0 : smoothstep((local - (WORLDS.span - 25)) / 25);
    s.core = transit > 0 ? 1 : forming;
    s.holeOpen = transit > 0 ? 1 - smoothstep((transit - tl.cross) / (1 - tl.cross)) : forming;
    // La Faille : la déchirure centrale est là pendant tout l'univers (elle se rouvre doucement à l'émergence) et ne fait que grandir vers la sortie
    const w2 = AMBIENCE.world2;
    const inW2 = w.index === 2 && transit === 0;
    this.w2Open += ((inW2 ? 1 : 0) - this.w2Open) * (1 - Math.exp(-this.lastDt / 1.1));
    if (w.index === 2 && transit === 0) {
      s.holeOpen = Math.max(s.holeOpen, w2.hole.open * this.w2Open);
      s.core = Math.max(s.core, w2.hole.core * this.w2Open);
    }
    // Sortie : la faille se stabilise après le dernier coup (les éclairs et les pulsations s'éteignent avant l'engloutissement)
    s.stab = w.index === 2 && transit > 0 ? smoothstep(transit / w2.stabilize) : 0;
    const def = WORLD_LIST[w.index - 1];
    s.variant = transit > 0 ? def.transition.variant : null;
    s.riftFrom = def.transition.from;
    s.riftTo = def.transition.to;
    // Mer nébulaire : l'éclipse suit le temps de jeu local (la pause la fige, une transition l'éteint)
    if (w.index === 3 && transit === 0) eclipseAt(local, s.eclipse);
    else eclipseAt(-1e9, s.eclipse);
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
    // La Faille : percussions cartographiées (éclairs), instabilité (montées, passages intenses), gain de pulsation de la faille, stabilisation à la sortie
    const w2 = AMBIENCE.world2;
    const inW2 = s.world === 2 && s.amt[1] > 0.5;
    s.pulse = inW2 ? 1 + (w2.hole.pulse - 1) * s.amt[1] * (1 - s.stab) : 1;
    // Mer nébulaire : les percussions cartographiées font scintiller les arêtes des monolithes et les brumes (aucun éclair)
    const inW3 = s.world === 3 && s.amt[2] > 0.5;
    s.perc *= Math.exp(-dt / (inW3 ? AMBIENCE.world3.perc.decay : w2.perc.decay));
    const perc = music.perc ?? 0;
    if (perc > 0 && s.amt[1] > 0.5) {
      s.perc = Math.max(s.perc, perc * (1 - s.stab));
      if ((!reduced || AMBIENCE.reduced.arcs) && perc >= w2.perc.boltFrom && this.rand() < w2.perc.boltChance * perc * (1 - 0.9 * s.calm) * (1 - s.stab)) s.spawnArcs += 1;
    } else if (perc > 0 && inW3) s.perc = Math.max(s.perc, perc * (1 - 0.7 * s.calm));
    const ins = w2.instability;
    const instTarget = inW2 && music.active ? clamp01(ins.build * s.build + ins.intensity * Math.max(0, s.intensity - 0.35) + ins.drop * s.drop) * (1 - s.stab) : 0;
    s.instab += (instTarget - s.instab) * (1 - Math.exp(-dt / ins.smooth));
    // Passage calme : impulsions réduites, anneaux et fissures rares
    const quiet = 1 - AMBIENCE.calm.reaction * s.calm;
    const waves = !reduced || AMBIENCE.reduced.waves;
    const arcs = !reduced || AMBIENCE.reduced.arcs;
    // Les battements cartographiés et les coups de basse (grosse caisse entre deux battements) ont la même réponse franche
    const hit = music.hit ?? 0;
    const power = Math.max(music.beat, hit);
    if (power >= cfg.beatThreshold) {
      s.beat = Math.max(s.beat, Math.pow(Math.min(1, power), cfg.beatCurve) * s.p.beatGain * reaction * quiet);
      // Anneau d'énergie dès un battement moyen ; onde plus rapide et plus large sur les battements très forts
      if (power >= cfg.ringBeat && this.rand() < s.p.ringChance * (1 + s.build) * quiet) s.spawnRing = power * s.p.beatGain * reaction;
      if (power >= cfg.strongBeat) {
        if (waves && this.rand() < s.p.waveChance * quiet) s.spawnWave = Math.max(s.spawnWave, s.p.waveGain * 0.7);
        if (this.rand() < (s.p.fissure + 0.25 * s.look) * quiet * (1 - s.calm)) s.spawnFissure = Math.max(s.spawnFissure, power);
      }
      // Éclair ramifié sur les battements marqués (phase 2 : plus souvent)
      if (arcs && this.rand() < (s.p.boltChance + 0.2 * s.look) * power * quiet) s.spawnArcs += 1;
    }

    // Reprise nette : fin d'un passage calme → onde, éclairs et impulsion avec la musique
    if (this.prevCalm > AMBIENCE.resume.from && s.calm < AMBIENCE.resume.to && music.active) {
      s.drop = Math.max(s.drop, s.p.waveGain * 0.7 * reaction);
      if (waves) s.spawnWave = Math.max(s.spawnWave, s.p.waveGain);
      if (arcs) s.spawnArcs += 2;
      s.spawnFissure = Math.max(s.spawnFissure, 0.9);
    }
    this.prevCalm = s.calm;

    // Passage fort : impulsion longue, onde, arcs
    s.drop *= Math.exp(-dt / cfg.dropDecay);
    if (music.drop) {
      // Carte détaillée : l'ampleur de la décharge est proportionnelle à la force de l'impact (jamais la même gifle pour un petit coup et pour le grand)
      const k = music.impact !== undefined && music.impact > 0 ? 0.45 + 0.55 * music.impact : 1;
      s.drop = Math.max(s.drop, s.p.waveGain * reaction * k);
      if (waves) s.spawnWave = s.p.waveGain * k;
      if (arcs && s.p.arcRate > 0) s.spawnArcs += music.impact !== undefined && music.impact > 0 ? Math.round(1 + (w2.impact.arcs - 1) * music.impact) : 3;
      if (s.world === 2 && s.stab === 0) s.spawnFissure = Math.max(s.spawnFissure, 0.8 + 0.2 * (music.impact ?? 1));
    }

    // Arcs occasionnels : plus fréquents avec l'intensité, les montées et les passages forts
    if (music.active && (!reduced || AMBIENCE.reduced.arcs)) {
      const rate = s.p.arcRate * (1 + s.intensity * 0.6 + s.build + s.drop * 2) * (1 - 0.85 * s.calm) * (1 + 0.8 * s.look) * (1 - s.stab);
      if (this.rand() < rate * dt) s.spawnArcs += 1;
    }
  }

  /** Demande un effet décoratif à la prochaine image (mode développeur) ; sans effet en pause et jamais lu par la simulation. */
  trigger(kind: 'bolt' | 'wave' | 'ring' | 'fissure'): void {
    this.manual.push(kind);
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
