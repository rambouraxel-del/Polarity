/**
 * Récompenses gratuites (phase 4) : calendrier de connexion, prix du classement quotidien, drop rare de Prismes, sources de Prismes futures.
 * Source unique, partagée par le jeu (affichage) et le service (distribution). Tout est distribué PAR LE SERVICE, dans le registre transactionnel.
 */

export type RewardKind = 'shards' | 'boost' | 'gel' | 'prisms';
export interface LoyaltyReward {
  kind: RewardKind;
  amount: number;
}

/** Cycle de 10 jours de connexion : 200 Éclats, 2 Boosts, 2 Gels, 5 Prismes. */
export const LOYALTY = {
  /** Récompense du jour 1 à 10. */
  days: [
    { kind: 'shards', amount: 20 },
    { kind: 'boost', amount: 1 },
    { kind: 'shards', amount: 30 },
    { kind: 'gel', amount: 1 },
    { kind: 'shards', amount: 40 },
    { kind: 'boost', amount: 1 },
    { kind: 'shards', amount: 50 },
    { kind: 'gel', amount: 1 },
    { kind: 'shards', amount: 60 },
    { kind: 'prisms', amount: 5 },
  ] as readonly LoyaltyReward[],
  /** Absences tolérées par cycle : la suivante (même non consécutive) réinitialise la progression. */
  absencesAllowed: 1,
  /** Cycles conservés à l'affichage (les récompenses débloquées restent récupérables indéfiniment, quel que soit leur âge). */
  shownCycles: 6,
} as const;

export const LOYALTY_LENGTH = LOYALTY.days.length;

/** Total d'un cycle complet par type de récompense. */
export function loyaltyTotals(): Record<RewardKind, number> {
  const out: Record<RewardKind, number> = { shards: 0, boost: 0, gel: 0, prisms: 0 };
  for (const d of LOYALTY.days) out[d.kind] += d.amount;
  return out;
}

/** Classement du Défi quotidien : Prismes par rang (compétition « 1224 » : les ex æquo partagent le rang et la récompense). */
export const DAILY_RANKING = {
  /** Rang inclus → Prismes. Seuls les trois premiers sont récompensés (5, 2, 1) ; au-delà du 3ᵉ rang : rien. */
  prizes: [
    { from: 1, to: 1, prisms: 5 },
    { from: 2, to: 2, prisms: 2 },
    { from: 3, to: 3, prisms: 1 },
  ] as readonly { from: number; to: number; prisms: number }[],
  /** Dernier rang récompensé (tous les ex æquo de ce rang le sont). */
  lastRewardedRank: 3,
  /** Fin du défi : 00 h 00 UTC. Soumissions tardives acceptées jusqu'à 00 h 15 (tentative démarrée avant minuit, preuves du service). */
  graceMinutes: 15,
  /** Classement affiché (lignes). */
  topSize: 100,
} as const;

/** Prismes d'un rang (compétition) ; 0 hors du podium (rangs 1 à 3). */
export function dailyPrizeForRank(rank: number): number {
  for (const p of DAILY_RANKING.prizes) if (rank >= p.from && rank <= p.to) return p.prisms;
  return 0;
}

/** Total d'une journée à trois joueurs éligibles au moins, sans égalité : 5 + 2 + 1 = 8. */
export const DAILY_STANDARD_TOTAL = Array.from({ length: DAILY_RANKING.lastRewardedRank }, (_, i) => dailyPrizeForRank(i + 1)).reduce((a, b) => a + b, 0);

/**
 * Drop extrêmement rare de Prismes (Survie, première vie, partie démarrée EN LIGNE, validée par le rejeu du service) : chance par balise collectée,
 * tirage déterministe dérivé d'un secret du service + ticket + index de balise (jamais du client), un seul Prisme par partie.
 */
export const DROPS = {
  prism: {
    /** 0,02 % par balise. */
    chancePerBeacon: 0.0002,
    maxPerRun: 1,
    amount: 1,
  },
} as const;

/**
 * Sources futures de Prismes (succès, événements) : DÉCLARÉES mais DÉSACTIVÉES. Aucune ne distribue quoi que ce soit en phase 4 ; les 27 succès et
 * leurs 1 650 Médailles ne sont pas touchés. Activer une source exige un identifiant stable, un montant fixé ici et une clé de registre idempotente.
 */
export interface PrismSource {
  id: string;
  enabled: boolean;
  amount: number;
  /** Clé de registre (unique par profil) : `<préfixe>:<identifiant de l'occurrence>`. */
  refPrefix: string;
}
export const PRISM_SOURCES: readonly PrismSource[] = [
  { id: 'achievement-bonus', enabled: false, amount: 0, refPrefix: 'prism-ach' },
  { id: 'event', enabled: false, amount: 0, refPrefix: 'prism-evt' },
];
