import type { SaveData } from '../save/save';

/** Identifiant d'installation : UUID v4 (crypto) ou, à défaut, identifiant aléatoire équivalent. Jamais utilisé pour le gameplay (pas de graine). */
export function newInstallId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Attribue l'identifiant d'installation s'il manque. Renvoie vrai si la sauvegarde a changé (à écrire). */
export function ensureInstallId(save: SaveData): boolean {
  if (save.economy.installId) return false;
  save.economy.installId = newInstallId();
  return true;
}
