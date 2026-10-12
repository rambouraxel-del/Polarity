import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { GAME_NAME } from './src/config/brand';

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

export default defineConfig({
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
});
