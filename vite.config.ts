import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { GAME_NAME } from './src/config/brand';
import { sanitizeBaseUrl } from './src/net/baseUrl';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Identifiant de la version publiée : commit (GITHUB_SHA en intégration continue, sinon git), « dev » si inconnu. */
function buildId(): string {
  const fromEnv = process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}
const BUILD_ID = buildId();

/** `version.json` : lu par le jeu (sans cache) pour proposer le rechargement quand une page ancienne est restée en mémoire. */
const versionFile = {
  name: 'version-json',
  generateBundle(this: { emitFile(f: { type: 'asset'; fileName: string; source: string }): void }): void {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, build: BUILD_ID }) });
  },
};

/** Nom d'affichage du jeu (src/config/brand.ts) injecté dans index.html : un seul endroit à modifier. */
const brand = {
  name: 'nom-du-jeu',
  transformIndexHtml: (html: string): string => html.replaceAll('%GAME_NAME%', GAME_NAME),
};

/**
 * Classement mondial : l'adresse du service (VITE_LEADERBOARD_URL, publique) est vérifiée AVANT la construction. Une valeur mal formée ou en http
 * distant ferait un jeu qui croit avoir un classement alors qu'il ne peut pas l'utiliser : mieux vaut échouer ici que publier ce jeu.
 * Absente ou vide = classement désactivé (le jeu reste entièrement jouable).
 */
function checkLeaderboardUrl(mode: string): void {
  const raw = (process.env.VITE_LEADERBOARD_URL ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_LEADERBOARD_URL ?? '').trim();
  if (raw && !sanitizeBaseUrl(raw)) {
    throw new Error(`VITE_LEADERBOARD_URL invalide : « ${raw} ». Attendu : https://hôte (sans chemin, sans « / » final) ; http n'est accepté que pour localhost. Laissez la variable vide pour désactiver le classement.`);
  }
}

export default defineConfig(({ mode }) => {
  checkLeaderboardUrl(mode);
  return {
  plugins: [brand, versionFile],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
  };
});
