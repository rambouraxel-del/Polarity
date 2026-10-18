import { AD_MAX_AGE_MS, REWARDED_PLACEMENT } from '../config/ads';
import { nativePlatform } from '../platform/native';
import { registerNativePlugin } from '../platform/plugins';

/**
 * Publicité récompensée (deuxième chance) — côté JEU.
 *
 * - Désactivée par défaut : aucun SDK n'est chargé par le code web, aucune requête, aucune publicité simulée.
 * - Un fournisseur réel s'active seulement par le plugin natif `PolarRiftAds` (AdMob + consentement UMP : plugins/polar-rift-ads), présent dans l'application
 *   native Android / iOS ; le SDK publicitaire n'existe que dans ces applications.
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
  /** Les options de confidentialité (UMP) doivent-elles être proposées dans les réglages ? */
  privacyOptionsRequired?(): boolean;
  /** Rouvre les options de confidentialité ; invalide la publicité préchargée et réévalue les possibilités. */
  showPrivacyOptions?(): Promise<void>;
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

/** État du consentement (UMP) tel que la plateforme le rapporte. `canRequestAds` est la SEULE autorité pour charger ou afficher une publicité. */
export interface ConsentState {
  canRequestAds: boolean;
  /** Un point d'entrée « options de confidentialité » doit être proposé au joueur (exigence UMP). */
  privacyOptionsRequired: boolean;
  status: 'unknown' | 'required' | 'not_required' | 'obtained';
}

/**
 * Contrat du plugin natif `PolarRiftAds` (plugins/polar-rift-ads : Android Java, iOS Swift ; AdMob + UMP). Côté natif, chaque `load` et chaque `show`
 * recontrôlent `canRequestAds` ; chaque appel est résolu UNE seule fois.
 */
export interface AdsPlugin {
  /** Actualise le consentement (UMP) et affiche le formulaire si la plateforme l'exige. Une demande à la fois (les appels simultanés partagent le résultat). */
  requestConsent(): Promise<ConsentState>;
  /** État courant du consentement, sans formulaire. */
  getConsentState(): Promise<ConsentState>;
  /** Rouvre les options de confidentialité (formulaire UMP) ; renvoie le nouvel état. La publicité préchargée est invalidée côté natif. */
  showPrivacyOptions(): Promise<ConsentState>;
  /** Charge une publicité récompensée (seulement si le consentement le permet). */
  load(o: { placement: string }): Promise<{ ready: boolean; reason?: string }>;
  /**
   * Affiche la publicité APRÈS avoir transmis `userId` et `customData` à la régie (vérification serveur à serveur) ; la promesse est résolue à la
   * fermeture : `rewarded` = récompense gagnée puis publicité fermée ; `dismissed` = fermée avant la récompense ; `failed` = absente ou en échec.
   */
  show(o: { placement: string; userId: string; customData: string }): Promise<{ result: 'rewarded' | 'dismissed' | 'failed'; reason?: string }>;
}

export class NativeAdProvider implements RewardedAdProvider {
  readonly name = 'natif';
  readonly kind = 'native' as const;
  private ready = false;
  private loadedAt = 0;
  private consent: ConsentState | null = null;
  /** Le formulaire de consentement n'est demandé qu'une fois par lancement ; ensuite on ne lit que l'état. */
  private consentAsked = false;
  /** Incrémenté à chaque changement de choix de confidentialité : un chargement commencé avant est abandonné. */
  private generation = 0;
  private flight: Promise<void> | null = null;
  private showing = false;

  constructor(
    private readonly plugin: AdsPlugin,
    private readonly placement: string = REWARDED_PLACEMENT,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isAvailable(): boolean {
    return this.ready && !this.showing && this.consent?.canRequestAds === true && this.now() - this.loadedAt < AD_MAX_AGE_MS;
  }

  /** Les options de confidentialité doivent-elles être proposées ? (selon l'état UMP le plus récent) */
  privacyOptionsRequired(): boolean {
    return this.consent?.privacyOptionsRequired === true;
  }

  /**
   * Consentement puis préchargement. Une seule exécution à la fois (appels simultanés = même promesse) ; jamais de boucle : le formulaire n'est
   * demandé qu'au premier appel du lancement, les suivants relisent l'état puis rechargent.
   */
  refresh(): Promise<void> {
    if (this.showing) return Promise.resolve();
    if (!this.flight) {
      const g = this.generation;
      this.flight = this.runRefresh(g).finally(() => {
        this.flight = null;
      });
    }
    return this.flight;
  }

  private async runRefresh(g: number): Promise<void> {
    this.ready = false;
    try {
      let state: ConsentState;
      if (!this.consentAsked) {
        this.consentAsked = true;
        state = await this.plugin.requestConsent();
      } else {
        state = await this.plugin.getConsentState();
      }
      if (g !== this.generation) return; // un changement de choix est arrivé entre-temps : sa propre réévaluation prend le relais
      this.consent = state;
      if (!state.canRequestAds) return;
      const r = await this.plugin.load({ placement: this.placement });
      if (g !== this.generation) return;
      this.ready = r.ready === true;
      this.loadedAt = this.now();
    } catch {
      this.ready = false;
    }
  }

  async showPrivacyOptions(): Promise<void> {
    if (this.showing) return;
    // La publicité préchargée a été demandée avec l'ancien choix : on l'oublie, puis on réévalue
    this.generation++;
    this.ready = false;
    try {
      this.consent = await this.plugin.showPrivacyOptions();
    } catch {
      /* formulaire indisponible : on réévalue l'état tel quel ci-dessous */
    }
    this.flight = null;
    await this.refresh();
  }

  async showRewarded(placement: string, ctx?: AdContext): Promise<RewardedResult> {
    if (this.showing || !ctx || !this.isAvailable()) return 'unavailable';
    this.showing = true;
    this.ready = false; // une publicité = une seule projection ; on en recharge une autre après
    try {
      // Recontrôle juste avant l'affichage : jamais de décision fondée sur un booléen local ancien
      const state = await this.plugin.getConsentState();
      this.consent = state;
      if (!state.canRequestAds) return 'unavailable';
      const r = await this.plugin.show({ placement, userId: ctx.userId, customData: ctx.customData });
      return r.result === 'rewarded' ? 'rewarded' : r.result === 'dismissed' ? 'dismissed' : 'unavailable';
    } catch {
      return 'unavailable';
    } finally {
      this.showing = false;
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

/**
 * Branche le plugin natif de publicité s'il existe (application Android / iOS embarquant `PolarRiftAds`) ; sans plugin, rien ne change. Le consentement
 * et le préchargement se font en arrière-plan : le démarrage du jeu n'attend jamais le formulaire.
 */
export async function initNativeAds(): Promise<boolean> {
  if (!nativePlatform()) return false;
  const handle = await registerNativePlugin<AdsPlugin>('PolarRiftAds');
  if (!handle) return false;
  const p = new NativeAdProvider(handle.plugin);
  setAdProvider(p);
  void p.refresh();
  return true;
}
