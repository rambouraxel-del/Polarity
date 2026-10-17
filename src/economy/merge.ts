import { MISSIONS, missionKey } from '../config/campaign';
import { DEFAULT_SKIN_ID } from '../config/skins';
import { DEFAULT_TRAIL_ID } from '../config/trails';
import { beatsRecord } from '../progression/progress';
import { isOwned } from '../progression/shop';
import { defaultCampaign, type ArchivedRecords, type CampaignSave, type LevelRecord, type MissionRecord, type RunRecord, type SaveData } from '../save/save';

/**
 * Fusion de deux sauvegardes (synchronisation entre appareils, fusion de deux profils) — fonction PURE, sans effet de bord, partagée par le jeu et le service.
 * `a` est la sauvegarde « principale » : ses options, son apparence équipée, son portefeuille, son bloc économie et sa version sont conservés.
 *
 * Règles (idempotentes, commutatives sur les contenus, jamais de perte) :
 * - ensembles (succès, cosmétiques, récompenses versées, scènes, introductions) : UNION ; date de déblocage d'un succès : la plus ancienne ;
 * - records et niveaux : le MEILLEUR (temps d'abord, score en départage) ; étoiles : maximum ; « terminé » : OU logique ;
 * - compteurs cumulés (statistiques) : MAXIMUM — additionner compterait deux fois une partie commune à deux appareils ;
 * - campagne : missions par union (étoiles = OU), réserve d'Éclats de campagne = MAXIMUM, SÉPARÉE de tout le reste ;
 * - Médailles réclamées : UNION (un succès ne rapporte qu'une fois) ; inventaire de bonus et soldes : NON fusionnés ici
 * - monnaies : NON fusionnées ici (le registre du serveur s'en charge, clé par clé, sans double crédit).
 * Les records de la sauvegarde sont des déclarations locales : seuls les records du CLASSEMENT (rejeu serveur) sont « vérifiés ».
 */
const union = (x: readonly string[], y: readonly string[], max = 200): string[] => [...new Set([...x, ...y])].slice(0, max);

function betterRun(x: RunRecord, y: RunRecord): RunRecord {
  const best = beatsRecord(y.bestTime, y.bestScore, x.bestTime, x.bestScore) ? y : x;
  return { bestTime: best.bestTime, bestScore: best.bestScore, runs: Math.max(x.runs, y.runs) };
}

function mergeDaily(x: Record<string, RunRecord>, y: Record<string, RunRecord>): Record<string, RunRecord> {
  const out: Record<string, RunRecord> = {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) out[k] = x[k] && y[k] ? betterRun(x[k], y[k]) : { ...(x[k] ?? y[k]) };
  return out;
}

function mergeArchive(x: Record<string, ArchivedRecords>, y: Record<string, ArchivedRecords>): Record<string, ArchivedRecords> {
  const out: Record<string, ArchivedRecords> = {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[k];
    const q = y[k];
    out[k] = p && q ? { survival: betterRun(p.survival, q.survival), daily: mergeDaily(p.daily, q.daily) } : structuredClone((p ?? q) as ArchivedRecords);
  }
  return out;
}

function mergeLevels(x: Record<string, LevelRecord>, y: Record<string, LevelRecord>): Record<string, LevelRecord> {
  const out: Record<string, LevelRecord> = {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[k];
    const q = y[k];
    out[k] = { completed: !!(p?.completed || q?.completed), bestScore: Math.max(p?.bestScore ?? 0, q?.bestScore ?? 0), stars: Math.max(p?.stars ?? 0, q?.stars ?? 0) };
  }
  return out;
}

function mergeCampaign(x: CampaignSave, y: CampaignSave): CampaignSave {
  const out = defaultCampaign();
  for (const k of new Set([...Object.keys(x.missions), ...Object.keys(y.missions)])) {
    const p: MissionRecord | undefined = x.missions[k];
    const q: MissionRecord | undefined = y.missions[k];
    const main = !!(p?.main || q?.main);
    const times = [p?.bestTime ?? 0, q?.bestTime ?? 0].filter((t) => t > 0);
    out.missions[k] = { main, challenge: main && !!(p?.challenge || q?.challenge), clears: Math.max(p?.clears ?? 0, q?.clears ?? 0), bestTime: times.length > 0 ? Math.min(...times) : 0 };
  }
  out.seen = union(x.seen, y.seen, 100);
  out.reserve = Math.max(x.reserve, y.reserve);
  out.upgrades = { owned: union(x.upgrades.owned, y.upgrades.owned), enabled: union(x.upgrades.enabled, y.upgrades.enabled).filter((id) => union(x.upgrades.owned, y.upgrades.owned).includes(id)) };
  out.chapterComplete = MISSIONS.every((m) => out.missions[missionKey(m.id)]?.main === true);
  return out;
}

export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  const out: SaveData = structuredClone(a);
  out.levels = mergeLevels(a.levels, b.levels);
  out.survival = betterRun(a.survival, b.survival);
  out.survivalBonus = betterRun(a.survivalBonus, b.survivalBonus);
  out.daily = mergeDaily(a.daily, b.daily);
  out.archive = mergeArchive(a.archive, b.archive);
  out.achievements = {};
  for (const k of new Set([...Object.keys(a.achievements), ...Object.keys(b.achievements)])) {
    const ts = [a.achievements[k], b.achievements[k]].filter((t): t is number => typeof t === 'number');
    out.achievements[k] = Math.min(...ts);
  }
  out.rewarded = union(a.rewarded, b.rewarded);
  // Médailles réclamées : union (la réclamation d'un succès n'est comptée qu'une fois ; le service fait foi pour les soldes)
  out.medals = { claimed: union(a.medals.claimed, b.medals.claimed) };
  out.owned = union(a.owned, b.owned);
  out.paid = {};
  for (const k of new Set([...Object.keys(a.paid), ...Object.keys(b.paid)])) {
    out.paid[k] = { first: !!(a.paid[k]?.first || b.paid[k]?.first), stars: Math.max(a.paid[k]?.stars ?? 0, b.paid[k]?.stars ?? 0) };
  }
  out.seenIntros = union(a.seenIntros, b.seenIntros, 20);
  out.stats = {
    totalCycles: Math.max(a.stats.totalCycles, b.stats.totalCycles),
    totalRuns: Math.max(a.stats.totalRuns, b.stats.totalRuns),
    totalShards: Math.max(a.stats.totalShards, b.stats.totalShards),
    totalEvents: Math.max(a.stats.totalEvents, b.stats.totalEvents),
    bestScore: Math.max(a.stats.bestScore, b.stats.bestScore),
    bestMultiplier: Math.max(a.stats.bestMultiplier, b.stats.bestMultiplier),
  };
  out.campaign = mergeCampaign(a.campaign, b.campaign);
  out.balanceNoticeSeen = Math.max(a.balanceNoticeSeen, b.balanceNoticeSeen);
  // Apparence et traînée : celles de `a`, sinon retour aux valeurs par défaut si elles ne sont pas possédées (jamais d'équipement non possédé)
  if (!isOwned(out, out.skin)) out.skin = DEFAULT_SKIN_ID;
  if (!isOwned(out, out.trail)) out.trail = DEFAULT_TRAIL_ID;
  return out;
}
