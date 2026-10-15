/**
 * Contrôle unique : clic/toucher dans l'aire de jeu ou Espace.
 * - Pointer Events uniquement : un toucher ne produit qu'un seul « pointerdown »,
 *   les événements souris synthétiques (mousedown/click) ne sont jamais écoutés.
 * - La répétition automatique d'une touche maintenue est ignorée.
 * - Les boutons de l'interface ne sont pas dans l'aire de jeu : ils ne déclenchent pas d'inversion.
 */
export interface InputHandlers {
  /** Inversion de direction. */
  action(): void;
  /** Échap / P. */
  pauseKey(): void;
  /** Vrai quand une partie est affichée (l'Espace appartient alors au jeu). */
  inGame(): boolean;
  /** Première interaction : autorise l'audio. */
  firstInteraction(): void;
  /** Raccourci clavier d'un pouvoir (B, G, S) : jamais une inversion. */
  power?(key: string): void;
}

export class InputController {
  constructor(private readonly gameEl: HTMLElement, private readonly h: InputHandlers) {}

  attach(): void {
    this.gameEl.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    this.gameEl.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: false });
    // Toute interaction (y compris sur les menus) peut débloquer l'audio. Sur écran tactile, seuls
    // pointerup/touchend comptent comme geste d'activation pour le navigateur : on les écoute aussi.
    for (const type of ['pointerdown', 'pointerup', 'touchend'] as const) {
      window.addEventListener(type, () => this.h.firstInteraction(), { capture: true, passive: true });
    }
    // Empêche le défilement / zoom de la page pendant une interaction dans le jeu
    this.gameEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.gameEl.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (!this.h.inGame()) return;
    this.h.action();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.h.firstInteraction();
    // Saisie de texte (pseudo du classement) : les touches appartiennent au champ, pas au jeu
    if (isEditable(e.target)) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (!this.h.inGame()) return;
      e.preventDefault();
      if (e.repeat) return;
      this.h.action();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (e.repeat) return;
      this.h.pauseKey();
      return;
    }
    // Pouvoirs : une lettre, sans modificateur ; ne touche ni à l'Espace, ni à Échap, ni à P
    if (this.h.power && this.h.inGame() && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      this.h.power(e.key.toLowerCase());
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (isEditable(e.target)) return;
    if ((e.code === 'Space' || e.key === ' ') && this.h.inGame()) e.preventDefault();
  };
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}
