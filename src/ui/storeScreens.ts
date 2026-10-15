import { formatEuros, packById, PRISM_PACKS } from '../config/monetization';
import { DAILY_RANKING } from '../config/rewards';
import type { PurchaseState, StoreAvailability } from '../monetization/store';
import { button, coin, notice } from './components';
import { escapeHtml, formatScore } from './format';

/**
 * Boutique : onglet « Prismes » (achats réels). Aucun message de réussite avant la confirmation du service ; tout achat est facultatif ; les prix en euros
 * sont indicatifs (le prix final est celui de la boutique de la plateforme).
 */
export interface StoreView {
  availability: StoreAvailability;
  state: PurchaseState;
  /** Solde de Prismes CONFIRMÉ par le service (null : pas encore connu). */
  confirmedPrisms: number | null;
  /** Le fournisseur sait restaurer des achats (plugin natif). */
  canRestore: boolean;
  /** Plateforme de facturation, pour le libellé (« App Store », « Google Play », « page de paiement sécurisée »). */
  storeName: string;
}

export const STORE_NAMES = { apple: 'App Store', google: 'Google Play', web: 'page de paiement sécurisée' } as const;

const STATUS_TEXT: Record<string, { tone: 'ok' | 'wait' | 'bad' | 'info'; title: string }> = {
  preparing: { tone: 'wait', title: 'Préparation de l’achat…' },
  purchasing: { tone: 'wait', title: 'Achat en cours dans la boutique…' },
  verifying: { tone: 'wait', title: 'Confirmation par le service…' },
  restoring: { tone: 'wait', title: 'Restauration…' },
  pending: { tone: 'wait', title: 'Paiement en attente' },
  success: { tone: 'ok', title: 'Achat confirmé' },
  restored: { tone: 'ok', title: 'Restauration terminée' },
  cancelled: { tone: 'info', title: 'Achat annulé' },
  error: { tone: 'bad', title: 'Achat non terminé' },
};

export function purchaseStatusHtml(s: PurchaseState): string {
  const t = STATUS_TEXT[s.status];
  if (!t) return '';
  const role = t.tone === 'bad' ? 'alert' : 'status';
  return `<div class="notice store-status store-status--${t.tone}" role="${role}"><strong>${t.title}</strong>${s.message ? `<span>${escapeHtml(s.message)}</span>` : ''}</div>`;
}

export function privacyHtml(): string {
  return `<details class="store-privacy"><summary>Confidentialité, achats et publicités</summary>
    <p class="small"><strong>Achats</strong> : facultatifs. Le paiement se fait dans la fenêtre de votre boutique (App Store, Google Play ou page de paiement du prestataire) : le jeu ne reçoit ni ne conserve aucune donnée de carte. Le service reçoit seulement l’identifiant de la transaction et un jeton lié à votre compte pour la vérifier auprès du fournisseur et créditer vos Prismes. Les remboursements accordés par la boutique retirent les Prismes concernés (jamais sous zéro).</p>
    <p class="small"><strong>Publicité récompensée</strong> : jamais imposée, proposée seulement après votre première mort en Survie, et seulement si une publicité est disponible. Un formulaire de consentement de la plateforme peut s’afficher avant la première publicité ; la régie publicitaire traite alors des données selon votre choix. Refuser n’enlève rien au jeu.</p>
    <p class="small">Un profil invité joue normalement, sans compte ; un compte connecté n’est requis que pour acheter des Prismes.</p>
  </details>`;
}

/** Contenu de l'onglet « Prismes ». */
export function prismShopHtml(v: StoreView): string {
  const av = v.availability;
  const busy = ['preparing', 'purchasing', 'verifying', 'restoring'].includes(v.state.status);
  const balance = v.confirmedPrisms !== null ? `<p class="store-balance">${coin('prisms')} Solde confirmé : <strong>${formatScore(v.confirmedPrisms)}</strong> Prismes</p>` : '';
  const why = av.reason
    ? `<div class="notice" role="status">${escapeHtml(av.reason)}${av.fix === 'account' ? ` ${button({ action: 'prisms-account', label: 'Ouvrir Compte', icon: 'gear', variant: 'secondary', size: 'sm' })}` : ''}</div>`
    : '';
  const cards = PRISM_PACKS.map((p) => {
    const best = p.id === 'grand';
    return `<div class="pack-card${best ? ' pack-card--best' : ''}">
      <div class="pack-card__gem">${coin('prisms', 'coin--xl')}</div>
      <div class="pack-card__n">${formatScore(p.prisms)} <span>Prismes</span></div>
      <div class="pack-card__name">${escapeHtml(p.name)}</div>
      <div class="pack-card__price">${formatEuros(p.priceCents)}</div>
      ${button({ action: 'prisms-buy', label: 'Acheter', icon: 'shop', variant: 'primary', size: 'sm', attrs: `data-pack="${p.id}" aria-label="Acheter ${p.prisms} Prismes, ${formatEuros(p.priceCents)}"${av.canBuy && !busy ? '' : ' disabled'}` })}
    </div>`;
  }).join('');
  const restore = v.canRestore ? `<div class="btn-row">${button({ action: 'prisms-restore', label: 'Restaurer mes achats', icon: 'replay', variant: 'secondary', size: 'sm', attrs: busy || !av.canBuy ? 'disabled' : '' })}</div>` : '';
  return `${balance}
    ${purchaseStatusHtml(v.state)}
    ${why}
    <h3 class="section-title">${coin('prisms')} Acheter des Prismes</h3>
    <div class="pack-grid" role="list">${cards}</div>
    ${restore}
    <p class="small">Prix indicatifs en euros : le prix final est affiché par la ${escapeHtml(v.storeName)}. Les Prismes achetés et les Prismes gagnés (calendrier, Top 10 du défi quotidien, drop rare) sont <strong>identiques</strong> : ils servent aux cosmétiques premium (Néon 150, Nébuleuse 75, pack 200) et aux reprises (5 puis 10). Aucun avantage de jeu : les achats sont facultatifs et aucune publicité n’est imposée. Top 10 du défi : jusqu’à ${DAILY_RANKING.prizes[0].prisms} Prismes par jour, gratuitement.</p>
    ${privacyHtml()}`;
}

/** Confirmation avant le paiement : rappel du pack, du prix indicatif et de ce qui se passe ensuite. */
export function confirmPrismsScreen(packId: string, storeName: string): string {
  const p = packById(packId);
  if (!p) return '<div class="panel panel--pause"><p class="sub">Pack inconnu.</p></div>';
  return `<div class="panel panel--pause">
    <h2 class="title title--gold">Acheter des Prismes</h2>
    <div class="confirm">
      <div class="confirm__row"><span>Pack</span><strong>${escapeHtml(p.name)}</strong></div>
      <div class="confirm__row"><span>Prismes</span><strong>${formatScore(p.prisms)}</strong></div>
      <div class="confirm__row"><span>Prix indicatif</span><strong>${formatEuros(p.priceCents)}</strong></div>
    </div>
    <p class="small">Vous allez passer au paiement de la ${escapeHtml(storeName)}, qui affichera le prix final. Les Prismes sont crédités <strong>après confirmation du paiement par le service</strong> ; vous pouvez annuler à tout moment avant de payer.</p>
    <div class="btn-stack" style="margin-top:14px">
      ${button({ action: 'prisms-confirm', label: 'Continuer vers le paiement', icon: 'check', variant: 'primary', attrs: `data-pack="${p.id}" data-autofocus` })}
      ${button({ action: 'prisms-cancel', label: 'Annuler', variant: 'ghost' })}
    </div>
  </div>`;
}

export { notice };
