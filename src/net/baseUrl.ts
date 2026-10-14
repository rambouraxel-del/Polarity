/**
 * Adresse du service acceptée : https obligatoire (le secret du profil voyage dans un en-tête), ou http sur la machine locale pour le
 * développement. Toute autre valeur (mal saisie, http distant, chemin, identifiants dans l'URL) désactive le classement : jamais de repli silencieux
 * vers une adresse non sûre. Le contrôle est répété à la construction (vite.config.ts) pour échouer tôt.
 */
export function sanitizeBaseUrl(raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return '';
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return '';
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return '';
  return u.origin;
}
