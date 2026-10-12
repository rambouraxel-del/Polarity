/**
 * Icônes de l'interface : SVG en ligne (trait `currentColor`), sans fichier externe ni police d'icônes.
 * Toutes sont décoratives (aria-hidden) : le sens est toujours porté par un texte.
 */
const svg = (body: string, extra = ''): string =>
  `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

export const ICONS = {
  play: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
  levels: svg('<circle cx="5" cy="17" r="2.3"/><circle cx="10.5" cy="9.5" r="2.3"/><circle cx="14.5" cy="15" r="2.3"/><circle cx="19.5" cy="6.5" r="2.3"/><path d="M6.7 15.5l2.6-4.2M12.3 10.5l1.2 2.7M16 13.7l2.4-5"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h1.6M11.2 14h1.6M14.4 14h1.6M8 17.3h1.6M11.2 17.3h1.6" stroke-width="2.2"/>'),
  rocket: svg('<path d="M14.5 4.5c3-.7 5-.5 5-.5s.2 2-.5 5l-5.2 5.2-3.8-3.8z"/><path d="M9.5 10.5L6 11l-2 3 4 .5M13.5 14.5L13 18l-3 2-.5-4"/><circle cx="15" cy="9" r="1.3"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3"/><path d="M12 13v3.5M8.5 20h7M9.5 17h5v3h-5z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1.2 2.3a7.6 7.6 0 0 1 2 .8l2.4-.9 1.9 1.9-.9 2.4a7.6 7.6 0 0 1 .8 2l2.3 1.2v2.7l-2.3 1.2a7.6 7.6 0 0 1-.8 2l.9 2.4-1.9 1.9-2.4-.9a7.6 7.6 0 0 1-2 .8L12 21.2l-1.2-2.3a7.6 7.6 0 0 1-2-.8l-2.4.9-1.9-1.9.9-2.4a7.6 7.6 0 0 1-.8-2L2.3 11.5V8.8l2.3-1.2a7.6 7.6 0 0 1 .8-2l-.9-2.4 1.9-1.9 2.4.9a7.6 7.6 0 0 1 2-.8z" stroke-width="1.4"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.2" r="1.2" fill="currentColor" stroke="none"/>'),
  chevron: svg('<path d="M9 5l7 7-7 7"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.4"/>'),
  sound: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/>'),
  volume: svg('<path d="M5 17V9M9 20V5M13 16V9M17 18V7M21 14v-3"/>'),
  leaf: svg('<path d="M5 19c0-9 5-14 14-14 0 9-5 14-14 14z"/><path d="M5 19c3-4 6-6.5 10-8.5"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.2 1-1.2 1.9M12 17v.2"/>'),
  trash: svg('<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5"/>'),
  shop: svg('<path d="M5 8.5h14l-1.2 11H6.2z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/><path d="M9.5 13.2a2.5 2.5 0 0 0 5 0"/>'),
  home: svg('<path d="M4 11l8-7 8 7M6 10v10h12V10"/>'),
  replay: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7M4.5 4.5v4h4"/>'),
  /** Étoile pleine (progression, record). */
  star: '<svg class="icon icon--star" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z" fill="currentColor"/></svg>',
} as const;

export type IconName = keyof typeof ICONS;
