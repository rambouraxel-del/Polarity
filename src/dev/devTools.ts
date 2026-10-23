import type { QualityTier } from '../config/ambience';
import { PATTERN_IDS, type PatternId } from '../sim/patterns';
import { PHASES } from '../config/phases';
import type { GameSession } from '../game/session';
import type { LeaderboardClient } from '../net/leaderboard';
import { formatTime } from '../ui/format';
import { escapeHtml } from '../ui/format';
import type { SaveData } from '../save/save';
import { hasRecords } from './records';
import { WORLD_LIST, WORLDS, nextBoundary, worldStart } from '../config/worlds';

/** Phrase exigée avant toute remise à zéro (interface et service). */
export const RESET_PHRASE = 'REMETTRE À ZÉRO';

export type ResetScope = 'local' | 'plain' | 'bonus' | 'daily';

/** Portée de chaque remise à zéro, affichée avant confirmation. */
export const RESET_SCOPES: { id: ResetScope; label: string; scope: string; world: boolean }[] = [
  { id: 'local', label: 'Records locaux', world: false, scope: 'Cet appareil seulement : meilleurs temps et scores de Survie (Sans bonus, Avec bonus) et du Défi quotidien. Une copie est enregistrée avant l’effacement. Profil, monnaies, achats, cosmétiques, succès et classements mondiaux ne changent pas.' },
  { id: 'plain', label: 'Classement mondial · Survie Sans bonus', world: true, scope: 'MONDIAL : records « Sans bonus » de la version actuelle, pour tous les joueurs. Une copie de la base est écrite par le service avant l’effacement. Exige l’autorisation administrateur du service. Profils, monnaies, achats, cosmétiques et anciennes versions ne changent pas.' },
  { id: 'bonus', label: 'Classement mondial · Survie Avec bonus', world: true, scope: 'MONDIAL : records « Avec bonus » de la version actuelle, pour tous les joueurs. Même protections que ci-dessus.' },
  { id: 'daily', label: 'Classement mondial · Défi quotidien', world: true, scope: 'MONDIAL : classements des défis quotidiens NON clos (les défis clos, dont les Prismes sont déjà crédités, restent intacts). Même protections que ci-dessus.' },
];

/** Ce que la fenêtre demande à l'application (aucune logique de jeu ici : tout passe par ces points d'entrée). */
export interface DevHost {
  save: SaveData;
  lb: LeaderboardClient;
  session(): GameSession | null;
  /** Lance (ou relance) une partie de Survie de test. */
  restartTest(): void;
  /** Voyage des univers (partie de test) : avec ou sans pouvoirs (charges de test). */
  startWorlds(bonus: boolean): void;
  /** Affichage de contrôle des univers : secteurs de vitesse, hitboxes, trajectoires prévues. */
  worldOverlay(on: boolean): void;
  /** Diagnostic audio et ambiance (lecture seule). */
  diag(): { track: string; pos: number; beat: number; bass: number; intensity: number; drop: number; build: number; nextBeat: number; reacting: boolean; particles: number };
  persist(): void;
  /** Effet décoratif de l'ambiance. */
  trigger(kind: 'bolt' | 'wave' | 'ring' | 'fissure'): void;
  /** Qualité de l'ambiance : null = automatique. */
  setQuality(tier: QualityTier | null): void;
  quality(): { forced: QualityTier | null; current: QualityTier };
  /** Applique l'intensité visuelle (préférence du joueur). */
  setIntensity(v: number): void;
  /** Remise à zéro des records locaux (copie préalable) : renvoie un message. */
  resetLocal(): string;
  /** Une remise à zéro mondiale vient de réussir : rafraîchir les classements affichés. */
  worldResetDone(): void;
  /** Le mode a été désactivé depuis la fenêtre. */
  disable(): void;
}

type Tab = 'game' | 'board' | 'reset';

const PATTERN_LABEL: Partial<Record<PatternId, string>> = {};
const MAX_FPS_SAMPLES = 30;

/**
 * Fenêtre de contrôle du mode développeur : bouton discret « DEV » (visible seulement quand le mode est activé) et panneau d'outils. Toute commande qui agit
 * sur la partie la marque comme partie de TEST pour toujours (`GameSession.markTest`) : jamais classée, aucun gain, aucun succès, même si le mode est
 * désactivé ensuite. Aucun secret : l'autorisation administrateur d'une remise à zéro mondiale est saisie à l'instant, envoyée au service et jamais conservée.
 */
export class DevTools {
  private readonly btn: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private open = false;
  private tab: Tab = 'game';
  private scope: ResetScope = 'local';
  private message = '';
  private resetMessage: { kind: 'ok' | 'error'; text: string } | null = null;
  private pingText = '';
  private busy = false;
  private fps = 60;
  private worst = 0;
  private samples: number[] = [];
  private lastRefresh = 0;
  private overlay = false;
  private worldsBonus = false;

  constructor(
    private readonly host: DevHost,
    root: HTMLElement,
  ) {
    this.btn = document.createElement('button');
    this.btn.id = 'dev-btn';
    this.btn.type = 'button';
    this.btn.className = 'dev-btn hidden';
    this.btn.textContent = 'DEV';
    this.btn.setAttribute('aria-label', 'Contrôles développeur');
    this.btn.addEventListener('click', () => this.toggle());
    this.panel = document.createElement('div');
    this.panel.id = 'dev-panel';
    this.panel.className = 'dev-panel hidden';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Contrôles développeur');
    this.panel.addEventListener('click', (e) => this.onClick(e));
    this.panel.addEventListener('input', (e) => this.onInput(e));
    this.panel.addEventListener('submit', (e) => e.preventDefault());
    root.append(this.btn, this.panel);
    this.sync();
  }

  /** Affiche ou masque le bouton selon l'état du mode (appelé à chaque changement). */
  sync(): void {
    const on = this.host.save.options.dev.enabled;
    this.btn.classList.toggle('hidden', !on);
    if (!on && this.open) this.toggle(false);
  }

  private toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.panel.classList.toggle('hidden', !this.open);
    this.btn.classList.toggle('dev-btn--on', this.open);
    if (this.open) this.render();
  }

  /** Appelé à chaque image : mesure des FPS et rafraîchissement des valeurs affichées (sans toucher aux champs de saisie). */
  frame(realDt: number): void {
    if (realDt > 0 && realDt < 1) {
      this.samples.push(realDt);
      if (this.samples.length > MAX_FPS_SAMPLES) this.samples.shift();
      const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
      this.fps = 1 / avg;
      this.worst = Math.max(...this.samples);
    }
    if (!this.open) return;
    const t = performance.now();
    if (t - this.lastRefresh < 250) return;
    this.lastRefresh = t;
    this.refreshLive();
  }

  // ————————————————————————— rendu

  private s(): GameSession | null {
    return this.host.session();
  }

  private phaseLabel(s: GameSession | null): string {
    if (!s) return '—';
    if (s.worlds) return s.transitLeft > 0 ? `transition ${s.sim.world} → ${s.transitTo}` : `univers ${s.sim.world} · ${WORLD_LIST[s.sim.world - 1]?.name ?? ''}`;
    if (s.transitLeft > 0) return 'traversée';
    return s.config.mode === 'survival' ? `phase ${s.sim.phase}` : s.config.mode;
  }

  private audioLine(): string {
    const d = this.host.diag();
    const s = this.s();
    const speed = s ? `×${s.sim.speedFactorNow.toFixed(2)}` : '—';
    return `${escapeHtml(d.track)} ${d.pos.toFixed(2)} s · prochain battement ${Number.isFinite(d.nextBeat) ? `${d.nextBeat.toFixed(2)} s` : '—'} · ${d.reacting ? 'réaction réelle' : 'aucune réaction (musique absente ou muette)'}<br>
      battement ${d.beat.toFixed(2)} · basses ${d.bass.toFixed(2)} · intensité ${d.intensity.toFixed(2)} · montée ${d.build.toFixed(2)} · passage fort ${d.drop.toFixed(2)}<br>vitesse réelle du vaisseau ${speed} · particules ${d.particles}`;
  }

  private live(): string {
    const s = this.s();
    const q = this.host.quality();
    const t = s ? formatTime(s.sim.time) : '—';
    return `<dl class="dev-kv"><dt>FPS</dt><dd id="dv-fps">${Math.round(this.fps)} <small>(pire image ${Math.round(this.worst * 1000)} ms)</small></dd>
      <dt>Phase</dt><dd id="dv-phase">${this.phaseLabel(s)}${s?.transitLeft ? ` (${s.transitLeft.toFixed(1)} s)` : ''}</dd>
      <dt>Temps actif</dt><dd id="dv-time">${t}</dd>
      <dt>Vitesse</dt><dd id="dv-rate">${s ? `×${s.testRate}${s.testFrozen ? ' · gelé' : ''}` : '—'}</dd>
      <dt>Immortel</dt><dd id="dv-inv">${s ? (s.sim.invincible ? 'oui' : 'non') : '—'}</dd>
      <dt>Qualité</dt><dd id="dv-q">${q.current}${q.forced ? ' (forcée)' : ' (auto)'}</dd>
      <dt>Audio</dt><dd id="dv-audio">${this.audioLine()}</dd></dl>`;
  }

  private refreshLive(): void {
    const s = this.s();
    const set = (id: string, html: string): void => {
      const el = this.panel.querySelector(`#${id}`);
      if (el && el.innerHTML !== html) el.innerHTML = html;
    };
    set('dv-fps', `${Math.round(this.fps)} <small>(pire image ${Math.round(this.worst * 1000)} ms)</small>`);
    set('dv-phase', `${this.phaseLabel(s)}${s?.transitLeft ? ` (${s.transitLeft.toFixed(1)} s)` : ''}`);
    set('dv-time', s ? formatTime(s.sim.time) : '—');
    set('dv-rate', s ? `×${s.testRate}${s.testFrozen ? ' · gelé' : ''}` : '—');
    set('dv-inv', s ? (s.sim.invincible ? 'oui' : 'non') : '—');
    set('dv-audio', this.audioLine());
    if (this.tab === 'board') this.refreshBoard();
  }

  private boardRows(): string {
    const d = this.host.lb.diagnostics();
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    const rows: [string, string][] = [
      ['Service', d.configured ? (d.incompatible ? 'pas à jour pour cette version' : 'configuré') : 'non configuré (classement désactivé)'],
      ['Connexion', `${online ? 'réseau disponible' : 'hors ligne'}${this.pingText ? ` · ${this.pingText}` : ''}`],
      ['Profil', d.profile ?? 'aucun'],
      ['Tickets', `${d.tickets} disponible${d.tickets > 1 ? 's' : ''}`],
      ['En attente', `${d.pending} partie${d.pending > 1 ? 's' : ''} · ${d.pendingDaily} défi${d.pendingDaily > 1 ? 's' : ''} quotidien${d.pendingDaily > 1 ? 's' : ''}`],
      ['Validées / refusées', `${d.accepted} / ${d.rejected}`],
      ['Dernier refus', d.lastRefusal ?? 'aucun'],
      ['Dernière erreur réseau', d.lastNetworkError ?? 'aucune'],
    ];
    return rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  }

  private refreshBoard(): void {
    const el = this.panel.querySelector('#dv-board');
    if (el) el.innerHTML = this.boardRows();
  }

  private gameTab(): string {
    const s = this.s();
    const ok = !!s && s.isTest;
    const dis = ok ? '' : ' disabled';
    const patterns = PATTERN_IDS.map((id) => `<option value="${id}">${PATTERN_LABEL[id] ?? id}</option>`).join('');
    const q = this.host.quality();
    const qBtn = (t: QualityTier | null, label: string): string => `<button type="button" class="dev-chip${(q.forced ?? null) === t ? ' dev-chip--on' : ''}" data-dev="quality" data-q="${t ?? 'auto'}">${label}</button>`;
    const rate = (r: number): string => `<button type="button" class="dev-chip${s && s.testRate === r ? ' dev-chip--on' : ''}" data-dev="rate" data-rate="${r}"${dis}>×${r}</button>`;
    const intensity = Math.round(this.host.save.options.visualIntensity * 100);
    return `${this.live()}
      ${ok ? '' : '<p class="dev-note">Lancez une partie de test pour activer les contrôles de partie.</p>'}
      <h4>Partie</h4>
      <div class="dev-row"><button type="button" class="dev-btn-x" data-dev="invincible"${dis}>Immortalité : ${s?.sim.invincible ? 'activée' : 'désactivée'}</button>
        <button type="button" class="dev-btn-x" data-dev="restart">Relancer une partie de test</button></div>
      <h4>Voyage des univers <small>(refonte en validation · toujours une partie de test)</small></h4>
      <div class="dev-row"><button type="button" class="dev-btn-x" data-dev="worlds">Lancer le voyage</button>
        <button type="button" class="dev-chip${this.worldsBonus ? ' dev-chip--on' : ''}" data-dev="worlds-bonus">Pouvoirs : ${this.worldsBonus ? 'oui' : 'non'}</button>
        <button type="button" class="dev-chip${this.overlay ? ' dev-chip--on' : ''}" data-dev="overlay">Contrôle : ${this.overlay ? 'affiché' : 'masqué'}</button></div>
      <div class="dev-row"><span class="dev-lab">Univers</span>${WORLD_LIST.map((w) => `<button type="button" class="dev-btn-x" data-dev="world" data-w="${w.index}" title="${escapeHtml(w.name)}">${w.index}</button>`).join('')}
        <button type="button" class="dev-btn-x" data-dev="before-transit"${s?.worlds ? '' : ' disabled'}>Avant la transition</button>
        <button type="button" class="dev-btn-x" data-dev="transit-now"${s?.worlds ? '' : ' disabled'}>Transition maintenant</button></div>
      <h4>Temps</h4>
      <div class="dev-row"><button type="button" class="dev-btn-x" data-dev="freeze"${dis}>${s?.testFrozen ? 'Reprendre' : 'Pause'}</button>
        <button type="button" class="dev-btn-x" data-dev="advance" data-s="0.1"${dis}>+0,1 s</button><button type="button" class="dev-btn-x" data-dev="advance" data-s="1"${dis}>+1 s</button>
        <button type="button" class="dev-btn-x" data-dev="advance" data-s="10"${dis}>+10 s</button><button type="button" class="dev-btn-x" data-dev="advance" data-s="30"${dis}>+30 s</button></div>
      <div class="dev-row"><span class="dev-lab">Vitesse</span>${[0.25, 0.5, 1, 2, 4].map(rate).join('')}</div>
      <div class="dev-row"><span class="dev-lab">Aller à</span><button type="button" class="dev-btn-x" data-dev="goto" data-to="stage"${dis}>4:30</button>
        <button type="button" class="dev-btn-x" data-dev="goto" data-to="transit"${dis}>Traversée</button><button type="button" class="dev-btn-x" data-dev="goto" data-to="phase2"${dis}>Phase 2</button></div>
      <h4>Obstacles et effets</h4>
      <div class="dev-row"><select id="dv-pattern" class="dev-select" aria-label="Obstacle"${dis}>${patterns}</select><button type="button" class="dev-btn-x" data-dev="pattern"${dis}>Déclencher</button></div>
      <div class="dev-row"><button type="button" class="dev-btn-x" data-dev="fx" data-fx="bolt"${dis}>Éclair</button><button type="button" class="dev-btn-x" data-dev="fx" data-fx="wave"${dis}>Vague d’énergie</button>
        <button type="button" class="dev-btn-x" data-dev="fx" data-fx="ring"${dis}>Anneau</button><button type="button" class="dev-btn-x" data-dev="fx" data-fx="fissure"${dis}>Filaments</button></div>
      <h4>Affichage</h4>
      <div class="dev-row"><label class="dev-lab" for="dv-int">Intensité visuelle <b id="dv-int-v">${intensity} %</b></label><input id="dv-int" class="dev-range" type="range" min="0" max="100" step="5" value="${intensity}" data-dev="intensity" /></div>
      <div class="dev-row"><span class="dev-lab">Qualité</span>${qBtn(null, 'Auto')}${qBtn('high', 'Haute')}${qBtn('medium', 'Moyenne')}${qBtn('low', 'Basse')}</div>
      ${this.message ? `<p class="dev-note" role="status">${escapeHtml(this.message)}</p>` : ''}`;
  }

  private boardTab(): string {
    return `<dl class="dev-kv" id="dv-board">${this.boardRows()}</dl>
      <div class="dev-row"><button type="button" class="dev-btn-x" data-dev="ping"${this.busy ? ' disabled' : ''}>Tester la connexion</button>
        <button type="button" class="dev-btn-x" data-dev="flush">Renvoyer les résultats en attente</button></div>
      <p class="dev-note">Les parties de test ne sont jamais envoyées : elles n’apparaissent ni dans les tickets consommés ni dans les résultats en attente.</p>`;
  }

  private resetTab(): string {
    const cur = RESET_SCOPES.find((x) => x.id === this.scope)!;
    const radios = RESET_SCOPES.map((x) => `<label class="dev-radio"><input type="radio" name="dv-scope" value="${x.id}" data-dev="scope"${x.id === this.scope ? ' checked' : ''} /> ${x.label}</label>`).join('');
    const msg = this.resetMessage ? `<p class="dev-note dev-note--${this.resetMessage.kind}" role="${this.resetMessage.kind === 'error' ? 'alert' : 'status'}">${escapeHtml(this.resetMessage.text)}</p>` : '';
    return `<form class="dev-form" autocomplete="off" novalidate>
      <div class="dev-radios" role="radiogroup" aria-label="Portée">${radios}</div>
      <p class="dev-scope${cur.world ? ' dev-scope--world' : ''}"><b>Portée :</b> ${escapeHtml(cur.scope)}</p>
      ${cur.world ? '<input id="dv-admin" class="dev-input" type="password" name="admin" maxlength="200" placeholder="Autorisation administrateur du service (jamais enregistrée)" autocomplete="off" spellcheck="false" aria-label="Autorisation administrateur" /><p class="dev-note">Le mot de passe développeur ne suffit pas : le service vérifie une autorisation dédiée.</p>' : ''}
      <input id="dv-phrase" class="dev-input" type="text" name="phrase" maxlength="40" placeholder="Tapez : ${RESET_PHRASE}" autocomplete="off" spellcheck="false" autocapitalize="characters" aria-label="Confirmation" />
      <button type="button" id="dv-reset" class="dev-btn-x dev-btn-x--danger" data-dev="reset" disabled>Remettre à zéro</button>
    </form>${msg}`;
  }

  private render(): void {
    const tabs: [Tab, string][] = [['game', 'Partie'], ['board', 'Classement'], ['reset', 'Remise à zéro']];
    const body = this.tab === 'game' ? this.gameTab() : this.tab === 'board' ? this.boardTab() : this.resetTab();
    this.panel.innerHTML = `<div class="dev-head"><strong>Développeur</strong><span class="dev-tag">TEST</span>
        <button type="button" class="dev-close" data-dev="close" aria-label="Fermer">×</button></div>
      <div class="dev-tabs" role="tablist">${tabs.map(([id, l]) => `<button type="button" role="tab" class="dev-tab${id === this.tab ? ' dev-tab--on' : ''}" data-dev="tab" data-tab="${id}" aria-selected="${id === this.tab}">${l}</button>`).join('')}</div>
      <div class="dev-body">${body}</div>
      <div class="dev-foot"><button type="button" class="dev-btn-x" data-dev="disable">Désactiver le mode développeur</button></div>`;
  }

  // ————————————————————————— commandes

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (el.dataset.dev === 'intensity') {
      const v = Number(el.value) / 100;
      this.host.setIntensity(v);
      const out = this.panel.querySelector('#dv-int-v');
      if (out) out.textContent = `${Math.round(v * 100)} %`;
      return;
    }
    if (el.id === 'dv-phrase') {
      const btn = this.panel.querySelector<HTMLButtonElement>('#dv-reset');
      if (btn) btn.disabled = el.value.trim() !== RESET_PHRASE || this.busy;
    }
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-dev]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const s = this.s();
    switch (el.dataset.dev) {
      case 'close': this.toggle(false); return;
      case 'tab': this.tab = (el.dataset.tab as Tab) ?? 'game'; this.render(); return;
      case 'disable': this.host.disable(); return;
      case 'scope': this.scope = el.getAttribute('value') as ResetScope; this.resetMessage = null; this.render(); return;
      case 'restart': this.message = ''; this.host.restartTest(); this.render(); return;
      case 'worlds': this.message = 'Voyage des univers lancé (partie de test : aucun record, gain ni envoi).'; this.host.startWorlds(this.worldsBonus); this.render(); return;
      case 'worlds-bonus': this.worldsBonus = !this.worldsBonus; this.render(); return;
      case 'overlay': this.overlay = !this.overlay; this.host.worldOverlay(this.overlay); this.render(); return;
      case 'world': this.gotoWorld(Number(el.dataset.w)); break;
      case 'before-transit': if (s?.worlds) this.skipWorld(s, nextBoundary(s.sim.time) - 2.5); break;
      case 'transit-now': if (s?.worlds) this.skipWorld(s, nextBoundary(s.sim.time)); break;
      case 'invincible': if (s) s.setTestInvincible(!s.sim.invincible); break;
      case 'freeze': if (s) s.setTestFrozen(!s.testFrozen); break;
      case 'rate': if (s) s.setTestRate(Number(el.dataset.rate)); break;
      case 'advance': if (s) s.skipTo(s.sim.time + Number(el.dataset.s)); break;
      case 'goto': this.goto(el.dataset.to as 'stage' | 'transit' | 'phase2'); break;
      case 'pattern': {
        if (!s) break;
        s.markTest();
        const id = (this.panel.querySelector<HTMLSelectElement>('#dv-pattern')?.value ?? 'shot') as PatternId;
        s.sim.injectPattern(id);
        this.message = `Obstacle déclenché : ${id}.`;
        break;
      }
      case 'fx': if (s) s.markTest(); this.host.trigger(el.dataset.fx as 'bolt' | 'wave' | 'ring' | 'fissure'); break;
      case 'quality': this.host.setQuality(el.dataset.q === 'auto' ? null : (el.dataset.q as QualityTier)); break;
      case 'ping': void this.ping(); return;
      case 'flush': void this.host.lb.flush().then(() => this.refreshBoard()); return;
      case 'reset': void this.doReset(); return;
      default: return;
    }
    this.render();
  }

  /** Univers : saut au début de l'univers `w` (nouvelle partie si besoin) ; les transitions intermédiaires sont traversées sans rendu. */
  private gotoWorld(w: number): void {
    let s = this.s();
    if (!s || !s.worlds || s.sim.time > worldStart(w - 1)) {
      this.host.startWorlds(this.worldsBonus);
      s = this.s();
    }
    if (!s) return;
    if (w > 1) this.skipWorld(s, worldStart(w - 1) + 0.05);
    this.message = `Univers ${w} — ${WORLD_LIST[w - 1]?.name ?? ''} (partie de test).`;
  }

  private skipWorld(s: GameSession, target: number): void {
    if (!Number.isFinite(target) || target <= s.sim.time) {
      this.message = 'Aucune transition à venir : le dernier univers se prolonge.';
      return;
    }
    s.markTest();
    s.skipTo(target);
    this.message = `Saut à ${formatTime(s.sim.time)} (transition de ${WORLDS.transition} s traversée sans rendu ni son).`;
  }

  /** Saut dans le temps : repart d'une nouvelle partie de test quand la cible est dans le passé. */
  private goto(to: 'stage' | 'transit' | 'phase2'): void {
    let s = this.s();
    if (!s) return;
    const target = to === 'stage' ? PHASES.coreGrowFrom : to === 'transit' ? PHASES.phase2At - 0.3 : PHASES.phase2At;
    if (s.sim.time > target || s.sim.phase === 2) {
      this.host.restartTest();
      s = this.s();
      if (!s) return;
    }
    s.markTest();
    s.skipTo(target, to === 'phase2');
    this.message = `Saut : ${to === 'stage' ? '4:30' : to === 'transit' ? 'juste avant la traversée' : 'phase 2'} (la musique n’est pas recalée). Partie de test.`;
  }

  private async ping(): Promise<void> {
    this.busy = true;
    this.pingText = 'test en cours…';
    this.refreshBoard();
    const t0 = performance.now();
    const r = await this.host.lb.ping();
    this.busy = false;
    this.pingText = r.ok ? `service joignable (${Math.round(performance.now() - t0)} ms, version ${r.data.balance}, API ${r.data.api ?? '?'})` : `échec : ${r.message}`;
    this.render();
  }

  private async doReset(): Promise<void> {
    const phrase = this.panel.querySelector<HTMLInputElement>('#dv-phrase')?.value.trim() ?? '';
    const adminEl = this.panel.querySelector<HTMLInputElement>('#dv-admin');
    const admin = adminEl?.value ?? '';
    if (phrase !== RESET_PHRASE) return;
    const cur = RESET_SCOPES.find((x) => x.id === this.scope)!;
    this.busy = true;
    try {
      if (cur.id === 'local') {
        this.resetMessage = { kind: 'ok', text: this.host.resetLocal() };
      } else {
        if (admin.trim().length < 8) {
          this.resetMessage = { kind: 'error', text: 'Autorisation administrateur manquante : rien n’a été effacé.' };
        } else {
          const r = await this.host.lb.adminResetBoard(cur.id, admin.trim(), RESET_PHRASE);
          if (r.ok) {
            this.resetMessage = { kind: 'ok', text: `Classement remis à zéro : ${r.data.removed} ligne(s) effacée(s). Sauvegarde préalable du service : ${r.data.backup}.` };
            this.host.worldResetDone();
          } else if (r.status === 403) this.resetMessage = { kind: 'error', text: 'Autorisation administrateur refusée par le service : rien n’a été effacé.' };
          else if (r.status === 404 || r.kind === 'incompatible') this.resetMessage = { kind: 'error', text: 'Le service n’a pas cette fonction (pas à jour, ou autorisation administrateur non configurée) : rien n’a été effacé.' };
          else this.resetMessage = { kind: 'error', text: `${r.message} Rien n’a été effacé.` };
        }
      }
    } finally {
      this.busy = false;
      // L'autorisation saisie n'est jamais conservée
      if (adminEl) adminEl.value = '';
    }
    this.render();
  }

  /** Vrai si au moins un record local existe (affichage). */
  hasLocalRecords(): boolean {
    return hasRecords(this.host.save);
  }
}
