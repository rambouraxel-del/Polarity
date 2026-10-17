/**
 * État partagé « le service en ligne n'est pas à jour pour cette version du jeu » (renseigné par le client réseau, lu par l'interface pour expliquer
 * pourquoi des gains restent « en attente »). Aucune donnée de jeu : un simple indicateur d'affichage, remis à faux dès qu'une route récente répond.
 */
let incompatible = false;

export function setServiceIncompatible(v: boolean): void {
  incompatible = v;
}

export const isServiceIncompatible = (): boolean => incompatible;

/**
 * Articles que le service a refusés comme « inconnus » (service resté sur un ancien catalogue). Indicateur d'affichage et garde-fou : tant que le
 * service ne les connaît pas, l'achat est bloqué avec une explication (sinon il serait annulé à chaque synchronisation, donc rejouable à l'infini).
 * Mémoire seulement : remis à zéro au prochain lancement du jeu (après mise à jour du service).
 */
const unknownToService = new Set<string>();

export const markUnknownToService = (id: string): void => void unknownToService.add(id);
export const isUnknownToService = (id: string): boolean => unknownToService.has(id);
