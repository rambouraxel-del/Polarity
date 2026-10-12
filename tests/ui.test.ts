import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_NAME, STORAGE_NAMESPACE } from '../src/config/brand';
import { LEVELS } from '../src/config/levels';
import { ACHIEVEMENTS } from '../src/progression/achievements';
import { BACKUP_PREFIX, BALANCE_BACKUP_PREFIX, CORRUPT_KEY, SAVE_KEY, defaultSave } from '../src/save/save';
import { THEME, contrast, themeVariables, type ThemeColor } from '../src/ui/theme';
import { bannerHelp } from '../src/ui/controls';
import { applyRun } from '../src/progression/progress';
import { formatScore } from '../src/ui/format';
import * as S from '../src/ui/screens';

const STYLES = join(__dirname, '..', 'src', 'styles');
const css = readdirSync(STYLES).filter((f) => f.endsWith('.css')).map((f) => ({ f, text: readFileSync(join(STYLES, f), 'utf8') }));

describe('marque et sauvegarde', () => {
  it('le nom affiché est Polarity et les clés de sauvegarde restent « polarite.* »', () => {
    expect(GAME_NAME).toBe('Polarity');
    expect(STORAGE_NAMESPACE).toBe('polarite');
    for (const k of [SAVE_KEY, CORRUPT_KEY, BACKUP_PREFIX, BALANCE_BACKUP_PREFIX]) expect(k.startsWith('polarite.')).toBe(true);
    expect(SAVE_KEY).toBe('polarite.save');
  });
});

describe('thème centralisé', () => {
  it('définit une variable CSS (et son triplet RGB) par couleur', () => {
    const names = new Set(themeVariables().map(([n]) => n));
    for (const c of Object.keys(THEME.color)) {
      const kebab = c.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      expect(names.has(`--c-${kebab}`)).toBe(true);
      expect(names.has(`--c-${kebab}-rgb`)).toBe(true);
    }
  });

  it('les feuilles de style n’utilisent aucune couleur écrite en dur', () => {
    for (const { f, text } of css) {
      // Seules exceptions : les valeurs de repli de var(--c-x, #hex) avant l'exécution du script (base.css)
      const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*#[0-9a-fA-F]{3,8}\)/g, ')');
      expect(noComments.match(/#[0-9a-fA-F]{3,8}\b/g), `${f} : couleur hexadécimale`).toBeNull();
      expect(noComments.match(/\brgba?\(\s*\d/g), `${f} : rgb() numérique`).toBeNull();
    }
  });

  it('toutes les variables --c-/--r-/--t-/--font- utilisées par les styles existent', () => {
    const defined = new Set(themeVariables().map(([n]) => n));
    // --fill (curseur de volume) est écrit en ligne par l'application
    const local = new Set<string>(['--fill']);
    for (const { text } of css) for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) local.add(m[1]);
    for (const { f, text } of css) {
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        expect(defined.has(m[1]) || local.has(m[1]), `${f} : ${m[1]}`).toBe(true);
      }
      for (const m of text.matchAll(/rgb\(var\((--c-[a-z0-9-]+-rgb)\)/g)) expect(defined.has(m[1]), `${f} : ${m[1]}`).toBe(true);
    }
  });

  it('les textes restent lisibles (contraste WCAG ≥ 4,5 sur les panneaux et les boutons)', () => {
    const c = THEME.color;
    for (const fg of [c.text, c.white, c.muted, c.gold, c.cyan] as string[]) expect(contrast(fg, c.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.ink, c.cyan)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.coral, c.panel)).toBeGreaterThanOrEqual(3);
  });

  it('couleurs de l’arène : fond et quadrillage inchangés, orbite cyan vif', () => {
    const t = THEME.color as Record<ThemeColor, string>;
    expect(t.bgDeep).toBe('#070B1F');
    expect(t.grid).toBe('#16204A');
    expect(t.orbit).toBe('#00E5FF');
  });
});

describe('écrans : données réelles', () => {
  const save = defaultSave();

  it('accueil : Survie en tête, puis Campagne et Défi quotidien, puis Apparences, Succès, Options', () => {
    const html = S.homeScreen(save, '2026-10-12');
    const order = ['data-action="survival"', 'data-action="campaign"', 'data-action="daily"', 'data-action="cosmetics"', 'data-action="achievements"', 'data-action="leaderboard"', 'data-action="options"'];
    const idx = order.map((s) => html.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(html).toContain('alt="Polarity"');
    expect(html).toContain(`0/${ACHIEVEMENTS.length}`);
  });

  it('niveaux : 12 cartes, un seul niveau à jouer, les autres verrouillés', () => {
    const html = S.levelsScreen(save);
    expect(html.match(/class="level-card[ "]/g)?.length ?? 0).toBe(LEVELS.length);
    expect(S.nextLevelId(save)).toBe(1);
    expect(html.match(/disabled/g)?.length).toBe(LEVELS.length - 1);
  });

  it('options, apparences, succès, pause, résultat : rendus sans valeur figée', () => {
    expect(S.optionsScreen(save)).toContain('Polarity v');
    expect(S.cosmeticsScreen(save, 'ships', 'all')).toContain('data-action="cat-trails"');
    const ach = S.achievementsScreen(save);
    for (const a of ACHIEVEMENTS) expect(ach).toContain(a.name);
    expect(S.pauseScreen('Survie')).toContain('data-action="resume"');
    expect(S.confirmResetScreen()).toContain('data-action');
  });
});

describe('menu Cosmétiques (Apparences + Boutique fusionnés)', () => {
  const base = (): ReturnType<typeof defaultSave> => {
    const s = defaultSave();
    s.wallet = { shards: 1200, prisms: 0 };
    s.owned = ['aurore'];
    s.skin = 'aurore';
    s.achievements = { first_cycle: 1 };
    return s;
  };

  it('soldes affichés une seule fois, trois catégories, trois filtres', () => {
    const html = S.cosmeticsScreen(base(), 'ships', 'all');
    expect(html.match(/data-wallet="shards"/g)?.length).toBe(1);
    expect(html.match(/data-wallet="prisms"/g)?.length).toBe(1);
    for (const a of ['cat-ships', 'cat-trails', 'cat-packs', 'filter-all', 'filter-owned', 'filter-locked']) expect(html).toContain(`data-action="${a}"`);
    expect(html).not.toContain('tab-shop');
    expect(S.homeScreen(base(), '2026-10-12')).not.toContain('data-action="skins"');
  });

  it('filtres : Tous, Possédés, À débloquer', () => {
    const save = base();
    const all = S.cosmeticItems(save, 'ships', 'all').map((i) => i.id);
    const owned = S.cosmeticItems(save, 'ships', 'owned').map((i) => i.id);
    const locked = S.cosmeticItems(save, 'ships', 'locked').map((i) => i.id);
    expect(owned.sort()).toEqual(['aurore', 'classique']);
    expect(locked).toEqual(all.filter((id) => !owned.includes(id)));
    expect(owned.length + locked.length).toBe(all.length);
    expect(locked).toContain('neon');
    expect(locked).toContain('glace');
    // L'article affiché appartient toujours au filtre
    expect(S.cosmeticsScreen(save, 'ships', 'locked', 'aurore')).not.toContain('data-skin-preview="aurore"');
    expect(S.cosmeticsScreen(save, 'ships', 'owned')).toContain('data-skin-preview="aurore"');
    // Catégorie vide dans un filtre : message
    expect(S.cosmeticsScreen(save, 'packs', 'owned')).toContain('aucun article');
  });

  it('états : Acheter, Solde insuffisant, Équiper, Équipé, Succès requis, Bientôt disponible', () => {
    const save = base();
    let html = S.cosmeticsScreen(save, 'ships', 'all', 'menthe');
    expect(html).toMatch(/data-action="buy"[^>]*data-item="menthe"/);
    expect(html).toContain('Acheter');
    save.wallet.shards = 50;
    html = S.cosmeticsScreen(save, 'ships', 'all', 'menthe');
    expect(html).toContain('Solde insuffisant');
    expect(html).toMatch(/data-action="buy"\s+disabled/);
    expect(html).toContain('Il vous manque 150 Éclats');
    save.owned.push('ambre');
    html = S.cosmeticsScreen(save, 'ships', 'all', 'ambre');
    expect(html).toMatch(/data-action="equip-item"[^>]*data-item="ambre"/);
    expect(html).toContain('Possédé');
    html = S.cosmeticsScreen(save, 'ships', 'all', 'aurore');
    expect(html).toContain('Équipé');
    html = S.cosmeticsScreen(save, 'ships', 'all', 'solaire');
    expect(html).toContain('Succès requis');
    expect(html).toContain('Endurance');
    html = S.cosmeticsScreen(save, 'ships', 'all', 'neon');
    expect(html).toContain('Bientôt disponible');
    expect(html).toContain('Prismes');
    expect(html).not.toMatch(/<button[^>]*data-action="buy"(?![^>]*disabled)[^>]*>/);
  });

  it('chaque article affiche aperçu animé, description, contenu, prix ou condition', () => {
    const save = base();
    const pack = S.cosmeticsScreen(save, 'packs', 'all', 'pack-spectre');
    expect(pack).toContain('data-skin-preview="spectre"');
    expect(pack).toContain('Vaisseau Spectre');
    expect(pack).toContain('Traînée Ultraviolet');
    expect(pack).toContain('900');
    const trail = S.cosmeticsScreen(save, 'trails', 'all', 'glacier');
    expect(trail).toContain('data-trail-color=');
    expect(trail).toContain('250');
    // Exclusivité de succès : condition précise et récompense liée
    const ex = S.cosmeticsScreen(save, 'trails', 'all', 'citron');
    expect(ex).toContain('Chasseur d’éclats');
    expect(ex).toContain('Succès requis');
  });

  it('aucun article premium n’a de bouton de paiement actif, dans aucune catégorie', () => {
    const save = base();
    save.wallet.prisms = 100000;
    for (const [tab, item] of [['ships', 'neon'], ['trails', 'nebuleuse'], ['packs', 'pack-neon']] as const) {
      const html = S.cosmeticsScreen(save, tab, 'all', item);
      const enabled = html.match(/<button[^>]*data-action="buy"[^>]*>/g)?.filter((b) => !b.includes('disabled')) ?? [];
      expect(enabled).toEqual([]);
      expect(html).toContain('Bientôt disponible');
    }
  });

  it('confirmation : récapitulatif sans rien débiter', () => {
    const save = base();
    const html = S.confirmPurchaseScreen(save, 'spectre');
    expect(html).toContain('Confirmer l’achat');
    expect(html).toContain('600');
    expect(html).toMatch(/data-action="confirm-buy"[^>]*data-item="spectre"/);
    expect(html).toContain('data-action="back-cosmetics"');
    expect(save.wallet.shards).toBe(1200);
    expect(save.owned).toEqual(['aurore']);
    expect(S.confirmPurchaseScreen(save, 'inconnu')).not.toContain('confirm-buy');
  });
});

describe('menu Succès', () => {
  it('liste tous les succès par catégorie avec progression, récompense et état', () => {
    const save = defaultSave();
    save.achievements = { first_cycle: 1 };
    save.rewarded = ['first_cycle'];
    save.stats.totalCycles = 7;
    const html = S.achievementsScreen(save);
    for (const a of ACHIEVEMENTS) {
      expect(html).toContain(a.name);
      expect(html).toContain(`+${formatScore(a.shards)}`);
    }
    for (const c of ['Découverte', 'Survie', 'Niveaux', 'Collectes', 'Maîtrise']) expect(html).toContain(c);
    expect(html).toContain('Obtenu');
    expect(html).toContain('récompense reçue');
    // Progression : 7 cycles sur 10
    expect(html).toContain('7 / 10');
    expect(html).toContain('role="progressbar"');
    // Durées lisibles et cosmétiques liés
    expect(html).toContain('0:00 / 1:00');
    expect(html).toContain('Vaisseau Glace');
    expect(html).toContain('Traînée Citron');
    expect(html).toContain(`1 / ${ACHIEVEMENTS.length}`);
  });
});

describe('aide aux contrôles', () => {
  it('mobile : toucher ; ordinateur : clic, Espace et Échap', () => {
    const save = defaultSave();
    const touch = S.homeScreen(save, '2026-10-12', true);
    const desk = S.homeScreen(save, '2026-10-12', false);
    expect(touch).toContain('Touchez l’écran');
    expect(touch).not.toContain('Espace');
    expect(desk).toContain('Espace');
    expect(desk).toContain('Échap');
    expect(desk).toContain('Cliquez');
    expect(desk).not.toContain('Touchez');
    expect(bannerHelp(true)).not.toContain('Espace');
    expect(bannerHelp(false)).toContain('Espace');
  });
});

describe('boutique et soldes', () => {
  const base = (): ReturnType<typeof defaultSave> => {
    const s = defaultSave();
    s.wallet = { shards: 1200, prisms: 0 };
    s.owned = ['aurore'];
    s.skin = 'aurore';
    return s;
  };

  it('les deux soldes sont affichés sur l’accueil, la boutique et les apparences', () => {
    const save = base();
    for (const html of [S.homeScreen(save, '2026-10-12'), S.cosmeticsScreen(save, 'ships', 'all')]) {
      expect(html).toContain('data-wallet="shards"');
      expect(html).toContain('data-wallet="prisms"');
      expect(html).toContain(formatScore(1200));
      expect(html).toContain('Éclats');
      expect(html).toContain('Prismes');
    }
  });

  it('résultat : Éclats gagnés, origine et nouveau solde ; réafficher l’écran ne recrédite rien', () => {
    const save = defaultSave();
    const rep = applyRun(save, { mode: 'level', levelId: 1, time: 90, score: 60000, cycles: 2, bestMultiplier: 2, outcome: 'complete' });
    expect(save.wallet.shards).toBe(rep.levelReward!.total + rep.achievementShards);
    const html = S.resultScreen(rep, true);
    expect(html).toContain('Première réussite du niveau');
    expect(html).toContain(`+${rep.levelReward!.total}`);
    expect(html).toContain('Nouveau solde');
    const before = save.wallet.shards;
    S.resultScreen(rep, true);
    S.resultScreen(rep, true);
    expect(save.wallet.shards).toBe(before);
    // Survie : Éclats collectés sur l'orbite
    const surv = applyRun(save, { mode: 'survival', time: 84.6, score: 12400, cycles: 3, bestMultiplier: 3, outcome: 'dead', shards: 25 });
    const h2 = S.resultScreen(surv, false);
    expect(h2).toContain('Éclats collectés sur l’orbite');
    expect(h2).toContain('+25');
    // Seules les récompenses de succès de cette partie ont été versées ; réafficher l'écran ne crédite rien
    expect(save.wallet.shards).toBe(before + surv.achievementShards);
    const after = save.wallet.shards;
    S.resultScreen(surv, false);
    S.resultScreen(surv, false);
    expect(save.wallet.shards).toBe(after);
    // Notification des succès obtenus avec leur gain
    expect(S.resultScreen(rep, true)).toContain('Succès');
  });
});
