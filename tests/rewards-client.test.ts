import { describe, expect, it } from 'vitest';
import { BONUS } from '../src/config/economy';
import { LOYALTY } from '../src/config/rewards';
import { applyLoyaltyClaim } from '../src/economy/loyalty';
import { LeaderboardClient, PENDING_DAILY_KEY } from '../src/net/leaderboard';
import type { DailyBoard, LoyaltyClaimResponse, LoyaltyState } from '../src/net/rewardsProtocol';
import { MemoryStore, defaultSave, parseSave, sanitize } from '../src/save/save';
import * as S from '../src/ui/screens';
import * as RW from '../src/ui/rewardsScreens';

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

function state(over: Partial<LoyaltyState> = {}, unlocked = 3, claimed: number[] = [], current = true): LoyaltyState {
  return {
    today: '2026-10-15',
    nextDayAt: NOW + 12 * 3600_000,
    presentToday: true,
    cycles: [{ id: 7, current, absences: 0, complete: unlocked >= 10, days: LOYALTY.days.map((reward, i) => ({ day: i + 1, reward, unlocked: i + 1 <= unlocked, claimed: claimed.includes(i + 1) })) }],
    absencesLeft: 1,
    claimable: unlocked - claimed.length,
    canClaimPrisms: true,
    stock: { boost: 0, gel: 0, max: BONUS.maxStock },
    ...over,
  };
}
const view = (over: Partial<RW.LoyaltyView> = {}): RW.LoyaltyView => ({ state: state(), online: true, provisional: false, busy: null, message: null, justClaimed: [], now: NOW, ...over });

describe('Calendrier de connexion : écran', () => {
  it('dix récompenses, statuts (récupérée / à récupérer / verrouillée), « Récupérer », absence restante, compte à rebours', () => {
    const html = RW.loyaltyScreen(view({ state: state({}, 3, [1]) }));
    expect(html.match(/data-loy="7:\d+"/g)).toHaveLength(10);
    for (const label of ['20 Éclats', '1 Boost', '30 Éclats', '1 Gel', '40 Éclats', '50 Éclats', '60 Éclats', '5 Prismes']) expect(html).toContain(label);
    expect(html).toContain('Récupérée');
    expect(html.match(/data-action="loyalty-claim"/g)).toHaveLength(2); // jours 2 et 3
    expect(html).toContain('Verrouillé');
    expect(html).toContain('1 restante');
    expect(html).toContain('12 h 00');
    expect(html).toContain('loy-cell--prisms'); // jour 10 : animation spéciale
    expect(html).toContain('2 à récupérer'.replace('2 à récupérer', 'À récupérer'));
  });

  it('absence : aucune restante → avertissement ; cycle terminé → nouveau cycle au prochain jour UTC', () => {
    expect(RW.loyaltyScreen(view({ state: state({ absencesLeft: 0 }) }))).toContain('réinitialise le cycle');
    const done = RW.loyaltyScreen(view({ state: state({ absencesLeft: null }, 10) }));
    expect(done).toContain('prochain démarre au prochain jour UTC');
  });

  it('stock plein : bouton « Stock plein » inactif ; hors ligne : réclamation impossible, présence provisoire expliquée, aucune récompense créditée localement', () => {
    const full = RW.loyaltyScreen(view({ state: state({ stock: { boost: 99, gel: 0, max: 99 } }, 2) }));
    expect(full).toMatch(/data-action="loyalty-claim"[^>]*data-day="2"[^>]*disabled/);
    expect(full).toContain('Stock plein');
    const off = RW.loyaltyScreen(view({ online: false, provisional: true }));
    expect(off).toContain('Hors connexion');
    expect(off).toMatch(/data-action="loyalty-claim"[^>]*disabled/);
    const none = RW.loyaltyScreen(view({ state: null, online: false, provisional: true }));
    expect(none).toContain('provisoirement');
    expect(none).not.toContain('data-action="loyalty-claim"');
  });

  it('Prismes : profil sans pseudo → « Pseudo requis » (la récompense reste disponible) ; anciens cycles récupérables listés ; explosion de Prismes après le jour 10', () => {
    const guest = RW.loyaltyScreen(view({ state: state({ canClaimPrisms: false }, 10) }));
    expect(guest).toContain('Pseudo requis');
    expect(guest).toContain('se récupèrent avec un pseudo');
    const withOld = state({}, 1);
    withOld.cycles.push({ id: 3, current: false, absences: 1, complete: false, days: LOYALTY.days.map((reward, i) => ({ day: i + 1, reward, unlocked: i < 4, claimed: i === 0 })) });
    const old = RW.loyaltyScreen(view({ state: withOld }));
    expect(old).toContain('cycles précédents');
    expect(old).toContain('data-cycle="3"');
    expect(old).toContain('sans limite de temps');
    expect(RW.loyaltyScreen(view({ state: state({}, 10, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), justClaimed: ['7:10'] }))).toContain('loy-burst');
    expect(RW.loyaltyScreen(view())).not.toContain('loy-burst');
  });

  it('accueil : bouton « Récompenses » avec nombre à récupérer, seulement si le service est configuré', () => {
    const save = defaultSave();
    expect(S.homeScreen(save, '2026-10-15', false, false, undefined, true, { claimable: 2 })).toContain('data-action="loyalty"');
    expect(S.homeScreen(save, '2026-10-15', false, false, undefined, true, { claimable: 2 })).toContain('2 à récupérer');
    expect(S.homeScreen(save, '2026-10-15', false, false, undefined, true, { claimable: 0 })).toContain('Calendrier de connexion');
    expect(S.homeScreen(save, '2026-10-15', false, false, undefined, false, null)).not.toContain('data-action="loyalty"');
  });
});

describe('Calendrier : réflexion locale d’une récompense confirmée par le service', () => {
  const resp = (reward: LoyaltyClaimResponse['reward'], credited = true): LoyaltyClaimResponse => ({ cycle: 7, day: 1, reward, credited, balance: { shards: 20, medals: 0, prisms: 5 }, inventory: { boost: 1, gel: 0 }, state: state() });

  it('Éclats, Boost/Gel, Prismes (solde du service) ; requête rejouée = aucun ajout ; plafond de 99', () => {
    const s = defaultSave();
    s.economy.confirmed = { shards: 0, medals: 0, prisms: 0 };
    applyLoyaltyClaim(s, resp({ kind: 'shards', amount: 20 }));
    expect(s.wallet.shards).toBe(20);
    expect(s.economy.confirmed?.shards).toBe(20);
    applyLoyaltyClaim(s, resp({ kind: 'boost', amount: 1 }));
    expect(s.inventory.boost).toBe(1);
    applyLoyaltyClaim(s, resp({ kind: 'prisms', amount: 5 }));
    expect(s.wallet.prisms).toBe(5);
    applyLoyaltyClaim(s, resp({ kind: 'shards', amount: 20 }, false));
    expect(s.wallet.shards).toBe(20);
    s.inventory.gel = 99;
    applyLoyaltyClaim(s, resp({ kind: 'gel', amount: 1 }));
    expect(s.inventory.gel).toBe(99);
    expect(s.loyalty.snapshot?.today).toBe('2026-10-15');
  });
});

describe('Sauvegarde v10 : calendrier (affichage seulement)', () => {
  it('valeurs par défaut, instantané conservé et borné, données aberrantes écartées, récompenses toujours issues de la configuration', () => {
    const d = defaultSave();
    expect(d.loyalty).toEqual({ shownDay: '', localDay: '', snapshot: null });
    const s = defaultSave();
    s.loyalty = { shownDay: '2026-10-15', localDay: '2026-10-15', snapshot: state({}, 2, [1]) };
    const back = parseSave(JSON.stringify(s))!;
    expect(back.loyalty.shownDay).toBe('2026-10-15');
    expect(back.loyalty.snapshot?.cycles[0].days.filter((x) => x.claimed)).toHaveLength(1);
    // Un joueur ne peut pas modifier la récompense affichée (elle vient de la configuration)
    const hacked = JSON.parse(JSON.stringify(s));
    hacked.loyalty.snapshot.cycles[0].days[0].reward = { kind: 'prisms', amount: 9999 };
    expect(sanitize(hacked).loyalty.snapshot?.cycles[0].days[0].reward).toEqual({ kind: 'shards', amount: 20 });
    const bad = sanitize({ ...JSON.parse(JSON.stringify(s)), loyalty: { shownDay: 'hier', localDay: 5, snapshot: { today: 'x', cycles: 3 } } });
    expect(bad.loyalty).toEqual({ shownDay: '', localDay: '', snapshot: null });
  });
});

const board = (over: Partial<DailyBoard> = {}): DailyBoard => ({
  date: '2026-10-15',
  status: 'open',
  endsAt: NOW + 12 * 3600_000,
  finalAt: NOW + 12 * 3600_000 + 15 * 60_000,
  entries: [
    { rank: 1, nickname: 'Nova', time: 90, score: 4000, prisms: 15 },
    { rank: 1, nickname: 'Lea', time: 90, score: 4000, prisms: 15 },
    { rank: 3, nickname: 'Axel', time: 80, score: 3000, prisms: 5, you: true },
  ],
  total: 3,
  me: { rank: 3, time: 80, score: 3000, prisms: 5, eligible: true },
  ...over,
});
const dv = (b: DailyBoard | null, over: Partial<RW.DailyBoardView> = {}): RW.DailyBoardView => ({ board: b, loading: false, error: null, configured: true, pending: [], now: NOW, ...over });

describe('Défi quotidien : classement mondial (écran)', () => {
  it('top, ex æquo au même rang, récompenses, rang personnel, compte à rebours, statut', () => {
    const html = RW.dailyBoardHtml(dv(board()));
    expect(html).toContain('Classement mondial du jour');
    expect(html).toContain('En cours');
    expect(html).toContain('12 h 00');
    expect(html).toContain('lb-row--you');
    expect(html).toContain('ex æquo');
    expect(html).toContain('3 / 3');
    expect(html).toContain('Prismes (provisoire)');
    for (const t of ['1er', '2e', '3e']) expect(html).toContain(t);
    expect(html).not.toContain('4ᵉ à 7ᵉ');
    expect(html).toContain('8 Prismes par jour');
  });

  it('provisoire pendant la grâce de 15 min, définitif ensuite ; invité non éligible ; hors service : message honnête', () => {
    expect(RW.dailyBoardHtml(dv(board({ status: 'grace' })))).toContain('jusqu’à 00 h 15 UTC');
    const fin = RW.dailyBoardHtml(dv(board({ status: 'final' })));
    expect(fin).toContain('Définitif');
    expect(fin).toContain('Prismes gagnés');
    expect(RW.dailyBoardHtml(dv(board({ me: { rank: 9, time: 10, score: 1, prisms: 0, eligible: false } })))).toContain('choisissez un pseudo');
    expect(RW.dailyBoardHtml(dv(null, { configured: false }))).toContain('pas disponible dans cette version');
    expect(RW.dailyBoardHtml(dv(null, { error: 'Service injoignable' }))).toContain('Classement indisponible');
    expect(RW.dailyBoardHtml(dv(null, { loading: true }))).toContain('Chargement');
    expect(S.dailyScreen(defaultSave(), '2026-10-15', RW.dailyBoardHtml(dv(board())))).toContain('Classement mondial du jour');
  });
});

describe('Notifications de gains au lancement', () => {
  it('rang et Prismes du défi ; drop rare confirmé ; total', () => {
    const html = RW.noticesScreen([{ kind: 'daily', date: '2026-10-14', rank: 3, prisms: 5, time: 80, score: 3000 }, { kind: 'drop', prisms: 1 }]);
    expect(html).toContain('3ᵉ place');
    expect(html).toContain('+6 Prismes');
    expect(html).toContain('Prisme trouvé');
    expect(html).toContain('confirmé par le service');
    expect(html).toContain('data-action="notices-continue"');
    expect(RW.noticesScreen([{ kind: 'daily', date: '2026-10-14', rank: 1, prisms: 15, time: 1, score: 1 }])).toContain('1ère place');
  });
});

describe('Résultat : statuts du Défi quotidien et du drop', () => {
  it('tentative non démarrée en ligne : résultat local expliqué ; validée : rang provisoire/définitif ; drop confirmé', () => {
    expect(S.runLbStatusHtml({ kind: 'daily-local' })).toContain('non démarrée en ligne');
    expect(S.runLbStatusHtml({ kind: 'daily-accepted', rank: 2, eligible: true, late: false, state: 'open' })).toContain('provisoire jusqu’à 00 h 15 UTC');
    expect(S.runLbStatusHtml({ kind: 'daily-accepted', rank: 2, eligible: true, late: true, state: 'grace' })).toContain('envoi tardif accepté');
    expect(S.runLbStatusHtml({ kind: 'daily-accepted', rank: 2, eligible: false, late: false, state: 'open' })).toContain('choisissez un pseudo');
    const drop = S.runLbStatusHtml({ kind: 'accepted', rank: 5, best: true, category: 'plain', drop: 1 });
    expect(drop).toContain('Prisme trouvé');
    expect(drop).toContain('confirmé par le service');
    expect(S.runLbStatusHtml({ kind: 'accepted', rank: 5, best: true, category: 'plain' })).not.toContain('Prisme trouvé');
  });
});

describe('Client réseau : tentatives du Défi quotidien conservées jusqu’à validation', () => {
  function setup(responses: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const store = new MemoryStore();
    store.set('polarite.classement.identite', JSON.stringify({ playerId: 'p1', token: 't', nickname: 'Axel' }));
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      return responses(String(url), init);
    }) as typeof fetch;
    const client = new LeaderboardClient({ baseUrl: 'https://svc.example', store, fetchFn, balance: 3, build: 'test' });
    return { client, store, calls };
  }
  const att = { id: 'a'.repeat(32), date: '2026-10-15', startedAt: NOW };
  const ok = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

  it('hors ligne : tentative gardée en attente (ordre et contenu intacts) ; acceptée au renvoi ; un refus du service est définitif', async () => {
    let online = false;
    const { client, store } = setup(() => {
      if (!online) throw new Error('réseau');
      return ok({ status: 'accepted', date: att.date, time: 12.5, score: 700, rank: 4, personalBest: true, late: false, state: 'open', eligible: true });
    });
    const rec = client.recordDaily(att, [3, 9, 20], { time: 12.5, score: 700 });
    expect(rec?.submission).toMatchObject({ attemptId: att.id, date: att.date, replay: { v: 1, flips: [3, 9, 20] } });
    let list = await client.flushDaily();
    expect(list[0]).toMatchObject({ status: 'pending', lastError: 'Hors ligne' });
    expect(store.get(PENDING_DAILY_KEY)).not.toBeNull();
    online = true;
    list = await client.flushDaily();
    expect(list[0]).toMatchObject({ status: 'accepted', result: { rank: 4, eligible: true } });
    client.clearDailyDone();
    expect(client.pendingDaily()).toEqual([]);
    const refused = setup(() => ok({ status: 'rejected', reason: 'closed', message: 'Ce défi est clos' }, 422));
    refused.client.recordDaily(att, [1], { time: 1, score: 1 });
    expect((await refused.client.flushDaily())[0]).toMatchObject({ status: 'rejected', message: 'Ce défi est clos' });
  });

  it('aucun envoi sans profil ; démarrage en ligne du ticket (drop) : silencieux hors ligne ; routes de récompenses', async () => {
    const none = setup(() => ok({}));
    none.store.remove('polarite.classement.identite');
    expect(none.client.recordDaily(att, [], { time: 1, score: 1 })).toBeNull();
    expect(await none.client.startTicket('x')).toBe(false);
    const off = setup(() => {
      throw new Error('réseau');
    });
    expect(await off.client.startTicket('ticket-1')).toBe(false);
    const on = setup(() => ok({ started: true }));
    expect(await on.client.startTicket('ticket-1')).toBe(true);
    await on.client.loyaltyCheckin();
    await on.client.loyaltyClaim(7, 2);
    await on.client.dailyStart('2026-10-15');
    await on.client.dailyBoard('2026-10-15');
    await on.client.dailyNotices();
    await on.client.dailyAck(['2026-10-14']);
    expect(on.calls).toEqual([
      'POST https://svc.example/api/tickets/start',
      'POST https://svc.example/api/loyalty/checkin',
      'POST https://svc.example/api/loyalty/claim',
      'POST https://svc.example/api/daily/start',
      'GET https://svc.example/api/daily/leaderboard?date=2026-10-15',
      'GET https://svc.example/api/daily/notices',
      'POST https://svc.example/api/daily/ack',
    ]);
  });

  it('drop rare : l’animation n’est annoncée qu’une fois (vu / non vu)', async () => {
    const { client } = setup(() => ok({ status: 'accepted', time: 5, score: 100, rank: 1, personalBest: true, balance: 3, category: 'plain', drop: { prisms: 1 } }));
    client.recordRun({ id: 'tk', seed: 1, exp: 9e9, sig: 's' }, { flips: [1], acts: [] }, { time: 5, score: 100 });
    await client.flush();
    expect(client.unseenDrops().map((p) => p.id)).toEqual(['tk']);
    client.markDropSeen('tk');
    expect(client.unseenDrops()).toEqual([]);
  });
});
