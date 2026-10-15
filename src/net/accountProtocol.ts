import type { SaveData } from '../save/save';

/**
 * Protocole des COMPTES et de la SYNCHRONISATION (économie v3) : types partagés jeu ↔ service. Aucune donnée secrète n'y figure.
 * Voir docs/COMPTES.md.
 */
export type ProviderId = 'google' | 'apple' | 'email';

/** Méthodes de connexion que le service a RÉELLEMENT configurées (les autres restent désactivées ; jamais de fausse connexion). */
export interface ProvidersResponse {
  google: { enabled: boolean; /** Identifiant client OAuth « web » (public par nature) : sert à l'interface Google du navigateur. */ clientId?: string };
  apple: { enabled: boolean; /** Identifiant de service Apple (public). */ clientId?: string };
  email: { enabled: boolean };
}

export interface NonceResponse {
  nonce: string;
  /** Durée de validité (s). */
  expiresIn: number;
}

/** Réponse commune aux connexions (Google, Apple, lien magique) et à la création de profil invité. */
export interface AuthResponse {
  playerId: string;
  /** Secret de CET appareil : présent seulement quand un nouvel accès est créé (connexion sur un nouvel appareil, nouveau profil, fusion). */
  token?: string;
  nickname: string;
  /** Pseudo non choisi par le joueur (profil invité) : absent du classement public tant qu'il n'a pas choisi un pseudo. */
  guest: boolean;
  identities: IdentityInfo[];
  /** Un nouveau profil vient d'être créé. */
  created?: boolean;
  /** Le profil de cet appareil a été fusionné dans le compte existant. */
  merged?: boolean;
}

export interface IdentityInfo {
  provider: ProviderId;
  /** Courriel masqué (a***@exemple.fr) ou vide. */
  label: string;
}

export interface EmailRequestBody {
  email: string;
}

export interface EmailRequestResponse {
  /** Toujours renvoyé (même pour une adresse invalide) : aucune information sur l'existence d'un compte. */
  requestId: string;
  expiresIn: number;
}

export interface EmailVerifyBody {
  requestId: string;
  code: string;
  /** Confirmer la fusion du profil invité de cet appareil dans le compte retrouvé. */
  merge?: boolean;
}

export interface OidcLoginBody {
  idToken: string;
  /** Nonce délivré par `POST /api/auth/nonce` (usage unique : anti-rejeu). */
  nonce: string;
  merge?: boolean;
}

export interface ConflictResponse {
  error: 'identity_conflict';
  message: string;
  /** Pseudo du compte existant. */
  targetNickname: string;
  /** La fusion est possible (profil de cet appareil sans compte). */
  canMerge: boolean;
}

export interface ProfileResponse {
  playerId: string;
  nickname: string;
  guest: boolean;
  identities: IdentityInfo[];
  /** Vrai si le profil est un COMPTE (au moins une méthode de connexion) : exigé pour les futurs achats de Prismes en argent réel. */
  canBuyPremium: boolean;
  balance: { shards: number; medals: number; prisms: number };
}

export interface MigrateBody {
  installId: string;
  /** Sauvegarde locale complète (formats ≤ 7 acceptés ; le serveur la valide champ par champ). */
  save: unknown;
}

/** Achat à confirmer : article → prix payé en Éclats. */
export type PurchasesBody = Record<string, number>;

export interface SyncBody {
  installId: string;
  /** Compteur monotone des gains répétables de cette installation. */
  earned: number;
  /** Achats de cosmétiques à confirmer : article → prix payé (Médailles ; le service débite le prix du catalogue). */
  purchases: PurchasesBody;
  /** Médailles de succès RÉCLAMÉES (identifiants historiques) : le service crédite chacune une seule fois, si le succès figure dans la progression. */
  claims: string[];
  /** Compteurs monotones des charges de bonus achetées par cette installation (idempotence : seul l'écart avec le traité compte). */
  bonusBought: { boost: number; gel: number };
  /** Compteurs monotones des charges UTILISÉES hors parties classées (le service en déduit l'écart de l'inventaire ; idempotent). */
  bonusUsed?: { boost: number; gel: number };
  save: unknown;
}

export type PurchaseRejection = 'unknown' | 'not_purchasable' | 'premium' | 'bad_price' | 'insufficient';

/** Achat d'un article PREMIUM (Prismes) : requête directe, en ligne ; le service vérifie le solde et débite de façon atomique et idempotente. */
export interface PremiumPurchaseBody {
  item: string;
}

export interface PremiumPurchaseResponse {
  item: string;
  /** Faux : article déjà possédé, aucun Prisme débité. */
  charged: boolean;
  /** Prismes débités (prorata pour un pack dont une partie était déjà possédée). */
  price: number;
  balance: { shards: number; medals: number; prisms: number };
  /** Cosmétiques possédés selon le service (après l'achat). */
  owned: string[];
}

/** Reprise payée en Prismes (deuxième ou troisième chance) : requête directe, en ligne ; débit idempotent par (partie, vie). */
export interface ReviveBody {
  /** Identifiant aléatoire de la partie (le même pour les deux vies d'une partie). */
  runId: string;
  life: 2 | 3;
}

export interface ReviveResponse {
  life: 2 | 3;
  /** Faux : cette reprise avait déjà été payée (rejeu de la requête), aucun Prisme débité de plus. */
  charged: boolean;
  price: number;
  balance: { shards: number; medals: number; prisms: number };
}

/** Résultat d'une migration ou d'une synchronisation. Le serveur est la source de vérité : le client s'aligne dessus (src/economy/reconcile.ts). */
export interface SyncResponse {
  /** Révision de la sauvegarde conservée par le serveur. */
  rev: number;
  balance: { shards: number; medals: number; prisms: number };
  /** Charges de bonus possédées selon le registre du service. */
  inventory: { boost: number; gel: number };
  /** Compteurs de charges traitées (acceptées + refusées) pour cette installation. */
  bonus: { boost: number; gel: number };
  /** Charges demandées mais refusées (fonds insuffisants ou inventaire plein) : retirées de l'inventaire local. */
  bonusRejected: { boost: number; gel: number };
  /** Succès dont les Médailles sont créditées (source de vérité) et réclamations refusées (succès absent de la progression). */
  claimed: string[];
  rejectedClaims: string[];
  /** Filigrane des gains répétables acceptés pour cette installation. */
  watermark: number;
  /** Une partie des gains annoncés a dépassé le plafond : le reste sera accepté aux synchronisations suivantes. */
  capped: boolean;
  /** Achats reconnus ; `charged: false` = article déjà possédé, jamais débité. */
  acknowledged: { item: string; charged: boolean }[];
  rejected: { item: string; reason: PurchaseRejection }[];
  /** Migration héritée : importée maintenant, ou déjà importée avant (idempotence). */
  legacy?: 'imported' | 'already' | 'none' | 'limit';
  /** Sauvegarde fusionnée conservée par le serveur (sans options ni portefeuille). */
  save: SaveData;
  at: number;
}
