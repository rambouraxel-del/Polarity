import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeAdProvider, NoAdProvider, getAdProvider, initNativeAds, setAdProvider, type AdsPlugin, type ConsentState } from '../src/monetization/ads';
import { registerNativePlugin, resetRegisteredPlugins } from '../src/platform/plugins';

/**
 * Plugin SIMULÉ (aucun appel à Google : ces tests prouvent la logique du jeu autour du plugin, pas le SDK ni la régie).
 * Chaque méthode est enregistrée ; les résolutions sont pilotables pour tester la concurrence.
 */
class FakePlugin implements AdsPlugin {
  consent: ConsentState = { canRequestAds: true, privacyOptionsRequired: true, status: 'obtained' };
  calls: string[] = [];
  loadResult: { ready: boolean; reason?: string } = { ready: true };
  showResult: { result: 'rewarded' | 'dismissed' | 'failed' } = { result: 'rewarded' };
  shown: { placement: string; userId: string; customData: string }[] = [];
  gate: Promise<void> | null = null;
  showGate: Promise<void> | null = null;
  onPrivacy: (() => void) | null = null;

  async requestConsent(): Promise<ConsentState> {
    this.calls.push('requestConsent');
    if (this.gate) await this.gate;
    return { ...this.consent };
  }
  async getConsentState(): Promise<ConsentState> {
    this.calls.push('getConsentState');
    return { ...this.consent };
  }
  async showPrivacyOptions(): Promise<ConsentState> {
    this.calls.push('showPrivacyOptions');
    this.onPrivacy?.();
    return { ...this.consent };
  }
  async load(): Promise<{ ready: boolean; reason?: string }> {
    this.calls.push('load');
    if (this.gate) await this.gate;
    return this.loadResult;
  }
  async show(o: { placement: string; userId: string; customData: string }): Promise<{ result: 'rewarded' | 'dismissed' | 'failed' }> {
    this.calls.push('show');
    this.shown.push(o);
    if (this.showGate) await this.showGate;
    return this.showResult;
  }
}

const ctx = { userId: 'U', customData: 'c'.repeat(32) };
const count = (p: FakePlugin, name: string): number => p.calls.filter((c) => c === name).length;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Publicité native : consentement avant tout chargement', () => {
  it('le consentement est demandé AVANT le chargement ; sans canRequestAds aucune publicité n’est chargée', async () => {
    const p = new FakePlugin();
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    expect(p.calls).toEqual(['requestConsent', 'load']);
    expect(provider.isAvailable()).toBe(true);

    const refused = new FakePlugin();
    refused.consent = { canRequestAds: false, privacyOptionsRequired: true, status: 'required' };
    const b = new NativeAdProvider(refused);
    await b.refresh();
    expect(refused.calls).toEqual(['requestConsent']); // jamais de load
    expect(b.isAvailable()).toBe(false);
    expect(await b.showRewarded('revive', ctx)).toBe('unavailable');
    expect(refused.shown).toEqual([]);
  });

  it('plugin en erreur (formulaire, réseau) : indisponible, jamais d’autorisation forcée', async () => {
    const p = new FakePlugin();
    p.requestConsent = async () => {
      throw new Error('boom');
    };
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    expect(provider.isAvailable()).toBe(false);
    expect(count(p, 'load')).toBe(0);
  });

  it('le formulaire n’est demandé qu’une fois par lancement : après une publicité, on relit l’état puis on recharge (pas de boucle)', async () => {
    const p = new FakePlugin();
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    expect(await provider.showRewarded('revive', ctx)).toBe('rewarded');
    await flush(); // le rechargement automatique après la projection
    expect(count(p, 'requestConsent')).toBe(1);
    expect(count(p, 'load')).toBe(2); // préchargement initial + rechargement après la projection
  });

  it('recontrôle avant l’affichage : consentement révoqué entre-temps = aucune projection', async () => {
    const p = new FakePlugin();
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    expect(provider.isAvailable()).toBe(true);
    p.consent = { canRequestAds: false, privacyOptionsRequired: true, status: 'required' }; // changement hors du jeu (réglages système, formulaire)
    expect(await provider.showRewarded('revive', ctx)).toBe('unavailable');
    expect(p.shown).toEqual([]);
    expect(provider.isAvailable()).toBe(false);
  });
});

describe('Publicité native : concurrence', () => {
  it('rafraîchissements simultanés = une seule demande de consentement et un seul chargement', async () => {
    const p = new FakePlugin();
    let release!: () => void;
    p.gate = new Promise((r) => (release = r));
    const provider = new NativeAdProvider(p);
    const all = Promise.all([provider.refresh(), provider.refresh(), provider.refresh()]);
    release();
    await all;
    expect(count(p, 'requestConsent')).toBe(1);
    expect(count(p, 'load')).toBe(1);
  });

  it('deux projections simultanées : une seule est lancée ; la seconde est « indisponible »', async () => {
    const p = new FakePlugin();
    let release!: () => void;
    p.showGate = new Promise((r) => (release = r));
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    const first = provider.showRewarded('revive', ctx);
    await flush();
    expect(await provider.showRewarded('revive', ctx)).toBe('unavailable');
    release();
    expect(await first).toBe('rewarded');
    expect(p.shown).toHaveLength(1);
  });

  it('une annonce n’est projetée qu’une fois : après la projection il faut un nouveau chargement', async () => {
    const p = new FakePlugin();
    p.loadResult = { ready: false }; // le rechargement échoue
    const provider = new NativeAdProvider(p);
    p.loadResult = { ready: true };
    await provider.refresh();
    p.loadResult = { ready: false };
    expect(await provider.showRewarded('revive', ctx)).toBe('rewarded');
    await flush();
    expect(provider.isAvailable()).toBe(false);
    expect(await provider.showRewarded('revive', ctx)).toBe('unavailable');
    expect(p.shown).toHaveLength(1);
  });

  it('une annonce périmée (plus d’une heure) n’est plus présentée', async () => {
    const p = new FakePlugin();
    let t = 1_000_000;
    const provider = new NativeAdProvider(p, 'revive', () => t);
    await provider.refresh();
    expect(provider.isAvailable()).toBe(true);
    t += 56 * 60 * 1000;
    expect(provider.isAvailable()).toBe(false);
    expect(await provider.showRewarded('revive', ctx)).toBe('unavailable');
  });
});

describe('Publicité native : résultats (récompense, fermeture, échec)', () => {
  const run = async (result: 'rewarded' | 'dismissed' | 'failed'): Promise<{ r: string; p: FakePlugin }> => {
    const p = new FakePlugin();
    p.showResult = { result };
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    return { r: await provider.showRewarded('revive', ctx), p };
  };

  it('récompensée → rewarded ; fermée avant → dismissed ; échec → indisponible ; exception → indisponible', async () => {
    expect((await run('rewarded')).r).toBe('rewarded');
    expect((await run('dismissed')).r).toBe('dismissed');
    expect((await run('failed')).r).toBe('unavailable');
    const p = new FakePlugin();
    p.show = async () => {
      throw new Error('crash');
    };
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    expect(await provider.showRewarded('revive', ctx)).toBe('unavailable');
  });

  it('les identifiants de la session serveur sont transmis au plugin avec la demande d’affichage ; sans eux, rien n’est affiché', async () => {
    const { p } = await run('rewarded');
    expect(p.shown).toEqual([{ placement: 'revive', userId: 'U', customData: 'c'.repeat(32) }]);
    const q = new FakePlugin();
    const provider = new NativeAdProvider(q);
    await provider.refresh();
    expect(await provider.showRewarded('revive')).toBe('unavailable');
    expect(q.shown).toEqual([]);
  });
});

describe('Choix de confidentialité : invalidation et réévaluation', () => {
  it('la publicité préchargée est invalidée aussitôt, puis réévaluée avec le nouveau choix', async () => {
    const p = new FakePlugin();
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    expect(provider.isAvailable()).toBe(true);
    expect(provider.privacyOptionsRequired()).toBe(true);
    // Le joueur retire son consentement dans le formulaire
    p.onPrivacy = () => (p.consent = { canRequestAds: false, privacyOptionsRequired: true, status: 'required' });
    await provider.showPrivacyOptions();
    expect(provider.isAvailable()).toBe(false);
    expect(count(p, 'load')).toBe(1); // aucun nouveau chargement sans autorisation
    // Puis le rétablit
    p.onPrivacy = () => (p.consent = { canRequestAds: true, privacyOptionsRequired: true, status: 'obtained' });
    await provider.showPrivacyOptions();
    expect(provider.isAvailable()).toBe(true);
    expect(count(p, 'load')).toBe(2);
    expect(count(p, 'requestConsent')).toBe(1); // le formulaire de consentement n'est jamais redemandé
  });

  it('un chargement commencé avant le changement de choix est abandonné (jamais prêt avec l’ancien consentement)', async () => {
    const p = new FakePlugin();
    let release!: () => void;
    p.gate = new Promise((r) => (release = r));
    const provider = new NativeAdProvider(p);
    const first = provider.refresh();
    await flush();
    p.gate = null;
    p.onPrivacy = () => (p.consent = { canRequestAds: false, privacyOptionsRequired: true, status: 'required' });
    const privacy = provider.showPrivacyOptions();
    release();
    await Promise.all([first, privacy]);
    expect(provider.isAvailable()).toBe(false);
  });

  it('options de confidentialité non exigées : le point d’entrée n’est pas proposé', async () => {
    const p = new FakePlugin();
    p.consent = { canRequestAds: true, privacyOptionsRequired: false, status: 'not_required' };
    const provider = new NativeAdProvider(p);
    await provider.refresh();
    expect(provider.privacyOptionsRequired()).toBe(false);
  });
});

describe('Absence de plugin et pont Capacitor réel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    resetRegisteredPlugins();
    setAdProvider(new NoAdProvider());
  });

  it('web (navigateur, GitHub Pages, PWA) : aucun plugin, aucun fournisseur, rien ne change', async () => {
    expect(await initNativeAds()).toBe(false);
    expect(getAdProvider().kind).toBe('none');
    expect(getAdProvider().isAvailable()).toBe(false);
    expect(await registerNativePlugin('PolarRiftAds', async () => ({ Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false }, registerPlugin: vi.fn() }))).toBeNull();
  });

  it('application native SANS le plugin : null (la publicité reste désactivée)', async () => {
    const core = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false }, registerPlugin: vi.fn() };
    expect(await registerNativePlugin('PolarRiftAds', async () => core)).toBeNull();
    expect(core.registerPlugin).not.toHaveBeenCalled();
  });

  it('VRAI @capacitor/core : détection par PluginHeaders, enregistrement unique, appel natif sans piège « thenable »', async () => {
    // Environnement Android simulé : pont natif + en-têtes de plugin que l'application native injecte
    const sent: { pluginName: string; method: string; options: unknown }[] = [];
    vi.stubGlobal('androidBridge', { postMessage: () => undefined });
    vi.stubGlobal('Capacitor', {
      PluginHeaders: [{ name: 'PolarRiftAds', methods: ['requestConsent', 'getConsentState', 'showPrivacyOptions', 'load', 'show'].map((name) => ({ name, rtype: 'promise' })) }],
      // Le pont natif injecté fournit nativePromise : ici il enregistre l'appel et répond comme le natif le ferait
      nativePromise: async (pluginName: string, method: string, options: unknown) => {
        sent.push({ pluginName, method, options });
        return method === 'show' ? { result: 'rewarded' } : { canRequestAds: true, privacyOptionsRequired: false, status: 'not_required', ready: true };
      },
    });
    vi.resetModules();
    const core = await import('@capacitor/core');
    expect(core.Capacitor.isNativePlatform()).toBe(true);
    expect(core.Capacitor.isPluginAvailable('PolarRiftAds')).toBe(true);
    expect(core.Capacitor.isPluginAvailable('AutrePlugin')).toBe(false);

    const handle = await registerNativePlugin<AdsPlugin>('PolarRiftAds', async () => core as never);
    expect(handle).not.toBeNull(); // si le proxy était renvoyé tel quel, `await` ne se terminerait jamais (propriété `then` interceptée)
    const again = await registerNativePlugin<AdsPlugin>('PolarRiftAds', async () => core as never);
    expect(again?.plugin).toBe(handle?.plugin); // un seul enregistrement

    const shown = await handle!.plugin.show({ placement: 'revive', userId: 'U', customData: 'c'.repeat(32) });
    expect(shown.result).toBe('rewarded');
    expect(sent).toEqual([{ pluginName: 'PolarRiftAds', method: 'show', options: { placement: 'revive', userId: 'U', customData: 'c'.repeat(32) } }]);
  });
});
