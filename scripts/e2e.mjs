/**
 * Vérification de bout en bout dans un vrai navigateur (Chromium via Playwright).
 * Usage : npm run build && npm run e2e
 * Playwright n'est pas une dépendance du projet : le script utilise une installation locale ou globale.
 * Captures d'écran dans screenshots/.
 */
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return createRequire(`${root}/`)('playwright');
  }
}

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
    const p = `${base}/${dir}/${sub}`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

const PORT = 4179;
const URL = `http://127.0.0.1:${PORT}/`;
mkdirSync('screenshots', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('serveur non démarré')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
};

async function newPage(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr ?? 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    // Les messages du pilote graphique logiciel du navigateur de test ne concernent pas le jeu
    if (/GroupMarkerNotSet|GL Driver Message|swiftshader/i.test(m.text())) return;
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requête échouée : ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} : ${r.url()}`);
  });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="levels"]'));
  return { page, context, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const app = window.__polarite;
    const s = app.session;
    return s
      ? { phase: s.phase, time: s.sim.time, flips: s.sim.flips, dir: s.sim.dir, angle: s.sim.angle, simState: s.sim.state, score: s.sim.scoring.score, hazards: s.sim.hazards.length }
      : null;
  });

// ————————————————————————————————————————————— Bureau (paysage)
{
  const { page, context, errors } = await newPage({ width: 1280, height: 800 });
  await page.screenshot({ path: 'screenshots/01-accueil-bureau.png' });

  // Niveaux
  await page.click('[data-action="levels"]');
  await page.screenshot({ path: 'screenshots/02-niveaux.png' });
  check((await page.locator('.level-card:disabled').count()) === 11, 'Seul le niveau 1 est débloqué au départ');
  await page.click('[data-action="play-level"][data-level="1"]');
  await page.waitForTimeout(300);
  let st = await state(page);
  check(st && st.phase === 'running', 'Le niveau 1 démarre');

  // Inversion à l'Espace, répétition ignorée
  const before = await state(page);
  await page.keyboard.down('Space');
  await page.waitForTimeout(50);
  await page.keyboard.up('Space');
  await page.waitForTimeout(50);
  st = await state(page);
  check(st.flips === before.flips + 1 && st.dir === -before.dir, 'Espace inverse exactement une fois');

  // Clic dans l'aire de jeu
  await page.mouse.click(640, 500);
  await page.waitForTimeout(50);
  st = await state(page);
  check(st.flips === before.flips + 2, 'Un clic dans l’arène inverse');

  // Le bouton pause n'inverse pas
  const flipsBeforePause = st.flips;
  await page.click('#btn-pause');
  await page.waitForTimeout(100);
  st = await state(page);
  check(st.phase === 'paused' && st.flips === flipsBeforePause, 'Le bouton pause met en pause sans inverser');
  await page.screenshot({ path: 'screenshots/03-pause.png' });
  const tPaused = st.time;
  await page.waitForTimeout(800);
  st = await state(page);
  check(Math.abs(st.time - tPaused) < 1e-9, 'Le temps actif ne progresse pas en pause');

  // Reprise avec compte à rebours
  await page.click('[data-action="resume"]');
  await page.waitForTimeout(150);
  st = await state(page);
  check(st.phase === 'countdown' && Math.abs(st.time - tPaused) < 1e-9, 'Reprise : compte à rebours sans avancer le temps');
  await page.screenshot({ path: 'screenshots/04-compte-a-rebours.png' });
  await page.waitForTimeout(1800);
  st = await state(page);
  check(st.phase === 'running' && st.time > tPaused, 'La partie reprend après le compte à rebours');

  // Échap
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  st = await state(page);
  check(st.phase === 'paused', 'Échap met en pause');

  // Perte de visibilité simulée
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  st = await state(page);
  check(st.phase === 'paused', 'Onglet masqué : pause automatique');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  st = await state(page);
  check(st.phase === 'paused', 'Retour sur l’onglet : la reprise reste volontaire');

  await page.click('[data-action="resume"]');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: 'screenshots/05-partie-niveau1.png' });

  // Mort forcée : vitesse de jeu accélérée en laissant le vaisseau sans contrôle, puis résultat
  await page.evaluate(() => {
    const s = window.__polarite.session;
    // Accélère la simulation sans joueur jusqu'à la collision (max 90 s)
    for (let i = 0; i < 120 * 90 && s.sim.state === 'running'; i++) s.sim.step();
  });
  await page.waitForTimeout(1500);
  const resultShown = await page.locator('[data-replay]').count();
  check(resultShown === 1, 'Écran de résultat affiché après la fin de partie');
  await page.screenshot({ path: 'screenshots/06-resultat-niveau.png' });
  check(await page.locator('[data-replay]').isEnabled(), 'Rejouer est actif après la courte protection');

  // Relance en une action, plusieurs fois (fuites)
  for (let i = 0; i < 5; i++) {
    await page.click('[data-replay]');
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const s = window.__polarite.session;
      for (let k = 0; k < 120 * 90 && s.sim.state === 'running'; k++) s.sim.step();
    });
    await page.waitForTimeout(1400);
  }
  st = await state(page);
  check(st && st.phase === 'over', 'Relances successives sans blocage');

  // Survie
  await page.click('[data-action="home"], [data-action="levels"]');
  await page.evaluate(() => window.__polarite.showScreen('home'));
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'screenshots/07-survie.png' });
  st = await state(page);
  check(st.phase === 'running' && st.time > 3, 'La Survie se joue');
  await page.evaluate(() => {
    const s = window.__polarite.session;
    for (let i = 0; i < 120 * 600 && s.sim.state === 'running'; i++) s.sim.step();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/08-resultat-survie.png' });
  check((await page.locator('[data-replay]').count()) === 1, 'Résultat de Survie affiché');

  // Défi quotidien
  await page.click('[data-action="home"]');
  await page.click('[data-action="daily"]');
  await page.screenshot({ path: 'screenshots/09-defi.png' });
  await page.click('[data-action="play-daily"]');
  await page.waitForTimeout(2500);
  st = await state(page);
  check(st.phase === 'running', 'Le défi quotidien se joue');
  await page.keyboard.press('Escape');
  await page.click('[data-action="quit"]');

  // Apparences et options
  await page.click('[data-action="skins"]');
  await page.screenshot({ path: 'screenshots/10-apparences.png', fullPage: true });
  await page.click('[data-action="home"]');
  await page.click('[data-action="options"]');
  await page.click('[data-action="toggle-sound"]');
  const muted = await page.evaluate(() => window.__polarite.save.options.muted);
  check(muted === true, 'Option son : coupure enregistrée');
  await page.screenshot({ path: 'screenshots/11-options.png' });
  await page.click('[data-action="ask-reset"]');
  await page.screenshot({ path: 'screenshots/12-confirmation.png' });
  await page.click('[data-action="options"]');

  // Sauvegarde persistée après rechargement
  await page.reload();
  await page.waitForFunction(() => !!window.__polarite);
  const persisted = await page.evaluate(() => window.__polarite.save.options.muted);
  check(persisted === true, 'Options conservées après rechargement');

  // Sauvegarde corrompue
  await page.evaluate(() => localStorage.setItem('polarite.save', '{corrompu'));
  await page.reload();
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="levels"]'));
  check(true, 'Démarrage malgré une sauvegarde corrompue');

  check(errors.length === 0, `Aucune erreur console ni requête manquante (bureau)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ————————————————————————————————————————————— Mobile portrait (tactile)
{
  const { page, context, errors } = await newPage({ width: 390, height: 844 }, { touch: true, dpr: 3 });
  await page.screenshot({ path: 'screenshots/20-accueil-mobile.png' });
  await page.tap('[data-action="survival"]');
  await page.waitForTimeout(400);
  let st = await state(page);
  const f0 = st.flips;
  await page.touchscreen.tap(195, 600);
  await page.waitForTimeout(80);
  st = await state(page);
  check(st.flips === f0 + 1, 'Un toucher inverse exactement une fois (pas de double événement souris)');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/21-survie-mobile.png' });
  const scrollY = await page.evaluate(() => window.scrollY + document.scrollingElement.scrollTop);
  check(scrollY === 0, 'Pas de défilement de page en jeu');
  await page.tap('#btn-pause');
  await page.waitForTimeout(100);
  st = await state(page);
  check(st.phase === 'paused' && st.flips === f0 + 1, 'Pause tactile sans inversion');
  await page.screenshot({ path: 'screenshots/22-pause-mobile.png' });
  await page.tap('[data-action="quit"]');
  await page.tap('[data-action="levels"]');
  await page.screenshot({ path: 'screenshots/23-niveaux-mobile.png' });
  check(errors.length === 0, `Aucune erreur console (mobile)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ————————————————————————————————————————————— Mobile paysage et petite tablette
for (const [w, h, name] of [[844, 390, '30-paysage-mobile'], [768, 1024, '31-tablette'], [320, 568, '32-petit-ecran']]) {
  const { page, context, errors } = await newPage({ width: w, height: h }, { touch: true, dpr: 2 });
  await page.tap('[data-action="survival"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `screenshots/${name}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, `Pas de débordement horizontal (${w}×${h})`);
  check(errors.length === 0, `Aucune erreur console (${w}×${h})${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

await browser.close();
server.kill();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTous les contrôles de bout en bout sont passés.');
process.exit(failures.length ? 1 : 0);
