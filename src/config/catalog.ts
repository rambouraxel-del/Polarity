/**
 * Catalogue des cosmétiques et conditions d'obtention — SOURCE UNIQUE.
 *
 * - `ship` : identifiant = identifiant d'apparence ; les vaisseaux sont DÉDUITS de `SKIN_CONFIG` (config/skins.ts : prix, méthode d'obtention,
 *   disponibilité, ordre — valeurs provisoires) ; `trail` : identifiant de traînée (config/trails.ts) ; `pack` : lot d'articles premium (aucun pour l'instant).
 * - Obtention : `default` (d'emblée) ; `price` (une seule monnaie) ; `choice` (au choix : Éclats OU Prismes) ; `reward` (en jouant) ; `unavailable`.
 *   · MÉDAILLES : cosmétiques non premium (gagnées par les succès, jamais achetées) ;
 *   · PRISMES : monnaie interne premium (jamais d'argent réel dans la boutique ; le débit est toujours contrôlé par le service) ;
 *   · ÉCLATS : cosmétiques « au choix » ; les Éclats servent aussi aux bonus (config/economy.ts).
 * - Les traînées sont indisponibles pour l'instant (`TRAILS_ENABLED` dans config/trails.ts) : leurs données sont conservées.
 * - Les cosmétiques déjà possédés restent acquis pour toujours et ne sont jamais re-facturés. Tous les articles sont cosmétiques (aucun effet de jeu).
 */
import { SKIN_CONFIG, type SkinConfig } from './skins';
import { TRAILS_ENABLED } from './trails';

export type Currency = 'shards' | 'medals' | 'prisms';

/**
 * `reward` : obtenu en jouant (jamais acheté) ; `condition` est le texte affiché. `choice` : achat au choix en Éclats OU en Prismes.
 * `unavailable` : non proposé pour l'instant (`reason` affichée) ; un article déjà possédé reste possédé.
 */
export type Acquire =
  | { type: 'default' }
  | { type: 'price'; currency: Currency; amount: number }
  | { type: 'choice'; shards: number; prisms: number }
  | { type: 'reward'; condition: string }
  | { type: 'unavailable'; reason: string };

export type ItemKind = 'ship' | 'trail' | 'pack';

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  name: string;
  /** Courte description affichée dans la boutique. */
  blurb: string;
  acquire: Acquire;
  /** Packs : identifiants des articles contenus (vaisseaux et traînées). */
  contents?: string[];
}

const medals = (amount: number): Acquire => ({ type: 'price', currency: 'medals', amount });
const prisms = (amount: number): Acquire => ({ type: 'price', currency: 'prisms', amount });

export const SOON = 'Indisponible pour l’instant';

/** Obtention d'une apparence, déduite de sa configuration. */
function skinAcquire(c: SkinConfig): Acquire {
  if (c.acquisition === 'default') return { type: 'default' };
  if (!c.available || c.acquisition === 'unavailable') return { type: 'unavailable', reason: SOON };
  if (c.acquisition === 'medals') return medals(c.priceMedals);
  return { type: 'choice', shards: c.priceShards, prisms: c.pricePrisms };
}

/** Traînées : tant que la catégorie est fermée, aucune n'est achetable ni équipable (leurs prix d'origine sont conservés dans `trail()`). */
const trail = (id: string, name: string, blurb: string, acquire: Acquire): CatalogItem => ({
  id, kind: 'trail', name, blurb, acquire: TRAILS_ENABLED || acquire.type === 'default' ? acquire : { type: 'unavailable', reason: SOON },
});

export const CATALOG: CatalogItem[] = [
  // Vaisseaux (ordre de la configuration des apparences)
  ...[...SKIN_CONFIG].sort((a, b) => a.order - b.order).map((c): CatalogItem => ({ id: c.id, kind: 'ship', name: c.name, blurb: c.blurb, acquire: skinAcquire(c) })),
  // Traînées
  trail('auto', 'Assortie', 'Traînée par défaut.', { type: 'default' }),
  trail('emeraude', 'Émeraude', 'Traînée vert émeraude.', medals(70)),
  trail('glacier', 'Glacier', 'Traînée bleu glacier.', medals(80)),
  trail('ultraviolet', 'Ultraviolet', 'Traînée violette.', medals(90)),
  trail('citron', 'Citron', 'Traînée jaune-vert vif.', medals(100)),
  trail('boreale', 'Boréale', 'Traînée vert d’aurore boréale.', medals(110)),
  trail('nebuleuse', 'Nébuleuse', 'Traînée bleu profond.', prisms(75)),
];

/**
 * Cosmétiques qui se débloquaient directement par un succès avant la v8 (identifiant d'article → succès). Sert UNIQUEMENT à la migration de
 * sauvegarde : un joueur qui avait déjà obtenu le succès conserve l'article (il passe dans `owned`). Aucun nouveau déblocage direct.
 * (Les anciennes apparences ont été retirées du jeu : seules les traînées subsistent.)
 */
export const LEGACY_ACHIEVEMENT_ITEMS: Readonly<Record<string, string>> = {
  citron: 'shards_250',
  boreale: 'events_30',
};

/**
 * Anciens vaisseaux SUPPRIMÉS du jeu et leur PRIX HISTORIQUE (dernier catalogue avant la refonte). Table explicite utilisée par le remboursement du
 * service (server/accounts.ts, `refundRemovedSkins`) quand le montant exact payé n'est pas enregistré dans le registre :
 * - `currency` / `price` : prix historique (dernier catalogue : Médailles pour les sept vaisseaux standard, Prismes pour Néon) ;
 * - `achievement` : succès qui débloquait gratuitement cet ancien vaisseau (avant la v8, ou en exclusivité) : si ce succès est obtenu et qu'aucun
 *   débit n'est enregistré, le vaisseau est réputé obtenu SANS dépense : aucun remboursement ;
 * - `viaPack` : pack premium qui l'accordait (Néon) : remboursement au prorata si seul le pack avait été acheté.
 * Règle générale : on rembourse ce qui a été RÉELLEMENT dépensé (ligne `spend:<id>` du registre, montant et monnaie exacts) ; sans ligne, le prix de
 * cette table, seulement si le vaisseau est possédé, non gratuit et sans succès correspondant. Jamais pour un vaisseau gratuit, obtenu par succès ou
 * récompense (Faille) : ils n'y figurent pas ou sont exclus. Une seule ligne `refund:<id>` par profil et par article (idempotence).
 */
export interface RemovedSkin {
  id: string;
  currency: 'medals' | 'prisms';
  price: number;
  achievement?: string;
  viaPack?: { id: string; share: number };
}

export const REMOVED_SKINS: readonly RemovedSkin[] = [
  { id: 'aurore', currency: 'medals', price: 140, achievement: 'first_cycle' },
  { id: 'menthe', currency: 'medals', price: 150, achievement: 'first_level' },
  { id: 'ambre', currency: 'medals', price: 160, achievement: 'survive_60' },
  { id: 'spectre', currency: 'medals', price: 170 },
  { id: 'glace', currency: 'medals', price: 180, achievement: 'max_combo' },
  { id: 'solaire', currency: 'medals', price: 190, achievement: 'survive_300' },
  { id: 'prisme', currency: 'medals', price: 200, achievement: 'all_levels' },
  // Néon : 150 Prismes ; le pack « Néon + Nébuleuse » (200 Prismes pour 225 de valeur) l'accordait : prorata 150 / 225
  { id: 'neon', currency: 'prisms', price: 150, viaPack: { id: 'pack-neon', share: 150 / 225 } },
];

/** Anciens vaisseaux payés en Médailles (remboursement local d'une sauvegarde sans service : economy/local.ts). */
export const REMOVED_MEDAL_SKINS: readonly string[] = REMOVED_SKINS.filter((r) => r.currency === 'medals').map((r) => r.id);

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export const itemsOfKind = (kind: ItemKind): CatalogItem[] => CATALOG.filter((i) => i.kind === kind);

/** Article premium : prix en Prismes. */
export const isPremium = (i: CatalogItem): boolean => i.acquire.type === 'price' && i.acquire.currency === 'prisms';

/** Prix total en Médailles des articles d'une catégorie payables en Médailles seulement. */
export function medalCost(kind: 'ship' | 'trail'): number {
  return CATALOG.filter((i) => i.kind === kind && i.acquire.type === 'price' && i.acquire.currency === 'medals').reduce((t, i) => t + (i.acquire.type === 'price' ? i.acquire.amount : 0), 0);
}
