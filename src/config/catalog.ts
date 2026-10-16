/**
 * Catalogue des cosmétiques et conditions d'obtention — SOURCE UNIQUE (économie v3, phase 2).
 *
 * - `ship` : identifiant = identifiant d'apparence (config/skins.ts) ; `trail` : identifiant de traînée (config/trails.ts) ;
 *   `pack` : lot d'articles premium à prix réduit (aucun pack en Médailles : le total de la collection est fixe).
 * - Obtention : `default` (d'emblée) ou `price` :
 *   · MÉDAILLES : tous les cosmétiques non premium (gagnées par les succès, jamais achetées) ;
 *   · PRISMES : articles premium (gagnés très rarement ou achetés plus tard ; le débit est toujours contrôlé par le service).
 *   Les Éclats ne servent plus aux cosmétiques (ils servent aux bonus : config/economy.ts).
 * - Un succès ne débloque plus directement de cosmétique. Les cosmétiques déjà possédés (achetés, ou débloqués par un succès avant la
 *   v8 : migration de sauvegarde) restent acquis pour toujours et ne sont jamais re-facturés.
 * Prix ajustables ici ; l'ordre est l'ordre d'affichage. Tous les articles sont cosmétiques (aucun effet de jeu).
 * Total de la collection non premium : 1 190 (vaisseaux) + 450 (traînées) = 1 640 Médailles ; les succès en rapportent 1 650 (config/achievements.ts).
 */
export type Currency = 'shards' | 'medals' | 'prisms';

/**
 * `reward` : obtenu en jouant (jamais acheté) — ex. l'apparence de la première traversée de la faille (config/phases.ts). Débloqué une seule fois
 * par profil en l'ajoutant à `save.owned` ; `condition` est le texte affiché dans la boutique.
 */
export type Acquire = { type: 'default' } | { type: 'price'; currency: Currency; amount: number } | { type: 'reward'; condition: string };

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

export const CATALOG: CatalogItem[] = [
  // Vaisseaux
  { id: 'classique', kind: 'ship', name: 'Classique', blurb: 'Le vaisseau d’origine, blanc et cyan.', acquire: { type: 'default' } },
  { id: 'aurore', kind: 'ship', name: 'Aurore', blurb: 'Ailes vertes, réacteur vert d’eau.', acquire: medals(140) },
  { id: 'menthe', kind: 'ship', name: 'Menthe', blurb: 'Ailes menthe, cockpit crème.', acquire: medals(150) },
  { id: 'ambre', kind: 'ship', name: 'Ambre', blurb: 'Ailes ambrées, réacteur jaune pâle.', acquire: medals(160) },
  { id: 'spectre', kind: 'ship', name: 'Spectre', blurb: 'Ailes violettes, réacteur ultraviolet.', acquire: medals(170) },
  { id: 'glace', kind: 'ship', name: 'Glace', blurb: 'Ailes bleu glacier.', acquire: medals(180) },
  { id: 'solaire', kind: 'ship', name: 'Solaire', blurb: 'Ailes dorées, cockpit lumineux.', acquire: medals(190) },
  { id: 'prisme', kind: 'ship', name: 'Prisme', blurb: 'Coque cristalline, ailes irisées.', acquire: medals(200) },
  { id: 'neon', kind: 'ship', name: 'Néon', blurb: 'Ailes rose néon, cockpit et réacteur cyan.', acquire: prisms(150) },
  // Exclusif : récompense de la première traversée de la faille (Survie, fin de la phase 1)
  { id: 'faille', kind: 'ship', name: 'Faille', blurb: 'Coque sombre, ailes électriques : traverser la faille de la Survie.', acquire: { type: 'reward', condition: 'Récompense : franchir la faille en Survie (5 minutes), une seule fois par profil.' } },
  // Traînées
  { id: 'auto', kind: 'trail', name: 'Assortie', blurb: 'Suit la couleur du vaisseau équipé.', acquire: { type: 'default' } },
  { id: 'emeraude', kind: 'trail', name: 'Émeraude', blurb: 'Traînée vert émeraude.', acquire: medals(70) },
  { id: 'glacier', kind: 'trail', name: 'Glacier', blurb: 'Traînée bleu glacier.', acquire: medals(80) },
  { id: 'ultraviolet', kind: 'trail', name: 'Ultraviolet', blurb: 'Traînée violette.', acquire: medals(90) },
  { id: 'citron', kind: 'trail', name: 'Citron', blurb: 'Traînée jaune-vert vif.', acquire: medals(100) },
  { id: 'boreale', kind: 'trail', name: 'Boréale', blurb: 'Traînée vert d’aurore boréale.', acquire: medals(110) },
  { id: 'nebuleuse', kind: 'trail', name: 'Nébuleuse', blurb: 'Traînée bleu profond.', acquire: prisms(75) },
  // Pack premium : 200 Prismes au lieu de 225 (économie de 25)
  { id: 'pack-neon', kind: 'pack', name: 'Pack Néon + Nébuleuse', blurb: 'Vaisseau Néon + traînée Nébuleuse : 25 Prismes économisés.', acquire: prisms(200), contents: ['neon', 'nebuleuse'] },
];

/**
 * Cosmétiques qui se débloquaient directement par un succès avant la v8 (identifiant d'article → succès). Sert UNIQUEMENT à la migration de
 * sauvegarde : un joueur qui avait déjà obtenu le succès conserve l'article (il passe dans `owned`). Aucun nouveau déblocage direct.
 */
export const LEGACY_ACHIEVEMENT_ITEMS: Readonly<Record<string, string>> = {
  glace: 'max_combo',
  solaire: 'survive_300',
  prisme: 'all_levels',
  citron: 'shards_250',
  boreale: 'events_30',
};

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export const itemsOfKind = (kind: ItemKind): CatalogItem[] => CATALOG.filter((i) => i.kind === kind);

/** Article premium : prix en Prismes. */
export const isPremium = (i: CatalogItem): boolean => i.acquire.type === 'price' && i.acquire.currency === 'prisms';

/** Prix en Médailles de la collection non premium, par catégorie (contrôlé par les tests : 1 190 + 450 = 1 640). */
export function medalCost(kind: 'ship' | 'trail'): number {
  return CATALOG.filter((i) => i.kind === kind && i.acquire.type === 'price' && i.acquire.currency === 'medals').reduce((t, i) => t + (i.acquire.type === 'price' ? i.acquire.amount : 0), 0);
}
