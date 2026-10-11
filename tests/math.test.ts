import { describe, expect, it } from 'vitest';
import { arcCrosses, minDistanceLinear, sweepOverlapsArc, TAU } from '../src/core/math';

describe('arcCrosses', () => {
  it('détecte un passage dans les deux sens', () => {
    expect(arcCrosses(0.9, 0.2, 1)).toBe(true);
    expect(arcCrosses(1.1, -0.2, 1)).toBe(true);
    expect(arcCrosses(0.5, 0.2, 1)).toBe(false);
  });
  it('fonctionne au passage de zéro', () => {
    expect(arcCrosses(TAU - 0.05, 0.1, 0.02)).toBe(true);
    expect(arcCrosses(0.05, -0.1, TAU - 0.02)).toBe(true);
    expect(arcCrosses(-0.05, 0.1, 0)).toBe(true);
  });
  it('exclut le point de départ, inclut le point d’arrivée', () => {
    expect(arcCrosses(1, 0.1, 1)).toBe(false);
    expect(arcCrosses(0.9, 0.1, 1)).toBe(true);
  });
  it('gère un grand pas (image très longue)', () => {
    expect(arcCrosses(0, 3, 2.5)).toBe(true);
    expect(arcCrosses(0, -3, TAU - 2.5)).toBe(true);
  });
});

describe('sweepOverlapsArc', () => {
  it('chevauchement simple et absence de chevauchement', () => {
    expect(sweepOverlapsArc(0, 0.1, 0.05, 0.01)).toBe(true);
    expect(sweepOverlapsArc(0, 0.1, 0.5, 0.1)).toBe(false);
  });
  it('balayage commençant dans l’arc, et passage de zéro', () => {
    expect(sweepOverlapsArc(1, 0.01, 1, 0.2)).toBe(true);
    expect(sweepOverlapsArc(TAU - 0.05, 0.1, 0.02, 0.01)).toBe(true);
    expect(sweepOverlapsArc(0.05, -0.1, TAU - 0.02, 0.01)).toBe(true);
  });
});

describe('minDistanceLinear', () => {
  it('trouve le croisement au milieu de l’intervalle', () => {
    // A va de (−10,0) à (10,0) ; B de (0,−10) à (0,10) : ils se croisent en (0,0)
    expect(minDistanceLinear(-10, 0, 10, 0, 0, -10, 0, 10)).toBeCloseTo(0);
  });
});
