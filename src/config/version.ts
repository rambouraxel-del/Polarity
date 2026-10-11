/**
 * Version d'équilibrage : elle change quand les règles qui influencent les performances changent
 * (courbe de Survie, hitboxes…). Les records de Survie / défi sont enregistrés par version d'équilibrage
 * et ne sont jamais comparés entre versions différentes.
 *
 *  1 — v1.0 : courbe lente (τ = 170 s), hitboxes d'origine.
 *  2 — v1.1 : courbe accélérée (τ = 68 s), annonces −8 %, hitboxes +6,5 %, visuels +15 %.
 */
export const BALANCE_VERSION = 2;
