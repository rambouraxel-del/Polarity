import { LEVEL_DURATION, SCORE } from '../config/balance';
import type { GameSession } from '../game/session';
import shardUrl from '../assets/ui/eclat.png';
import { formatScore, formatTime } from './format';

/** HUD DOM : on ne touche au DOM que lorsque la valeur affichée change. */
export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly score = document.getElementById('hud-score')!;
  private readonly mult = document.getElementById('hud-mult')!;
  private readonly combo = document.getElementById('hud-combo')!;
  private readonly time = document.getElementById('hud-time')!;
  private readonly sub = document.getElementById('hud-sub')!;
  private readonly shards = document.getElementById('hud-shards')!;
  private readonly shardsN = document.getElementById('hud-shards-n')!;
  private cache: Record<string, string> = {};
  private recordShown = false;

  constructor() {
    const img = this.shards.querySelector('img');
    if (img) img.src = shardUrl;
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  reset(): void {
    this.cache = {};
    this.recordShown = false;
    this.time.classList.remove('record');
    this.sub.classList.remove('record');
  }

  private set(el: HTMLElement, key: string, value: string): void {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }

  /** Campagne : temps restant jusqu'à la fin de la mission, avancement de l'objectif et état du bouclier. */
  updateCampaign(session: GameSession): void {
    const camp = session.campaign;
    if (!camp) return;
    const sim = session.sim;
    this.set(this.score, 'score', formatScore(sim.scoring.score));
    this.set(this.mult, 'mult', `×${sim.scoring.multiplier}`);
    const pct = sim.scoring.multiplier >= SCORE.maxMultiplier ? 100 : (sim.scoring.progress / SCORE.collectsPerLevel) * 100;
    const w = `${Math.round(pct)}%`;
    if (this.cache.combo !== w) {
      this.cache.combo = w;
      this.combo.style.width = w;
    }
    if (this.cache.shardsShown !== '') {
      this.cache.shardsShown = '';
      this.shards.classList.add('hidden');
    }
    this.set(this.time, 'time', formatTime(camp.remaining(), 0));
    const shield = camp.invulnerable ? ' · Bouclier actif' : camp.shieldCharges > 0 ? ' · Bouclier prêt' : camp.upgrades.shield ? ' · Bouclier utilisé' : '';
    this.set(this.sub, 'sub', camp.progressText() + shield);
  }

  /**
   * @param record meilleur temps précédent (Survie/Défi) ; null en mode Niveaux.
   * @returns vrai au moment précis où le record vient d'être dépassé.
   */
  update(session: GameSession, label: string, record: number | null, showRecord = true): boolean {
    const sim = session.sim;
    const t = sim.time;
    this.set(this.score, 'score', formatScore(sim.scoring.score));
    this.set(this.mult, 'mult', `×${sim.scoring.multiplier}`);
    const pct = sim.scoring.multiplier >= SCORE.maxMultiplier ? 100 : (sim.scoring.progress / SCORE.collectsPerLevel) * 100;
    const w = `${Math.round(pct)}%`;
    if (this.cache.combo !== w) {
      this.cache.combo = w;
      this.combo.style.width = w;
    }
    // Éclats gagnés pendant cette partie (Survie) : déjà crédités à chaque collecte
    const income = sim.shards?.income ?? -1;
    const shown = income >= 0 ? '1' : '';
    if (this.cache.shardsShown !== shown) {
      this.cache.shardsShown = shown;
      this.shards.classList.toggle('hidden', income < 0);
    }
    if (income >= 0) this.set(this.shardsN, 'shards', String(income));
    let crossed = false;
    if (record === null) {
      // Niveaux : temps restant
      this.set(this.time, 'time', formatTime(Math.max(0, LEVEL_DURATION - t), 0));
      this.set(this.sub, 'sub', label);
    } else {
      this.set(this.time, 'time', formatTime(t));
      if (record > 0 && t > record) {
        if (!this.recordShown) {
          this.recordShown = true;
          crossed = true;
          this.time.classList.add('record');
          this.sub.classList.add('record');
        }
        this.set(this.sub, 'sub', 'Nouveau record !');
      } else {
        this.set(this.sub, 'sub', record > 0 && showRecord ? `${label} · record ${formatTime(record)}` : label);
      }
    }
    return crossed;
  }
}
