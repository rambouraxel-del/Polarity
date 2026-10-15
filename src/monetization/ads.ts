import { nativePlugin } from '../platform/plugins';
import { nativePlatform } from '../platform/native';

/**
 * Publicité récompensée (deuxième chance) — côté JEU.
 *
 * - Désactivée par défaut : aucun SDK n'est chargé par le code web, aucune requête, aucune publicité simulée.
 * - Un fournisseur réel s'active seulement par le plugin natif `PolarRiftAds` (AdMob + consentement UMP), présent dans l'application native.
 * - La récompense n'est JAMAIS accordée sur la seule foi du plugin : le service la confirme de serveur à serveur (SSV AdMob) et la consomme une seule
 *   fois (`POST /api/ads/session` → publicité → `POST /api/ads/claim`). Publicité interrompue, fermée, échouée ou non confirmée : aucune reprise.
 * - Jamais de publicité imposée : seulement après un choix explicite du joueur, à la première mort d'une partie de Survie. Voir docs/MONETISATION.md.
 */
export type RewardedResult = 'rewarded' | 'dismissed' | 'unavailable';

/** Identifiants de la session du service, transmis à la régie pour la vérification serveur à serveur (SSV). */
export interface AdContext {
  userId: string;
  customData: string;
}

export interface RewardedAdProvider {
  readonly name: string;
  /** `none` : aucun fournisseur (option affichée « indisponible » avec explication) ; `native` : plugin présent. */
  readonly kind?: 'none' | 'native';
  /** Une publicité récompensée est-elle prête MAINTENANT ? */
  isAvailable(): boolean;
  showRewarded(placement: string, ctx?: AdContext): Promise<RewardedResult>;
  /** Précharge une publicité (et demande le consentement si nécessaire). */
  refresh?(): Promise<void>;
}

/** Fournisseur par défaut : ne fait rien. */
export class NoAdProvider implements RewardedAdProvider {
  readonly name = 'aucun';
  readonly kind = 'none' as const;
  isAvailable(): boolean {
    return false;
  }
  async showRewarded(): Promise<RewardedResult> {
    return 'unavailable';
  }
}

/** Contrat du plugin natif `PolarRiftAds` (à implémenter côté application ; voir docs/MONETISATION.md). */
export interface AdsPlugin {
  /** Formulaire de consentement de la plateforme (UMP / ATT) : `canRequestAds` faux = aucune publicité. */
  requestConsent(): Promise<{ canRequestAds: boolean }>;
  /** Charge une publicité récompensée pour l'emplacement donné. */
  load(o: { placement: string }): Promise<{ ready: boolean }>;
  /** Affiche la publicité avec les options de vérification serveur à serveur ; `rewarded` = la régie a validé le visionnage côté appareil. */
  show(o: { placement: string; userId: string; customData: string }): Promise<{ result: 'rewarded' | 'dismissed' | 'failed' }>;
}

export class NativeAdProvider implements RewardedAdProvider {
  readonly name = 'natif';
  readonly kind = 'native' as const;
  private ready = false;

  constructor(private readonly plugin: AdsPlugin, private readonly placement = 'revive') {}

  isAvailable(): boolean {
    return this.ready;
  }

  async refresh(): Promise<void> {
    try {
      const c = await this.plugin.requestConsent();
      if (!c.canRequestAds) {
        this.ready = false;
        return;
      }
      this.ready = (await this.plugin.load({ placement: this.placement })).ready === true;
    } catch {
      this.ready = false;
    }
  }

  async showRewarded(placement: string, ctx?: AdContext): Promise<RewardedResult> {
    if (!this.ready || !ctx) return 'unavailable';
    this.ready = false; // une publicité = une seule projection ; on en recharge une autre après
    try {
      const r = await this.plugin.show({ placement, userId: ctx.userId, customData: ctx.customData });
      return r.result === 'rewarded' ? 'rewarded' : r.result === 'dismissed' ? 'dismissed' : 'unavailable';
    } catch {
      return 'unavailable';
    } finally {
      void this.refresh();
    }
  }
}

let provider: RewardedAdProvider = new NoAdProvider();

export function getAdProvider(): RewardedAdProvider {
  return provider;
}

/** Point d'extension : plugin natif au démarrage, et tests. */
export function setAdProvider(p: RewardedAdProvider): void {
  provider = p;
}

/** Branche le plugin natif de publicité s'il existe ; sans plugin, rien ne change. */
export async function initNativeAds(): Promise<boolean> {
  const plugin = nativePlugin<AdsPlugin>('PolarRiftAds');
  if (!nativePlatform() || !plugin) return false;
  const p = new NativeAdProvider(plugin);
  setAdProvider(p);
  await p.refresh();
  return true;
}
