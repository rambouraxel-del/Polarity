import type { PatternWeights } from '../sim/patterns';

/**
 * Événements de la Survie et du défi quotidien (réglage indépendant de la difficulté, des hitboxes et de la vitesse).
 *
 * Calendrier (temps de jeu actif, la pause l'arrête) : premier événement entre 45 et 60 s ; ensuite 40 à 60 s après la
 * FIN du précédent (fin de la phase active, la respiration de 3 s comprise dans cet intervalle). Chaque événement est annoncé
 * 2 s avant son début. Le calendrier est tiré d'un générateur dédié, dérivé de la graine (donc identique pour tous les
 * joueurs du défi quotidien, quelles que soient leurs actions).
 *
 * Un événement REMPLACE les vagues normales : un seul directeur de vagues est actif à la fois.
 */
export type EventKind = 'meteor' | 'storm';

export interface EventDef {
  kind: EventKind;
  /** Nom affiché. */
  name: string;
  /** Durée de la phase active (s). */
  duration: number;
  /** Motifs utilisés pendant l'événement (les motifs du jeu normal ne sont pas utilisés). */
  weights: PatternWeights;
  /** Intervalle entre vagues multiplié par ce facteur (borné par CAPS.minWaveInterval). */
  intervalScale: number;
  /** Texte d'annonce (français). */
  announce: string;
}

export const EVENTS = {
  /** Début du premier événement (s de jeu actif). */
  first: { min: 45, max: 60 },
  /** Intervalle entre la fin d'un événement et le début du suivant. */
  gap: { min: 40, max: 60 },
  /** Annonce avant le début (s). */
  announce: 2,
  /** Respiration après la fin : aucune nouvelle attaque (s). Les menaces déjà présentes finissent normalement. */
  breath: 3,
  /** Délai avant la première vague normale après la respiration (s). */
  resumeDelay: 0.6,
  meteor: {
    kind: 'meteor',
    name: 'Pluie de météores',
    duration: 12,
    // Astéroïdes simples et convois
    weights: { shot: 1, diameter: 0.6, convoy: 1.5 },
    intervalScale: 0.85,
    announce: 'Pluie de météores !',
  } as EventDef,
  storm: {
    kind: 'storm',
    name: 'Tempête électrique',
    duration: 10,
    // Secteurs électriques successifs, quelques astéroïdes
    weights: { arc: 1, twinArcs: 0.7, chase: 0.6, shot: 0.3, diameter: 0.15 },
    intervalScale: 0.8,
    announce: 'Tempête électrique !',
  } as EventDef,
} as const;

export function eventDef(kind: EventKind): EventDef {
  return kind === 'meteor' ? EVENTS.meteor : EVENTS.storm;
}
