import { LEVEL_DURATION } from '../config/balance';
import { GAME_NAME } from '../config/brand';
import { LEVELS } from '../config/levels';
import { BALANCE_VERSION } from '../config/version';
import { formatDateFr } from '../modes/daily';
import { ACHIEVEMENTS, achievementById } from '../progression/achievements';
import { hasLegacyRecords, isLevelUnlocked, legacyDailyList, legacySurvivalBest, type RunReport } from '../progression/progress';
import { SKINS, isSkinUnlocked, type Skin } from '../progression/skins';
import type { SaveData } from '../save/save';
import logoUrl from '../assets/ui/logo.png';
import shipUrl from '../assets/sprites/ship.png';
import { button, notice, screenHead, setting, stat, switchButton, tabs } from './components';
import { escapeHtml, formatDelta, formatScore, formatTime, starsHtml } from './format';
import { ICONS } from './icons';

/**
 * Écrans de l'interface, générés en HTML à partir des vraies données de la sauvegarde.
 * Aucun texte, score, étoile ou apparence n'est figé : tout vient de `save` et du rapport de partie.
 * Les actions passent par des attributs data-action gérés par délégation dans App ; aucun bouton n'est relié à l'aire de jeu.
 */

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export type CollectionTab = 'skins' | 'achievements';

/** Prochain niveau à jouer : le premier débloqué non terminé (sinon le dernier). */
export function nextLevelId(save: SaveData): number {
  const open = LEVELS.find((l) => isLevelUnlocked(save, l.id) && !save.levels[String(l.id)]?.completed);
  return open ? open.id : LEVELS[LEVELS.length - 1].id;
}

// ————————————————————————————————————————————— Accueil

export function homeScreen(save: SaveData, today: string): string {
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
      ${button({ action: 'survival', label: 'Survie', sub: surv, icon: 'play', variant: 'primary', size: 'hero' })}
      ${button({ action: 'levels', label: 'Niveaux', sub: `${done}/${LEVELS.length} terminés · ${stars}/${LEVELS.length * 3} étoiles`, icon: 'levels', variant: 'secondary', size: 'row', chevron: true })}
      ${button({ action: 'daily', label: 'Défi quotidien', sub: dailyHint, icon: 'calendar', variant: 'secondary', size: 'row', chevron: true })}
      <div class="btn-row">
        ${button({ action: 'skins', label: 'Apparences', icon: 'rocket', variant: 'secondary', size: 'compact' })}
        ${button({ action: 'achievements', label: 'Succès', badge: `${achCount}/${ACHIEVEMENTS.length}`, icon: 'trophy', variant: 'secondary', size: 'compact' })}
      </div>
      ${button({ action: 'options', label: 'Options', icon: 'gear', variant: 'ghost' })}
      <p class="small home__help">Touchez l’écran ou appuyez sur <span class="kbd">Espace</span> pour inverser la direction. <span class="kbd">Échap</span> : pause.</p>
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

function skinPreview(s: Skin): string {
  // Orbite et balises aux couleurs de l'apparence ; le vaisseau est le vrai sprite
  const cx = 60;
  const cy = 36;
  const r = 25;
  const a = -0.75;
  const sx = cx + r * Math.cos(a);
  const sy = cy + r * Math.sin(a);
  const rot = ((a + Math.PI / 2) * 180) / Math.PI;
  const beacons = [Math.PI * 0.55, Math.PI * 1.05, Math.PI * 0.05]
    .map((b) => `<rect x="${(cx + r * Math.cos(b) - 3).toFixed(1)}" y="${(cy + r * Math.sin(b) - 3).toFixed(1)}" width="6" height="6" transform="rotate(45 ${(cx + r * Math.cos(b)).toFixed(1)} ${(cy + r * Math.sin(b)).toFixed(1)})" fill="${hex(s.beacon)}"/>`)
    .join('');
  return `<svg class="skin__preview" viewBox="0 0 120 72" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${hex(s.orbit)}" stroke-width="2.2"/>${beacons}
    <image href="${shipUrl}" x="${(sx - 11).toFixed(1)}" y="${(sy - 11).toFixed(1)}" width="22" height="22" transform="rotate(${rot.toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)})"/>
  </svg>`;
}

export function collectionScreen(save: SaveData, tab: CollectionTab): string {
  const count = ACHIEVEMENTS.filter((a) => save.achievements[a.id] !== undefined).length;
  const head = `${screenHead(tab === 'skins' ? 'Apparences' : 'Succès')}${tabs(
    [
      { id: 'skins', label: 'Apparences', action: 'tab-skins' },
      { id: 'achievements', label: `Succès ${count}/${ACHIEVEMENTS.length}`, action: 'tab-achievements' },
    ],
    tab,
  )}`;
  if (tab === 'skins') {
    const skins = SKINS.map((s) => {
      const unlocked = isSkinUnlocked(s, save.achievements);
      const sel = save.skin === s.id;
      const req = s.unlock ? achievementById(s.unlock)?.name ?? '' : 'Disponible';
      return `<button class="skin${sel ? ' skin--selected' : ''}" data-action="skin" data-skin="${s.id}" ${unlocked ? '' : 'disabled'} aria-pressed="${sel}">
        ${skinPreview(s)}
        <div class="skin__name">${escapeHtml(s.name)}${sel ? ICONS.check : ''}</div>
        <div class="skin__req">${unlocked ? (sel ? 'Sélectionnée' : 'Débloquée') : `Verrouillée · succès « ${escapeHtml(req)} »`}</div>
      </button>`;
    }).join('');
    return `<div class="panel panel--wide">${head}
      <p class="sub" style="margin-bottom:14px">Purement esthétiques : elles ne modifient aucune performance. Les menaces gardent toujours leurs couleurs.</p>
      <div class="skins">${skins}</div>
    </div>`;
  }
  const achs = ACHIEVEMENTS.map((a) => {
    const done = save.achievements[a.id] !== undefined;
    const skin = SKINS.find((s) => s.unlock === a.id);
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
      const skin = SKINS.find((s) => s.unlock === a.id);
      return notice(`Succès : <strong>${escapeHtml(a.name)}</strong>${skin ? ` — apparence « ${escapeHtml(skin.name)} » débloquée` : ''}`);
    })
    .join('');
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
    ${report.legacyBestTime > 0 ? `<p class="small" style="margin-top:8px">Ancien équilibrage : ${formatTime(report.legacyBestTime)} (non comparable)</p>` : ''}
    ${achievementsNotice(report)}
    <div class="btn-stack result__actions">${replayButton()}${button({ action: 'home', label: 'Accueil', icon: 'home', variant: 'ghost' })}</div>
  </div>`;
}
