/**
 * Test de bout en bout du classement mondial : VRAI serveur (server/index.ts, base SQLite sur disque) + jeu construit avec
 * VITE_LEADERBOARD_URL, piloté dans un vrai navigateur. Usage : npm run build && npm run e2e:classement
 * Vérifie : inscription, tickets, partie rejouée et validée par le serveur, mode hors ligne (résultat en attente), résultat
 * falsifié refusé, parties de démonstration exclues, persistance après redémarrage du serveur, absence de secret dans le jeu.
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright');
  }
}
function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (dir && existsSync(`${base}/${dir}/${sub}`)) return `${base}/${dir}/${sub}`;
  return undefined;
}

const FRONT = 4181;
const API = 8788;
const SECRET = 'e2e-secret-de-signature-des-tickets-0123456789abcdef';
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Construction du jeu avec l'adresse du service (variable publique : aucune clé secrète)
console.log('Construction du jeu configuré pour le classement…');
execSync(`node node_modules/vite/bin/vite.js build --outDir dist-lb`, { stdio: 'ignore', env: { ...process.env, VITE_LEADERBOARD_URL: `http://127.0.0.1:${API}` } });

const dir = mkdtempSync(join(tmpdir(), 'polar-rift-e2e-'));
const procs = [];
function startApi() {
  const p = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    env: { ...process.env, TICKET_SECRET: SECRET, DATABASE_PATH: join(dir, 'lb.sqlite'), ALLOWED_ORIGINS: `http://127.0.0.1:${FRONT}`, PORT: String(API), NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(p);
  return p;
}
async function waitApi() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${API}/api/health`);
      if (r.ok) return;
    } catch { /* démarrage */ }
    await sleep(250);
  }
  throw new Error('serveur de classement non démarré');
}
let api = startApi();
const front = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-lb', '--port', String(FRONT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
procs.push(front);
const cleanup = () => {
  for (const p of procs) p.kill();
  rmSync(dir, { recursive: true, force: true });
  rmSync('dist-lb', { recursive: true, force: true });
};
process.on('exit', cleanup);
process.on('unhandledRejection', (e) => {
  console.error(e);
  process.exit(1);
});
await waitApi();
await sleep(1200);

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|swiftshader|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
const GAME = `http://127.0.0.1:${FRONT}/`;
await page.goto(GAME);
await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.balanceNoticeSeen = 3; a.save.rewardNotice = null; });
const go = async (id) => { await page.evaluate((a) => window.__polarite.showScreen(a), id); await page.waitForTimeout(300); };
// Ouverture du menu comme un joueur : depuis l'accueil (charge le classement)
const openLb = async () => { await go('home'); await page.click('[data-action="leaderboard"]'); await page.waitForTimeout(300); };
const api_ = (path, init) => fetch(`http://127.0.0.1:${API}${path}`, init).then((r) => r.json());

// — Aucune clé ni secret dans le jeu
const bundle = readdirSync('dist-lb/assets').filter((f) => f.endsWith('.js')).map((f) => readFileSync(`dist-lb/assets/${f}`, 'utf8')).join('\n');
check(!bundle.includes(SECRET) && !/TICKET_SECRET/.test(bundle), 'Aucun secret du serveur dans le jeu (bundle)');
check(bundle.includes(`127.0.0.1:${API}`), 'Le jeu connaît l’adresse publique du service (variable de construction)');

// — Menu Classement : service joignable, vide, invitation à créer un profil
await openLb();
await page.waitForSelector('.nick-form', { timeout: 15000 });
let txt = await page.locator('#screen').innerText();
check(/Aucun résultat validé/.test(txt) && /Choisissez un pseudo/.test(txt), 'Classement vide réel (aucune ligne fictive), invitation à choisir un pseudo');
await page.screenshot({ path: 'screenshots/80-classement-vide.png' });

// — Pseudo invalide puis valide ; identité stockée localement
await page.fill('#nick-input', 'x');
await page.click('[data-form="lb-register"] button');
await page.waitForSelector('#nick-msg');
check(/invalide/i.test(await page.locator('#nick-msg').innerText()), 'Pseudo invalide refusé');
await page.fill('#nick-input', 'AxelTest');
await page.click('[data-form="lb-register"] button');
await page.waitForSelector('.lb-id__name', { timeout: 15000 });
check((await page.locator('.lb-id__name').innerText()) === 'AxelTest', 'Profil créé avec le pseudo choisi');
const ident = await page.evaluate(() => JSON.parse(localStorage.getItem('polarite.classement.identite')));
check(ident && ident.playerId && ident.token && ident.nickname === 'AxelTest', 'Identité stable conservée dans le navigateur (hors sauvegarde de progression)');
await page.waitForFunction(() => (JSON.parse(localStorage.getItem('polarite.classement.tickets') || '[]')).length >= 2, null, { timeout: 15000 });
check(true, 'Tickets de partie reçus du serveur (utilisables hors ligne)');

// — Partie réelle de Survie (non démo) : rejouée et validée par le serveur
async function playSurvivalToDeath() {
  await go('home');
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(400);
  // Entrées réelles : inversions à intervalles variés via la session, puis collision
  await page.evaluate(() => {
    const s = window.__polarite.session;
    for (let i = 0; i < 4000 && s.sim.state === 'running'; i++) {
      if (i % 5 === 2) s.action();
      for (let k = 0; k < 12 && s.sim.state === 'running'; k++) s.sim.step();
    }
    for (let i = 0; i < 120 * 600 && s.sim.state === 'running'; i++) s.sim.step();
  });
  const info = await page.evaluate(() => { const s = window.__polarite.session.sim; return { time: s.time, score: s.scoring.score, flips: s.flipLog.length, assisted: s.assisted }; });
  await page.waitForSelector('[data-replay]', { timeout: 15000 });
  return info;
}
const run1 = await playSurvivalToDeath();
check(run1.flips >= 1 && !run1.assisted, `Partie jouée avec ${run1.flips} inversions enregistrées, non assistée (${run1.time.toFixed(1)} s)`);
await page.waitForFunction(() => /validé|non validé|en attente/.test(document.querySelector('#lb-status')?.textContent ?? ''), null, { timeout: 20000 });
txt = await page.locator('#lb-status').innerText();
check(/Classement mondial : validé — rang 1/.test(txt), `Résultat validé par le serveur : « ${txt.replace(/\s+/g, ' ')} »`);
await page.screenshot({ path: 'screenshots/81-resultat-classement.png' });
let lb = await api_('/api/leaderboard');
check(lb.total === 1 && lb.entries[0].nickname === 'AxelTest' && Math.abs(lb.entries[0].time - run1.time) < 1e-6 && lb.entries[0].score === run1.score, 'Le serveur a rejoué la partie : mêmes durée et score que le jeu');

// — Menu : top, rang, résultat récent
await openLb();
await page.waitForSelector('.lb-row--you', { timeout: 15000 });
txt = await page.locator('#screen').innerText();
check(/AxelTest/.test(txt) && /1 \/ 1/.test(txt) && /Validé par le serveur/.test(txt), 'Menu Classement : ligne du joueur, rang 1 / 1, résultat validé');
await page.screenshot({ path: 'screenshots/82-classement.png' });

// — Hors ligne : le jeu reste jouable, résultat en attente, envoyé au retour
await context.setOffline(true);
const run2 = await playSurvivalToDeath();
await page.waitForFunction(() => /en attente/.test(document.querySelector('#lb-status')?.textContent ?? ''), null, { timeout: 20000 });
check(/en attente/.test(await page.locator('#lb-status').innerText()) && /pas encore validé/.test(await page.locator('#lb-status').innerText()), 'Hors ligne : « en attente », pas encore validé');
check((await page.evaluate(() => JSON.parse(localStorage.getItem('polarite.classement.attente')).length)) >= 1, 'Hors ligne : le résultat est conservé localement');
await page.screenshot({ path: 'screenshots/83-resultat-hors-ligne.png' });
await context.setOffline(false);
await openLb();
await page.waitForFunction(() => document.querySelector('.lb-table') && !/En attente/.test(document.querySelector('.lb-pending-list')?.textContent ?? ''), null, { timeout: 20000 });
lb = await api_('/api/leaderboard');
check(lb.total === 1 && lb.entries[0].time >= Math.min(run1.time, run2.time) - 1e-6, 'Retour en ligne : résultat envoyé et validé, meilleur résultat conservé');

// — Résultat falsifié : refusé par le serveur, jamais classé
await context.setOffline(true);
await playSurvivalToDeath();
await page.waitForFunction(() => /en attente/.test(document.querySelector('#lb-status')?.textContent ?? ''), null, { timeout: 20000 });
await page.evaluate(() => {
  const k = 'polarite.classement.attente';
  const list = JSON.parse(localStorage.getItem(k));
  const last = list[list.length - 1];
  last.submission.claimed.time += 500;
  last.submission.claimed.score *= 9;
  localStorage.setItem(k, JSON.stringify(list));
});
const before = (await api_('/api/leaderboard')).entries[0];
await context.setOffline(false);
await openLb();
await page.waitForFunction(() => /Non validé/.test(document.querySelector('.lb-pending-list')?.textContent ?? ''), null, { timeout: 20000 });
check(true, 'Résultat falsifié : affiché « Non validé »');
const after = (await api_('/api/leaderboard')).entries[0];
check(after.time === before.time && after.score === before.score, 'Résultat falsifié : jamais classé');

// — Parties de démonstration : exclues du classement
const demo = await context.newPage();
await demo.goto(`${GAME}?demo`);
await demo.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
await demo.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.balanceNoticeSeen = 3; a.showScreen('home'); });
await demo.click('[data-action="survival"]');
await demo.waitForTimeout(400);
await demo.evaluate(() => { const s = window.__polarite.session.sim; for (let i = 0; i < 120 * 600 && s.state === 'running'; i++) s.step(); });
await demo.waitForSelector('[data-replay]', { timeout: 15000 });
txt = await demo.locator('#lb-status').innerText();
check(/non éligible/.test(txt), `Partie de démonstration : « ${txt.replace(/\s+/g, ' ')} »`);
const totalAfterDemo = (await api_('/api/leaderboard')).total;
check(totalAfterDemo === 1, 'Partie de démonstration : jamais envoyée au serveur');
await demo.close();

// — Persistance côté serveur : redémarrage du serveur, mêmes données
api.kill();
await sleep(500);
api = startApi();
await waitApi();
lb = await api_('/api/leaderboard');
check(lb.total === 1 && lb.entries[0].nickname === 'AxelTest', 'Persistance : le classement survit au redémarrage du serveur');
const bal = await api_('/api/balances');
check(bal.versions.length === 1 && bal.current === bal.versions[0].balance, 'Résultats séparés par version d’équilibrage');

// — Sans profil ni service : le jeu fonctionne et rien n'est inventé (jeu construit sans URL)
check(errors.length === 0, `Aucune erreur console (classement)${errors.length ? ' : ' + errors.join(' | ').slice(0, 300) : ''}`);
await browser.close();
procs.forEach((p) => p.kill());
cleanup();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTous les contrôles du classement sont passés.');
process.exit(failures.length ? 1 : 0);
