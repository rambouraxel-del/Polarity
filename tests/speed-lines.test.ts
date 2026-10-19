import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/config/balance';
import { FX, shipHalfWidth, shipRadius } from '../src/config/visuals';
import { heading } from '../src/render/geometry';
import { speedIntensity, speedStreaks, streakTriangle } from '../src/render/speedLines';

const R = ARENA.orbitRadius;
const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');

describe('Effet de vitesse du vaisseau (rendu seulement)', () => {
  it('intensité progressive et bornée selon le facteur de vitesse', () => {
    let prev = -1;
    for (let f = 0; f <= 1.6; f += 0.05) {
      const k = speedIntensity(f);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    expect(speedIntensity(0.4)).toBeLessThan(0.25);
    expect(speedIntensity(1)).toBe(1);
  });

  it('deux traînées, une troisième (plus courte) aux vitesses élevées seulement', () => {
    expect(speedStreaks(0.3, 0, shipHalfWidth(), false, false)).toHaveLength(2);
    const s = speedStreaks(1, 0, shipHalfWidth(), false, false);
    expect(s).toHaveLength(3);
    expect(s[2].length).toBeLessThan(s[0].length);
  });

  it('longueur et opacité progressent avec la vitesse mais restent discrètes', () => {
    const lo = speedStreaks(0.1, 0, shipHalfWidth(), true, false)[0];
    const hi = speedStreaks(1, 0, shipHalfWidth(), true, false)[0];
    expect(hi.length).toBeGreaterThan(lo.length);
    expect(hi.alpha).toBeGreaterThan(lo.alpha);
    // jamais envahissant : plus courtes que le vaisseau, opacité faible
    for (let t = 0; t < 3; t += 0.05) for (const st of speedStreaks(1, t, shipHalfWidth(), false, false)) {
      expect(st.length).toBeLessThan(shipRadius() * 1.6);
      expect(st.alpha).toBeLessThan(0.4);
      expect(st.alpha).toBeGreaterThan(0);
    }
  });

  it('légère variation dans le temps (sauf effets réduits : aucune variation)', () => {
    const a = speedStreaks(0.8, 0, shipHalfWidth(), false, false)[0];
    const b = speedStreaks(0.8, 0.13, shipHalfWidth(), false, false)[0];
    expect(a.length).not.toBe(b.length);
    expect(speedStreaks(0.8, 0, shipHalfWidth(), true, false)[0].length).toBe(speedStreaks(0.8, 0.13, shipHalfWidth(), true, false)[0].length);
  });

  it('atténué, sans traînée centrale, quand la traînée lumineuse d’apparence est tracée (pas de superposition excessive)', () => {
    const plain = speedStreaks(1, 0, shipHalfWidth(), false, false);
    const withTrail = speedStreaks(1, 0, shipHalfWidth(), false, true);
    expect(withTrail).toHaveLength(2);
    expect(withTrail[0].alpha).toBeLessThan(plain[0].alpha);
  });

  it('teinte sobre : blanc légèrement grisé (ni saturée ni colorée)', () => {
    const c = FX.speedLines.color;
    const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(30);
    expect(Math.max(r, g, b)).toBeLessThan(255);
  });

  it('derrière le vaisseau uniquement, à l’opposé du déplacement réel, dans les deux sens et à tout angle', () => {
    for (const dir of [1, -1] as const) {
      for (let a = 0; a < Math.PI * 2; a += 0.37) {
        const h = heading(a, dir);
        const px = R * Math.cos(a);
        const py = R * Math.sin(a);
        for (const st of speedStreaks(1, 0.4, shipHalfWidth(), false, false)) {
          const q = streakTriangle(a, dir, R, shipRadius(), st);
          for (const [x, y] of [[q.x0, q.y0], [q.x1, q.y1], [q.tx, q.ty]] as const) {
            const along = (x - px) * h.x + (y - py) * h.y; // composante dans le sens du déplacement
            expect(along).toBeLessThan(-shipRadius() * 0.99); // au-delà de la queue : ni devant, ni sur la coque
          }
          // la pointe est plus loin derrière que la base
          expect((q.tx - px) * h.x + (q.ty - py) * h.y).toBeLessThan((q.x0 - px) * h.x + (q.y0 - py) * h.y);
        }
      }
    }
  });

  it('inversion : la direction s’adapte immédiatement (traînées symétriques de part et d’autre du vaisseau)', () => {
    const st = speedStreaks(1, 0, shipHalfWidth(), true, false)[0];
    const a = 0.9;
    const f = streakTriangle(a, 1, R, shipRadius(), st);
    const r = streakTriangle(a, -1, R, shipRadius(), st);
    const px = R * Math.cos(a);
    const py = R * Math.sin(a);
    // pointes opposées par rapport au vaisseau (le décalage latéral reste le même)
    const along = (q: typeof f, d: 1 | -1) => (q.tx - px) * heading(a, d).x + (q.ty - py) * heading(a, d).y;
    expect(along(f, 1)).toBeLessThan(0);
    expect(along(r, -1)).toBeLessThan(0);
    expect(Math.sign((f.tx - px) * heading(a, 1).x + (f.ty - py) * heading(a, 1).y)).toBe(-Math.sign((r.tx - px) * heading(a, 1).x + (r.ty - py) * heading(a, 1).y));
  });

  it('reste dans le rendu : aucune dépendance à la simulation, au serveur, au rejeu ni à l’aléatoire', () => {
    const src = read('src/render/speedLines.ts');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../config/visuals', './geometry']);
    expect(src).not.toMatch(/Math\.random|Rng|flipLog|replay/);
    const r = read('src/render/ArenaRenderer.ts');
    // lecture seule de la vitesse ; l'ancienne lueur permanente a disparu
    expect(r).toContain('sim.omega / PLAYER.angularSpeed');
    expect(r).not.toMatch(/shipGlow/);
    expect(read('src/config/visuals.ts')).not.toMatch(/shipGlow/);
    expect(read('src/ui/shipPreview.ts')).not.toMatch(/shipGlow/);
  });
});
