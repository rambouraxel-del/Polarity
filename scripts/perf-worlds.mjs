/**
 * Mesure de performance (CPU) du VOYAGE DES UNIVERS en émulation mobile (390×844 ×3, processeur ralenti) : une partie du voyage avec sa musique réelle,
 * échantillonnée à plusieurs moments de l'univers choisi (attaques et décor réels, aucune charge artificielle).
 * Usage : node scripts/perf-worlds.mjs [--dist dist] [--world 2] [--at 30,60,105] [--seconds 8] [--throttle 4]
 *
 * Limites : navigateur de bureau sans GPU (rendu logiciel) : seul le coût processeur (JS + préparation du rendu) est comparable ; le coût GPU réel
 * d'un téléphone n'est pas mesuré. Les images lentes d'un navigateur sans carte graphique font aussi dériver l'horloge de jeu : ne pas lire l'écart
 * jeu/son de ce banc d'essai.
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
const dist = resolve(arg('dist', 'dist'));
const world = Number(arg('world', 2));
const ats = arg('at', '30,60,105').split(',').map(Number);
const seconds = Number(arg('seconds', 8));
const throttle = Number(arg('throttle', 4));

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

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="survival"]'));
await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.options.dev.enabled = true; a.save.seenIntros = ['projectile', 'sector', 'combo', 'orb', 'surge', 'crack', 'rupture', 'spiral']; });
await page.mouse.click(190, 300);
await page.evaluate(async () => {
  const a = window.__polarite;
  a.sfx.unlock();
  await a.music.preload();
  await a.music.preloadWorld2();
  a.startRun({ mode: 'survival', seed: 1000, worlds: true, bonus: false });
  a.session.sim.invincible = true;
  window.__frames = [];
  const orig = a.frame.bind(a);
  a.frame = () => { const t0 = performance.now(); orig(); window.__frames.push(performance.now() - t0); };
});
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const base = (world - 1) * 120;
for (const at of ats) {
  await page.evaluate(({ target, w }) => {
    const a = window.__polarite;
    const s = a.session;
    s.setTestFrozen(false);
    s.sim.invincible = true;
    s.skipTo(target);
    a.worldMusic.startGame(w, target - (w - 1) * 120);
  }, { target: base + at, w: world });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__frames.length = 0; });
  const m0 = await metrics();
  const f0 = await page.evaluate(() => window.__polarite.game.getFrame());
  await page.waitForTimeout(seconds * 1000);
  const m1 = await metrics();
  const f1 = await page.evaluate(() => window.__polarite.game.getFrame());
  const frames = await page.evaluate(() => window.__frames.slice());
  const n = f1 - f0;
  frames.sort((x, y) => x - y);
  const info = await page.evaluate(() => { const a = window.__polarite; return { quality: a.ambience.state.tier, particles: a.renderer?.particleCount ?? 0, haz: a.session.sim.hazards.length }; });
  console.log(JSON.stringify({
    univers: world,
    'temps local (s)': at,
    images: n,
    fps: +(n / seconds).toFixed(1),
    'app.frame ms (moyenne)': +(sum(frames) / frames.length).toFixed(2),
    'app.frame ms (p95)': +frames[Math.floor(frames.length * 0.95)].toFixed(2),
    'script ms/image': +((1000 * (m1.ScriptDuration - m0.ScriptDuration)) / n).toFixed(2),
    'tâche principale ms/image': +((1000 * (m1.TaskDuration - m0.TaskDuration)) / n).toFixed(2),
    'tas JS Mo': +(m1.JSHeapUsedSize / 1048576).toFixed(1),
    ...info,
    erreurs: errors.length,
  }));
}
await browser.close();
server.close();
