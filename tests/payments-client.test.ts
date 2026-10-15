import { afterEach, describe, expect, it } from 'vitest';
import { PRISM_PACKS } from '../src/config/monetization';
import { REVIVE } from '../src/config/powers';
import { reviveWithAd } from '../src/monetization/adReward';
import { NativeAdProvider, NoAdProvider, getAdProvider, setAdProvider, type AdsPlugin, type RewardedAdProvider } from '../src/monetization/ads';
import { NativePaymentProvider, NullPaymentProvider, getPaymentProvider, premiumAvailable, setPaymentProvider, type BillingPlugin, type PaymentProvider, type StoreReceipt } from '../src/monetization/payments';
import { StoreService, type StoreConfig, type StoreHost } from '../src/monetization/store';
import type { NetResult } from '../src/net/leaderboard';
import { nativePlugin } from '../src/platform/plugins';
import { defaultSave, type SaveData } from '../src/save/save';
import * as S from '../src/ui/screens';
import * as ST from '../src/ui/storeScreens';

/**
 * Tests du CÔTÉ JEU avec des plugins et un service SIMULÉS : ils vérifient l'enchaînement (aucun succès avant la confirmation du service, aucune reprise sans
 * confirmation, aucun crédit local). Ils ne prouvent pas qu'un paiement ou une publicité réels fonctionnent (voir docs/MONETISATION.md).
 */
afterEach(() => {
  setPaymentProvider(new NullPaymentProvider());
  setAdProvider(new NoAdProvider());
});

const ok = <T,>(data: T): NetResult<T> => ({ ok: true, data });
const http = (status: number, message = 'refus', reason?: string): NetResult<never> => ({ ok: false, kind: 'http', status, message, reason } as NetResult<never>);
const offline: NetResult<never> = { ok: false, kind: 'offline', status: 0, message: 'hors ligne' };

const CONFIG: StoreConfig = {
  packs: PRISM_PACKS.map((p) => ({ id: p.id, name: p.name, prisms: p.prisms, priceCents: p.priceCents, productId: p.productId })),
  providers: { apple: true, google: true, web: false },
  ads: { enabled: true },
};

class FakeBilling implements BillingPlugin {
  available = true;
  next: { status: 'purchased' | 'pending' | 'cancelled' | 'failed'; transactionId?: string; purchaseToken?: string; message?: string } = { status: 'purchased', transactionId: '555', purchaseToken: 'tok-12345678901' };
  pending: { productId: string; transactionId?: string; purchaseToken?: string }[] = [];
  finished: { transactionId?: string; purchaseToken?: string }[] = [];
  purchases: { productId: string; accountToken: string }[] = [];
  async isAvailable() {
    return { available: this.available };
  }
  async purchase(o: { productId: string; accountToken: string }) {
    this.purchases.push(o);
    return this.next;
  }
  async pendingPurchases() {
    return { items: this.pending };
  }
  async finish(o: { transactionId?: string; purchaseToken?: string }) {
    this.finished.push(o);
  }
}

async function native(platform: 'ios' | 'android', plugin = new FakeBilling()): Promise<{ plugin: FakeBilling; provider: NativePaymentProvider }> {
  const provider = new NativePaymentProvider(plugin, platform);
  await provider.init();
  setPaymentProvider(provider);
  return { plugin, provider };
}

interface HostOpts {
  configured?: boolean;
  identity?: boolean;
  account?: boolean | null;
  api?: (method: string, path: string, body?: unknown) => NetResult<unknown>;
}
function host(o: HostOpts = {}): { host: StoreHost; save: SaveData; calls: string[] } {
  const save = defaultSave();
  save.economy.confirmed = { shards: 0, medals: 0, prisms: 0 };
  const calls: string[] = [];
  return {
    save,
    calls,
    host: {
      configured: o.configured ?? true,
      api: (async (method: string, path: string, opts?: { body?: unknown }) => {
        calls.push(`${method} ${path}`);
        return o.api ? o.api(method, path, opts?.body) : ok({});
      }) as StoreHost['api'],
      hasIdentity: () => o.identity ?? true,
      isAccount: () => (o.account === undefined ? true : o.account),
      commit: (m) => m(save),
    },
  };
}

const prepare = ok({ apple: { appAccountToken: 'APPLE-UUID' }, google: { obfuscatedAccountId: 'GOOGLE-ID' } });
const credited = (prisms: number, total: number, status: 'credited' | 'already_credited' | 'pending' | 'refunded' | 'cancelled' = 'credited'): NetResult<unknown> =>
  ok({ status, provider: 'apple', productId: 'x', prisms, balance: { shards: 0, medals: 0, prisms: total } });

describe('Plugins natifs : absents sur le web', () => {
  it('sans enveloppe native ou sans le plugin : aucun fournisseur actif, rien n’est simulé', async () => {
    expect(nativePlugin('PolarRiftBilling', {})).toBeNull();
    expect(nativePlugin('PolarRiftBilling', { Capacitor: { isNativePlatform: () => false, Plugins: { PolarRiftBilling: {} } } })).toBeNull();
    expect(nativePlugin('PolarRiftBilling', { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false, Plugins: {} } })).toBeNull();
    const plugin = { x: 1 };
    expect(nativePlugin('PolarRiftBilling', { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: { PolarRiftBilling: plugin } } })).toBe(plugin);
    expect(getPaymentProvider()).toBeInstanceOf(NullPaymentProvider);
    expect(premiumAvailable()).toBe(false);
    expect(getAdProvider()).toBeInstanceOf(NoAdProvider);
    expect(getAdProvider().isAvailable()).toBe(false);
    expect(await getAdProvider().showRewarded('revive')).toBe('unavailable');
  });
});

describe('Fournisseur de paiement natif (plugin simulé)', () => {
  it('indisponible tant que le plugin n’a pas confirmé ; disponible ensuite ; justificatifs Apple / Google distincts', async () => {
    const plugin = new FakeBilling();
    plugin.available = false;
    const p = new NativePaymentProvider(plugin, 'ios');
    expect(p.isAvailable()).toBe(false);
    expect((await p.buy('polar_rift_prisms_30', 'T')).status).toBe('failed');
    expect(plugin.purchases).toEqual([]);
    await p.init();
    expect(p.isAvailable()).toBe(false);
    plugin.available = true;
    await p.init();
    expect(p.isAvailable()).toBe(true);
    expect(await p.buy('polar_rift_prisms_30', 'JETON')).toEqual({ status: 'purchased', receipt: { provider: 'apple', productId: 'polar_rift_prisms_30', transactionId: '555' } });
    expect(plugin.purchases).toEqual([{ productId: 'polar_rift_prisms_30', accountToken: 'JETON' }]);
    const g = await native('android');
    expect(await g.provider.buy('polar_rift_prisms_100', 'J')).toEqual({ status: 'purchased', receipt: { provider: 'google', productId: 'polar_rift_prisms_100', purchaseToken: 'tok-12345678901' } });
    expect(premiumAvailable()).toBe(true);
  });

  it('annulé, échoué, en attente, plugin qui plante, justificatif manquant : jamais « purchased »', async () => {
    const { plugin, provider } = await native('ios');
    plugin.next = { status: 'cancelled' };
    expect(await provider.buy('p', 't')).toEqual({ status: 'cancelled' });
    plugin.next = { status: 'failed', message: 'carte refusée' };
    expect(await provider.buy('p', 't')).toEqual({ status: 'failed', message: 'carte refusée' });
    plugin.next = { status: 'pending', transactionId: '9' };
    expect(await provider.buy('p', 't')).toMatchObject({ status: 'pending' });
    plugin.next = { status: 'purchased' };
    expect((await provider.buy('p', 't')).status).toBe('failed');
    plugin.purchase = async () => {
      throw new Error('boum');
    };
    expect(await provider.buy('p', 't')).toEqual({ status: 'failed', message: 'boum' });
  });
});

describe('Disponibilité des achats (explications honnêtes)', () => {
  it('service absent, configuration non chargée, plateforme sans boutique, fournisseur non activé sur le service, compte requis, possible', async () => {
    const h = host({ configured: false });
    expect(new StoreService(h.host).availability()).toMatchObject({ canBuy: false, mode: 'none' });
    expect(new StoreService(h.host).availability().reason).toContain('désactivés');
    const s1 = new StoreService(host().host);
    expect(s1.availability().reason).toContain('Vérification');
    s1.config = CONFIG;
    expect(s1.availability()).toMatchObject({ canBuy: false, mode: 'none' });
    expect(s1.availability().reason).toContain('pas disponibles sur cette plateforme');
    await native('android');
    s1.config = { ...CONFIG, providers: { apple: true, google: false, web: false } };
    expect(s1.availability().reason).toContain('pas encore activé');
    s1.config = CONFIG;
    expect(s1.availability()).toEqual({ mode: 'native', canBuy: true, reason: null });
    const guestStore = new StoreService(host({ account: false }).host);
    guestStore.config = CONFIG;
    expect(guestStore.availability()).toMatchObject({ canBuy: false, fix: 'account' });
    expect(guestStore.availability().reason).toContain('compte connecté');
    expect(guestStore.availability().reason).toContain('gratuit');
  });
});

describe('Achat : aucun succès avant la confirmation du service', () => {
  it('chaque pack : justificatif envoyé au service (pas de montant), succès et solde SEULEMENT après « crédité », transaction terminée ensuite', async () => {
    const { plugin } = await native('ios');
    for (const pack of PRISM_PACKS) {
      const h = host({
        api: (_m, path) => (path === '/api/payments/prepare' ? prepare : credited(pack.prisms, 123)),
      });
      const seen: string[] = [];
      const store = new StoreService(h.host, () => seen.push(store.state.status));
      store.config = CONFIG;
      const out = await store.buy(pack.id);
      expect(out).toMatchObject({ status: 'success', packId: pack.id });
      expect(out.message).toContain(`${pack.prisms} Prismes crédités, confirmés par le service`);
      // Ordre : préparation → boutique → vérification → succès (jamais de succès avant la réponse du service)
      expect(seen).toEqual(['preparing', 'purchasing', 'verifying', 'success']);
      expect(h.calls).toEqual(['GET /api/payments/prepare', 'POST /api/payments/verify']);
      expect(h.save.wallet.prisms).toBe(123);
      expect(h.save.economy.confirmed?.prisms).toBe(123);
      expect(plugin.finished.at(-1)).toEqual({ transactionId: '555', purchaseToken: undefined });
      expect(plugin.purchases.at(-1)).toEqual({ productId: pack.productId, accountToken: 'APPLE-UUID' });
    }
  });

  it('le corps envoyé au service ne contient ni montant, ni prix, ni quantité de Prismes', async () => {
    await native('android');
    let body: Record<string, unknown> = {};
    const h = host({ api: (_m, path, b) => (path === '/api/payments/prepare' ? prepare : ((body = b as Record<string, unknown>), credited(30, 30))) });
    const store = new StoreService(h.host);
    store.config = CONFIG;
    await store.buy('decouverte');
    expect(body).toEqual({ provider: 'google', productId: 'polar_rift_prisms_30', transactionId: undefined, purchaseToken: 'tok-12345678901' });
    expect(Object.keys(body).join(',')).not.toMatch(/prisms|price|amount|balance|quantity/i);
  });

  it('coupure avant la confirmation : message d’attente (jamais de succès), transaction NON terminée, rien de crédité localement ; restauration ensuite', async () => {
    const { plugin } = await native('ios');
    let reachable = false;
    const h = host({ api: (_m, path) => (path === '/api/payments/prepare' ? prepare : reachable ? credited(100, 100) : (offline as NetResult<unknown>)) });
    const store = new StoreService(h.host);
    store.config = CONFIG;
    const out = await store.buy('intermediaire');
    expect(out.status).toBe('error');
    expect(out.message).toContain('pas encore confirmé');
    expect(h.save.wallet.prisms).toBe(0);
    expect(plugin.finished).toEqual([]);
    // Retour de la connexion : la transaction non terminée est retrouvée et revérifiée
    plugin.pending = [{ productId: 'polar_rift_prisms_100', transactionId: '555' }];
    reachable = true;
    const h2 = host({ api: (_m, path) => (path === '/api/payments/restore' ? ok({ results: [{ status: 'credited', prisms: 100 }], balance: { shards: 0, medals: 0, prisms: 100 } }) : ok({})) });
    const store2 = new StoreService(h2.host);
    store2.config = CONFIG;
    const r = await store2.restore();
    expect(r).toMatchObject({ status: 'restored' });
    expect(r.message).toContain('100 Prismes restaurés');
    expect(h2.save.wallet.prisms).toBe(100);
    expect(plugin.finished).toEqual([{ transactionId: '555', purchaseToken: undefined }]);
  });

  it('annulé, échoué, en attente, refusé par le service (compte requis, justificatif utilisé, remboursé) : aucun Prisme, aucun succès', async () => {
    const { plugin } = await native('android');
    const run = async (next: (typeof plugin)['next'], verify: NetResult<unknown> | null = null): Promise<{ state: Awaited<ReturnType<StoreService['buy']>>; prisms: number; finished: number }> => {
      plugin.next = next;
      plugin.finished = [];
      const h = host({ api: (_m, path) => (path === '/api/payments/prepare' ? prepare : (verify ?? ok({}))) });
      const store = new StoreService(h.host);
      store.config = CONFIG;
      return { state: await store.buy('grand'), prisms: h.save.wallet.prisms, finished: plugin.finished.length };
    };
    expect((await run({ status: 'cancelled' })).state).toMatchObject({ status: 'cancelled' });
    expect((await run({ status: 'failed', message: 'x' })).state).toMatchObject({ status: 'error', message: 'x' });
    expect((await run({ status: 'pending' })).state.status).toBe('pending');
    const pend = await run({ status: 'pending', purchaseToken: 'tok-pending-123456' }, credited(0, 0, 'pending'));
    expect(pend.state.status).toBe('pending');
    expect(pend.prisms).toBe(0);
    const used = await run({ status: 'purchased', purchaseToken: 'tok-used-1234567' }, http(409, 'Ce justificatif a déjà été utilisé par un autre profil.'));
    expect(used.state).toMatchObject({ status: 'error', message: 'Ce justificatif a déjà été utilisé par un autre profil.' });
    expect(used.finished).toBe(0);
    const refunded = await run({ status: 'purchased', purchaseToken: 'tok-ref-12345678' }, credited(0, 0, 'refunded'));
    expect(refunded.state.status).toBe('error');
    expect(refunded.prisms).toBe(0);
    const again = await run({ status: 'purchased', purchaseToken: 'tok-again-1234567' }, credited(0, 50, 'already_credited'));
    expect(again.state).toMatchObject({ status: 'success' });
    expect(again.state.message).toContain('déjà crédité');
  });

  it('sans compte ou sans disponibilité : aucune requête, aucune boutique ouverte ; achat simultané refusé', async () => {
    const { plugin } = await native('ios');
    const h = host({ account: false });
    const store = new StoreService(h.host);
    store.config = CONFIG;
    expect((await store.buy('decouverte')).status).toBe('idle');
    expect(h.calls).toEqual([]);
    expect(plugin.purchases).toEqual([]);
    const h2 = host({ api: (_m, path) => (path === '/api/payments/prepare' ? prepare : credited(30, 30)) });
    const s2 = new StoreService(h2.host);
    s2.config = CONFIG;
    await Promise.all([s2.buy('decouverte'), s2.buy('decouverte')]);
    expect(plugin.purchases).toHaveLength(1);
    expect((await s2.buy('inconnu')).packId).toBe('decouverte');
  });

  it('web : redirection vers la page du prestataire seulement s’il est configuré côté service ; sinon indisponible', async () => {
    const assigned: string[] = [];
    (globalThis as { location?: unknown }).location = { assign: (u: string) => assigned.push(u) };
    try {
      const h = host({ api: () => ok({ url: 'https://pay.example/c?x=1' }) });
      const store = new StoreService(h.host);
      store.config = { ...CONFIG, providers: { apple: false, google: false, web: true } };
      expect(store.availability()).toMatchObject({ mode: 'web', canBuy: true });
      await store.buy('grand');
      expect(assigned).toEqual(['https://pay.example/c?x=1']);
      expect(h.save.wallet.prisms).toBe(0); // rien de crédité avant la confirmation du prestataire au service
      store.config = { ...CONFIG, providers: { apple: false, google: false, web: false } };
      expect(store.availability().canBuy).toBe(false);
    } finally {
      delete (globalThis as { location?: unknown }).location;
    }
  });

  it('restauration : aucun achat → message ; silencieuse au démarrage ; sans compte → rien ; transactions annulées terminées sans crédit', async () => {
    const { plugin } = await native('ios');
    const h = host({ api: () => ok({ results: [], balance: { shards: 0, medals: 0, prisms: 0 } }) });
    const store = new StoreService(h.host);
    store.config = CONFIG;
    expect((await store.restore()).message).toContain('Aucun achat à restaurer');
    const silent = new StoreService(host().host);
    expect((await silent.restore(true)).status).toBe('idle');
    plugin.pending = [{ productId: 'polar_rift_prisms_30', transactionId: '1' }, { productId: 'polar_rift_prisms_30', transactionId: '2' }];
    const h2 = host({ api: () => ok({ results: [{ status: 'cancelled', prisms: 0 }, { error: 'unverified' }], balance: { shards: 0, medals: 0, prisms: 7 } }) });
    const s2 = new StoreService(h2.host);
    expect((await s2.restore()).message).toContain('déjà à jour');
    expect(plugin.finished).toEqual([{ transactionId: '1', purchaseToken: undefined }]); // l'inconnue reste en attente d'une revérification
    const none = host({ account: false });
    const s3 = new StoreService(none.host);
    await s3.restore();
    expect(none.calls).toEqual([]);
  });
});

describe('Boutique : écran des packs de Prismes', () => {
  const view = (over: Partial<ST.StoreView> = {}): ST.StoreView => ({ availability: { mode: 'native', canBuy: true, reason: null }, state: { status: 'idle' }, confirmedPrisms: 12, canRestore: true, storeName: ST.STORE_NAMES.apple, ...over });

  it('trois packs avec quantités et prix, solde confirmé, restauration, confidentialité, aucune obligation', () => {
    const html = ST.prismShopHtml(view());
    for (const t of ['30', '100', '380', '0,99 €', '2,99 €', '9,99 €', 'Découverte', 'Intermédiaire', 'Grand']) expect(html).toContain(t);
    expect(html.match(/data-action="prisms-buy"/g)).toHaveLength(3);
    expect(html).not.toMatch(/data-action="prisms-buy"[^>]*disabled/);
    expect(html).toContain('Solde confirmé : <strong>12</strong>');
    expect(html).toContain('prisms-restore');
    expect(html).toContain('identiques');
    expect(html).toContain('facultatifs');
    expect(html).toContain('aucune publicité n’est imposée');
    expect(html).toContain('Confidentialité, achats et publicités');
    expect(html).toContain('consentement');
    expect(html).toContain('App Store');
  });

  it('indisponible : boutons inactifs et raison expliquée ; compte requis → lien vers Compte ; achat en cours → tout neutralisé', () => {
    const none = ST.prismShopHtml(view({ availability: { mode: 'none', canBuy: false, reason: 'Les achats ne sont pas disponibles sur cette plateforme dans cette version.' }, canRestore: false }));
    expect(none.match(/data-action="prisms-buy"[^>]*disabled/g)).toHaveLength(3);
    expect(none).toContain('pas disponibles sur cette plateforme');
    expect(none).not.toContain('prisms-restore');
    const acct = ST.prismShopHtml(view({ availability: { mode: 'native', canBuy: false, reason: 'compte', fix: 'account' } }));
    expect(acct).toContain('prisms-account');
    const busy = ST.prismShopHtml(view({ state: { status: 'verifying' } }));
    expect(busy.match(/data-action="prisms-buy"[^>]*disabled/g)).toHaveLength(3);
    expect(busy).toContain('Confirmation par le service');
  });

  it('états : réussite SEULEMENT avec le statut « success » ; attente, annulation, erreur, restauration distinctes', () => {
    const text = (state: ST.StoreView['state']): string => ST.purchaseStatusHtml(state);
    expect(text({ status: 'idle' })).toBe('');
    expect(text({ status: 'purchasing' })).not.toContain('Achat confirmé');
    expect(text({ status: 'verifying' })).not.toContain('Achat confirmé');
    expect(text({ status: 'pending', message: 'x' })).toContain('Paiement en attente');
    expect(text({ status: 'success', message: '30 Prismes crédités' })).toContain('Achat confirmé');
    expect(text({ status: 'cancelled' })).toContain('Achat annulé');
    expect(text({ status: 'error', message: 'zut' })).toContain('role="alert"');
    expect(text({ status: 'restored', message: 'ok' })).toContain('Restauration terminée');
  });

  it('confirmation avant paiement : pack, quantité, prix indicatif, plateforme ; boutique : onglet Prismes ; options : confidentialité', () => {
    const c = ST.confirmPrismsScreen('intermediaire', 'Google Play');
    expect(c).toContain('Intermédiaire');
    expect(c).toContain('100');
    expect(c).toContain('2,99 €');
    expect(c).toContain('Google Play');
    expect(c).toContain('après confirmation du paiement par le service');
    expect(c).toContain('prisms-cancel');
    expect(ST.confirmPrismsScreen('nimporte', 'x')).toContain('Pack inconnu');
    const save = defaultSave();
    const shop = S.cosmeticsScreen(save, 'prisms', 'all', undefined, null, view());
    expect(shop).toContain('cat-prisms');
    expect(shop).toContain('Acheter des Prismes');
    expect(S.COSMETIC_TABS.map((t) => t.id)).toEqual(['ships', 'trails', 'packs', 'bonus', 'prisms']);
    expect(S.optionsScreen(save, true)).toContain('Achats, publicités et confidentialité');
    expect(S.optionsScreen(save, false)).not.toContain('Achats, publicités');
  });
});

describe('Reprise : confirmation avant dépense de Prismes, option publicité', () => {
  const base: S.ReviveView = { life: 2, time: 75, score: 1234, category: 'plain', ad: { offered: true, available: false }, prisms: { price: REVIVE.prisms[2], balance: 12, blocked: null }, busy: false, message: null, lb: { kind: 'hidden' } };

  it('confirmation : montant, solde avant → après, débit par le service ; confirmer / retour', () => {
    const c = S.reviveScreen({ ...base, confirm: true });
    expect(c).toContain('Confirmer la dépense');
    expect(c).toContain('5 Prismes');
    expect(c).toContain('12 → 7');
    expect(c).toContain('revive-prisms-confirm');
    expect(c).toContain('revive-prisms-back');
    expect(c).toContain('débités par le service');
    const third = S.reviveScreen({ ...base, life: 3, ad: { offered: false, available: false }, prisms: { price: 10, balance: 12, blocked: null }, confirm: true });
    expect(third).toContain('10 Prismes');
    expect(third).toContain('12 → 2');
  });

  it('publicité : prête (active), indisponible (expliquée), masquée si le fournisseur n’a rien de prêt ; jamais pour la 3ᵉ chance', () => {
    expect(S.reviveScreen({ ...base, ad: { offered: true, available: true } })).not.toMatch(/data-action="revive-ad"[^>]*disabled/);
    expect(S.reviveScreen({ ...base, ad: { offered: true, available: true } })).toContain('Reprendre gratuitement');
    const none = S.reviveScreen({ ...base, ad: { offered: true, available: false, reason: 'Indisponible dans cette version' } });
    expect(none).toMatch(/data-action="revive-ad"[^>]*disabled/);
    expect(none).toContain('Indisponible dans cette version');
    expect(S.reviveScreen({ ...base, ad: { offered: true, available: false, hidden: true } })).not.toContain('revive-ad');
    expect(S.reviveScreen({ ...base, life: 3, ad: { offered: false, available: false }, prisms: { price: 10, balance: 12, blocked: null } })).not.toContain('revive-ad');
  });
});

describe('Publicité récompensée : déroulé complet (plugin et service simulés)', () => {
  class FakeAds implements AdsPlugin {
    consent = true;
    ready = true;
    result: 'rewarded' | 'dismissed' | 'failed' = 'rewarded';
    shown: { placement: string; userId: string; customData: string }[] = [];
    loads = 0;
    async requestConsent() {
      return { canRequestAds: this.consent };
    }
    async load() {
      this.loads++;
      return { ready: this.ready };
    }
    async show(o: { placement: string; userId: string; customData: string }) {
      this.shown.push(o);
      return { result: this.result };
    }
  }
  const mkProvider = async (plugin = new FakeAds()): Promise<{ plugin: FakeAds; provider: NativeAdProvider }> => {
    const provider = new NativeAdProvider(plugin);
    await provider.refresh();
    return { plugin, provider };
  };
  /** Service simulé : session, puis réclamation (en attente N fois, accordée, refusée…). */
  function service(claims: NetResult<{ status: string }>[], session: NetResult<{ sessionId: string; userId: string; customData: string }> = ok({ sessionId: 'a'.repeat(32), userId: 'U1', customData: 'a'.repeat(32) })) {
    const calls: string[] = [];
    let i = 0;
    const api = (async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      if (path === '/api/ads/session') return session;
      return claims[Math.min(i++, claims.length - 1)];
    }) as never;
    return { api, calls };
  }
  const noWait = async (): Promise<void> => undefined;

  it('consentement refusé ou aucune publicité chargée : indisponible ; jamais de projection', async () => {
    const refused = new FakeAds();
    refused.consent = false;
    const a = await mkProvider(refused);
    expect(a.provider.isAvailable()).toBe(false);
    expect(await a.provider.showRewarded('revive', { userId: 'u', customData: 'c' })).toBe('unavailable');
    expect(refused.shown).toEqual([]);
    const empty = new FakeAds();
    empty.ready = false;
    expect((await mkProvider(empty)).provider.isAvailable()).toBe(false);
    expect(new NoAdProvider().isAvailable()).toBe(false);
  });

  it('publicité terminée et confirmée par le service : exactement une reprise ; session créée AVANT la publicité, avec ses identifiants', async () => {
    const { plugin, provider } = await mkProvider();
    const { api, calls } = service([ok({ status: 'pending' }), ok({ status: 'pending' }), ok({ status: 'granted' })]);
    let returned = 0;
    const r = await reviveWithAd({ api, provider, runId: 'run-0001abcd', sleep: noWait, onReturn: () => returned++ });
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual(['POST /api/ads/session', 'POST /api/ads/claim', 'POST /api/ads/claim', 'POST /api/ads/claim']);
    expect(plugin.shown).toEqual([{ placement: 'revive', userId: 'U1', customData: 'a'.repeat(32) }]);
    expect(returned).toBe(1);
    // Une seule projection pour cette reprise
    expect(plugin.shown).toHaveLength(1);
  });

  it('interrompue, échouée, non confirmée, déjà utilisée, hors ligne, session refusée : AUCUNE reprise', async () => {
    const fresh = async (result: 'rewarded' | 'dismissed' | 'failed'): Promise<NativeAdProvider> => {
      const plugin = new FakeAds();
      plugin.result = result;
      return (await mkProvider(plugin)).provider;
    };
    const base = { runId: 'run-0001abcd', sleep: noWait };
    expect(await reviveWithAd({ ...base, ...service([ok({ status: 'granted' })]), provider: await fresh('dismissed') })).toMatchObject({ ok: false, reason: 'dismissed' });
    expect(await reviveWithAd({ ...base, ...service([ok({ status: 'granted' })]), provider: await fresh('failed') })).toMatchObject({ ok: false, reason: 'failed' });
    // « Récompensée » côté appareil mais jamais confirmée par la régie : pas de minuterie de substitution
    const never = service([ok({ status: 'pending' })]);
    expect(await reviveWithAd({ ...base, ...never, provider: await fresh('rewarded'), tries: 4 })).toMatchObject({ ok: false, reason: 'unconfirmed' });
    expect(never.calls.filter((c) => c.endsWith('claim'))).toHaveLength(4);
    expect(await reviveWithAd({ ...base, ...service([http(409, 'x')]), provider: await fresh('rewarded') })).toMatchObject({ ok: false, reason: 'used' });
    expect(await reviveWithAd({ ...base, ...service([http(410, 'x')]), provider: await fresh('rewarded') })).toMatchObject({ ok: false, reason: 'unconfirmed' });
    expect(await reviveWithAd({ ...base, ...service([ok({ status: 'granted' })], offline), provider: await fresh('rewarded') })).toMatchObject({ ok: false, reason: 'offline' });
    expect(await reviveWithAd({ ...base, ...service([ok({ status: 'granted' })], http(409, 'déjà')), provider: await fresh('rewarded') })).toMatchObject({ ok: false, reason: 'used' });
    expect(await reviveWithAd({ ...base, ...service([ok({ status: 'granted' })], http(503, 'Publicité récompensée indisponible : fournisseur non configuré.')), provider: await fresh('rewarded') })).toMatchObject({ ok: false, reason: 'error' });
    // Coupure réseau pendant l'attente : on réessaie, puis la confirmation aboutit
    expect(await reviveWithAd({ ...base, ...service([offline, ok({ status: 'granted' })]), provider: await fresh('rewarded') })).toEqual({ ok: true });
  });

  it('aucun fournisseur (web) : indisponible sans aucune requête ; aucun Prisme n’intervient', async () => {
    const { api, calls } = service([ok({ status: 'granted' })]);
    const r = await reviveWithAd({ api, provider: new NoAdProvider(), runId: 'run-0001abcd', sleep: noWait });
    expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(calls).toEqual([]);
    const p: RewardedAdProvider = new NoAdProvider();
    expect(p.kind).toBe('none');
  });
});

describe('Interfaces existantes inchangées', () => {
  it('fournisseurs de test historiques toujours acceptés (compatibilité) ; Prismes visibles seulement si disponibles ou possédés', () => {
    const legacy: PaymentProvider = { isAvailable: () => true, listProducts: async () => [], purchase: async () => ({ status: 'unavailable' }) };
    setPaymentProvider(legacy);
    expect(premiumAvailable()).toBe(true);
    setPaymentProvider(new NullPaymentProvider());
    expect(premiumAvailable()).toBe(false);
    const r: StoreReceipt = { provider: 'apple', productId: 'x' };
    expect(r.provider).toBe('apple');
  });
});
