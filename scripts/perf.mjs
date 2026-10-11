/**
 * Mesure de performance (CPU) en émulation mobile : viewport tactile 390×844 (×3), processeur ralenti ×4.
 * Charge identique pour toute version : 8 projectiles + 2 secteurs en permanence, sans collision.
 * Usage : node scripts/perf.mjs [--dist dist] [--seconds 12] [--throttle 4] [--label nom]
 *
 * Limites : navigateur de bureau sans GPU (rendu logiciel). Seul le coût processeur (JS + préparation du rendu)
 * est comparable ; le coût GPU réel d'un téléphone n'est pas mesuré.
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
const seconds = Number(arg('seconds', 12));
const throttle = Number(arg('throttle', 4));
const label = arg('label', dist);

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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="survival"]'));
await page.evaluate(() => { window.__polarite.save.options.tutorialSeen = true; window.__polarite.save.seenIntros = ['projectile', 'sector', 'combo']; });
await page.tap('[data-action="survival"]');
await page.waitForTimeout(500);

// Charge constante : maintient 8 projectiles et 2 secteurs actifs (le vaisseau est invincible)
await page.evaluate(() => {
  const app = window.__polarite;
  let id = 50000;
  window.__keepLoad = () => {
    const sim = app.session.sim;
    sim.invincible = true;
    const t = sim.time;
    const live = (k) => sim.hazards.filter((h) => h.kind === k && h.end > t + 2).length;
    for (let i = live('projectile'); i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 380;
      sim.hazards.push({ kind: 'projectile', id: id++, pattern: 'shot', warnStart: t - 1, launch: t - 0.1, end: t + 12, threatEnd: t + 12,
        x0: r * Math.cos(a), y0: r * Math.sin(a), vx: -Math.cos(a) * 45, vy: -Math.sin(a) * 45, cross1: a, cross2: a + 3, crossTime1: t - 1, crossTime2: t - 1, warned: true });
    }
    for (let i = live('sector'); i < 2; i++) {
      sim.hazards.push({ kind: 'sector', id: id++, pattern: 'arc', warnStart: t - 1, activeStart: t - 0.5, end: t + 12, threatEnd: t + 12,
        center: Math.random() * 6.28, half: 0.4, warned: true, activated: true });
    }
  };
  window.__keepLoad();
  // Chronomètre de chaque image applicative (mise à jour + préparation du rendu)
  window.__frames = [];
  const orig = app.frame.bind(app);
  app.frame = () => { const t0 = performance.now(); orig(); window.__frames.push(performance.now() - t0); };
});
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const keep = setInterval(() => page.evaluate(() => window.__keepLoad()).catch(() => undefined), 500);
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__frames.length = 0; });
const m0 = await metrics();
const f0 = await page.evaluate(() => window.__polarite.game.getFrame());
await page.waitForTimeout(seconds * 1000);
const m1 = await metrics();
const f1 = await page.evaluate(() => window.__polarite.game.getFrame());
clearInterval(keep);
const frames = await page.evaluate(() => window.__frames.slice());
const n = f1 - f0;
frames.sort((a, b) => a - b);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const result = {
  version: label,
  images: n,
  fps: +(n / seconds).toFixed(1),
  'app.frame ms (moyenne)': +(sum(frames) / frames.length).toFixed(2),
  'app.frame ms (p95)': +frames[Math.floor(frames.length * 0.95)].toFixed(2),
  'script ms/image': +((1000 * (m1.ScriptDuration - m0.ScriptDuration)) / n).toFixed(2),
  'tâche principale ms/image': +((1000 * (m1.TaskDuration - m0.TaskDuration)) / n).toFixed(2),
  'tas JS Mo': +(m1.JSHeapUsedSize / 1048576).toFixed(1),
  erreurs: errors.length,
};
console.log(JSON.stringify(result));
await browser.close();
server.close();
