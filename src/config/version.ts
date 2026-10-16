/**
 * Version d'équilibrage : elle change quand les règles qui influencent les performances changent
 * (courbe de Survie, hitboxes…). Les records de Survie / défi sont enregistrés par version d'équilibrage
 * et ne sont jamais comparés entre versions différentes.
 *
 *  1 — v1.0 : courbe lente (τ = 170 s), hitboxes d'origine.
 *  2 — v1.1 : courbe accélérée (τ = 68 s), annonces −8 %, hitboxes +6,5 %, visuels +15 %.
 *  3 — v1.2 : vitesse du vaisseau progressive (40 % → 100 %), astéroïde fragmenté, convoi, laser balayeur,
 *      événements (pluie de météores, tempête électrique), annonces et espacements adaptés à la vitesse.
 *  4 — v2.0 : Survie à PHASES : difficulté par paliers (phase 1), mise en rythme des vagues, traversée de 6 s à 300 s de survie active,
 *      phase 2 infinie (grands arcs, spirales, faisceaux rotatifs / balayeurs / alternés). Le défi quotidien garde ses règles.
 */
export const BALANCE_VERSION = 4;

/**
 * Dernière version d'équilibrage qui a modifié les règles du DÉFI QUOTIDIEN. La v4 (Survie à phases) n'y touche pas : les records quotidiens locaux
 * sont donc conservés tels quels lors du passage de la v3 à la v4 (ils ne repartent de zéro que pour une sauvegarde antérieure à cette version).
 */
export const DAILY_RULES_VERSION = 3;
