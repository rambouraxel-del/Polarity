import data1 from '../data/campagne_niveaux_01_05.fr.json';
import data2 from '../data/campagne_niveaux_06_10.fr.json';

/**
 * Histoire de la campagne : « Douze ans de silence » (chapitre 1, niveaux 1 à 10).
 *
 * - Les textes sont dans `src/data/campagne_niveaux_01_05.fr.json` et `campagne_niveaux_06_10.fr.json` (sources éditables, séparées de la logique, transcriptions fournies telles quelles).
 *   Ce module n'en fait que des séquences prêtes à afficher : une séquence « avant » et une « après » par niveau, identifiants stables
 *   (`n1-before`, `n1-after`…) enregistrés dans la sauvegarde : ne jamais les changer.
 * - Les didascalies (`direction`) sont des intentions de mise en scène : elles ne sont jamais affichées comme du texte parlé.
 * - Les images sont des assets WebP (src/assets/story) résolus par nom ; elles ne sont chargées qu'à l'affichage de la scène.
 *   Les masters PNG sont dans art/campagne/ (hors bundle).
 * - Ajouter un niveau : ajouter une entrée au JSON (ou un nouveau fichier de chapitre) et l'image correspondante.
 */

/** Personnages et sources de messages. `system` : message du vaisseau, sans portrait. */
export type SpeakerId = 'elias' | 'nora' | 'transmission_inconnue' | 'system';

export interface SpeakerDef {
  name: string;
  /** Clé du portrait (src/assets/story/<clé>.webp), ou null (pas de portrait). */
  portrait: string | null;
}

/** Mapping explicite locuteur → nom affiché et portrait. */
export const SPEAKERS: Record<SpeakerId, SpeakerDef> = {
  elias: { name: 'Élias', portrait: 'elias' },
  nora: { name: 'Nora', portrait: 'nora' },
  transmission_inconnue: { name: 'Voix enregistrée', portrait: 'transmission_inconnue' },
  system: { name: 'Système', portrait: null },
};

export interface StoryLine {
  who: SpeakerId;
  /** Nom affiché (celui du JSON si présent). */
  name: string;
  /** Message du système (style distinct, jamais incrusté dans l'image). */
  system: boolean;
  text: string;
}

export interface StorySequence {
  id: string;
  /** Titre dans le journal. */
  title: string;
  level: number;
  phase: 'before' | 'after';
  /** Clé de l'illustration (src/assets/story/<clé>.webp). */
  illustration: string;
  lines: StoryLine[];
  /** Dernière séquence livrée : affiche « Suite du chapitre à venir ». */
  chapterEnd?: boolean;
}

// ————————————————————————————————————————————— assets (WebP, résolus par nom, chargés à l'affichage)

const urls = import.meta.glob('../assets/story/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byKey = new Map<string, string>();
for (const [path, url] of Object.entries(urls)) {
  const key = path.slice(path.lastIndexOf('/') + 1).replace(/\.webp$/, '');
  byKey.set(key, url);
}

/** URL d'une illustration ou d'un portrait par clé (chaîne vide si absent : l'écran de récit masque alors le cadre). */
export function storyAsset(key: string | null): string {
  return key ? (byKey.get(key) ?? '') : '';
}

/** Toutes les clés d'assets présentes (tests d'intégrité). */
export const STORY_ASSET_KEYS: string[] = [...byKey.keys()];

// ————————————————————————————————————————————— séquences

interface RawEntry {
  type: string;
  speaker?: string;
  display_name?: string;
  portrait?: string | null;
  text: string;
}

interface RawLevel {
  id: string;
  title: string;
  before: RawEntry[];
  after: RawEntry[];
  illustration_before: string;
  illustration_after: string;
}

/** `illustrations/01_de_quoi_rentrer.png` → `01_de_quoi_rentrer`. */
const keyOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.[a-z]+$/i, '');

const isSpeaker = (s: string | undefined): s is SpeakerId => s !== undefined && s in SPEAKERS;

function lines(entries: RawEntry[]): StoryLine[] {
  const out: StoryLine[] = [];
  for (const e of entries) {
    if (e.type !== 'dialogue' && e.type !== 'system') continue; // didascalies : pas affichées
    const who: SpeakerId = e.type === 'system' ? 'system' : isSpeaker(e.speaker) ? e.speaker : 'system';
    out.push({ who, name: e.display_name ?? SPEAKERS[who].name, system: who === 'system', text: e.text });
  }
  return out;
}

const raw: RawLevel[] = [...(data1 as { levels: RawLevel[] }).levels, ...(data2 as { levels: RawLevel[] }).levels];

/** `level_07` → 7 : le numéro vient de l'identifiant du niveau, pas de l'ordre des fichiers. */
const levelNumber = (lv: RawLevel): number => Number(lv.id.replace(/^level_/, ''));

export const STORY: StorySequence[] = raw.flatMap((lv) => {
  const level = levelNumber(lv);
  const last = level === Math.max(...raw.map(levelNumber));
  return [
    { id: `n${level}-before`, title: `Niveau ${level} · ${lv.title} · Introduction`, level, phase: 'before' as const, illustration: keyOf(lv.illustration_before), lines: lines(lv.before) },
    { id: `n${level}-after`, title: `Niveau ${level} · ${lv.title} · Conclusion`, level, phase: 'after' as const, illustration: keyOf(lv.illustration_after), lines: lines(lv.after), chapterEnd: last || undefined },
  ];
});

export function storyById(id: string): StorySequence | undefined {
  return STORY.find((s) => s.id === id);
}

/** Réglages de l'écran de récit. */
export const STORY_UI = {
  /** Vitesse d'apparition du texte (caractères par seconde) ; instantané avec « effets réduits ». */
  charsPerSecond: 48,
} as const;
