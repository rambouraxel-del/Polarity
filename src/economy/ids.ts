import type { KeyValueStore, SaveData } from '../save/save';
import { STORAGE_NAMESPACE } from '../config/brand';

/** Identifiant d'installation : UUID v4 (crypto) ou, à défaut, identifiant aléatoire équivalent. Jamais utilisé pour le gameplay (pas de graine). */
export function newInstallId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Clé DÉDIÉE de l'identifiant d'installation, hors de la sauvegarde : une ancienne version du jeu (retour arrière) réécrit la sauvegarde sans le bloc
 * économie, mais ne touche pas à cette clé. En la retrouvant, la même installation reste connue du service (migration héritée déjà faite : aucun second
 * import d'Éclats ; compteurs d'achats et d'usage de bonus cohérents). Effacée par une remise à zéro volontaire.
 */
export const INSTALL_KEY = `${STORAGE_NAMESPACE}.installation`;
const VALID = /^[A-Za-z0-9-]{8,64}$/;

let installStore: KeyValueStore | null = null;
/** Stockage où l'identifiant est doublé (renseigné au démarrage du jeu ; absent dans les tests = comportement sans doublon). */
export function useInstallStore(store: KeyValueStore | null): void {
  installStore = store;
}

/** Attribue l'identifiant d'installation s'il manque (le retrouve dans sa clé dédiée si la sauvegarde l'a perdu). Renvoie vrai si la sauvegarde a changé (à écrire). */
export function ensureInstallId(save: SaveData): boolean {
  const kept = installStore?.get(INSTALL_KEY) ?? null;
  if (save.economy.installId) {
    if (installStore && kept !== save.economy.installId) installStore.set(INSTALL_KEY, save.economy.installId);
    return false;
  }
  save.economy.installId = kept && VALID.test(kept) ? kept : newInstallId();
  installStore?.set(INSTALL_KEY, save.economy.installId);
  return true;
}
