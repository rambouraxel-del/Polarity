import { LEVEL_DURATION } from '../config/balance';
import { GAME_NAME } from '../config/brand';
import { ACHIEVEMENT_CATEGORIES, type MetricKey } from '../config/achievements';
import { POWERS } from '../config/powers';
import { prismShopHtml, privacyHtml, type StoreView } from './storeScreens';
import { BONUS, BONUS_LIST, bonusDef, type BonusKind } from '../config/economy';
import { bonusStock, maxAffordable } from '../economy/bonus';
import { chargeProvenance, provisional, spendable } from '../economy/funds';
import { catalogItem, isPremium, itemsOfKind, type CatalogItem, type ItemKind } from '../config/catalog';
import { CHAPTER, MISSIONS } from '../config/campaign';
import { LEVELS } from '../config/levels';
import { maxStars, missionsCleared, nextMission, totalStars } from '../campaign/progress';
import { trailById } from '../config/trails';
import { BALANCE_VERSION } from '../config/version';
import { formatDateFr } from '../modes/daily';
import { ACHIEVEMENTS, achievementProgress, claimableAchievements, claimableMedals, isClaimable } from '../progression/achievements';
import { hasLegacyRecords, isLevelUnlocked, legacyDailyList, legacySurvivalBest, type RunReport } from '../progression/progress';
import { effectivePrice, isOwned, itemPrice, itemState, type ItemState } from '../progression/shop';
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

/** Avertissements de sauvegarde (voir App.saveNotices). */
export interface SaveNotices {
  storageFailed: boolean;
  load: 'corrupt' | 'future' | null;
}

export function homeScreen(save: SaveData, today: string, touch = false, updateAvailable = false, saveNotices: SaveNotices = { storageFailed: false, load: null }, leaderboard = true, rewards: { claimable: number } | null = null): string {
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
  const saveWarning = saveNotices.storageFailed
    ? '<div role="alert" class="notice">Sauvegarde impossible sur ce navigateur (navigation privée, stockage plein ou bloqué) : <strong>votre progression ne sera pas conservée</strong> à la fermeture. Vous pouvez jouer, mais pensez à quitter la navigation privée ou à libérer de l’espace.</div>'
    : '';
  const loadWarning =
    saveNotices.load === 'corrupt'
      ? `<div role="alert" class="notice">Votre sauvegarde précédente était <strong>illisible</strong> : une copie a été mise de côté sur cet appareil et une nouvelle progression a démarré. ${button({ action: 'dismiss-save-notice', label: 'Compris', variant: 'secondary', size: 'sm' })}</div>`
      : saveNotices.load === 'future'
        ? `<div role="status" class="notice">Cette sauvegarde vient d’une <strong>version plus récente</strong> du jeu : elle est lue au mieux et l’original est conservé à part. Rechargez la page pour obtenir la dernière version. ${button({ action: 'dismiss-save-notice', label: 'Compris', variant: 'secondary', size: 'sm' })}</div>`
        : '';
  // Rattrapage de l'ancien système (sauvegardes d'avant les succès récompensés) : Éclats déjà versés, information seulement
  const legacyRewardNotice = save.rewardNotice
    ? `<div role="status" class="notice">Anciennes récompenses de succès : <strong>+${formatScore(save.rewardNotice.shards)} Éclats</strong> déjà versés pour ${save.rewardNotice.count} succès. ${button({ action: 'dismiss-reward-notice', label: 'Compris', variant: 'secondary', size: 'sm' })}</div>`
    : '';
  const toClaim = claimableAchievements(save);
  const claimNotice =
    toClaim.length > 0
      ? `<div role="status" class="notice notice--medal"><span>${coin('medals')}<strong>${formatScore(claimableMedals(save))} Médailles</strong> à récupérer (${toClaim.length} succès).</span> ${button({ action: 'achievements', label: 'Récupérer', icon: 'medal', variant: 'primary', size: 'sm' })}</div>`
      : '';
  const rewardNotice = legacyRewardNotice + claimNotice;
  const cleared = missionsCleared(save);
  const campaignSub = save.campaign.chapterComplete
    ? `${CHAPTER.place} terminé · ${totalStars(save)}/${maxStars()} étoiles`
    : cleared > 0
      ? `${CHAPTER.place} · mission ${nextMission(save)} sur ${MISSIONS.length}`
      : `${CHAPTER.place} · ${CHAPTER.title}`;
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
      ${saveWarning}
      ${loadWarning}
      ${rewardNotice}
      ${walletBar(save.wallet, { prisms: save.economy.managed })}
      ${button({ action: 'survival', label: 'Survie', sub: surv, icon: 'play', variant: 'primary', size: 'hero' })}
      ${button({ action: 'campaign', label: 'Campagne', sub: campaignSub, icon: 'levels', variant: 'secondary', size: 'row', chevron: true })}
      ${button({ action: 'daily', label: 'Défi quotidien', sub: dailyHint, icon: 'calendar', variant: 'secondary', size: 'row', chevron: true })}
      ${rewards ? button({ action: 'loyalty', label: 'Récompenses', sub: rewards.claimable > 0 ? `${rewards.claimable} à récupérer` : 'Calendrier de connexion', badge: rewards.claimable > 0 ? String(rewards.claimable) : undefined, icon: 'sparkle', variant: 'secondary', size: 'row', chevron: true }) : ''}
      <div class="btn-row">
        ${button({ action: 'cosmetics', label: 'Boutique', icon: 'shop', variant: 'secondary', size: 'compact' })}
        ${button({ action: 'achievements', label: 'Succès', badge: `${achCount}/${ACHIEVEMENTS.length}`, icon: 'trophy', variant: 'secondary', size: 'compact' })}
      </div>
      <div class="btn-row">
        ${leaderboard ? button({ action: 'leaderboard', label: 'Classement', icon: 'podium', variant: 'secondary', size: 'compact' }) : ''}
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

export function dailyScreen(save: SaveData, today: string, board = ''): string {
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
    ${board || '<p class="small" style="margin-top:14px">Résultats enregistrés sur cet appareil uniquement. Il n’y a pas de classement en ligne.</p>'}
  </div>`;
}

// ————————————————————————————————————————————— Boutique (cosmétiques en Médailles / Prismes, bonus en Éclats)

export type CosmeticsTab = 'ships' | 'trails' | 'packs' | 'bonus' | 'prisms';
export type CosmeticsFilter = 'all' | 'owned' | 'locked';

export const COSMETIC_TABS: { id: CosmeticsTab; label: string; kind: ItemKind | null }[] = [
  { id: 'ships', label: 'Vaisseaux', kind: 'ship' },
  { id: 'trails', label: 'Traînées', kind: 'trail' },
  { id: 'packs', label: 'Packs', kind: 'pack' },
  { id: 'bonus', label: 'Bonus', kind: null },
  { id: 'prisms', label: 'Prismes', kind: null },
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
function itemBadge(state: ItemState, item: CatalogItem, save?: SaveData): string {
  const p = save ? effectivePrice(save, item) : itemPrice(item);
  switch (state) {
    case 'equipped': return `<span class="chip chip--equipped">${ICONS.check}Équipé</span>`;
    case 'owned': return '<span class="chip chip--owned">Possédé</span>';
    default: return p ? price(p.currency, p.amount) : '';
  }
}

function itemCard(save: SaveData, item: CatalogItem, selected: boolean): string {
  const st = itemState(save, item);
  return `<button class="skin item item--${st}${selected ? ' skin--selected' : ''}" data-action="select-item" data-item="${item.id}" aria-pressed="${selected}" aria-label="${escapeHtml(item.name)}">
    <span class="skin__thumb${item.kind === 'pack' ? ' skin__thumb--pack' : ''}">${itemThumb(save, item)}${st === 'soon' ? `<span class="skin__lock">${ICONS.lock}</span>` : ''}</span>
    <span class="skin__name">${escapeHtml(item.name)}</span>
    <span class="item__badge">${itemBadge(st, item, save)}</span>
  </button>`;
}

/** Note explicative et bouton d'action selon l'état de l'article. */
function itemAction(save: SaveData, item: CatalogItem, st: ItemState): { note: string; button: string } {
  const p = effectivePrice(save, item);
  switch (st) {
    case 'buy':
      return {
        note: p?.currency === 'prisms' ? 'Le débit des Prismes est effectué en ligne par le service, après votre confirmation.' : '',
        button: button({ action: 'buy', label: 'Acheter', icon: 'shop', variant: 'primary', attrs: `data-item="${item.id}"` }),
      };
    case 'insufficient': {
      const missing = p ? p.amount - spendable(save, p.currency) : 0;
      const waiting = p ? provisional(save, p.currency) : 0;
      const how = p?.currency === 'medals' ? ' Les Médailles se gagnent en récupérant vos succès.' : p?.currency === 'prisms' ? ' Les Prismes sont contrôlés par le service.' : '';
      return {
        note: p ? `Il vous manque ${formatScore(missing)} ${CURRENCY_NAME[p.currency]}.${waiting > 0 ? ` ${formatScore(waiting)} ${CURRENCY_NAME[p.currency]} sont en attente de confirmation par le service (dépensables après la synchronisation).` : ''}${how}` : '',
        button: button({ action: 'buy', label: p?.currency === 'medals' ? 'Médailles insuffisantes' : 'Solde insuffisant', icon: 'lock', variant: 'secondary', attrs: 'disabled' }),
      };
    }
    case 'soon':
      return {
        note: 'Article premium : les Prismes ne sont pas encore disponibles dans cette version. Aucun achat n’est possible pour l’instant ; rien n’est débité.',
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
  const kind = COSMETIC_TABS.find((t) => t.id === tab)?.kind;
  if (!kind) return [];
  return itemsOfKind(kind).filter((i) => (filter === 'all' ? true : filter === 'owned' ? isOwned(save, i.id) : !isOwned(save, i.id)));
}

/** Gains encore à confirmer par le service (information : ils ne sont pas encore dépensables). */
function waitingNote(save: SaveData): string {
  if (!save.economy.managed) return '';
  const bits = (['shards', 'medals'] as const).filter((c) => provisional(save, c) > 0).map((c) => `${formatScore(provisional(save, c))} ${CURRENCY_NAME[c]}`);
  return bits.length > 0 ? `<p class="small shop-pending" role="status">En attente de confirmation par le service : ${bits.join(' et ')}. Ces montants seront dépensables après la prochaine synchronisation.</p>` : '';
}

const BONUS_ICON: Record<BonusKind, IconName> = { boost: 'bolt', gel: 'snow' };

/** Règles des bonus, répétées là où l'on achète. */
export function bonusRules(): string {
  const effect = BONUS.activationEnabled ? '' : ' Les effets ne sont pas activés dans cette version : vos charges sont conservées.';
  return `Les charges achetées sont conservées entre les parties et ne disparaissent jamais ; Acheter ne consomme aucune charge. Une charge est consommée à chaque activation réussie ; chaque bonus peut être activé au plus ${BONUS.maxActivationsPerRun} fois pendant la première vie d’une partie de Survie (ce plafond ne limite pas votre stock, au maximum ${BONUS.maxStock} charges par bonus). Boost et Gel ne s’activent pas en même temps. Le <strong>Bouclier</strong> est gratuit : il se charge en collectant ${POWERS.shield.beacons} balises et absorbe un impact. Une partie où vous activez un pouvoir est classée « Avec bonus » ; sans aucune activation, elle reste classée « Sans bonus ».${effect}`;
}

/** Cartes de bonus : stock, prix, achat par lots (Éclats uniquement). */
function bonusCards(save: SaveData): string {
  const prov = chargeProvenance(save);
  return BONUS_LIST.map((b) => {
    const stock = bonusStock(save, b.id);
    const room = BONUS.maxStock - stock;
    const afford = maxAffordable(save, b.id);
    const buttons = BONUS.quantities
      .map((q) => {
        const ok = q <= afford;
        return button({
          action: 'bonus-ask',
          label: `Acheter × ${q}`,
          sub: `${formatScore(q * b.price)} Éclats`,
          icon: 'shop',
          variant: ok ? 'primary' : 'secondary',
          size: 'sm',
          attrs: `data-bonus="${b.id}" data-qty="${q}"${ok ? '' : ' disabled'}`,
        });
      })
      .join('');
    const state = room <= 0 ? 'Inventaire plein.' : afford <= 0 ? `Éclats insuffisants (il vous en faut ${formatScore(b.price)} par charge${provisional(save, 'shards') > 0 ? ' ; une partie de vos gains attend sa confirmation' : ''}).` : '';
    const waiting = prov[b.id].provisional > 0 ? `<span class="chip chip--soon">dont ${prov[b.id].provisional} à confirmer</span>` : '';
    return `<div class="bonus bonus--${b.id}" data-bonus-card="${b.id}">
      <span class="bonus__icon">${ICONS[BONUS_ICON[b.id]]}</span>
      <div class="bonus__body">
        <h4 class="bonus__name">${escapeHtml(b.name)}</h4>
        <p class="bonus__blurb">${escapeHtml(b.blurb)}</p>
        <div class="bonus__meta"><span>Possédés : <strong class="bonus__stock" data-stock="${b.id}">${formatScore(stock)}</strong></span>${waiting}<span>${price('shards', b.price)} <span class="small">par charge</span></span></div>
        <div class="bonus__buy">${buttons}</div>
        ${state ? `<p class="small">${state}</p>` : ''}
      </div>
    </div>`;
  }).join('');
}

/** Une grille de cartes d'articles. */
const itemGrid = (save: SaveData, items: CatalogItem[], selectedId: string, label: string): string =>
  `<div class="skins" role="group" aria-label="${escapeHtml(label)}">${items.map((i) => itemCard(save, i, i.id === selectedId)).join('')}</div>`;

/** Menu unique « Boutique » : soldes, catégories, filtres, aperçu animé et action adaptée ; cosmétiques en Médailles et premium en Prismes séparés ; Bonus en Éclats. */
export function cosmeticsScreen(save: SaveData, tab: CosmeticsTab, filter: CosmeticsFilter, selectedId?: string, message: { kind: 'ok' | 'error'; text: string } | null = null, store?: StoreView): string {
  const msg = message ? `<div role="${message.kind === 'error' ? 'alert' : 'status'}" class="notice${message.kind === 'ok' ? ' notice--cyan' : ''}">${escapeHtml(message.text)}</div>` : '';
  const wallet = walletBar(save.wallet, { prisms: save.economy.managed });
  const tabBar = tabs(COSMETIC_TABS.map((t) => ({ id: t.id, label: t.label, action: `cat-${t.id}` })), tab);
  if (tab === 'prisms' && store) {
    return `<div class="panel panel--wide">${screenHead('Boutique')}
      ${msg}
      ${wallet}
      ${tabBar}
      ${prismShopHtml(store)}
    </div>`;
  }
  if (tab === 'bonus') {
    return `<div class="panel panel--wide">${screenHead('Boutique')}
      ${msg}
      ${wallet}
      ${waitingNote(save)}
      ${tabBar}
      <h3 class="section-title">${coin('shards')} Bonus · en Éclats</h3>
      <div class="bonus-list">${bonusCards(save)}</div>
      <p class="small" style="margin-top:12px">${bonusRules()}</p>
    </div>`;
  }
  const items = cosmeticItems(save, tab, filter);
  // Par défaut : l'article équipé de la liste (sinon le premier)
  const sel = items.find((i) => i.id === selectedId) ?? items.find((i) => itemState(save, i) === 'equipped') ?? items[0];
  const head = `${screenHead('Boutique')}
    ${msg}
    ${wallet}
    ${waitingNote(save)}
    ${tabBar}
    <div class="filters" role="group" aria-label="Filtre">${COSMETIC_FILTERS.map((f) => `<button class="filter${f.id === filter ? ' filter--on' : ''}" data-action="filter-${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('')}</div>`;
  if (!sel) {
    return `<div class="panel panel--wide">${head}<p class="sub" style="margin:18px 0">${filter === 'owned' ? 'Vous ne possédez encore aucun article dans cette catégorie.' : 'Tout est débloqué dans cette catégorie.'}</p></div>`;
  }
  const st = itemState(save, sel);
  const act = itemAction(save, sel, st);
  const prev = previewOf(save, sel);
  const p = effectivePrice(save, sel);
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
  const packNote = ownedParts > 0 && st !== 'owned' ? `<p class="shop-note">Vous possédez déjà ${ownedParts} article${ownedParts > 1 ? 's' : ''} de ce pack : le prix affiché est ajusté, vous ne repayez rien.</p>` : '';
  const regular = items.filter((i) => !isPremium(i));
  const premium = items.filter((i) => isPremium(i));
  const medalGrid = regular.length > 0 ? `<h3 class="section-title">${coin('medals')} En Médailles</h3>${itemGrid(save, regular, sel.id, 'Cosmétiques en Médailles')}` : '';
  const prismGrid = premium.length > 0 ? `<h3 class="section-title">${coin('prisms')} Premium · en Prismes</h3>${itemGrid(save, premium, sel.id, 'Cosmétiques premium en Prismes')}` : '';
  return `<div class="panel panel--wide">${head}
    <div class="skin-stage">
      <div class="skin-preview${st === 'soon' ? ' skin-preview--locked' : ''}">
        <canvas class="skin-preview__canvas" data-skin-preview="${prev.skin}"${prev.trail === null ? '' : ` data-trail-color="${prev.trail}"`} role="img" aria-label="Aperçu : ${escapeHtml(sel.name)}"></canvas>
      </div>
      <div class="skin-info">
        <span class="kind-label">${KIND_LABEL[sel.kind]}</span>
        <h3 class="skin-info__name">${escapeHtml(sel.name)}</h3>
        <p class="skin-info__cond">${escapeHtml(sel.blurb)}</p>
        ${contents}
        <div class="item__badge item__badge--lg">${itemBadge(st, sel, save)}</div>
        ${p && (st === 'buy' || st === 'insufficient') ? `<p class="shop-balance">Disponible : <strong>${formatScore(spendable(save, p.currency))}</strong> ${CURRENCY_NAME[p.currency]}</p>` : ''}
        ${act.note ? `<p class="shop-note" id="item-note">${act.note}</p>` : ''}
        ${packNote}
        ${act.button}
      </div>
    </div>
    ${medalGrid}${prismGrid}
    <p class="small" style="margin-top:12px">Purement cosmétiques : mêmes vitesses, mêmes hitboxes et même difficulté dans tous les modes. Les cosmétiques s’achètent avec des Médailles, gagnées en récupérant vos succès (jamais avec des Éclats) ; les articles premium avec des Prismes. Les Éclats servent aux bonus. Aucune monnaie n’est convertie en une autre ; les « Éclats de campagne » sont une réserve séparée.</p>
  </div>`;
}

/** Motif lisible d'un refus d'achat (rien n'est jamais débité dans ce cas). */
export function purchaseRefusal(save: SaveData, item: CatalogItem): string {
  const st = itemState(save, item);
  const p = effectivePrice(save, item);
  switch (st) {
    case 'owned':
    case 'equipped': return `${item.name} est déjà possédé : rien n’a été débité.`;
    case 'insufficient': return p ? `Solde insuffisant pour ${item.name} : il manque ${formatScore(p.amount - spendable(save, p.currency))} ${CURRENCY_NAME[p.currency]}. Rien n’a été débité.` : 'Solde insuffisant : rien n’a été débité.';
    case 'soon': return `${item.name} est un article premium : les Prismes ne sont pas encore disponibles, aucun achat n’est possible pour l’instant.`;
    default: return 'Achat impossible : rien n’a été débité.';
  }
}

/** Confirmation d'un achat de cosmétique (Médailles ou Prismes) : récapitulatif, solde avant / après. */
export function confirmPurchaseScreen(save: SaveData, itemId: string, busy = false): string {
  const item = catalogItem(itemId);
  const p = item ? effectivePrice(save, item) : null;
  if (!item || !p || itemState(save, item) !== 'buy') {
    return `<div class="panel panel--pause"><h2 class="title">Achat impossible</h2>
      <p class="sub" role="alert" style="margin:6px 0 14px">${escapeHtml(item ? purchaseRefusal(save, item) : 'Article inconnu : rien n’a été débité.')}</p>
      ${button({ action: 'back-cosmetics', label: 'Retour à la boutique', variant: 'primary', attrs: 'data-autofocus' })}</div>`;
  }
  const bal = spendable(save, p.currency);
  return `<div class="panel panel--pause">
    <h2 class="title">Confirmer l’achat</h2>
    <p class="sub" style="margin:4px 0 10px">${KIND_LABEL[item.kind]} ${escapeHtml(item.name)}</p>
    <div class="confirm__thumb">${itemThumb(save, item)}</div>
    <div class="confirm__row"><span>Prix</span>${price(p.currency, p.amount)}</div>
    <div class="confirm__row"><span>Solde disponible</span><strong>${formatScore(bal)}</strong></div>
    <div class="confirm__row"><span>Solde après l’achat</span><strong>${formatScore(Math.max(0, bal - p.amount))}</strong></div>
    ${p.currency === 'prisms' ? '<p class="small">Les Prismes sont débités par le service, en ligne ; rien n’est débité si la connexion échoue.</p>' : ''}
    <div class="btn-stack" style="margin-top:14px">
      ${button({ action: 'confirm-buy', label: busy ? 'Achat en cours…' : 'Confirmer l’achat', icon: 'check', variant: 'primary', attrs: `data-item="${item.id}" data-autofocus${busy ? ' disabled' : ''}` })}
      ${button({ action: 'back-cosmetics', label: 'Annuler', variant: 'ghost' })}
    </div>
  </div>`;
}

/** Confirmation d'un achat de bonus : récapitulatif, solde d'Éclats avant / après, stock avant / après. */
export function confirmBonusScreen(save: SaveData, kind: string, quantity: number, back: 'cosmetics' | 'prep'): string {
  const def = bonusDef(kind);
  const cost = def ? def.price * quantity : 0;
  const bal = spendable(save, 'shards');
  if (!def || !Number.isInteger(quantity) || quantity < 1 || cost > bal || save.inventory[def.id] + quantity > BONUS.maxStock) {
    return `<div class="panel panel--pause"><h2 class="title">Achat impossible</h2>
      <p class="sub" role="alert" style="margin:6px 0 14px">${def ? (save.inventory[def.id] + quantity > BONUS.maxStock ? 'Votre inventaire de ce bonus serait plein.' : `Éclats insuffisants : il vous manque ${formatScore(Math.max(0, cost - bal))} Éclats.`) : 'Bonus inconnu.'} Rien n’a été débité.</p>
      ${button({ action: 'bonus-back', label: back === 'prep' ? 'Retour à la préparation' : 'Retour à la boutique', variant: 'primary', attrs: 'data-autofocus' })}</div>`;
  }
  return `<div class="panel panel--pause">
    <h2 class="title">Confirmer l’achat</h2>
    <p class="sub" style="margin:4px 0 10px">${escapeHtml(def.name)} × ${quantity}</p>
    <div class="confirm__thumb confirm__thumb--bonus">${ICONS[BONUS_ICON[def.id]]}</div>
    <div class="confirm__row"><span>Prix</span>${price('shards', cost)}</div>
    <div class="confirm__row"><span>Éclats disponibles</span><strong>${formatScore(bal)}</strong></div>
    <div class="confirm__row"><span>Éclats restants</span><strong>${formatScore(bal - cost)}</strong></div>
    <div class="confirm__row"><span>Stock après l’achat</span><strong>${formatScore(save.inventory[def.id])} → ${formatScore(save.inventory[def.id] + quantity)}</strong></div>
    <p class="small">L’achat ajoute des charges à votre inventaire ; aucune charge n’est utilisée.</p>
    <div class="btn-stack" style="margin-top:14px">
      ${button({ action: 'bonus-confirm', label: 'Confirmer l’achat', icon: 'check', variant: 'primary', attrs: `data-bonus="${def.id}" data-qty="${quantity}" data-autofocus` })}
      ${button({ action: 'bonus-back', label: 'Annuler', variant: 'ghost' })}
    </div>
  </div>`;
}

/**
 * Préparation d'une partie de SURVIE : stocks de bonus, solde d'Éclats, achats, limite d'activations ; on peut toujours lancer sans aucun bonus.
 * (Ce n'est pas un mode : la partie lancée est la Survie habituelle.)
 */
export function prepScreen(save: SaveData, message: { kind: 'ok' | 'error'; text: string } | null = null, record = ''): string {
  const msg = message ? `<div role="${message.kind === 'error' ? 'alert' : 'status'}" class="notice${message.kind === 'ok' ? ' notice--cyan' : ''}">${escapeHtml(message.text)}</div>` : '';
  const totalStock = BONUS_LIST.reduce((t, b) => t + save.inventory[b.id], 0);
  // Le lancement est tout en haut : toujours visible, même sur téléphone ; les bonus sont facultatifs
  return `<div class="panel panel--wide prep">${screenHead('Préparer la partie')}
    ${msg}
    <div class="btn-stack prep__go">
      ${button({ action: 'survival-start', label: 'Lancer la partie', sub: totalStock > 0 ? 'Vos charges sont conservées' : 'Sans bonus', icon: 'play', variant: 'primary', size: 'hero', attrs: 'data-autofocus' })}
    </div>
    <p class="sub prep__intro">Survie${record ? ` · ${escapeHtml(record)}` : ''}. Les bonus ci-dessous sont facultatifs.</p>
    ${walletBar(save.wallet, { currencies: ['shards'] })}
    ${waitingNote(save)}
    <div class="bonus-list">${bonusCards(save)}</div>
    <p class="small">${bonusRules()}</p>
  </div>`;
}

// ————————————————————————————————————————————— Succès

/** Valeur d'une grandeur, avec son unité (durées en m:ss). */
function metricText(key: MetricKey, v: number): string {
  return key === 'bestSurvival' || key === 'bestDaily' ? formatTime(v, 0) : formatScore(v);
}

/**
 * Menu Succès : progression et état de chaque succès, par catégorie. Un succès accompli affiche « Récupérer » (Médailles créditées uniquement à la
 * réclamation, une seule fois) ; « Tout récupérer » regroupe les réclamations. `justClaimed` : succès à animer (réclamés à l'instant).
 */
export function achievementsScreen(save: SaveData, message: { kind: 'ok' | 'error'; text: string } | null = null, justClaimed: readonly string[] = []): string {
  const done = ACHIEVEMENTS.filter((a) => save.achievements[a.id] !== undefined);
  const claimable = claimableAchievements(save);
  const claimedTotal = ACHIEVEMENTS.filter((a) => save.medals.claimed.includes(a.id)).reduce((t, a) => t + a.medals, 0);
  const msg = message ? `<div role="${message.kind === 'error' ? 'alert' : 'status'}" class="notice${message.kind === 'ok' ? ' notice--medal' : ''}">${escapeHtml(message.text)}</div>` : '';
  const sections = ACHIEVEMENT_CATEGORIES.map((cat) => {
    const list = ACHIEVEMENTS.filter((a) => a.category === cat.id);
    const rows = list
      .map((a) => {
        const pr = achievementProgress(save, a);
        const can = isClaimable(save, a.id);
        const reward = `<span class="price price--medals">${coin('medals')}<strong>+${formatScore(a.medals)}</strong><span class="price__l">${CURRENCY_NAME.medals}</span></span>`;
        const state = pr.earned
          ? `<span class="chip chip--equipped">${ICONS.check}Obtenu</span>${pr.claimed ? '<span class="chip chip--owned">Médailles récupérées</span>' : ''}`
          : `<div class="ach__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${a.target}" aria-valuenow="${Math.floor(pr.value)}"><i style="width:${Math.round(pr.ratio * 100)}%"></i></div><span class="ach__n">${metricText(a.metric, pr.value)} / ${metricText(a.metric, a.target)}</span>`;
        const claim = can ? button({ action: 'claim-medal', label: 'Récupérer', icon: 'medal', variant: 'primary', size: 'sm', attrs: `data-ach="${a.id}" aria-label="Récupérer ${a.medals} Médailles : ${escapeHtml(a.name)}"` }) : '';
        const cls = `ach${pr.earned ? ' ach--done' : ''}${can ? ' ach--claimable' : ''}${justClaimed.includes(a.id) ? ' ach--just-claimed' : ''}`;
        return `<div class="${cls}" data-ach-row="${a.id}"><div class="ach__medal">${pr.earned ? ICONS.medal : ICONS.lock}</div>
          <div class="ach__body"><div class="ach__t">${escapeHtml(a.name)}<span class="sr-only">${pr.earned ? ' — obtenu' : ' — à débloquer'}</span></div>
          <div class="ach__d">${escapeHtml(a.description)}</div>
          <div class="ach__state">${state}</div>
          <div class="ach__reward">${reward}${claim}</div></div></div>`;
      })
      .join('');
    const n = list.filter((a) => save.achievements[a.id] !== undefined).length;
    return `<h3 class="section-title">${cat.label} <span class="section-count">${n}/${list.length}</span></h3>${rows}`;
  }).join('');
  const claimAll =
    claimable.length > 0
      ? `<div class="ach__all">${button({ action: 'claim-all', label: `Tout récupérer (${formatScore(claimableMedals(save))} Médailles)`, icon: 'medal', variant: 'primary', attrs: 'data-autofocus' })}</div>`
      : '';
  return `<div class="panel panel--wide">${screenHead('Succès')}
    ${msg}
    ${walletBar(save.wallet, { currencies: ['medals'] })}
    ${waitingNote(save)}
    <div class="stats">${stat('Succès obtenus', `${done.length} / ${ACHIEVEMENTS.length}`, done.length === ACHIEVEMENTS.length)}${stat('Médailles récupérées', formatScore(claimedTotal), false)}</div>
    ${claimAll}
    <p class="small">Les Médailles servent aux cosmétiques de la boutique ; elles ne s’achètent pas et ne s’obtiennent qu’une fois par succès, en les récupérant ici.</p>
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
  /** Classement affiché : « Sans bonus » (aucune activation de Boost, Gel ou Bouclier en première vie) ou « Avec bonus ». */
  category: 'plain' | 'bonus';
  pending: PendingRun[];
  /** Résultats en attente appartenant à un autre profil de cet appareil (conservés, envoyés à sa reconnexion). */
  foreignPending?: number;
  /** Message sur le dernier pseudo saisi (erreur ou confirmation). */
  nickMessage: string | null;
  /** Résultat de Survie local (record actuel). */
  localBest: { time: number; score: number } | null;
  /** Le service ne reconnaît plus le profil de ce navigateur (supprimé ou service réinitialisé). */
  profileLost?: boolean;
  /** Confirmation de suppression du profil affichée. */
  confirmDelete?: boolean;
  /** Message sur le dernier signalement ou la dernière suppression. */
  reportMessage?: string | null;
}

function pendingRow(p: PendingRun): string {
  const r = p.submission.claimed;
  let label: string;
  let cls: string;
  if (p.status === 'accepted') {
    label = `Validé par le serveur${p.result ? ` — ${p.result.category === 'bonus' ? 'Avec bonus' : 'Sans bonus'}, rang ${p.result.rank}${p.result.personalBest ? ' (nouveau meilleur)' : ''}` : ''}`;
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
  const rules = `<p class="small" style="margin-top:12px">Survie, version d’équilibrage ${v.balance}. Critère principal : durée de survie ; le score départage. Seules les parties <strong>rejouées et validées par le serveur</strong> sont classées ; les parties de démonstration ou de test n’en font jamais partie.</p>
    <p class="small"><strong>Sans bonus</strong> : aucune activation de Boost, Gel ou Bouclier pendant la première vie (c’est le classement historique). <strong>Avec bonus</strong> : au moins un pouvoir activé avec succès. Seule la <strong>première vie</strong> compte : une reprise (deuxième ou troisième chance) n’est jamais classée et ne change jamais votre record.</p>
    <p class="small">Votre profil de classement (pseudo et identifiant) est enregistré dans <strong>ce navigateur</strong> : un autre navigateur, un autre appareil ou une version installée du jeu aura un autre profil. Hors connexion, le jeu reste jouable et vos résultats sont envoyés plus tard.</p>`;
  const local = v.localBest ? `<div class="stats">${stat('Votre record sur cet appareil', formatTime(v.localBest.time))}${stat('Score associé', formatScore(v.localBest.score))}</div>` : '';
  if (!v.configured) {
    return `<div class="panel panel--wide">${head}
      ${notice('Le classement mondial n’est <strong>pas encore disponible</strong> dans cette version. Rien ne vous est demandé : le jeu reste entièrement jouable et vos records sont enregistrés sur cet appareil.', 'cyan')}
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
  const lost = v.profileLost
    ? `<div role="alert" class="notice">Le service ne reconnaît plus votre profil (supprimé, ou service réinitialisé). Vos résultats locaux sont intacts. ${button({ action: 'lb-forget', label: 'Créer un nouveau profil', variant: 'secondary', size: 'sm' })}</div>`
    : '';
  // Signalement et suppression : seulement avec un profil (le service exige votre secret ; aucune action possible sans lui)
  const reportMsg = v.reportMessage ? `<p class="shop-note" role="status">${escapeHtml(v.reportMessage)}</p>` : '';
  const account = v.identity
    ? `<h3 class="section-title">Mon profil et signalements</h3>
      <form class="nick-form" data-form="lb-report" autocomplete="off" novalidate>
        <label class="sr-only" for="report-input">Pseudo à signaler</label>
        <input id="report-input" class="input" name="report" type="text" maxlength="16" placeholder="Pseudo offensant à signaler" spellcheck="false" autocapitalize="off" />
        ${button({ action: 'lb-report', label: 'Signaler', variant: 'secondary', size: 'sm', attrs: 'type="submit"' })}
      </form>${reportMsg}
      ${
        v.confirmDelete
          ? `<div role="alert" class="notice"><strong>Supprimer votre profil du classement ?</strong> Votre pseudo, vos parties envoyées et vos meilleurs résultats mondiaux seront effacés du service, définitivement. Vos records et votre progression sur cet appareil ne changent pas.
              <div class="btn-row">${button({ action: 'lb-delete-cancel', label: 'Annuler', variant: 'primary', size: 'sm', attrs: 'data-autofocus' })}${button({ action: 'lb-delete-confirm', label: 'Oui, supprimer', icon: 'trash', variant: 'danger', size: 'sm' })}</div></div>`
          : button({ action: 'lb-delete-ask', label: 'Supprimer mon profil du classement', icon: 'trash', variant: 'ghost', size: 'sm' })
      }`
    : '';
  const catName = v.category === 'bonus' ? 'Avec bonus' : 'Sans bonus';
  const tabs = `<div class="filters" role="tablist" aria-label="Classement">${(['plain', 'bonus'] as const)
    .map((c) => `<button class="filter${c === v.category ? ' filter--on' : ''}" role="tab" data-action="lb-category" data-category="${c}" aria-selected="${c === v.category}">${c === 'bonus' ? 'Avec bonus' : 'Sans bonus'}</button>`)
    .join('')}</div>`;
  const me = v.me
    ? v.me.best
      ? `<div class="stats">${stat(`Votre rang · ${catName}`, `${v.me.best.rank} / ${v.me.total}`, v.me.best.rank <= 3)}${stat('Votre meilleur', `${formatTime(v.me.best.time)} · ${formatScore(v.me.best.score)}`)}</div>`
      : `<p class="sub" style="margin:10px 0">Vous n’êtes pas encore classé « ${catName} » pour la version ${v.balance} : jouez une partie de Survie${v.category === 'bonus' ? ' en activant un pouvoir' : ' sans activer de pouvoir'}.</p>`
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
  else if (!v.top || v.top.entries.length === 0) table = `<p class="sub" style="margin:16px 0">Aucun résultat validé « ${catName} » pour cette version pour le moment.</p>`;
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
  const foreign = v.foreignPending ? `<p class="small">${v.foreignPending} résultat${v.foreignPending > 1 ? 's' : ''} en attente d’un autre profil de cet appareil : conservé${v.foreignPending > 1 ? 's' : ''}, envoyé${v.foreignPending > 1 ? 's' : ''} quand ce profil se reconnecte.</p>` : '';
  return `<div class="panel panel--wide">${head}
    ${lost}${identity}${msg}${tabs}${me}${versions}${table}${pending}${foreign}${account}${local ? `<h3 class="section-title">Sur cet appareil</h3>${local}` : ''}${rules}
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
  | { kind: 'accepted'; rank: number; best: boolean; category?: 'plain' | 'bonus'; /** Drop rare : Prisme crédité par le service. */ drop?: number }
  /** Défi quotidien : tentative non démarrée en ligne (résultat local seulement) ou acceptée par le service. */
  | { kind: 'daily-local' }
  | { kind: 'daily-accepted'; rank: number; eligible: boolean; late: boolean; state: 'open' | 'grace' | 'final' }
  | { kind: 'rejected'; message: string };

export function runLbStatusHtml(st: RunLbStatus): string {
  switch (st.kind) {
    case 'hidden': return '';
    case 'no-identity': return '<p class="lb-status lb-status--info">Classement mondial : choisissez un pseudo dans le menu Classement pour participer.</p>';
    case 'no-ticket': return '<p class="lb-status lb-status--info">Classement mondial : résultat conservé sur cet appareil seulement (aucun ticket de partie disponible : ouvrez le jeu une fois avec une connexion Internet pour en obtenir).</p>';
    case 'assisted': return '<p class="lb-status lb-status--info">Classement mondial : partie de démonstration ou de test, non éligible.</p>';
    case 'sending': return '<p class="lb-status lb-status--wait" role="status">Classement mondial : envoi et validation en cours…</p>';
    case 'pending': return `<p class="lb-status lb-status--wait" role="status">Classement mondial : <strong>en attente</strong> — ${st.offline ? 'hors connexion, nouvel essai automatique' : 'à envoyer'} (pas encore validé).</p>`;
    case 'accepted': return `<p class="lb-status lb-status--ok" role="status">Classement mondial : <strong>validé</strong>${st.category ? ` (classement ${st.category === 'bonus' ? 'Avec bonus' : 'Sans bonus'})` : ''} — rang ${st.rank}${st.best ? ' (nouveau meilleur résultat)' : ' (votre meilleur reste en place)'}.${st.drop ? ` <span class="lb-drop">✦ Prisme trouvé : <strong>+${st.drop}</strong>, crédité et confirmé par le service.</span>` : ''}</p>`;
    case 'daily-local': return '<p class="lb-status lb-status--info">Classement mondial du défi : tentative non démarrée en ligne, résultat conservé sur cet appareil seulement (le service doit connaître l’heure de début).</p>';
    case 'daily-accepted': return `<p class="lb-status lb-status--ok" role="status">Classement mondial du défi : <strong>validé</strong>${st.late ? ' (envoi tardif accepté)' : ''} — ${st.eligible ? `rang ${st.rank}${st.state === 'final' ? ' (définitif)' : ' (provisoire jusqu’à 00 h 15 UTC)'}` : 'enregistré, mais non classé : choisissez un pseudo dans le menu Classement'}.</p>`;
    case 'rejected': return `<p class="lb-status lb-status--bad" role="alert">Classement mondial : <strong>non validé</strong> — ${escapeHtml(st.message)}</p>`;
  }
}

// ————————————————————————————————————————————— Reprise (deuxième / troisième chance)

export interface ReviveView {
  /** Vie proposée : 2 ou 3. */
  life: 2 | 3;
  /** Résultat CLASSÉ de la première vie (figé à la première mort). */
  time: number;
  score: number;
  category: 'plain' | 'bonus';
  /** Publicité récompensée (deuxième chance seulement) : disponible seulement si un fournisseur réel est enregistré et prêt. */
  ad: { offered: boolean; available: boolean; /** Fournisseur présent mais aucune publicité prête : l'option n'est pas montrée. */ hidden?: boolean; /** Explication affichée quand l'option est indisponible. */ reason?: string };
  prisms: { price: number; balance: number | null; /** Raison pour laquelle le paiement est impossible maintenant (null = possible). */ blocked: string | null };
  busy: boolean;
  /** Confirmation avant de dépenser des Prismes (affichée à la place des choix). */
  confirm?: boolean;
  message: { kind: 'ok' | 'error'; text: string } | null;
  lb: RunLbStatus;
}

/**
 * Écran de reprise : propose une chance supplémentaire (facultative). Le résultat classé est déjà enregistré ; la suite est une survie libre non
 * classée. La publicité n'est proposée que si un vrai fournisseur est prêt ; le paiement en Prismes est vérifié et débité par le service.
 */
export function reviveScreen(v: ReviveView): string {
  const ordinal = v.life === 2 ? 'Deuxième' : 'Troisième';
  const msg = v.message ? `<div role="${v.message.kind === 'error' ? 'alert' : 'status'}" class="notice${v.message.kind === 'ok' ? ' notice--cyan' : ''}">${escapeHtml(v.message.text)}</div>` : '';
  const ad = v.ad.offered && !v.ad.hidden
    ? button({ action: 'revive-ad', label: 'Regarder une publicité', sub: v.ad.available ? 'Reprendre gratuitement' : v.ad.reason ?? 'Indisponible dans cette version', icon: 'play', variant: 'secondary', attrs: v.ad.available && !v.busy ? '' : 'disabled' })
    : '';
  if (v.confirm) {
    const left = v.prisms.balance !== null ? v.prisms.balance - v.prisms.price : null;
    return `<div class="panel panel--pause revive">
      <h2 class="title title--cyan">Confirmer la dépense</h2>
      <div class="confirm">
        <div class="confirm__row"><span>${ordinal} chance</span><strong>${v.prisms.price} Prismes</strong></div>
        ${v.prisms.balance !== null ? `<div class="confirm__row"><span>Solde confirmé</span><strong>${formatScore(v.prisms.balance)} → ${formatScore(Math.max(0, left ?? 0))}</strong></div>` : ''}
      </div>
      <p class="small">Les Prismes sont débités par le service, une seule fois pour cette reprise. La suite est une survie libre, non classée ; votre résultat classé reste enregistré.</p>
      ${msg}
      <div class="btn-stack" style="margin-top:14px">
        ${button({ action: 'revive-prisms-confirm', label: `Dépenser ${v.prisms.price} Prismes`, icon: 'check', variant: 'primary', attrs: v.busy ? 'disabled' : 'data-autofocus' })}
        ${button({ action: 'revive-prisms-back', label: 'Retour', variant: 'ghost', attrs: v.busy ? 'disabled' : '' })}
      </div>
      ${v.busy ? '<p class="small" role="status">Paiement en cours de vérification par le service… Aucune reprise n’est accordée tant qu’il n’est pas confirmé.</p>' : ''}
    </div>`;
  }
  const pay = button({
    action: 'revive-prisms',
    label: `Reprendre — ${v.prisms.price} Prismes`,
    sub: v.prisms.blocked ?? (v.prisms.balance !== null ? `Solde confirmé : ${formatScore(v.prisms.balance)} Prismes` : 'Paiement vérifié par le service'),
    icon: 'play',
    variant: 'primary',
    attrs: `${v.prisms.blocked || v.busy ? 'disabled' : 'data-autofocus'}`,
  });
  return `<div class="panel panel--pause revive">
    <h2 class="title title--cyan">${ordinal} chance</h2>
    <p class="sub">Votre résultat classé est enregistré : <strong>${formatTime(v.time)}</strong> · ${formatScore(v.score)} points · ${v.category === 'bonus' ? 'classement Avec bonus' : 'classement Sans bonus'}.</p>
    <div id="lb-status">${runLbStatusHtml(v.lb)}</div>
    ${msg}
    <p class="small">La suite est une <strong>survie libre</strong> : non classée, sans Éclats, sans progression de succès. Boost et Gel y sont gratuits, avec leurs temps de recharge, et vous restez invulnérable 3 secondes après la reprise.</p>
    <div class="btn-stack">
      ${ad}
      ${pay}
      ${button({ action: 'revive-decline', label: 'Terminer la partie', icon: 'home', variant: 'ghost', attrs: v.busy ? 'disabled' : '' })}
    </div>
    ${v.busy ? '<p class="small" role="status">Paiement en cours de vérification par le service… Aucune reprise n’est accordée tant qu’il n’est pas confirmé.</p>' : ''}
  </div>`;
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

export function optionsScreen(save: SaveData, accountEnabled = false): string {
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
    <h3 class="section-title">Sauvegarde et données</h3>
    ${accountEnabled ? `${setting('shop', 'Compte et synchronisation', 'Retrouver votre progression sur un autre appareil (facultatif)', button({ action: 'account', label: 'Ouvrir', variant: 'secondary', size: 'sm' }))}<p class="small">Sans compte, votre progression reste <strong>sur cet appareil</strong> (aucune synchronisation).</p>` : ''}
    <p class="small">Votre progression (niveaux, campagne, Éclats, cosmétiques, succès, records) est enregistrée <strong>dans ce navigateur, sur cet appareil</strong>. Elle n’est pas synchronisée automatiquement avec un autre appareil, un autre navigateur ni une version installée (application native) du jeu. Vider les données du site ou passer en navigation privée l’efface. Le profil du classement mondial est lui aussi lié à ce navigateur.</p>
    ${accountEnabled ? `<h3 class="section-title">Achats, publicités et confidentialité</h3>${privacyHtml()}` : ''}
    ${button({ action: 'ask-reset', label: 'Effacer toute la progression…', icon: 'trash', variant: 'danger' })}
    <p class="small" style="margin-top:14px">Sauvegarde locale (cet appareil, ce navigateur). ${escapeHtml(GAME_NAME)} v${__APP_VERSION__} · version ${__BUILD_ID__}</p>
  </div>`;
}

export function confirmResetScreen(): string {
  return `<div class="panel panel--pause">
    <h2 class="title title--coral" style="margin-bottom:8px">Effacer la progression ?</h2>
    <p class="sub" style="margin-bottom:10px">Seront supprimés définitivement, <strong>sur cet appareil</strong> : défis classiques (niveaux, étoiles), campagne (étoiles, scènes vues, Éclats de campagne), records de Survie et du défi quotidien, succès, Éclats, cosmétiques achetés et équipés.</p>
    <p class="small" style="margin-bottom:16px">Sont conservés : vos options (son, effets réduits, intensité visuelle) et votre profil du classement mondial. L’opération est irréversible.</p>
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
    <p class="small" style="margin-top:14px">La reprise commence par un bref compte à rebours. Le temps en pause ne compte pas. « Recommencer » et le retour au menu abandonnent la partie en cours (elle n’est pas enregistrée).</p>
  </div>`;
}

// ————————————————————————————————————————————— Résultat

function achievementsNotice(report: RunReport): string {
  if (report.achievements.length === 0) return '';
  const rows = report.achievements.map((a) => notice(`Succès : <strong>${escapeHtml(a.name)}</strong> — <span class="price price--medals">${coin('medals')}<strong>+${formatScore(a.medals)}</strong> Médailles à récupérer</span>`));
  return rows.join('') + `<div class="btn-row">${button({ action: 'achievements', label: 'Récupérer mes Médailles', icon: 'medal', variant: 'secondary', size: 'sm' })}</div>`;
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
    <p class="sub">${isDaily && r.date ? `Défi du ${escapeHtml(formatDateFr(r.date))} (UTC)` : r.category ? `Survie · ${r.category === 'bonus' ? 'Avec bonus' : 'Sans bonus'}` : 'Survie'}</p>
    <div class="result__hero${report.newRecord ? ' result__hero--gold' : ''}">${formatTime(r.time)}</div>
    <p class="result__score">score<strong>${formatScore(r.score)}</strong></p>
    <div class="stats">
      ${record ? stat('Record précédent', formatTime(report.previousBestTime)) : stat(isDaily ? 'Meilleur du jour' : 'Record', formatTime(best))}
      ${stat('Écart avec le record précédent', report.previousBestTime > 0 ? formatDelta(diff) : '—')}
    </div>
    <div id="lb-status">${runLbStatusHtml(lb)}</div>
    ${r.free ? `<p class="small" role="status">Survie libre après reprise (non classée, sans gain ni progression) : <strong>${formatTime(r.free.time)}</strong> · ${formatScore(r.free.score)} points · ${r.free.lives} vies utilisées.</p>` : ''}
    ${rewardsBlock(report)}
    ${report.legacyBestTime > 0 ? `<p class="small" style="margin-top:8px">Ancien équilibrage : ${formatTime(report.legacyBestTime)} (non comparable)</p>` : ''}
    ${achievementsNotice(report)}
    <div class="btn-stack result__actions">${replayButton()}${button({ action: 'home', label: 'Accueil', icon: 'home', variant: 'ghost' })}</div>
  </div>`;
}
