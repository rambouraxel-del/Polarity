/**
 * Monétisation (phase 5) : packs de Prismes et identifiants de produits. Source unique, partagée par le jeu (affichage) et le service (attribution).
 * Les Prismes accordés viennent TOUJOURS de cette table (jamais d'un montant déclaré par le client ni d'un prix renvoyé par une boutique).
 * Les prix en euros sont les prix publics SOUHAITÉS (affichage indicatif) : le prix réellement facturé est celui configuré chez chaque fournisseur
 * (App Store Connect, Google Play Console, prestataire web) et affiché par la plateforme.
 */
export type StoreId = 'apple' | 'google' | 'web';

export interface PrismPack {
  /** Identifiant interne stable (sauvegarde, journaux). */
  id: string;
  name: string;
  prisms: number;
  /** Prix public souhaité, en centimes d'euro (indicatif). */
  priceCents: number;
  /** Identifiant du produit consommable à créer chez Apple (App Store Connect) et Google (Play Console) : identique, stable, à ne jamais changer. */
  productId: string;
}

export const PRISM_PACKS: readonly PrismPack[] = [
  { id: 'decouverte', name: 'Découverte', prisms: 30, priceCents: 99, productId: 'polar_rift_prisms_30' },
  { id: 'intermediaire', name: 'Intermédiaire', prisms: 100, priceCents: 299, productId: 'polar_rift_prisms_100' },
  { id: 'grand', name: 'Grand', prisms: 380, priceCents: 999, productId: 'polar_rift_prisms_380' },
];

export const packByProductId = (productId: unknown): PrismPack | undefined => PRISM_PACKS.find((p) => p.productId === productId);
export const packById = (id: unknown): PrismPack | undefined => PRISM_PACKS.find((p) => p.id === id);

/** « 0,99 € » */
export const formatEuros = (cents: number): string => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** Publicité récompensée : vies concernées (seule la deuxième chance ; la troisième est payante uniquement). */
export const AD_REVIVE_LIFE = 2;

export const PURCHASE_LIMITS = {
  /** Justificatifs traités par demande de restauration. */
  restoreBatch: 20,
  /** Âge maximal d'une session publicitaire non réclamée (ms). */
  adSessionMs: 15 * 60_000,
} as const;
