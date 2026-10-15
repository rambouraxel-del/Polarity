import { describe, expect, it } from 'vitest';
import { playerHitRadius } from '../src/config/hitbox';
import { CLASSIC_SKIN_ID, HAZARD_HUES, MIN_HAZARD_HUE_GAP, SHIP_MODELS, SKINS, hazardHueGap, hueSat } from '../src/config/skins';
import { VISUAL, shipRadius } from '../src/config/visuals';
import { ACHIEVEMENTS } from '../src/progression/achievements';
import { isKnownSkin, isSkinOwned, resolveEquipped, skinById } from '../src/progression/skins';
import { CATALOG, LEGACY_ACHIEVEMENT_ITEMS, catalogItem } from '../src/config/catalog';
import { LEGACY_SKIN_ACHIEVEMENTS } from '../src/config/economy';
import { SHIP_PALETTE, recolorShip } from '../src/render/shipPalette';
import { defaultSave, loadSave, writeSave, type KeyValueStore } from '../src/save/save';

describe('configuration des apparences', () => {
  it('identifiants stables et uniques ; les apparences d’origine sont conservées', () => {
    const ids = SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 7)).toEqual(['classique', 'aurore', 'menthe', 'ambre', 'glace', 'solaire', 'prisme']);
    expect(CLASSIC_SKIN_ID).toBe('classique');
  });

  it('chaque apparence a une obtention au catalogue (Médailles ou Prismes) ; plus aucune exclusivité de succès', () => {
    for (const sk of SKINS) {
      const item = catalogItem(sk.id);
      expect(item?.kind, sk.id).toBe('ship');
      expect(['default', 'price'], sk.id).toContain(item?.acquire.type);
    }
    // Les vaisseaux débloqués autrefois par un succès s'achètent désormais en Médailles
    expect(['glace', 'solaire', 'prisme'].every((id) => { const a = catalogItem(id)?.acquire; return a?.type === 'price' && a.currency === 'medals'; })).toBe(true);
    // Déblocages d'avant conservés pour la migration des sauvegardes
    expect(Object.keys(LEGACY_SKIN_ACHIEVEMENTS).sort()).toEqual(['ambre', 'aurore', 'glace', 'menthe', 'prisme', 'solaire']);
    expect(Object.entries(LEGACY_ACHIEVEMENT_ITEMS).every(([item, ach]) => !!catalogItem(item) && ACHIEVEMENTS.some((x) => x.id === ach))).toBe(true);
    expect(CATALOG.filter((i) => i.kind === 'ship').length).toBe(SKINS.length);
  });

  it('aucun avantage de jeu : seules des données de présentation, même modèle, même gabarit, même hitbox', () => {
    for (const s of SKINS) {
      expect(Object.keys(s).sort()).toEqual(['asset', 'colors', 'id', 'name']);
      expect(Object.keys(s.colors).sort()).toEqual(['beacon', 'cockpit', 'hull', 'orbit', 'thruster', 'trail', 'wings']);
      expect(s.asset in SHIP_MODELS).toBe(true);
    }
    // Tous partagent le même modèle (donc la même taille) ; la hitbox ne dépend d'aucune apparence
    expect(new Set(SKINS.map((s) => s.asset)).size).toBe(1);
    expect(playerHitRadius()).toBeCloseTo(7 * 1.065, 10);
  });

  it('chaque apparence est reconnaissable : coque, ailes et cockpit de couleurs distinctes entre elles', () => {
    const sig = SKINS.map((s) => `${s.colors.hull}-${s.colors.wings}-${s.colors.cockpit}`);
    expect(new Set(sig).size).toBe(SKINS.length);
    const glows = SKINS.map((s) => s.colors.thruster.glow);
    expect(new Set(glows).size).toBeGreaterThanOrEqual(5);
  });

  it('le réacteur reste nettement distinct des dangers (corail, orange, magenta)', () => {
    for (const s of SKINS) {
      for (const c of [s.colors.thruster.glow, s.colors.thruster.core]) {
        expect(hazardHueGap(c), `${s.id} ${c.toString(16)}`).toBeGreaterThanOrEqual(MIN_HAZARD_HUE_GAP);
      }
    }
    // Garde-fou : le contrôle détecte bien un réacteur corail, orange ou magenta
    expect(hazardHueGap(0xff6b6b)).toBeLessThan(MIN_HAZARD_HUE_GAP);
    expect(hazardHueGap(0xff7a2e)).toBeLessThan(MIN_HAZARD_HUE_GAP);
    expect(hazardHueGap(0xff3df0)).toBeLessThan(MIN_HAZARD_HUE_GAP);
    expect(HAZARD_HUES.length).toBe(3);
    expect(hueSat(0x00e5ff).hue).toBeCloseTo(186, -1);
  });
});

describe('possession et équipement', () => {
  const own = (owned: string[] = []) => ({ owned });

  it('apparence inconnue → modèle classique', () => {
    expect(skinById('inconnue').id).toBe('classique');
    expect(isKnownSkin('inconnue')).toBe(false);
    expect(isKnownSkin('aurore')).toBe(true);
  });

  it('une apparence non possédée n’est jamais équipée', () => {
    expect(resolveEquipped('glace', own()).id).toBe('classique');
    expect(resolveEquipped('glace', own(['glace'])).id).toBe('glace');
    expect(resolveEquipped('aurore', own()).id).toBe('classique');
    expect(resolveEquipped('aurore', own(['aurore'])).id).toBe('aurore');
    expect(resolveEquipped('absente', own(['glace'])).id).toBe('classique');
  });

  it('un succès n’ouvre plus aucun vaisseau : seul l’achat (ou une possession conservée) compte', () => {
    expect(isSkinOwned(skinById('glace'), own())).toBe(false);
    expect(isSkinOwned(skinById('glace'), own(['glace']))).toBe(true);
    expect(isSkinOwned(skinById('classique'), own())).toBe(true);
  });

  it('l’apparence équipée est enregistrée et relue (persistance)', () => {
    const store = new Map<string, string>();
    const kv: KeyValueStore = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), remove: (k) => void store.delete(k) };
    const save = defaultSave();
    save.owned = ['ambre'];
    save.skin = 'ambre';
    writeSave(kv, save);
    const back = loadSave(kv).data;
    expect(back.skin).toBe('ambre');
    expect(resolveEquipped(back.skin, back).id).toBe('ambre');
    // Identifiant disparu d'une version ultérieure : retour au classique sans perdre le reste
    back.skin = 'disparue';
    expect(resolveEquipped(back.skin, back).id).toBe('classique');
  });
});

describe('visuels du vaisseau', () => {
  it('vaisseau +20 % par rapport à la v1.1.x, hitbox inchangée', () => {
    expect(VISUAL.shipScale).toBeCloseTo(1.45 * 1.2, 10);
    expect(shipRadius()).toBeCloseTo(11 * 1.15 * 1.45 * 1.2, 10);
  });
});

describe('recoloration du sprite', () => {
  const size = 8;
  const make = (px: Record<number, [number, number, number, number]>): Uint8ClampedArray => {
    const d = new Uint8ClampedArray(size * size * 4);
    for (const [i, v] of Object.entries(px)) d.set(v, Number(i) * 4);
    return d;
  };
  const at = (d: Uint8ClampedArray, i: number): number[] => Array.from(d.slice(i * 4, i * 4 + 4));
  // Positions : centre (x=3) ou bord (x=0) sur la ligne 2
  const center = 2 * size + 3;
  const edge = 2 * size + 0;
  const colors = { hull: 0xffffff, wings: 0xff00ff, cockpit: 0x00e5ff };

  it('laisse les pixels transparents intacts et conserve l’opacité', () => {
    const d = make({ [center]: [200, 200, 200, 180] });
    recolorShip(d, size, colors);
    expect(at(d, 0)).toEqual([0, 0, 0, 0]);
    expect(d[center * 4 + 3]).toBe(180);
  });

  it('renforce le blanc de la coque (gris clair → plus clair)', () => {
    const d = make({ [center]: [200, 200, 200, 255] });
    recolorShip(d, size, colors);
    expect(d[center * 4]).toBeGreaterThan(200);
  });

  it('colore le cockpit (cyan plus vif) et distingue coque et ailes', () => {
    const d = make({ [center]: [30, 150, 220, 255], [edge]: [210, 210, 210, 255], [center + 1]: [210, 210, 210, 255] });
    recolorShip(d, size, colors);
    const [r, g, b] = at(d, center);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeGreaterThan(180);
    expect(r).toBeLessThan(80);
    // Aile (bord) magenta ; coque (centre) blanche
    const wing = at(d, edge);
    const hull = at(d, center + 1);
    expect(wing[1]).toBeLessThan(wing[0]);
    expect(Math.abs(hull[0] - hull[1])).toBeLessThan(10);
  });

  it('conserve le métal sombre (tuyères)', () => {
    const d = make({ [center]: [40, 40, 44, 255] });
    recolorShip(d, size, colors);
    expect(at(d, center)).toEqual([40, 40, 44, 255]);
    expect(SHIP_PALETTE.darkValue).toBeGreaterThan(0.1);
  });
});
