import { SCORE } from '../config/balance';

/**
 * Score et combo. Le changement de direction n'a aucun effet ici : seul le rythme des collectes compte.
 */
export class Scoring {
  score = 0;
  multiplier = 1;
  /** Collectes rapprochées accumulées vers le palier suivant. */
  progress = 0;
  /** Temps écoulé depuis la dernière collecte (ou depuis la dernière perte de palier). */
  sinceCollect = Infinity;
  beacons = 0;
  cycles = 0;
  bestMultiplier = 1;

  /** Renvoie les points gagnés pour une balise. */
  collect(): number {
    if (this.sinceCollect <= SCORE.comboWindow) {
      this.progress++;
      if (this.progress >= SCORE.collectsPerLevel) {
        this.progress = 0;
        if (this.multiplier < SCORE.maxMultiplier) this.multiplier++;
        if (this.multiplier > this.bestMultiplier) this.bestMultiplier = this.multiplier;
      }
    } else {
      this.progress = 0;
    }
    this.sinceCollect = 0;
    this.beacons++;
    const pts = SCORE.beaconPoints * this.multiplier;
    this.score += pts;
    return pts;
  }

  /** Renvoie le bonus de cycle. */
  cycle(): number {
    this.cycles++;
    const pts = SCORE.cycleBonus * this.multiplier;
    this.score += pts;
    return pts;
  }

  /** Avance le temps ; renvoie vrai si le multiplicateur a baissé. */
  update(dt: number): boolean {
    this.sinceCollect += dt;
    if (this.sinceCollect > SCORE.comboWindow && (this.multiplier > 1 || this.progress > 0)) {
      this.progress = 0;
      if (this.multiplier > 1) {
        this.multiplier--;
        // Prochaine perte de palier après comboDecayStep secondes supplémentaires
        this.sinceCollect = SCORE.comboWindow - SCORE.comboDecayStep;
        return true;
      }
    }
    return false;
  }
}
