import { DAILY_RANKING, LOYALTY, LOYALTY_LENGTH, dailyPrizeForRank, type LoyaltyReward } from '../config/rewards';
import { INCOMPATIBLE_MESSAGE, type PendingDaily } from '../net/leaderboard';
import type { DailyBoard, DailyNotice, LoyaltyCycleView, LoyaltyState } from '../net/rewardsProtocol';
import { button, coin, notice, screenHead } from './components';
import { escapeHtml, formatScore, formatTime } from './format';
import { formatDateFr } from '../modes/daily';
import { ICONS } from './icons';

/**
 * Écrans des récompenses gratuites (phase 4) : calendrier de connexion, classement mondial du Défi quotidien, notifications de gains.
 * Tout ce qui est affiché vient du SERVICE (jours, rangs, Prismes) ; l'appareil ne fait qu'afficher et demander.
 */

const rewardIcon = (r: LoyaltyReward): string => (r.kind === 'boost' ? `<span class="loy-ico loy-ico--boost">${ICONS.bolt}</span>` : r.kind === 'gel' ? `<span class="loy-ico loy-ico--gel">${ICONS.snow}</span>` : `<span class="loy-ico">${coin(r.kind)}</span>`);
export const rewardLabel = (r: LoyaltyReward): string =>
  r.kind === 'shards' ? `${formatScore(r.amount)} Éclats` : r.kind === 'prisms' ? `${formatScore(r.amount)} Prismes` : `${r.amount} ${r.kind === 'boost' ? 'Boost' : 'Gel'}`;

export interface LoyaltyView {
  /** Dernier état connu du service (null : jamais connecté). */
  state: LoyaltyState | null;
  /** Le service a répondu pendant cette ouverture (sinon : affichage du dernier état connu). */
  online: boolean;
  /** Ouvert hors ligne aujourd'hui : présence provisoire, à valider par le service ce même jour UTC. */
  provisional: boolean;
  /** Le service répond mais n'est pas à jour pour cette version du jeu (≠ hors ligne). */
  incompatible?: boolean;
  /** Réclamation en cours (`cycle:jour`). */
  busy: string | null;
  message: { kind: 'ok' | 'error'; text: string } | null;
  /** Récompenses récupérées à l'instant (`cycle:jour`) : animation courte. */
  justClaimed: string[];
  /** Maintenant (ms) : compte à rebours jusqu'au prochain jour UTC. */
  now: number;
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function stockFull(st: LoyaltyState, r: LoyaltyReward): boolean {
  return (r.kind === 'boost' || r.kind === 'gel') && st.stock[r.kind] + r.amount > st.stock.max;
}

function cell(st: LoyaltyState, c: LoyaltyCycleView, d: LoyaltyCycleView['days'][number], v: LoyaltyView): string {
  const key = `${c.id}:${d.day}`;
  const today = c.current && d.unlocked && st.presentToday && d.day === c.days.filter((x) => x.unlocked).length;
  const cls = ['loy-cell'];
  if (d.claimed) cls.push('loy-cell--claimed');
  else if (d.unlocked) cls.push('loy-cell--ready');
  else cls.push('loy-cell--locked');
  if (today) cls.push('loy-cell--today');
  if (d.reward.kind === 'prisms') cls.push('loy-cell--prisms');
  if (v.justClaimed.includes(key)) cls.push('loy-cell--just');
  let action = '';
  if (d.claimed) action = `<span class="chip chip--equipped">${ICONS.check}Récupérée</span>`;
  else if (d.unlocked) {
    const full = stockFull(st, d.reward);
    const needsPseudo = d.reward.kind === 'prisms' && !st.canClaimPrisms;
    action = button({
      action: 'loyalty-claim',
      label: full ? 'Stock plein' : needsPseudo ? 'Pseudo requis' : 'Récupérer',
      icon: full || needsPseudo ? 'lock' : 'check',
      variant: full || needsPseudo ? 'secondary' : 'primary',
      size: 'sm',
      attrs: `data-cycle="${c.id}" data-day="${d.day}" aria-label="Récupérer : ${escapeHtml(rewardLabel(d.reward))}"${v.busy !== null || !v.online || full || needsPseudo ? ' disabled' : ''}`,
    });
  } else action = `<span class="loy-lock">${ICONS.lock}<span class="sr-only">Verrouillé</span></span>`;
  return `<div class="${cls.join(' ')}" data-loy="${key}"><span class="loy-day">Jour ${d.day}${today ? ' · aujourd’hui' : ''}</span>${rewardIcon(d.reward)}<strong class="loy-reward">${escapeHtml(rewardLabel(d.reward))}</strong>${action}</div>`;
}

/** Écran « Récompenses de connexion » : cycle de 10 jours, statut de chaque récompense, « Récupérer », absence restante, anciens cycles. */
export function loyaltyScreen(v: LoyaltyView): string {
  const st = v.state;
  const msg = v.message ? `<div role="${v.message.kind === 'error' ? 'alert' : 'status'}" class="notice${v.message.kind === 'ok' ? ' notice--cyan' : ''}">${escapeHtml(v.message.text)}</div>` : '';
  if (!st && v.incompatible) {
    return `<div class="panel panel--wide loy">${screenHead('Récompenses de connexion')}
      ${notice(INCOMPATIBLE_MESSAGE, 'cyan')}
      <p class="small">Rien n’est perdu : la présence sera validée dès que le service sera à jour.</p>
    </div>`;
  }
  if (!st) {
    return `<div class="panel panel--wide loy">${screenHead('Récompenses de connexion')}
      ${msg}
      ${notice('Le calendrier est validé par le <strong>service en ligne</strong> (jours UTC, 00 h 00). Hors connexion, aucune présence n’est comptée : ouvrez le jeu une fois connecté.', 'cyan')}
      ${v.provisional ? '<p class="small">Présence de cet appareil notée <strong>provisoirement</strong> : elle ne sera comptée que si le service la valide aujourd’hui (même jour UTC).</p>' : ''}
    </div>`;
  }
  const cur = st.cycles.find((c) => c.current) ?? st.cycles[0];
  const done = cur ? cur.days.filter((d) => d.unlocked).length : 0;
  const old = st.cycles.filter((c) => c !== cur && c.days.some((d) => d.unlocked && !d.claimed));
  let absence = '';
  if (cur?.complete) absence = 'Cycle terminé : le prochain démarre au prochain jour UTC.';
  else if (st.absencesLeft === 1) absence = 'Absence tolérée : <strong>1 restante</strong> dans ce cycle.';
  else if (st.absencesLeft === 0) absence = 'Absence tolérée : <strong>aucune</strong> — une nouvelle absence réinitialise le cycle.';
  const next = countdown(st.nextDayAt - v.now);
  const grid = cur ? `<div class="loy-grid" role="list">${cur.days.map((d) => cell(st, cur, d, v)).join('')}</div>` : '';
  const oldHtml = old.length
    ? `<h3 class="section-title">Récompenses en attente (cycles précédents)</h3>
       <p class="small">Ce qui a été débloqué reste récupérable sans limite de temps, même après une réinitialisation.</p>
       ${old
         .map(
           (c) => `<div class="loy-old">${c.days
             .filter((d) => d.unlocked && !d.claimed)
             .map((d) => cell(st, c, d, v))
             .join('')}</div>`,
         )
         .join('')}`
    : '';
  const prismNote = !st.canClaimPrisms ? `<div class="notice notice--cyan" role="status">Les <strong>Prismes</strong> se récupèrent avec un pseudo choisi (menu Classement) : la récompense du jour 10 vous attend.</div>` : '';
  const offline = !v.online ? `<div class="notice" role="status">Hors connexion : dernier état connu affiché. La présence d’aujourd’hui sera validée dès la reconnexion (même jour UTC) ; récupérer une récompense demande une connexion.</div>` : '';
  const burst = v.justClaimed.some((k) => k.endsWith(`:${LOYALTY_LENGTH}`)) ? `<div class="loy-burst" aria-hidden="true">${coin('prisms', 'coin--xl')}<i></i><i></i><i></i><i></i><i></i><i></i></div>` : '';
  return `<div class="panel panel--wide loy">${screenHead('Récompenses de connexion')}
    ${msg}${offline}
    <div class="loy-head">
      <div class="stat"><div class="stat__k">Jour</div><div class="stat__v stat__v--gold">${done} / ${LOYALTY_LENGTH}</div></div>
      <div class="stat"><div class="stat__k">Prochain jour UTC</div><div class="stat__v">${escapeHtml(next)}</div></div>
      <div class="stat"><div class="stat__k">À récupérer</div><div class="stat__v">${st.claimable}</div></div>
    </div>
    ${absence ? `<p class="loy-absence" role="status">${absence}</p>` : ''}
    ${v.provisional && !st.presentToday ? '<p class="small">Présence d’aujourd’hui notée provisoirement sur cet appareil : le service la valide à la connexion.</p>' : ''}
    ${grid}
    ${prismNote}${oldHtml}
    ${burst}
    <p class="small">Une connexion suffit à valider la présence du jour : rien à récupérer tout de suite. Journées à 00 h 00 UTC, décidées par le service. Une seule absence est tolérée par cycle de ${LOYALTY_LENGTH} jours ; la deuxième, même non consécutive, le réinitialise. Total d’un cycle : 200 Éclats, 2 Boosts, 2 Gels, 5 Prismes.</p>
  </div>`;
}

// ————————————————————————— classement mondial du Défi quotidien

export interface DailyBoardView {
  board: DailyBoard | null;
  loading: boolean;
  error: string | null;
  /** Le service est configuré dans cette version. */
  configured: boolean;
  /** Dernières tentatives de cet appareil, en attente ou traitées. */
  pending: PendingDaily[];
  /** Maintenant (ms). */
  now: number;
}

const prizeRows = (): string =>
  DAILY_RANKING.prizes.map((p) => `<li><span>${p.from === p.to ? `${p.from}${p.from === 1 ? 'er' : 'e'}` : `${p.from}ᵉ à ${p.to}ᵉ`}</span><b>${p.prisms} ${coin('prisms')}</b></li>`).join('');

/** Section « Classement mondial du jour » du Défi quotidien : Top, rang personnel, ex æquo, récompenses, compte à rebours, statut provisoire / définitif. */
export function dailyBoardHtml(v: DailyBoardView): string {
  if (!v.configured) return '<p class="small" style="margin-top:14px">Résultats enregistrés sur cet appareil uniquement : le classement mondial n’est pas disponible dans cette version.</p>';
  const head = '<h3 class="section-title">Classement mondial du jour</h3>';
  if (v.loading && !v.board) return `${head}<p class="sub" role="status">Chargement du classement…</p>`;
  if (!v.board) return `${head}<div role="alert" class="notice">${v.error === INCOMPATIBLE_MESSAGE ? escapeHtml(INCOMPATIBLE_MESSAGE) : `Classement indisponible${v.error ? ` : ${escapeHtml(v.error)}` : ''}`} ${button({ action: 'daily-refresh', label: 'Réessayer', variant: 'secondary', size: 'sm' })}</div>`;
  const b = v.board;
  const status =
    b.status === 'open'
      ? `<span class="chip chip--owned">En cours</span> fin dans <strong>${countdown(b.endsAt - v.now)}</strong> (00 h 00 UTC)`
      : b.status === 'grace'
        ? `<span class="chip chip--owned">Provisoire</span> dernières soumissions acceptées jusqu’à 00 h 15 UTC (dans <strong>${countdown(b.finalAt - v.now)}</strong>)`
        : '<span class="chip chip--equipped">Définitif</span> Prismes crédités par le service';
  const rows = b.entries.length
    ? `<div class="lb-table" role="table" aria-label="Classement du ${escapeHtml(formatDateFr(b.date))}">
        <div class="lb-row lb-row--head" role="row"><span role="columnheader">#</span><span role="columnheader">Pseudo</span><span role="columnheader">Durée</span><span role="columnheader">Prismes</span></div>
        ${b.entries.slice(0, 20).map((e) => `<div class="lb-row${e.you ? ' lb-row--you' : ''}" role="row"><span class="lb-rank">${e.rank}</span><span class="lb-name">${escapeHtml(e.nickname)}${e.you ? ' <em>(vous)</em>' : ''}</span><span>${formatTime(e.time)}</span><span class="lb-prism">${e.prisms > 0 ? `+${e.prisms}` : '—'}</span></div>`).join('')}
      </div>`
    : '<p class="sub" style="margin:10px 0">Personne n’est encore classé aujourd’hui : soyez le premier.</p>';
  const tie = b.entries.some((e, i) => i > 0 && e.rank === b.entries[i - 1].rank) ? '<p class="small">Les ex æquo (durée et score identiques) partagent le même rang et la même récompense.</p>' : '';
  let me = '';
  if (b.me) {
    me = b.me.eligible
      ? `<div class="stats"><div class="stat"><div class="stat__k">Votre rang</div><div class="stat__v stat__v--gold">${b.me.rank} / ${b.total}</div></div><div class="stat"><div class="stat__k">${b.status === 'final' ? 'Prismes gagnés' : 'Prismes (provisoire)'}</div><div class="stat__v">${b.me.prisms}</div></div></div>`
      : `<div class="notice notice--cyan" role="status">Votre résultat (${formatTime(b.me.time)}) est enregistré, mais pas classé : choisissez un pseudo dans le menu Classement pour apparaître au classement et gagner des Prismes.</div>`;
  }
  const mineToday = v.pending.filter((p) => p.date === b.date);
  const pend = mineToday.length
    ? `<ul class="lb-pending-list">${mineToday
        .slice(-2)
        .reverse()
        .map((p) => {
          const label = p.status === 'accepted' ? `Validé par le service${p.result ? ` — rang ${p.result.rank}${p.result.late ? ' (envoi tardif accepté)' : ''}` : ''}` : p.status === 'rejected' ? `Non validé — ${p.message ?? 'refusé'}` : p.lastError ? 'En attente de connexion (nouvel essai automatique)' : 'En attente d’envoi';
          return `<li class="lb-pending lb-pending--${p.status === 'accepted' ? 'ok' : p.status === 'rejected' ? 'bad' : 'wait'}"><strong>${formatTime(p.submission.claimed.time)}</strong> · ${formatScore(p.submission.claimed.score)} pts<span>${escapeHtml(label)}</span></li>`;
        })
        .join('')}</ul>`
    : '';
  const dateNote = `Défi du ${escapeHtml(formatDateFr(b.date))} (UTC)`;
  return `${head}
    <p class="small" style="text-align:left">${dateNote} — ${status}</p>
    ${me}${rows}${tie}${pend}
    <h3 class="section-title">Récompenses du Top 10</h3>
    <ul class="loy-prizes">${prizeRows()}</ul>
    <p class="small">Prismes crédités automatiquement par le service à 00 h 15 UTC (${formatScore(Array.from({ length: 10 }, (_, i) => dailyPrizeForRank(i + 1)).reduce((a, c) => a + c, 0))} Prismes par jour sans égalité). Une tentative doit être <strong>démarrée en ligne</strong> pour être classée ; l’heure de fin n’est jamais celle de l’appareil. Pseudo requis pour apparaître au classement.</p>`;
}

// ————————————————————————— notifications de gains

export type GainNotice =
  | ({ kind: 'daily' } & DailyNotice)
  | { kind: 'drop'; prisms: number };

/** Notification au lancement : résultats du Défi quotidien (rang et Prismes) et drops rares confirmés par le service. */
export function noticesScreen(items: GainNotice[]): string {
  const total = items.reduce((t, n) => t + (n.kind === 'daily' ? n.prisms : n.prisms), 0);
  const rows = items
    .map((n) =>
      n.kind === 'drop'
        ? `<li class="gain gain--drop"><span class="gain__gem">${coin('prisms', 'coin--xl')}</span><div><strong>Prisme trouvé !</strong><span>Un drop extrêmement rare, tiré et confirmé par le service pendant votre dernière partie.</span></div><b>+${n.prisms}</b></li>`
        : `<li class="gain"><span class="gain__rank">${n.rank}</span><div><strong>Défi du ${escapeHtml(formatDateFr(n.date))} : ${n.rank === 1 ? '1ère place' : `${n.rank}ᵉ place`}</strong><span>${formatTime(n.time)} · ${formatScore(n.score)} points</span></div><b>${n.prisms > 0 ? `+${n.prisms}` : '—'}</b></li>`,
    )
    .join('');
  return `<div class="panel panel--pause notices">
    <h2 class="title title--gold">Récompenses</h2>
    <p class="sub">${total > 0 ? `<strong>+${total} Prisme${total > 1 ? 's' : ''}</strong> crédité${total > 1 ? 's' : ''} par le service.` : 'Résultats des défis.'}</p>
    <ul class="gains">${rows}</ul>
    <div class="btn-stack">${button({ action: 'notices-continue', label: 'Continuer', icon: 'chevron', variant: 'primary', attrs: 'data-autofocus' })}</div>
  </div>`;
}

export { LOYALTY };
