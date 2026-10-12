import { catalogItem } from '../config/catalog';
import { CLASSIC_SKIN_ID, SHIP_MODELS, SKINS, type SkinDef } from '../config/skins';
import { achievementById } from './achievements';
import { isOwned, type Ownership } from './shop';

/**
 * Apparences : purement cosmétiques, aucune statistique. Les données visuelles sont dans config/skins.ts,
 * les conditions d'obtention dans config/catalog.ts. Les couleurs des menaces (corail, orange, magenta)
 * ne sont jamais reprises par un réacteur.
 */
export type Skin = SkinDef;
export { SKINS };

export function classicSkin(): Skin {
  return SKINS.find((s) => s.id === CLASSIC_SKIN_ID) ?? SKINS[0];
}

/** Apparence par identifiant ; identifiant inconnu ou modèle indisponible → modèle classique. */
export function skinById(id: string): Skin {
  const s = SKINS.find((k) => k.id === id);
  return s && s.asset in SHIP_MODELS ? s : classicSkin();
}

export function isKnownSkin(id: string): boolean {
  return SKINS.some((s) => s.id === id && s.asset in SHIP_MODELS);
}

/** Identifiant du succès dont l'apparence est l'exclusivité (null sinon). */
export function unlockAchievementId(skin: Skin): string | null {
  const a = catalogItem(skin.id)?.acquire;
  return a?.type === 'achievement' ? a.id : null;
}

/** Possédée : gratuite, achetée, conservée d'une version précédente, ou exclusivité d'un succès obtenu. */
export function isSkinOwned(skin: Skin, own: Ownership): boolean {
  return isOwned(own, skin.id);
}

/** Condition d'une exclusivité de succès : nom et description du succès. Null si l'apparence n'en dépend pas. */
export function unlockCondition(skin: Skin): { name: string; description: string } | null {
  const id = unlockAchievementId(skin);
  if (!id) return null;
  const a = achievementById(id);
  return a ? { name: a.name, description: a.description } : { name: id, description: '' };
}

/** Apparence à équiper : celle de la sauvegarde si elle existe et est possédée, sinon la classique. */
export function resolveEquipped(id: string, own: Ownership): Skin {
  const s = skinById(id);
  return isSkinOwned(s, own) ? s : classicSkin();
}
