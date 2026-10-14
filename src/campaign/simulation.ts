import { RESPITE, SIM } from '../config/balance';
import { MISSION_OBJECTS, OBJECT_KINDS, UPGRADE_EFFECTS, type MissionDef, type ObjectKind } from '../config/campaign';
import { playerHitRadius } from '../config/hitbox';
import { angleDiff, clamp, sweepOverlapsArc, TAU, wrapAngle } from '../core/math';
import { Rng } from '../core/rng';
import { hazardHits } from '../sim/collision';
import type { DifficultyProfile } from '../sim/director';
import { projectileX, projectileY, type Hazard } from '../sim/hazards';
import { Simulation, type SimState } from '../sim/simulation';
import { omegaAt, timeAfterTravel } from '../sim/speed';
import { lerp } from '../config/balance';

/**
 * Simulation d'une mission de campagne.
 *
 * Elle RÉUTILISE la simulation existante (hazards, directeur de vagues, balises, score) sans la modifier : la Survie et son rejeu
 * serveur restent donc strictement inchangés. La classe sous-jacente tourne en « invincible » (aucune collision en interne) ;
 * ici, les collisions avec les dangers sont évaluées AVANT chaque pas (comme dans la simulation) puis arbitrées :
 * bouclier de secours, invulnérabilité, échec. Les améliorations n'existent que dans cette classe.
 */
export interface ActiveUpgrades {
  shield: boolean;
  collector: boolean;
  stabilizer: boolean;
}

export const NO_UPGRADES: ActiveUpgrades = { shield: false, collector: false, stabilizer: false };

export type MissionOutcome = 'running' | 'success' | 'failure' | 'timeout';

export interface MissionObject {
  id: number;
  kind: ObjectKind;
  angle: number;
  spawnedAt: number;
  /** Null = persistant jusqu'à sa collecte. */
  expiresAt: number | null;
}

export type CampaignEvent =
  | { type: 'object-spawn'; kind: ObjectKind; angle: number }
  | { type: 'object-collect'; kind: ObjectKind; angle: number; count: number }
  | { type: 'object-miss'; kind: ObjectKind; angle: number }
  | { type: 'shield'; x: number; y: number }
  | { type: 'shield-end' }
  | { type: 'lock'; done: number; total: number }
  | { type: 'line'; text: string }
  | { type: 'announce'; text: string }
  | { type: 'sequence'; done: number; total: number };

export interface MissionReport {
  missionId: number;
  outcome: Exclude<MissionOutcome, 'running'>;
  time: number;
  beacons: number;
  cycles: number;
  maxMultiplier: number;
  shieldUsed: boolean;
  objectsCollected: number;
  objectsMissed: number;
  /** Étoiles obtenues dans cette tentative (si l'objectif principal est atteint) : objectif et défi secondaire. */
  stars: { main: boolean; challenge: boolean };
}

interface Runtime {
  cycles: number;
}

export function missionProfile(m: MissionDef, rt: Runtime): DifficultyProfile {
  const s = m.script;
  const phaseAt = (t: number) => s.phases.find((p) => t >= p.from && t < p.to) ?? s.phases[s.phases.length - 1];
  const inBreath = (t: number): boolean => s.breaths.some(([a, b]) => t >= a && t < b);
  return {
    difficulty: (t) => lerp(s.difficulty[0], s.difficulty[1], clamp(t / m.limit, 0, 1)),
    weights: (t) => {
      if (inBreath(t)) return {};
      if (s.phaseByCycles) return s.phaseByCycles[Math.min(rt.cycles, s.phaseByCycles.length - 1)];
      return phaseAt(t).weights;
    },
    intervalScale: (t) => (s.phaseByCycles ? 1 : phaseAt(t).intervalScale ?? 1),
    // La vitesse est réglée par mission : pas de courbe temporelle
    speed: () => m.speed,
    firstWaveDelay: s.firstWave,
    spawnUntil: m.limit - 1,
    respite: true,
  };
}

export class CampaignSimulation extends Simulation {
  readonly mission: MissionDef;
  readonly upgrades: ActiveUpgrades;
  outcome: MissionOutcome = 'running';
  /** Objets de mission actifs (un seul à la fois). */
  objects: MissionObject[] = [];
  beaconsCollected = 0;
  cyclesDone = 0;
  objectsCollected = 0;
  objectsMissed = 0;
  shieldCharges = 0;
  shieldUsed = false;
  /** Instant jusqu'auquel le vaisseau est invulnérable (après l'absorption d'une collision). */
  invulnUntil = -1;
  finishTime = 0;
  /** Événements propres à la campagne, vidés par l'application. */
  readonly campaignEvents: CampaignEvent[] = [];
  private flipParity = 0;
  private readonly rt: Runtime;
  private readonly objRng: Rng;
  private objCounter = 0;
  private nextObjectAt = Infinity;
  private objectsSpawned = false;
  private approachDone = false;
  private lineIdx = 0;
  private announceIdx = 0;
  private sequencesDone = 0;
  private shieldEndPending = false;

  /** Fabrique : la fonction de profil a besoin de l'état partagé avant l'appel du constructeur parent. */
  static create(mission: MissionDef, seed: number, upgrades: ActiveUpgrades = NO_UPGRADES): CampaignSimulation {
    const rt: Runtime = { cycles: 0 };
    return new CampaignSimulation(mission, seed, upgrades, rt);
  }

  private constructor(mission: MissionDef, seed: number, upgrades: ActiveUpgrades, rt: Runtime) {
    super({ seed, profile: missionProfile(mission, rt), timeLimit: mission.limit, invincible: true });
    this.mission = mission;
    this.upgrades = upgrades;
    this.rt = rt;
    this.objRng = new Rng(Math.imul(seed ^ 0x2f6e2b1, 0x9e3779b1) >>> 0);
    this.shieldCharges = upgrades.shield ? UPGRADE_EFFECTS.shield.charges : 0;
    const o = mission.objective;
    // Avec une phase d'approche (`after`), les objets n'apparaissent qu'une fois assez d'éclats récoltés
    if (o.type === 'objects' && !o.after) this.nextObjectAt = o.first;
  }

  override flip(): void {
    if (this.state === 'running' && this.outcome === 'running') this.flipParity ^= 1;
    super.flip();
  }

  /** Demi-arc de collecte des objets de mission. */
  get objectRadius(): number {
    return MISSION_OBJECTS.radius * (this.upgrades.collector ? UPGRADE_EFFECTS.collector.objectScale : 1);
  }

  /** Invulnérable (bouclier déclenché récemment) ? */
  get invulnerable(): boolean {
    return this.time < this.invulnUntil;
  }

  override step(): void {
    if (this.state !== 'running') return;
    const dt = SIM.dt;
    const t0 = this.time;
    const t1 = t0 + dt;
    const from = this.angle;
    // Direction effective de ce pas : les inversions en attente s'appliquent au début du pas
    const dir: 1 | -1 = this.flipParity ? (this.dir === 1 ? -1 : 1) : this.dir;
    this.flipParity = 0;
    const delta = dir * omegaAt(this.speedFn, t0 + dt / 2) * dt;

    // 1. Collision : évaluée avant tout le reste (règle de la simulation)
    let hit: Hazard | null = null;
    if (t0 >= this.invulnUntil) {
      for (const h of this.hazards) {
        if (hazardHits(h, from, delta, t0, t1, playerHitRadius())) {
          hit = h;
          break;
        }
      }
    }
    const evStart = this.events.length;
    super.step();
    if (this.invulnUntil > 0 && this.shieldEndPending && this.time >= this.invulnUntil) {
      this.shieldEndPending = false;
      this.campaignEvents.push({ type: 'shield-end' });
    }
    if (hit) {
      if (this.shieldCharges > 0) {
        // Bouclier : absorbe la collision, puis invulnérabilité brève. Une collision pendant l'invulnérabilité ne consomme rien.
        this.shieldCharges--;
        this.shieldUsed = true;
        this.invulnUntil = this.time + UPGRADE_EFFECTS.shield.invulnerable;
        this.shieldEndPending = true;
        this.campaignEvents.push({ type: 'shield', x: this.playerX(), y: this.playerY() });
      } else {
        this.fail('failure', hit);
        return;
      }
    }

    // 2. Collecteur amélioré : balises un peu plus tolérantes (la collision avec les dangers n'est pas concernée)
    if (this.upgrades.collector && this.state === 'running') {
      const arc = UPGRADE_EFFECTS.collector.beaconArc;
      this.beacons.sweep(from - dir * arc, delta + dir * 2 * arc, this.onExtraCollect, this.onExtraCycle);
    }

    // 3. Événements de cette étape : balises, cycles
    for (let i = evStart; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.type === 'collect') this.beaconsCollected++;
      else if (e.type === 'cycle') this.onCycleDone(e.respite);
    }

    // 4. Objets de mission, objectif, transmissions
    // `super.step()` peut avoir changé l'état : TypeScript ne le voit pas
    const state = this.state as SimState;
    if (state === 'running' || state === 'complete') {
      this.updateObjects(from, delta);
      this.checkObjective();
      this.emitScripted();
    }
    // Limite de temps atteinte (la simulation parente passe en « complete ») : échec, sauf pour « survivre »
    if ((this.state as SimState) === 'complete' && this.outcome === 'running') {
      if (this.mission.objective.type === 'survive') this.succeed();
      else {
        this.outcome = 'timeout';
        this.finishTime = this.time;
        this.removeCompleteEvent(evStart);
      }
    }
  }

  // ————————————————————————— collecte étendue des balises

  private readonly onExtraCollect = (index: number): void => {
    const before = this.scoring.multiplier;
    const points = this.scoring.collect();
    this.events.push({ type: 'collect', index, points, multiplier: this.scoring.multiplier });
    if (this.scoring.multiplier > before) this.events.push({ type: 'multiplier', value: this.scoring.multiplier, up: true });
  };

  private readonly onExtraCycle = (): void => {
    const points = this.scoring.cycle();
    const respite = this.director.onCycleComplete(this.time);
    this.events.push({ type: 'cycle', points, respite });
  };

  // ————————————————————————— cycles, verrous, stabilisateur

  private onCycleDone(respite: number): void {
    this.cyclesDone++;
    this.rt.cycles = this.cyclesDone;
    // Stabilisateur orbital : répit supplémentaire après les cycles qui en accordent déjà un, cumul borné
    if (this.upgrades.stabilizer && respite > 0) {
      const room = RESPITE.maxPerWave - this.director.respiteThisWave;
      const add = Math.min(UPGRADE_EFFECTS.stabilizer.extraRespite, Math.max(0, room));
      if (add > 0 && Number.isFinite(this.director.nextWaveAt)) {
        this.director.nextWaveAt += add;
        this.director.respiteThisWave += add;
      }
    }
    const o = this.mission.objective;
    if (o.type === 'cycles') {
      this.campaignEvents.push({ type: 'lock', done: Math.min(this.cyclesDone, o.count), total: o.count });
      // Missions à phases : calme à chaque changement de phase (aucune nouvelle vague, menaces actives inchangées)
      if (this.mission.script.phaseByCycles && this.cyclesDone < o.count) {
        const calm = this.mission.script.phaseCalm ?? 0;
        if (calm > 0) this.director.nextWaveAt = Math.max(this.director.nextWaveAt, this.time + calm);
      }
    }
  }

  // ————————————————————————— objets de mission

  private updateObjects(from: number, delta: number): void {
    const o = this.mission.objective;
    if (this.outcome !== 'running') return;
    // Fin de la phase d'approche : les objets se mettent à apparaître
    if (o.type === 'objects' && o.after && !this.approachDone && this.beaconsCollected >= o.after.beacons) {
      this.approachDone = true;
      this.nextObjectAt = this.time + o.first;
    }
    // Collecte
    const obj = this.objects[0];
    if (obj) {
      if (sweepOverlapsArc(from, delta, obj.angle, this.objectRadius)) {
        this.objects.length = 0;
        this.objectsCollected++;
        this.campaignEvents.push({ type: 'object-collect', kind: obj.kind, angle: obj.angle, count: this.objectsCollected });
        if (o.type === 'objects' && this.objectsCollected < o.count) this.nextObjectAt = this.time + this.objRng.range(o.gap.min, o.gap.max);
      } else if (obj.expiresAt !== null && this.time >= obj.expiresAt) {
        // Objet manqué : il réapparaît
        this.objects.length = 0;
        this.objectsMissed++;
        this.campaignEvents.push({ type: 'object-miss', kind: obj.kind, angle: obj.angle });
        if (o.type === 'objects') this.nextObjectAt = this.time + o.respawn;
      }
    }
    // Apparition
    if (this.objects.length === 0) {
      if (o.type === 'objects' && this.objectsCollected < o.count && this.time >= this.nextObjectAt) {
        this.spawnObject(o.kind, o.lifetime);
        this.nextObjectAt = Infinity;
      } else if (o.type === 'cyclesThenObject' && !this.objectsSpawned && this.cyclesDone >= o.cycles) {
        this.spawnObject(o.kind, null);
        this.objectsSpawned = true;
      }
    }
  }

  private spawnObject(kind: ObjectKind, lifetime: number | null): void {
    const now = this.time;
    let angle = 0;
    let found = false;
    for (let i = 0; i < MISSION_OBJECTS.attempts && !found; i++) {
      angle = wrapAngle(this.objRng.range(0, TAU));
      if (Math.abs(angleDiff(this.angle, angle)) < MISSION_OBJECTS.minShipGap) continue;
      if (this.beacons.angles.some((b, k) => this.beacons.active[k] && Math.abs(angleDiff(b, angle)) < MISSION_OBJECTS.minBeaconGap)) continue;
      if (lifetime !== null && !this.reachable(angle, lifetime)) continue;
      found = true;
    }
    if (!found) {
      // Repli : devant le vaisseau, à portée garantie
      angle = wrapAngle(this.angle + this.dir * (MISSION_OBJECTS.minShipGap + 0.5 + this.objRng.range(0, 0.6)));
    }
    this.objects.push({ id: ++this.objCounter, kind, angle, spawnedAt: now, expiresAt: lifetime === null ? null : now + lifetime });
    this.campaignEvents.push({ type: 'object-spawn', kind, angle });
  }

  /** Accessible avec la vitesse réelle du vaisseau : sans inversion, ou après une inversion (marge de réaction). */
  private reachable(target: number, lifetime: number): boolean {
    const half = this.objectRadius;
    const ahead = wrapAngle((target - this.angle) * this.dir);
    const behind = TAU - ahead;
    const time = (rad: number): number => timeAfterTravel(this.speedFn, this.time, Math.max(0, rad - half)) - this.time;
    return time(ahead) <= lifetime || time(behind) <= lifetime - MISSION_OBJECTS.reactionMargin;
  }

  // ————————————————————————— objectif, fin

  private checkObjective(): void {
    // L'état peut déjà être « complete » (limite atteinte à ce même pas) : un objectif rempli à cet instant précis reste une victoire
    if (this.outcome !== 'running' || (this.state !== 'running' && (this.state as SimState) !== 'complete')) return;
    const o = this.mission.objective;
    let done = false;
    switch (o.type) {
      case 'survive': done = this.time >= o.seconds; break;
      case 'beacons': done = this.beaconsCollected >= o.count; break;
      case 'objects': done = this.objectsCollected >= o.count; break;
      case 'cycles': done = this.cyclesDone >= o.count; break;
      case 'cyclesThenObject': done = this.objectsCollected >= 1; break;
    }
    if (done) this.succeed();
  }

  private succeed(): void {
    if (this.outcome !== 'running') return;
    this.outcome = 'success';
    this.finishTime = this.time;
    if (this.state === 'running') {
      this.state = 'complete';
      this.events.push({ type: 'complete' });
    }
  }

  private fail(kind: 'failure', hit: Hazard): void {
    this.outcome = kind;
    this.finishTime = this.time;
    // Une fin de limite simultanée est annulée : la collision est évaluée avant
    this.removeCompleteEvent(0);
    this.state = 'dead';
    const x = this.playerX();
    const y = this.playerY();
    let hitX = x;
    let hitY = y;
    if (hit.kind === 'projectile') {
      const bx = projectileX(hit, Math.min(this.time, hit.end));
      const by = projectileY(hit, Math.min(this.time, hit.end));
      hitX = x + (bx - x) * 0.5;
      hitY = y + (by - y) * 0.5;
    }
    this.events.push({ type: 'death', x, y, hitX, hitY, by: hit.kind });
  }

  private removeCompleteEvent(from: number): void {
    for (let i = this.events.length - 1; i >= from; i--) {
      if (this.events[i].type === 'complete') this.events.splice(i, 1);
    }
  }

  // ————————————————————————— transmissions et séquences

  private emitScripted(): void {
    const s = this.mission.script;
    const t = this.time;
    while (this.lineIdx < s.lines.length && t >= s.lines[this.lineIdx].at) this.campaignEvents.push({ type: 'line', text: s.lines[this.lineIdx++].text });
    while (this.announceIdx < s.announces.length && t >= s.announces[this.announceIdx].at) this.campaignEvents.push({ type: 'announce', text: s.announces[this.announceIdx++].text });
    if (s.sequences) {
      const done = s.sequences.filter(([, end]) => t >= end).length;
      if (done > this.sequencesDone) {
        this.sequencesDone = done;
        this.campaignEvents.push({ type: 'sequence', done, total: s.sequences.length });
      }
    }
  }

  // ————————————————————————— affichage et bilan

  /** Texte d'avancement de l'objectif (HUD). */
  progressText(): string {
    const o = this.mission.objective;
    const s = this.mission.script;
    switch (o.type) {
      case 'survive': {
        if (o.label) return `${o.label} ${Math.min(100, Math.floor((this.time / o.seconds) * 100))} %`;
        if (s.sequences) {
          const cur = Math.min(s.sequences.length, s.sequences.filter(([a]) => this.time >= a).length);
          return cur > 0 ? `Séquence ${cur}/${s.sequences.length}` : 'Séquences électriques : 0/3';
        }
        return 'Survivre';
      }
      case 'beacons': return `Éclats ${Math.min(this.beaconsCollected, o.count)}/${o.count}`;
      case 'objects':
        if (o.after && !this.approachDone) return `${o.after.label} : éclats ${Math.min(this.beaconsCollected, o.after.beacons)}/${o.after.beacons}`;
        return `${o.counter ?? OBJECT_KINDS[o.kind].counter} ${this.objectsCollected}/${o.count}`;
      case 'cycles': return `Verrous ${Math.min(this.cyclesDone, o.count)}/${o.count}`;
      case 'cyclesThenObject': return this.cyclesDone < o.cycles ? `Cycles ${this.cyclesDone}/${o.cycles}` : this.objectsCollected >= 1 ? 'Boîte noire récupérée' : 'Boîte noire sur l’orbite';
    }
  }

  /** Temps affiché au HUD : restant jusqu'à la fin de la mission. */
  remaining(): number {
    const o = this.mission.objective;
    const total = o.type === 'survive' ? o.seconds : this.mission.limit;
    return Math.max(0, total - this.time);
  }

  /** Bilan de la tentative. Les étoiles ne sont attribuées que si l'objectif principal est atteint. */
  report(): MissionReport {
    const outcome: MissionReport['outcome'] = this.outcome === 'running' ? 'failure' : this.outcome;
    const success = outcome === 'success';
    const c = this.mission.challenge;
    const t = this.finishTime || this.time;
    let challenge = false;
    switch (c.kind) {
      case 'time': challenge = t <= c.target; break;
      case 'beacons': challenge = this.beaconsCollected >= c.target; break;
      case 'combo': challenge = this.scoring.bestMultiplier >= c.target; break;
      case 'cycles': challenge = this.cyclesDone >= c.target; break;
    }
    return {
      missionId: this.mission.id,
      outcome,
      time: t,
      beacons: this.beaconsCollected,
      cycles: this.cyclesDone,
      maxMultiplier: this.scoring.bestMultiplier,
      shieldUsed: this.shieldUsed,
      objectsCollected: this.objectsCollected,
      objectsMissed: this.objectsMissed,
      stars: { main: success, challenge: success && challenge },
    };
  }
}
