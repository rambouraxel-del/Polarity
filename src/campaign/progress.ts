import { CAMPAIGN_REWARDS, CHAPTER, MISSIONS, STARS_PER_MISSION, UPGRADES, missionById, upgradeById, type UpgradeDef } from '../config/campaign';
import { storyById } from '../config/story';
import type { MissionRecord, SaveData } from '../save/save';
import { unlockAchievements, type AchievementDef } from '../progression/achievements';
import type { ActiveUpgrades, MissionReport } from './simulation';

/**
 * Progression de la campagne : étoiles, récompenses uniques, déblocages, transmissions lues, hangar.
 * Toutes les fonctions modifient la sauvegarde passée en paramètre (une seule écriture ensuite) ; aucun versement n'est possible
 * deux fois : une étoile ou une récompense n'est payée qu'au passage de faux à vrai, dans la même modification.
 */

export function missionRecord(save: SaveData, id: number): MissionRecord {
  return save.campaign.missions[String(id)] ?? { main: false, challenge: false, noShield: false, clears: 0, bestTime: 0 };
}

export function missionStars(save: SaveData, id: number): number {
  const r = missionRecord(save, id);
  return (r.main ? 1 : 0) + (r.challenge ? 1 : 0) + (r.noShield ? 1 : 0);
}

export function totalStars(save: SaveData): number {
  return MISSIONS.reduce((t, m) => t + missionStars(save, m.id), 0);
}

export const maxStars = (): number => MISSIONS.length * STARS_PER_MISSION;

/** La mission 1 est ouverte ; la mission n s'ouvre quand la mission n − 1 est réussie (aucun score minimal). */
export function isMissionUnlocked(save: SaveData, id: number): boolean {
  if (!missionById(id)) return false;
  const idx = MISSIONS.findIndex((m) => m.id === id);
  return idx <= 0 || missionRecord(save, MISSIONS[idx - 1].id).main;
}

/** Prochaine mission à jouer : la première non réussie (ou la dernière une fois le chapitre fini). */
export function nextMission(save: SaveData): number {
  const m = MISSIONS.find((x) => !missionRecord(save, x.id).main);
  return (m ?? MISSIONS[MISSIONS.length - 1]).id;
}

export const missionsCleared = (save: SaveData): number => MISSIONS.filter((m) => missionRecord(save, m.id).main).length;

export interface MissionRewards {
  firstClear: number;
  /** Étoiles secondaires obtenues pour la première fois dans cette tentative, et leur récompense. */
  newSecondary: number;
  starReward: number;
  /** Réussite d'une mission déjà réussie (aucun bonus unique répété). */
  repeatClear: number;
  total: number;
}

export interface MissionResult {
  report: MissionReport;
  rewards: MissionRewards;
  /** Étoiles nouvellement obtenues dans cette tentative. */
  newStars: { main: boolean; challenge: boolean; noShield: boolean };
  /** Mission nouvellement débloquée par cette réussite. */
  unlockedMission: number | null;
  /** Le chapitre vient d'être terminé (apparence Écho débloquée). */
  chapterCompleted: boolean;
  achievements: AchievementDef[];
  achievementShards: number;
  shardsBalance: number;
}

const NO_REWARDS: MissionRewards = { firstClear: 0, newSecondary: 0, starReward: 0, repeatClear: 0, total: 0 };

/** Applique le résultat d'une mission (une seule fois par tentative). Un échec ne verse rien et ne retire rien. */
export function applyMission(save: SaveData, report: MissionReport, now = Date.now()): MissionResult {
  const result: MissionResult = {
    report,
    rewards: { ...NO_REWARDS },
    newStars: { main: false, challenge: false, noShield: false },
    unlockedMission: null,
    chapterCompleted: false,
    achievements: [],
    achievementShards: 0,
    shardsBalance: save.wallet.shards,
  };
  const def = missionById(report.missionId);
  if (!def) return result;

  // Statistiques communes (les succès « cycles » et « combo » comptent aussi la campagne)
  save.stats.totalRuns++;
  save.stats.totalCycles += Math.max(0, Math.floor(report.cycles));
  save.stats.bestMultiplier = Math.max(save.stats.bestMultiplier, report.maxMultiplier);

  if (report.outcome === 'success') {
    const key = String(def.id);
    const before = missionRecord(save, def.id);
    const rec: MissionRecord = { ...before };
    const wasUnlocked = (id: number): boolean => isMissionUnlocked(save, id);
    const nextId = MISSIONS.find((m) => m.id === def.id + 1)?.id;
    const nextWasLocked = nextId !== undefined && !wasUnlocked(nextId);

    result.newStars.main = !before.main && report.stars.main;
    result.newStars.challenge = !before.challenge && report.stars.challenge;
    result.newStars.noShield = !before.noShield && report.stars.noShield;
    rec.main = true;
    rec.challenge = before.challenge || report.stars.challenge;
    rec.noShield = before.noShield || report.stars.noShield;
    rec.clears = before.clears + 1;
    rec.bestTime = before.bestTime > 0 ? Math.min(before.bestTime, report.time) : report.time;
    save.campaign.missions[key] = rec;

    const isLast = def.id === MISSIONS[MISSIONS.length - 1].id;
    const firstClear = result.newStars.main ? (isLast ? CAMPAIGN_REWARDS.finalFirstClear : CAMPAIGN_REWARDS.firstClear) : 0;
    const newSecondary = (result.newStars.challenge ? 1 : 0) + (result.newStars.noShield ? 1 : 0);
    const starReward = newSecondary * CAMPAIGN_REWARDS.star;
    const repeatClear = before.main ? CAMPAIGN_REWARDS.repeat : 0;
    const total = firstClear + starReward + repeatClear;
    result.rewards = { firstClear, newSecondary, starReward, repeatClear, total };
    save.wallet.shards += total;

    if (nextWasLocked) result.unlockedMission = nextId ?? null;
    if (isLast && !save.campaign.chapterComplete) {
      save.campaign.chapterComplete = true;
      result.chapterCompleted = true;
    }
  }

  result.achievements = unlockAchievements(save, undefined, now);
  result.achievementShards = result.achievements.reduce((t, a) => t + a.shards, 0);
  result.shardsBalance = save.wallet.shards;
  return result;
}

// ————————————————————————————————————————————— transmissions (journal)

/** Marque une séquence comme vue. Renvoie vrai si elle l'est pour la première fois (donc à jouer automatiquement). */
export function markSeen(save: SaveData, id: string): boolean {
  if (!storyById(id) || save.campaign.seen.includes(id)) return false;
  save.campaign.seen.push(id);
  return true;
}

export const hasSeen = (save: SaveData, id: string): boolean => save.campaign.seen.includes(id);

// ————————————————————————————————————————————— hangar

/** Une amélioration est présentée une fois la mission requise terminée (ou si elle est déjà possédée). */
export function isUpgradeVisible(save: SaveData, u: UpgradeDef): boolean {
  return save.campaign.upgrades.owned.includes(u.id) || missionRecord(save, u.unlockAfter).main;
}

export const isUpgradeOwned = (save: SaveData, id: string): boolean => save.campaign.upgrades.owned.includes(id);
export const isUpgradeEnabled = (save: SaveData, id: string): boolean => save.campaign.upgrades.enabled.includes(id) && isUpgradeOwned(save, id);

export type UpgradePurchase = { ok: true; upgrade: UpgradeDef; spent: number; balance: number } | { ok: false; reason: 'unknown' | 'locked' | 'owned' | 'insufficient' };

/** Achat en Éclats : vérification, débit et possession dans la même modification ; l'amélioration est activée à l'achat. */
export function buyUpgrade(save: SaveData, id: string): UpgradePurchase {
  const u = upgradeById(id);
  if (!u) return { ok: false, reason: 'unknown' };
  if (isUpgradeOwned(save, id)) return { ok: false, reason: 'owned' };
  if (!isUpgradeVisible(save, u)) return { ok: false, reason: 'locked' };
  if (save.wallet.shards < u.price) return { ok: false, reason: 'insufficient' };
  save.wallet.shards -= u.price;
  save.campaign.upgrades.owned.push(id);
  save.campaign.upgrades.enabled.push(id);
  return { ok: true, upgrade: u, spent: u.price, balance: save.wallet.shards };
}

/** Active ou désactive une amélioration possédée. Renvoie le nouvel état, ou null si elle n'est pas possédée. */
export function toggleUpgrade(save: SaveData, id: string): boolean | null {
  if (!isUpgradeOwned(save, id)) return null;
  const list = save.campaign.upgrades.enabled;
  const i = list.indexOf(id);
  if (i >= 0) {
    list.splice(i, 1);
    return false;
  }
  list.push(id);
  return true;
}

/** Améliorations appliquées en campagne : possédées ET activées. Jamais passées aux autres modes. */
export function activeUpgrades(save: SaveData): ActiveUpgrades {
  return {
    shield: isUpgradeEnabled(save, 'shield'),
    collector: isUpgradeEnabled(save, 'collector'),
    stabilizer: isUpgradeEnabled(save, 'stabilizer'),
  };
}

export const upgradeList = (save: SaveData): { upgrade: UpgradeDef; visible: boolean; owned: boolean; enabled: boolean }[] =>
  UPGRADES.map((u) => ({ upgrade: u, visible: isUpgradeVisible(save, u), owned: isUpgradeOwned(save, u.id), enabled: isUpgradeEnabled(save, u.id) }));

export { CHAPTER };
