import { CAMPAIGN_REWARDS, CHAPTER, MISSIONS, STARS_PER_MISSION, UPGRADES, missionById, type MissionDef } from '../config/campaign';
import { SPEAKERS, STORY, type StorySequence } from '../config/story';
import {
  isMissionUnlocked,
  isUpgradeEnabled,
  isUpgradeOwned,
  isUpgradeVisible,
  maxStars,
  missionRecord,
  missionStars,
  missionsCleared,
  nextMission,
  totalStars,
  type MissionResult,
} from '../campaign/progress';
import type { SaveData } from '../save/save';
import { resolveEquipped } from '../progression/skins';
import { CURRENCY_NAME, button, coin, notice, price, screenHead, stat, walletBar } from './components';
import { escapeHtml, formatScore, formatTime, starsHtml } from './format';
import { ICONS } from './icons';

/**
 * Écrans de la campagne : carte des chapitres, carte des missions, fiche de mission, hangar, journal, dialogues, résultat.
 * Comme les autres écrans : HTML généré à partir de la sauvegarde, actions par data-action gérées dans App.
 */

// ————————————————————————————————————————————— Carte des chapitres

export function campaignScreen(save: SaveData): string {
  const done = missionsCleared(save);
  const started = done > 0 || MISSIONS.some((m) => missionRecord(save, m.id).clears > 0);
  const seenCount = save.campaign.seen.length;
  return `<div class="panel panel--wide">${screenHead('Campagne')}
    ${walletBar(save.wallet)}
    <div class="chapters">
      <article class="chapter-card chapter-card--open" aria-label="Chapitre ${CHAPTER.number} : ${escapeHtml(CHAPTER.title)}">
        <span class="kind-label">Chapitre ${CHAPTER.number} · ${escapeHtml(CHAPTER.place)}</span>
        <h3 class="chapter-card__name">${escapeHtml(CHAPTER.title)}</h3>
        <p class="chapter-card__meta">${done}/${MISSIONS.length} missions · ${totalStars(save)}/${maxStars()} étoiles${save.campaign.chapterComplete ? ' · <span class="chip chip--equipped">Terminé</span>' : ''}</p>
        ${button({ action: 'chapter', label: started ? 'Continuer' : 'Commencer', icon: 'play', variant: 'primary', attrs: 'data-autofocus' })}
      </article>
      <article class="chapter-card chapter-card--soon" aria-label="Chapitre 2 : à venir">
        <span class="kind-label">Chapitre 2</span>
        <h3 class="chapter-card__name">À venir</h3>
        <p class="chapter-card__meta"><span class="chip chip--locked">${ICONS.lock}À venir</span></p>
      </article>
    </div>
    <div class="btn-stack campaign-links">
      ${button({ action: 'hangar', label: 'Hangar', sub: 'Vaisseau et améliorations', icon: 'rocket', variant: 'secondary', size: 'row', chevron: true })}
      ${button({ action: 'journal', label: 'Journal des transmissions', sub: `${seenCount}/${STORY.length} découvertes`, icon: 'signal', variant: 'secondary', size: 'row', chevron: true })}
      ${button({ action: 'levels', label: 'Défis classiques', sub: '12 niveaux de 90 secondes', icon: 'levels', variant: 'secondary', size: 'row', chevron: true })}
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Carte des missions

export function chapterScreen(save: SaveData): string {
  const next = nextMission(save);
  const nodes = MISSIONS.map((m) => {
    const unlocked = isMissionUnlocked(save, m.id);
    const rec = missionRecord(save, m.id);
    const stars = missionStars(save, m.id);
    const cls = ['mission-node'];
    if (rec.main) cls.push('mission-node--done');
    if (unlocked && m.id === next && !rec.main) cls.push('mission-node--next');
    if (!unlocked) cls.push('mission-node--locked');
    const state = !unlocked ? 'Verrouillée' : rec.main ? 'Terminée' : m.id === next ? 'Prochaine mission' : 'Disponible';
    const aria = `Mission ${m.id}, ${m.title} : ${state}${unlocked ? `, ${stars} étoile${stars > 1 ? 's' : ''} sur ${STARS_PER_MISSION}` : ''}`;
    const side = unlocked ? `<span class="stars">${starsHtml(stars, STARS_PER_MISSION)}</span>` : `<span class="mission-node__lock">${ICONS.lock}</span>`;
    return `<li><button class="${cls.join(' ')}" data-action="open-mission" data-mission="${m.id}" ${unlocked ? '' : 'disabled'} aria-label="${escapeHtml(aria)}">
      <span class="mission-node__n">${m.id}</span>
      <span class="mission-node__text"><span class="mission-node__title">${escapeHtml(m.title)}</span><span class="mission-node__state">${state}</span></span>
      ${side}
    </button></li>`;
  }).join('');
  const allDone = save.campaign.chapterComplete;
  return `<div class="panel panel--wide">${screenHead(`${CHAPTER.place} · ${CHAPTER.title}`, 'campaign')}
    <div class="stats">
      ${stat('Missions', `${missionsCleared(save)} / ${MISSIONS.length}`)}
      ${stat('Étoiles', `${totalStars(save)} / ${maxStars()}`, totalStars(save) === maxStars())}
    </div>
    <ol class="mission-path" aria-label="Missions du chapitre">${nodes}</ol>
    ${allDone ? notice('Chapitre terminé. La suite : <strong>à venir</strong>. L’apparence <strong>Écho</strong> est disponible dans les cosmétiques.', 'cyan') : ''}
  </div>`;
}

// ————————————————————————————————————————————— Fiche de mission

const check = (on: boolean): string => `<span class="goal__mark${on ? ' goal__mark--on' : ''}" aria-hidden="true">${on ? ICONS.check : ''}</span>`;

export function missionScreen(save: SaveData, id: number): string {
  const m = missionById(id);
  if (!m || !isMissionUnlocked(save, id)) {
    return `<div class="panel panel--pause"><h2 class="title">Mission verrouillée</h2>${button({ action: 'chapter', label: 'Retour', variant: 'primary', attrs: 'data-autofocus' })}</div>`;
  }
  const rec = missionRecord(save, id);
  const isLast = id === MISSIONS[MISSIONS.length - 1].id;
  const first = isLast ? CAMPAIGN_REWARDS.finalFirstClear : CAMPAIGN_REWARDS.firstClear;
  const rewards: [string, number, boolean][] = [
    ['Première réussite', first, rec.main],
    ['Défi secondaire', CAMPAIGN_REWARDS.star, rec.challenge],
    ['Sans bouclier', CAMPAIGN_REWARDS.star, rec.noShield],
  ];
  const active = UPGRADES.filter((u) => isUpgradeEnabled(save, u.id)).map((u) => u.name);
  const hangarVisible = UPGRADES.some((u) => isUpgradeVisible(save, u));
  return `<div class="panel panel--wide">${screenHead(`Mission ${m.id}`, 'chapter')}
    <h3 class="mission-sheet__title">${escapeHtml(m.title)}</h3>
    <p class="sub mission-sheet__summary">${escapeHtml(m.summary)}</p>
    <section class="goals" aria-label="Objectifs">
      <h4 class="section-title">Objectif</h4>
      <ul class="goal-list">
        <li class="goal">${check(rec.main)}<span>${escapeHtml(m.objectiveText)}</span><span class="goal__star">${starsHtml(1, 1)}</span></li>
      </ul>
      <h4 class="section-title">Défis secondaires</h4>
      <ul class="goal-list">
        <li class="goal">${check(rec.challenge)}<span>${escapeHtml(m.challenge.text)}</span><span class="goal__star">${starsHtml(1, 1)}</span></li>
        <li class="goal">${check(rec.noShield)}<span>Réussir sans déclencher le bouclier</span><span class="goal__star">${starsHtml(1, 1)}</span></li>
      </ul>
    </section>
    <section class="reward reward--sheet" aria-label="Récompenses">
      <div class="reward__k">Récompenses (une seule fois chacune)</div>
      <ul class="reward__list">
        ${rewards.map(([label, n, got]) => `<li><span>${got ? '✓ ' : ''}${escapeHtml(label)}</span><b>${got ? 'obtenu' : `+${n} Éclats`}</b></li>`).join('')}
        <li><span>Réussites suivantes</span><b>+${CAMPAIGN_REWARDS.repeat} Éclats</b></li>
      </ul>
    </section>
    <p class="small mission-sheet__meta">Durée maximale : ${formatTime(m.limit, 0)}${rec.bestTime > 0 ? ` · Meilleur temps : ${formatTime(rec.bestTime)}` : ''}${active.length ? ` · Améliorations actives : ${escapeHtml(active.join(', '))}` : ''}</p>
    <div class="btn-stack">
      ${button({ action: 'play-mission', label: 'Lancer', icon: 'play', variant: 'primary', attrs: `data-mission="${m.id}" data-autofocus` })}
      ${hangarVisible ? button({ action: 'hangar', label: 'Hangar', icon: 'rocket', variant: 'ghost' }) : ''}
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Hangar

export function hangarScreen(save: SaveData, pendingUpgrade: string | null = null): string {
  const skin = resolveEquipped(save.skin, save);
  const visible = UPGRADES.filter((u) => isUpgradeVisible(save, u));
  const hidden = UPGRADES.length - visible.length;
  const cards = visible
    .map((u) => {
      const owned = isUpgradeOwned(save, u.id);
      const enabled = isUpgradeEnabled(save, u.id);
      let action: string;
      if (owned) {
        action = `<button class="switch" role="switch" aria-checked="${enabled}" aria-label="${escapeHtml(u.name)} : ${enabled ? 'activée' : 'désactivée'}" data-action="toggle-upgrade" data-upgrade="${u.id}"></button>`;
      } else if (pendingUpgrade === u.id) {
        action = `<div class="upgrade__confirm">${button({ action: 'confirm-upgrade', label: `Confirmer · ${u.price} Éclats`, icon: 'check', variant: 'primary', size: 'sm', attrs: `data-upgrade="${u.id}" data-autofocus` })}${button({ action: 'cancel-upgrade', label: 'Annuler', variant: 'ghost', size: 'sm' })}</div>`;
      } else {
        const can = save.wallet.shards >= u.price;
        action = `${button({ action: 'buy-upgrade', label: 'Acheter', variant: can ? 'primary' : 'secondary', size: 'sm', attrs: `data-upgrade="${u.id}" ${can ? '' : 'disabled'}` })}`;
      }
      const state = owned
        ? `<span class="chip ${enabled ? 'chip--equipped' : 'chip--owned'}">${enabled ? ICONS.check : ''}${enabled ? 'Activée' : 'Désactivée'}</span>`
        : `${price('shards', u.price)}${save.wallet.shards < u.price ? '<span class="chip chip--locked">Solde insuffisant</span>' : ''}`;
      return `<li class="upgrade${owned ? ' upgrade--owned' : ''}">
        <div class="upgrade__text"><div class="upgrade__name">${escapeHtml(u.name)}</div><div class="upgrade__effect">${escapeHtml(u.effect)}</div><div class="upgrade__state">${state}</div></div>
        <div class="upgrade__action">${action}</div>
      </li>`;
    })
    .join('');
  return `<div class="panel panel--wide">${screenHead('Hangar', 'campaign')}
    ${walletBar(save.wallet)}
    <div class="skin-stage hangar-stage">
      <div class="skin-preview"><canvas class="skin-preview__canvas" data-skin-preview="${skin.id}" role="img" aria-label="Vaisseau équipé : ${escapeHtml(skin.name)}"></canvas></div>
      <div class="skin-info">
        <span class="kind-label">Vaisseau équipé</span>
        <h3 class="skin-info__name">${escapeHtml(skin.name)}</h3>
        <p class="skin-info__cond">Apparences et traînées : menu Cosmétiques.</p>
        ${button({ action: 'cosmetics', label: 'Cosmétiques', icon: 'shop', variant: 'secondary', size: 'sm' })}
      </div>
    </div>
    <h3 class="section-title">Améliorations</h3>
    ${cards ? `<ul class="upgrades">${cards}</ul>` : '<p class="sub">Aucune amélioration pour l’instant. Terminez la mission 3 pour découvrir la première.</p>'}
    ${hidden > 0 && cards ? '<p class="small">D’autres améliorations seront présentées en progressant dans la campagne.</p>' : ''}
    <p class="small hangar-note">Les améliorations ne s’appliquent qu’aux missions de la campagne (jamais à la Survie, au défi quotidien ni aux défis classiques). Elles s’achètent une fois, en Éclats, et s’activent ou se désactivent librement.</p>
  </div>`;
}

// ————————————————————————————————————————————— Journal des transmissions

export function journalScreen(save: SaveData): string {
  const seen = STORY.filter((s) => save.campaign.seen.includes(s.id));
  const missing = STORY.length - seen.length;
  const rows = seen
    .map((s) => `<li><button class="journal__entry" data-action="read-seq" data-seq="${s.id}"><span class="journal__icon">${ICONS.signal}</span><span class="journal__title">${escapeHtml(s.title)}</span><span class="btn__chev">${ICONS.chevron}</span></button></li>`)
    .join('');
  return `<div class="panel">${screenHead('Journal des transmissions', 'campaign')}
    ${seen.length ? `<ul class="journal">${rows}</ul>` : '<p class="sub">Aucune transmission pour l’instant. Elles s’ajoutent ici au fil des missions.</p>'}
    ${missing > 0 && seen.length ? `<p class="small journal__more">${missing} transmission${missing > 1 ? 's' : ''} encore à découvrir.</p>` : ''}
  </div>`;
}

// ————————————————————————————————————————————— Dialogue

/** Une réplique à la fois : suivant / passer. `last` : libellé du bouton de la dernière réplique. */
export function dialogueScreen(seq: StorySequence, index: number, finish: string): string {
  const line = seq.lines[Math.min(index, seq.lines.length - 1)];
  const last = index >= seq.lines.length - 1;
  const dots = seq.lines.map((_, i) => `<i class="dialogue__dot${i <= index ? ' dialogue__dot--on' : ''}"></i>`).join('');
  return `<div class="panel panel--dialogue" role="dialog" aria-label="Transmission : ${escapeHtml(seq.title)}">
    <div class="dialogue__head"><span class="kind-label">Transmission</span><span class="dialogue__title">${escapeHtml(seq.title)}</span></div>
    <div class="dialogue__line dialogue__line--${line.who}" aria-live="polite">
      <div class="dialogue__who">${escapeHtml(SPEAKERS[line.who])}</div>
      <p class="dialogue__text">${escapeHtml(line.text)}</p>
    </div>
    <div class="dialogue__dots" aria-hidden="true">${dots}</div>
    <div class="btn-stack">
      ${button({ action: 'dialogue-next', label: last ? finish : 'Suivant', icon: last ? 'check' : undefined, variant: 'primary', attrs: 'data-autofocus' })}
      ${last ? '' : button({ action: 'dialogue-skip', label: 'Passer', variant: 'ghost' })}
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Résultat de mission

function achievementLines(res: MissionResult): string {
  return res.achievements.map((a) => notice(`Succès : <strong>${escapeHtml(a.name)}</strong> — <strong>+${formatScore(a.shards)} Éclats</strong>`)).join('');
}

const replayButton = (): string => button({ action: 'replay', label: 'Rejouer', icon: 'replay', variant: 'primary', attrs: 'data-replay disabled' });

export function campaignResultScreen(save: SaveData, res: MissionResult, canNext: boolean): string {
  const m: MissionDef | undefined = missionById(res.report.missionId);
  const name = m ? `Mission ${m.id} — ${m.title}` : 'Mission';
  const rep = res.report;
  if (rep.outcome !== 'success') {
    const why = rep.outcome === 'timeout' ? 'Temps écoulé' : 'Collision';
    const tip = rep.outcome === 'timeout' ? 'L’objectif n’a pas été atteint à temps.' : 'Aucune pénalité : relancez quand vous voulez. Les transmissions déjà vues ne se répètent pas.';
    return `<div class="panel">
      <h2 class="title title--coral">${why}</h2>
      <p class="sub">${escapeHtml(name)}</p>
      <div class="result__hero">${formatTime(rep.time)}</div>
      <p class="result__score">objectif : ${escapeHtml(m?.objectiveText ?? '')}</p>
      <p class="sub">${tip}</p>
      ${achievementLines(res)}
      <div class="btn-stack result__actions">${replayButton()}${button({ action: 'chapter', label: 'Carte des missions', icon: 'levels', variant: 'ghost' })}</div>
    </div>`;
  }
  const stars = missionStars(save, rep.missionId);
  const rows: [string, number][] = [];
  if (res.rewards.firstClear > 0) rows.push(['Première réussite', res.rewards.firstClear]);
  if (res.newStars.challenge) rows.push(['Défi secondaire réussi', CAMPAIGN_REWARDS.star]);
  if (res.newStars.noShield) rows.push(['Réussi sans bouclier', CAMPAIGN_REWARDS.star]);
  if (res.rewards.repeatClear > 0) rows.push(['Réussite répétée', res.rewards.repeatClear]);
  const reward = rows.length
    ? `<div class="reward" aria-label="Éclats gagnés">
        <div class="reward__head">${coin('shards', 'coin--xl')}<div><div class="reward__k">Éclats gagnés</div><div class="reward__v">+${formatScore(res.rewards.total)}</div></div></div>
        <ul class="reward__list">${rows.map(([label, n]) => `<li><span>${escapeHtml(label)}</span><b>+${formatScore(n)}</b></li>`).join('')}</ul>
        <div class="reward__balance">Nouveau solde <strong>${formatScore(res.shardsBalance)}</strong> ${CURRENCY_NAME.shards}</div>
      </div>`
    : `<p class="small">Aucune nouvelle récompense : les bonus uniques sont déjà acquis.</p>`;
  const rec = missionRecord(save, rep.missionId);
  const line = (label: string, got: boolean, fresh: boolean): string => `<li class="goal">${check(got)}<span>${escapeHtml(label)}</span>${fresh ? '<span class="chip chip--equipped">Nouveau</span>' : ''}</li>`;
  const chapter = res.chapterCompleted
    ? notice('<strong>Chapitre terminé !</strong> L’apparence <strong>Écho</strong> est débloquée dans les cosmétiques. La suite : <strong>à venir</strong>.', 'cyan')
    : '';
  const unlocked = res.unlockedMission ? notice(`Mission ${res.unlockedMission} débloquée.`, 'cyan') : '';
  return `<div class="panel">
    <h2 class="title title--cyan">Mission accomplie</h2>
    <p class="sub">${escapeHtml(name)}</p>
    <div class="result__stars"><span class="stars stars--lg" role="img" aria-label="${stars} étoile${stars > 1 ? 's' : ''} sur ${STARS_PER_MISSION}">${starsHtml(stars, STARS_PER_MISSION)}</span></div>
    <p class="result__score">temps<strong>${formatTime(rep.time)}</strong></p>
    <ul class="goal-list">
      ${line(m?.objectiveText ?? 'Objectif', true, res.newStars.main)}
      ${line(m?.challenge.text ?? 'Défi', rec.challenge, res.newStars.challenge)}
      ${line('Sans déclencher le bouclier', rec.noShield, res.newStars.noShield)}
    </ul>
    ${reward}
    ${unlocked}${chapter}${achievementLines(res)}
    <div class="btn-stack result__actions">
      ${replayButton()}
      ${canNext ? button({ action: 'next-mission', label: 'Mission suivante', icon: 'chevron', variant: 'secondary' }) : ''}
      ${button({ action: 'chapter', label: 'Carte des missions', icon: 'levels', variant: 'ghost' })}
    </div>
  </div>`;
}
