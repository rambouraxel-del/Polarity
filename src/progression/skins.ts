import { DEFAULT_SKIN_ID, SKINS, type SkinDef } from '../config/skins';
import { isOwned, type Ownership } from './shop';

/**
 * Apparences : purement cosmétiques, aucune statistique. Les données (identifiant, nom, image, prestige, prix, disponibilité) sont dans
 * config/skins.ts ; le catalogue de la boutique en est déduit (config/catalog.ts).
 */
export type Skin = SkinDef;
export { SKINS };

/** Apparence par défaut (« Tôle brute ») : gratuite, équipée d'emblée, et repli de tout identifiant inexistant. */
export function defaultSkin(): Skin {
  return SKINS.find((s) => s.id === DEFAULT_SKIN_ID) ?? SKINS[0];
}

/** Apparence par identifiant ; identifiant inconnu (ancienne apparence retirée, valeur corrompue) → apparence par défaut. */
export function skinById(id: string): Skin {
  return SKINS.find((k) => k.id === id) ?? defaultSkin();
}

export function isKnownSkin(id: string): boolean {
  return SKINS.some((s) => s.id === id);
}

/** Possédée : gratuite, achetée (Médailles, Éclats ou Prismes). */
export function isSkinOwned(skin: Skin, own: Ownership): boolean {
  return isOwned(own, skin.id);
}

/** Apparence à équiper : celle de la sauvegarde si elle existe et est possédée, sinon l'apparence par défaut. */
export function resolveEquipped(id: string, own: Ownership): Skin {
  const s = skinById(id);
  return isSkinOwned(s, own) ? s : defaultSkin();
}
