import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/config/balance';
import { HITBOX, getHitboxGrowth, playerHitRadius, projectileHitRadius } from '../src/config/hitbox';
import { ORBIT, orbitLook } from '../src/config/orbit';
import { SKINS, SKIN_CONFIG, hazardHueGap, MIN_HAZARD_HUE_GAP } from '../src/config/skins';
import { shipHalfWidth, shipRadius, VISUAL } from '../src/config/visuals';
import { projectileHits } from '../src/sim/collision';
import type { ProjectileHazard } from '../src/sim/hazards';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Projectile droit : passe à la distance perpendiculaire `d` du centre du vaisseau immobile en (R, 0). */
function lineProjectile(dir: 'right' | 'left' | 'above' | 'below', d: number): ProjectileHazard {
  const R = ARENA.orbitRadius;
  const v = 300;
  const from: Record<typeof dir, [number, number, number, number]> = {
    right: [R + 200, d, -v, 0],
    left: [R - 200, -d, v, 0],
    above: [R + d, 200, 0, -v],
    below: [R - d, -200, 0, v],
  };
  const [x0, y0, vx, vy] = from[dir];
  return { kind: 'projectile', id: 1, pattern: 'test', warnStart: 0, launch: 0, end: 2, threatEnd: 2, x0, y0, vx, vy, cross1: 0, cross2: 0, crossTime1: 0, crossTime2: 0, warned: true } as ProjectileHazard;
}

describe('hitbox du vaisseau : commune, explicite, +15 %', () => {
  it('rayon = base × (1 + agrandissement) × 1,15 ; aucune dépendance aux apparences ni aux images', () => {
    expect(HITBOX.playerScale).toBe(1.15);
    expect(playerHitRadius()).toBeCloseTo(HITBOX.playerBase * (1 + getHitboxGrowth()) * 1.15, 10);
    // Les fichiers de la simulation et de la hitbox n'importent ni apparences, ni rendu, ni PNG
    for (const f of ['src/config/hitbox.ts', 'src/sim/collision.ts', 'src/sim/simulation.ts', 'src/sim/safety.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/from '\.\.?\/(config\/skins|render|progression\/skins|assets)/);
      expect(src, f).not.toMatch(/\.png|getImageData|alphaOf/i);
    }
    // Aucune apparence ne porte de paramètre de hitbox
    for (const s of [...SKINS, ...SKIN_CONFIG]) expect(Object.keys(s).join(' '), s.id).not.toMatch(/hit|radius|collision/i);
  });

  it('collision sur les quatre côtés : contact exactement à la somme des rayons, quel que soit le côté', () => {
    const R = ARENA.orbitRadius;
    const limit = playerHitRadius() + projectileHitRadius();
    for (const dir of ['right', 'left', 'above', 'below'] as const) {
      const inside = projectileHits(lineProjectile(dir, limit - 0.5), 0, 0, 0, 2, playerHitRadius());
      const outside = projectileHits(lineProjectile(dir, limit + 0.5), 0, 0, 0, 2, playerHitRadius());
      expect(inside, `${dir} : contact`).toBe(true);
      expect(outside, `${dir} : manqué`).toBe(false);
    }
    expect(R).toBe(300);
  });

  it('le cercle de collision reste à l’intérieur de la silhouette opaque : aucune collision due à une zone transparente', () => {
    // Silhouette des PNG : ≈ 240 px sur 256 (≈ 94 %) ; largeur ≈ 82 % de la longueur. La hitbox est un cercle bien plus petit que la demi-largeur.
    expect(playerHitRadius()).toBeLessThan(shipHalfWidth() * 0.5);
    expect(playerHitRadius()).toBeLessThan(shipRadius() * 0.35);
  });

  it('taille visuelle +25 % (gabarit identique pour toutes les apparences) ; hitbox indépendante du visuel', () => {
    expect(VISUAL.shipScale).toBeCloseTo(1.45 * 1.2 * 1.25, 10);
    expect(shipRadius()).toBeCloseTo(VISUAL.shipBaseRadius * VISUAL.scale * 1.45 * 1.2 * 1.25, 10);
    expect(shipRadius()).toBeGreaterThan(27);
    expect(shipRadius()).toBeLessThan(28);
  });
});

describe('Orbit : dépend de la phase, jamais de l’apparence', () => {
  it('une apparence par phase, plus fine et moins lumineuse que l’ancien rail (trait 3, opaque, halo plein)', () => {
    for (const phase of [1, 2]) {
      const o = orbitLook(phase);
      expect(o.lineWidth, `phase ${phase}`).toBeLessThan(3);
      expect(o.lineAlpha).toBeLessThan(1);
      expect(o.glowAlpha).toBeLessThan(0.5);
      expect(hazardHueGap(o.color), `couleur phase ${phase}`).toBeGreaterThanOrEqual(MIN_HAZARD_HUE_GAP);
    }
    expect(orbitLook(1).arcs).toBe(0);
    expect(orbitLook(2).arcs).toBeGreaterThan(0);
    expect(orbitLook(1).color).not.toBe(orbitLook(2).color);
    expect(ORBIT.blendSeconds).toBeGreaterThan(0);
  });

  it('phase inconnue : la plus proche inférieure ; jamais en dessous de la phase 1', () => {
    expect(orbitLook(0)).toBe(orbitLook(1));
    expect(orbitLook(7)).toBe(orbitLook(2));
  });

  it('le rendu de l’orbite et la configuration ne lisent aucune apparence', () => {
    expect(read('src/config/orbit.ts').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/skin/i);
    const r = read('src/render/ArenaRenderer.ts');
    const body = r.slice(r.indexOf('private drawOrbit('), r.indexOf('private drawShard('));
    expect(body.length).toBeGreaterThan(500);
    expect(body).not.toMatch(/skin/i);
    // Aucune apparence ne définit de couleur d'orbite
    for (const s of SKINS) expect(Object.keys(s.colors), s.id).not.toContain('orbit');
  });
});

describe('achat au choix : la monnaie choisie suit jusqu’à la confirmation', () => {
  it('le bouton « Confirmer » porte la monnaie (sans elle, l’achat en Prismes partirait en Éclats)', async () => {
    const { defaultSave } = await import('../src/save/save');
    const S = await import('../src/ui/screens');
    const save = defaultSave();
    save.economy.managed = true;
    save.wallet.prisms = 200;
    save.economy.confirmed = { shards: 0, medals: 0, prisms: 200 };
    const html = S.confirmPurchaseScreen(save, 'long-courrier', false, 'prisms');
    expect(html).toMatch(/data-action="confirm-buy"[^>]*data-item="long-courrier"[^>]*data-currency="prisms"/);
    expect(html).toContain('60');
  });
});
