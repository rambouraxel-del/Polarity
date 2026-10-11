import { RESPITE, SAFETY, SECTOR, SURVIVAL } from '../config/balance';
import { TAU } from '../core/math';
import type { Rng } from '../core/rng';
import { paramsFor, type DifficultyParams } from './difficulty';
import type { Hazard } from './hazards';
import { PATTERNS, PATTERN_IDS, type PatternId, type PatternWeights } from './patterns';
import { hasEscapePath } from './safety';

/** Courbe de difficulté fournie par un mode de jeu (Survie, Niveau, Défi). */
export interface DifficultyProfile {
  /** Difficulté d ∈ [0, 1] au temps actif t. */
  difficulty(t: number): number;
  /** Poids des motifs disponibles au temps t. */
  weights(t: number): PatternWeights;
  /** Modulation du rythme (1 = normal). */
  intervalScale(t: number): number;
  firstWaveDelay: number;
  /** Respirations périodiques (pauses plus longues entre certaines vagues). */
  breaths: boolean;
  /** Plus aucune vague après ce temps (fin de niveau), ou null. */
  spawnUntil: number | null;
  /** Répit accordé à chaque cycle complet. */
  respite: boolean;
}

export interface DirectorWorld {
  hazards: Hazard[];
  playerAngle: number;
  playerDir: 1 | -1;
}

const REACTION_STEPS = Math.ceil(SAFETY.reactionTime / SAFETY.decisionStep);

export class Director {
  nextWaveAt: number;
  waveCount = 0;
  /** Nombre de vagues reportées faute de placement sûr (statistique de test). */
  deferred = 0;
  respiteThisWave = 0;
  lastRespiteAt = -Infinity;
  readonly params: DifficultyParams = paramsFor(0);
  private nextBreathWave: number;
  private readonly scratch: Hazard[] = [];
  private readonly weightBuf: number[] = [];
  private readonly idBuf: PatternId[] = [];

  constructor(private readonly profile: DifficultyProfile, private readonly rng: Rng) {
    this.nextWaveAt = profile.firstWaveDelay;
    this.nextBreathWave = rng.int(SURVIVAL.breathEvery.min, SURVIVAL.breathEvery.max);
  }

  /** Lance une vague si elle est due. Renvoie les menaces ajoutées (ou null). */
  update(now: number, world: DirectorWorld): Hazard[] | null {
    if (now < this.nextWaveAt) return null;
    const until = this.profile.spawnUntil;
    if (until !== null && now >= until) {
      this.nextWaveAt = Infinity;
      return null;
    }
    const p = paramsFor(this.profile.difficulty(now), this.params);
    const weights = this.profile.weights(now);
    this.idBuf.length = 0;
    this.weightBuf.length = 0;
    for (const id of PATTERN_IDS) {
      const w = weights[id] ?? 0;
      if (w > 0) {
        this.idBuf.push(id);
        this.weightBuf.push(w);
      }
    }
    if (this.idBuf.length === 0) {
      this.nextWaveAt = now + SAFETY.retryDelay;
      return null;
    }

    const ctx = { now, rng: this.rng, p, playerAngle: world.playerAngle, playerDir: world.playerDir };
    for (let attempt = 0; attempt < SAFETY.attempts; attempt++) {
      const id = this.idBuf[this.rng.weighted(this.weightBuf)];
      const def = PATTERNS[id];
      const added = def.build(ctx);
      if (!this.fitsCaps(now, world.hazards, added, p)) continue;
      const all = this.scratch;
      all.length = 0;
      for (const h of world.hazards) all.push(h);
      for (const h of added) all.push(h);
      const ok = hasEscapePath(all, {
        angle: world.playerAngle,
        dir: world.playerDir,
        time: now,
        forcedSteps: REACTION_STEPS,
        forcedDir: world.playerDir,
      });
      all.length = 0;
      if (!ok) continue;
      this.accept(now, def.cost, p);
      return added;
    }
    this.deferred++;
    this.nextWaveAt = now + SAFETY.retryDelay;
    return null;
  }

  private accept(now: number, cost: number, p: DifficultyParams): void {
    this.waveCount++;
    let interval = p.waveInterval * cost * this.profile.intervalScale(now);
    if (this.profile.breaths && this.waveCount >= this.nextBreathWave) {
      interval += this.rng.range(SURVIVAL.breathDuration.min, SURVIVAL.breathDuration.max);
      this.nextBreathWave += this.rng.int(SURVIVAL.breathEvery.min, SURVIVAL.breathEvery.max);
    }
    this.nextWaveAt = now + interval;
    this.respiteThisWave = 0;
  }

  private fitsCaps(now: number, existing: readonly Hazard[], added: readonly Hazard[], p: DifficultyParams): boolean {
    // Seules comptent les menaces qui peuvent encore toucher l'orbite
    let count = added.length;
    let sectors = 0;
    let coverage = 0;
    for (const h of existing) {
      if (h.threatEnd < now) continue;
      count++;
      if (h.kind === 'sector') { sectors++; coverage += 2 * h.half; }
    }
    if (count > p.maxHazards) return false;
    for (const h of added) if (h.kind === 'sector') { sectors++; coverage += 2 * h.half; }
    if (sectors > SECTOR.maxSimultaneous) return false;
    if (coverage / TAU > SECTOR.maxCoverage) return false;
    return true;
  }

  /**
   * Répit de cycle : retarde légèrement la prochaine vague en attente.
   * Borné par un délai minimal entre deux répits et un cumul maximal par vague.
   * Renvoie le retard réellement appliqué.
   */
  onCycleComplete(now: number): number {
    if (!this.profile.respite) return 0;
    if (!Number.isFinite(this.nextWaveAt) || this.nextWaveAt <= now) return 0;
    if (now - this.lastRespiteAt < RESPITE.cooldown) return 0;
    const room = RESPITE.maxPerWave - this.respiteThisWave;
    if (room <= 0) return 0;
    const add = Math.min(RESPITE.delay, room);
    this.nextWaveAt += add;
    this.respiteThisWave += add;
    this.lastRespiteAt = now;
    return add;
  }
}
