import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOOGLE_DEMO, adsPlistBlock, applyAdsToPlist, checkAdsConfig, loadAdsConfig, plistIsCurrent, resolveAds, type AdsConfig } from '../scripts/ads-config';
import { PRIVACY_POLICY_URL, REWARDED_PLACEMENT } from '../src/config/ads';
import * as S from '../src/ui/screens';
import { defaultSave } from '../src/save/save';

const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');
const base = (): AdsConfig => loadAdsConfig(join(__dirname, '../mobile/ads.json'));
const live = (over: Partial<AdsConfig> = {}): AdsConfig => ({
  ...base(),
  mode: 'live',
  unitAssociationConfirmed: true,
  android: { appId: 'ca-app-pub-4635509667785777~1111111111', rewardedUnitId: 'ca-app-pub-4635509667785777/7300498334' },
  ios: { appId: 'ca-app-pub-4635509667785777~2222222222', rewardedUnitId: 'ca-app-pub-4635509667785777/7641252998' },
  ...over,
});

describe('Configuration publicitaire centralisée (mobile/ads.json)', () => {
  it('par défaut : mode démonstration, aucun appareil de test, aucun débogage ; valide pour le développement, refusée pour la production', () => {
    const c = base();
    expect(c.mode).toBe('demo');
    expect(c.testDeviceIds).toEqual([]);
    expect(c.umpDebugGeography).toBe('off');
    expect(checkAdsConfig(c, false)).toEqual([]);
    expect(checkAdsConfig(c, true).join(' ')).toMatch(/demo/);
  });

  it('les blocs configurés du compte sont ceux annoncés (association à confirmer dans AdMob avant activation réelle)', () => {
    const c = base();
    expect(c.android.rewardedUnitId).toBe('ca-app-pub-4635509667785777/7300498334');
    expect(c.ios.rewardedUnitId).toBe('ca-app-pub-4635509667785777/7641252998');
    expect(c.unitAssociationConfirmed).toBe(false);
    // ID d'application réels du compte, enregistrés pour la suite (jamais déduits des identifiants de blocs)
    expect(c.android.appId).toBe('ca-app-pub-4635509667785777~1257834166');
    expect(c.ios.appId).toBe('ca-app-pub-4635509667785777~8318066533');
  });

  it('les ID réels enregistrés ne sont PAS utilisés en mode demo : la version livrée n’utilise que les identifiants de démonstration Google', () => {
    const c = base();
    expect(c.mode).toBe('demo');
    for (const p of ['android', 'ios'] as const) {
      const r = resolveAds(c, p);
      expect(r.appId).toBe(GOOGLE_DEMO[p].appId);
      expect(r.rewardedUnitId).toBe(GOOGLE_DEMO[p].rewardedUnitId);
      expect(JSON.stringify(r)).not.toContain('4635509667785777');
    }
    // Le contrôle de développement passe, celui de production refuse (mode demo)
    expect(checkAdsConfig(c, false)).toEqual([]);
    expect(checkAdsConfig(c, true).join(' ')).toMatch(/demo/);
  });

  it('mode demo : identifiants de démonstration Google uniquement (jamais ceux du compte) ; mode live : ceux du compte', () => {
    for (const p of ['android', 'ios'] as const) {
      const d = resolveAds(base(), p);
      expect(d.appId).toBe(GOOGLE_DEMO[p].appId);
      expect(d.rewardedUnitId).toBe(GOOGLE_DEMO[p].rewardedUnitId);
      expect(d.rewardedUnitId).not.toContain('4635509667785777');
    }
    expect(resolveAds(live(), 'android').rewardedUnitId).toBe('ca-app-pub-4635509667785777/7300498334');
    expect(resolveAds(live(), 'ios').appId).toBe('ca-app-pub-4635509667785777~2222222222');
  });

  it('mode live : exige des ID d’application réels (pas un ID de bloc, pas celui de démonstration), des blocs du même éditeur et l’association confirmée', () => {
    expect(checkAdsConfig(live(), false)).toEqual([]);
    expect(checkAdsConfig(live({ android: { appId: '', rewardedUnitId: 'ca-app-pub-4635509667785777/7300498334' } }), false).join(' ')).toMatch(/android\.appId/);
    // Les ID réels déjà enregistrés ne suffisent pas : passer en « live » exige encore la confirmation de l'association des blocs
    expect(checkAdsConfig({ ...base(), mode: 'live' }, false).join(' ')).toMatch(/association/);
    expect(checkAdsConfig(live({ android: { appId: 'ca-app-pub-4635509667785777/7300498334', rewardedUnitId: 'ca-app-pub-4635509667785777/7300498334' } }), false).join(' ')).toMatch(/android\.appId/);
    expect(checkAdsConfig(live({ ios: { appId: GOOGLE_DEMO.ios.appId, rewardedUnitId: 'ca-app-pub-4635509667785777/7641252998' } }), false).join(' ')).toMatch(/ios\.appId/);
    expect(checkAdsConfig(live({ android: { appId: 'ca-app-pub-4635509667785777~1111111111', rewardedUnitId: GOOGLE_DEMO.android.rewardedUnitId } }), false).join(' ')).toMatch(/android\.rewardedUnitId/);
    expect(checkAdsConfig(live({ unitAssociationConfirmed: false }), false).join(' ')).toMatch(/association/);
    expect(checkAdsConfig(live({ android: { appId: 'ca-app-pub-1111111111111111~1111111111', rewardedUnitId: 'ca-app-pub-4635509667785777/7300498334' } }), false).join(' ')).toMatch(/même éditeur/);
  });

  it('production : échoue clairement avec le mode demo, un débogage du consentement ou des appareils de test ; passe avec une configuration réelle propre', () => {
    expect(checkAdsConfig(live(), true)).toEqual([]);
    expect(checkAdsConfig(live({ umpDebugGeography: 'eea' }), true).join(' ')).toMatch(/umpDebugGeography/);
    expect(checkAdsConfig(live({ testDeviceIds: ['ABCDEF0123456789ABCDEF0123456789'] }), true).join(' ')).toMatch(/testDeviceIds/);
    expect(checkAdsConfig({ ...live(), mode: 'demo' }, true).join(' ')).toMatch(/demo/);
    // Pour le développement, les appareils de test et le débogage restent permis en mode live
    expect(checkAdsConfig(live({ umpDebugGeography: 'eea', testDeviceIds: ['ABCDEF0123456789ABCDEF0123456789'] }), false)).toEqual([]);
    expect(checkAdsConfig({ ...live(), umpDebugGeography: 'partout' as never }, false).join(' ')).toMatch(/umpDebugGeography/);
  });
});

describe('Projet iOS : Info.plist généré depuis la configuration', () => {
  it('le bloc publicitaire est présent et à jour ; l’application est idempotente ; le mode demo n’y met que des identifiants de démonstration', () => {
    const plist = read('ios/App/App/Info.plist');
    expect(plistIsCurrent(plist, base())).toBe(true);
    expect(plist).toContain(GOOGLE_DEMO.ios.appId);
    expect(plist).not.toContain('4635509667785777');
    expect(plist).not.toContain('NSUserTrackingUsageDescription'); // ATT non demandée : aucun suivi propre (décision documentée)
    const twice = applyAdsToPlist(applyAdsToPlist(plist, base()), base());
    expect(twice).toBe(plist);
    expect(plist.match(/polar-rift-ads:begin/g)).toHaveLength(1);
  });

  it('en mode live, le bloc contient les identifiants du compte et les appareils de test déclarés', () => {
    const c = live({ testDeviceIds: ['ABCDEF0123456789ABCDEF0123456789'], umpDebugGeography: 'eea' });
    const block = adsPlistBlock(c);
    expect(block).toContain('ca-app-pub-4635509667785777~2222222222');
    expect(block).toContain('ca-app-pub-4635509667785777/7641252998');
    expect(block).toContain('ABCDEF0123456789ABCDEF0123456789');
    expect(block).toContain('<string>eea</string>');
    expect(applyAdsToPlist(read('ios/App/App/Info.plist'), c)).toContain(block);
  });

  it('une phase de compilation Xcode refuse une publication « Release » provisoire ou de debug', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbx).toContain('PBXShellScriptBuildPhase');
    expect(pbx).toContain('${CONFIGURATION}');
    expect(pbx).toContain('Release');
    expect(pbx).toContain('3940256099942544');
    expect(pbx).toContain('exit 1');
  });
});

describe('Projets natifs : câblage et garde-fous (contrôles de source, PAS une compilation)', () => {
  const java = read('plugins/polar-rift-ads/android/src/main/java/polarrift/ads/PolarRiftAdsPlugin.java');
  const swift = read('plugins/polar-rift-ads/ios/Sources/PolarRiftAdsPlugin/PolarRiftAdsPlugin.swift');

  it('le plugin est branché sur Android et iOS (généré par `npx cap sync`)', () => {
    expect(read('android/capacitor.settings.gradle')).toContain("':polar-rift-ads'");
    expect(read('android/app/capacitor.build.gradle')).toContain('polar-rift-ads');
    expect(read('ios/App/CapApp-SPM/Package.swift')).toContain('PolarRiftAds');
    expect(read('android/app/src/main/assets/capacitor.plugins.json')).toContain('polarrift.ads.PolarRiftAdsPlugin');
    expect(read('ios/App/App/capacitor.config.json')).toContain('PolarRiftAdsPlugin');
  });

  it('Android : ID d’application AdMob déclaré (sans lui le SDK plante), générée depuis la configuration ; permissions minimales', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('com.google.android.gms.ads.APPLICATION_ID');
    expect(manifest).toContain('${polarRiftAdMobAppId}');
    const perms = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(perms).toEqual(['android.permission.INTERNET']); // les permissions du SDK publicitaire sont fusionnées par Gradle, aucune n'est ajoutée à la main
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('verifyAdsConfigRelease');
    expect(gradle).toContain("preReleaseBuild");
    expect(gradle).toContain('ca-app-pub-3940256099942544~3347511713');
  });

  it('les deux plateformes : consentement recontrôlé avant chargement ET avant affichage, options SSV posées AVANT la présentation', () => {
    expect((java.match(/canRequestAds\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((swift.match(/canRequestAds/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(java.indexOf('setServerSideVerificationOptions')).toBeGreaterThan(0);
    expect(java.indexOf('setServerSideVerificationOptions')).toBeLessThan(java.indexOf('ad.show('));
    expect(swift.indexOf('serverSideVerificationOptions = ssv')).toBeGreaterThan(0);
    expect(swift.indexOf('serverSideVerificationOptions = ssv')).toBeLessThan(swift.indexOf('ad.present('));
    // userId et customData viennent de la session serveur : sans eux, aucun affichage
    expect(java).toContain('bad_request');
    expect(swift).toContain('bad_request');
  });

  it('aucun reset du consentement, aucune déclaration d’âge ou d’enfants, aucun identifiant de bloc en dur (jamais ceux de démonstration en production)', () => {
    for (const src of [java, swift]) {
      expect(src).not.toMatch(/\.reset\(\)/);
      expect(src).not.toMatch(/TagForUnderAgeOfConsent|tagForUnderAgeOfConsent|TagForChildDirectedTreatment|tagForChildDirectedTreatment|maxAdContentRating/);
      expect(src).not.toMatch(/ca-app-pub-/);
      expect(src).not.toMatch(/requestTrackingAuthorization|ATTrackingManager/);
    }
    // Débogage du consentement : jamais en production (Android : build « debuggable » ; iOS : DEBUG)
    expect(read('plugins/polar-rift-ads/android/src/main/java/polarrift/ads/AdsSettings.java')).toContain('FLAG_DEBUGGABLE');
    expect(read('plugins/polar-rift-ads/ios/Sources/PolarRiftAdsPlugin/AdsSettings.swift')).toContain('#if DEBUG');
  });

  it('chaque appel est résolu UNE seule fois (garde `done`) et une fermeture après récompense ne l’efface pas', () => {
    expect(java).toContain('if (s.done) return;');
    expect(swift).toContain('if s.done { return }');
    expect(java).toContain('state.earned ? "rewarded" : "dismissed"');
    expect(swift).toContain('state.earned ? "rewarded" : "dismissed"');
  });

  it('aucun SDK publicitaire dans le code web ni dans le bundle ; les identifiants du compte ne sont que dans mobile/ads.json', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const f of walk(join(__dirname, '../src')).filter((f) => /\.(ts|css|html)$/.test(f))) {
      const txt = readFileSync(f, 'utf8');
      expect(txt, f).not.toContain('4635509667785777');
      expect(txt, f).not.toMatch(/googlesyndication|pagead2|play-services-ads|GoogleMobileAds|user-messaging-platform/);
    }
    expect(read('package.json')).not.toMatch(/admob|google-mobile-ads/i);
    expect(read('scripts/check-bundle.mjs')).toContain('ca-app-pub-');
    expect(existsSync(join(__dirname, '../plugins/polar-rift-ads/package.json'))).toBe(true);
  });

  it('le plugin ne contient aucun code de gameplay ni accès au portefeuille : il ne rend que consentement, chargement et résultat d’affichage', () => {
    for (const src of [java, swift]) expect(src).not.toMatch(/Prism|wallet|revive|Reprise|reprise/);
  });
});

describe('Réglages : confidentialité', () => {
  it('lien vers la politique publique toujours présent (web compris) ; « Choix de confidentialité » seulement quand la plateforme l’exige', () => {
    expect(PRIVACY_POLICY_URL).toBe('https://rambouraxel-del.github.io/Polarity/confidentialite.html');
    const web = S.optionsScreen(defaultSave());
    expect(web).toContain(`href="${PRIVACY_POLICY_URL}"`);
    expect(web).toContain('rel="noopener noreferrer"');
    expect(web).not.toContain('privacy-choices');
    const native = S.optionsScreen(defaultSave(), false, null, true);
    expect(native).toContain('data-action="privacy-choices"');
    expect(native).toContain('Choix de confidentialité');
  });

  it('la page publique existe à l’adresse annoncée (confidentialite.html) et l’emplacement de la publicité reste « revive »', () => {
    expect(existsSync(join(__dirname, '../public/confidentialite.html'))).toBe(true);
    expect(existsSync(join(__dirname, '../public/confidentialite.html.html'))).toBe(false);
    expect(REWARDED_PLACEMENT).toBe('revive');
  });
});
