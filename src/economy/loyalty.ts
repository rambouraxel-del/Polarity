import { BONUS } from '../config/economy';
import type { LoyaltyClaimResponse } from '../net/rewardsProtocol';
import type { SaveData } from '../save/save';

/**
 * Applique à la sauvegarde locale une récompense de connexion CONFIRMÉE par le service (réponse de `POST /api/loyalty/claim`).
 * Le service a déjà écrit la ligne du registre : le portefeuille local ne fait que refléter ce crédit (provisoire jusqu'à la prochaine synchronisation,
 * qui réaligne tout sur le registre). Aucun crédit si la réponse dit « déjà récupérée » (requête rejouée). Les Prismes viennent du solde du service.
 */
export function applyLoyaltyClaim(save: SaveData, res: LoyaltyClaimResponse): void {
  save.loyalty.snapshot = res.state;
  if (!res.credited) return;
  const { kind, amount } = res.reward;
  if (kind === 'shards') {
    save.wallet.shards += amount;
    if (save.economy.confirmed) save.economy.confirmed.shards = res.balance.shards;
  } else if (kind === 'prisms') {
    save.wallet.prisms = res.balance.prisms;
    if (save.economy.confirmed) save.economy.confirmed.prisms = res.balance.prisms;
  } else {
    save.inventory[kind] = Math.min(BONUS.maxStock, save.inventory[kind] + amount);
  }
}
