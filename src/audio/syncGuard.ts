import { WORLD_MUSIC_SYNC } from '../config/worldMusic';

/**
 * Garde de synchronisation jeu/musique (voyage des univers, univers 2). L'horloge de jeu avance de l'image réelle (plafonnée à `SIM.maxFrameTime`) ; la musique
 * avance sur l'horloge audio. Tant que l'appareil tient ~15 images/s ou plus, les deux restent alignés. Sur un appareil très lent, le jeu prend du retard
 * sur la musique : au-delà de `tolerance` pendant `hold` secondes d'affilée, la musique est recalée sur le temps de jeu (jamais l'inverse : le jeu ne lit
 * pas l'audio), au plus une fois toutes les `cooldown` secondes pour ne jamais hacher le morceau. Logique pure, sans audio ni horloge.
 */
export class MusicSyncGuard {
  private held = 0;
  private since = Infinity;

  /**
   * @param driftSeconds temps de jeu local − temps local entendu (s) ; NaN = pas de mesure (pause, transition, musique absente)
   * @param dt durée réelle de l'image (s)
   * @returns vrai quand la musique doit être recalée maintenant
   */
  update(driftSeconds: number, dt: number): boolean {
    this.since += dt;
    if (!Number.isFinite(driftSeconds) || Math.abs(driftSeconds) <= WORLD_MUSIC_SYNC.tolerance) {
      this.held = 0;
      return false;
    }
    this.held += dt;
    if (this.held < WORLD_MUSIC_SYNC.hold || this.since < WORLD_MUSIC_SYNC.cooldown) return false;
    this.held = 0;
    this.since = 0;
    return true;
  }

  /** Nouvelle partie ou saut de test : on repart de zéro. */
  reset(): void {
    this.held = 0;
    this.since = Infinity;
  }
}
