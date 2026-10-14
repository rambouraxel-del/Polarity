/**
 * Paramètres de publication mobile : UNE source (mobile/release.json + version de package.json) appliquée aux projets natifs, et vérifiée.
 *
 *   npm run mobile:set-id -- <identifiant>   identifiant d'application (Android applicationId = iOS Bundle ID), ex. fr.monstudio.polarrift
 *   npm run mobile:version                   applique la version (package.json) et les numéros de build (mobile/release.json) aux projets natifs
 *   npm run mobile:bump                      incrémente les numéros de build (Android versionCode, iOS build) avant un nouvel envoi aux magasins
 *   npm run mobile:check                     contrôle la cohérence (code, projets natifs, origines du classement) ; signale les paramètres en attente
 *   npm run mobile:check -- --release        contrôle de publication : échoue tant qu'un paramètre est en attente (identifiant « exemple », clé de signature)
 *
 * Rien n'est inventé : l'identifiant est « com.example.polarrift » (refusé par les magasins) tant que l'éditeur n'a pas choisi le sien.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_APP_ORIGINS } from '../src/net/origins';

export const PLACEHOLDER_ID = 'com.example.polarrift';
/** Identifiants « exemple » : refusés par les magasins, jamais publiables. */
export const isPlaceholderId = (id: string): boolean => /^(com|org|net)\.example(\.|$)/.test(id) || id === PLACEHOLDER_ID;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Release {
  appId: string;
  appIdConfirmed: boolean;
  androidVersionCode: number;
  iosBuildNumber: number;
}

/** Identifiant valable à la fois pour Android (applicationId) et iOS (Bundle ID) : minuscules/chiffres/tiret bas, 2 segments ou plus, jamais de mot réservé Java. */
export function validAppId(id: string): boolean {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(id) && id.length <= 80 && !/(^|\.)(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while)(\.|$)/.test(id);
}

/** Version affichable (versionName / MARKETING_VERSION) : x.y.z. */
export const validVersion = (v: string): boolean => /^\d+\.\d+\.\d+$/.test(v);

// ————————————————————————— transformations pures (testées)

export function applyIdToGradle(text: string, id: string): string {
  return text.replace(/(namespace\s*=\s*)"[^"]*"/, `$1"${id}"`).replace(/(applicationId\s+)"[^"]*"/, `$1"${id}"`);
}
export function applyIdToStrings(text: string, id: string): string {
  return text.replace(/(<string name="package_name">)[^<]*/, `$1${id}`).replace(/(<string name="custom_url_scheme">)[^<]*/, `$1${id}`);
}
export function applyIdToPbxproj(text: string, id: string): string {
  return text.replace(/(PRODUCT_BUNDLE_IDENTIFIER = )[^;]+;/g, `$1${id};`);
}
export function applyIdToCapacitorConfig(text: string, id: string): string {
  return text.replace(/(appId:\s*)'[^']*'/, `$1'${id}'`);
}
export function applyVersionToGradle(text: string, code: number, name: string): string {
  return text.replace(/(versionCode\s+)\d+/, `$1${code}`).replace(/(versionName\s+)"[^"]*"/, `$1"${name}"`);
}
export function applyVersionToPbxproj(text: string, build: number, name: string): string {
  return text.replace(/(CURRENT_PROJECT_VERSION = )[^;]+;/g, `$1${build};`).replace(/(MARKETING_VERSION = )[^;]+;/g, `$1${name};`);
}
export function packageDirOf(id: string): string {
  return id.split('.').join('/');
}
export function applyIdToJava(text: string, id: string): string {
  return text.replace(/^package\s+[\w.]+;/m, `package ${id};`);
}

// ————————————————————————— lecture / écriture

const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf8');
const write = (root: string, rel: string, text: string): void => writeFileSync(join(root, rel), text);

export function readRelease(root = ROOT): Release {
  const r = JSON.parse(read(root, 'mobile/release.json')) as Partial<Release>;
  if (typeof r.appId !== 'string' || typeof r.appIdConfirmed !== 'boolean' || !Number.isInteger(r.androidVersionCode) || !Number.isInteger(r.iosBuildNumber)) {
    throw new Error('mobile/release.json invalide.');
  }
  return r as Release;
}
const writeRelease = (root: string, r: Release): void => write(root, 'mobile/release.json', `${JSON.stringify(r, null, 2)}\n`);
export const packageVersion = (root = ROOT): string => (JSON.parse(read(root, 'package.json')) as { version: string }).version;

const JAVA_DIR = 'android/app/src/main/java';

export function setAppId(id: string, root = ROOT): void {
  if (!validAppId(id)) throw new Error(`Identifiant invalide : « ${id} » (minuscules, chiffres et _ ; au moins deux segments séparés par des points ; ex. fr.monstudio.polarrift).`);
  const rel = readRelease(root);
  const old = rel.appId;
  write(root, 'android/app/build.gradle', applyIdToGradle(read(root, 'android/app/build.gradle'), id));
  write(root, 'android/app/src/main/res/values/strings.xml', applyIdToStrings(read(root, 'android/app/src/main/res/values/strings.xml'), id));
  write(root, 'ios/App/App.xcodeproj/project.pbxproj', applyIdToPbxproj(read(root, 'ios/App/App.xcodeproj/project.pbxproj'), id));
  write(root, 'capacitor.config.ts', applyIdToCapacitorConfig(read(root, 'capacitor.config.ts'), id));
  // Activité Android : le dossier suit le nom de paquet
  const from = join(root, JAVA_DIR, packageDirOf(old));
  const to = join(root, JAVA_DIR, packageDirOf(id));
  if (old !== id && existsSync(from)) {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    // dossiers parents devenus vides
    for (let d = dirname(from); d !== join(root, JAVA_DIR); d = dirname(d)) {
      if (readdirSync(d).length === 0) rmSync(d, { recursive: true });
      else break;
    }
  }
  const javaFile = join(to, 'MainActivity.java');
  writeFileSync(javaFile, applyIdToJava(readFileSync(javaFile, 'utf8'), id));
  writeRelease(root, { ...rel, appId: id, appIdConfirmed: id !== PLACEHOLDER_ID });
}

export function applyVersion(root = ROOT): { name: string; code: number; build: number } {
  const name = packageVersion(root);
  if (!validVersion(name)) throw new Error(`Version de package.json invalide pour les magasins : « ${name} » (attendu x.y.z).`);
  const rel = readRelease(root);
  write(root, 'android/app/build.gradle', applyVersionToGradle(read(root, 'android/app/build.gradle'), rel.androidVersionCode, name));
  write(root, 'ios/App/App.xcodeproj/project.pbxproj', applyVersionToPbxproj(read(root, 'ios/App/App.xcodeproj/project.pbxproj'), rel.iosBuildNumber, name));
  return { name, code: rel.androidVersionCode, build: rel.iosBuildNumber };
}

export function bump(root = ROOT): Release {
  const rel = readRelease(root);
  const next = { ...rel, androidVersionCode: rel.androidVersionCode + 1, iosBuildNumber: rel.iosBuildNumber + 1 };
  writeRelease(root, next);
  applyVersion(root);
  return next;
}

export interface Report {
  errors: string[];
  pending: string[];
}

/** Cohérence entre mobile/release.json, package.json, le code et les projets natifs ; liste ce qui reste à décider par l'éditeur. */
export function check(root = ROOT): Report {
  const errors: string[] = [];
  const pending: string[] = [];
  const rel = readRelease(root);
  const name = packageVersion(root);
  const gradle = read(root, 'android/app/build.gradle');
  const pbx = read(root, 'ios/App/App.xcodeproj/project.pbxproj');
  const cfg = read(root, 'capacitor.config.ts');
  const grab = (re: RegExp, text: string): string[] => [...text.matchAll(re)].map((m) => m[1]);
  const same = (label: string, values: string[], expected: string): void => {
    if (values.length === 0 || values.some((v) => v !== expected)) errors.push(`${label} : « ${values.join(' / ') || 'absent'} » au lieu de « ${expected} »`);
  };
  same('capacitor.config.ts appId', grab(/appId:\s*'([^']*)'/g, cfg), rel.appId);
  same('Android namespace', grab(/namespace\s*=\s*"([^"]*)"/g, gradle), rel.appId);
  same('Android applicationId', grab(/applicationId\s+"([^"]*)"/g, gradle), rel.appId);
  same('iOS PRODUCT_BUNDLE_IDENTIFIER', grab(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g, pbx), rel.appId);
  same('Android versionCode', grab(/versionCode\s+(\d+)/g, gradle), String(rel.androidVersionCode));
  same('Android versionName', grab(/versionName\s+"([^"]*)"/g, gradle), name);
  same('iOS CURRENT_PROJECT_VERSION', grab(/CURRENT_PROJECT_VERSION = ([^;]+);/g, pbx), String(rel.iosBuildNumber));
  same('iOS MARKETING_VERSION', grab(/MARKETING_VERSION = ([^;]+);/g, pbx), name);
  if (!existsSync(join(root, JAVA_DIR, packageDirOf(rel.appId), 'MainActivity.java'))) errors.push(`MainActivity.java absent du dossier ${packageDirOf(rel.appId)}`);
  // Origines WebView épinglées : doivent correspondre à ce que le serveur du classement doit autoriser
  const host = grab(/hostname:\s*'([^']*)'/g, cfg)[0];
  const aScheme = grab(/androidScheme:\s*'([^']*)'/g, cfg)[0];
  const iScheme = grab(/iosScheme:\s*'([^']*)'/g, cfg)[0];
  const expected = [`${aScheme}://${host}`, `${iScheme}://${host}`];
  if (expected.join() !== NATIVE_APP_ORIGINS.join()) errors.push(`origines WebView du capacitor.config.ts (${expected.join(', ')}) ≠ src/net/origins.ts (${NATIVE_APP_ORIGINS.join(', ')})`);
  if (!rel.appIdConfirmed || isPlaceholderId(rel.appId)) pending.push(`identifiant d'application non choisi (« ${rel.appId} ») : npm run mobile:set-id -- <identifiant>`);
  if (!existsSync(join(root, 'android/keystore.properties')) && !process.env.POLAR_RIFT_KEYSTORE) pending.push('clé de signature Android absente (android/keystore.properties) : voir docs/BUILD_MOBILE.md');
  return { errors, pending };
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'set-id':
      setAppId(arg ?? '');
      console.log(`Identifiant appliqué : ${arg}. Contrôle : npm run mobile:check`);
      break;
    case 'version':
      console.log('Version appliquée :', applyVersion());
      break;
    case 'bump':
      console.log('Numéros de build :', bump());
      break;
    case 'check': {
      // --release : contrôle de PUBLICATION (AAB/IPA) — tout paramètre en attente (identifiant « exemple », clé de signature absente) est bloquant
      const release = process.argv.includes('--release');
      const r = check();
      for (const e of r.errors) console.error(`ERREUR : ${e}`);
      for (const p of r.pending) (release ? console.error : console.log)(`${release ? 'BLOQUANT' : 'EN ATTENTE'} : ${p}`);
      if (r.errors.length === 0) console.log('Configuration mobile cohérente.');
      process.exit(r.errors.length === 0 && !(release && r.pending.length > 0) ? 0 : 1);
      break;
    }
    default:
      console.log('Commandes : set-id <identifiant> | version | bump | check');
  }
}

if (process.argv[1] && /mobile-config\.ts$/.test(process.argv[1])) main();
