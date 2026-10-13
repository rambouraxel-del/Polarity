import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/config/campaign';
import { SPEAKERS, STORY, STORY_ASSET_KEYS, storyAsset } from '../src/config/story';
import raw1 from '../src/data/campagne_niveaux_01_05.fr.json';
import raw2 from '../src/data/campagne_niveaux_06_10.fr.json';

type RawLevels = { levels: { id: string; before: { type: string; text: string }[]; after: { type: string; text: string }[] }[] };
const raw: RawLevels = { levels: [...(raw1 as RawLevels).levels, ...(raw2 as RawLevels).levels] };

describe('histoire : données et assets', () => {
  it('une scène « avant » et une « après » par niveau, rattachées aux niveaux de la campagne', () => {
    expect(STORY.map((s) => s.id)).toEqual(MISSIONS.flatMap((m) => [`n${m.id}-before`, `n${m.id}-after`]));
    for (const m of MISSIONS) {
      expect(m.before).toBe(`n${m.id}-before`);
      expect(m.after).toBe(`n${m.id}-after`);
    }
    expect(new Set(STORY.map((s) => s.id)).size).toBe(STORY.length);
  });

  it('les textes du JSON sont repris sans altération (ordre, accents, ellipses), didascalies exclues', () => {
    raw.levels.forEach((lv, i) => {
      for (const [phase, entries] of [['before', lv.before], ['after', lv.after]] as const) {
        const seq = STORY.find((s) => s.id === `n${i + 1}-${phase}`)!;
        const expected = entries.filter((e) => e.type !== 'direction').map((e) => e.text);
        expect(seq.lines.map((l) => l.text)).toEqual(expected);
      }
    });
    const all = STORY.flatMap((s) => s.lines.map((l) => l.text)).join('\n');
    expect(all).toContain('Tu as encore une baisse de pression sur le circuit gauche.');
    expect(all).toContain('…ici la Lisière… quelqu’un… nous recevoir…');
    expect(all).toContain('LIAISON AVEC LE VAISSEAU D’ORIGINE RÉTABLIE.');
  });

  it('aucune didascalie n’est affichée comme parole', () => {
    const dir = raw.levels.flatMap((l) => [...l.before, ...l.after]).filter((e) => e.type === 'direction').map((e) => e.text);
    expect(dir.length).toBeGreaterThan(10);
    const spoken = new Set(STORY.flatMap((s) => s.lines.map((l) => l.text)));
    for (const d of dir) expect(spoken.has(d)).toBe(false);
  });

  it('mapping portraits : Nora, Élias, voix enregistrée ; le système n’a pas de portrait', () => {
    expect(SPEAKERS.nora.portrait).toBe('nora');
    expect(SPEAKERS.elias.portrait).toBe('elias');
    expect(SPEAKERS.transmission_inconnue.portrait).toBe('transmission_inconnue');
    expect(SPEAKERS.system.portrait).toBeNull();
    for (const s of STORY) for (const l of s.lines) if (l.system) expect(l.who).toBe('system');
  });

  it('chaque illustration et chaque portrait référencés existent (WebP), le niveau 5 utilise deux images', () => {
    for (const s of STORY) expect(storyAsset(s.illustration), `${s.id} : ${s.illustration}`).not.toBe('');
    for (const sp of Object.values(SPEAKERS)) if (sp.portrait) expect(storyAsset(sp.portrait)).not.toBe('');
    expect(STORY.find((s) => s.id === 'n5-before')!.illustration).toBe('05a_capsule_exterieur');
    expect(STORY.find((s) => s.id === 'n5-after')!.illustration).toBe('05b_capsule_interieur');
    for (let n = 6; n <= 10; n++) expect(STORY.find((x) => x.id === `n${n}-before`)!.illustration).toBe(`campaign_${String(n).padStart(2, '0')}`);
    expect(STORY_ASSET_KEYS.length).toBe(14);
  });

  it('poids des assets du jeu : illustrations < 350 Ko, portraits < 60 Ko, masters PNG hors du bundle', () => {
    const dir = 'src/assets/story';
    for (const f of readdirSync(dir)) {
      const kb = statSync(`${dir}/${f}`).size / 1024;
      const portrait = ['elias.webp', 'nora.webp', 'transmission_inconnue.webp'].includes(f);
      expect(kb, f).toBeLessThan(portrait ? 60 : 350);
    }
    expect(readdirSync('art/campagne/illustrations').length).toBe(11);
    expect(readdirSync(dir).every((f) => f.endsWith('.webp'))).toBe(true);
  });

  it('portraits avec vraie transparence alpha (WebP RGBA)', () => {
    for (const f of ['elias', 'nora', 'transmission_inconnue']) {
      const b = readFileSync(`src/assets/story/${f}.webp`);
      expect(b.subarray(8, 12).toString()).toBe('WEBP');
      // Conteneur VP8X avec le drapeau alpha, ou chunk ALPH
      expect(b.includes(Buffer.from('ALPH')) || (b.subarray(12, 16).toString() === 'VP8X' && (b[20] & 0x10) !== 0)).toBe(true);
    }
  });
});
