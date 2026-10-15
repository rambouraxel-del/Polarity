import { describe, expect, it } from 'vitest';
import { UI } from '../src/config/balance';
import { POWER_CODES, REVIVE } from '../src/config/powers';
import { GameSession, type SessionHooks } from '../src/game/session';
import { InputController } from '../src/game/input';
import { makeSector } from '../src/sim/hazards';
import { applyRun } from '../src/progression/progress';
import { MemoryStore, defaultSave, parseSave, sanitize, SAVE_VERSION } from '../src/save/save';
import { LeaderboardClient } from '../src/net/leaderboard';
import { applySyncResult, buildSyncBody } from '../src/economy/reconcile';
import { powerView, POWER_KEYS } from '../src/ui/powers';
import * as S from '../src/ui/screens';

/** Partie de Survie avec stock ; `offer` : la reprise est proposable. */
function game(opts: { stock?: { boost: number; gel: number }; offer?: boolean } = {}) {
  const log: string[] = [];
  const hooks: SessionHooks = {
    onFirstDeath: (sum) => log.push(`first:${sum.category}:${sum.time.toFixed(3)}:${sum.score}`),
    onEnd: (sum) => log.push(`end:${sum.free ? `free:${sum.free.lives}` : 'none'}`),
    onOffer: (life) => log.push(`offer:${life}`),
    canOffer: opts.offer === false ? undefined : () => true,
  };
  const s = new GameSession({ mode: 'survival', seed: 4, stock: opts.stock ?? { boost: 2, gel: 2 } }, hooks);
  return { s, log };
}

/** Tue le vaisseau : un secteur qui le couvre immédiatement. */
function kill(s: GameSession): void {
  s.sim.hazards.push(makeSector('arc', 0, 0.05, 5, s.sim.angle, 0.4));
  for (let i = 0; i < 600 && s.sim.state === 'running'; i++) s.frame(1 / 60);
}

function toOffer(s: GameSession): void {
  for (let i = 0; i < 600 && s.phase !== 'offer' && s.phase !== 'over'; i++) s.frame(1 / 60);
}

describe('Session : première mort, reprises, survie libre', () => {
  it('première mort : résultat classé figé UNE fois, puis offre de reprise ; la partie n’est pas terminée', () => {
    const { s, log } = game();
    for (let i = 0; i < 120; i++) s.frame(1 / 60);
    kill(s);
    toOffer(s);
    expect(s.phase).toBe('offer');
    expect(log.filter((l) => l.startsWith('first')).length).toBe(1);
    expect(log).toContain('offer:2');
    expect(log.some((l) => l.startsWith('end'))).toBe(false);
    // Le temps n'avance pas pendant l'offre
    const t = s.sim.time;
    for (let i = 0; i < 300; i++) s.frame(1 / 60);
    expect(s.sim.time).toBe(t);
    expect(s.action()).toBe(false);
    expect(s.power('boost')).toBe(false);
  });

  it('reprise : compte à rebours, vie 2, 3 s d’invulnérabilité, dangers écartés ; le résultat classé ne change plus', () => {
    const { s, log } = game();
    for (let i = 0; i < 120; i++) s.frame(1 / 60);
    kill(s);
    toOffer(s);
    const frozen = s.summary();
    expect(s.revive()).toBe(true);
    expect(s.phase).toBe('countdown');
    expect(s.sim.life).toBe(2);
    expect(s.sim.hazards.length).toBe(0);
    for (let i = 0; i < 60 * (UI.resumeCountdown * UI.resumeStep + 1); i++) s.frame(1 / 60);
    expect(s.phase).toBe('running');
    expect(s.sim.reviveProtected).toBe(true);
    for (let i = 0; i < 600; i++) s.frame(1 / 60);
    // Le résumé reste celui de la première vie (jamais gonflé par la survie libre)
    const now = s.summary();
    expect(now.time).toBe(frozen.time);
    expect(now.score).toBe(frozen.score);
    expect(log.filter((l) => l.startsWith('first')).length).toBe(1);
  });

  it('au plus trois vies : offre pour la vie 3, puis fin définitive ; summary indique la survie libre', () => {
    const { s, log } = game();
    kill(s);
    toOffer(s);
    expect(s.revive()).toBe(true);
    s.sim.invincible = false;
    for (let i = 0; i < 60 * 6; i++) s.frame(1 / 60);
    kill(s);
    toOffer(s);
    expect(log).toContain('offer:3');
    expect(s.revive()).toBe(true);
    for (let i = 0; i < 60 * 6; i++) s.frame(1 / 60);
    kill(s);
    for (let i = 0; i < 600 && s.phase !== 'over'; i++) s.frame(1 / 60);
    expect(s.phase).toBe('over');
    expect(log.filter((l) => l.startsWith('end')).length).toBe(1);
    expect(log.at(-1)).toBe('end:free:3');
    expect(s.sim.canRevive).toBe(false);
  });

  it('reprise refusée (decline) : fin définitive, un seul onEnd ; sans offre (hors ligne/non configuré) : fin directe', () => {
    const a = game();
    kill(a.s);
    toOffer(a.s);
    a.s.decline();
    expect(a.s.phase).toBe('over');
    expect(a.log.filter((l) => l.startsWith('end')).length).toBe(1);
    const b = game({ offer: false });
    kill(b.s);
    for (let i = 0; i < 600 && b.s.phase !== 'over'; i++) b.s.frame(1 / 60);
    expect(b.s.phase).toBe('over');
    expect(b.log.some((l) => l.startsWith('offer'))).toBe(false);
    expect(b.log.filter((l) => l.startsWith('first')).length).toBe(1);
  });

  it('les parties hors Survie n’ont ni reprise ni pouvoirs', () => {
    const s = new GameSession({ mode: 'daily', seed: 0, date: '2026-10-01' }, { canOffer: () => true });
    expect(s.sim.powers.enabled).toBe(false);
    s.power('boost');
    s.frame(1 / 60);
    expect(s.sim.powers.log).toEqual([]);
  });

  it('catégorie du résumé : « avec bonus » dès la première activation réussie', () => {
    const { s, log } = game();
    s.power('boost');
    for (let i = 0; i < 60; i++) s.frame(1 / 60);
    expect(s.sim.powers.used.boost).toBe(1);
    kill(s);
    toOffer(s);
    expect(log.find((l) => l.startsWith('first'))).toMatch(/^first:bonus:/);
    const { s: p, log: pl } = game();
    kill(p);
    toOffer(p);
    expect(pl.find((l) => l.startsWith('first'))).toMatch(/^first:plain:/);
  });

  it('record local par catégorie ; la survie libre n’est jamais un record', () => {
    const save = defaultSave();
    applyRun(save, { mode: 'survival', time: 60, score: 500, cycles: 1, bestMultiplier: 1, outcome: 'dead', category: 'plain' });
    applyRun(save, { mode: 'survival', time: 90, score: 800, cycles: 1, bestMultiplier: 1, outcome: 'dead', category: 'bonus' });
    expect(save.survival.bestTime).toBe(60);
    expect(save.survivalBonus.bestTime).toBe(90);
    expect(save.survival.runs).toBe(1);
    expect(save.survivalBonus.runs).toBe(1);
  });
});

describe('Commandes des pouvoirs : états affichés', () => {
  it('Boost : disponible (restantes) → actif (durée) → recharge → plafond ; Gel exclu pendant le Boost', () => {
    const { s } = game({ stock: { boost: 3, gel: 1 } });
    const v0 = powerView(s, 'boost');
    expect(v0.state).toBe('ready');
    expect(v0.meta).toBe('reste 3');
    s.power('boost');
    for (let i = 0; i < 30; i++) s.frame(1 / 60);
    expect(powerView(s, 'boost').state).toBe('active');
    expect(powerView(s, 'boost').meta).toMatch(/s$/);
    expect(powerView(s, 'gel').state).toBe('blocked');
    expect(powerView(s, 'gel').meta).toBe('Indisponible');
    for (let i = 0; i < 60 * 6; i++) s.frame(1 / 60);
    expect(powerView(s, 'boost').state).toBe('cooldown');
    expect(powerView(s, 'boost').meta).toMatch(/^Recharge \d+ s$/);
  });

  it('stock vide et Bouclier : jauge 0/18, aucun achat nécessaire', () => {
    const { s } = game({ stock: { boost: 0, gel: 0 } });
    expect(powerView(s, 'boost').state).toBe('empty');
    expect(powerView(s, 'boost').meta).toBe('Stock vide');
    expect(powerView(s, 'gel').ready).toBe(false);
    const sh = powerView(s, 'shield');
    expect(sh.state).toBe('charging');
    expect(sh.meta).toBe('0/18');
    s.power('boost'); // refusée : aucune charge, aucune entrée au journal
    for (let i = 0; i < 10; i++) s.frame(1 / 60);
    expect(s.sim.powers.log).toEqual([]);
  });

  it('après reprise : Boost et Gel gratuits', () => {
    const { s } = game({ stock: { boost: 0, gel: 0 } });
    kill(s);
    toOffer(s);
    s.revive();
    expect(powerView(s, 'boost').meta).toBe('gratuit');
    expect(powerView(s, 'boost').ready).toBe(true);
  });

  it('raccourcis : B, G, S ; jamais Espace, Échap ni P', () => {
    expect(Object.keys(POWER_KEYS).sort()).toEqual(['b', 'g', 's']);
    expect(Object.keys(POWER_KEYS)).not.toContain(' ');
    expect(Object.keys(POWER_KEYS)).not.toContain('p');
  });
});

describe('Entrées : les pouvoirs ne déclenchent jamais d’inversion', () => {
  function setup() {
    const win: Record<string, ((e: unknown) => void)[]> = {};
    const el: Record<string, ((e: unknown) => void)[]> = {};
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { addEventListener: (t: string, f: (e: unknown) => void) => (win[t] ??= []).push(f) };
    const calls: string[] = [];
    const gameEl = { addEventListener: (t: string, f: (e: unknown) => void) => (el[t] ??= []).push(f) } as unknown as HTMLElement;
    new InputController(gameEl, {
      action: () => calls.push('flip'),
      pauseKey: () => calls.push('pause'),
      inGame: () => true,
      firstInteraction: () => undefined,
      power: (k) => calls.push(`power:${k}`),
    }).attach();
    const key = (code: string, k: string, extra: Record<string, unknown> = {}) => {
      for (const f of win.keydown ?? []) f({ code, key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'DIV' }, preventDefault: () => undefined, ...extra });
    };
    return { calls, key, restore: () => (g.window = prev) };
  }

  it('B/G/S activent un pouvoir, Espace inverse, P met en pause ; Ctrl+B et la répétition sont ignorés', () => {
    const t = setup();
    t.key('KeyB', 'b');
    t.key('KeyG', 'G');
    t.key('KeyS', 's');
    t.key('Space', ' ');
    t.key('KeyP', 'p');
    t.key('Escape', 'Escape');
    t.key('KeyB', 'b', { ctrlKey: true });
    t.key('KeyB', 'b', { repeat: true });
    expect(t.calls).toEqual(['power:b', 'power:g', 'power:s', 'flip', 'pause', 'pause']);
    t.restore();
  });
});

describe('Écran de reprise : honnêteté sur la publicité et les Prismes', () => {
  const view = (over: Partial<S.ReviveView> = {}): S.ReviveView => ({
    life: 2,
    time: 75,
    score: 1234,
    category: 'plain',
    ad: { offered: true, available: false },
    prisms: { price: REVIVE.prisms[2], balance: 12, blocked: null },
    busy: false,
    message: null,
    lb: { kind: 'hidden' },
    ...over,
  });

  it('deuxième chance : publicité désactivée sans fournisseur, 5 Prismes, résultat classé déjà enregistré', () => {
    const html = S.reviveScreen(view());
    expect(html).toContain('Deuxième chance');
    expect(html).toMatch(/data-action="revive-ad"[^>]*disabled/);
    expect(html).toContain('Indisponible dans cette version');
    expect(html).toContain('Reprendre — 5 Prismes');
    expect(html).toContain('classement Sans bonus');
    expect(html).toContain('survie libre');
    expect(html).toContain('data-action="revive-decline"');
  });

  it('troisième chance : 10 Prismes, aucune publicité ; paiement bloqué hors ligne ; paiement en cours = boutons neutralisés', () => {
    const html = S.reviveScreen(view({ life: 3, ad: { offered: false, available: false }, prisms: { price: REVIVE.prisms[3], balance: 12, blocked: 'Hors connexion : paiement impossible' } }));
    expect(html).toContain('Troisième chance');
    expect(html).not.toContain('revive-ad');
    expect(html).toContain('Reprendre — 10 Prismes');
    expect(html).toMatch(/data-action="revive-prisms"[^>]*disabled/);
    expect(html).toContain('Hors connexion');
    const busy = S.reviveScreen(view({ busy: true }));
    expect(busy).toContain('Aucune reprise n’est accordée tant qu’il n’est pas confirmé');
    expect(busy).toMatch(/data-action="revive-decline"[^>]*disabled/);
  });

  it('prix : exactement 5 puis 10 Prismes, pas de quatrième vie, publicité seulement pour la vie 2', () => {
    expect(REVIVE.prisms).toEqual({ 2: 5, 3: 10 });
    expect(REVIVE.maxLives).toBe(3);
    expect(REVIVE.adLives).toEqual([2]);
  });
});

describe('Sauvegarde v9 : record « avec bonus » et compteurs d’usage', () => {
  it('nouveau format, valeurs par défaut, sanitize, migration depuis la v8 sans perte', () => {
    expect(SAVE_VERSION).toBe(9);
    const d = defaultSave();
    expect(d.survivalBonus).toEqual({ bestTime: 0, bestScore: 0, runs: 0 });
    expect(d.economy.bonusUsed).toEqual({ boost: 0, gel: 0 });
    const v8 = { ...JSON.parse(JSON.stringify(d)), version: 8 } as Record<string, unknown>;
    delete v8.survivalBonus;
    (v8.survival as { bestTime: number }).bestTime = 77;
    const back = parseSave(JSON.stringify(v8));
    expect(back?.survival.bestTime).toBe(77);
    expect(back?.survivalBonus.bestTime).toBe(0);
    expect(back?.version).toBe(9);
    // Valeurs aberrantes ramenées à la raison ; une partie « en cours » à la fermeture est tranchée (liveUse remis à zéro)
    const bad = sanitize({ ...d, survivalBonus: { bestTime: -5, bestScore: 'x', runs: 2.5 }, economy: { ...d.economy, bonusUsed: { boost: -3, gel: 4 }, liveUse: { boost: 2, gel: 2 } } });
    expect(bad.survivalBonus.bestTime).toBe(0);
    expect(bad.economy.bonusUsed).toEqual({ boost: 0, gel: 4 });
    expect(bad.economy.liveUse).toEqual({ boost: 0, gel: 0 });
  });
});

describe('Synchronisation des charges consommées', () => {
  const resp = (inventory: { boost: number; gel: number }) => ({
    rev: 1,
    balance: { shards: 0, medals: 0, prisms: 0 },
    inventory,
    bonus: { boost: 0, gel: 0 },
    bonusRejected: { boost: 0, gel: 0 },
    claimed: [],
    rejectedClaims: [],
    watermark: 0,
    capped: false,
    acknowledged: [],
    rejected: [],
    save: defaultSave(),
    legacy: null,
  });

  it('usage déclaré = compteur sans la partie en cours (jamais envoyé deux fois avec le ticket)', () => {
    const s = defaultSave();
    s.economy.bonusUsed = { boost: 3, gel: 1 };
    s.economy.liveUse = { boost: 1, gel: 0 };
    expect(buildSyncBody(s).bonusUsed).toEqual({ boost: 2, gel: 1 });
  });

  it('charges d’une partie classée en attente : déduites de l’inventaire du service tant qu’elle n’est pas validée', () => {
    const local = defaultSave();
    local.inventory = { boost: 2, gel: 2 };
    const sent = structuredClone(local);
    // Le service n'a pas encore consommé les 1 Boost + 1 Gel de la partie en attente : il répond 3 / 3
    applySyncResult(local, resp({ boost: 3, gel: 3 }) as never, sent, { pendingUse: { boost: 1, gel: 1 } });
    expect(local.inventory).toEqual({ boost: 2, gel: 2 });
    // Partie validée (plus en attente) : l'inventaire du service fait foi
    applySyncResult(local, resp({ boost: 2, gel: 2 }) as never, structuredClone(local), { pendingUse: { boost: 0, gel: 0 } });
    expect(local.inventory).toEqual({ boost: 2, gel: 2 });
    // Partie refusée par le service (jamais consommée) : les charges reviennent
    applySyncResult(local, resp({ boost: 3, gel: 3 }) as never, structuredClone(local), { pendingUse: { boost: 0, gel: 0 } });
    expect(local.inventory).toEqual({ boost: 3, gel: 3 });
  });

  it('file « en attente » : charges consommées conservées ; 409 « synchroniser d’abord » laisse la partie en attente (ticket conservé)', async () => {
    const store = new MemoryStore();
    store.set('polarite.classement.identite', JSON.stringify({ playerId: 'p1', token: 't', nickname: 'Axel' }));
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: 'x', reason: 'bonus_sync_required', message: 'Synchronisez vos achats.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const client = new LeaderboardClient({ baseUrl: 'https://svc.example/', store, fetchFn, balance: 3, build: 'test', clientInfo: () => ({ installId: 'inst-0001', bonusBought: { boost: 5, gel: 0 } }) });
    const run = client.recordRun({ id: 'tk1', seed: 1, exp: 9e9, sig: 's' }, { flips: [3, 9], acts: [[10, POWER_CODES.boost]] }, { time: 5, score: 10 }, { boost: 1, gel: 0 });
    expect(run?.submission.replay).toEqual({ v: 2, flips: [3, 9], acts: [[10, 0]] });
    expect(run?.submission.client).toMatchObject({ installId: 'inst-0001', bonusBought: { boost: 5, gel: 0 } });
    expect(client.pendingBonusUse()).toEqual({ boost: 1, gel: 0 });
    const list = await client.flush();
    expect(calls).toBe(1);
    expect(list[0]).toMatchObject({ status: 'pending', needsSync: true });
    expect(client.pendingBonusUse()).toEqual({ boost: 1, gel: 0 });
  });
});
