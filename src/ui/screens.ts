import { LEVEL_DURATION } from '../config/balance';
import { LEVELS } from '../config/levels';
import { formatDateFr } from '../modes/daily';
import { ACHIEVEMENTS, achievementById } from '../progression/achievements';
import { BALANCE_VERSION } from '../config/version';
import { hasLegacyRecords, isLevelUnlocked, legacyDailyList, legacySurvivalBest, type RunReport } from '../progression/progress';
import { SKINS, isSkinUnlocked, type Skin } from '../progression/skins';
import type { SaveData } from '../save/save';
import { escapeHtml, formatDelta, formatScore, formatTime, starsHtml } from './format';

/**
 * Écrans de l'interface, en HTML généré. Les actions passent par des attributs data-action
 * gérés par délégation dans App : aucun bouton n'est relié à l'aire de jeu.
 */

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function back(title: string): string {
  return `<div class="back-row"><button class="btn back-btn" data-action="home" aria-label="Retour">←</button><h2>${escapeHtml(title)}</h2></div>`;
}

export function homeScreen(save: SaveData, today: string): string {
  const legacy = legacySurvivalBest(save);
  const surv =
    save.survival.bestTime > 0
      ? `Record : ${formatTime(save.survival.bestTime)}`
      : legacy
        ? `Record à établir · ancien équilibrage : ${formatTime(legacy.time)}`
        : 'Tenez le plus longtemps possible';
  const notice =
    hasLegacyRecords(save) && save.balanceNoticeSeen < BALANCE_VERSION
      ? `<div class="notice cyan" role="status">Équilibrage mis à jour : la Survie et le défi montent plus vite en difficulté, le vaisseau et les astéroïdes sont plus grands et les hitboxes légèrement ajustées.
         Vos records précédents sont conservés à part (« ancien équilibrage ») et ne sont pas comparés aux nouveaux.
         <button class="btn" data-action="dismiss-notice">Compris</button></div>`
      : '';
  const done = LEVELS.filter((l) => save.levels[String(l.id)]?.completed).length;
  const stars = LEVELS.reduce((s, l) => s + (save.levels[String(l.id)]?.stars ?? 0), 0);
  const daily = save.daily[today];
  const dailyHint = daily ? `Aujourd’hui : ${formatTime(daily.bestTime)}` : formatDateFr(today);
  return `
  <div class="panel bare">
    <h1 class="title">POLARITÉ</h1>
    <p class="tagline">Un vaisseau, une orbite, une seule commande : inverser.</p>
    ${notice}
    <div class="menu">
      <button class="btn primary" data-action="levels">Niveaux<span class="hint">${done}/${LEVELS.length} terminés · ${stars}/${LEVELS.length * 3} ★</span></button>
      <button class="btn primary" data-action="survival">Survie<span class="hint">${escapeHtml(surv)}</span></button>
      <button class="btn" data-action="daily">Défi quotidien<span class="hint">${escapeHtml(dailyHint)}</span></button>
      <div class="row">
        <button class="btn" data-action="skins">Apparences</button>
        <button class="btn" data-action="options">Options</button>
      </div>
    </div>
    <p class="small">Touchez l’écran ou appuyez sur <span class="kbd">Espace</span> pour inverser la direction. <span class="kbd">Échap</span> : pause.</p>
  </div>`;
}

export function levelsScreen(save: SaveData): string {
  const cards = LEVELS.map((l) => {
    const rec = save.levels[String(l.id)];
    const unlocked = isLevelUnlocked(save, l.id);
    const stars = rec?.stars ?? 0;
    const best = rec?.completed ? `Meilleur : ${formatScore(rec.bestScore)}` : unlocked ? 'À réussir' : 'Verrouillé';
    return `<button class="level-card ${rec?.completed ? 'done' : ''}" data-action="play-level" data-level="${l.id}" ${unlocked ? '' : 'disabled'}
      aria-label="Niveau ${l.id}, ${escapeHtml(l.name)}${unlocked ? `, ${stars} étoiles sur 3` : ', verrouillé'}">
      <span class="n">${unlocked ? l.id : '🔒'}</span>
      <span class="name">${escapeHtml(l.name)}</span>
      <span class="st">${starsHtml(stars)}</span>
      <span class="best">${best}</span>
    </button>`;
  }).join('');
  return `<div class="panel wide">${back('Niveaux')}
    <p class="sub">90 secondes par niveau. Survivez jusqu’au bout pour débloquer le suivant ; le score donne les étoiles.</p>
    <div class="levels">${cards}</div>
  </div>`;
}

export function dailyScreen(save: SaveData, today: string): string {
  const rec = save.daily[today];
  const past = Object.keys(save.daily)
    .filter((d) => d !== today)
    .sort()
    .reverse()
    .slice(0, 7);
  const list = past.length
    ? `<h3>Jours précédents</h3><ul class="daily-list">${past
        .map((d) => `<li><span>${escapeHtml(formatDateFr(d))}</span><span>${formatTime(save.daily[d].bestTime)} · ${formatScore(save.daily[d].bestScore)} pts</span></li>`)
        .join('')}</ul>`
    : '';
  const old = legacyDailyList(save);
  const oldList = old.length
    ? `<h3>Ancien équilibrage</h3><ul class="daily-list">${old
        .map((d) => `<li><span>${escapeHtml(formatDateFr(d.date))}</span><span>${formatTime(d.time)} · ${formatScore(d.score)} pts</span></li>`)
        .join('')}</ul><p class="small" style="text-align:left">Obtenus avant la mise à jour : non comparables aux résultats actuels.</p>`
    : '';
  return `<div class="panel">${back('Défi quotidien')}
    <p class="sub">Défi du <strong>${escapeHtml(formatDateFr(today))}</strong> (date UTC)</p>
    <p>Règles de la Survie, avec des motifs générés à partir d’une graine identique pour tous les joueurs aujourd’hui. Vos inversions changent la suite : jouez juste.</p>
    <div class="stats">
      <div class="stat"><div class="k">Votre meilleur temps</div><div class="v">${rec ? formatTime(rec.bestTime) : '—'}</div></div>
      <div class="stat"><div class="k">Score associé</div><div class="v">${rec ? formatScore(rec.bestScore) : '—'}</div></div>
    </div>
    <button class="btn primary" data-action="play-daily" style="width:100%">Jouer le défi</button>
    ${list}
    ${oldList}
    <p class="small">Résultats enregistrés sur cet appareil uniquement. Il n’y a pas de classement en ligne.</p>
  </div>`;
}

function skinPreview(s: Skin): string {
  return `<svg class="preview" viewBox="0 0 120 70" aria-hidden="true">
    <rect width="120" height="70" rx="10" fill="#070b1f"/>
    <circle cx="60" cy="35" r="24" fill="none" stroke="${hex(s.orbit)}" stroke-width="2.5"/>
    <path d="M60 4 L67 13 L53 13 Z" transform="translate(0,7) rotate(90 60 11)" fill="${hex(s.ship)}"/>
    <rect x="80" y="31" width="7" height="7" transform="rotate(45 83.5 34.5)" fill="${hex(s.beacon)}"/>
    <rect x="33" y="31" width="7" height="7" transform="rotate(45 36.5 34.5)" fill="${hex(s.beacon)}"/>
  </svg>`;
}

export function skinsScreen(save: SaveData): string {
  const skins = SKINS.map((s) => {
    const unlocked = isSkinUnlocked(s, save.achievements);
    const sel = save.skin === s.id;
    const req = s.unlock ? achievementById(s.unlock)?.name ?? '' : 'Disponible';
    return `<button class="skin ${sel ? 'selected' : ''}" data-action="skin" data-skin="${s.id}" ${unlocked ? '' : 'disabled'} aria-pressed="${sel}">
      ${skinPreview(s)}
      <div class="name">${escapeHtml(s.name)}${sel ? ' ✓' : ''}</div>
      <div class="req">${unlocked ? (sel ? 'Sélectionnée' : 'Débloquée') : `🔒 Succès « ${escapeHtml(req)} »`}</div>
    </button>`;
  }).join('');
  const achs = ACHIEVEMENTS.map((a) => {
    const done = save.achievements[a.id] !== undefined;
    const skin = SKINS.find((s) => s.unlock === a.id);
    return `<div class="ach ${done ? 'done' : ''}"><div class="mark">✓</div><div><div class="t">${escapeHtml(a.name)}</div>
      <div class="d">${escapeHtml(a.description)}${skin ? ` — apparence « ${escapeHtml(skin.name)} »` : ''}</div></div></div>`;
  }).join('');
  const count = ACHIEVEMENTS.filter((a) => save.achievements[a.id] !== undefined).length;
  return `<div class="panel wide">${back('Apparences')}
    <p class="sub">Purement esthétiques : elles ne modifient aucune performance. Les menaces gardent toujours leurs couleurs.</p>
    <div class="skins">${skins}</div>
    <h3>Succès (${count}/${ACHIEVEMENTS.length})</h3>
    ${achs}
  </div>`;
}

export function optionsScreen(save: SaveData): string {
  const o = save.options;
  return `<div class="panel">${back('Options')}
    <div class="opt"><label for="opt-sound">Son<span class="d">Effets sonores procéduraux</span></label>
      <button id="opt-sound" class="btn toggle" data-action="toggle-sound" aria-pressed="${!o.muted}">${o.muted ? 'Coupé' : 'Activé'}</button></div>
    <div class="opt"><label for="opt-volume">Volume<span class="d" id="opt-volume-val">${Math.round(o.volume * 100)} %</span></label>
      <input id="opt-volume" type="range" min="0" max="100" step="5" value="${Math.round(o.volume * 100)}" data-input="volume" /></div>
    <div class="opt"><label for="opt-fx">Effets réduits<span class="d">Sans secousses, flash ni traînées décoratives</span></label>
      <button id="opt-fx" class="btn toggle" data-action="toggle-fx" aria-pressed="${o.reducedEffects}">${o.reducedEffects ? 'Activés' : 'Désactivés'}</button></div>
    <div class="opt"><label>Astuce de départ<span class="d">Réafficher l’explication des commandes</span></label>
      <button class="btn toggle" data-action="reset-tutorial">Réafficher</button></div>
    <h3>Progression</h3>
    <button class="btn danger" data-action="ask-reset" style="width:100%">Effacer toute la progression…</button>
    <p class="small">Sauvegarde locale (cet appareil, ce navigateur). Polarité v${__APP_VERSION__}</p>
  </div>`;
}

export function confirmResetScreen(): string {
  return `<div class="panel">
    <h2 class="fail">Effacer la progression ?</h2>
    <p class="sub">Niveaux, étoiles, records, défis, succès et apparences seront supprimés définitivement. Les options sont conservées.</p>
    <div class="menu">
      <button class="btn danger" data-action="confirm-reset">Oui, tout effacer</button>
      <button class="btn primary" data-action="options">Annuler</button>
    </div>
  </div>`;
}

export function pauseScreen(modeLabel: string): string {
  return `<div class="panel">
    <h2>Pause</h2>
    <p class="sub">${escapeHtml(modeLabel)}</p>
    <div class="menu">
      <button class="btn primary" data-action="resume" data-autofocus>Reprendre</button>
      <button class="btn" data-action="restart">Recommencer</button>
      <button class="btn" data-action="quit">Menu principal</button>
    </div>
    <p class="small">La reprise commence par un bref compte à rebours. Le temps en pause ne compte pas.</p>
  </div>`;
}

function achievementsNotice(report: RunReport): string {
  return report.achievements
    .map((a) => {
      const skin = SKINS.find((s) => s.unlock === a.id);
      return `<div class="notice">🏅 Succès : <strong>${escapeHtml(a.name)}</strong>${skin ? ` — apparence « ${escapeHtml(skin.name)} » débloquée` : ''}</div>`;
    })
    .join('');
}

export function resultScreen(report: RunReport, hasNextLevel: boolean): string {
  const r = report.run;
  const replay = `<button class="btn primary" data-action="replay" data-replay disabled>Rejouer</button>`;
  if (r.mode === 'level') {
    const level = LEVELS.find((l) => l.id === r.levelId);
    const name = level ? `Niveau ${level.id} — ${level.name}` : 'Niveau';
    if (r.outcome === 'complete') {
      const nextBtn = hasNextLevel ? `<button class="btn primary" data-action="next-level">Niveau suivant</button>` : '';
      return `<div class="panel">
        <h2 class="success">Niveau réussi !</h2>
        <p class="sub">${escapeHtml(name)}</p>
        <div class="stars" aria-label="${report.stars} étoiles sur 3">${starsHtml(report.stars)}</div>
        <div class="stats">
          <div class="stat"><div class="k">Score</div><div class="v ${report.newBestScore ? 'up' : ''}">${formatScore(r.score)}</div></div>
          <div class="stat"><div class="k">${report.newBestScore && report.previousBestScore > 0 ? 'Ancien meilleur' : 'Meilleur score'}</div><div class="v">${formatScore(report.newBestScore && report.previousBestScore > 0 ? report.previousBestScore : Math.max(r.score, report.previousBestScore))}</div></div>
        </div>
        ${level && report.stars < 3 ? `<p class="small" style="margin:0 0 10px">Étoiles : ${level.stars.map(formatScore).join(' · ')} points</p>` : ''}
        ${report.unlockedLevel ? `<div class="notice cyan">Niveau ${report.unlockedLevel} débloqué !</div>` : ''}
        ${!hasNextLevel ? `<div class="notice cyan">Vous avez terminé le dernier niveau. Bravo !</div>` : ''}
        ${achievementsNotice(report)}
        <div class="menu" style="margin-top:12px">
          <div class="row">${replay}${nextBtn}</div>
          <button class="btn" data-action="levels">Niveaux</button>
        </div>
      </div>`;
    }
    return `<div class="panel">
      <h2 class="fail">Collision</h2>
      <p class="sub">${escapeHtml(name)}</p>
      <div class="stats">
        <div class="stat"><div class="k">Tenu</div><div class="v">${formatTime(r.time)} / ${formatTime(LEVEL_DURATION, 0)}</div></div>
        <div class="stat"><div class="k">Score</div><div class="v">${formatScore(r.score)}</div></div>
      </div>
      <p class="sub">Survivez jusqu’à la fin du chrono pour débloquer la suite.</p>
      ${achievementsNotice(report)}
      <div class="menu">${replay}<button class="btn" data-action="levels">Niveaux</button></div>
    </div>`;
  }

  const isDaily = r.mode === 'daily';
  const title = report.newRecord && report.previousBestTime > 0 ? 'Nouveau record !' : 'Collision';
  const cls = report.newRecord && report.previousBestTime > 0 ? 'gold' : 'fail';
  const diff = r.time - report.previousBestTime;
  const best = report.newRecord ? r.time : report.previousBestTime;
  return `<div class="panel">
    <h2 class="${cls}">${title}</h2>
    <p class="sub">${isDaily && r.date ? `Défi du ${escapeHtml(formatDateFr(r.date))} (UTC)` : 'Survie'}</p>
    <div class="stats">
      <div class="stat"><div class="k">Durée</div><div class="v ${report.newRecord ? 'up' : ''}">${formatTime(r.time)}</div></div>
      ${report.newRecord && report.previousBestTime > 0
        ? `<div class="stat"><div class="k">Record précédent</div><div class="v">${formatTime(report.previousBestTime)}</div></div>`
        : `<div class="stat"><div class="k">${isDaily ? 'Meilleur du jour' : 'Record'}</div><div class="v">${formatTime(best)}</div></div>`}
      <div class="stat"><div class="k">Écart avec le record précédent</div><div class="v">${report.previousBestTime > 0 ? formatDelta(diff) : '—'}</div></div>
      <div class="stat"><div class="k">Score</div><div class="v">${formatScore(r.score)}</div></div>
    </div>
    ${report.legacyBestTime > 0 ? `<p class="small" style="margin:0 0 8px">Ancien équilibrage : ${formatTime(report.legacyBestTime)} (non comparable)</p>` : ''}
    ${achievementsNotice(report)}
    <div class="menu">${replay}<button class="btn" data-action="home">Menu principal</button></div>
  </div>`;
}
