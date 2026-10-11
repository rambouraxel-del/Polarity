/**
 * Interface technique facultative pour un futur fournisseur de publicités récompensées.
 *
 * - Désactivée par défaut : aucun SDK n'est chargé, aucune requête réseau.
 * - Le jeu complet fonctionne sans fournisseur.
 * - Usage prévu : récompenses cosmétiques choisies par le joueur uniquement.
 *   Jamais de « continue » dans une partie comptant pour un record, jamais de publicité imposée
 *   après chaque partie courte. Voir docs/MONETISATION.md.
 */
export type RewardedResult = 'rewarded' | 'dismissed' | 'unavailable';

export interface RewardedAdProvider {
  readonly name: string;
  isAvailable(): boolean;
  showRewarded(placement: string): Promise<RewardedResult>;
}

/** Fournisseur par défaut : ne fait rien. */
export class NoAdProvider implements RewardedAdProvider {
  readonly name = 'aucun';
  isAvailable(): boolean {
    return false;
  }
  async showRewarded(): Promise<RewardedResult> {
    return 'unavailable';
  }
}

let provider: RewardedAdProvider = new NoAdProvider();

export function getAdProvider(): RewardedAdProvider {
  return provider;
}

/** Point d'extension : un intégrateur pourra enregistrer ici un vrai fournisseur. */
export function setAdProvider(p: RewardedAdProvider): void {
  provider = p;
}
