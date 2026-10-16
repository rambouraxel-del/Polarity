import { sha256Hex } from './sha256';

/**
 * Mode développeur : verrou d'accès à l'INTERFACE de test (vaisseau immortel pour explorer les phases de la Survie), rien de plus.
 * Le mot de passe n'a aucun lien avec les secrets du service (jamais envoyé, jamais comparé côté serveur) : il empêche seulement d'activer le mode par
 * mégarde. Il est conservé sous forme de condensat salé (`sel$condensat`) dans les options ; la valeur vide désigne le mot de passe d'origine.
 * Toute partie lancée avec le mode actif est une partie de TEST pour toujours (`RunConfig.test`) : ni classement, ni record, ni gain, ni succès, ni
 * cosmétique, et jamais envoyée au service comme partie normale.
 */
export interface DevModeOptions {
  enabled: boolean;
  /** Verrou personnalisé (`sel$condensat`) ou '' = mot de passe d'origine. */
  lock: string;
}

export const DEV_PASSWORD_MIN = 8;
export const DEV_PASSWORD_MAX = 64;
/** Verrou du mot de passe d'origine (sel fixe, condensat SHA-256 de « sel:mot de passe »). */
export const DEFAULT_DEV_LOCK = 'polarite-dev-v1$e3b38994560691bf275c362fe2050cd3930815199417cba3d01fdbe57e341a96';
const LOCK_FORMAT = /^[A-Za-z0-9-]{1,40}\$[0-9a-f]{64}$/;

export const defaultDevOptions = (): DevModeOptions => ({ enabled: false, lock: '' });

/** Validation champ par champ (sauvegarde) : un verrou illisible redevient le mot de passe d'origine, le mode reste désactivé par défaut. */
export function sanitizeDevOptions(raw: unknown): DevModeOptions {
  const out = defaultDevOptions();
  if (typeof raw !== 'object' || raw === null) return out;
  const o = raw as Record<string, unknown>;
  out.enabled = o.enabled === true;
  if (typeof o.lock === 'string' && LOCK_FORMAT.test(o.lock)) out.lock = o.lock;
  return out;
}

export function makeLock(password: string, salt: string): string {
  return `${salt}$${sha256Hex(`${salt}:${password}`)}`;
}

/** Sel aléatoire (décoratif pour la sécurité : verrou d'interface). */
export function randomSalt(): string {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Le mot de passe correspond-il au verrou ? (comparaison de condensats, en temps constant sur leur longueur) */
export function checkDevPassword(lock: string, password: string): boolean {
  const effective = lock === '' ? DEFAULT_DEV_LOCK : lock;
  const i = effective.indexOf('$');
  if (i < 1) return false;
  const expected = effective.slice(i + 1);
  const got = sha256Hex(`${effective.slice(0, i)}:${password}`);
  let diff = expected.length ^ got.length;
  for (let k = 0; k < expected.length && k < got.length; k++) diff |= expected.charCodeAt(k) ^ got.charCodeAt(k);
  return diff === 0;
}

/** Mot de passe acceptable pour le nouveau verrou. */
export function devPasswordProblem(password: string): string | null {
  if (password.length < DEV_PASSWORD_MIN) return `Le mot de passe doit faire au moins ${DEV_PASSWORD_MIN} caractères.`;
  if (password.length > DEV_PASSWORD_MAX) return `Le mot de passe ne peut pas dépasser ${DEV_PASSWORD_MAX} caractères.`;
  return null;
}

/** Limite les essais successifs (verrou d'interface local) : 5 échecs → attente de 30 s, qui double à chaque nouvel échec. */
export class DevAttemptGuard {
  private failures = 0;
  private blockedUntil = 0;

  /** Secondes d'attente restantes (0 = essai autorisé). */
  wait(now = Date.now()): number {
    return Math.max(0, Math.ceil((this.blockedUntil - now) / 1000));
  }

  fail(now = Date.now()): void {
    this.failures++;
    if (this.failures >= 5) this.blockedUntil = now + 30_000 * 2 ** Math.min(6, this.failures - 5);
  }

  succeed(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }
}
