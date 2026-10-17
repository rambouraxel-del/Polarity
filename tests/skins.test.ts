import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HITBOX, playerHitRadius } from '../src/config/hitbox';
import { CAMPAIGN_SKIN, DEFAULT_SKIN_ID, HAZARD_HUES, MIN_HAZARD_HUE_GAP, SKINS, SKIN_CONFIG, hazardHueGap, hueSat } from '../src/config/skins';
import { VISUAL, shipRadius } from '../src/config/visuals';
import { ACHIEVEMENTS } from '../src/progression/achievements';
import { isKnownSkin, isSkinOwned, resolveEquipped, skinById } from '../src/progression/skins';
import { CATALOG, LEGACY_ACHIEVEMENT_ITEMS, catalogItem } from '../src/config/catalog';
import { SHIP_PALETTE, recolorShip } from '../src/render/shipPalette';
import { defaultSave, loadSave, writeSave, type KeyValueStore } from '../src/save/save';

const IDS = ['tole-brute', 'chantier-orbital', 'carbone-utilitaire', 'dipole', 'circuit', 'cartographe', 'long-courrier', 'basalte', 'arcade-84', 'porcelaine'];
const OLD_IDS = ['classique', 'aurore', 'menthe', 'ambre', 'spectre', 'glace', 'solaire', 'prisme', 'neon', 'faille'];

describe('configuration des apparences', () => {
  it('dix apparences, identifiants stables et uniques, dans l’ordre de la configuration', () => {
    const ids = SKINS.map((s) => s.id);
    expect(ids).toEqual(IDS);
    expect(SKIN_CONFIG.map((c) => c.id)).toEqual(IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...SKIN_CONFIG].sort((a, b) => a.order - b.order).map((c) => c.id)).toEqual(IDS);
    // Les anciennes apparences n'existent plus
    for (const old of OLD_IDS) expect(ids).not.toContain(old);
  });

  it('Tôle brute : gratuite, apparence par défaut, repli de tout identifiant inconnu', () => {
    expect(DEFAULT_SKIN_ID).toBe('tole-brute');
    expect(SKIN_CONFIG[0]).toMatchObject({ id: 'tole-brute', acquisition: 'default', priceMedals: 0, priceShards: 0, pricePrisms: 0, available: true });
    expect(catalogItem('tole-brute')?.acquire).toEqual({ type: 'default' });
    expect(defaultSave().skin).toBe('tole-brute');
    expect(skinById('inconnue').id).toBe('tole-brute');
    expect(resolveEquipped('inconnue', { owned: [] }).id).toBe('tole-brute');
    for (const old of OLD_IDS) expect(skinById(old).id, old).toBe('tole-brute');
  });

  it('les dix PNG existent dans src/assets/skins/ et font 256 × 256', () => {
    const root = resolve(__dirname, '..');
    for (const c of SKIN_CONFIG) {
      expect(c.image.startsWith('src/assets/skins/'), c.id).toBe(true);
      const buf = readFileSync(resolve(root, c.image));
      // Signature PNG puis en-tête IHDR : largeur et hauteur sur 4 octets (gros-boutiste) aux positions 16 et 20
      expect(buf.subarray(0, 8).toString('hex'), c.id).toBe('89504e470d0a1a0a');
      expect(buf.subarray(12, 16).toString('latin1'), c.id).toBe('IHDR');
      expect(buf.readUInt32BE(16), `${c.id} largeur`).toBe(256);
      expect(buf.readUInt32BE(20), `${c.id} hauteur`).toBe(256);
    }
    expect(SKINS.map((s) => s.image)).toEqual(SKIN_CONFIG.map((c) => c.image));
  });

  it('le catalogue des vaisseaux est déduit de SKIN_CONFIG : méthode d’obtention, prix, disponibilité, ordre', () => {
    const ships = CATALOG.filter((i) => i.kind === 'ship');
    expect(ships.map((i) => i.id)).toEqual(IDS);
    for (const c of SKIN_CONFIG) {
      const item = catalogItem(c.id)!;
      expect(item.kind, c.id).toBe('ship');
      expect(item.name, c.id).toBe(c.name);
      if (c.acquisition === 'default') expect(item.acquire, c.id).toEqual({ type: 'default' });
      else if (c.acquisition === 'medals') expect(item.acquire, c.id).toEqual({ type: 'price', currency: 'medals', amount: c.priceMedals });
      else if (c.acquisition === 'shards_or_prisms') expect(item.acquire, c.id).toEqual({ type: 'choice', shards: c.priceShards, prisms: c.pricePrisms });
      else expect(item.acquire.type, c.id).toBe('unavailable');
    }
    expect(SKIN_CONFIG.map((c) => c.acquisition)).toEqual(['default', 'medals', 'medals', 'medals', 'medals', 'medals', 'shards_or_prisms', 'shards_or_prisms', 'shards_or_prisms', 'unavailable']);
    expect(SKIN_CONFIG.filter((c) => c.acquisition === 'medals').map((c) => c.priceMedals)).toEqual([100, 150, 200, 250, 300]);
    expect(SKIN_CONFIG.filter((c) => c.acquisition === 'shards_or_prisms').map((c) => [c.priceShards, c.pricePrisms])).toEqual([[1500, 60], [2000, 80], [3000, 120]]);
    expect(SKIN_CONFIG.find((c) => c.id === 'porcelaine')).toMatchObject({ prestige: 2, available: false });
    // Plus aucun vaisseau débloqué par un succès ni payable en Prismes seulement : les acquis d'avant ne concernent que des traînées
    expect(CATALOG.filter((i) => i.kind === 'ship').every((i) => i.acquire.type !== 'reward')).toBe(true);
    expect(Object.entries(LEGACY_ACHIEVEMENT_ITEMS).every(([item, ach]) => !!catalogItem(item) && ACHIEVEMENTS.some((x) => x.id === ach))).toBe(true);
  });

  it('un vaisseau « indisponible » reste hors de la boutique : Porcelaine n’a ni prix ni moyen d’obtention', () => {
    expect(catalogItem('porcelaine')?.acquire.type).toBe('unavailable');
    const c = SKIN_CONFIG.find((k) => k.id === 'porcelaine')!;
    expect(c.priceMedals + c.priceShards + c.pricePrisms).toBe(0);
  });

  it('aucun avantage de jeu : seules des données de présentation, une seule hitbox pour tous', () => {
    for (const s of SKINS) {
      expect(Object.keys(s).sort(), s.id).toEqual(['colors', 'id', 'image', 'name', 'prestige']);
      expect(Object.keys(s.colors).sort(), s.id).toEqual(['beacon', 'cockpit', 'thruster', 'trail']);
    }
    for (const c of SKIN_CONFIG) {
      // Aucun champ de hitbox, de rayon, de vitesse ni de collision dans la configuration d'une apparence
      expect(Object.keys(c).filter((k) => /hit|radius|collision|speed|scale|size/i.test(k)), c.id).toEqual([]);
    }
    // La hitbox est celle de config/hitbox.ts (commune), jamais déduite d'un PNG
    expect(playerHitRadius()).toBeCloseTo(HITBOX.playerBase * (1 + HITBOX.defaultGrowth) * HITBOX.playerScale, 10);
    expect(playerHitRadius()).toBeCloseTo(7 * 1.065 * 1.15, 10);
  });

  it('chaque apparence a son image et son nom ; la campagne a son propre vaisseau hors catalogue', () => {
    expect(new Set(SKINS.map((s) => s.image)).size).toBe(SKINS.length);
    expect(new Set(SKINS.map((s) => s.name)).size).toBe(SKINS.length);
    expect(SKINS.map((s) => s.id)).not.toContain(CAMPAIGN_SKIN.id);
    expect(catalogItem(CAMPAIGN_SKIN.id)).toBeUndefined();
    expect(isKnownSkin(CAMPAIGN_SKIN.id)).toBe(false);
  });

  it('les effets (réacteur, lueur, balises, traînée) restent nettement distincts des dangers (corail, orange, magenta)', () => {
    for (const s of SKINS) {
      for (const c of [s.colors.thruster.glow, s.colors.thruster.core, s.colors.cockpit, s.colors.trail]) {
        expect(hazardHueGap(c), `${s.id} ${c.toString(16)}`).toBeGreaterThanOrEqual(MIN_HAZARD_HUE_GAP);
      }
    }
    // Le réacteur de la Traverse (campagne) aussi
    for (const c of [CAMPAIGN_SKIN.colors.thruster.glow, CAMPAIGN_SKIN.colors.thruster.core]) expect(hazardHueGap(c)).toBeGreaterThanOrEqual(MIN_HAZARD_HUE_GAP);
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

  it('apparence inconnue ou ancienne → Tôle brute', () => {
    expect(skinById('inconnue').id).toBe('tole-brute');
    expect(isKnownSkin('inconnue')).toBe(false);
    expect(isKnownSkin('aurore')).toBe(false);
    expect(isKnownSkin('chantier-orbital')).toBe(true);
  });

  it('une apparence non possédée n’est jamais équipée', () => {
    expect(resolveEquipped('cartographe', own()).id).toBe('tole-brute');
    expect(resolveEquipped('cartographe', own(['cartographe'])).id).toBe('cartographe');
    expect(resolveEquipped('chantier-orbital', own()).id).toBe('tole-brute');
    expect(resolveEquipped('chantier-orbital', own(['chantier-orbital'])).id).toBe('chantier-orbital');
    expect(resolveEquipped('absente', own(['cartographe'])).id).toBe('tole-brute');
    // Une ancienne apparence restée dans `owned` n'est jamais équipée
    expect(resolveEquipped('glace', own(['glace'])).id).toBe('tole-brute');
  });

  it('un succès n’ouvre plus aucun vaisseau : seul l’achat (ou une possession conservée) compte', () => {
    expect(isSkinOwned(skinById('cartographe'), own())).toBe(false);
    expect(isSkinOwned(skinById('cartographe'), own(['cartographe']))).toBe(true);
    expect(isSkinOwned(skinById('tole-brute'), own())).toBe(true);
    expect(isSkinOwned(skinById('porcelaine'), own())).toBe(false);
  });

  it('l’apparence équipée est enregistrée et relue (persistance)', () => {
    const store = new Map<string, string>();
    const kv: KeyValueStore = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), remove: (k) => void store.delete(k) };
    const save = defaultSave();
    save.owned = ['dipole'];
    save.skin = 'dipole';
    writeSave(kv, save);
    const back = loadSave(kv).data;
    expect(back.skin).toBe('dipole');
    expect(resolveEquipped(back.skin, back).id).toBe('dipole');
    // Identifiant disparu d'une version ultérieure : retour à Tôle brute sans perdre le reste
    back.skin = 'disparue';
    expect(resolveEquipped(back.skin, back).id).toBe('tole-brute');
  });

  it('une sauvegarde contenant une ancienne apparence équipée est chargée sans erreur : apparence ramenée à Tôle brute, `owned` toléré', () => {
    for (const old of OLD_IDS) {
      const store = new Map<string, string>();
      const kv: KeyValueStore = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), remove: (k) => void store.delete(k) };
      writeSave(kv, { ...defaultSave(), skin: old, owned: [old, 'cartographe'] });
      const res = loadSave(kv);
      expect(res.status, old).not.toBe('corrupt');
      expect(res.data.skin, old).toBe('tole-brute');
      expect(res.data.owned, old).toEqual([old, 'cartographe']);
      expect(resolveEquipped(res.data.skin, res.data).id, old).toBe('tole-brute');
    }
  });
});

describe('visuels du vaisseau', () => {
  it('vaisseau +25 % de plus qu’en v1.4, hitbox indépendante (+15 % séparés)', () => {
    expect(VISUAL.shipScale).toBeCloseTo(1.45 * 1.2 * 1.25, 10);
    expect(shipRadius()).toBeCloseTo(11 * 1.15 * 1.45 * 1.2 * 1.25, 10);
    expect(HITBOX.playerScale).toBe(1.15);
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
