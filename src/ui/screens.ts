import { LEVEL_DURATION } from '../config/balance';
import { GAME_NAME } from '../config/brand';
import { ACHIEVEMENT_CATEGORIES, type MetricKey } from '../config/achievements';
import { catalogItem, itemsOfKind, type CatalogItem, type ItemKind } from '../config/catalog';
import { CHAPTER, MISSIONS } from '../config/campaign';
import { LEVELS } from '../config/levels';
import { maxStars, missionsCleared, nextMission, totalStars } from '../campaign/progress';
import { trailById } from '../config/trails';
import { BALANCE_VERSION } from '../config/version';
import { formatDateFr } from '../modes/daily';
import { ACHIEVEMENTS, achievementById, achievementCosmetics, achievementProgress } from '../progression/achievements';
import { hasLegacyRecords, isLevelUnlocked, legacyDailyList, legacySurvivalBest, type RunReport } from '../progression/progress';
import { balanceOf, isOwned, itemPrice, itemState, type ItemState } from '../progression/shop';
import { resolveEquipped } from '../progression/skins';
import { skinThumb } from '../render/skinSprites';
import type { LeaderboardResponse, MeResponse, BalancesResponse } from '../net/protocol';
import type { PendingRun } from '../net/leaderboard';
import type { SaveData } from '../save/save';
import logoUrl from '../assets/ui/logo.webp';
import { CURRENCY_NAME, button, coin, notice, price, screenHead, setting, stat, switchButton, tabs, walletBar } from './components';
import { escapeHtml, formatDelta, formatScore, formatTime, starsHtml } from './format';
import { homeHelp } from './controls';
import { ICONS, type IconName } from './icons';

/**
 * Écrans de l'interface, générés en HTML à partir des vraies données de la sauvegarde.
 * Aucun texte, score, étoile ou apparence n'est figé : tout vient de `save` et du rapport de partie.
 * Les actions passent par des attributs data-action gérés par délégation dans App ; aucun bouton n'est relié à l'aire de jeu.
 */

/** Prochain niveau à jouer : le premier débloqué non terminé (sinon le dernier). */
export function nextLevelId(save: SaveData): number {
  const open = LEVELS.find((l) => isLevelUnlocked(save, l.id) && !save.levels[String(l.id)]?.completed);
  return open ? open.id : LEVELS[LEVELS.length - 1].id;
}

// ————————————————————————————————————————————— Accueil

export function homeScreen(save: SaveData, today: string, touch = false, updateAvailable = false): string {
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
  const update = updateAvailable
    ? `<div role="status" class="notice notice--cyan">Une nouvelle version du jeu est disponible. ${button({ action: 'reload-app', label: 'Recharger', variant: 'primary', size: 'sm' })}</div>`
    : '';
  const rewardNotice = save.rewardNotice
    ? `<div role="status" class="notice">Récompenses de succès : <strong>+${formatScore(save.rewardNotice.shards)} Éclats</strong> pour ${save.rewardNotice.count} succès. ${button({ action: 'dismiss-reward-notice', label: 'Compris', variant: 'secondary', size: 'sm' })}</div>`
    : '';
  const cleared = missionsCleared(save);
  const campaignSub = save.campaign.chapterComplete
    ? `${CHAPTER.place} terminé · ${totalStars(save)}/${maxStars()} étoiles`
    : cleared > 0
      ? `${CHAPTER.place} · mission ${nextMission(save)} sur ${MISSIONS.length}`
      : `${CHAPTER.place} · le signal impossible`;
  const daily = save.daily[today];
  const dailyHint = daily ? `Aujourd’hui : ${formatTime(daily.bestTime)} · ${formatDateFr(today)}` : `Défi du ${formatDateFr(today)}`;
  const achCount = ACHIEVEMENTS.filter((a) => save.achievements[a.id] !== undefined).length;
  return `
  <div class="panel panel--bare home">
    <div class="home__brand">
      <img class="home__logo" src="${logoUrl}" alt="${escapeHtml(GAME_NAME)}" width="1200" height="675" decoding="async" />
      <p class="sub">Un vaisseau, une orbite, une seule commande : inverser.</p>
    </div>
    <div class="home__menu">
      ${update}
      ${banner}
      ${rewardNotice}
      ${walletBar(save.wallet)}
      ${button({ action: 'survival', label: 'Survie', sub: surv, icon: 'play', variant: 'primary', size: 'hero' })}
      ${button({ action: 'campaign', label: 'Campagne', sub: campaignSub, icon: 'levels', variant: 'secondary', size: 'row', chevron: true })}
      ${button({ action: 'daily', label: 'Défi quotidien', sub: dailyHint, icon: 'calendar', variant: 'secondary', size: 'row', chevron: true })}
      <div class="btn-row">
        ${button({ action: 'cosmetics', label: 'Cosmétiques', icon: 'shop', variant: 'secondary', size: 'compact' })}
        ${button({ action: 'achievements', label: 'Succès', badge: `${achCount}/${ACHIEVEMENTS.length}`, icon: 'trophy', variant: 'secondary', size: 'compact' })}
      </div>
      <div class="btn-row">
        ${button({ action: 'leaderboard', label: 'Classement', icon: 'podium', variant: 'secondary', size: 'compact' })}
        ${button({ action: 'options', label: 'Options', icon: 'gear', variant: 'secondary', size: 'compact' })}
      </div>
      <p class="small home__help">${homeHelp(touch)}</p>
      <p class="small home__version" data-build="${__BUILD_ID__}">${escapeHtml(GAME_NAME)} v${__APP_VERSION__} · ${__BUILD_ID__}</p>
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
  return `<div class="panel panel--wide">${screenHead('Défis classiques', 'campaign')}
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

// ————————————————————————————————————————————— Cosmétiques (vaisseaux, traînées, packs)

export type CosmeticsTab = 'ships' | 'trails' | 'packs';
export type CosmeticsFilter = 'all' | 'owned' | 'locked';

export const COSMETIC_TABS: { id: CosmeticsTab; label: string; kind: ItemKind }[] = [
  { id: 'ships', label: 'Vaisseaux', kind: 'ship' },
  { id: 'trails', label: 'Traînées', kind: 'trail' },
  { id: 'packs', label: 'Packs', kind: 'pack' },
];

export const COSMETIC_FILTERS: { id: CosmeticsFilter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'owned', label: 'Possédés' },
  { id: 'locked', label: 'À débloquer' },
];

/** Miniature d'un vaisseau (sprite recoloré) ; à défaut, une icône. */
const shipThumb = (id: string): string => {
  const thumb = skinThumb(id);
  return thumb ? `<img src="${thumb}" alt="" width="64" height="64" decoding="async" />` : ICONS.rocket;
};

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

/** Articles d'une catégorie selon le filtre (possédés ou à débloquer). */
export function cosmeticItems(save: SaveData, tab: CosmeticsTab, filter: CosmeticsFilter): CatalogItem[] {
  const kind = COSMETIC_TABS.find((t) => t.id === tab)?.kind ?? 'ship';
  return itemsOfKind(kind).filter((i) => (filter === 'all' ? true : filter === 'owned' ? isOwned(save, i.id) : !isOwned(save, i.id)));
}

/** Menu unique « Cosmétiques » : soldes une seule fois, catégories, filtres, grand aperçu animé, action adaptée. */
export function cosmeticsScreen(save: SaveData, tab: CosmeticsTab, filter: CosmeticsFilter, selectedId?: string): string {
  const items = cosmeticItems(save, tab, filter);
  // Par défaut : l'article équipé de la liste (sinon le premier)
  const sel = items.find((i) => i.id === selectedId) ?? items.find((i) => itemState(save, i) === 'equipped') ?? items[0];
  const head = `${screenHead('Cosmétiques')}
    ${walletBar(save.wallet)}
    ${tabs(COSMETIC_TABS.map((t) => ({ id: t.id, label: t.label, action: `cat-${t.id}` })), tab)}
    <div class="filters" role="group" aria-label="Filtre">${COSMETIC_FILTERS.map((f) => `<button class="filter${f.id === filter ? ' filter--on' : ''}" data-action="filter-${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('')}</div>`;
  if (!sel) {
    return `<div class="panel panel--wide">${head}<p class="sub" style="margin:18px 0">${filter === 'owned' ? 'Vous ne possédez encore aucun article dans cette catégorie.' : 'Tout est débloqué dans cette catégorie.'}</p></div>`;
  }
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
  const ownedParts = sel.kind === 'pack' ? (sel.contents ?? []).filter((id) => isOwned(save, id)).length : 0;
  const packNote = ownedParts > 0 && st !== 'owned' ? `<p class="shop-note">Contient ${ownedParts} article${ownedParts > 1 ? 's' : ''} que vous possédez déjà.</p>` : '';
  return `<div class="panel panel--wide">${head}
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
    <div class="skins" role="group" aria-label="${COSMETIC_TABS.find((t) => t.id === tab)?.label ?? ''}">${items.map((i) => itemCard(save, i, i.id === sel.id)).join('')}</div>
    <p class="small" style="margin-top:12px">Purement cosmétiques : mêmes vitesses et mêmes hitboxes dans tous les modes. Les Éclats se gagnent en jouant et avec les succès.</p>
  </div>`;
}

/** Confirmation d'un achat en Éclats : récapitulatif, solde avant / après. */
export function confirmPurchaseScreen(save: SaveData, itemId: string): string {
  const item = catalogItem(itemId);
  const p = item ? itemPrice(item) : null;
  if (!item || !p) {
    return `<div class="panel panel--pause"><h2 class="title">Achat impossible</h2>${button({ action: 'back-cosmetics', label: 'Retour aux cosmétiques', variant: 'primary', attrs: 'data-autofocus' })}</div>`;
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
      ${button({ action: 'back-cosmetics', label: 'Annuler', variant: 'ghost' })}
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Succès

/** Valeur d'une grandeur, avec son unité (durées en m:ss). */
function metricText(key: MetricKey, v: number): string {
  return key === 'bestSurvival' || key === 'bestDaily' ? formatTime(v, 0) : formatScore(v);
}

/** Cosmétiques débloqués par un succès, en texte (« Vaisseau Glace »). */
function cosmeticRewardText(id: string): string {
  return achievementCosmetics(id)
    .map((c) => `${KIND_LABEL[c.kind]} ${escapeHtml(c.name)}`)
    .join(' · ');
}

/** Menu Succès : progression, récompense (Éclats, cosmétique) et état de chaque succès, par catégorie. */
export function achievementsScreen(save: SaveData): string {
  const done = ACHIEVEMENTS.filter((a) => save.achievements[a.id] !== undefined);
  const earnedShards = done.filter((a) => save.rewarded.includes(a.id)).reduce((t, a) => t + a.shards, 0);
  const sections = ACHIEVEMENT_CATEGORIES.map((cat) => {
    const list = ACHIEVEMENTS.filter((a) => a.category === cat.id);
    const rows = list
      .map((a) => {
        const pr = achievementProgress(save, a);
        const cosm = cosmeticRewardText(a.id);
        const reward = `<span class="price price--shards">${coin('shards')}<strong>+${formatScore(a.shards)}</strong><span class="price__l">${CURRENCY_NAME.shards}</span></span>${cosm ? `<span class="chip chip--owned">${cosm}</span>` : ''}`;
        const state = pr.earned
          ? `<span class="chip chip--equipped">${ICONS.check}Obtenu${pr.rewarded ? ' · récompense reçue' : ''}</span>`
          : `<div class="ach__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${a.target}" aria-valuenow="${Math.floor(pr.value)}"><i style="width:${Math.round(pr.ratio * 100)}%"></i></div><span class="ach__n">${metricText(a.metric, pr.value)} / ${metricText(a.metric, a.target)}</span>`;
        return `<div class="ach${pr.earned ? ' ach--done' : ''}"><div class="ach__medal">${pr.earned ? ICONS.star : ICONS.lock}</div>
          <div class="ach__body"><div class="ach__t">${escapeHtml(a.name)}<span class="sr-only">${pr.earned ? ' — obtenu' : ' — à débloquer'}</span></div>
          <div class="ach__d">${escapeHtml(a.description)}</div>
          <div class="ach__state">${state}</div>
          <div class="ach__reward">${reward}</div></div></div>`;
      })
      .join('');
    const n = list.filter((a) => save.achievements[a.id] !== undefined).length;
    return `<h3 class="section-title">${cat.label} <span class="section-count">${n}/${list.length}</span></h3>${rows}`;
  }).join('');
  return `<div class="panel panel--wide">${screenHead('Succès')}
    <div class="stats">${stat('Succès obtenus', `${done.length} / ${ACHIEVEMENTS.length}`, done.length === ACHIEVEMENTS.length)}${stat('Éclats gagnés', formatScore(earnedShards), false)}</div>
    ${sections}
  </div>`;
}

// ————————————————————————————————————————————— Classement mondial

/** État affiché dans le menu Classement (construit par App ; aucune donnée fictive : tout vient du service). */
export interface LeaderboardView {
  /** Un service de classement est-il configuré pour cette version du jeu ? */
  configured: boolean;
  identity: { nickname: string } | null;
  /** Chargement du classement en cours, ou erreur réseau. */
  loading: boolean;
  error: string | null;
  top: LeaderboardResponse | null;
  me: MeResponse | null;
  balances: BalancesResponse | null;
  /** Version d'équilibrage affichée. */
  balance: number;
  pending: PendingRun[];
  /** Message sur le dernier pseudo saisi (erreur ou confirmation). */
  nickMessage: string | null;
  /** Résultat de Survie local (record actuel). */
  localBest: { time: number; score: number } | null;
}

function pendingRow(p: PendingRun): string {
  const r = p.submission.claimed;
  let label: string;
  let cls: string;
  if (p.status === 'accepted') {
    label = `Validé par le serveur${p.result ? ` — rang ${p.result.rank}${p.result.personalBest ? ' (nouveau meilleur)' : ''}` : ''}`;
    cls = 'lb-pending--ok';
  } else if (p.status === 'rejected') {
    label = `Non validé — ${p.message ?? 'refusé par le serveur'}`;
    cls = 'lb-pending--bad';
  } else {
    label = p.lastError ? 'En attente de connexion (nouvel essai automatique)' : 'En attente d’envoi';
    cls = 'lb-pending--wait';
  }
  return `<li class="lb-pending ${cls}"><strong>${formatTime(r.time)}</strong> · ${formatScore(r.score)} pts<span>${escapeHtml(label)}</span></li>`;
}

export function leaderboardScreen(v: LeaderboardView): string {
  const head = screenHead('Classement');
  const rules = `<p class="small" style="margin-top:12px">Survie, version d’équilibrage ${v.balance}. Critère principal : durée de survie ; le score départage. Seules les parties <strong>rejouées et validées par le serveur</strong> sont classées ; les parties de démonstration ou de test n’en font jamais partie.</p>`;
  const local = v.localBest ? `<div class="stats">${stat('Votre record sur cet appareil', formatTime(v.localBest.time))}${stat('Score associé', formatScore(v.localBest.score))}</div>` : '';
  if (!v.configured) {
    return `<div class="panel panel--wide">${head}
      ${notice('Le classement mondial n’est <strong>pas encore activé</strong> : aucun service n’est configuré pour cette version du jeu. Le jeu reste entièrement jouable ; vos records sont enregistrés sur cet appareil. Voir docs/CLASSEMENT.md pour la mise en service.', 'cyan')}
      ${local}${rules}
    </div>`;
  }
  const nickForm = (action: string, label: string, value: string): string => `<form class="nick-form" data-form="${action}" autocomplete="off" novalidate>
      <label class="sr-only" for="nick-input">Pseudo</label>
      <input id="nick-input" class="input" name="nickname" type="text" minlength="3" maxlength="16" value="${escapeHtml(value)}" placeholder="Votre pseudo" spellcheck="false" autocapitalize="off" />
      ${button({ action, label, icon: 'check', variant: 'primary', size: 'sm', attrs: 'type="submit"' })}
    </form>`;
  const identity = v.identity
    ? `<div class="lb-id"><span class="kind-label">Votre pseudo</span><strong class="lb-id__name">${escapeHtml(v.identity.nickname)}</strong></div>${nickForm('lb-rename', 'Changer', '')}`
    : `<p class="sub" style="margin:10px 0">Choisissez un pseudo pour participer au classement mondial (3 à 16 caractères, visible par tous).</p>${nickForm('lb-register', 'Créer mon profil', '')}`;
  const msg = v.nickMessage ? `<p class="shop-note" role="status" id="nick-msg">${escapeHtml(v.nickMessage)}</p>` : '';
  const me = v.me
    ? v.me.best
      ? `<div class="stats">${stat('Votre rang', `${v.me.best.rank} / ${v.me.total}`, v.me.best.rank <= 3)}${stat('Votre meilleur', `${formatTime(v.me.best.time)} · ${formatScore(v.me.best.score)}`)}</div>`
      : `<p class="sub" style="margin:10px 0">Vous n’êtes pas encore classé pour la version ${v.balance} : jouez une partie de Survie.</p>`
    : '';
  const versions =
    v.balances && v.balances.versions.length > 0
      ? `<div class="filters" role="group" aria-label="Version d’équilibrage">${[...new Set([v.balances.current, ...v.balances.versions.map((x) => x.balance)])]
          .sort((a, b) => b - a)
          .map((b) => `<button class="filter${b === v.balance ? ' filter--on' : ''}" data-action="lb-balance" data-balance="${b}" aria-pressed="${b === v.balance}">Version ${b}${b === v.balances!.current ? ' (actuelle)' : ' · ancien'}</button>`)
          .join('')}</div>`
      : '';
  let table: string;
  if (v.loading) table = '<p class="sub" role="status" style="margin:16px 0">Chargement du classement…</p>';
  else if (v.error) table = `<div role="alert" class="notice">Classement indisponible : ${escapeHtml(v.error)} ${button({ action: 'lb-refresh', label: 'Réessayer', variant: 'secondary', size: 'sm' })}</div>`;
  else if (!v.top || v.top.entries.length === 0) table = '<p class="sub" style="margin:16px 0">Aucun résultat validé pour cette version pour le moment.</p>';
  else {
    table = `<div class="lb-table" role="table" aria-label="Top ${v.top.entries.length}">
      <div class="lb-row lb-row--head" role="row"><span role="columnheader">#</span><span role="columnheader">Pseudo</span><span role="columnheader">Durée</span><span role="columnheader">Score</span></div>
      ${v.top.entries.map((e) => `<div class="lb-row${e.you ? ' lb-row--you' : ''}" role="row"><span class="lb-rank">${e.rank}</span><span class="lb-name">${escapeHtml(e.nickname)}${e.you ? ' <em>(vous)</em>' : ''}</span><span>${formatTime(e.time)}</span><span>${formatScore(e.score)}</span></div>`).join('')}
    </div>
    <p class="small">${v.top.total} joueur${v.top.total > 1 ? 's' : ''} classé${v.top.total > 1 ? 's' : ''} · top ${v.top.entries.length}</p>`;
  }
  const pending = v.pending.length
    ? `<h3 class="section-title">Mes résultats récents</h3><ul class="lb-pending-list">${v.pending.slice().reverse().map(pendingRow).join('')}</ul>${
        v.pending.some((p) => p.status === 'pending') ? button({ action: 'lb-flush', label: 'Envoyer maintenant', icon: 'replay', variant: 'secondary', size: 'sm' }) : button({ action: 'lb-clear', label: 'Effacer la liste', variant: 'ghost', size: 'sm' })
      }`
    : '';
  return `<div class="panel panel--wide">${head}
    ${identity}${msg}${me}${versions}${table}${pending}${local ? `<h3 class="section-title">Sur cet appareil</h3>${local}` : ''}${rules}
  </div>`;
}

/** Statut du résultat mondial de la partie qui vient de finir (écran de résultat de Survie). */
export type RunLbStatus =
  | { kind: 'hidden' }
  | { kind: 'no-identity' }
  | { kind: 'no-ticket' }
  | { kind: 'assisted' }
  | { kind: 'sending' }
  | { kind: 'pending'; offline: boolean }
  | { kind: 'accepted'; rank: number; best: boolean }
  | { kind: 'rejected'; message: string };

export function runLbStatusHtml(st: RunLbStatus): string {
  switch (st.kind) {
    case 'hidden': return '';
    case 'no-identity': return '<p class="lb-status lb-status--info">Classement mondial : choisissez un pseudo dans le menu Classement pour participer.</p>';
    case 'no-ticket': return '<p class="lb-status lb-status--info">Classement mondial : résultat conservé sur cet appareil seulement (aucun ticket de partie disponible : connectez-vous une fois pour en obtenir).</p>';
    case 'assisted': return '<p class="lb-status lb-status--info">Classement mondial : partie de démonstration ou de test, non éligible.</p>';
    case 'sending': return '<p class="lb-status lb-status--wait" role="status">Classement mondial : envoi et validation en cours…</p>';
    case 'pending': return `<p class="lb-status lb-status--wait" role="status">Classement mondial : <strong>en attente</strong> — ${st.offline ? 'hors connexion, nouvel essai automatique' : 'à envoyer'} (pas encore validé).</p>`;
    case 'accepted': return `<p class="lb-status lb-status--ok" role="status">Classement mondial : <strong>validé</strong> — rang ${st.rank}${st.best ? ' (nouveau meilleur résultat)' : ' (votre meilleur reste en place)'}.</p>`;
    case 'rejected': return `<p class="lb-status lb-status--bad" role="alert">Classement mondial : <strong>non validé</strong> — ${escapeHtml(st.message)}</p>`;
  }
}

// ————————————————————————————————————————————— Options

/** Réglage à curseur 0–100 % : `input` identifie le curseur (data-input), `id` sert à mettre à jour l'étiquette sans redessiner l'écran. */
function sliderSetting(icon: IconName, label: string, desc: string, id: string, input: string, value: number): string {
  const pct = Math.round(value * 100);
  // Le curseur occupe toute la largeur sous le libellé (les libellés longs ne sont pas écrasés sur mobile)
  return setting(icon, label, desc, `<input id="${id}" class="slider" type="range" min="0" max="100" step="5" value="${pct}" data-input="${input}" aria-label="${escapeHtml(label)}" style="--fill:${pct}%" />`, `${id}-val`).replace('class="setting"', 'class="setting setting--slider"');
}

/** Description du réglage d'intensité visuelle (écran des options et mise à jour du curseur). */
export function visualIntensityLabel(v: number): string {
  return v <= 0 ? 'Ciel étoilé seul' : `Ambiance de la Survie : ${Math.round(v * 100)} %`;
}

export function optionsScreen(save: SaveData): string {
  const o = save.options;
  const pct = (v: number): string => `${Math.round(v * 100)} %`;
  return `<div class="panel">${screenHead('Options')}
    ${setting('sound', 'Son', o.muted ? 'Coupé (musique et effets)' : 'Musique et effets sonores', switchButton('opt-sound', 'toggle-sound', !o.muted, 'Son'))}
    ${sliderSetting('volume', 'Volume général', pct(o.volume), 'opt-volume', 'volume', o.volume)}
    ${sliderSetting('music', 'Musique', pct(o.musicVolume), 'opt-music', 'music', o.musicVolume)}
    ${sliderSetting('signal', 'Effets sonores', pct(o.sfxVolume), 'opt-sfx', 'sfx', o.sfxVolume)}
    ${sliderSetting('sparkle', 'Intensité visuelle', visualIntensityLabel(o.visualIntensity), 'opt-visual', 'visual', o.visualIntensity)}
    ${setting('leaf', 'Effets réduits', 'Sans secousses, flash, traînées ni animations décoratives', switchButton('opt-fx', 'toggle-fx', o.reducedEffects, 'Effets réduits'))}
    ${setting('help', 'Astuce de départ', 'Réafficher l’explication des commandes', button({ action: 'reset-tutorial', label: 'Réafficher', variant: 'secondary', size: 'sm' }))}
    <h3 class="section-title">Progression</h3>
    ${button({ action: 'ask-reset', label: 'Effacer toute la progression…', icon: 'trash', variant: 'danger' })}
    <p class="small" style="margin-top:14px">Sauvegarde locale (cet appareil, ce navigateur). ${escapeHtml(GAME_NAME)} v${__APP_VERSION__} · version ${__BUILD_ID__}</p>
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

export function pauseScreen(modeLabel: string, campaign = false): string {
  return `<div class="panel panel--pause">
    <h2 class="title">Pause</h2>
    <p class="sub" style="margin:4px 0 16px">${escapeHtml(modeLabel)}</p>
    <div class="btn-stack">
      ${button({ action: 'resume', label: 'Reprendre', icon: 'play', variant: 'primary', attrs: 'data-autofocus' })}
      ${button({ action: 'restart', label: 'Recommencer', icon: 'replay', variant: 'secondary' })}
      ${campaign ? button({ action: 'quit', label: 'Carte des niveaux', icon: 'levels', variant: 'ghost' }) : button({ action: 'quit', label: 'Accueil', icon: 'home', variant: 'ghost' })}
    </div>
    <p class="small" style="margin-top:14px">La reprise commence par un bref compte à rebours. Le temps en pause ne compte pas.</p>
  </div>`;
}

// ————————————————————————————————————————————— Résultat

function achievementsNotice(report: RunReport): string {
  return report.achievements
    .map((a) => {
      const cosm = cosmeticRewardText(a.id);
      return notice(`Succès : <strong>${escapeHtml(a.name)}</strong> — <strong>+${formatScore(a.shards)} Éclats</strong>${cosm ? ` · ${cosm} débloqué` : ''}`);
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

export function resultScreen(report: RunReport, hasNextLevel: boolean, lb: RunLbStatus = { kind: 'hidden' }): string {
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
          ${button({ action: 'levels', label: 'Défis classiques', icon: 'levels', variant: 'ghost' })}
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
      <div class="btn-stack result__actions">${replayButton()}${button({ action: 'levels', label: 'Défis classiques', icon: 'levels', variant: 'ghost' })}</div>
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
    <div id="lb-status">${runLbStatusHtml(lb)}</div>
    ${rewardsBlock(report)}
    ${report.legacyBestTime > 0 ? `<p class="small" style="margin-top:8px">Ancien équilibrage : ${formatTime(report.legacyBestTime)} (non comparable)</p>` : ''}
    ${achievementsNotice(report)}
    <div class="btn-stack result__actions">${replayButton()}${button({ action: 'home', label: 'Accueil', icon: 'home', variant: 'ghost' })}</div>
  </div>`;
}
