import { hashString } from '../core/rng';

/** Date UTC au format AAAA-MM-JJ : identique pour tous les joueurs au même instant. */
export function utcDateString(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Graine du défi : dépend uniquement de la date UTC. */
export function dailySeed(date: string): number {
  return hashString(`polarite-defi-${date}`);
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function formatDateFr(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`;
}
