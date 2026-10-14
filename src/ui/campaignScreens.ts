import { CAMPAIGN_REWARDS, CHAPTER, MISSIONS, STARS_PER_MISSION, missionById, type MissionDef } from '../config/campaign';
import { STORY, storyAsset, storyById, SPEAKERS, type StorySequence } from '../config/story';
import { isMissionUnlocked, maxStars, missionRecord, missionStars, missionsCleared, nextMission, totalStars, type MissionResult } from '../campaign/progress';
import type { SaveData } from '../save/save';
import { button, notice, screenHead, stat } from './components';
import { escapeHtml, formatScore, formatTime, starsHtml } from './format';
import { ICONS } from './icons';

/**
 * Écrans de la campagne : carte des chapitres, carte des niveaux, fiche, journal, récit (scènes illustrées), bilan.
 * Comme les autres écrans : HTML généré à partir de la sauvegarde, actions par data-action gérées dans App.
 * Les Éclats de campagne (réserve séparée) sont les seuls montants affichés ici : le portefeuille de la Survie n'apparaît pas.
 */

const reserveStat = (save: SaveData): string => stat('Éclats de campagne', formatScore(save.campaign.reserve));

/** Cadre « Suite à venir » : information, pas un bouton. */
const comingSoon = (label: string): string => `<div class="coming-soon" role="note">${ICONS.lock}<span>${escapeHtml(label)}</span></div>`;

// ————————————————————————————————————————————— Carte des chapitres

export function campaignScreen(save: SaveData): string {
  const done = missionsCleared(save);
  const started = done > 0 || MISSIONS.some((m) => missionRecord(save, m.id).clears > 0);
  const seen = save.campaign.seen.length;
  return `<div class="panel panel--wide">${screenHead('Campagne')}
    <div class="chapters">
      <article class="chapter-card chapter-card--open" aria-label="Chapitre ${CHAPTER.number} : ${escapeHtml(CHAPTER.title)}">
        <span class="kind-label">Chapitre ${CHAPTER.number}</span>
        <h3 class="chapter-card__name">${escapeHtml(CHAPTER.title)}</h3>
        <p class="chapter-card__meta">${done}/${MISSIONS.length} niveaux · ${totalStars(save)}/${maxStars()} étoiles${save.campaign.chapterComplete ? ' · <span class="chip chip--equipped">Terminé</span>' : ''}</p>
        ${button({ action: 'chapter', label: started ? 'Continuer' : 'Commencer', icon: 'play', variant: 'primary', attrs: 'data-autofocus' })}
      </article>
      <article class="chapter-card chapter-card--soon" aria-label="Suite du chapitre : à venir">
        <span class="kind-label">Suite du chapitre</span>
        <h3 class="chapter-card__name">À venir</h3>
        <p class="chapter-card__meta"><span class="chip chip--locked">${ICONS.lock}À venir</span></p>
      </article>
    </div>
    <div class="stats">${reserveStat(save)}${stat('Scènes vues', `${seen} / ${STORY.length}`)}</div>
    <p class="small">Les Éclats de campagne forment une réserve propre à la campagne : ils sont distincts des Éclats de la Survie et de la boutique et ne s’échangent pas. Leur usage est prévu avec la suite de la campagne : pour l’instant ils s’accumulent simplement.</p>
    <div class="btn-stack campaign-links">
      ${button({ action: 'journal', label: 'Journal des scènes', sub: 'Relire les introductions et conclusions', icon: 'signal', variant: 'secondary', size: 'row', chevron: true })}
      ${button({ action: 'levels', label: 'Défis classiques', sub: '12 niveaux de 90 secondes', icon: 'levels', variant: 'secondary', size: 'row', chevron: true })}
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Carte des niveaux

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
    const state = !unlocked ? 'Verrouillé' : rec.main ? 'Terminé' : m.id === next ? 'Prochain niveau' : 'Disponible';
    const aria = `Niveau ${m.id}, ${m.title} : ${state}${unlocked ? `, ${stars} étoile${stars > 1 ? 's' : ''} sur ${STARS_PER_MISSION}` : ''}`;
    const side = unlocked ? `<span class="stars">${starsHtml(stars, STARS_PER_MISSION)}</span>` : `<span class="mission-node__lock">${ICONS.lock}</span>`;
    return `<li><button class="${cls.join(' ')}" data-action="open-mission" data-mission="${m.id}" ${unlocked ? '' : 'disabled'} aria-label="${escapeHtml(aria)}">
      <span class="mission-node__n">${m.id}</span>
      <span class="mission-node__text"><span class="mission-node__title">${escapeHtml(m.title)}</span><span class="mission-node__state">${state}</span></span>
      ${side}
    </button></li>`;
  }).join('');
  return `<div class="panel panel--wide">${screenHead(CHAPTER.title, 'campaign')}
    <div class="stats">
      ${stat('Niveaux', `${missionsCleared(save)} / ${MISSIONS.length}`)}
      ${stat('Étoiles', `${totalStars(save)} / ${maxStars()}`, totalStars(save) === maxStars())}
      ${reserveStat(save)}
    </div>
    <ol class="mission-path" aria-label="Niveaux du chapitre">${nodes}<li>${comingSoon('Suite du chapitre à venir')}</li></ol>
    ${save.campaign.chapterComplete ? notice('Vous avez terminé les niveaux disponibles. La suite du chapitre est <strong>à venir</strong> ; vous pouvez rejouer ou relire les scènes.', 'cyan') : ''}
  </div>`;
}

// ————————————————————————————————————————————— Fiche de niveau

const check = (on: boolean): string => `<span class="goal__mark${on ? ' goal__mark--on' : ''}" aria-hidden="true">${on ? ICONS.check : ''}</span>`;

export function missionScreen(save: SaveData, id: number): string {
  const m = missionById(id);
  if (!m || !isMissionUnlocked(save, id)) {
    return `<div class="panel panel--pause"><h2 class="title">Niveau verrouillé</h2>${button({ action: 'chapter', label: 'Retour', variant: 'primary', attrs: 'data-autofocus' })}</div>`;
  }
  const rec = missionRecord(save, id);
  const rewards: [string, number, boolean][] = [
    ['Première réussite', CAMPAIGN_REWARDS.firstClear, rec.main],
    ['Défi secondaire', CAMPAIGN_REWARDS.star, rec.challenge],
  ];
  const replay = (seqId: string | undefined, label: string): string =>
    seqId && save.campaign.seen.includes(seqId) ? button({ action: 'read-seq', label, icon: 'signal', variant: 'ghost', attrs: `data-seq="${seqId}" data-from="mission"` }) : '';
  return `<div class="panel panel--wide">${screenHead(`Niveau ${m.id}`, 'chapter')}
    <h3 class="mission-sheet__title">${escapeHtml(m.title)}</h3>
    <p class="sub mission-sheet__summary">${escapeHtml(m.summary)}</p>
    <section class="goals" aria-label="Objectifs">
      <h4 class="section-title">Objectif</h4>
      <ul class="goal-list">
        <li class="goal">${check(rec.main)}<span>${escapeHtml(m.objectiveText)}</span><span class="goal__star">${starsHtml(1, 1)}</span></li>
      </ul>
      <h4 class="section-title">Défi secondaire</h4>
      <ul class="goal-list">
        <li class="goal">${check(rec.challenge)}<span>${escapeHtml(m.challenge.text)}</span><span class="goal__star">${starsHtml(1, 1)}</span></li>
      </ul>
    </section>
    <section class="reward reward--sheet" aria-label="Récompenses">
      <div class="reward__k">Récompenses en Éclats de campagne (une seule fois chacune)</div>
      <ul class="reward__list">
        ${rewards.map(([label, n, got]) => `<li><span>${got ? '✓ ' : ''}${escapeHtml(label)}</span><b>${got ? 'obtenu' : `+${n}`}</b></li>`).join('')}
      </ul>
    </section>
    <p class="small mission-sheet__meta">Durée maximale : ${formatTime(m.limit, 0)}${rec.bestTime > 0 ? ` · Meilleur temps : ${formatTime(rec.bestTime)}` : ''}</p>
    <div class="btn-stack">
      ${button({ action: 'play-mission', label: 'Lancer', icon: 'play', variant: 'primary', attrs: `data-mission="${m.id}" data-autofocus` })}
      ${replay(m.before, 'Revoir l’introduction')}
      ${replay(m.after, 'Revoir la conclusion')}
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Journal des scènes

export function journalScreen(save: SaveData): string {
  const seen = STORY.filter((s) => save.campaign.seen.includes(s.id));
  const missing = STORY.length - seen.length;
  const rows = seen
    .map((s) => `<li><button class="journal__entry" data-action="read-seq" data-seq="${s.id}" data-from="journal"><span class="journal__icon">${ICONS.signal}</span><span class="journal__title">${escapeHtml(s.title)}</span><span class="btn__chev">${ICONS.chevron}</span></button></li>`)
    .join('');
  return `<div class="panel">${screenHead('Journal des scènes', 'campaign')}
    ${seen.length ? `<ul class="journal">${rows}</ul>` : '<p class="sub">Aucune scène pour l’instant. Elles s’ajoutent ici au fil des niveaux.</p>'}
    ${missing > 0 && seen.length ? `<p class="small journal__more">${missing} scène${missing > 1 ? 's' : ''} encore à découvrir.</p>` : ''}
  </div>`;
}

// ————————————————————————————————————————————— Récit : illustration au-dessus, dialogue au-dessous

/**
 * Une réplique à la fois. Le texte complet est présent (zone invisible qui fixe la taille de la boîte) ; l'application y superpose le texte
 * qui apparaît progressivement. Toucher la scène ou la boîte (hors boutons) : révéler la réplique, puis avancer. « Passer la scène » ferme la scène.
 */
export function storyScreen(seq: StorySequence, index: number, finish: string): string {
  const i = Math.min(index, seq.lines.length - 1);
  const line = seq.lines[i];
  const last = i >= seq.lines.length - 1;
  const portrait = storyAsset(SPEAKERS[line.who].portrait);
  const img = storyAsset(seq.illustration);
  return `<div class="story" role="dialog" aria-label="Scène : ${escapeHtml(seq.title)}">
    ${img ? `<img class="story__bg" src="${img}" alt="" aria-hidden="true" decoding="async" />` : ''}
    <div class="story__scene" data-action="story-advance">${img ? `<img class="story__img" src="${img}" alt="" decoding="async" />` : ''}</div>
    <div class="story__box story__box--${line.who}${line.system ? ' story__box--system' : ''}" data-action="story-advance">
      <div class="story__row">
        ${portrait ? `<div class="story__portrait"><img src="${portrait}" alt="" decoding="async" /></div>` : ''}
        <div class="story__body">
          <div class="story__name">${escapeHtml(line.name)}</div>
          <p class="story__text" aria-label="${escapeHtml(line.text)}"><span class="story__ghost" aria-hidden="true">${escapeHtml(line.text)}</span><span class="story__live" id="story-live" aria-hidden="true"></span></p>
        </div>
      </div>
      <div class="story__bar">
        <span class="story__count">${i + 1} / ${seq.lines.length}</span>
        <span class="story__hint" id="story-hint">${last ? escapeHtml(finish) : 'Touchez pour continuer'}</span>
        ${button({ action: 'story-skip', label: 'Passer la scène', variant: 'ghost', size: 'sm' })}
      </div>
    </div>
  </div>`;
}

// ————————————————————————————————————————————— Bilan de niveau

const replayButton = (): string => button({ action: 'replay', label: 'Rejouer', icon: 'replay', variant: 'primary', attrs: 'data-replay disabled' });

export function campaignResultScreen(save: SaveData, res: MissionResult, canNext: boolean): string {
  const m: MissionDef | undefined = missionById(res.report.missionId);
  const name = m ? `Niveau ${m.id} — ${m.title}` : 'Niveau';
  const rep = res.report;
  if (rep.outcome !== 'success') {
    const why = rep.outcome === 'timeout' ? 'Temps écoulé' : 'Collision';
    const tip = rep.outcome === 'timeout' ? 'L’objectif n’a pas été atteint à temps.' : 'Aucune pénalité : réessayez quand vous voulez. Les scènes déjà vues ne se répètent pas.';
    return `<div class="panel">
      <h2 class="title title--coral">${why}</h2>
      <p class="sub">${escapeHtml(name)}</p>
      <div class="result__hero">${formatTime(rep.time)}</div>
      <p class="result__score">objectif : ${escapeHtml(m?.objectiveText ?? '')}</p>
      <p class="sub">${tip}</p>
      <div class="btn-stack result__actions">${replayButton()}${button({ action: 'chapter', label: 'Carte des niveaux', icon: 'levels', variant: 'ghost' })}</div>
    </div>`;
  }
  const stars = missionStars(save, rep.missionId);
  const rows: [string, number][] = [];
  if (res.rewards.firstClear > 0) rows.push(['Première réussite', res.rewards.firstClear]);
  if (res.newStars.challenge) rows.push(['Défi secondaire réussi', res.rewards.challenge]);
  const reward = rows.length
    ? `<div class="reward" aria-label="Éclats de campagne gagnés">
        <div class="reward__head"><div><div class="reward__k">Éclats de campagne gagnés</div><div class="reward__v">+${formatScore(res.rewards.total)}</div></div></div>
        <ul class="reward__list">${rows.map(([label, n]) => `<li><span>${escapeHtml(label)}</span><b>+${formatScore(n)}</b></li>`).join('')}</ul>
        <div class="reward__balance">Réserve de campagne <strong>${formatScore(res.reserveBalance)}</strong> Éclats</div>
      </div>`
    : '<p class="small">Aucune nouvelle récompense : les récompenses uniques sont déjà acquises.</p>';
  const rec = missionRecord(save, rep.missionId);
  const line = (label: string, got: boolean, fresh: boolean): string => `<li class="goal">${check(got)}<span>${escapeHtml(label)}</span>${fresh ? '<span class="chip chip--equipped">Nouveau</span>' : ''}</li>`;
  const unlocked = res.unlockedMission ? notice(`Niveau ${res.unlockedMission} débloqué.`, 'cyan') : '';
  const chapter = res.chapterCompleted || (!canNext && save.campaign.chapterComplete && rep.missionId === MISSIONS[MISSIONS.length - 1].id)
    ? notice('<strong>Suite du chapitre à venir.</strong> Vous pouvez rejouer les niveaux ou relire les scènes depuis le journal.', 'cyan')
    : '';
  return `<div class="panel">
    <h2 class="title title--cyan">Niveau réussi</h2>
    <p class="sub">${escapeHtml(name)}</p>
    <div class="result__stars"><span class="stars stars--lg" role="img" aria-label="${stars} étoile${stars > 1 ? 's' : ''} sur ${STARS_PER_MISSION}">${starsHtml(stars, STARS_PER_MISSION)}</span></div>
    <p class="result__score">temps<strong>${formatTime(rep.time)}</strong></p>
    <ul class="goal-list">
      ${line(m?.objectiveText ?? 'Objectif', true, res.newStars.main)}
      ${line(m?.challenge.text ?? 'Défi', rec.challenge, res.newStars.challenge)}
    </ul>
    ${reward}
    ${unlocked}${chapter}
    <div class="btn-stack result__actions">
      ${replayButton()}
      ${canNext ? button({ action: 'next-mission', label: 'Niveau suivant', icon: 'chevron', variant: 'secondary' }) : ''}
      ${button({ action: 'chapter', label: 'Carte des niveaux', icon: 'levels', variant: 'ghost' })}
    </div>
  </div>`;
}

export { storyById };
