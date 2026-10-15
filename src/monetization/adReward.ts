import type { NetResult } from '../net/leaderboard';
import type { RewardedAdProvider } from './ads';

/**
 * Seconde chance par publicité récompensée : déroulé complet, testable sans navigateur.
 * 1. le SERVICE crée une session (profil + partie + vie 2, usage unique) ; 2. la régie affiche la publicité avec les identifiants de cette session ;
 * 3. la régie confirme de serveur à serveur ; 4. le jeu réclame : le service CONSOMME la confirmation (une seule fois) → reprise accordée.
 * Publicité interrompue, fermée, échouée, non confirmée ou déjà utilisée : AUCUNE reprise. Aucune minuterie ne se substitue à la confirmation du service.
 */
export type AdReviveResult = { ok: true } | { ok: false; reason: 'unavailable' | 'dismissed' | 'failed' | 'unconfirmed' | 'used' | 'offline' | 'error'; message: string };

export interface AdReviveHost {
  api<T>(method: string, path: string, opts?: { body?: unknown; auth?: boolean }): Promise<NetResult<T>>;
  provider: RewardedAdProvider;
  runId: string;
  /** Appelé au retour de la publicité (reprise de l'audio, de l'affichage). */
  onReturn?: () => void;
  sleep?: (ms: number) => Promise<void>;
  /** Essais de réclamation et délai (la confirmation de la régie arrive de serveur à serveur, quelques secondes au plus). */
  tries?: number;
  delayMs?: number;
}

export async function reviveWithAd(h: AdReviveHost): Promise<AdReviveResult> {
  if (!h.provider.isAvailable()) return { ok: false, reason: 'unavailable', message: 'Publicité indisponible pour le moment : aucune reprise.' };
  const sess = await h.api<{ sessionId: string; userId: string; customData: string }>('POST', '/api/ads/session', { auth: true, body: { runId: h.runId, life: 2 } });
  if (!sess.ok) {
    if (sess.kind === 'offline') return { ok: false, reason: 'offline', message: 'Connexion requise pour la publicité récompensée.' };
    if (sess.status === 409) return { ok: false, reason: 'used', message: 'La reprise par publicité de cette partie a déjà été utilisée.' };
    return { ok: false, reason: 'error', message: sess.message };
  }
  const shown = await h.provider.showRewarded('revive', { userId: sess.data.userId, customData: sess.data.customData });
  h.onReturn?.();
  if (shown === 'dismissed') return { ok: false, reason: 'dismissed', message: 'Publicité interrompue : la reprise n’est pas accordée.' };
  if (shown !== 'rewarded') return { ok: false, reason: 'failed', message: 'Publicité indisponible pour le moment : aucune reprise.' };
  const sleep = h.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tries = h.tries ?? 8;
  for (let i = 0; i < tries; i++) {
    const c = await h.api<{ status: string }>('POST', '/api/ads/claim', { auth: true, body: { sessionId: sess.data.sessionId } });
    if (c.ok && c.data.status === 'granted') return { ok: true };
    // 202 « pas encore confirmée », coupure réseau ou limite de débit : on réessaie ; tout autre refus est définitif
    if (!c.ok && c.kind === 'http' && c.status !== 429) return { ok: false, reason: c.status === 409 ? 'used' : 'unconfirmed', message: c.status === 409 ? 'Cette confirmation a déjà servi.' : 'Récompense non confirmée par le service : aucune reprise.' };
    if (i < tries - 1) await sleep(h.delayMs ?? 1500);
  }
  return { ok: false, reason: 'unconfirmed', message: 'Récompense non confirmée par le service : aucune reprise. Vous pouvez terminer la partie ou payer la reprise en Prismes.' };
}
