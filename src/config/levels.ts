import type { PatternWeights } from '../sim/patterns';
import { LEVEL_SPEED_DEFAULT } from './playerSpeed';

/**
 * Rythme d'un niveau :
 *  - steady : cadence régulière ;
 *  - pulse : alternance de rafales rapides et de moments calmes ;
 *  - crescendo : début aéré, fin plus serrée que la courbe normale.
 */
export type Pacing = 'steady' | 'pulse' | 'crescendo';

export interface LevelDef {
  id: number;
  name: string;
  /** Astuce affichée brièvement au début du niveau. */
  hint: string;
  /** Difficulté au début et à la fin des 90 s. */
  dStart: number;
  dEnd: number;
  pacing: Pacing;
  /**
   * Vitesse du vaisseau dans ce niveau, en fraction de la vitesse de référence (2,0 rad/s). Réglable par niveau.
   * Les niveaux n'utilisent pas la courbe de vitesse progressive de la Survie.
   */
  speed: number;
  /** Poids des motifs sur tout le niveau. */
  weights: PatternWeights;
  /** Poids ajoutés progressivement au cours du niveau (introduction en cours de partie). */
  lateWeights?: PatternWeights;
  /** Moment (s) où `lateWeights` commence à apparaître. */
  lateFrom?: number;
  /**
   * Seuils de score pour 1, 2 et 3 étoiles (le déblocage, lui, ne dépend que de la survie).
   * Calibrage initial (npm run sim) : 1★ ≈ 35 % et 2★ ≈ 70 % du score médian du bot « prudent »,
   * 3★ ≈ 70 % du bot « expert ». À réajuster avec des essais de joueurs.
   */
  stars: [number, number, number];
}

export const LEVELS: LevelDef[] = [
  {
    id: 1, name: 'Premier tour',
    hint: 'Touchez ou appuyez sur Espace pour inverser la direction.',
    dStart: 0, dEnd: 0.12, pacing: 'steady',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { shot: 1 },
    stars: [42000, 85000, 116000],
  },
  {
    id: 2, name: 'Lignes de mire',
    hint: 'Les tirs diamétraux coupent l’orbite à deux endroits opposés.',
    dStart: 0.05, dEnd: 0.2, pacing: 'steady',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { shot: 1, diameter: 0.8 },
    stars: [44000, 88000, 116000],
  },
  {
    id: 3, name: 'Courant',
    hint: 'Nouveau : secteurs électriques. Quittez la zone pointillée avant qu’elle ne s’allume.',
    dStart: 0.08, dEnd: 0.24, pacing: 'steady',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { arc: 1, shot: 0.35 },
    stars: [23000, 46000, 92000],
  },
  {
    id: 4, name: 'Contretemps',
    hint: 'Le rythme alterne : profitez des accalmies pour collecter.',
    dStart: 0.12, dEnd: 0.32, pacing: 'pulse',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { arc: 0.8, shot: 0.6, diameter: 0.4 },
    lateWeights: { twinArcs: 0.6 }, lateFrom: 35,
    stars: [32000, 64000, 100000],
  },
  {
    id: 5, name: 'Doublé',
    hint: 'Deux tirs à la fois : cherchez l’espace entre les lignes.',
    dStart: 0.18, dEnd: 0.4, pacing: 'steady',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { parallel: 1, cross: 0.6, shot: 0.5 },
    stars: [44000, 89000, 116000],
  },
  {
    id: 6, name: 'Première tenaille',
    hint: 'Attaque combinée : esquivez la première menace en anticipant la seconde.',
    dStart: 0.22, dEnd: 0.45, pacing: 'crescendo',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { shotArc: 1, arc: 0.5, shot: 0.5, parallel: 0.3 },
    stars: [30000, 61000, 98000],
  },
  {
    id: 7, name: 'Poursuite',
    hint: 'Les secteurs s’enchaînent : changez de direction au bon moment.',
    dStart: 0.28, dEnd: 0.5, pacing: 'pulse',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { chase: 1, burst: 0.7, arc: 0.4, cross: 0.4 },
    stars: [39000, 78000, 101000],
  },
  {
    id: 8, name: 'Écho',
    hint: 'Certains tirs reviennent par le même chemin, en sens inverse.',
    dStart: 0.32, dEnd: 0.55, pacing: 'steady',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { echo: 1, shotArc: 0.7, twinArcs: 0.5, diameter: 0.4 },
    stars: [19000, 39000, 85000],
  },
  {
    id: 9, name: 'Mosaïque',
    hint: 'Motifs mélangés : lisez l’annonce entière avant de bouger.',
    dStart: 0.38, dEnd: 0.62, pacing: 'steady',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { shot: 0.5, parallel: 0.6, cross: 0.6, arc: 0.5, chase: 0.6, shotArc: 0.7, echo: 0.5 },
    stars: [35000, 70000, 102000],
  },
  {
    id: 10, name: 'Fenêtres étroites',
    hint: 'Les annonces raccourcissent : anticipez la menace suivante.',
    dStart: 0.44, dEnd: 0.7, pacing: 'pulse',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { burst: 0.8, pincer: 0.7, cross: 0.6, chase: 0.6, twinArcs: 0.5 },
    stars: [30000, 60000, 91000],
  },
  {
    id: 11, name: 'Haute tension',
    hint: 'Tenailles et rafales : gardez toujours une sortie en tête.',
    dStart: 0.5, dEnd: 0.76, pacing: 'crescendo',
    speed: LEVEL_SPEED_DEFAULT,
    weights: { pincer: 0.8, shotArc: 0.8, echo: 0.6, burst: 0.6, parallel: 0.5, arc: 0.4 },
    stars: [26000, 51000, 89000],
  },
  {
    id: 12, name: 'Polarité',
    hint: 'Tout ce que vous avez appris, sans répit. Bonne chance.',
    dStart: 0.56, dEnd: 0.84, pacing: 'steady',
    speed: LEVEL_SPEED_DEFAULT,
    weights: {
      shot: 0.3, diameter: 0.3, parallel: 0.5, cross: 0.6, burst: 0.6, arc: 0.4,
      twinArcs: 0.5, chase: 0.6, shotArc: 0.7, pincer: 0.7, echo: 0.6,
    },
    stars: [28000, 57000, 98000],
  },
];

export function levelById(id: number): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
