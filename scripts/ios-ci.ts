/**
 * Garde-fous de la compilation iOS dans Codemagic (voir codemagic.yaml et docs/CODEMAGIC_IOS.md). Aucun secret ici : seulement des contrôles.
 *
 *   tsx scripts/ios-ci.ts guard-signed            échoue tant que le Bundle ID définitif n'est pas fourni (variable BUNDLE_ID) ET appliqué au dépôt
 *   tsx scripts/ios-ci.ts next-build <dernier>    affiche le prochain numéro de build : max(mobile/release.json, dernier build TestFlight + 1)
 *   tsx scripts/ios-ci.ts set-build <numéro>      applique ce numéro de build au projet Xcode DE L'ESPACE DE TRAVAIL (jamais commité, release.json inchangé)
 *
 * Le Bundle ID n'est jamais inventé : la compilation signée refuse « com.example.* », un identifiant différent de celui du dépôt, ou non confirmé.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyVersionToPbxproj, check, isPlaceholderId, packageVersion, readRelease, validAppId } from './mobile-config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PBX = 'ios/App/App.xcodeproj/project.pbxproj';

/** Erreurs bloquantes de la compilation signée (liste vide = on peut signer). `bundleId` : valeur de la variable Codemagic BUNDLE_ID. */
export function guardSigned(bundleId: string | undefined, root = ROOT): string[] {
  const errors: string[] = [];
  const rel = readRelease(root);
  const id = (bundleId ?? '').trim();
  if (id === '') errors.push('Variable BUNDLE_ID absente (groupe « polar_rift_ios » de Codemagic) : renseignez le Bundle ID Apple définitif.');
  else if (!validAppId(id)) errors.push(`BUNDLE_ID invalide : « ${id} » (minuscules, chiffres et _ ; au moins deux segments).`);
  else if (isPlaceholderId(id)) errors.push(`BUNDLE_ID provisoire refusé : « ${id} ».`);
  if (!rel.appIdConfirmed || isPlaceholderId(rel.appId)) errors.push(`Le dépôt utilise encore l'identifiant provisoire « ${rel.appId} » : lancez « npm run mobile:set-id -- <Bundle ID> » puis commitez (mobile/release.json, projet Xcode, Android, capacitor.config.ts).`);
  else if (id !== '' && id !== rel.appId) errors.push(`BUNDLE_ID (« ${id} ») ≠ identifiant du dépôt (« ${rel.appId} »).`);
  const pbx = readFileSync(join(root, PBX), 'utf8');
  const inProject = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
  if (id !== '' && (inProject.length === 0 || inProject.some((v) => v !== id))) errors.push(`Le projet Xcode porte « ${inProject.join(' / ') || 'aucun identifiant'} » au lieu de « ${id} ».`);
  errors.push(...check(root).errors.map((e) => `Cohérence mobile : ${e}`));
  return errors;
}

/** Prochain numéro de build : toujours strictement supérieur au dernier build envoyé à TestFlight, jamais inférieur à mobile/release.json. */
export function nextBuildNumber(local: number, latestTestFlight: number | null): number {
  if (!Number.isInteger(local) || local < 1) throw new Error(`Numéro de build local invalide : ${local}`);
  if (latestTestFlight !== null && (!Number.isInteger(latestTestFlight) || latestTestFlight < 0)) throw new Error(`Dernier numéro de build TestFlight invalide : ${latestTestFlight}`);
  return Math.max(local, (latestTestFlight ?? 0) + 1);
}

/** Applique le numéro de build (et la version de package.json) au projet Xcode de l'espace de travail. */
export function setBuild(build: number, root = ROOT): void {
  if (!Number.isInteger(build) || build < 1) throw new Error(`Numéro de build invalide : ${build}`);
  const file = join(root, PBX);
  writeFileSync(file, applyVersionToPbxproj(readFileSync(file, 'utf8'), build, packageVersion(root)));
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'guard-signed': {
      const errors = guardSigned(process.env.BUNDLE_ID);
      for (const e of errors) console.error(`BLOQUANT : ${e}`);
      if (errors.length === 0) console.log(`Garde de signature OK : Bundle ID ${process.env.BUNDLE_ID}.`);
      process.exit(errors.length === 0 ? 0 : 1);
      break;
    }
    case 'next-build': {
      const latest = arg === undefined || arg.trim() === '' ? null : Number(arg);
      console.log(nextBuildNumber(readRelease().iosBuildNumber, latest === null || Number.isNaN(latest) ? null : latest));
      break;
    }
    case 'set-build':
      setBuild(Number(arg));
      console.log(`Numéro de build appliqué (espace de travail) : ${arg}`);
      break;
    default:
      console.log('Commandes : guard-signed | next-build <dernier> | set-build <numéro>');
  }
}

if (process.argv[1] && /ios-ci\.ts$/.test(process.argv[1])) main();
