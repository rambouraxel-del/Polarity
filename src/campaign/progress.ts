import { CAMPAIGN_REWARDS, HANGAR_ENABLED, MISSIONS, STARS_PER_MISSION, UPGRADES, missionById, upgradeById, type UpgradeDef } from '../config/campaign';
import { storyById } from '../config/story';
import type { MissionRecord, SaveData } from '../save/save';
import type { ActiveUpgrades, MissionReport } from './simulation';

/**
 * Progression de la campagne : étoiles, récompenses uniques, déblocages, scènes vues, réserve d'Éclats de campagne.
 * Toutes les fonctions modifient la sauvegarde passée en paramètre (une seule écriture ensuite) ; aucun versement n'est possible
 * deux fois : une étoile ou une récompense n'est payée qu'au passage de faux à vrai, dans la même modification.
 *
 * Isolation : les gains de la campagne vont dans `save.campaign.reserve`, jamais dans le portefeuille de la Survie et des cosmétiques ;
 * les succès, statistiques et records de la Survie ne sont pas touchés par la campagne.
 */

export function missionRecord(save: SaveData, id: number): MissionRecord {
  return save.campaign.missions[String(id)] ?? { main: false, challenge: false, clears: 0, bestTime: 0 };
}

export function missionStars(save: SaveData, id: number): number {
  const r = missionRecord(save, id);
  return (r.main ? 1 : 0) + (r.challenge ? 1 : 0);
}

export function totalStars(save: SaveData): number {
  return MISSIONS.reduce((t, m) => t + missionStars(save, m.id), 0);
}

export const maxStars = (): number => MISSIONS.length * STARS_PER_MISSION;

/** Le niveau 1 est ouvert ; le niveau n s'ouvre quand le niveau n − 1 est réussi (aucun score minimal). */
export function isMissionUnlocked(save: SaveData, id: number): boolean {
  if (!missionById(id)) return false;
  const idx = MISSIONS.findIndex((m) => m.id === id);
  return idx <= 0 || missionRecord(save, MISSIONS[idx - 1].id).main;
}

/** Prochain niveau à jouer : le premier non réussi (ou le dernier une fois tout terminé). */
export function nextMission(save: SaveData): number {
  const m = MISSIONS.find((x) => !missionRecord(save, x.id).main);
  return (m ?? MISSIONS[MISSIONS.length - 1]).id;
}

export const missionsCleared = (save: SaveData): number => MISSIONS.filter((m) => missionRecord(save, m.id).main).length;

export interface MissionRewards {
  firstClear: number;
  /** Défi secondaire réussi pour la première fois dans cette tentative. */
  challenge: number;
  /** Réussite d'un niveau déjà réussi (0 : aucun gain répété). */
  repeatClear: number;
  total: number;
}

export interface MissionResult {
  report: MissionReport;
  rewards: MissionRewards;
  /** Étoiles nouvellement obtenues dans cette tentative. */
  newStars: { main: boolean; challenge: boolean };
  /** Niveau nouvellement débloqué par cette réussite. */
  unlockedMission: number | null;
  /** Tous les niveaux livrés viennent d'être terminés (« Suite du chapitre à venir »). */
  chapterCompleted: boolean;
  /** Réserve d'Éclats de campagne après cette tentative. */
  reserveBalance: number;
}

const NO_REWARDS: MissionRewards = { firstClear: 0, challenge: 0, repeatClear: 0, total: 0 };

/** Applique le résultat d'un niveau (une seule fois par tentative). Un échec ne verse rien et ne retire rien. */
export function applyMission(save: SaveData, report: MissionReport): MissionResult {
  const result: MissionResult = {
    report,
    rewards: { ...NO_REWARDS },
    newStars: { main: false, challenge: false },
    unlockedMission: null,
    chapterCompleted: false,
    reserveBalance: save.campaign.reserve,
  };
  const def = missionById(report.missionId);
  if (!def || report.outcome !== 'success') return result;

  const key = String(def.id);
  const before = missionRecord(save, def.id);
  const nextId = MISSIONS.find((m) => m.id === def.id + 1)?.id;
  const nextWasLocked = nextId !== undefined && !isMissionUnlocked(save, nextId);

  result.newStars.main = !before.main && report.stars.main;
  result.newStars.challenge = !before.challenge && report.stars.challenge;
  save.campaign.missions[key] = {
    main: true,
    challenge: before.challenge || report.stars.challenge,
    clears: before.clears + 1,
    bestTime: before.bestTime > 0 ? Math.min(before.bestTime, report.time) : report.time,
  };

  const firstClear = result.newStars.main ? CAMPAIGN_REWARDS.firstClear : 0;
  const challenge = result.newStars.challenge ? CAMPAIGN_REWARDS.star : 0;
  const repeatClear = before.main ? CAMPAIGN_REWARDS.repeat : 0;
  const total = firstClear + challenge + repeatClear;
  result.rewards = { firstClear, challenge, repeatClear, total };
  save.campaign.reserve += total;
  result.reserveBalance = save.campaign.reserve;

  if (nextWasLocked) result.unlockedMission = nextId ?? null;
  if (!save.campaign.chapterComplete && MISSIONS.every((m) => missionRecord(save, m.id).main)) {
    save.campaign.chapterComplete = true;
    result.chapterCompleted = true;
  }
  return result;
}

// ————————————————————————————————————————————— scènes (journal)

/** Marque une scène comme vue. Renvoie vrai si elle l'est pour la première fois (donc à jouer automatiquement). */
export function markSeen(save: SaveData, id: string): boolean {
  if (!storyById(id) || save.campaign.seen.includes(id)) return false;
  save.campaign.seen.push(id);
  return true;
}

export const hasSeen = (save: SaveData, id: string): boolean => save.campaign.seen.includes(id);

// ————————————————————————————————————————————— hangar (prévu pour la suite ; désactivé tant que `HANGAR_ENABLED` est faux)

/** Une amélioration est présentée une fois le niveau requis terminé (ou si elle est déjà possédée). */
export function isUpgradeVisible(save: SaveData, u: UpgradeDef): boolean {
  return HANGAR_ENABLED && (save.campaign.upgrades.owned.includes(u.id) || missionRecord(save, u.unlockAfter).main);
}

export const isUpgradeOwned = (save: SaveData, id: string): boolean => save.campaign.upgrades.owned.includes(id);
export const isUpgradeEnabled = (save: SaveData, id: string): boolean => save.campaign.upgrades.enabled.includes(id) && isUpgradeOwned(save, id);

export type UpgradePurchase = { ok: true; upgrade: UpgradeDef; spent: number; balance: number } | { ok: false; reason: 'unknown' | 'locked' | 'owned' | 'insufficient' };

/** Achat en Éclats de campagne : vérification, débit et possession dans la même modification ; l'amélioration est activée à l'achat. */
export function buyUpgrade(save: SaveData, id: string): UpgradePurchase {
  const u = upgradeById(id);
  if (!u) return { ok: false, reason: 'unknown' };
  if (isUpgradeOwned(save, id)) return { ok: false, reason: 'owned' };
  if (!isUpgradeVisible(save, u)) return { ok: false, reason: 'locked' };
  if (save.campaign.reserve < u.price) return { ok: false, reason: 'insufficient' };
  save.campaign.reserve -= u.price;
  save.campaign.upgrades.owned.push(id);
  save.campaign.upgrades.enabled.push(id);
  return { ok: true, upgrade: u, spent: u.price, balance: save.campaign.reserve };
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

/** Améliorations appliquées en campagne : possédées ET activées, hangar ouvert. Jamais passées aux autres modes. */
export function activeUpgrades(save: SaveData): ActiveUpgrades {
  const on = (id: string): boolean => HANGAR_ENABLED && isUpgradeEnabled(save, id);
  return { shield: on('shield'), collector: on('collector'), stabilizer: on('stabilizer') };
}

export const upgradeList = (save: SaveData): { upgrade: UpgradeDef; visible: boolean; owned: boolean; enabled: boolean }[] =>
  UPGRADES.map((u) => ({ upgrade: u, visible: isUpgradeVisible(save, u), owned: isUpgradeOwned(save, u.id), enabled: isUpgradeEnabled(save, u.id) }));
