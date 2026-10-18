/**
 * Configuration publicitaire des applications natives (AdMob + UMP) : UNE source, mobile/ads.json, lue par Gradle (Android), appliquée à l'Info.plist
 * (iOS) et contrôlée ici. Les identifiants publicitaires sont PUBLICS (aucun secret) ; la signature SSV et ses clés restent côté service.
 *
 *   npm run mobile:ads                 contrôle la configuration (mode, identifiants, réglages de debug)
 *   npm run mobile:ads -- --release    contrôle de publication : échoue en mode « demo », avec un identifiant d'application provisoire, une association
 *                                      de blocs non confirmée, des appareils de test ou une géographie de debug
 *   npm run mobile:ads -- --apply      écrit dans ios/App/App/Info.plist les valeurs iOS (GADApplicationIdentifier, SKAdNetwork, bloc PolarRiftAds)
 *
 * Modes : « demo » (défaut) = identifiants de démonstration officiels de Google, aucun identifiant du compte n'est utilisé ; « live » = identifiants
 * du compte (ID d'application AdMob requis, association des blocs à confirmer) ; avec des appareils de test déclarés, l'application affiche alors des
 * annonces de test et permet de vérifier le message de consentement publié sur le compte.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Identifiants de DÉMONSTRATION officiels de Google (annonce récompensée) et ID d'application d'exemple : jamais utilisables en production. */
export const GOOGLE_DEMO = {
  android: { appId: 'ca-app-pub-3940256099942544~3347511713', rewardedUnitId: 'ca-app-pub-3940256099942544/5224354917' },
  ios: { appId: 'ca-app-pub-3940256099942544~1458002511', rewardedUnitId: 'ca-app-pub-3940256099942544/1712485313' },
} as const;
const DEMO_PUBLISHER = '3940256099942544';

export type AdsMode = 'demo' | 'live';
export type Platform = 'android' | 'ios';
export type UmpGeography = 'off' | 'eea' | 'not_eea';

export interface AdsConfig {
  mode: AdsMode;
  /** L'association bloc ↔ application a été confirmée dans AdMob (obligatoire avant toute activation réelle). */
  unitAssociationConfirmed: boolean;
  /** Appareils de test déclarés (identifiants lus dans le journal du téléphone) : annonces de test et débogage du consentement. */
  testDeviceIds: string[];
  umpDebugGeography: UmpGeography;
  android: { appId: string; rewardedUnitId: string };
  ios: { appId: string; rewardedUnitId: string };
}

export interface ResolvedAds {
  mode: AdsMode;
  appId: string;
  rewardedUnitId: string;
  testDeviceIds: string[];
  umpDebugGeography: UmpGeography;
}

export const APP_ID_RE = /^ca-app-pub-\d{16}~\d{10}$/;
export const UNIT_ID_RE = /^ca-app-pub-\d{16}\/\d{10}$/;
const publisherOf = (id: string): string => /^ca-app-pub-(\d{16})/.exec(id)?.[1] ?? '';

export function loadAdsConfig(path = resolve(ROOT, 'mobile/ads.json')): AdsConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as AdsConfig;
}

/** Valeurs réellement utilisées par une plateforme : démonstration Google en mode « demo », identifiants du compte en mode « live ». */
export function resolveAds(cfg: AdsConfig, platform: Platform): ResolvedAds {
  const live = cfg.mode === 'live';
  return {
    mode: cfg.mode,
    appId: live ? cfg[platform].appId : GOOGLE_DEMO[platform].appId,
    rewardedUnitId: live ? cfg[platform].rewardedUnitId : GOOGLE_DEMO[platform].rewardedUnitId,
    testDeviceIds: cfg.testDeviceIds,
    umpDebugGeography: cfg.umpDebugGeography,
  };
}

/**
 * Contrôle de la configuration. Erreurs = la compilation doit échouer. `release` : compilation destinée à la production (plus stricte : aucune valeur
 * provisoire, aucun réglage de debug). Les mêmes règles sont reprises dans android/app/build.gradle (tâche verifyAdsConfig).
 */
export function checkAdsConfig(cfg: AdsConfig, release: boolean): string[] {
  const errors: string[] = [];
  if (cfg.mode !== 'demo' && cfg.mode !== 'live') errors.push('mode : « demo » ou « live » attendu.');
  if (!['off', 'eea', 'not_eea'].includes(cfg.umpDebugGeography)) errors.push('umpDebugGeography : « off », « eea » ou « not_eea » attendu.');
  if (!Array.isArray(cfg.testDeviceIds) || cfg.testDeviceIds.some((d) => typeof d !== 'string' || !/^[A-Fa-f0-9-]{8,64}$/.test(d))) errors.push('testDeviceIds : identifiants d’appareil (hexadécimal) attendus.');
  if (cfg.mode === 'live') {
    for (const p of ['android', 'ios'] as const) {
      const { appId, rewardedUnitId } = cfg[p];
      if (!APP_ID_RE.test(appId) || publisherOf(appId) === DEMO_PUBLISHER) errors.push(`${p}.appId : ID d’application AdMob réel attendu (ca-app-pub-…~…), à récupérer dans AdMob ; jamais celui d’un bloc ni celui de démonstration.`);
      if (!UNIT_ID_RE.test(rewardedUnitId) || publisherOf(rewardedUnitId) === DEMO_PUBLISHER) errors.push(`${p}.rewardedUnitId : identifiant de bloc récompensé réel attendu (ca-app-pub-…/…).`);
      else if (APP_ID_RE.test(appId) && publisherOf(appId) !== publisherOf(rewardedUnitId)) errors.push(`${p} : le bloc et l’application n’appartiennent pas au même éditeur AdMob.`);
    }
    if (cfg.unitAssociationConfirmed !== true) errors.push('unitAssociationConfirmed : l’association des blocs à leur application doit être confirmée dans AdMob avant toute activation réelle.');
  }
  if (release) {
    if (cfg.mode !== 'live') errors.push('Production : le mode « demo » (identifiants de démonstration Google) est interdit ; passer en « live » avec les identifiants du compte.');
    if (cfg.umpDebugGeography !== 'off') errors.push('Production : umpDebugGeography doit être « off » (débogage du consentement).');
    if (cfg.testDeviceIds.length > 0) errors.push('Production : testDeviceIds doit être vide (appareils de test).');
  }
  return errors;
}

// ————————————————————————— iOS : Info.plist (bloc géré, délimité par des marqueurs)

export const PLIST_BEGIN = '<!-- polar-rift-ads:begin (généré par npm run mobile:ads -- --apply, ne pas modifier à la main) -->';
export const PLIST_END = '<!-- polar-rift-ads:end -->';
const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function adsPlistBlock(cfg: AdsConfig): string {
  const r = resolveAds(cfg, 'ios');
  const devices = r.testDeviceIds.map((d) => `\t\t\t<string>${xml(d)}</string>`).join('\n');
  return [
    `\t${PLIST_BEGIN}`,
    '\t<key>GADApplicationIdentifier</key>',
    `\t<string>${xml(r.appId)}</string>`,
    '\t<key>SKAdNetworkItems</key>',
    '\t<array>',
    '\t\t<dict>',
    '\t\t\t<key>SKAdNetworkIdentifier</key>',
    '\t\t\t<string>cstr6suwn9.skadnetwork</string>',
    '\t\t</dict>',
    '\t</array>',
    '\t<key>PolarRiftAds</key>',
    '\t<dict>',
    '\t\t<key>mode</key>',
    `\t\t<string>${r.mode}</string>`,
    '\t\t<key>rewardedUnitId</key>',
    `\t\t<string>${xml(r.rewardedUnitId)}</string>`,
    '\t\t<key>umpDebugGeography</key>',
    `\t\t<string>${r.umpDebugGeography}</string>`,
    '\t\t<key>testDeviceIds</key>',
    devices ? `\t\t<array>\n${devices}\n\t\t</array>` : '\t\t<array/>',
    '\t</dict>',
    `\t${PLIST_END}`,
  ].join('\n');
}

/** Insère ou remplace le bloc publicitaire de l'Info.plist (juste avant la balise </dict> finale). */
export function applyAdsToPlist(text: string, cfg: AdsConfig): string {
  const block = adsPlistBlock(cfg);
  const re = new RegExp(`\\t?${PLIST_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${PLIST_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (re.test(text)) return text.replace(re, block);
  const i = text.lastIndexOf('</dict>');
  if (i < 0) throw new Error('Info.plist : balise </dict> introuvable');
  return `${text.slice(0, i)}${block}\n${text.slice(i)}`;
}

export function plistIsCurrent(text: string, cfg: AdsConfig): boolean {
  return text.includes(adsPlistBlock(cfg));
}

// ————————————————————————— CLI

function main(): void {
  const args = process.argv.slice(2);
  const release = args.includes('--release');
  const cfg = loadAdsConfig();
  const errors = checkAdsConfig(cfg, release);
  const plistPath = resolve(ROOT, 'ios/App/App/Info.plist');
  if (args.includes('--apply')) {
    if (errors.length === 0 || !release) writeFileSync(plistPath, applyAdsToPlist(readFileSync(plistPath, 'utf8'), cfg));
    console.log('Info.plist iOS mis à jour depuis mobile/ads.json.');
  }
  if (existsSync(plistPath) && !plistIsCurrent(readFileSync(plistPath, 'utf8'), cfg)) errors.push('ios/App/App/Info.plist n’est pas à jour avec mobile/ads.json : npm run mobile:ads -- --apply');
  console.log(`Publicité (AdMob + UMP) : mode « ${cfg.mode} »${release ? ', contrôle de PUBLICATION' : ''}.`);
  if (cfg.mode === 'demo') console.log('  Identifiants de démonstration Google : le message de consentement publié sur le compte ne peut pas être vérifié dans ce mode.');
  for (const e of errors) console.error(`  ✘ ${e}`);
  if (errors.length > 0) process.exit(1);
  console.log('  ✔ configuration cohérente');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
