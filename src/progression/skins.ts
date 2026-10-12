import { CLASSIC_SKIN_ID, SHIP_MODELS, SKINS, type SkinDef } from '../config/skins';
import { achievementById } from './achievements';

/**
 * Apparences : purement cosmétiques, aucune statistique. Les données sont dans config/skins.ts.
 * Les couleurs des menaces (corail, orange, magenta) ne sont jamais reprises par un réacteur.
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

/** Identifiant du succès qui débloque l'apparence (null = disponible d'emblée). */
export function unlockAchievementId(skin: Skin): string | null {
  return skin.unlock.type === 'achievement' ? skin.unlock.id : null;
}

export function isSkinUnlocked(skin: Skin, achievements: Record<string, number>): boolean {
  return skin.unlock.type === 'default' || achievements[skin.unlock.id] !== undefined;
}

/** Condition de déblocage lisible : nom du succès et ce qu'il faut faire. Vide si l'apparence est disponible d'emblée. */
export function unlockCondition(skin: Skin): { name: string; description: string } | null {
  if (skin.unlock.type !== 'achievement') return null;
  const a = achievementById(skin.unlock.id);
  return a ? { name: a.name, description: a.description } : { name: skin.unlock.id, description: '' };
}

/** Apparence à équiper : celle de la sauvegarde si elle existe et est débloquée, sinon la classique. */
export function resolveEquipped(id: string, achievements: Record<string, number>): Skin {
  const s = skinById(id);
  return isSkinUnlocked(s, achievements) ? s : classicSkin();
}
