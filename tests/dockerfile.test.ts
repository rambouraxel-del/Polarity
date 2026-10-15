import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Garde : le service tourne via tsx → esbuild, dont le binaire natif est une dépendance OPTIONNELLE.
describe('server/Dockerfile', () => {
  const lignes = readFileSync('server/Dockerfile', 'utf-8').split('\n').filter((l) => !l.trim().startsWith('#'));
  const dockerfile = lignes.join('\n');

  it('installe les dépendances optionnelles (esbuild natif) sans scripts', () => {
    expect(dockerfile).toMatch(/npm ci --ignore-scripts/);
    expect(dockerfile).not.toMatch(/--omit=optional/);
  });

  it('garde l’utilisateur non privilégié « node »', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/chown node:node \/data/);
  });
});
