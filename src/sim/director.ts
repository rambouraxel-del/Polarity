import { CAPS, RESPITE, SAFETY, SECTOR } from '../config/balance';
import { EVENTS, eventDef, type EventDef, type EventKind } from '../config/events';
import { TAU } from '../core/math';
import { Rng } from '../core/rng';
import { paramsFor, type DifficultyParams } from './difficulty';
import { arcCoverage, type Hazard } from './hazards';
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
  /** Facteur de vitesse du vaisseau (1 = référence) selon le temps de jeu actif. */
  speed(t: number): number;
  firstWaveDelay: number;
  /** Réduction des annonces (1 = inchangé). Les planchers de CAPS s'appliquent toujours. */
  warnScale?: number;
  /** Respirations : toutes les `every` vagues, une pause supplémentaire de `duration`. Absent = aucune. */
  breath?(t: number): BreathParams | null;
  /** Événements (Survie / défi quotidien) : absent = aucun. */
  events?: boolean;
  /** Éclats sur l'orbite (Survie) : absent = aucun. */
  shards?: boolean;
  /** Plus aucune vague après ce temps (fin de niveau), ou null. */
  spawnUntil: number | null;
  /** Répit accordé à chaque cycle complet. */
  respite: boolean;
}

export interface BreathParams {
  every: { min: number; max: number };
  duration: { min: number; max: number };
}

/** Phase du directeur : une seule à la fois, donc jamais deux sources de vagues en même temps. */
export type DirectorPhase = 'normal' | 'announce' | 'event' | 'breath';

/** Transition d'événement, relayée en événement de simulation (son, bandeau). */
export interface DirectorEvent {
  stage: 'announce' | 'start' | 'end' | 'resume';
  kind: EventKind;
}

export interface EventStatus {
  phase: DirectorPhase;
  kind: EventKind | null;
  /** Annonce : secondes avant le début ; événement : secondes restantes ; respiration : secondes restantes. */
  remaining: number;
}

export interface DirectorWorld {
  hazards: Hazard[];
  playerAngle: number;
  playerDir: 1 | -1;
}

export class Director {
  nextWaveAt: number;
  waveCount = 0;
  /** Nombre de vagues reportées faute de placement sûr (statistique de test). */
  deferred = 0;
  respiteThisWave = 0;
  lastRespiteAt = -Infinity;
  readonly params: DifficultyParams = paramsFor(0);
  /** Observateur facultatif (tests, outils d'équilibrage) : instant et motif de chaque vague acceptée. */
  onWave?: (time: number, pattern: PatternId, phase: DirectorPhase) => void;
  private nextBreathWave: number;
  /** Phase courante : un seul directeur actif (normal, annonce, événement ou respiration). */
  phase: DirectorPhase = 'normal';
  /** Transitions à relayer (vidé par la simulation à chaque pas). */
  readonly pendingEvents: DirectorEvent[] = [];
  /** Calendrier des événements : début, fin, fin de respiration, type. */
  eventKind: EventKind = 'meteor';
  eventStart = Infinity;
  eventEnd = Infinity;
  breathEnd = Infinity;
  eventCount = 0;
  private readonly eventRng: Rng;
  private readonly scratch: Hazard[] = [];
  private readonly weightBuf: number[] = [];
  private readonly idBuf: PatternId[] = [];

  constructor(private readonly profile: DifficultyProfile, private readonly rng: Rng, seed = 0) {
    this.nextWaveAt = profile.firstWaveDelay;
    // Le tirage est conservé même sans respirations : l'ordre des tirages des niveaux reste celui de la v1.0.
    const b0 = profile.breath?.(0);
    this.nextBreathWave = b0 ? rng.int(b0.every.min, b0.every.max) : rng.int(6, 9);
    // Calendrier des événements : générateur dédié (indépendant des actions du joueur et des tirages des vagues)
    this.eventRng = new Rng(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
    if (profile.events) {
      this.eventStart = this.eventRng.range(EVENTS.first.min, EVENTS.first.max);
      this.eventKind = this.pickKind();
    }
  }

  private pickKind(): EventKind {
    return this.eventRng.next() < 0.5 ? 'meteor' : 'storm';
  }

  /** État courant pour l'interface (bandeau d'annonce, libellé de l'événement). */
  status(now: number): EventStatus {
    switch (this.phase) {
      case 'announce': return { phase: this.phase, kind: this.eventKind, remaining: Math.max(0, this.eventStart - now) };
      case 'event': return { phase: this.phase, kind: this.eventKind, remaining: Math.max(0, this.eventEnd - now) };
      case 'breath': return { phase: this.phase, kind: this.eventKind, remaining: Math.max(0, this.breathEnd - now) };
      default: return { phase: 'normal', kind: null, remaining: 0 };
    }
  }

  /**
   * Transitions du calendrier. Les menaces déjà présentes ne sont jamais effacées : elles finissent normalement.
   * Pendant l'annonce et la respiration, aucune nouvelle attaque n'est lancée.
   */
  private advancePhase(now: number): void {
    if (!this.profile.events) return;
    if (this.phase === 'normal' && now >= this.eventStart - EVENTS.announce) {
      this.phase = 'announce';
      this.pendingEvents.push({ stage: 'announce', kind: this.eventKind });
    }
    if (this.phase === 'announce' && now >= this.eventStart) {
      this.phase = 'event';
      this.eventEnd = this.eventStart + eventDef(this.eventKind).duration;
      this.nextWaveAt = now;
      this.pendingEvents.push({ stage: 'start', kind: this.eventKind });
    }
    if (this.phase === 'event' && now >= this.eventEnd) {
      this.phase = 'breath';
      this.breathEnd = this.eventEnd + EVENTS.breath;
      this.eventCount++;
      this.pendingEvents.push({ stage: 'end', kind: this.eventKind });
      // Prochain événement : 40 à 60 s après la fin de celui-ci
      this.eventStart = this.eventEnd + this.eventRng.range(EVENTS.gap.min, EVENTS.gap.max);
    }
    if (this.phase === 'breath' && now >= this.breathEnd) {
      const ended = this.eventKind;
      this.phase = 'normal';
      this.eventKind = this.pickKind();
      this.nextWaveAt = Math.max(this.nextWaveAt, this.breathEnd + EVENTS.resumeDelay);
      this.pendingEvents.push({ stage: 'resume', kind: ended });
    }
  }

  /** Construit un motif donné à l'instant `now`, sans validation (outil de démonstration et de test). */
  buildPattern(id: PatternId, now: number, world: DirectorWorld): Hazard[] {
    const p = paramsFor(this.profile.difficulty(now), undefined, { warnScale: this.profile.warnScale ?? 1, speed: this.profile.speed(now) });
    return PATTERNS[id].build({ now, rng: this.rng, p, playerAngle: world.playerAngle, playerDir: world.playerDir, speed: this.profile.speed });
  }

  /** Lance une vague si elle est due. Renvoie les menaces ajoutées (ou null). */
  update(now: number, world: DirectorWorld): Hazard[] | null {
    this.advancePhase(now);
    if (this.phase === 'announce' || this.phase === 'breath') return null;
    if (now < this.nextWaveAt) return null;
    const until = this.profile.spawnUntil;
    if (until !== null && now >= until) {
      this.nextWaveAt = Infinity;
      return null;
    }
    const p = paramsFor(this.profile.difficulty(now), this.params, { warnScale: this.profile.warnScale ?? 1, speed: this.profile.speed(now) });
    const def: EventDef | null = this.phase === 'event' ? eventDef(this.eventKind) : null;
    const weights = def ? def.weights : this.profile.weights(now);
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

    const ctx = { now, rng: this.rng, p, playerAngle: world.playerAngle, playerDir: world.playerDir, speed: this.profile.speed };
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
        forcedTime: SAFETY.reactionTime,
        forcedDir: world.playerDir,
        speed: this.profile.speed,
      });
      all.length = 0;
      if (!ok) continue;
      this.accept(now, id, def.cost, p);
      return added;
    }
    this.deferred++;
    this.nextWaveAt = now + SAFETY.retryDelay;
    return null;
  }

  private accept(now: number, pattern: PatternId, cost: number, p: DifficultyParams): void {
    this.waveCount++;
    // Plafond : jamais moins de CAPS.minWaveInterval entre deux vagues, quelle que soit l'intensité.
    const inEvent = this.phase === 'event';
    const scale = inEvent ? eventDef(this.eventKind).intervalScale : this.profile.intervalScale(now);
    let interval = Math.max(CAPS.minWaveInterval, p.waveInterval * cost * scale);
    const breath = inEvent ? null : this.profile.breath?.(now);
    if (breath && this.waveCount >= this.nextBreathWave) {
      interval += this.rng.range(breath.duration.min, breath.duration.max);
      this.nextBreathWave = this.waveCount + this.rng.int(breath.every.min, breath.every.max);
    }
    this.nextWaveAt = now + interval;
    this.onWave?.(now, pattern, this.phase);
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
      if (h.kind !== 'projectile') { sectors++; coverage += arcCoverage(h); }
    }
    if (count > p.maxHazards) return false;
    for (const h of added) if (h.kind !== 'projectile') { sectors++; coverage += arcCoverage(h); }
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
    if (!this.profile.respite || this.phase !== 'normal') return 0;
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
