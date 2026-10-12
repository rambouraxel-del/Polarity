import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_NAME, STORAGE_NAMESPACE } from '../src/config/brand';
import { LEVELS } from '../src/config/levels';
import { ACHIEVEMENTS } from '../src/progression/achievements';
import { BACKUP_PREFIX, BALANCE_BACKUP_PREFIX, CORRUPT_KEY, SAVE_KEY, defaultSave } from '../src/save/save';
import { THEME, contrast, themeVariables, type ThemeColor } from '../src/ui/theme';
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

  it('couleurs de l’arène inchangées', () => {
    const t = THEME.color as Record<ThemeColor, string>;
    expect(t.bgDeep).toBe('#070B1F');
    expect(t.grid).toBe('#16204A');
    expect(t.orbit).toBe('#39F3FF');
  });
});

describe('écrans : données réelles', () => {
  const save = defaultSave();

  it('accueil : Survie en tête, puis Niveaux et Défi quotidien, puis Apparences, Succès, Options', () => {
    const html = S.homeScreen(save, '2026-10-12');
    const order = ['data-action="survival"', 'data-action="levels"', 'data-action="daily"', 'data-action="skins"', 'data-action="achievements"', 'data-action="options"'];
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
    expect(S.collectionScreen(save, 'skins')).toContain('data-action="tab-achievements"');
    const ach = S.collectionScreen(save, 'achievements');
    for (const a of ACHIEVEMENTS) expect(ach).toContain(a.name);
    expect(S.pauseScreen('Survie')).toContain('data-action="resume"');
    expect(S.confirmResetScreen()).toContain('data-action');
  });
});
