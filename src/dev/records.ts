import type { KeyValueStore, SaveData } from '../save/save';

/**
 * Remise à zéro des RECORDS LOCAUX (outil du mode développeur) : meilleurs temps et scores de la Survie « Sans bonus », « Avec bonus » et du Défi quotidien.
 * Jamais touchés : profil du classement, monnaies (Éclats, Médailles, Prismes), achats, cosmétiques, succès, statistiques, niveaux, campagne, options, archives
 * des anciennes versions. Une copie des données concernées est écrite dans le stockage de l'appareil AVANT l'effacement (les trois dernières sont conservées).
 */
export const RECORDS_BACKUP_PREFIX = 'polarite.sauvegarde-records.';
const KEEP = 3;

export interface RecordsSnapshot {
  at: string;
  survival: SaveData['survival'];
  survivalBonus: SaveData['survivalBonus'];
  daily: SaveData['daily'];
}

export function snapshotRecords(save: SaveData, now = Date.now()): RecordsSnapshot {
  return { at: new Date(now).toISOString(), survival: { ...save.survival }, survivalBonus: { ...save.survivalBonus }, daily: JSON.parse(JSON.stringify(save.daily)) as SaveData['daily'] };
}

export function hasRecords(save: SaveData): boolean {
  return save.survival.bestTime > 0 || save.survivalBonus.bestTime > 0 || Object.keys(save.daily).length > 0 || save.survival.runs > 0 || save.survivalBonus.runs > 0;
}

/** Écrit la copie de sécurité ; renvoie sa clé, ou null si le stockage refuse l'écriture (alors on n'efface rien). */
export function backupRecords(store: KeyValueStore, snap: RecordsSnapshot, index: string[]): string | null {
  const key = `${RECORDS_BACKUP_PREFIX}${snap.at.replace(/[:.]/g, '-')}`;
  store.set(key, JSON.stringify(snap));
  if (store.failed === true || store.get(key) === null) return null;
  // Conserve les trois dernières copies
  const keys = [...index.filter((k) => k !== key), key];
  while (keys.length > KEEP) store.remove(keys.shift()!);
  index.length = 0;
  index.push(...keys);
  return key;
}

export function clearRecords(save: SaveData): void {
  save.survival = { bestTime: 0, bestScore: 0, runs: 0 };
  save.survivalBonus = { bestTime: 0, bestScore: 0, runs: 0 };
  save.daily = {};
}
