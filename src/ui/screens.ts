import { LEVEL_DURATION } from '../config/balance';
import { GAME_NAME } from '../config/brand';
import { catalogItem, itemsOfKind, type CatalogItem, type ItemKind } from '../config/catalog';
import { LEVELS } from '../config/levels';
import { TRAILS, trailById } from '../config/trails';
import { BALANCE_VERSION } from '../config/version';
import { formatDateFr } from '../modes/daily';
import { ACHIEVEMENTS, achievementById } from '../progression/achievements';
import { hasLegacyRecords, isLevelUnlocked, legacyDailyList, legacySurvivalBest, type RunReport } from '../progression/progress';
import { balanceOf, isOwned, itemPrice, itemState, type ItemState } from '../progression/shop';
import { SKINS, isSkinOwned, resolveEquipped, unlockAchievementId, unlockCondition, type Skin } from '../progression/skins';
import { skinThumb } from '../render/skinSprites';
import type { SaveData } from '../save/save';
import logoUrl from '../assets/ui/logo.png';
import { CURRENCY_NAME, button, coin, notice, price, screenHead, setting, stat, switchButton, tabs, walletBar } from './components';
import { escapeHtml, formatDelta, formatScore, formatTime, starsHtml } from './format';
import { homeHelp } from './controls';
import { ICONS } from './icons';

/**
 * Écrans de l'interface, générés en HTML à partir des vraies données de la sauvegarde.
 * Aucun texte, score, étoile ou apparence n'est figé : tout vient de `save` et du rapport de partie.
 * Les actions passent par des attributs data-action gérés par délégation dans App ; aucun bouton n'est relié à l'aire de jeu.
 */

export type CollectionTab = 'skins' | 'achievements';

/** Prochain niveau à jouer : le premier débloqué non terminé (sinon le dernier). */
export function nextLevelId(save: SaveData): number {
  const open = LEVELS.find((l) => isLevelUnlocked(save, l.id) && !save.levels[String(l.id)]?.completed);
  return open ? open.id : LEVELS[LEVELS.length - 1].id;
}

// ————————————————————————————————————————————— Accueil

export function homeScreen(save: SaveData, today: string, touch = false): string {
  const legacy = legacySurvivalBest(save);
  const surv =
    save.survival.bestTime > 0
      ? `Record : ${formatTime(save.survival.bestTime)}`
      : legacy
        ? `Record à établir · ancien équilibrage : ${formatTime(legacy.time)}`
        : 'Tenez le plus longtemps possible';
  const banner =
    hasLegacyRecords(save) && save.balanceNoticeSeen < BALANCE_VERSION
      ? notice(
          `Mise à jour : trois nouveaux dangers (astéroïde fragmenté, convoi, laser balayeur), des événements en Survie et au défi,
         et un vaisseau lent au départ qui accélère peu à peu.
         Vos records précédents sont conservés à part (« ancien équilibrage ») et ne sont pas comparés aux nouveaux.
         ${button({ action: 'dismiss-notice', label: 'Compris', variant: 'secondary', size: 'sm' })}`,
          'cyan',
        ).replace('<div class="notice', '<div role="status" class="notice')
      : '';
  const done = LEVELS.filter((l) => save.levels[String(l.id)]?.completed).length;
  const stars = LEVELS.reduce((s, l) => s + (save.levels[String(l.id)]?.stars ?? 0), 0);
  const daily = save.daily[today];
  const dailyHint = daily ? `Aujourd’hui : ${formatTime(daily.bestTime)} · ${formatDateFr(today)}` : `Défi du ${formatDateFr(today)}`;
  const achCount = ACHIEVEMENTS.filter((a) => save.achievements[a.id] !== undefined).length;
  return `
  <div class="panel panel--bare home">
    <div class="home__brand">
      <img class="home__logo" src="${logoUrl}" alt="${escapeHtml(GAME_NAME)}" width="1200" height="341" decoding="async" />
      <p class="sub">Un vaisseau, une orbite, une seule commande : inverser.</p>
    </div>
    <div class="home__menu">
      ${banner}
      ${walletBar(save.wallet)}
      ${button({ action: 'survival', label: 'Survie', sub: surv, icon: 'play', variant: 'primary', size: 'hero' })}
      ${button({ action: 'levels', label: 'Niveaux', sub: `${done}/${LEVELS.length} terminés · ${stars}/${LEVELS.length * 3} étoiles`, icon: 'levels', variant: 'secondary', size: 'row', chevron: true })}
      ${button({ action: 'daily', label: 'Défi quotidien', sub: dailyHint, icon: 'calendar', variant: 'secondary', size: 'row', chevron: true })}
      <div class="btn-row">
        ${button({ action: 'shop', label: 'Boutique', icon: 'shop', variant: 'secondary', size: 'compact' })}
        ${button({ action: 'skins', label: 'Apparences', icon: 'rocket', variant: 'secondary', size: 'compact' })}
      </div>
      <div class="btn-row">
        ${button({ action: 'achievements', label: 'Succès', badge: `${achCount}/${ACHIEVEMENTS.length}`, icon: 'trophy', variant: 'secondary', size: 'compact' })}
        ${button({ action: 'options', label: 'Options', icon: 'gear', variant: 'secondary', size: 'compact' })}
      </div>
      <p class="small home__help">${homeHelp(touch)}</p>
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Niveaux

export function levelsScreen(save: SaveData): string {
  const next = nextLevelId(save);
  const cards = LEVELS.map((l) => {
    const rec = save.levels[String(l.id)];
    const unlocked = isLevelUnlocked(save, l.id);
    const stars = rec?.stars ?? 0;
    const cls = ['level-card'];
    if (rec?.completed) cls.push('level-card--done');
    if (unlocked && l.id === next) cls.push('level-card--next');
    const best = rec?.completed ? `Meilleur : ${formatScore(rec.bestScore)}` : unlocked ? 'À réussir' : 'Verrouillé';
    const state = !unlocked ? ', verrouillé' : l.id === next ? `, prochain niveau, ${stars} étoiles sur 3` : `, ${stars} étoiles sur 3`;
    const body = unlocked
      ? `<span class="level-card__n">${l.id}</span><span class="level-card__name">${escapeHtml(l.name)}</span><span class="stars">${starsHtml(stars)}</span><span class="level-card__best">${escapeHtml(best)}</span>`
      : `<span class="level-card__n">${l.id}</span><span class="level-card__lock">${ICONS.lock}</span><span class="level-card__best">${best}</span>`;
    return `<button class="${cls.join(' ')}" data-action="play-level" data-level="${l.id}" ${unlocked ? '' : 'disabled'}
      aria-label="Niveau ${l.id}, ${escapeHtml(l.name)}${state}">${body}</button>`;
  }).join('');
  return `<div class="panel panel--wide">${screenHead('Niveaux')}
    <p class="sub" style="margin-bottom:14px">${LEVEL_DURATION} secondes par niveau. Survivez jusqu’au bout pour débloquer le suivant ; le score donne les étoiles.</p>
    <div class="levels">${cards}</div>
  </div>`;
}

// ————————————————————————————————————————————— Défi quotidien

function recordList(rows: { date: string; time: number; score: number }[]): string {
  return `<ul class="list">${rows
    .map((d) => `<li class="list__row"><span>${escapeHtml(formatDateFr(d.date))}</span><span>${formatTime(d.time)} · ${formatScore(d.score)} pts</span></li>`)
    .join('')}</ul>`;
}

export function dailyScreen(save: SaveData, today: string): string {
  const rec = save.daily[today];
  const past = Object.keys(save.daily)
    .filter((d) => d !== today)
    .sort()
    .reverse()
    .slice(0, 7)
    .map((d) => ({ date: d, time: save.daily[d].bestTime, score: save.daily[d].bestScore }));
  const old = legacyDailyList(save);
  return `<div class="panel">${screenHead('Défi quotidien')}
    <div class="stack">
      <div class="center"><span class="date-chip">${ICONS.calendar}Défi du ${escapeHtml(formatDateFr(today))} (UTC)</span></div>
      <p class="sub">Règles de la Survie, avec des motifs et des événements générés à partir d’une graine identique pour tous les joueurs aujourd’hui. Vos inversions changent la suite : jouez juste.</p>
      <div class="stats">
        ${stat('Votre meilleur temps', rec ? formatTime(rec.bestTime) : '—')}
        ${stat('Score associé', rec ? formatScore(rec.bestScore) : '—')}
      </div>
      ${button({ action: 'play-daily', label: 'Jouer le défi', icon: 'play', variant: 'primary' })}
    </div>
    ${past.length ? `<h3 class="section-title">Jours précédents</h3>${recordList(past)}` : ''}
    ${old.length ? `<h3 class="section-title">Ancien équilibrage</h3>${recordList(old)}<p class="small" style="text-align:left;margin-top:6px">Obtenus avant la mise à jour : non comparables aux résultats actuels.</p>` : ''}
    <p class="small" style="margin-top:14px">Résultats enregistrés sur cet appareil uniquement. Il n’y a pas de classement en ligne.</p>
  </div>`;
}

// ————————————————————————————————————————————— Apparences et succès


type SkinState = 'equipped' | 'available' | 'locked';

const STATE_LABEL: Record<SkinState, string> = { equipped: 'Équipé', available: 'Disponible', locked: 'Verrouillé' };

function skinState(save: SaveData, skin: Skin): SkinState {
  if (!isSkinOwned(skin, save)) return 'locked';
  return resolveEquipped(save.skin, save).id === skin.id ? 'equipped' : 'available';
}

const stateChip = (st: SkinState): string =>
  `<span class="chip chip--${st}">${st === 'equipped' ? ICONS.check : st === 'locked' ? ICONS.lock : ''}${STATE_LABEL[st]}</span>`;

/** Miniature d'un vaisseau (sprite recoloré) ; à défaut, une icône. */
const shipThumb = (id: string): string => {
  const thumb = skinThumb(id);
  return thumb ? `<img src="${thumb}" alt="" width="64" height="64" decoding="async" />` : ICONS.rocket;
};

function skinCard(save: SaveData, skin: Skin, selected: boolean): string {
  const st = skinState(save, skin);
  return `<button class="skin skin--${st}${selected ? ' skin--selected' : ''}" data-action="select-skin" data-skin="${skin.id}" aria-pressed="${selected}" aria-label="${escapeHtml(skin.name)} — ${STATE_LABEL[st].toLowerCase()}">
    <span class="skin__thumb">${shipThumb(skin.id)}${st === 'locked' ? `<span class="skin__lock">${ICONS.lock}</span>` : ''}</span>
    <span class="skin__name">${escapeHtml(skin.name)}</span>
    ${stateChip(st)}
  </button>`;
}

/** Condition de déblocage précise d'une exclusivité de succès. */
function unlockText(skin: Skin, unlocked: boolean): string {
  const c = unlockCondition(skin);
  if (!c) return unlocked ? 'Disponible.' : 'À acheter dans la boutique.';
  const what = `succès « ${escapeHtml(c.name)} »${c.description ? ` : ${escapeHtml(c.description)}` : ''}`;
  return unlocked ? `Débloquée par le ${what}` : `Pour la débloquer : ${what}`;
}

/** Vaisseaux affichés dans Apparences : ceux que l'on possède, et les exclusivités de succès (verrouillées tant que le succès manque). */
const wardrobe = (save: SaveData): Skin[] => SKINS.filter((k) => isSkinOwned(k, save) || unlockAchievementId(k) !== null);

/** Traînées possédées : sélection rapide sous la grille. */
function trailRow(save: SaveData): string {
  const owned = TRAILS.filter((t) => isOwned(save, t.id));
  const chips = owned
    .map((t) => {
      const on = save.trail === t.id;
      const swatch = t.color === null ? '' : `<i class="swatch" style="background:#${t.color.toString(16).padStart(6, '0')}"></i>`;
      return `<button class="trail-chip${on ? ' trail-chip--on' : ''}" data-action="equip-item" data-item="${t.id}" aria-pressed="${on}">${swatch}${escapeHtml(t.name)}${on ? ICONS.check : ''}</button>`;
    })
    .join('');
  return `<h3 class="section-title">Traînée</h3><div class="trail-row" role="group" aria-label="Traînée équipée">${chips}</div>`;
}

function skinsPanel(save: SaveData, head: string, selectedId?: string): string {
  const equipped = resolveEquipped(save.skin, save);
  const list = wardrobe(save);
  const sel = list.find((k) => k.id === selectedId) ?? equipped;
  const st = skinState(save, sel);
  const action =
    st === 'available'
      ? button({ action: 'equip-skin', label: 'Équiper', icon: 'check', variant: 'primary', attrs: `data-skin="${sel.id}"` })
      : st === 'equipped'
        ? button({ action: 'equip-skin', label: 'Équipé', icon: 'check', variant: 'secondary', attrs: 'disabled' })
        : button({ action: 'equip-skin', label: 'Succès requis', icon: 'lock', variant: 'secondary', attrs: 'disabled' });
  const cards = list.map((k) => skinCard(save, k, k.id === sel.id)).join('');
  return `<div class="panel panel--wide">${head}
    ${walletBar(save.wallet)}
    <div class="skin-stage">
      <div class="skin-preview${st === 'locked' ? ' skin-preview--locked' : ''}">
        <canvas class="skin-preview__canvas" data-skin-preview="${sel.id}" role="img" aria-label="Aperçu de l’apparence ${escapeHtml(sel.name)}"></canvas>
        ${st === 'locked' ? `<span class="skin-preview__lock">${ICONS.lock}</span>` : ''}
      </div>
      <div class="skin-info">
        <h3 class="skin-info__name">${escapeHtml(sel.name)}</h3>
        ${stateChip(st)}
        <p class="skin-info__cond${st === 'locked' ? ' skin-info__cond--locked' : ''}" id="skin-cond">${unlockText(sel, st !== 'locked')}</p>
        ${action}
      </div>
    </div>
    <div class="skins" role="group" aria-label="Apparences">${cards}</div>
    ${trailRow(save)}
    <div class="shop-link">${button({ action: 'shop', label: 'Voir la boutique', icon: 'shop', variant: 'secondary', chevron: true })}</div>
    <p class="small" style="margin-top:12px">Purement esthétiques : aucune apparence ni traînée ne modifie les performances. Les menaces gardent toujours leurs couleurs.</p>
  </div>`;
}

// ————————————————————————————————————————————— Boutique

export type ShopTab = 'ships' | 'trails' | 'packs';

export const SHOP_TABS: { id: ShopTab; label: string; kind: ItemKind }[] = [
  { id: 'ships', label: 'Vaisseaux', kind: 'ship' },
  { id: 'trails', label: 'Traînées', kind: 'trail' },
  { id: 'packs', label: 'Packs', kind: 'pack' },
];

const KIND_LABEL: Record<ItemKind, string> = { ship: 'Vaisseau', trail: 'Traînée', pack: 'Pack' };

/** Couleur d'une traînée (« assortie » : celle du vaisseau équipé). */
function trailColor(save: SaveData, trailId: string): number {
  return trailById(trailId).color ?? resolveEquipped(save.skin, save).colors.trail;
}

const hex6 = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function trailSwatch(color: number): string {
  return `<svg class="trail-swatch" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 50C14 24 34 10 56 14" fill="none" stroke="${hex6(color)}" stroke-opacity="0.25" stroke-width="12" stroke-linecap="round"/><path d="M8 50C14 24 34 10 56 14" fill="none" stroke="${hex6(color)}" stroke-width="5" stroke-linecap="round"/></svg>`;
}

/** Aperçu d'un article : vaisseau (miniature), traînée (trait coloré) ou contenu d'un pack. */
function itemThumb(save: SaveData, item: CatalogItem): string {
  if (item.kind === 'ship') return shipThumb(item.id);
  if (item.kind === 'trail') return trailSwatch(trailColor(save, item.id));
  return (item.contents ?? [])
    .map((id) => {
      const c = catalogItem(id);
      return c ? `<span class="pack-part">${itemThumb(save, c)}</span>` : '';
    })
    .join('');
}

/** Pastille d'état ou de prix d'un article. */
function itemBadge(state: ItemState, item: CatalogItem): string {
  const p = itemPrice(item);
  switch (state) {
    case 'equipped': return `<span class="chip chip--equipped">${ICONS.check}Équipé</span>`;
    case 'owned': return '<span class="chip chip--owned">Possédé</span>';
    case 'achievement': return `<span class="chip chip--locked">${ICONS.lock}Succès requis</span>`;
    case 'soon': return `<span class="chip chip--soon">Bientôt disponible</span>${p ? price(p.currency, p.amount) : ''}`;
    default: return p ? price(p.currency, p.amount) : '';
  }
}

function itemCard(save: SaveData, item: CatalogItem, selected: boolean): string {
  const st = itemState(save, item);
  return `<button class="skin item item--${st}${selected ? ' skin--selected' : ''}" data-action="select-item" data-item="${item.id}" aria-pressed="${selected}" aria-label="${escapeHtml(item.name)}">
    <span class="skin__thumb${item.kind === 'pack' ? ' skin__thumb--pack' : ''}">${itemThumb(save, item)}${st === 'achievement' || st === 'soon' ? `<span class="skin__lock">${ICONS.lock}</span>` : ''}</span>
    <span class="skin__name">${escapeHtml(item.name)}</span>
    <span class="item__badge">${itemBadge(st, item)}</span>
  </button>`;
}

/** Note explicative et bouton d'action selon l'état de l'article. */
function itemAction(save: SaveData, item: CatalogItem, st: ItemState): { note: string; button: string } {
  const p = itemPrice(item);
  switch (st) {
    case 'buy':
      return { note: '', button: button({ action: 'buy', label: 'Acheter', icon: 'shop', variant: 'primary', attrs: `data-item="${item.id}"` }) };
    case 'insufficient': {
      const missing = p ? p.amount - balanceOf(save, p.currency) : 0;
      return {
        note: p ? `Il vous manque ${formatScore(missing)} ${CURRENCY_NAME[p.currency]}.` : '',
        button: button({ action: 'buy', label: 'Solde insuffisant', icon: 'lock', variant: 'secondary', attrs: 'disabled' }),
      };
    }
    case 'achievement': {
      const a = item.acquire.type === 'achievement' ? achievementById(item.acquire.id) : undefined;
      return {
        note: a ? `Succès requis : « ${escapeHtml(a.name)} » : ${escapeHtml(a.description)}` : 'Exclusivité d’un succès.',
        button: button({ action: 'buy', label: 'Succès requis', icon: 'lock', variant: 'secondary', attrs: 'disabled' }),
      };
    }
    case 'soon':
      return {
        note: 'Article premium (Prismes), destiné aux futurs achats. Aucun paiement n’est actif dans cette version.',
        button: button({ action: 'buy', label: 'Bientôt disponible', icon: 'lock', variant: 'secondary', attrs: 'disabled' }),
      };
    case 'owned':
      return item.kind === 'pack'
        ? { note: '', button: button({ action: 'buy', label: 'Possédé', icon: 'check', variant: 'secondary', attrs: 'disabled' }) }
        : { note: '', button: button({ action: 'equip-item', label: 'Équiper', icon: 'check', variant: 'primary', attrs: `data-item="${item.id}"` }) };
    default:
      return { note: '', button: button({ action: 'buy', label: 'Équipé', icon: 'check', variant: 'secondary', attrs: 'disabled' }) };
  }
}

/** Vaisseau et traînée affichés dans l'aperçu animé d'un article. */
function previewOf(save: SaveData, item: CatalogItem): { skin: string; trail: number | null } {
  if (item.kind === 'ship') return { skin: item.id, trail: null };
  if (item.kind === 'trail') return { skin: resolveEquipped(save.skin, save).id, trail: trailColor(save, item.id) };
  const parts = (item.contents ?? []).map((id) => catalogItem(id)).filter((c): c is CatalogItem => !!c);
  const ship = parts.find((c) => c.kind === 'ship');
  const trail = parts.find((c) => c.kind === 'trail');
  return { skin: ship?.id ?? resolveEquipped(save.skin, save).id, trail: trail ? trailColor(save, trail.id) : null };
}

export function shopScreen(save: SaveData, tab: ShopTab, selectedId?: string): string {
  const kind = SHOP_TABS.find((t) => t.id === tab)?.kind ?? 'ship';
  const items = itemsOfKind(kind);
  // Par défaut : l'article équipé de l'onglet (sinon le premier)
  const sel = items.find((i) => i.id === selectedId) ?? items.find((i) => itemState(save, i) === 'equipped') ?? items[0];
  const st = itemState(save, sel);
  const act = itemAction(save, sel, st);
  const prev = previewOf(save, sel);
  const p = itemPrice(sel);
  const contents =
    sel.kind === 'pack'
      ? `<ul class="pack-list">${(sel.contents ?? [])
          .map((id) => {
            const c = catalogItem(id);
            return c ? `<li>${KIND_LABEL[c.kind]} ${escapeHtml(c.name)}${isOwned(save, id) ? ' <span class="chip chip--owned">Possédé</span>' : ''}</li>` : '';
          })
          .join('')}</ul>`
      : '';
  const owned = sel.kind === 'pack' ? (sel.contents ?? []).filter((id) => isOwned(save, id)).length : 0;
  const packNote = owned > 0 && st !== 'owned' ? `<p class="shop-note">Contient ${owned} article${owned > 1 ? 's' : ''} que vous possédez déjà.</p>` : '';
  return `<div class="panel panel--wide">${screenHead('Boutique')}
    ${walletBar(save.wallet)}
    ${tabs(SHOP_TABS.map((t) => ({ id: t.id, label: t.label, action: `tab-shop-${t.id}` })), tab)}
    <div class="skin-stage">
      <div class="skin-preview${st === 'achievement' || st === 'soon' ? ' skin-preview--locked' : ''}">
        <canvas class="skin-preview__canvas" data-skin-preview="${prev.skin}"${prev.trail === null ? '' : ` data-trail-color="${prev.trail}"`} role="img" aria-label="Aperçu : ${escapeHtml(sel.name)}"></canvas>
      </div>
      <div class="skin-info">
        <span class="kind-label">${KIND_LABEL[sel.kind]}</span>
        <h3 class="skin-info__name">${escapeHtml(sel.name)}</h3>
        <p class="skin-info__cond">${escapeHtml(sel.blurb)}</p>
        ${contents}
        <div class="item__badge item__badge--lg">${itemBadge(st, sel)}</div>
        ${p && (st === 'buy' || st === 'insufficient') ? `<p class="shop-balance">Solde : <strong>${formatScore(balanceOf(save, p.currency))}</strong> ${CURRENCY_NAME[p.currency]}</p>` : ''}
        ${act.note ? `<p class="shop-note" id="item-note">${act.note}</p>` : ''}
        ${packNote}
        ${act.button}
      </div>
    </div>
    <div class="skins" role="group" aria-label="${SHOP_TABS.find((t) => t.id === tab)?.label ?? ''}">${items.map((i) => itemCard(save, i, i.id === sel.id)).join('')}</div>
    <p class="small" style="margin-top:12px">Les achats sont purement cosmétiques : mêmes vitesses et mêmes hitboxes dans tous les modes. Les Éclats se gagnent en jouant.</p>
  </div>`;
}

/** Confirmation d'un achat en Éclats : récapitulatif, solde avant / après. */
export function confirmPurchaseScreen(save: SaveData, itemId: string): string {
  const item = catalogItem(itemId);
  const p = item ? itemPrice(item) : null;
  if (!item || !p) {
    return `<div class="panel panel--pause"><h2 class="title">Achat impossible</h2>${button({ action: 'shop', label: 'Retour à la boutique', variant: 'primary', attrs: 'data-autofocus' })}</div>`;
  }
  const bal = balanceOf(save, p.currency);
  return `<div class="panel panel--pause">
    <h2 class="title">Confirmer l’achat</h2>
    <p class="sub" style="margin:4px 0 10px">${KIND_LABEL[item.kind]} ${escapeHtml(item.name)}</p>
    <div class="confirm__thumb">${itemThumb(save, item)}</div>
    <div class="confirm__row"><span>Prix</span>${price(p.currency, p.amount)}</div>
    <div class="confirm__row"><span>Solde actuel</span><strong>${formatScore(bal)}</strong></div>
    <div class="confirm__row"><span>Solde après l’achat</span><strong>${formatScore(Math.max(0, bal - p.amount))}</strong></div>
    <div class="btn-stack" style="margin-top:14px">
      ${button({ action: 'confirm-buy', label: 'Confirmer l’achat', icon: 'check', variant: 'primary', attrs: `data-item="${item.id}" data-autofocus` })}
      ${button({ action: 'shop', label: 'Annuler', variant: 'ghost' })}
    </div>
  </div>`;
}

export function collectionScreen(save: SaveData, tab: CollectionTab, selected?: string): string {
  const count = ACHIEVEMENTS.filter((a) => save.achievements[a.id] !== undefined).length;
  const head = `${screenHead(tab === 'skins' ? 'Apparences' : 'Succès')}${tabs(
    [
      { id: 'skins', label: 'Apparences', action: 'tab-skins' },
      { id: 'achievements', label: `Succès ${count}/${ACHIEVEMENTS.length}`, action: 'tab-achievements' },
    ],
    tab,
  )}`;
  if (tab === 'skins') return skinsPanel(save, head, selected);
  const achs = ACHIEVEMENTS.map((a) => {
    const done = save.achievements[a.id] !== undefined;
    const skin = SKINS.find((s) => unlockAchievementId(s) === a.id);
    return `<div class="ach${done ? ' ach--done' : ''}"><div class="ach__medal">${done ? ICONS.star : ICONS.lock}</div>
      <div><div class="ach__t">${escapeHtml(a.name)}<span class="sr-only">${done ? ' — obtenu' : ' — à débloquer'}</span></div>
      <div class="ach__d">${escapeHtml(a.description)}${skin ? ` — apparence « ${escapeHtml(skin.name)} »` : ''}</div></div></div>`;
  }).join('');
  return `<div class="panel panel--wide">${head}${achs}</div>`;
}

// ————————————————————————————————————————————— Options

export function optionsScreen(save: SaveData): string {
  const o = save.options;
  const vol = Math.round(o.volume * 100);
  return `<div class="panel">${screenHead('Options')}
    ${setting('sound', 'Son', o.muted ? 'Coupé' : 'Effets sonores procéduraux', switchButton('opt-sound', 'toggle-sound', !o.muted, 'Son'))}
    ${setting('volume', 'Volume', `${vol} %`, `<input id="opt-volume" class="slider" type="range" min="0" max="100" step="5" value="${vol}" data-input="volume" aria-label="Volume" style="--fill:${vol}%" />`, 'opt-volume-val')}
    ${setting('leaf', 'Effets réduits', 'Sans secousses, flash, traînées ni animations décoratives', switchButton('opt-fx', 'toggle-fx', o.reducedEffects, 'Effets réduits'))}
    ${setting('help', 'Astuce de départ', 'Réafficher l’explication des commandes', button({ action: 'reset-tutorial', label: 'Réafficher', variant: 'secondary', size: 'sm' }))}
    <h3 class="section-title">Progression</h3>
    ${button({ action: 'ask-reset', label: 'Effacer toute la progression…', icon: 'trash', variant: 'danger' })}
    <p class="small" style="margin-top:14px">Sauvegarde locale (cet appareil, ce navigateur). ${escapeHtml(GAME_NAME)} v${__APP_VERSION__}</p>
  </div>`;
}

export function confirmResetScreen(): string {
  return `<div class="panel panel--pause">
    <h2 class="title title--coral" style="margin-bottom:8px">Effacer la progression ?</h2>
    <p class="sub" style="margin-bottom:16px">Niveaux, étoiles, records, défis, succès et apparences seront supprimés définitivement. Les options sont conservées.</p>
    <div class="btn-stack">
      ${button({ action: 'options', label: 'Annuler', variant: 'primary', attrs: 'data-autofocus' })}
      ${button({ action: 'confirm-reset', label: 'Oui, tout effacer', icon: 'trash', variant: 'danger' })}
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Pause

export function pauseScreen(modeLabel: string): string {
  return `<div class="panel panel--pause">
    <h2 class="title">Pause</h2>
    <p class="sub" style="margin:4px 0 16px">${escapeHtml(modeLabel)}</p>
    <div class="btn-stack">
      ${button({ action: 'resume', label: 'Reprendre', icon: 'play', variant: 'primary', attrs: 'data-autofocus' })}
      ${button({ action: 'restart', label: 'Recommencer', icon: 'replay', variant: 'secondary' })}
      ${button({ action: 'quit', label: 'Accueil', icon: 'home', variant: 'ghost' })}
    </div>
    <p class="small" style="margin-top:14px">La reprise commence par un bref compte à rebours. Le temps en pause ne compte pas.</p>
  </div>`;
}

// ————————————————————————————————————————————— Résultat

function achievementsNotice(report: RunReport): string {
  return report.achievements
    .map((a) => {
      const skin = SKINS.find((s) => unlockAchievementId(s) === a.id);
      return notice(`Succès : <strong>${escapeHtml(a.name)}</strong>${skin ? ` — apparence « ${escapeHtml(skin.name)} » débloquée` : ''}`);
    })
    .join('');
}

/**
 * Éclats gagnés pendant la partie, avec leur origine et le solde après la partie.
 * Les montants viennent du rapport de fin de partie (crédités une seule fois) : ouvrir ou réafficher l'écran ne crédite rien.
 */
function rewardsBlock(report: RunReport): string {
  const lr = report.levelReward;
  const rows: [string, number][] = [];
  if (report.orbitShards > 0) rows.push(['Éclats collectés sur l’orbite', report.orbitShards]);
  if (lr) {
    if (lr.firstClear > 0) rows.push(['Première réussite du niveau', lr.firstClear]);
    if (lr.newStars > 0) rows.push([`Nouvelle${lr.newStars > 1 ? 's' : ''} étoile${lr.newStars > 1 ? 's' : ''} (${lr.newStars} × ${lr.starReward / lr.newStars})`, lr.starReward]);
    if (lr.repeatClear > 0) rows.push(['Réussite répétée', lr.repeatClear]);
  }
  const total = rows.reduce((t, r) => t + r[1], 0);
  if (rows.length === 0) return '';
  return `<div class="reward" aria-label="Éclats gagnés">
    <div class="reward__head">${coin('shards', 'coin--xl')}<div><div class="reward__k">Éclats gagnés</div><div class="reward__v">+${formatScore(total)}</div></div></div>
    <ul class="reward__list">${rows.map(([label, n]) => `<li><span>${escapeHtml(label)}</span><b>+${formatScore(n)}</b></li>`).join('')}</ul>
    <div class="reward__balance">Nouveau solde <strong>${formatScore(report.shardsBalance)}</strong> ${CURRENCY_NAME.shards}</div>
  </div>`;
}

/** Rejouer : bouton principal, actif après la courte protection contre les clics accidentels (`data-replay`). */
const replayButton = (): string => button({ action: 'replay', label: 'Rejouer', icon: 'replay', variant: 'primary', attrs: 'data-replay disabled' });

export function resultScreen(report: RunReport, hasNextLevel: boolean): string {
  const r = report.run;
  if (r.mode === 'level') {
    const level = LEVELS.find((l) => l.id === r.levelId);
    const name = level ? `Niveau ${level.id} — ${level.name}` : 'Niveau';
    if (r.outcome === 'complete') {
      const nextBtn = hasNextLevel ? button({ action: 'next-level', label: 'Niveau suivant', icon: 'chevron', variant: 'secondary' }) : '';
      const best = report.newBestScore && report.previousBestScore > 0 ? report.previousBestScore : Math.max(r.score, report.previousBestScore);
      return `<div class="panel">
        <h2 class="title title--cyan">Niveau réussi !</h2>
        <p class="sub">${escapeHtml(name)}</p>
        <div class="result__stars"><span class="stars stars--lg" role="img" aria-label="${report.stars} étoiles sur 3">${starsHtml(report.stars)}</span></div>
        <div class="result__hero${report.newBestScore ? ' result__hero--gold' : ''}">${formatScore(r.score)}</div>
        <p class="result__score">points${report.newBestScore ? ' · meilleur score' : ''}</p>
        <div class="stats">
          ${stat(report.newBestScore && report.previousBestScore > 0 ? 'Ancien meilleur' : 'Meilleur score', formatScore(best))}
          ${stat('Étoiles', `${report.stars} / 3`, report.stars === 3)}
        </div>
        ${level && report.stars < 3 ? `<p class="small" style="margin-top:8px">Seuils d’étoiles : ${level.stars.map(formatScore).join(' · ')} points</p>` : ''}
        ${rewardsBlock(report)}
        ${report.unlockedLevel ? notice(`Niveau ${report.unlockedLevel} débloqué !`, 'cyan') : ''}
        ${!hasNextLevel ? notice('Vous avez terminé le dernier niveau. Bravo !', 'cyan') : ''}
        ${achievementsNotice(report)}
        <div class="btn-stack result__actions">
          ${replayButton()}
          ${nextBtn}
          ${button({ action: 'levels', label: 'Niveaux', icon: 'levels', variant: 'ghost' })}
        </div>
      </div>`;
    }
    return `<div class="panel">
      <h2 class="title title--coral">Collision</h2>
      <p class="sub">${escapeHtml(name)}</p>
      <div class="result__hero">${formatTime(r.time)}</div>
      <p class="result__score">tenu sur ${formatTime(LEVEL_DURATION, 0)} · score<strong>${formatScore(r.score)}</strong></p>
      <p class="sub" style="margin-bottom:6px">Survivez jusqu’à la fin du chrono pour débloquer la suite.</p>
      ${achievementsNotice(report)}
      <div class="btn-stack result__actions">${replayButton()}${button({ action: 'levels', label: 'Niveaux', icon: 'levels', variant: 'ghost' })}</div>
    </div>`;
  }

  const isDaily = r.mode === 'daily';
  const record = report.newRecord && report.previousBestTime > 0;
  const diff = r.time - report.previousBestTime;
  const best = report.newRecord ? r.time : report.previousBestTime;
  const heading = record
    ? `<div class="result__badge">${ICONS.star}<h2 class="title title--gold">Nouveau record</h2></div>`
    : '<h2 class="title title--coral">Collision</h2>';
  return `<div class="panel">
    ${heading}
    <p class="sub">${isDaily && r.date ? `Défi du ${escapeHtml(formatDateFr(r.date))} (UTC)` : 'Survie'}</p>
    <div class="result__hero${report.newRecord ? ' result__hero--gold' : ''}">${formatTime(r.time)}</div>
    <p class="result__score">score<strong>${formatScore(r.score)}</strong></p>
    <div class="stats">
      ${record ? stat('Record précédent', formatTime(report.previousBestTime)) : stat(isDaily ? 'Meilleur du jour' : 'Record', formatTime(best))}
      ${stat('Écart avec le record précédent', report.previousBestTime > 0 ? formatDelta(diff) : '—')}
    </div>
    ${rewardsBlock(report)}
    ${report.legacyBestTime > 0 ? `<p class="small" style="margin-top:8px">Ancien équilibrage : ${formatTime(report.legacyBestTime)} (non comparable)</p>` : ''}
    ${achievementsNotice(report)}
    <div class="btn-stack result__actions">${replayButton()}${button({ action: 'home', label: 'Accueil', icon: 'home', variant: 'ghost' })}</div>
  </div>`;
}
