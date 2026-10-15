/**
 * État partagé « le service en ligne n'est pas à jour pour cette version du jeu » (renseigné par le client réseau, lu par l'interface pour expliquer
 * pourquoi des gains restent « en attente »). Aucune donnée de jeu : un simple indicateur d'affichage, remis à faux dès qu'une route récente répond.
 */
let incompatible = false;

export function setServiceIncompatible(v: boolean): void {
  incompatible = v;
}

export const isServiceIncompatible = (): boolean => incompatible;
