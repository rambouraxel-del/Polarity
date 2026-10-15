import type { ProviderId, ProvidersResponse } from '../net/accountProtocol';
import { nativePlatform } from '../platform/native';

/**
 * Méthodes de connexion côté jeu : interfaces RÉELLES pour le web (Google Identity Services, Sign in with Apple JS) et pour Capacitor (plugin de connexion
 * sociale, s'il est installé). Chaque méthode n'est proposée que si le SERVICE l'a configurée (`GET /api/auth/providers`) ET si l'environnement peut
 * l'exécuter ; sinon elle reste désactivée avec une raison lisible — jamais de fausse connexion.
 * Aucun secret n'est présent ici : seuls des identifiants clients publics (fournis par le service) sont utilisés.
 * Les scripts des fournisseurs ne sont chargés qu'à la demande (jamais au démarrage du jeu), après un clic du joueur.
 */
export interface Availability {
  provider: ProviderId;
  available: boolean;
  /** Raison affichée quand la méthode n'est pas disponible. */
  reason: string | null;
  /** Mode d'exécution : navigateur ou module natif. */
  via: 'web' | 'native' | 'none';
}

export interface IdTokenResult {
  idToken: string;
}

/** Forme minimale du plugin de connexion sociale Capacitor (ex. @capgo/capacitor-social-login), si l'application l'embarque. */
interface SocialLoginPlugin {
  initialize(opts: Record<string, unknown>): Promise<void>;
  login(opts: { provider: 'google' | 'apple'; options?: Record<string, unknown> }): Promise<{ result?: { idToken?: string | null } }>;
}

type GlobalWithPlugins = { Capacitor?: { Plugins?: { SocialLogin?: SocialLoginPlugin } } };

export function nativeSocialLogin(root: GlobalWithPlugins = globalThis as GlobalWithPlugins): SocialLoginPlugin | null {
  return root.Capacitor?.Plugins?.SocialLogin ?? null;
}

/** Disponibilité de chaque méthode, d'après la configuration du service et l'environnement d'exécution. */
export function availability(cfg: ProvidersResponse | null, env: { native: boolean; plugin: boolean; online: boolean } = { native: nativePlatform() !== null, plugin: nativeSocialLogin() !== null, online: true }): Availability[] {
  const off = (provider: ProviderId, reason: string): Availability => ({ provider, available: false, reason, via: 'none' });
  if (!cfg) return (['google', 'apple', 'email'] as ProviderId[]).map((p) => off(p, env.online ? 'Service de comptes indisponible.' : 'Hors connexion.'));
  const social = (provider: 'google' | 'apple', label: string): Availability => {
    const c = cfg[provider];
    if (!c.enabled || !c.clientId) return off(provider, `${label} n’est pas configuré sur le service.`);
    if (env.native) {
      return env.plugin ? { provider, available: true, reason: null, via: 'native' } : off(provider, `${label} : module de connexion natif non inclus dans cette version de l’application.`);
    }
    return { provider, available: true, reason: null, via: 'web' };
  };
  return [social('google', 'Google'), social('apple', 'Apple'), cfg.email.enabled ? { provider: 'email', available: true, reason: null, via: 'web' } : off('email', 'La connexion par courriel n’est pas configurée sur le service.')];
}

// ————————————————————————— chargement à la demande des scripts des fournisseurs (web)

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const cached = scripts.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scripts.delete(src);
      reject(new Error('Script du fournisseur injoignable (hors connexion ou bloqué).'));
    };
    document.head.appendChild(el);
  });
  scripts.set(src, p);
  return p;
}

interface GoogleId {
  accounts: { id: { initialize(o: Record<string, unknown>): void; renderButton(el: HTMLElement, o: Record<string, unknown>): void } };
}
interface AppleId {
  auth: { init(o: Record<string, unknown>): void; signIn(): Promise<{ authorization?: { id_token?: string } }> };
}
type W = { google?: GoogleId; AppleID?: AppleId };

/**
 * Google (navigateur) : affiche le bouton officiel « Se connecter avec Google » dans `container` ; le jeton d'identité est renvoyé à `onToken`.
 * Le nonce (délivré par le service) est inclus dans le jeton : il rend la demande à usage unique.
 */
export async function mountGoogleButton(container: HTMLElement, clientId: string, nonce: string, onToken: (r: IdTokenResult) => void): Promise<void> {
  await loadScript('https://accounts.google.com/gsi/client');
  const g = (globalThis as unknown as W).google;
  if (!g) throw new Error('Google indisponible.');
  g.accounts.id.initialize({ client_id: clientId, nonce, callback: (r: { credential?: string }) => r.credential && onToken({ idToken: r.credential }), ux_mode: 'popup', auto_select: false });
  container.replaceChildren();
  g.accounts.id.renderButton(container, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', locale: 'fr' });
}

/** Apple (navigateur) : fenêtre « Se connecter avec Apple » ; renvoie le jeton d'identité. */
export async function signInWithAppleWeb(clientId: string, nonce: string): Promise<IdTokenResult> {
  await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js');
  const a = (globalThis as unknown as W).AppleID;
  if (!a) throw new Error('Apple indisponible.');
  a.auth.init({ clientId, scope: 'email', redirectURI: `${location.origin}${location.pathname}`, state: 'polar-rift', nonce, usePopup: true });
  const res = await a.auth.signIn();
  const idToken = res.authorization?.id_token;
  if (!idToken) throw new Error('Connexion Apple annulée.');
  return { idToken };
}

/** Application native : connexion par le module Capacitor (installé séparément ; voir docs/COMPTES.md). */
export async function signInNative(provider: 'google' | 'apple', cfg: ProvidersResponse, nonce: string): Promise<IdTokenResult> {
  const plugin = nativeSocialLogin();
  if (!plugin) throw new Error('Module de connexion natif non inclus dans cette version.');
  await plugin.initialize({ google: cfg.google.clientId ? { webClientId: cfg.google.clientId } : undefined, apple: {} });
  const r = await plugin.login({ provider, options: { nonce } });
  const idToken = r.result?.idToken;
  if (!idToken) throw new Error('Connexion annulée.');
  return { idToken };
}
