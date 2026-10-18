import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/config/campaign';
import { BALANCE_VERSION } from '../src/config/version';
import { applyMission } from '../src/campaign/progress';
import { backAction } from '../src/platform/native';
import { MemoryStore, defaultSave, loadSave, writeSave } from '../src/save/save';
import * as C from '../src/ui/campaignScreens';
import * as S from '../src/ui/screens';
import { check, isPlaceholderId } from '../scripts/mobile-config';
import type { MissionReport } from '../src/campaign/simulation';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

const report = (missionId: number): MissionReport => ({
  missionId,
  outcome: 'success',
  time: 100,
  beacons: 0,
  cycles: 0,
  maxMultiplier: 1,
  shieldUsed: false,
  objectsCollected: 0,
  objectsMissed: 0,
  stars: { main: true, challenge: false },
});

describe('V1 — isolation du gameplay (mêmes règles sur le web, Android et iOS)', () => {
  it('la simulation, les modes, la campagne et la session n’importent ni rendu, ni interface, ni audio, ni réseau, ni couche native, ni Capacitor', () => {
    const files = ['src/sim', 'src/modes', 'src/core', 'src/campaign', 'src/game'].flatMap(walk);
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const imports = [...readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) expect(i, `${f} importe ${i}`).not.toMatch(/(^|\/)(render|ui|audio|ambience|platform|net|app)(\/|$)|@capacitor|phaser/);
    }
  });

  it('BALANCE_VERSION = 4 (Survie à phases) : records de la v3 archivés', () => {
    expect(BALANCE_VERSION).toBe(4);
  });
});

describe('V1 — accueil et campagne', () => {
  const order = (html: string): string[] => [...html.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]).filter((a) => ['survival', 'campaign', 'daily', 'cosmetics', 'achievements', 'leaderboard', 'options'].includes(a));

  it('« Classement » : masqué sans service configuré, présent (avant Options) avec un service ; le reste de l’accueil est identique', () => {
    const save = defaultSave();
    expect(order(S.homeScreen(save, '2026-10-12', false, false, undefined, false))).toEqual(['survival', 'campaign', 'daily', 'cosmetics', 'achievements', 'options']);
    expect(order(S.homeScreen(save, '2026-10-12', false, false, undefined, true))).toEqual(['survival', 'campaign', 'daily', 'cosmetics', 'achievements', 'leaderboard', 'options']);
  });

  it('les 10 niveaux : un seul ouvert au départ, la réussite du niveau n ouvre le niveau n + 1 et aucun autre', () => {
    expect(MISSIONS).toHaveLength(10);
    const save = defaultSave();
    const locked = (): number => (C.chapterScreen(save).match(/<button class="mission-node[^"]*"[^>]*disabled/g) ?? []).length;
    expect(locked()).toBe(MISSIONS.length - 1);
    for (let id = 1; id <= MISSIONS.length; id++) {
      applyMission(save, report(id));
      expect(locked(), `après le niveau ${id}`).toBe(Math.max(0, MISSIONS.length - 1 - id));
    }
    expect(save.campaign.chapterComplete).toBe(true);
  });
});

describe('V1 — installation neuve et mise à jour', () => {
  it('installation neuve : sauvegarde par défaut, statut « nouveau », aucun succès ni récompense, première écriture relisible', () => {
    const store = new MemoryStore();
    const res = loadSave(store);
    expect(res.status).toBe('new');
    expect(res.data.stats.totalRuns).toBe(0);
    expect(res.data.wallet.shards).toBe(0);
    expect(Object.keys(res.data.achievements)).toHaveLength(0);
    writeSave(store, res.data);
    expect(loadSave(store).status).not.toBe('new');
    expect(loadSave(store).data).toEqual(res.data);
  });
});

describe('V1 — bouton Retour d’Android (décision pure)', () => {
  it('partie ou menu = Échap ; résultat = accueil ; accueil sans partie = fermeture', () => {
    expect(backAction(true, null)).toBe('escape');
    expect(backAction(true, 'pause')).toBe('escape');
    expect(backAction(false, 'options')).toBe('escape');
    expect(backAction(false, 'story')).toBe('escape');
    expect(backAction(false, 'result')).toBe('home');
    expect(backAction(false, 'campaign-result')).toBe('home');
    expect(backAction(false, 'home')).toBe('exit');
    expect(backAction(false, null)).toBe('exit');
  });
});

describe('V1 — publication : aucune configuration « exemple » ne passe pour publiable', () => {
  it('identifiants « exemple » reconnus', () => {
    for (const id of ['com.example.polarrift', 'org.example.app', 'net.example']) expect(isPlaceholderId(id), id).toBe(true);
    for (const id of ['fr.monstudio.polarrift', 'io.github.axel.polarrift', 'com.exemple.polarrift']) expect(isPlaceholderId(id), id).toBe(false);
  });

  it('l’état actuel du dépôt est cohérent mais NON publiable : identifiant et clé de signature en attente', () => {
    const r = check(process.cwd());
    expect(r.errors).toEqual([]);
    expect(r.pending.length).toBeGreaterThanOrEqual(1);
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    expect(/applicationId\s+"com\.example\./.test(gradle) === r.pending.some((p) => p.includes('identifiant'))).toBe(true);
  });

  it('le script de construction de l’AAB exécute le contrôle de publication avant tout', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['mobile:android:aab']).toMatch(/^npm run mobile:check -- --release && /);
  });
});

describe('V1 — dépôt : aucun secret ni clé', () => {
  const tracked = (): string[] => {
    const out: string[] = [];
    const visit = (d: string): void => {
      for (const f of readdirSync(d)) {
        if (['node_modules', '.git', 'dist', 'dist-native', 'dist-lb', 'dist-beta', 'screenshots', 'data'].includes(f)) continue;
        const p = join(d, f);
        if (statSync(p).isDirectory()) visit(p);
        else out.push(p);
      }
    };
    visit('.');
    return out;
  };

  it('aucun fichier de clé, de profil de signature ni de secret d’environnement', () => {
    for (const f of tracked()) expect(f, f).not.toMatch(/\.(jks|keystore|p12|pem|mobileprovision)$|(^|\/)keystore\.properties$|(^|\/)\.env(\.(?!.*example)[^/]*)?$|google-services\.json$|GoogleService-Info\.plist$/);
  });

  it('aucun jeton ni clé privée dans le code et les documents', () => {
    const textual = tracked().filter((f) => /\.(ts|mjs|json|md|yml|yaml|gradle|xml|plist|swift|java|css|html|properties|example)$/.test(f) && !f.endsWith('package-lock.json') && f !== 'tests/v1-regression.test.ts' && !f.startsWith('android/app/src/main/assets/public') && !f.startsWith('ios/App/App/public'));
    for (const f of textual) expect(readFileSync(f, 'utf8'), f).not.toMatch(/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9]{24,}|AKIA[0-9A-Z]{16}/);
  });

  it('les projets natifs ne déclarent aucun service tiers non autorisé : seuls AdMob + UMP (plugin local polar-rift-ads) sont permis ; ni statistiques, ni médiation, ni achats', () => {
    const gradle = readFileSync('android/app/build.gradle', 'utf8') + readFileSync('android/app/capacitor.build.gradle', 'utf8');
    expect(gradle).not.toMatch(/firebase|play-services-ads|billing|crashlytics|analytics|appsflyer|adjust/i);
    // Le seul SDK publicitaire est celui du plugin local, avec le seul SDK de consentement
    const plugin = readFileSync('plugins/polar-rift-ads/android/build.gradle', 'utf8') + readFileSync('plugins/polar-rift-ads/Package.swift', 'utf8');
    expect(plugin).not.toMatch(/firebase|crashlytics|analytics|appsflyer|adjust|mediation|adapter|billing/i);
    expect(plugin).toContain('play-services-ads');
    expect(plugin).toContain('user-messaging-platform');
    expect(existsSync('android/app/google-services.json')).toBe(false);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((d) => d.startsWith('@capacitor/')).sort()).toEqual(['@capacitor/android', '@capacitor/app', '@capacitor/core', '@capacitor/ios', '@capacitor/splash-screen']);
    expect(Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@capacitor/') && /ads|admob|billing|purchase/i.test(d))).toEqual(['polar-rift-ads']);
  });
});
