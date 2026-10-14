import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_ID, applyIdToGradle, applyIdToJava, applyIdToPbxproj, applyIdToStrings, applyVersion, applyVersionToGradle, bump, check, readRelease, setAppId, validAppId, validVersion } from '../scripts/mobile-config';
import { hideNativeSplash, initNative, nativePlatform } from '../src/platform/native';

const FILES = [
  'mobile/release.json',
  'package.json',
  'capacitor.config.ts',
  'android/app/build.gradle',
  'android/app/src/main/res/values/strings.xml',
  'android/app/src/main/java/com/example/polarrift/MainActivity.java',
  'ios/App/App.xcodeproj/project.pbxproj',
];

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'polar-rift-mobile-'));
  for (const f of FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(process.cwd(), f), join(dir, f));
  }
  return dir;
}

describe('configuration mobile (Android / iOS)', () => {
  it('l’état réel du dépôt est cohérent ; l’identifiant définitif et la clé de signature sont signalés « en attente »', () => {
    const r = check(process.cwd());
    expect(r.errors).toEqual([]);
    expect(r.pending.join('\n')).toContain('identifiant');
    expect(readRelease(process.cwd()).appId).toBe(PLACEHOLDER_ID);
  });

  it('cibles des magasins : targetSdk/compileSdk 36 (Android), iOS 15 minimum, aucune permission superflue', () => {
    const vars = readFileSync('android/variables.gradle', 'utf8');
    expect(vars).toMatch(/targetSdkVersion = 36/);
    expect(vars).toMatch(/compileSdkVersion = 36/);
    const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    expect([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1])).toEqual(['android.permission.INTERNET']);
    expect(manifest).toContain('android:screenOrientation="userPortrait"');
    expect(readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')).toMatch(/IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/);
    const plist = readFileSync('ios/App/App/Info.plist', 'utf8');
    expect(plist).toContain('ITSAppUsesNonExemptEncryption');
    for (const usage of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSPhotoLibraryUsageDescription']) expect(plist).not.toContain(usage);
  });

  it('aucun secret de signature dans le dépôt ; fichiers de clés ignorés par git', () => {
    expect(existsSync('android/keystore.properties')).toBe(false);
    const ignore = readFileSync('android/.gitignore', 'utf8');
    for (const p of ['keystore.properties', '*.jks', '*.keystore']) expect(ignore).toContain(p);
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    expect(gradle).not.toMatch(/storePassword\s*=\s*["']/);
    expect(gradle).not.toMatch(/keyPassword\s*=\s*["']/);
  });

  it('identifiants : valides pour Android ET iOS, mots réservés refusés', () => {
    for (const ok of ['fr.monstudio.polarrift', 'io.github.axel_r.polarrift', 'com.exemple.polar_rift']) expect(validAppId(ok), ok).toBe(true);
    for (const bad of ['polarrift', 'Fr.Mon.App', 'fr.mon-studio.app', 'fr.1studio.app', 'fr..app', 'com.exemple.new', 'fr.mon.app.']) expect(validAppId(bad), bad).toBe(false);
    expect(validVersion('2.0.0')).toBe(true);
    expect(validVersion('2.0')).toBe(false);
  });

  it('transformations pures', () => {
    expect(applyIdToGradle('namespace = "a.b"\napplicationId "a.b"', 'x.y')).toBe('namespace = "x.y"\napplicationId "x.y"');
    expect(applyIdToStrings('<string name="package_name">a.b</string><string name="custom_url_scheme">a.b</string>', 'x.y')).toContain('>x.y</string><string name="custom_url_scheme">x.y<');
    expect(applyIdToPbxproj('PRODUCT_BUNDLE_IDENTIFIER = a.b;\nPRODUCT_BUNDLE_IDENTIFIER = a.b;', 'x.y')).toBe('PRODUCT_BUNDLE_IDENTIFIER = x.y;\nPRODUCT_BUNDLE_IDENTIFIER = x.y;');
    expect(applyIdToJava('package a.b;\nclass X {}', 'x.y')).toContain('package x.y;');
    expect(applyVersionToGradle('versionCode 1\nversionName "1.0"', 7, '2.1.0')).toBe('versionCode 7\nversionName "2.1.0"');
  });

  it('mobile:set-id, mobile:bump et mobile:version appliqués sur une COPIE : projets natifs restent cohérents', () => {
    const dir = sandbox();
    try {
      expect(() => setAppId('Mauvais-Id', dir)).toThrow('invalide');
      setAppId('fr.monstudio.polarrift', dir);
      expect(existsSync(join(dir, 'android/app/src/main/java/fr/monstudio/polarrift/MainActivity.java'))).toBe(true);
      expect(existsSync(join(dir, 'android/app/src/main/java/com'))).toBe(false);
      expect(readFileSync(join(dir, 'android/app/src/main/java/fr/monstudio/polarrift/MainActivity.java'), 'utf8')).toContain('package fr.monstudio.polarrift;');
      expect(readRelease(dir)).toMatchObject({ appId: 'fr.monstudio.polarrift', appIdConfirmed: true });
      const next = bump(dir);
      expect(next).toMatchObject({ androidVersionCode: 2, iosBuildNumber: 2 });
      applyVersion(dir);
      const r = check(dir);
      expect(r.errors).toEqual([]);
      expect(r.pending.join('\n')).not.toContain('identifiant');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('couche native (sans effet sur le web)', () => {
  it('détection de la plateforme par l’objet injecté par Capacitor', () => {
    expect(nativePlatform({})).toBeNull();
    expect(nativePlatform({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } })).toBeNull();
    expect(nativePlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } })).toBe('android');
    expect(nativePlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } })).toBe('ios');
    expect(nativePlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'electron' } })).toBeNull();
  });

  it('sur le web : rien n’est branché ni chargé', async () => {
    const hooks = { onBackground: () => undefined, onForeground: () => undefined, onBack: () => false };
    expect(await initNative(hooks)).toBeNull();
    await expect(hideNativeSplash()).resolves.toBeUndefined();
  });
});
