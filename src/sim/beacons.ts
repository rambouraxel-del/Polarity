import { BEACONS } from '../config/balance';
import { arcCrosses, TAU, wrapAngle } from '../core/math';

/** Six balises régulièrement espacées. Chacune n'est collectable qu'une fois par cycle. */
export class BeaconRing {
  readonly angles: number[] = [];
  readonly active: boolean[] = [];
  remaining: number = BEACONS.count;

  constructor() {
    for (let i = 0; i < BEACONS.count; i++) {
      this.angles.push(wrapAngle(BEACONS.offset + (i * TAU) / BEACONS.count));
      this.active.push(true);
    }
  }

  /**
   * Teste les balises traversées par le mouvement [from, from + delta].
   * Appelle `onCollect(index)` pour chacune, et `onCycle()` quand la dernière est prise.
   */
  sweep(from: number, delta: number, onCollect: (i: number) => void, onCycle: () => void): void {
    for (let i = 0; i < this.angles.length; i++) {
      if (!this.active[i]) continue;
      if (!arcCrosses(from, delta, this.angles[i])) continue;
      this.active[i] = false;
      this.remaining--;
      onCollect(i);
      if (this.remaining === 0) {
        this.reset();
        onCycle();
        // Les balises réactivées ne sont pas collectées dans ce même pas.
        return;
      }
    }
  }

  reset(): void {
    for (let i = 0; i < this.active.length; i++) this.active[i] = true;
    this.remaining = this.active.length;
  }
}
