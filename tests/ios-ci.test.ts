import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardSigned, nextBuildNumber, setBuild } from '../scripts/ios-ci';
import { setAppId } from '../scripts/mobile-config';

const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');
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
  const dir = mkdtempSync(join(tmpdir(), 'polar-rift-ios-ci-'));
  for (const f of FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(process.cwd(), f), join(dir, f));
  }
  return dir;
}

describe('Codemagic iOS : garde de signature et numéros de build', () => {
  it('tant que le Bundle ID est provisoire, la compilation signée est refusée (jamais d’identifiant inventé)', () => {
    const e = guardSigned(undefined, process.cwd()).join(' ');
    expect(e).toMatch(/BUNDLE_ID absente/);
    expect(e).toMatch(/provisoire/);
    expect(guardSigned('com.example.polarrift', process.cwd()).join(' ')).toMatch(/provisoire refusé/);
    expect(guardSigned('Pas Valide', process.cwd()).join(' ')).toMatch(/invalide/);
  });

  it('accepte seulement un Bundle ID définitif appliqué partout et identique à la variable', () => {
    const dir = sandbox();
    setAppId('fr.studio.polarrift', dir);
    expect(guardSigned('fr.studio.polarrift', dir)).toEqual([]);
    expect(guardSigned('fr.autre.polarrift', dir).join(' ')).toMatch(/≠ identifiant du dépôt/);
    expect(guardSigned('', dir).join(' ')).toMatch(/BUNDLE_ID absente/);
  });

  it('numéro de build : toujours supérieur au dernier TestFlight, jamais sous mobile/release.json', () => {
    expect(nextBuildNumber(1, null)).toBe(1);
    expect(nextBuildNumber(1, 0)).toBe(1);
    expect(nextBuildNumber(1, 7)).toBe(8);
    expect(nextBuildNumber(12, 7)).toBe(12);
    expect(() => nextBuildNumber(0, null)).toThrow();
    expect(() => nextBuildNumber(1, -2)).toThrow();
  });

  it('set-build ne touche que le projet Xcode de l’espace de travail (release.json inchangé)', () => {
    const dir = sandbox();
    const before = readFileSync(join(dir, 'mobile/release.json'), 'utf8');
    setBuild(42, dir);
    const pbx = readFileSync(join(dir, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    expect([...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1])).toEqual(['42', '42']);
    expect(readFileSync(join(dir, 'mobile/release.json'), 'utf8')).toBe(before);
    expect(() => setBuild(0, dir)).toThrow();
  });
});

describe('codemagic.yaml', () => {
  const raw = read('codemagic.yaml');
  // commentaires retirés : les contrôles « interdit » portent sur ce qui s'exécute ou se configure, pas sur les explications
  const y = raw.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
  it('deux parcours manuels : vérification sans signature, puis compilation signée + TestFlight', () => {
    expect(y).toMatch(/^ {2}ios-verification:/m);
    expect(y).toMatch(/^ {2}ios-testflight:/m);
    expect(y).not.toMatch(/^\s*triggering:/m); // aucune compilation ni envoi automatique
  });
  it('Xcode 26 minimum, Swift Package Manager (pas de CocoaPods), npm ci, construction native', () => {
    expect(y).toMatch(/-ge 26/);
    expect(y).toContain('npm ci');
    expect(y).toContain('npm run mobile:sync');
    expect(y).toContain('-resolvePackageDependencies');
    expect(y).not.toMatch(/pod install|Podfile|cocoapods/i);
  });
  it('le parcours sans signature ne signe pas et ne produit pas d’IPA ; le parcours signé garde avant de signer', () => {
    const v = y.slice(y.indexOf('ios-verification:'), y.indexOf('ios-testflight:'));
    expect(v).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(v).not.toMatch(/fetch-signing-files|keychain|use-profiles|publishing:|build-ipa/);
    const s = y.slice(y.indexOf('ios-testflight:'));
    expect(s.indexOf('mobile:ios:guard')).toBeGreaterThan(-1);
    expect(s.indexOf('mobile:ios:guard')).toBeLessThan(s.indexOf('fetch-signing-files'));
    expect(s).toContain('"$BUNDLE_ID"');
  });
  it('TestFlight interne seulement : aucune revue bêta externe, aucune soumission à l’App Store', () => {
    expect(y).toMatch(/submit_to_testflight: false/);
    expect(y).not.toMatch(/submit_to_testflight: true|submit_to_app_store|beta_groups/);
  });
  it('aucun secret ni identifiant sensible dans le fichier ; Bundle ID jamais écrit en dur', () => {
    expect(y).not.toMatch(/BEGIN (RSA |EC |)PRIVATE KEY|\.p8|\.p12|\.mobileprovision/);
    expect(y).not.toMatch(/ca-app-pub-|AKIA|ghp_|eyJ[A-Za-z0-9_-]{20,}/);
    expect(y).not.toMatch(/bundle_identifier|BUNDLE_ID:\s*\S|(com|fr|io|org)\.[a-z0-9_]+\.polarrift/);
    // les trois secrets viennent de variables Codemagic, jamais de valeurs
    expect(y).toMatch(/CERTIFICATE_PRIVATE_KEY/);
    expect(y).not.toMatch(/CERTIFICATE_PRIVATE_KEY:\s+\S/);
    expect(y).toContain('auth: integration');
  });
});

describe('projet iOS existant (audit statique)', () => {
  it('Swift Package Manager, cible iOS 15, jamais de CocoaPods ; réseau chiffré uniquement', () => {
    expect(read('ios/App/CapApp-SPM/Package.swift')).toContain('.iOS(.v15)');
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbx).toContain('XCLocalSwiftPackageReference "CapApp-SPM"');
    const plist = read('ios/App/App/Info.plist');
    expect(plist).not.toContain('NSAppTransportSecurity');
    expect(plist).toContain('ITSAppUsesNonExemptEncryption');
    expect(read('capacitor.config.ts')).toMatch(/cleartext:\s*false/);
  });
  it('le jeu embarqué (ios/App/App/public) est généré par cap sync, jamais commité', () => {
    expect(read('ios/.gitignore')).toMatch(/public/);
  });
});
