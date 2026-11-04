/**
 * Contrôle navigateur de L'Orbite originelle (univers 1) avec la VRAIE musique « Neon Arpeggio » décodée : départ par le bouton de la préparation de la Survie
 * (attente du décodage), platine audio, position entendue, pause, reprise, mode silencieux, saut de test, transition réelle vers La Faille. Aucun service, aucune
 * récompense (partie de test).
 * Usage : node scripts/e2e-world1.mjs [--dist dist-preview]
 * Les images d'un navigateur sans carte graphique sont lentes : l'écart jeu/son affiché n'est PAS représentatif (voir docs/UNIVERS.md).
 */
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const dist = resolve(arg('dist', 'dist-preview'));
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
  const d = readdirSync(base).find((x) => /^chromium-\d+$/.test(x));
  for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (d && existsSync(`${base}/${d}/${sub}`)) return `${base}/${d}/${sub}`;
  return undefined;
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
const external = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', (r) => { const u = r.url(); if (!u.startsWith(url) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
await page.goto(url);
await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="survival"]'));
await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.seenIntros = ['projectile', 'sector', 'combo', 'orb', 'surge', 'crack', 'rupture', 'spiral']; });
await page.mouse.click(190, 300);
await page.evaluate(async () => {
  const a = window.__polarite;
  a.sfx.unlock();
  await a.music.preload();
  // Banc d'essai sans carte graphique : jeu lent, la garde de synchronisation (testée à part) recalerait la musique en permanence : désactivée ici
  a.syncGuard.update = () => false;
});
const noW1 = await page.evaluate(() => !window.__polarite.music.decoded.world1);
check('avant le départ : le morceau de l’univers 1 n’est pas encore décodé (rien chargé pour la Survie officielle)', noW1);
// Départ par le bouton de la préparation de la Survie (aucun mode développeur)
await page.click('[data-action="survival"]');
await page.waitForSelector('[data-action="worlds-start"]');
await page.click('[data-action="worlds-start"]');
await page.waitForFunction(() => !!window.__polarite.session, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const st = () => page.evaluate(() => {
  const a = window.__polarite;
  const s = a.session;
  const p = a.worldMusic.position({ track: null, time: 0, playing: false });
  return { world: s.sim.world, t: +s.sim.time.toFixed(2), transit: +s.transitLeft.toFixed(2), phase: s.phase, decks: a.worldMusic.activeDecks, mw: a.worldMusic.currentWorld, track: p.track, pos: +p.time.toFixed(2), playing: p.playing, test: s.isTest, w1: !!a.music.decoded.world1, w2: !!a.music.decoded.world2 };
});
let s = await st();
check('le départ attend le décodage : morceau de l’univers 1 décodé', s.w1, JSON.stringify(s));
check('partie du voyage = partie de test (aucun gain, record ni classement)', s.test);
check('musique : une seule platine, univers 1', s.world === 1 && s.decks === 1 && s.mw === 1, JSON.stringify(s));
check('la position musicale est celle du fichier « Neon Arpeggio » (≥ temps de jeu : le banc d’essai est lent)', s.track === 'w1' && s.playing && s.pos > 0.5 && s.pos < 20, JSON.stringify(s));
await page.evaluate(() => { window.__polarite.session.sim.invincible = true; });

// Réactions du décor : la carte « w1 » est lue à la position entendue
await page.evaluate(() => { const a = window.__polarite; a.session.skipTo(50); a.worldMusic.startGame(1, 50 + 0.17); });
await page.waitForTimeout(2500);
const react = await page.evaluate(() => { const a = window.__polarite; const f = a.musicSync.frame; return { active: f.active, track: f.track, intensity: +f.intensity.toFixed(2), bass: +f.bass.toFixed(2), world: a.ambience.state.world }; });
check('décor : la carte « w1 » est lue (intensité > 0,3 au plateau)', react.active && react.track === 'w1' && react.intensity > 0.3 && react.world === 1, JSON.stringify(react));

// Pause / reprise
await page.evaluate(() => window.__polarite.session.pause());
await page.waitForTimeout(700);
const paused = await st();
await page.waitForTimeout(1200);
const paused2 = await st();
check('pause : la position musicale est figée', paused.phase === 'paused' && Math.abs(paused2.pos - paused.pos) < 0.001 && !paused2.playing, `${paused.pos} → ${paused2.pos}`);
check('pause : le temps de jeu est figé', paused2.t === paused.t);
await page.evaluate(() => window.__polarite.session.resume());
await page.waitForFunction(() => window.__polarite.session.phase === 'running', null, { timeout: 30000 });
await page.waitForTimeout(1500);
const resumed = await st();
check('reprise : la musique repart au même endroit', resumed.playing && resumed.pos >= paused.pos - 0.05 && resumed.pos - paused.pos < 4, `${paused.pos} → ${resumed.pos}`);

// Mode silencieux : le jeu continue, le décor ne réagit plus
await page.evaluate(() => { const a = window.__polarite; a.save.options.muted = true; a.applyAudioOptions(); });
await page.waitForTimeout(900);
const mute = await page.evaluate(() => { const a = window.__polarite; const f = a.musicSync.frame; return { active: f.active, bass: f.bass, running: a.session.phase === 'running', t: a.session.sim.time }; });
check('silencieux : aucune réaction du décor, jeu inchangé', !mute.active && mute.bass === 0 && mute.running, JSON.stringify(mute));
await page.waitForTimeout(500);
const t2 = await page.evaluate(() => window.__polarite.session.sim.time);
check('silencieux : le temps de jeu avance toujours', t2 > mute.t);
await page.evaluate(() => { const a = window.__polarite; a.save.options.muted = false; a.applyAudioOptions(); });

// Transition réelle 1 → 2 (le morceau de La Faille est décodé avant)
await page.evaluate(async () => { const a = window.__polarite; await a.music.preloadWorld2(); a.session.skipTo(117); a.worldMusic.startGame(1, 117 + 0.17); });
await page.waitForFunction(() => window.__polarite.session.transitLeft > 0, null, { timeout: 120000 });
s = await st();
check('transition 1 → 2 : la musique de La Faille est programmée', s.mw === 2 && s.decks >= 1 && s.decks <= 2, JSON.stringify(s));
await page.waitForFunction(() => window.__polarite.session.transitLeft === 0 && window.__polarite.session.sim.world === 2, null, { timeout: 120000 });
await page.waitForTimeout(2500);
s = await st();
check('arrivée dans La Faille : une seule platine, morceau « Portal Surge »', s.world === 2 && s.decks === 1 && s.track === 'w2', JSON.stringify(s));
await page.evaluate(() => { const a = window.__polarite; a.session.skipTo(131); });
await page.waitForTimeout(1500);
s = await st();
check('mémoire : le morceau de l’univers 1 est libéré une fois l’univers traversé', !s.w1, JSON.stringify(s));

check('aucune requête vers l’extérieur', external.length === 0, external.slice(0, 3).join(' '));
check('aucune erreur de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} contrôle(s) en échec` : '\nTous les contrôles de L’Orbite originelle sont passés.');
process.exit(failed ? 1 : 0);
