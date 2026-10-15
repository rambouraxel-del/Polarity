import { BONUS } from '../config/economy';
import { POWERS, POWER_KINDS, type PowerKind } from '../config/powers';
import type { GameSession } from '../game/session';
import type { PowerState } from '../sim/powers';
import { ICONS } from './icons';

/**
 * Commandes des pouvoirs (Boost, Gel, Bouclier) : trois boutons HORS de l'aire de jeu (jamais d'inversion en les touchant), à portée du pouce en
 * portrait. Purement affichage + demande d'activation : les règles (recharge, exclusivité, stock, jauge) sont celles de la simulation
 * (sim/powers.ts), lues telles quelles. Raccourcis clavier : B (Boost), G (Gel), S (Bouclier) ; Espace, Échap et P ne sont pas touchés.
 */
export const POWER_KEYS: Record<string, PowerKind> = { b: 'boost', g: 'gel', s: 'shield' };

const LABEL: Record<PowerKind, { name: string; icon: keyof typeof ICONS; key: string }> = {
  boost: { name: 'Boost', icon: 'bolt', key: 'B' },
  gel: { name: 'Gel', icon: 'snow', key: 'G' },
  shield: { name: 'Bouclier', icon: 'shield', key: 'S' },
};

const fmt = (s: number): string => `${s.toFixed(1).replace('.', ',')} s`;

/** État affichable : libellé court, durée éventuelle, remplissage de la jauge (0–1). */
export interface PowerView {
  state: PowerState;
  /** Texte court sous le nom. */
  meta: string;
  /** Libellé lu par les lecteurs d'écran. */
  aria: string;
  fill: number;
  /** Activable maintenant. */
  ready: boolean;
}

/** Vue d'un pouvoir à un instant donné de la partie (fonction pure : testée sans navigateur). */
export function powerView(session: GameSession, kind: PowerKind): PowerView {
  const sim = session.sim;
  const pw = sim.powers;
  const step = sim.stepIndex;
  const state = pw.state(kind, step);
  const name = LABEL[kind].name;
  if (kind === 'shield') {
    const need = POWERS.shield.beacons;
    switch (state) {
      case 'active': {
        const left = pw.remaining('shield', step, 'active');
        return { state, meta: fmt(left), aria: `${name} actif, ${left.toFixed(1)} secondes`, fill: left / POWERS.shield.duration, ready: false };
      }
      case 'ready': return { state, meta: 'Prêt', aria: `${name} prêt`, fill: 1, ready: true };
      default: return { state: 'charging', meta: `${pw.shieldProgress}/${need}`, aria: `${name} : jauge ${pw.shieldProgress} sur ${need} balises`, fill: pw.shieldProgress / need, ready: false };
    }
  }
  const free = pw.free;
  const def = POWERS[kind];
  const left = free ? Infinity : Math.max(0, Math.min(BONUS.maxActivationsPerRun - pw.used[kind], pw.stock[kind]));
  const uses = free ? 'gratuit' : `reste ${left}`;
  switch (state) {
    case 'active': {
      const r = pw.remaining(kind, step, 'active');
      return { state, meta: fmt(r), aria: `${name} actif, ${r.toFixed(1)} secondes`, fill: r / def.duration, ready: false };
    }
    case 'ready': return { state, meta: uses, aria: `${name} disponible, ${free ? 'gratuit' : `${left} utilisation${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}`}`, fill: 1, ready: true };
    case 'cooldown': {
      const r = pw.remaining(kind, step, 'cooldown');
      return { state, meta: `Recharge ${Math.ceil(r)} s`, aria: `${name} en recharge, ${r.toFixed(0)} secondes`, fill: 1 - r / def.cooldown, ready: false };
    }
    case 'empty': return { state, meta: 'Stock vide', aria: `${name} : stock vide`, fill: 0, ready: false };
    case 'cap': return { state, meta: 'Plafond atteint', aria: `${name} : plafond de ${BONUS.maxActivationsPerRun} utilisations atteint`, fill: 0, ready: false };
    case 'blocked': return { state, meta: 'Indisponible', aria: `${name} indisponible : un autre pouvoir est actif`, fill: 0, ready: false };
    default: return { state: 'locked', meta: '—', aria: `${name} indisponible`, fill: 0, ready: false };
  }
}

/** Barre de commandes (DOM). N'écrit dans le DOM que lorsque la valeur affichée change. */
export class PowersBar {
  private readonly root = document.getElementById('powers')!;
  private readonly buttons = new Map<PowerKind, HTMLButtonElement>();
  private cache = new Map<string, string>();

  constructor(private readonly press: (kind: PowerKind) => void) {
    for (const kind of POWER_KINDS) {
      const b = this.root.querySelector<HTMLButtonElement>(`[data-power="${kind}"]`)!;
      b.innerHTML = `<span class="pw__icon">${ICONS[LABEL[kind].icon]}</span><span class="pw__name">${LABEL[kind].name}</span><span class="pw__meta"></span><kbd class="pw__key" aria-hidden="true">${LABEL[kind].key}</kbd><i class="pw__fill" aria-hidden="true"></i>`;
      b.setAttribute('aria-keyshortcuts', LABEL[kind].key);
      // Jamais de prise de focus ni d'inversion : le toucher active le pouvoir seulement (Espace reste réservé à l'inversion)
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.press(kind);
      });
      b.addEventListener('click', (e) => e.preventDefault());
      b.addEventListener('keydown', (e) => e.preventDefault());
      this.buttons.set(kind, b);
    }
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    document.getElementById('app')?.classList.toggle('has-powers', visible);
    if (!visible) this.cache.clear();
  }

  update(session: GameSession): void {
    for (const kind of POWER_KINDS) {
      const v = powerView(session, kind);
      const b = this.buttons.get(kind)!;
      const key = `${kind}|${v.state}|${v.meta}|${Math.round(v.fill * 50)}`;
      if (this.cache.get(kind) === key) continue;
      this.cache.set(kind, key);
      b.dataset.state = v.state;
      b.setAttribute('aria-disabled', v.ready ? 'false' : 'true');
      b.setAttribute('aria-label', v.aria);
      (b.querySelector('.pw__meta') as HTMLElement).textContent = v.meta;
      (b.querySelector('.pw__fill') as HTMLElement).style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, v.fill)) * 100)}%`);
    }
  }
}
