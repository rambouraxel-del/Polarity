/**
 * Adresse du service acceptée : https obligatoire (le secret du profil voyage dans un en-tête), ou http sur la machine locale pour le
 * développement. Un PRÉFIXE de chemin simple est accepté (service publié derrière un reverse proxy sous un sous-chemin, ex. https://hôte/polarity : le
 * proxy doit retirer le préfixe avant de transmettre au service). Toute autre valeur (mal saisie, http distant, identifiants, paramètres ou ancre dans l'URL,
 * chemin exotique) désactive le classement : jamais de repli silencieux vers une adresse non sûre. Le contrôle est répété à la construction (vite.config.ts)
 * pour échouer tôt. Renvoie l'adresse normalisée, sans « / » final.
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
  if (u.username || u.password || u.search || u.hash) return '';
  const path = u.pathname.replace(/\/+$/, '');
  // Préfixe de chemin : segments simples seulement (jamais « .. », « // » ni caractères d'échappement)
  if (path !== '' && (!/^(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/.test(path) || /\/\.\.?(\/|$)/.test(v) || /[^:]\/\//.test(v))) return '';
  return `${u.origin}${path}`;
}
