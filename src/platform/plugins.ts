/**
 * Accès aux plugins natifs Capacitor SPÉCIFIQUES au jeu.
 * - Publicité récompensée : plugin local `PolarRiftAds` (plugins/polar-rift-ads : AdMob + UMP, Android et iOS), obtenu par `registerNativePlugin`
 *   (vrai mécanisme Capacitor : `registerPlugin` + `isPluginAvailable`).
 * - Facturation intégrée : `nativePlugin` (contrat d'origine, inchangé ; plugin non fourni par ce dépôt, voir docs/MONETISATION.md).
 * Sans plugin (web, PWA, application sans le plugin) l'accès renvoie null et la fonction concernée reste DÉSACTIVÉE. Le code web ne charge aucun SDK.
 */
interface CapacitorLike {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
}

export function nativePlugin<T>(name: string, root: { Capacitor?: CapacitorLike } = globalThis as { Capacitor?: CapacitorLike }): T | null {
  const cap = root.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable(name)) return null;
  return (cap.Plugins?.[name] as T | undefined) ?? null;
}

/** Partie de `@capacitor/core` utilisée ici (injectable dans les tests). */
export interface CapacitorCore {
  Capacitor: { isNativePlatform(): boolean; isPluginAvailable(name: string): boolean };
  registerPlugin<T>(name: string): T;
}

/**
 * Le proxy renvoyé par `registerPlugin` répond à TOUTE propriété (y compris `then`) par un appel natif : il ne doit donc JAMAIS être renvoyé tel quel par
 * une fonction `async` (la promesse l'attendrait indéfiniment comme un « thenable »). On l'enveloppe dans un objet.
 */
export interface NativePluginHandle<T> {
  plugin: T;
}

const registered = new Map<string, unknown>();

/**
 * Plugin natif enregistré auprès de Capacitor, ou null (web, plateforme non native, plugin absent de l'application). `@capacitor/core` est importé
 * dynamiquement : rien n'est chargé sur le web. Un plugin n'est enregistré qu'une fois (Capacitor refuse les doublons).
 */
export async function registerNativePlugin<T>(name: string, loadCore: () => Promise<CapacitorCore> = () => import('@capacitor/core') as unknown as Promise<CapacitorCore>): Promise<NativePluginHandle<T> | null> {
  try {
    const core = await loadCore();
    if (!core.Capacitor.isNativePlatform() || !core.Capacitor.isPluginAvailable(name)) return null;
    if (!registered.has(name)) registered.set(name, core.registerPlugin<T>(name));
    return { plugin: registered.get(name) as T };
  } catch {
    return null;
  }
}

/** Tests : oublie les plugins déjà enregistrés. */
export function resetRegisteredPlugins(): void {
  registered.clear();
}
