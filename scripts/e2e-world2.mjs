/**
 * Contrôle navigateur de La Faille (univers 2) avec la VRAIE musique décodée : entrée par la transition réelle de l'univers 1, platines audio, pause,
 * reprise, mode silencieux, saut de test, sortie vers l'univers 3. Aucun service, aucune récompense (partie de test).
 * Usage : node scripts/e2e-world2.mjs [--dist dist-preview]
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
await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.options.dev.enabled = true; a.save.seenIntros = ['projectile', 'sector', 'combo', 'orb', 'surge', 'crack', 'rupture', 'spiral']; });
await page.mouse.click(190, 300);
await page.evaluate(async () => {
  const a = window.__polarite;
  a.sfx.unlock();
  await a.music.preload();
  await a.music.preloadWorld2();
  // Banc d'essai sans carte graphique : le jeu y tourne à quelques images/s et prend du retard sur la musique ; la garde de synchronisation (testée à part)
  // recalerait la musique en permanence. On la désactive pour contrôler ici le comportement brut des platines.
  a.syncGuard.update = () => false;
  a.startRun({ mode: 'survival', seed: 1000, worlds: true, bonus: false });
  a.session.sim.invincible = true;
});
const st = () => page.evaluate(() => {
  const a = window.__polarite;
  const s = a.session;
  const p = a.worldMusic.position({ track: null, time: 0, playing: false });
  return { world: s.sim.world, t: +s.sim.time.toFixed(2), transit: +s.transitLeft.toFixed(2), phase: s.phase, decks: a.worldMusic.activeDecks, mw: a.worldMusic.currentWorld, track: p.track, pos: +p.time.toFixed(2), playing: p.playing, test: s.isTest, w2: !!a.music.decoded.world2 };
});

check('morceau de La Faille décodé', (await st()).w2);
check('partie du voyage = partie de test', (await st()).test);

// Entrée : on avance (sans rendu) jusque juste avant la faille de l'univers 1, puis le jeu réel traverse la transition
await page.evaluate(() => { const a = window.__polarite; a.session.skipTo(117); a.worldMusic.startGame(1, 117); });
await page.waitForFunction(() => window.__polarite.session.transitLeft > 0, null, { timeout: 120000 });
let s = await st();
check('transition 1 → 2 : décompte lancé', s.transit > 0 && s.world === 1, JSON.stringify(s));
check('musique : la platine de l’univers 2 est programmée', s.mw === 2 && s.decks >= 1, `platines ${s.decks}`);
await page.waitForFunction(() => window.__polarite.session.transitLeft === 0 && window.__polarite.session.sim.world === 2, null, { timeout: 120000 });
await page.waitForTimeout(800);
s = await st();
check('arrivée dans La Faille : une seule platine active', s.world === 2 && s.decks === 1, JSON.stringify(s));
check('la position musicale est celle du montage', s.track === 'w2' && s.pos > 0 && s.playing, JSON.stringify(s));

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
const mute = await page.evaluate(() => { const a = window.__polarite; const f = a.musicSync.frame; return { active: f.active, bass: f.bass, perc: f.perc ?? 0, running: a.session.phase === 'running', t: a.session.sim.time }; });
check('silencieux : aucune réaction du décor, jeu inchangé', !mute.active && mute.bass === 0 && mute.perc === 0 && mute.running, JSON.stringify(mute));
await page.waitForTimeout(500);
const t2 = await page.evaluate(() => window.__polarite.session.sim.time);
check('silencieux : le temps de jeu avance toujours', t2 > mute.t);
await page.evaluate(() => { const a = window.__polarite; a.save.options.muted = false; a.applyAudioOptions(); });

// Saut de test dans La Faille (la musique est recalée)
await page.evaluate(() => { const a = window.__polarite; a.session.skipTo(120 + 60); a.worldMusic.startGame(2, 60); });
await page.waitForTimeout(1200);
s = await st();
check('saut de test : la musique est recalée sur le temps de jeu', s.track === 'w2' && Math.abs(s.pos - (60 + 1.81)) < 3, JSON.stringify(s));

// Sortie : transition 2 → 3 (fondu de la platine, platine procédurale de la Mer nébulaire)
await page.evaluate(() => { const a = window.__polarite; a.session.skipTo(120 + 117); a.worldMusic.startGame(2, 117); });
await page.waitForFunction(() => window.__polarite.session.transitLeft > 0, null, { timeout: 120000 });
s = await st();
check('transition 2 → 3 : la musique de La Faille se ferme, celle de la Mer nébulaire s’ouvre', s.mw === 3 && s.decks >= 1 && s.decks <= 2, JSON.stringify(s));
await page.waitForFunction(() => window.__polarite.session.transitLeft === 0, null, { timeout: 120000 });
await page.waitForTimeout(3500);
s = await st();
check('Mer nébulaire : une seule platine (fond procédural, aucune position musicale)', s.world === 3 && s.decks === 1 && s.track === null, JSON.stringify(s));

check('aucune requête vers l’extérieur', external.length === 0, external.slice(0, 3).join(' '));
check('aucune erreur de console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} contrôle(s) en échec` : '\nTous les contrôles de La Faille sont passés.');
process.exit(failed ? 1 : 0);
