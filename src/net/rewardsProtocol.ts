/** Protocole des récompenses gratuites (phase 4) : types partagés jeu ↔ service. Voir docs/ETAT_MAJ_ECONOMIE.md. */
import type { LoyaltyReward } from '../config/rewards';

// ————————————————————————— calendrier de connexion

export interface LoyaltyDay {
  /** 1 à 10. */
  day: number;
  reward: LoyaltyReward;
  /** Jour validé par une connexion (présence établie par le service). */
  unlocked: boolean;
  claimed: boolean;
}

export interface LoyaltyCycleView {
  /** Identifiant global du cycle (clé des récompenses : `loy:<cycle>:<jour>`). */
  id: number;
  days: LoyaltyDay[];
  /** Cycle en cours (progression active) ; les anciens cycles ne servent qu'à récupérer ce qui a été débloqué. */
  current: boolean;
  /** Absences déjà utilisées dans ce cycle (une seule tolérée). */
  absences: number;
  /** Cycle terminé (10 jours) : le suivant démarre au prochain jour UTC. */
  complete: boolean;
}

export interface LoyaltyState {
  /** Jour UTC du service (AAAA-MM-JJ) : seule référence ; l'horloge de l'appareil n'est jamais crue. */
  today: string;
  /** Prochain changement de jour UTC (ms Unix) : compte à rebours. */
  nextDayAt: number;
  /** Présence d'aujourd'hui validée par le service. */
  presentToday: boolean;
  /** Cycle courant d'abord, puis les anciens cycles qui ont encore des récompenses à récupérer. */
  cycles: LoyaltyCycleView[];
  /** Absences encore tolérées dans le cycle courant (0 ou 1 ; null si le cycle est terminé). */
  absencesLeft: number | null;
  /** Nombre de récompenses débloquées et non récupérées (toutes cycles confondus). */
  claimable: number;
  /** Récompense de Prismes réservée aux profils avec pseudo ou compte (jamais aux invités) : vrai si le profil actuel peut la récupérer. */
  canClaimPrisms: boolean;
  /** Stock de bonus plein (99) : une récompense Boost/Gel ne peut pas être récupérée tant qu'il n'y a pas de place. */
  stock: { boost: number; gel: number; max: number };
}

export interface LoyaltyClaimResponse {
  cycle: number;
  day: number;
  reward: LoyaltyReward;
  /** Faux : récompense déjà récupérée (requête rejouée), rien de plus n'est crédité. */
  credited: boolean;
  balance: { shards: number; medals: number; prisms: number };
  inventory: { boost: number; gel: number };
  state: LoyaltyState;
}

export type LoyaltyClaimError = 'bad_request' | 'locked' | 'stock_full' | 'account_required' | 'rate_limited';

// ————————————————————————— défi quotidien mondial

export type DailyStatus = 'open' | 'grace' | 'final';

export interface DailyAttempt {
  id: string;
  date: string;
  /** Début de la tentative enregistré par le SERVICE (ms Unix). */
  startedAt: number;
}

export interface DailyRunSubmission {
  attemptId: string;
  date: string;
  replay: { v: 1; flips: number[] };
  /** Annoncé par le jeu : jamais utilisé, seulement comparé au rejeu. */
  claimed: { time: number; score: number };
  client: { build: string };
}

export type DailyRejectReason = 'bad_attempt' | 'attempt_used' | 'closed' | 'late_unproven' | 'too_fast' | 'bad_replay' | 'not_finished' | 'inputs_after_end' | 'divergence' | 'rate_limited' | 'excluded';

export type DailyRunResponse =
  | { status: 'accepted'; date: string; time: number; score: number; rank: number; personalBest: boolean; late: boolean; state: DailyStatus; /** Faux pour un profil invité : le résultat est enregistré mais n'apparaît ni au classement public ni aux récompenses (choisir un pseudo). */ eligible: boolean }
  | { status: 'rejected'; reason: DailyRejectReason; message: string };

export interface DailyEntry {
  /** Rang « compétition » : les ex æquo (durée ET score identiques) partagent le même rang, le suivant saute. */
  rank: number;
  nickname: string;
  time: number;
  score: number;
  /** Prismes du rang (provisoire tant que la journée n'est pas définitive). */
  prisms: number;
  you?: boolean;
}

export interface DailyBoard {
  date: string;
  status: DailyStatus;
  /** Fin du défi (00 h 00 UTC) et fin des soumissions tardives (00 h 15 UTC), ms Unix. */
  endsAt: number;
  finalAt: number;
  entries: DailyEntry[];
  /** Joueurs classés (avec pseudo). */
  total: number;
  /** Record du joueur authentifié ce jour-là (même s'il est hors du Top affiché), null s'il n'a pas joué ou n'est pas éligible. */
  me: { rank: number; time: number; score: number; prisms: number; eligible: boolean } | null;
}

export interface DailyNotice {
  date: string;
  rank: number;
  prisms: number;
  time: number;
  score: number;
}

export interface DailyNoticesResponse {
  notices: DailyNotice[];
}
