/**
 * Catalogue des cosmétiques et conditions d'obtention — SOURCE UNIQUE.
 *
 * - `ship` : identifiant = identifiant d'apparence (config/skins.ts) ; `trail` : identifiant de traînée (config/trails.ts) ;
 *   `pack` : lot d'articles à prix réduit.
 * - Obtention : `default` (d'emblée), `achievement` (exclusivité d'un succès, jamais achetable), `price` (Éclats ou Prismes).
 * - Les articles à prix en Prismes sont « premium » : destinés aux futurs achats réels, **non achetables** dans cette version
 *   (« Bientôt disponible »). Le fournisseur de paiement est décrit dans monetization/payments.ts.
 * Prix ajustables ici ; l'ordre est l'ordre d'affichage. Tous les articles sont cosmétiques (aucun effet de jeu).
 */
export type Currency = 'shards' | 'prisms';

export type Acquire =
  | { type: 'default' }
  | { type: 'achievement'; id: string }
  | { type: 'price'; currency: Currency; amount: number };

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

const shards = (amount: number): Acquire => ({ type: 'price', currency: 'shards', amount });
const prisms = (amount: number): Acquire => ({ type: 'price', currency: 'prisms', amount });

export const CATALOG: CatalogItem[] = [
  // Vaisseaux
  { id: 'classique', kind: 'ship', name: 'Classique', blurb: 'Le vaisseau d’origine, blanc et cyan.', acquire: { type: 'default' } },
  { id: 'aurore', kind: 'ship', name: 'Aurore', blurb: 'Ailes vertes, réacteur vert d’eau.', acquire: shards(100) },
  { id: 'menthe', kind: 'ship', name: 'Menthe', blurb: 'Ailes menthe, cockpit crème.', acquire: shards(200) },
  { id: 'ambre', kind: 'ship', name: 'Ambre', blurb: 'Ailes ambrées, réacteur jaune pâle.', acquire: shards(350) },
  { id: 'spectre', kind: 'ship', name: 'Spectre', blurb: 'Ailes violettes, réacteur ultraviolet.', acquire: shards(600) },
  { id: 'glace', kind: 'ship', name: 'Glace', blurb: 'Ailes bleu glacier.', acquire: { type: 'achievement', id: 'max_combo' } },
  { id: 'solaire', kind: 'ship', name: 'Solaire', blurb: 'Ailes dorées, cockpit lumineux.', acquire: { type: 'achievement', id: 'survive_300' } },
  { id: 'prisme', kind: 'ship', name: 'Prisme', blurb: 'Coque cristalline, ailes irisées.', acquire: { type: 'achievement', id: 'all_levels' } },
  { id: 'neon', kind: 'ship', name: 'Néon', blurb: 'Ailes rose néon, cockpit et réacteur cyan.', acquire: prisms(150) },
  // Traînées
  { id: 'auto', kind: 'trail', name: 'Assortie', blurb: 'Suit la couleur du vaisseau équipé.', acquire: { type: 'default' } },
  { id: 'emeraude', kind: 'trail', name: 'Émeraude', blurb: 'Traînée vert émeraude.', acquire: shards(150) },
  { id: 'glacier', kind: 'trail', name: 'Glacier', blurb: 'Traînée bleu glacier.', acquire: shards(250) },
  { id: 'ultraviolet', kind: 'trail', name: 'Ultraviolet', blurb: 'Traînée violette.', acquire: shards(400) },
  { id: 'nebuleuse', kind: 'trail', name: 'Nébuleuse', blurb: 'Traînée bleu profond.', acquire: prisms(80) },
  // Packs
  { id: 'pack-aurore', kind: 'pack', name: 'Pack Aurore', blurb: 'Vaisseau Aurore + traînée Émeraude.', acquire: shards(220), contents: ['aurore', 'emeraude'] },
  { id: 'pack-spectre', kind: 'pack', name: 'Pack Spectre', blurb: 'Vaisseau Spectre + traînée Ultraviolet.', acquire: shards(900), contents: ['spectre', 'ultraviolet'] },
  { id: 'pack-neon', kind: 'pack', name: 'Pack Néon', blurb: 'Vaisseau Néon + traînée Nébuleuse.', acquire: prisms(200), contents: ['neon', 'nebuleuse'] },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export const itemsOfKind = (kind: ItemKind): CatalogItem[] => CATALOG.filter((i) => i.kind === kind);

/** Article premium : prix en Prismes. */
export const isPremium = (i: CatalogItem): boolean => i.acquire.type === 'price' && i.acquire.currency === 'prisms';
