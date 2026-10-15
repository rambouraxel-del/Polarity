/**
 * Accès aux plugins natifs Capacitor SPÉCIFIQUES au jeu (facturation intégrée, publicité récompensée). Ces plugins ne sont PAS fournis par ce dépôt :
 * ils doivent être ajoutés à l'application native (voir docs/MONETISATION.md) ; sans eux (web, ou application sans le plugin), l'accès renvoie null et
 * la fonction concernée reste DÉSACTIVÉE. Aucun SDK n'est chargé par le code web.
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
