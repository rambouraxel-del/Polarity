import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_CONFIG, totalMedals } from '../src/config/achievements';
import { CATALOG, medalCost } from '../src/config/catalog';
import { BONUS, BONUS_LIST } from '../src/config/economy';
import { PRISM_PACKS } from '../src/config/monetization';
import { POWERS, REVIVE } from '../src/config/powers';
import { DAILY_RANKING, DROPS, LOYALTY, dailyPrizeForRank, loyaltyTotals } from '../src/config/rewards';
import { BALANCE_VERSION } from '../src/config/version';

/** Contrôle de non-régression des chiffres VALIDÉS par le propriétaire (phase 6) : un changement ici est un changement de règle métier. */
describe('Chiffres validés de la mise à jour économique', () => {
  it('Éclats : Boost 50, Gel 100 ; stock et activations', () => {
    expect(BONUS_LIST.map((b) => [b.id, b.price])).toEqual([['boost', 50], ['gel', 100]]);
    expect(BONUS.maxActivationsPerRun).toBe(3);
  });

  it('27 succès = 1 650 Médailles ; cosmétiques non premium = 1 640 Médailles', () => {
    expect(ACHIEVEMENT_CONFIG).toHaveLength(27);
    expect(totalMedals()).toBe(1650);
    expect(medalCost('ship') + medalCost('trail')).toBe(1640);
  });

  it('Premium : vaisseau 150, traînée 75, pack 200 Prismes ; packs de Prismes 30/100/380 pour 0,99/2,99/9,99 €', () => {
    const price = (id: string): unknown => CATALOG.find((i) => i.id === id)?.acquire;
    expect(price('neon')).toEqual({ type: 'price', currency: 'prisms', amount: 150 });
    expect(price('nebuleuse')).toEqual({ type: 'price', currency: 'prisms', amount: 75 });
    expect(price('pack-neon')).toEqual({ type: 'price', currency: 'prisms', amount: 200 });
    expect(PRISM_PACKS.map((p) => [p.prisms, p.priceCents])).toEqual([[30, 99], [100, 299], [380, 999]]);
  });

  it('Pouvoirs : Boost +50 % / 5 s / 10 s ; Gel 40 % / 6 s / 20 s ; Bouclier 18 balises / 8 s', () => {
    expect(POWERS.boost).toEqual({ multiplier: 1.5, duration: 5, cooldown: 10 });
    expect(POWERS.gel).toEqual({ dangerSpeed: 0.4, duration: 6, cooldown: 20 });
    expect(POWERS.shield).toEqual({ beacons: 18, duration: 8 });
  });

  it('Reprises : 3 vies, 5 puis 10 Prismes, publicité pour la 2ᵉ seulement, 3 s d’invulnérabilité', () => {
    expect(REVIVE.maxLives).toBe(3);
    expect(REVIVE.prisms).toEqual({ 2: 5, 3: 10 });
    expect(REVIVE.adLives).toEqual([2]);
    expect(REVIVE.invulnerability).toBe(3);
  });

  it('Calendrier : 10 jours = 200 Éclats, 2 Boosts, 2 Gels, 5 Prismes ; une absence tolérée', () => {
    expect(LOYALTY.days).toHaveLength(10);
    expect(loyaltyTotals()).toEqual({ shards: 200, boost: 2, gel: 2, prisms: 5 });
    expect(LOYALTY.absencesAllowed).toBe(1);
  });

  it('Défi quotidien : podium 5/2/1, rien au 4ᵉ rang ; grâce 15 min ; drop 0,02 % par balise, 1 Prisme maximum', () => {
    expect(Array.from({ length: 5 }, (_, i) => dailyPrizeForRank(i + 1))).toEqual([5, 2, 1, 0, 0]);
    expect(DAILY_RANKING.graceMinutes).toBe(15);
    expect(DROPS.prism).toEqual({ chancePerBeacon: 0.0002, maxPerRun: 1, amount: 1 });
  });

  it('version d’équilibrage inchangée par les phases 1 à 6 (records existants conservés)', () => {
    expect(BALANCE_VERSION).toBe(3);
  });
});
