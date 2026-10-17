/**
 * Thème « Néon premium » — SOURCE UNIQUE des couleurs, typographies, rayons et durées.
 *
 * - Le DOM (styles/*.css) n'utilise que des variables CSS `--c-*`, `--font-*`, `--r-*`, `--t-*` écrites par `applyTheme()`.
 * - Le rendu Phaser (render/ArenaRenderer.ts) lit les mêmes couleurs via `hexNum()`.
 * Pour changer une couleur ou une police : modifier ce fichier uniquement.
 */
export const THEME = {
  color: {
    /** Fond de l'arène (inchangé) et son quadrillage (inchangé). */
    bgDeep: '#070B1F',
    grid: '#16204A',
    /** Bleu nuit de la direction artistique et ses variantes d'arrière-plan. */
    night: '#0B1E3A',
    nightDeep: '#050A1C',
    /** Fond des panneaux (rendu translucide dans les styles). */
    panel: '#0A1633',
    /** Accents. `cyan` = interface ; `orbit` = valeur historique (l'orbite de l'arène suit désormais config/orbit.ts, par phase). */
    cyan: '#00E4FF',
    orbit: '#00E5FF',
    white: '#FFFFFF',
    text: '#EAF6FF',
    muted: '#9DB1D6',
    /** Or des étoiles de progression et des records. */
    gold: '#FFC84D',
    /** Dangers : corail (interface, échec) et couleurs fixes des menaces dans l'arène (inchangées). */
    coral: '#FF6A3D',
    hazardProjectile: '#FF6B6B',
    hazardSector: '#FF3DF0',
    /** Texte sur fond clair (boutons principaux). */
    ink: '#031322',
    /** Décor spatial des menus : nébuleuse et planète lointaine (très discrètes). */
    /** Campagne : objets de mission (vert menthe, distinct des Éclats, balises et dangers) et bouclier de secours (bleu clair). */
    signal: '#7DFFC4',
    shield: '#9CD0FF',
    /** Éclats (violet) et Prismes (rose) : monnaies. */
    shard: '#B78BFF',
    prism: '#FF4FD8',
    nebula: '#2A5BFF',
    planet: '#0E3B8C',
  },
  font: {
    /** Titres, boutons, grands chiffres : police locale empaquetée (@fontsource/orbitron). */
    display: "'Orbitron', 'Rajdhani', 'Eurostile', system-ui, sans-serif",
    /** Texte courant : polices du système (lisibles, sans chargement). */
    text: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  /** Rayons des coins (px). */
  radius: { sm: 10, md: 14, lg: 20, pill: 999 },
  /** Durées des transitions (ms). */
  motion: { fast: 120, base: 220 },
} as const;

export type ThemeColor = keyof typeof THEME.color;

/** « #RRGGBB » → nombre 0xRRGGBB (couleurs Phaser). */
export function hexNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** « #RRGGBB » → « r g b » (pour `rgb(var(--c-x-rgb) / 0.3)`). */
export function hexRgbTriplet(hex: string): string {
  const n = hexNum(hex);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Nom de la variable CSS d'une couleur : bgDeep → --c-bg-deep. */
export function cssVarName(color: ThemeColor): string {
  return `--c-${kebab(color)}`;
}

/** Variables CSS du thème, sous forme de paires [nom, valeur] (testable sans DOM). */
export function themeVariables(): [string, string][] {
  const out: [string, string][] = [];
  for (const key of Object.keys(THEME.color) as ThemeColor[]) {
    const name = cssVarName(key);
    out.push([name, THEME.color[key]], [`${name}-rgb`, hexRgbTriplet(THEME.color[key])]);
  }
  out.push(['--font-display', THEME.font.display], ['--font-text', THEME.font.text]);
  for (const [k, v] of Object.entries(THEME.radius)) out.push([`--r-${k}`, `${v}px`]);
  for (const [k, v] of Object.entries(THEME.motion)) out.push([`--t-${k}`, `${v}ms`]);
  return out;
}

/** Écrit les variables sur l'élément racine (à appeler avant d'afficher quoi que ce soit). */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of themeVariables()) root.style.setProperty(name, value);
}

/** Luminance relative WCAG d'une couleur « #RRGGBB ». */
export function luminance(hex: string): number {
  const n = hexNum(hex);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Rapport de contraste WCAG entre deux couleurs. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
