import eclatUrl from '../assets/ui/eclat.png';
import prismeUrl from '../assets/ui/prisme.png';
import type { Currency } from '../config/catalog';
import type { Wallet } from '../save/save';
import { escapeHtml, formatScore } from './format';
import { ICONS, type IconName } from './icons';

/**
 * Composants HTML réutilisables (boutons, en-têtes, statistiques, réglages…). Leurs styles sont dans
 * src/styles/components.css ; les écrans les assemblent sans écrire de style en ligne.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonOptions {
  action: string;
  label: string;
  /** Deuxième ligne (texte courant, pas en majuscules). */
  sub?: string;
  icon?: IconName;
  variant?: ButtonVariant;
  /** Gabarit : héros (Survie), ligne d'accueil, compact. */
  size?: 'hero' | 'row' | 'compact' | 'sm';
  chevron?: boolean;
  /** Petit compteur à droite du libellé (ex. « 3/9 »). */
  badge?: string;
  /** Attributs supplémentaires déjà échappés (data-*, disabled…). */
  attrs?: string;
}

export function button(o: ButtonOptions): string {
  const cls = ['btn'];
  if (o.variant) cls.push(`btn--${o.variant}`);
  if (o.size) cls.push(`btn--${o.size}`);
  const icon = o.icon ? ICONS[o.icon] : '';
  const text = o.sub
    ? `<span class="btn__text"><span class="btn__label">${escapeHtml(o.label)}</span><span class="btn__sub">${escapeHtml(o.sub)}</span></span>`
    : `<span class="btn__label">${escapeHtml(o.label)}</span>`;
  const badge = o.badge ? `<span class="btn__badge">${escapeHtml(o.badge)}</span>` : '';
  const chev = o.chevron ? `<span class="btn__chev">${ICONS.chevron}</span>` : '';
  return `<button class="${cls.join(' ')}" data-action="${o.action}" ${o.attrs ?? ''}>${icon}${text}${badge}${chev}</button>`;
}

/** En-tête d'écran : bouton retour + titre. */
export function screenHead(title: string, backAction = 'home'): string {
  return `<div class="screen-head"><button class="icon-btn" data-action="${backAction}" aria-label="Retour">${ICONS.back}</button><h2 class="title">${escapeHtml(title)}</h2></div>`;
}

export function stat(label: string, value: string, gold = false): string {
  return `<div class="stat"><div class="stat__k">${escapeHtml(label)}</div><div class="stat__v${gold ? ' stat__v--gold' : ''}">${escapeHtml(value)}</div></div>`;
}

/** Interrupteur accessible (role="switch"). */
export function switchButton(id: string, action: string, checked: boolean, label: string): string {
  return `<button id="${id}" class="switch" role="switch" aria-checked="${checked}" aria-label="${escapeHtml(label)}" data-action="${action}"></button>`;
}

export function setting(icon: IconName, label: string, desc: string, control: string, descId = ''): string {
  return `<div class="setting"><span class="setting__icon">${ICONS[icon]}</span>
    <div class="setting__text"><div class="setting__label">${escapeHtml(label)}</div><div class="setting__desc"${descId ? ` id="${descId}"` : ''}>${escapeHtml(desc)}</div></div>${control}</div>`;
}

export function notice(html: string, tone: 'gold' | 'cyan' = 'gold'): string {
  return `<div class="notice${tone === 'cyan' ? ' notice--cyan' : ''}">${html}</div>`;
}

export function tabs(items: { id: string; label: string; action: string }[], selected: string): string {
  return `<div class="tabs" role="tablist">${items
    .map((t) => `<button class="tab" role="tab" aria-selected="${t.id === selected}" data-action="${t.action}">${escapeHtml(t.label)}</button>`)
    .join('')}</div>`;
}

// ————————————————————————————————————————————— Monnaies

export const CURRENCY_NAME: Record<Currency, string> = { shards: 'Éclats', prisms: 'Prismes' };
const CURRENCY_ICON: Record<Currency, string> = { shards: eclatUrl, prisms: prismeUrl };

/** Icône d'une monnaie : le PNG fourni, utilisé tel quel. */
export function coin(currency: Currency, cls = ''): string {
  return `<img class="coin coin--${currency}${cls ? ` ${cls}` : ''}" src="${CURRENCY_ICON[currency]}" alt="" width="28" height="28" decoding="async" />`;
}

/** Prix : icône, montant et nom de la monnaie. */
export function price(currency: Currency, amount: number): string {
  return `<span class="price price--${currency}">${coin(currency)}<strong>${formatScore(amount)}</strong><span class="price__l">${CURRENCY_NAME[currency]}</span></span>`;
}

/** Les deux soldes (accueil, boutique, apparences). */
export function walletBar(wallet: Wallet): string {
  const item = (c: Currency): string =>
    `<div class="wallet__item wallet__item--${c}">${coin(c, 'coin--lg')}<div class="wallet__text"><span class="wallet__n" data-wallet="${c}">${formatScore(wallet[c])}</span><span class="wallet__l">${CURRENCY_NAME[c]}</span></div></div>`;
  return `<div class="wallet" role="group" aria-label="Soldes">${item('shards')}<span class="wallet__sep" aria-hidden="true"></span>${item('prisms')}</div>`;
}
