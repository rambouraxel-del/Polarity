import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { GAME_NAME } from './src/config/brand';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Nom d'affichage du jeu (src/config/brand.ts) injecté dans index.html : un seul endroit à modifier. */
const brand = {
  name: 'nom-du-jeu',
  transformIndexHtml: (html: string): string => html.replaceAll('%GAME_NAME%', GAME_NAME),
};

export default defineConfig({
  plugins: [brand],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
