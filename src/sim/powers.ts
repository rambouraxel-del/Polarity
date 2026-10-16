import { SIM } from '../config/balance';
import { BONUS } from '../config/economy';
import { POWERS, type PowerKind } from '../config/powers';

/**
 * Pouvoirs de la Survie : Boost, Gel temporel, Bouclier. État 100 % déterministe, évalué en PAS de simulation (jamais en temps réel) :
 * le jeu et le serveur (rejeu) aboutissent exactement aux mêmes activations, durées, recharges et absorptions.
 *
 * Une activation est DEMANDÉE (`request`), puis jugée au début du pas suivant : elle réussit seulement si les règles le permettent
 * (recharge, exclusivité Boost/Gel, plafond de la première vie, stock, jauge du Bouclier). Seules les activations RÉUSSIES entrent dans le
 * journal (`log`) ; au rejeu, une demande qui échoue prouve un journal falsifié.
 * Les durées et recharges comptent en temps de jeu actif : la pause n'avance pas les pas.
 */
export type { PowerKind };

export type DenyReason = 'disabled' | 'active' | 'cap' | 'stock' | 'exclusive' | 'cooldown' | 'gauge';

export interface PowerAct {
  /** Pas de simulation au début duquel l'activation a été appliquée. */
  step: number;
  kind: PowerKind;
}

export interface PowerStock {
  boost: number;
  gel: number;
}

export type PowerEvent =
  | { type: 'power'; kind: PowerKind; stage: 'start'; /** Une charge achetée a été consommée. */ charged: boolean }
  | { type: 'power'; kind: PowerKind; stage: 'end'; reason: 'expire' | 'hit' }
  | { type: 'shield-ready' };

const steps = (seconds: number): number => Math.round(seconds / SIM.dt);
export const BOOST_STEPS = steps(POWERS.boost.duration);
export const BOOST_COOLDOWN_STEPS = steps(POWERS.boost.cooldown);
export const GEL_STEPS = steps(POWERS.gel.duration);
export const GEL_COOLDOWN_STEPS = steps(POWERS.gel.cooldown);
export const SHIELD_STEPS = steps(POWERS.shield.duration);
/** Retard ajouté à la frise temporelle de chaque danger à chaque pas de Gel : (1 − vitesse effective) · dt. */
export const GEL_SHIFT = (1 - POWERS.gel.dangerSpeed) * SIM.dt;

/** État d'un pouvoir pour l'interface. */
export type PowerState = 'ready' | 'active' | 'cooldown' | 'empty' | 'cap' | 'blocked' | 'charging' | 'locked';

export class Powers {
  /** Les pouvoirs n'existent qu'en Survie (jamais en niveaux, défi quotidien ni campagne). */
  readonly enabled: boolean;
  /** Mode « Sans bonus » (choisi au départ) : Boost, Gel et Bouclier sont désactivés, première vie et reprises comprises. */
  readonly bonusAllowed: boolean;
  /** Après une reprise : Boost et Gel gratuits et illimités. */
  free = false;
  /** Charges achetées restantes (première vie). Infinity pour le rejeu du serveur : le service vérifie les stocks à part. */
  readonly stock: PowerStock;
  /** Activations réussies qui ont consommé une charge (première vie) ; le Bouclier est gratuit mais compté ici pour la catégorie. */
  readonly used = { boost: 0, gel: 0, shield: 0 };
  /** Activations réussies, dans l'ordre (toutes vies confondues ; le rejeu du serveur n'utilise que celles de la première vie). */
  readonly log: PowerAct[] = [];
  /** Demandes refusées par les règles (outil de contrôle : un rejeu honnête n'en produit jamais). */
  rejected = 0;

  boostUntil = 0;
  boostReady = 0;
  gelUntil = 0;
  gelReady = 0;
  shieldProgress = 0;
  shieldStored = false;
  shieldUntil = 0;
  private boostLive = false;
  private gelLive = false;
  private shieldLive = false;
  private queue: PowerKind[] = [];

  constructor(
    opts: { enabled: boolean; stock?: PowerStock; bonus?: boolean },
    private readonly emit: (e: PowerEvent) => void,
  ) {
    this.enabled = opts.enabled;
    this.bonusAllowed = opts.bonus !== false;
    this.stock = { boost: opts.stock?.boost ?? 0, gel: opts.stock?.gel ?? 0 };
  }

  /** Demande d'activation (appliquée au début du prochain pas, comme une inversion). */
  request(kind: PowerKind): void {
    if (!this.enabled) return;
    // Sans bonus : toute demande est un refus (le rejeu du serveur rejette un journal qui en contient)
    if (!this.bonusAllowed) this.rejected++;
    else this.queue.push(kind);
  }

  boostActive(step: number): boolean {
    return this.boostLive && step < this.boostUntil;
  }

  gelActive(step: number): boolean {
    return this.gelLive && step < this.gelUntil;
  }

  shieldActive(step: number): boolean {
    return this.shieldLive && step < this.shieldUntil;
  }

  /** Motif de refus d'une activation maintenant (null = possible). Ordre : actif, plafond, stock, exclusivité, recharge. */
  deny(kind: PowerKind, step: number): DenyReason | null {
    if (!this.enabled || !this.bonusAllowed) return 'disabled';
    if (kind === 'shield') {
      if (this.shieldActive(step)) return 'active';
      return this.shieldStored ? null : 'gauge';
    }
    const active = kind === 'boost' ? this.boostActive(step) : this.gelActive(step);
    if (active) return 'active';
    if (!this.free) {
      if (this.used[kind] >= BONUS.maxActivationsPerRun) return 'cap';
      if (this.stock[kind] <= 0) return 'stock';
    }
    if (kind === 'boost' ? this.gelActive(step) : this.boostActive(step)) return 'exclusive';
    if (step < (kind === 'boost' ? this.boostReady : this.gelReady)) return 'cooldown';
    return null;
  }

  /** État affichable d'un pouvoir. */
  state(kind: PowerKind, step: number): PowerState {
    const why = this.deny(kind, step);
    switch (why) {
      case null: return 'ready';
      case 'active': return 'active';
      case 'cap': return 'cap';
      case 'stock': return 'empty';
      case 'exclusive': return 'blocked';
      case 'cooldown': return 'cooldown';
      case 'gauge': return 'charging';
      default: return 'locked';
    }
  }

  /** Secondes de jeu actif restantes : effet en cours (`active`) ou recharge (`cooldown`). */
  remaining(kind: PowerKind, step: number, what: 'active' | 'cooldown'): number {
    const until = kind === 'boost' ? (what === 'active' ? this.boostUntil : this.boostReady) : kind === 'gel' ? (what === 'active' ? this.gelUntil : this.gelReady) : this.shieldUntil;
    return Math.max(0, until - step) * SIM.dt;
  }

  /** Applique, dans l'ordre, les demandes en attente (début de pas). Renvoie les activations réussies. */
  apply(step: number): void {
    const q = this.queue;
    if (q.length === 0) return;
    this.queue = [];
    for (const kind of q) {
      if (this.deny(kind, step) !== null) {
        this.rejected++;
        continue;
      }
      this.activate(kind, step);
    }
  }

  private activate(kind: PowerKind, step: number): void {
    this.log.push({ step, kind });
    let charged = false;
    if (kind === 'boost') {
      this.boostLive = true;
      this.boostUntil = step + BOOST_STEPS;
      this.boostReady = step + BOOST_COOLDOWN_STEPS;
      if (!this.free) {
        this.used.boost++;
        this.stock.boost--;
        charged = true;
      }
    } else if (kind === 'gel') {
      this.gelLive = true;
      this.gelUntil = step + GEL_STEPS;
      this.gelReady = step + GEL_COOLDOWN_STEPS;
      if (!this.free) {
        this.used.gel++;
        this.stock.gel--;
        charged = true;
      }
    } else {
      this.shieldLive = true;
      this.shieldUntil = step + SHIELD_STEPS;
      this.shieldStored = false;
      this.shieldProgress = 0;
      this.used.shield++;
    }
    this.emit({ type: 'power', kind, stage: 'start', charged });
  }

  /** Une balise a été collectée : la jauge du Bouclier avance, sauf si une charge est déjà stockée (aucune réserve cachée). */
  onBeacon(): void {
    if (!this.enabled || !this.bonusAllowed || this.shieldStored) return;
    this.shieldProgress++;
    if (this.shieldProgress >= POWERS.shield.beacons) {
      this.shieldProgress = POWERS.shield.beacons;
      this.shieldStored = true;
      this.emit({ type: 'shield-ready' });
    }
  }

  /** Le Bouclier absorbe un impact : il disparaît. */
  absorb(step: number): void {
    if (!this.shieldLive) return;
    this.shieldLive = false;
    this.shieldUntil = step;
    this.emit({ type: 'power', kind: 'shield', stage: 'end', reason: 'hit' });
  }

  /** Fin de pas : les effets arrivés à terme s'éteignent. `step` = indice du pas suivant. */
  tick(step: number): void {
    if (this.boostLive && step >= this.boostUntil) {
      this.boostLive = false;
      this.emit({ type: 'power', kind: 'boost', stage: 'end', reason: 'expire' });
    }
    if (this.gelLive && step >= this.gelUntil) {
      this.gelLive = false;
      this.emit({ type: 'power', kind: 'gel', stage: 'end', reason: 'expire' });
    }
    if (this.shieldLive && step >= this.shieldUntil) {
      this.shieldLive = false;
      this.emit({ type: 'power', kind: 'shield', stage: 'end', reason: 'expire' });
    }
  }

  /** Reprise : les effets en cours s'éteignent, les recharges continuent ; Boost et Gel deviennent gratuits et illimités. */
  revive(): void {
    this.boostLive = false;
    this.gelLive = false;
    this.shieldLive = false;
    this.queue = [];
    this.free = true;
  }
}
