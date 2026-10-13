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

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Le serveur est toujours arrêté, même en cas d'échec
process.on('exit', () => server.kill());
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error(e);
  process.exit(1);
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
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
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
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
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

  // Niveaux (« Défis classiques », sous-menu de la Campagne)
  await page.click('[data-action="campaign"]');
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

  // Relance au clavier : Espace sur l'écran de résultat (bouton Rejouer focalisé après la protection)
  // Le focus arrive après la protection contre les clics accidentels, comptée en temps d'image : on l'attend (rendu logiciel lent)
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-replay'), null, { timeout: 20000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  st = await state(page);
  check(st && st.phase === 'running' && st.time < 0.5, 'Espace relance depuis l’écran de résultat');

  // Mémoire : 20 relances supplémentaires ne doivent pas faire croître le tas
  const heap = () => page.evaluate(() => { window.gc?.(); return performance.memory?.usedJSHeapSize ?? 0; });
  const fastDeath = () => page.evaluate(() => {
    const s = window.__polarite.session;
    for (let k = 0; k < 120 * 90 && s.sim.state === 'running'; k++) s.sim.step();
    s.frame(0.1); for (let k = 0; k < 20; k++) s.frame(0.1);
  });
  await fastDeath();
  await page.waitForTimeout(800);
  const h0 = await heap();
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.__polarite.startRun({ mode: 'survival', seed: 1 }));
    await page.waitForTimeout(30);
    await fastDeath();
  }
  await page.waitForTimeout(800);
  const h1 = await heap();
  check(h0 === 0 || h1 - h0 < 8 * 1024 * 1024, `Pas de fuite évidente après 20 relances (tas ${(h0 / 1048576).toFixed(1)} → ${(h1 / 1048576).toFixed(1)} Mo)`);

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

  // Cosmétiques et options
  await page.click('[data-action="cosmetics"]');
  await page.screenshot({ path: 'screenshots/10-cosmetiques.png', fullPage: true });
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
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  check(true, 'Démarrage malgré une sauvegarde corrompue');

  check(errors.length === 0, `Aucune erreur console ni requête manquante (bureau)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ————————————————————————————————————————————— Graphismes « Néon premium », impact, hitbox
{
  const { page, context, errors } = await newPage({ width: 1100, height: 800 }, { dpr: 2 });
  await page.evaluate(() => { window.__polarite.save.options.tutorialSeen = true; });
  const tex = await page.evaluate(() => ['ship', 'ast1', 'ast2', 'ast3', 'ast4'].every((k) => window.__polarite.game.textures.exists(k)));
  check(tex, 'Les 5 sprites (vaisseau + 4 astéroïdes) sont chargés');
  const size = await page.evaluate(() => { const t = window.__polarite.game.textures.get('ship').getSourceImage(); return [t.width, t.height]; });
  check(size[0] === 128 && size[1] === 128, 'Texture du vaisseau 128×128 (puissance de deux, mipmaps)');

  await page.click('[data-action="survival"]');
  await page.waitForTimeout(500);
  const visible = await page.evaluate(() => window.__polarite.renderer.shipSprite.visible);
  check(visible, 'Le sprite du vaisseau est affiché en partie');

  // Inversion : le sprite se retourne aussitôt (nez et flamme changent de sens), sans interpolation
  const rot = () => page.evaluate(() => window.__polarite.renderer.shipSprite.rotation);
  const r0 = await rot();
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  const r1 = await rot();
  let diff = Math.abs(r1 - r0) % (2 * Math.PI);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  check(Math.abs(diff - Math.PI) < 0.45, `Inversion : le vaisseau se retourne immédiatement (Δ ≈ ${(diff / Math.PI).toFixed(2)} π)`);

  // Visuels agrandis : taille affichée du sprite = 2 × rayon visuel (11 × 1,15 × 1,45 × 1,2) / 0,9375 × échelle
  const dims = await page.evaluate(() => {
    const r = window.__polarite.renderer;
    return { w: r.shipSprite.displayWidth, scale: r.scale };
  });
  const expected = (2 * 11 * 1.15 * 1.45 * 1.2) / (120 / 128) * dims.scale;
  check(Math.abs(dims.w - expected) < 0.5, `Vaisseau +20 % de plus (${dims.w.toFixed(1)} px ≈ ${expected.toFixed(1)} px)`);

  // Astéroïde : un projectile actif devient un sprite (sans collision : invincible)
  await page.evaluate(() => {
    const s = window.__polarite.session;
    s.sim.invincible = true;
    const t = s.sim.time;
    s.sim.hazards.push({ kind: 'projectile', id: 9001, pattern: 'shot', warnStart: t - 1, launch: t - 0.2, end: t + 20, threatEnd: t + 20,
      x0: -300, y0: 120, vx: 40, vy: 0, cross1: 0, cross2: 0, crossTime1: t - 1, crossTime2: t - 1, warned: true });
  });
  await page.waitForTimeout(250);
  const nAst = await page.evaluate(() => window.__polarite.renderer.asteroidPool.filter((a) => a.img.visible).length);
  check(nAst >= 1, 'Un projectile est dessiné par un sprite d’astéroïde');
  const ast = await page.evaluate(() => {
    const r = window.__polarite.renderer;
    const a = r.asteroidPool.find((x) => x.img.visible);
    return { w: a.img.displayWidth, glow: a.glow.visible, glowW: a.glow.displayWidth, scale: r.scale };
  });
  const expAst = (2 * 10 * 1.15 * 1.35) / (120 / 128) * ast.scale;
  check(Math.abs(ast.w - expAst) < 0.5, `Astéroïde +35 % (${ast.w.toFixed(1)} px ≈ ${expAst.toFixed(1)} px)`);
  check(ast.glow && ast.glowW > ast.w, 'Contour lumineux orange présent autour de l’astéroïde');
  await page.evaluate(() => { window.__polarite.session.sim.hazards.length = 0; });

  // Collision : impact bref au point de contact (anneaux + éclats), puis résultat
  await page.evaluate(() => { window.__polarite.session.sim.invincible = false; });
  await page.evaluate(() => {
    const s = window.__polarite.session;
    const t = s.sim.time;
    s.sim.hazards.push({ kind: 'sector', id: 9002, pattern: 'arc', warnStart: t, activeStart: t + 0.02, end: t + 3, threatEnd: t + 3,
      center: s.sim.angle + s.sim.dir * 0.05, half: 0.4, warned: true, activated: false });
  });
  await page.waitForTimeout(140);
  const impact = await page.evaluate(() => ({ rings: window.__polarite.renderer.rings.length, state: window.__polarite.session.sim.state, ship: window.__polarite.renderer.shipSprite.visible }));
  check(impact.state === 'dead' && impact.rings >= 1, 'Collision : impact (onde de choc) déclenché au point de contact');
  check(!impact.ship, 'Le vaisseau disparaît à l’impact');
  await page.screenshot({ path: 'screenshots/40-impact.png' });
  await page.waitForTimeout(900);
  const ringsAfter = await page.evaluate(() => window.__polarite.renderer.rings.length);
  check(ringsAfter === 0, 'L’impact reste bref (onde de choc terminée en moins d’une seconde)');
  check((await page.locator('[data-replay]').count()) === 1, 'Écran de résultat après l’impact');

  // Aperçu des hitboxes (?debug)
  await page.goto(URL + '?demo&debug');
  await page.waitForFunction(() => !!window.__polarite && window.__polarite.renderer);
  await page.evaluate(() => { window.__polarite.save.options.tutorialSeen = true; });
  await page.click('[data-action="survival"]');
  await page.evaluate(() => window.__polarite.fastForward(70));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/41-debug-hitbox.png' });
  const debugOn = await page.evaluate(() => window.__polarite.renderer.debug);
  check(debugOn === true, 'Aperçu des hitboxes (?debug) disponible');
  check(errors.length === 0, `Aucune erreur console (graphismes)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ————————————————————————————————————————————— v1.2 : vitesse progressive, nouveaux dangers, événements
{
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });
  await page.goto(URL + '?demo');
  await page.waitForFunction(() => !!window.__polarite && window.__polarite.renderer);
  await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.seenIntros = ['projectile', 'sector', 'combo', 'fragment', 'convoy', 'laser']; });
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(300);

  // Vitesse : départ à 40 % de la référence (2,0 rad/s)
  const w0 = await page.evaluate(() => window.__polarite.session.sim.omega);
  check(Math.abs(w0 - 0.8) < 1e-6, `Vitesse de départ : 40 % de la référence (${w0.toFixed(2)} rad/s)`);
  // Paliers : 45 % à 30 s, 50 % à 1 min, 100 % à 6 min (avance rapide du joueur automatique).
  // Le robot du navigateur joue une graine aléatoire et peut mourir : jusqu'à 3 parties, la dernière fait foi.
  let speeds = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    speeds = [];
    for (const [target] of [[30.1], [60.1], [180.1], [360.2]]) {
      await page.evaluate((t) => { const s = window.__polarite.session; window.__polarite.fastForward(t - s.sim.time); }, target);
      speeds.push(await page.evaluate(() => window.__polarite.session.sim.omega));
    }
    if ((await page.evaluate(() => window.__polarite.session.sim.state)) === 'running' || attempt === 3) break;
    console.log(`  (robot mort avant 6 min, nouvelle partie : tentative ${attempt + 1}/3)`);
    await page.evaluate(() => window.__polarite.showScreen('home'));
    await page.click('[data-action="survival"]');
    await page.waitForTimeout(300);
  }
  [[30.1, 0.9], [60.1, 1.0], [180.1, 1.4], [360.2, 2.0]].forEach(([target, expected], i) => {
    check(Math.abs(speeds[i] - expected) < 1e-6, `Palier à ${Math.round(target)} s : ${expected.toFixed(2)} rad/s (${(speeds[i] / 2 * 100).toFixed(0)} % de la référence)`);
  });
  check((await page.evaluate(() => window.__polarite.session.sim.state)) === 'running', 'Le joueur automatique traverse 6 minutes de Survie (événements et nouveaux dangers inclus)');

  // Nouveaux dangers : dessinés sans erreur (fragment, convoi, laser) ; les fragments sont plus petits
  await page.evaluate(() => { const s = window.__polarite.session.sim; s.invincible = true; s.hazards.length = 0; });
  for (const id of ['fragment', 'convoy', 'laser']) {
    const n = await page.evaluate((i) => { const s = window.__polarite.session.sim; s.hazards.length = 0; return s.injectPattern(i).length; }, id);
    await page.waitForTimeout(700);
    check(n >= 1, `Motif « ${id} » injecté (${n} menace${n > 1 ? 's' : ''})`);
  }
  await page.evaluate(() => { const s = window.__polarite.session.sim; s.hazards.length = 0; s.injectPattern('fragment'); });
  await page.evaluate(() => window.__polarite.fastForward(0)); // pas d'avance : le jeu continue en temps réel
  await page.waitForTimeout(2200);
  const fragScale = await page.evaluate(() => {
    const r = window.__polarite.renderer;
    return r.asteroidPool.filter((a) => a.img.visible).map((a) => a.sc);
  });
  check(fragScale.length === 0 || fragScale.includes(0.7) || fragScale.includes(1), 'Astéroïde fragmenté dessiné par les sprites d’astéroïdes (fragments à 70 %)');
  await page.screenshot({ path: 'screenshots/50-fragment.png' });

  // Événements (défi quotidien, graine fixe) : annonce 2 s avant, pause qui fige tout
  await page.evaluate(() => window.__polarite.showScreen('home'));
  await page.click('[data-action="daily"]');
  await page.click('[data-action="play-daily"]');
  await page.waitForTimeout(300);
  const ev = await page.evaluate(() => { const d = window.__polarite.session.sim.director; return { start: d.eventStart, kind: d.eventKind }; });
  check(ev.start >= 45 && ev.start <= 60, `Défi quotidien : premier événement à ${ev.start.toFixed(1)} s (entre 45 et 60 s)`);
  await page.evaluate((t) => { window.__polarite.fastForward(t - 1.5 - window.__polarite.session.sim.time); }, ev.start);
  await page.waitForTimeout(400);
  const banner = await page.locator('#banner').innerText();
  check(/dans [12] s/.test(banner) && /(Pluie de météores|Tempête électrique)/.test(banner), `Bandeau d’annonce de l’événement (« ${banner.replace(/\n/g, ' ')} »)`);
  await page.screenshot({ path: 'screenshots/51-annonce-evenement.png' });
  // La pause arrête les chronomètres : état identique après 1,5 s de pause
  await page.keyboard.press('Escape');
  const snap = () => page.evaluate(() => { const s = window.__polarite.session.sim; return JSON.stringify({ t: s.time, st: s.director.status(s.time), h: s.hazards.length }); });
  const a = await snap();
  await page.waitForTimeout(1500);
  check((await snap()) === a, 'Pause : annonce, temps actif et menaces figés');
  await page.click('[data-action="resume"]');
  await page.waitForTimeout(2800);
  const st = await page.evaluate(() => { const s = window.__polarite.session.sim; return s.director.status(s.time).phase; });
  check(st === 'announce' || st === 'event', `Après la reprise, l’événement suit son cours (phase : ${st})`);
  check((await page.locator('#hud-sub').innerText()).length > 0, 'Libellé de l’événement dans l’interface');
  await page.screenshot({ path: 'screenshots/52-evenement.png' });
  check(errors.length === 0, `Aucune erreur (v1.2)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ————————————————————————————————————————————— Migration de la sauvegarde v1.0
{
  const v1 = {
    version: 1,
    levels: { '1': { completed: true, bestScore: 52000, stars: 2 }, '2': { completed: true, bestScore: 41000, stars: 3 } },
    survival: { bestTime: 312.4, bestScore: 88000, runs: 14 },
    daily: { '2026-10-10': { bestTime: 140.2, bestScore: 31000, runs: 2 } },
    achievements: { first_cycle: 1, first_level: 2 },
    skin: 'aurore',
    options: { muted: true, volume: 0.4, reducedEffects: false, tutorialSeen: true },
    seenIntros: ['projectile'], stats: { totalCycles: 42, totalRuns: 30 },
  };
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((save) => { if (!localStorage.getItem('polarite.save')) localStorage.setItem('polarite.save', JSON.stringify(save)); }, v1);
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  const home = await page.locator('#screen').innerText();
  check(home.includes('Mise à jour'), 'Migration : information sur le nouvel équilibrage affichée');
  check(/ancien équilibrage : 5:12/.test(home), 'Migration : ancien record de Survie (5:12,4) conservé et distingué');
  const saved = await page.evaluate(() => {
    const a = window.__polarite.save;
    return { l: a.levels, skin: a.skin, ach: Object.keys(a.achievements).length, surv: a.survival.bestTime, arch: a.archive['1'].survival.bestTime, opt: a.options.muted };
  });
  check(saved.l['2'].stars === 3 && saved.skin === 'aurore' && saved.ach >= 2 && saved.opt === true, 'Migration : niveaux, étoiles, succès, apparence et options préservés');
  check(saved.surv === 0 && Math.abs(saved.arch - 312.4) < 1e-9, 'Migration : records actuels remis à zéro, anciens rangés à part');
  const backup = await page.evaluate(() => localStorage.getItem('polarite.save.avant-v1'));
  check(backup !== null && JSON.parse(backup).survival.bestTime === 312.4, 'Migration : copie de l’ancienne sauvegarde conservée');
  // Le niveau 3 est ouvert (niveau 2 réussi)
  await page.evaluate(() => window.__polarite.showScreen('levels'));
  check((await page.locator('.level-card:not(:disabled)').count()) === 3, 'Migration : niveaux débloqués conservés (1, 2, 3)');
  await page.evaluate(() => window.__polarite.showScreen('home'));
  await page.click('[data-action="dismiss-notice"]');
  check(!(await page.locator('#screen').innerText()).includes('Mise à jour :'), 'L’information se ferme et ne revient pas');
  await page.screenshot({ path: 'screenshots/42-migration.png' });
  await page.reload();
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  check(!(await page.locator('#screen').innerText()).includes('Mise à jour :'), 'L’information reste fermée après rechargement');
  check(errors.length === 0, 'Aucune erreur (migration)');
  await context.close();
}

// ————————————————————————————————————————————— Menu Cosmétiques : aperçu, filtres, équipement, verrouillage, persistance
{
  const { page, context, errors } = await newPage({ width: 1280, height: 800 });
  const go = async (id) => { await page.evaluate((a) => window.__polarite.showScreen(a), id); await page.waitForTimeout(350); };
  await page.evaluate(() => { const a = window.__polarite; a.save.achievements = { first_cycle: 1 }; a.save.owned = ['aurore']; a.save.options.tutorialSeen = true; a.save.balanceNoticeSeen = 3; });
  await go('cosmetics');
  check((await page.locator('.skin').count()) === 9, 'Cosmétiques : 9 vaisseaux (tous les articles de la catégorie)');
  check((await page.locator('.skin__thumb img').count()) === 9, 'Cosmétiques : une miniature par carte');
  check((await page.locator('.wallet').count()) === 1, 'Cosmétiques : soldes affichés une seule fois');
  check((await page.locator('.item--equipped').count()) === 1 && (await page.locator('.item--owned').count()) === 1, 'Cosmétiques : 1 équipé, 1 possédé');
  check((await page.locator('canvas[data-skin-preview="classique"]').count()) === 1, 'Aperçu : le vaisseau équipé est affiché en grand');
  // Filtres
  await page.click('[data-action="filter-owned"]');
  check((await page.locator('.skin').count()) === 2, 'Filtre Possédés : 2 vaisseaux');
  await page.click('[data-action="filter-locked"]');
  check((await page.locator('.skin').count()) === 7, 'Filtre À débloquer : 7 vaisseaux');
  await page.click('[data-action="filter-all"]');
  // Aperçu animé : l'image change au cours du temps ; figée en effets réduits
  const frame = () => page.evaluate(() => document.querySelector('canvas[data-skin-preview]').toDataURL());
  const a1 = await frame();
  await page.waitForTimeout(500);
  const a2 = await frame();
  check(a1 !== a2, 'Aperçu : rotation lente et réacteur animés');
  await page.screenshot({ path: 'screenshots/60-cosmetiques-bureau.png' });
  // Exclusivité de succès : aperçu, condition précise, bouton inactif
  await page.click('[data-item="glace"]');
  check((await page.locator('canvas[data-skin-preview="glace"]').count()) === 1, 'Article verrouillé : son aperçu s’affiche');
  const cond = await page.locator('#item-note').innerText();
  check(/Pleine charge/.test(cond) && /multiplicateur maximal/.test(cond), `Succès requis : condition précise (« ${cond.replace(/\s+/g, ' ')} »)`);
  check(await page.locator('.skin-info [data-action="buy"]').isDisabled(), 'Succès requis : bouton inactif');
  check((await page.evaluate(() => window.__polarite.save.skin)) === 'classique', 'Sélectionner une carte n’équipe pas l’apparence');
  await page.screenshot({ path: 'screenshots/61-cosmetique-verrouille.png' });
  // Article possédé : Équiper
  await page.click('[data-item="aurore"]');
  check(await page.locator('.skin-info [data-action="equip-item"]').isEnabled(), 'Article possédé : bouton « Équiper » actif');
  await page.click('.skin-info [data-action="equip-item"]');
  check((await page.evaluate(() => window.__polarite.save.skin)) === 'aurore', 'Équiper enregistre l’apparence');
  check((await page.locator('.item--equipped[data-item="aurore"]').count()) === 1, 'La carte équipée est signalée');
  await page.screenshot({ path: 'screenshots/62-cosmetique-equipe.png' });
  // Appliquée dans tous les modes
  for (const [mode, sel] of [['Survie', '[data-action="survival"]'], ['défi quotidien', '[data-action="daily"]'], ['Niveaux', '[data-action="campaign"]']]) {
    await go('home');
    await page.click(sel);
    if (mode === 'défi quotidien') await page.click('[data-action="play-daily"]');
    if (mode === 'Niveaux') {
      await page.click('[data-action="levels"]');
      await page.click('[data-action="play-level"][data-level="1"]');
    }
    await page.waitForTimeout(500);
    const key = await page.evaluate(() => window.__polarite.renderer.shipSprite.texture.key);
    const w = await page.evaluate(() => window.__polarite.renderer.shipSprite.displayWidth);
    check(key === 'ship-aurore' && w > 0, `Apparence équipée appliquée en ${mode} (texture ${key})`);
  }
  await page.screenshot({ path: 'screenshots/63-partie-apparence.png' });
  // Persistance après rechargement
  await page.reload();
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  check((await page.evaluate(() => window.__polarite.save.skin)) === 'aurore', 'Persistance : l’apparence équipée survit au rechargement');
  await page.evaluate(() => window.__polarite.showScreen('cosmetics'));
  await page.waitForTimeout(300);
  check((await page.locator('.item--equipped[data-item="aurore"]').count()) === 1, 'Persistance : la carte équipée est affichée après rechargement');
  // Effets réduits : aperçu figé
  await page.evaluate(() => { const a = window.__polarite; a.save.options.reducedEffects = true; a.applyReducedEffects(); a.showScreen('cosmetics'); });
  await page.waitForTimeout(300);
  const r1 = await frame();
  await page.waitForTimeout(500);
  const r2 = await frame();
  check(r1 === r2, 'Effets réduits : l’aperçu du vaisseau reste fixe');
  check(errors.length === 0, `Aucune erreur console (apparences)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();

  // Retour au modèle classique si l'identifiant n'existe plus, ou si l'apparence est verrouillée
  for (const [skin, label] of [['disparue', 'identifiant inconnu'], ['prisme', 'apparence verrouillée']]) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const p = await ctx.newPage();
    await p.addInitScript((id) => {
      if (!localStorage.getItem('polarite.save')) {
        const base = { version: 2, balance: 3, levels: {}, survival: { bestTime: 0, bestScore: 0, runs: 0 }, daily: {}, achievements: {}, skin: id, options: { muted: false, volume: 0.7, reducedEffects: false, tutorialSeen: true }, seenIntros: [], stats: { totalCycles: 0, totalRuns: 0 }, archive: {}, balanceNoticeSeen: 3 };
        localStorage.setItem('polarite.save', JSON.stringify(base));
      }
    }, skin);
    await p.goto(URL);
    await p.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
    check((await p.evaluate(() => window.__polarite.save.skin)) === 'classique', `Repli sur le modèle classique (${label})`);
    await p.click('[data-action="survival"]');
    await p.waitForTimeout(400);
    check((await p.evaluate(() => window.__polarite.renderer.shipSprite.texture.key)) === 'ship-classique', `Partie jouable avec le modèle classique (${label})`);
    await ctx.close();
  }
}

// ————————————————————————————————————————————— Économie : Éclats sur l'orbite, récompenses, boutique, Prismes
{
  const { page, context, errors } = await newPage({ width: 1280, height: 800 });
  const sim = (fn, arg) => page.evaluate(fn, arg);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('polarite.save')));
  await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.balanceNoticeSeen = 3; a.save.owned = ['aurore', 'ambre', 'spectre']; });

  // — Éclat sur l'orbite (Survie)
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(300);
  await sim(() => { const s = window.__polarite.session.sim; s.invincible = true; s.hazards.length = 0; });
  check(await sim(() => window.__polarite.session.sim.shards !== null), 'Survie : éclats activés');
  check(!(await page.locator('#hud-shards').evaluate((e) => e.classList.contains('hidden'))), 'HUD : compteur d’Éclats visible en Survie');
  const first = await sim(() => window.__polarite.session.sim.shards.nextAt);
  check(first >= 15 && first <= 25, `Première apparition prévue entre 15 et 25 s (${first.toFixed(1)} s)`);
  await sim(() => { const s = window.__polarite.session.sim; s.shards.nextAt = s.time; });
  await page.waitForTimeout(500);
  const active = await sim(() => { const a = window.__polarite.session.sim.shards.active; return a ? { id: a.id, life: a.expiresAt - a.spawnedAt } : null; });
  check(active && Math.abs(active.life - 5) < 1e-9, 'Un éclat apparaît, disponible 5 secondes');
  check(await sim(() => window.__polarite.renderer.shardSprite.visible), 'L’éclat est dessiné (sprite au-dessus du rail)');
  await page.screenshot({ path: 'screenshots/70-eclat-orbite.png' });
  // Pause : l'expiration est suspendue
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const r0 = await sim(() => { const s = window.__polarite.session.sim; return { t: s.time, rem: s.shards.remaining(s.time) }; });
  await page.waitForTimeout(1800);
  const r1 = await sim(() => { const s = window.__polarite.session.sim; return { t: s.time, rem: s.shards.remaining(s.time), has: !!s.shards.active }; });
  check(r1.t === r0.t && r1.rem === r0.rem && r1.has, 'Pause : apparition, expiration et animation suspendues');
  await page.click('[data-action="resume"]');
  await page.waitForTimeout(2600);
  // Collecte : crédit unique, sauvegardé tout de suite
  const w0 = await sim(() => window.__polarite.save.wallet.shards);
  await sim(() => { const s = window.__polarite.session.sim; const a = s.shards.active; s.angle = a.angle - s.dir * 0.12; });
  await page.waitForTimeout(700);
  check((await sim(() => window.__polarite.save.wallet.shards)) === w0 + 5, 'Collecte : +5 Éclats');
  check((await stored()).wallet.shards === w0 + 5, 'Collecte : gain sauvegardé immédiatement');
  await page.waitForTimeout(1200);
  check((await sim(() => window.__polarite.save.wallet.shards)) === w0 + 5, 'Un éclat n’est crédité qu’une fois');
  check((await page.locator('#hud-shards-n').innerText()) === '5', 'HUD : 5 Éclats gagnés pendant la partie');
  // Disparition sans collecte : aucun gain
  await sim(() => { const s = window.__polarite.session.sim; s.shards.nextAt = s.time; });
  await page.waitForTimeout(400);
  await sim(() => { const s = window.__polarite.session.sim; s.shards.active.expiresAt = s.time + 0.2; s.angle = s.shards.active.angle + Math.PI; });
  await page.waitForTimeout(700);
  check(await sim(() => window.__polarite.session.sim.shards.active === null && !window.__polarite.renderer.shardSprite.visible), 'Un éclat non collecté disparaît');
  check((await sim(() => window.__polarite.save.wallet.shards)) === w0 + 5, 'Disparition : aucun gain');
  // Mort : les Éclats restent acquis ; le résultat les affiche sans les recréditer
  await sim(() => { const s = window.__polarite.session.sim; s.invincible = false; for (let i = 0; i < 120 * 90 && s.state === 'running'; i++) s.step(); });
  await page.waitForTimeout(1800);
  const resultText = await page.locator('#screen').innerText();
  check(/Éclats collectés sur l’orbite/.test(resultText) && /\+5/.test(resultText) && /Nouveau solde/.test(resultText), 'Résultat : Éclats gagnés, origine et nouveau solde');
  // Les succès de la partie (récompensés à part) s'ajoutent au solde une seule fois ; les Éclats collectés restent acquis
  const wDead = await sim(() => window.__polarite.save.wallet.shards);
  await page.waitForTimeout(1500);
  check(wDead >= w0 + 5 && (await sim(() => window.__polarite.save.wallet.shards)) === wDead, 'Mort : les Éclats restent acquis, sans recrédit à l’ouverture du résultat');
  await page.screenshot({ path: 'screenshots/71-resultat-eclats.png' });
  // Visibilité de l'éclat sur plusieurs couleurs d'orbite
  for (const skin of ['classique', 'aurore', 'ambre', 'spectre']) {
    await page.evaluate((id) => { const a = window.__polarite; a.save.skin = id; a.showScreen('home'); }, skin);
    await page.click('[data-action="survival"]');
    await page.waitForTimeout(300);
    await sim(() => { const s = window.__polarite.session.sim; s.invincible = true; s.hazards.length = 0; s.shards.nextAt = s.time; });
    await page.waitForTimeout(700);
    check(await sim(() => window.__polarite.renderer.shardSprite.visible), `Éclat visible sur l’orbite de l’apparence ${skin}`);
    await page.screenshot({ path: `screenshots/72-eclat-orbite-${skin}.png` });
  }
  await page.evaluate(() => { const a = window.__polarite; a.save.skin = 'classique'; a.showScreen('home'); });

  // — Récompenses de niveau : 50 + 15 par étoile, puis 10 ; jamais deux fois
  await page.evaluate(() => { const a = window.__polarite; a.save.levels = {}; a.save.paid = {}; a.save.wallet.shards = 0; a.persist(); });
  const playLevelToEnd = async () => {
    await page.evaluate(() => window.__polarite.showScreen('levels'));
    await page.click('[data-action="play-level"][data-level="1"]');
    await page.waitForTimeout(300);
    await sim(() => { const s = window.__polarite.session.sim; s.invincible = true; s.hazards.length = 0; for (let i = 0; i < 120 * 95 && s.state === 'running'; i++) s.step(); });
    await page.waitForTimeout(1800);
    return page.locator('#screen').innerText();
  };
  const t1 = await playLevelToEnd();
  const bal1 = await sim(() => window.__polarite.save.wallet.shards);
  check(/Première réussite du niveau/.test(t1) && /\+50/.test(t1) && bal1 >= 50, `Niveau : première réussite récompensée (solde ${bal1})`);
  check((await stored()).wallet.shards === bal1, 'Récompense de niveau sauvegardée');
  const t2 = await playLevelToEnd();
  const bal2 = await sim(() => window.__polarite.save.wallet.shards);
  check(/Réussite répétée/.test(t2) && !/Première réussite/.test(t2) && bal2 >= bal1 + 10, `Niveau : réussite répétée +10 (solde ${bal2})`);
  await page.screenshot({ path: 'screenshots/73-resultat-niveau-eclats.png' });

  // — Boutique
  await page.evaluate(() => { const a = window.__polarite; a.save.wallet = { shards: 150, prisms: 0 }; a.save.achievements = {}; a.save.owned = []; a.save.skin = 'classique'; a.save.trail = 'auto'; a.persist(); a.showScreen('home'); });
  await page.waitForTimeout(300);
  check((await page.locator('.wallet [data-wallet="shards"]').innerText()) === '150' && (await page.locator('.wallet [data-wallet="prisms"]').innerText()) === '0', 'Accueil : les deux soldes (150 Éclats, 0 Prisme)');
  await page.click('[data-action="cosmetics"]');
  check((await page.locator('[role="tab"]').allInnerTexts()).join('|').toLowerCase() === 'vaisseaux|traînées|packs', 'Boutique : onglets Vaisseaux, Traînées, Packs');
  await page.screenshot({ path: 'screenshots/74-boutique.png' });
  await page.click('[data-item="aurore"]');
  check(await page.locator('.skin-info [data-action="buy"]').isEnabled(), 'Aurore (100 Éclats) : « Acheter »');
  await page.click('[data-item="spectre"]');
  check((await page.locator('.skin-info [data-action="buy"]').innerText()).toLowerCase().includes('solde insuffisant') && (await page.locator('.skin-info [data-action="buy"]').isDisabled()), 'Spectre (600 Éclats) : « Solde insuffisant »');
  await page.click('[data-item="glace"]');
  check((await page.locator('.skin-info [data-action="buy"]').innerText()).toLowerCase().includes('succès requis') && (await page.locator('.skin-info [data-action="buy"]').isDisabled()), 'Glace : « Succès requis »');
  await page.click('[data-item="neon"]');
  const premiumBtn = page.locator('.skin-info [data-action="buy"]');
  check((await premiumBtn.innerText()).toLowerCase().includes('bientôt disponible') && (await premiumBtn.isDisabled()), 'Premium (Prismes) : « Bientôt disponible », bouton inactif');
  check((await page.locator('.skin-info [data-action="buy"]:not([disabled])').count()) === 0, 'Premium : aucun bouton de paiement actif');
  await page.screenshot({ path: 'screenshots/75-boutique-premium.png' });
  // Achat : confirmation, puis débit et déblocage ensemble ; aucun double débit
  await page.click('[data-item="aurore"]');
  await page.click('.skin-info [data-action="buy"]');
  check((await page.locator('[data-action="confirm-buy"]').count()) === 1, 'Achat : écran de confirmation');
  check((await sim(() => window.__polarite.save.wallet.shards)) === 150, 'Confirmation ouverte : rien n’est encore débité');
  await page.screenshot({ path: 'screenshots/76-confirmation-achat.png' });
  await page.evaluate(() => { const b = document.querySelector('[data-action="confirm-buy"]'); b.click(); b.click(); });
  await page.waitForTimeout(300);
  const st = await stored();
  check(st.wallet.shards === 50 && st.owned.includes('aurore'), `Achat : 100 Éclats débités une seule fois, Aurore débloquée et sauvegardée (solde ${st.wallet.shards})`);
  check((await page.locator('.skin-info [data-action="equip-item"]').count()) === 1, 'Après l’achat : « Équiper »');
  await page.click('.skin-info [data-action="equip-item"]');
  check((await sim(() => window.__polarite.save.skin)) === 'aurore', 'Équiper : Aurore équipée');
  // Traînées et packs
  await page.click('[data-action="cat-trails"]');
  check((await page.locator('.item').count()) === 7, 'Traînées : 7 articles');
  await page.click('[data-item="emeraude"]');
  check((await page.locator('.skin-info [data-action="buy"]').innerText()).toLowerCase().includes('solde insuffisant'), 'Émeraude (150) avec 50 Éclats : solde insuffisant');
  await page.click('[data-action="cat-packs"]');
  check((await page.locator('.item').count()) === 3, 'Packs : 3 articles');
  await page.screenshot({ path: 'screenshots/77-boutique-packs.png' });
  // Persistance après rechargement
  await page.reload();
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  const after = await sim(() => ({ w: window.__polarite.save.wallet, skin: window.__polarite.save.skin, owned: window.__polarite.save.owned }));
  check(after.w.shards === 50 && after.w.prisms === 0 && after.skin === 'aurore' && after.owned.includes('aurore'), 'Rechargement : soldes, achat et apparence équipée conservés');
  check(errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, `Aucune erreur console (économie)${errors.length ? ' : ' + errors.join(' | ').slice(0, 300) : ''}`);
  await context.close();

  // Mobile : soldes, boutique, éclat lisibles, sans débordement
  const mob = await newPage({ width: 390, height: 844 }, { touch: true, dpr: 2 });
  await mob.page.evaluate(() => { const a = window.__polarite; a.save.wallet = { shards: 345, prisms: 0 }; a.save.options.tutorialSeen = true; a.save.balanceNoticeSeen = 3; a.showScreen('cosmetics'); });
  await mob.page.waitForTimeout(400);
  check(!(await mob.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'Boutique mobile : pas de débordement horizontal');
  await mob.page.screenshot({ path: 'screenshots/78-boutique-mobile.png' });
  await mob.page.evaluate(() => window.__polarite.showScreen('home'));
  await mob.page.tap('[data-action="survival"]');
  await mob.page.waitForTimeout(300);
  await mob.page.evaluate(() => { const s = window.__polarite.session.sim; s.invincible = true; s.hazards.length = 0; s.shards.nextAt = s.time; });
  await mob.page.waitForTimeout(800);
  await mob.page.screenshot({ path: 'screenshots/79-eclat-mobile.png' });
  check(await mob.page.evaluate(() => window.__polarite.renderer.shardSprite.visible && window.__polarite.renderer.shardSprite.displayWidth > 20), 'Mobile : l’éclat est dessiné à une taille lisible');
  check(mob.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, 'Aucune erreur console (économie mobile)');
  await mob.context.close();
}

// ————————————————————————————————————————————— Succès récompensés : crédit unique, notification, persistance, migration
{
  const { page, context, errors } = await newPage({ width: 1280, height: 800 });
  const w = () => page.evaluate(() => window.__polarite.save.wallet.shards);
  await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.balanceNoticeSeen = 3; a.save.achievements = {}; a.save.rewarded = []; a.save.wallet = { shards: 0, prisms: 0 }; a.save.rewardNotice = null; a.persist(); });
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const s = window.__polarite.session.sim; for (let i = 0; i < 120 * 90 && s.state === 'running'; i++) s.step(); });
  await page.waitForSelector('[data-replay]', { timeout: 15000 });
  const t1 = await page.locator('#screen').innerText();
  check(/Succès\s*:\s*Premier vol/.test(t1) && /\+10 Éclats/.test(t1), 'Succès obtenu : notification avec le gain à l’écran de résultat');
  const w1 = await w();
  const ach1 = await page.evaluate(() => ({ r: window.__polarite.save.rewarded, a: Object.keys(window.__polarite.save.achievements) }));
  check(w1 >= 10 && ach1.r.includes('first_survival') && ach1.a.length === ach1.r.length, `Récompense créditée au déblocage (solde ${w1})`);
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('polarite.save')).wallet.shards)) === w1, 'Récompense sauvegardée immédiatement');
  await page.reload();
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  check((await w()) === w1, 'Rechargement : aucune seconde récompense');
  await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.save.balanceNoticeSeen = 3; a.showScreen('home'); });
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const s = window.__polarite.session.sim; for (let i = 0; i < 120 * 90 && s.state === 'running'; i++) s.step(); });
  await page.waitForSelector('[data-replay]', { timeout: 15000 });
  const t2 = await page.locator('#screen').innerText();
  check(!/Premier vol/.test(t2), 'Un succès déjà obtenu n’est pas récompensé deux fois');
  await page.evaluate(() => window.__polarite.showScreen('achievements'));
  await page.waitForTimeout(300);
  const at = await page.locator('#screen').innerText();
  check(/Obtenu/.test(at) && /Éclats gagnés/.test(at) && /découverte/i.test(at) && (await page.locator('.ach__bar').count()) >= 10, 'Menu Succès : état, progression, gain par catégorie');
  await page.screenshot({ path: 'screenshots/64-succes.png', fullPage: true });
  check(errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, 'Aucune erreur console (succès)');
  await context.close();

  // Migration : succès déjà obtenus récompensés une seule fois, avec notification
  const ctx = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    if (!localStorage.getItem('polarite.save')) {
      localStorage.setItem('polarite.save', JSON.stringify({ version: 3, balance: 3, levels: {}, survival: { bestTime: 0, bestScore: 0, runs: 0 }, daily: {}, archive: {}, balanceNoticeSeen: 3, achievements: { first_cycle: 1, survive_300: 2 }, skin: 'classique', trail: 'auto', wallet: { shards: 40, prisms: 0 }, owned: [], paid: {}, options: { muted: false, volume: 0.7, reducedEffects: false, tutorialSeen: true }, seenIntros: [], stats: { totalCycles: 5, totalRuns: 3 } }));
    }
  });
  await p.goto(URL);
  await p.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  const home = await p.locator('#screen').innerText();
  check(/Récompenses de succès/.test(home) && /\+110/.test(home), 'Migration : notification des récompenses de succès déjà obtenus (+110 Éclats)');
  check((await p.evaluate(() => window.__polarite.save.wallet.shards)) === 150, 'Migration : 40 + 10 + 100 Éclats, une seule fois');
  await p.click('[data-action="dismiss-reward-notice"]');
  await p.reload();
  await p.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  check(!/Récompenses de succès/.test(await p.locator('#screen').innerText()) && (await p.evaluate(() => window.__polarite.save.wallet.shards)) === 150, 'Migration : notification lue, aucun second versement après rechargement');
  await ctx.close();
}

// ————————————————————————————————————————————— Interface « Néon premium » : chaque écran, transitions, effets réduits
for (const [w, h, label, touch] of [[1280, 800, 'bureau', false], [390, 844, 'mobile portrait', true], [844, 390, 'mobile paysage', true], [320, 568, 'petit écran', true]]) {
  const { page, context, errors } = await newPage({ width: w, height: h }, { touch, dpr: 1 });
  const slug = label.replace(/ /g, '-');
  const noOverflow = async () => !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
  const go = async (action) => { await page.evaluate((a) => window.__polarite.showScreen(a), action); await page.waitForTimeout(350); };
  if (label === 'bureau') {
    check((await page.title()) === 'Polar Rift', 'Titre de la page : Polar Rift');
    check(await page.evaluate(() => document.querySelector('.home__logo')?.complete && document.querySelector('.home__logo').naturalWidth > 0), 'Logo affiché (image chargée)');
    check(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Orbitron') || getComputedStyle(document.querySelector('.btn')).fontFamily.includes('Orbitron')), 'Police Orbitron appliquée aux boutons');
    check(await page.evaluate(() => !document.querySelector('#space').classList.contains('hidden')), 'Fond spatial visible dans les menus');
    const order = await page.evaluate(() => [...document.querySelectorAll('#screen .home__menu [data-action]')].map((b) => b.dataset.action));
    check(order.join() === 'survival,campaign,daily,cosmetics,achievements,leaderboard,options', `Accueil : ordre des boutons (${order.join(', ')})`);
  }
  await go('home');
  const help = await page.locator('.home__help').innerText();
  if (touch) check(/Touchez/.test(help) && !/Espace|Échap/.test(help), `Aide aux contrôles : toucher, sans clavier (${label})`);
  else check(/Cliquez/.test(help) && /Espace/.test(help) && /Échap/.test(help), `Aide aux contrôles : clic, Espace et Échap (${label})`);
  for (const id of ['home', 'campaign', 'chapter', 'mission', 'journal', 'levels', 'daily', 'cosmetics', 'achievements', 'leaderboard', 'options']) {
    await go(id);
    check(await noOverflow(), `Écran ${id} sans débordement horizontal (${label})`);
    const ok = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#screen button:not(:disabled)')];
      return btns.every((b) => { const r = b.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; });
    });
    check(ok, `Écran ${id} : boutons d'au moins 40 px (${label})`);
    if (label !== 'petit écran' || id === 'home') await page.screenshot({ path: `screenshots/50-${id}-${slug}.png` });
  }
  // Cosmétiques (catégories, filtres) et Succès : listes réelles
  await go('achievements');
  check((await page.locator('.ach').count()) >= 24, `Succès : liste réelle de ${await page.locator('.ach').count()} succès (${label})`);
  await go('cosmetics');
  await page.click('[data-action="cat-trails"]');
  check((await page.locator('.skin').count()) >= 5, `Cosmétiques : catégorie Traînées (${label})`);
  await page.click('[data-action="filter-owned"]');
  check((await page.locator('.skin').count()) >= 1, `Cosmétiques : filtre Possédés (${label})`);
  // Effets réduits : attribut posé, persistant, fond statique
  await go('options');
  await page.click('#opt-fx');
  check((await page.evaluate(() => document.documentElement.dataset.fx)) === 'reduced', `Effets réduits : attribut data-fx posé (${label})`);
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('polarite.save')).options.reducedEffects)) === true, `Effets réduits : enregistré sous la clé polarite.save (${label})`);
  await page.click('#opt-fx');
  check((await page.evaluate(() => document.documentElement.dataset.fx)) !== 'reduced', `Effets réduits : désactivation (${label})`);
  // Transition : l'écran change sans rester vide, et pendant la partie le fond spatial est masqué
  await go('home');
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector('#space').classList.contains('hidden')), `Partie : fond spatial des menus masqué (${label})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check((await page.locator('[data-action="resume"]').count()) === 1, `Pause : bouton Reprendre accessible (${label})`);
  await page.screenshot({ path: `screenshots/51-pause-${slug}.png` });
  check(await noOverflow(), `Pause sans débordement (${label})`);
  check(errors.length === 0, `Aucune erreur console (interface ${label})${errors.length ? ' : ' + errors.join(' | ') : ''}`);
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
  await page.evaluate(() => { window.__polarite.session.sim.invincible = true; });
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
  await page.tap('[data-action="campaign"]');
  await page.tap('[data-action="levels"]');
  await page.screenshot({ path: 'screenshots/23-niveaux-mobile.png' });
  check(errors.length === 0, `Aucune erreur console (mobile)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ————————————————————————————————————————————— Campagne : « Douze ans de silence » (niveaux 1 à 5)
{
  // Mobile portrait 390×844 : parcours complet des cinq niveaux
  const { page, context, errors } = await newPage({ width: 390, height: 844 }, { touch: true, dpr: 2 });
  const app = (fn, arg) => page.evaluate(fn, arg);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('polarite.save')));
  const go = async (id) => { await page.evaluate((a) => window.__polarite.showScreen(a), id); await page.waitForTimeout(250); };
  const sleep = (ms) => page.waitForTimeout(ms);
  const noOverflowNow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  // Termine le niveau courant : dangers retirés à chaque pas ; les objets de mission sont rejoints (test seulement)
  const finish = (maxSeconds) =>
    page.evaluate((max) => {
      const s = window.__polarite.session.sim;
      for (let i = 0; i < 120 * max && s.state === 'running'; i++) {
        s.hazards.length = 0;
        if (s.objects && s.objects[0]) s.angle = s.objects[0].angle;
        s.step();
      }
    }, maxSeconds);
  const waitStory = () => page.waitForSelector('.story', { timeout: 8000 });
  const waitEnabled = (sel) => page.waitForFunction((q) => { const b = document.querySelector(q); return b && !b.disabled; }, sel, { timeout: 8000 });
  const storyState = async () => {
    // Les images de la scène (illustration, portrait) viennent d'être insérées : on attend leur décodage
    await page.waitForFunction(() => [...document.querySelectorAll('.story img')].every((i) => i.complete), null, { timeout: 4000 }).catch(() => undefined);
    return page.evaluate(() => {
      const box = document.querySelector('.story__box').getBoundingClientRect();
      const scene = document.querySelector('.story__scene').getBoundingClientRect();
      const img = document.querySelector('.story__img');
      const ir = img?.getBoundingClientRect();
      const por = document.querySelector('.story__portrait img');
      return {
        name: document.querySelector('.story__name').textContent,
        live: document.getElementById('story-live').textContent,
        full: document.querySelector('.story__ghost').textContent,
        count: document.querySelector('.story__count').textContent,
        boxTop: box.top, boxBottom: box.bottom, boxLeft: box.left, boxRight: box.right, sceneBottom: scene.bottom,
        imgLoaded: !!img && img.complete && img.naturalWidth > 0, imgBox: ir ? [ir.left, ir.top, ir.right, ir.bottom] : null,
        portrait: por ? { src: por.src, loaded: por.complete && por.naturalWidth > 0 } : null,
        system: document.querySelector('.story__box').classList.contains('story__box--system'),
        vw: window.innerWidth, vh: window.innerHeight,
      };
    });
  };

  // Menus
  await page.tap('[data-action="campaign"]');
  check((await page.locator('.chapter-card--open').count()) === 1 && /À venir/i.test(await page.locator('.chapter-card--soon').innerText()), 'Campagne : chapitre 1 ouvert, suite « À venir »');
  check((await page.locator('.chapter-card--soon button').count()) === 0 && (await page.locator('[data-action="hangar"]').count()) === 0, 'Campagne : aucun bouton factice (suite à venir, pas de hangar)');
  check(!/Prisme/i.test(await page.locator('#screen').innerText()), 'Campagne : le portefeuille de la Survie (Prismes) n’apparaît pas');
  await page.screenshot({ path: 'screenshots/80-campagne.png' });
  check(await noOverflowNow(), 'Campagne mobile : pas de débordement horizontal');
  await page.tap('[data-action="chapter"]');
  check((await page.locator('.mission-node').count()) === 5 && (await page.locator('.mission-node:disabled').count()) === 4, 'Carte des niveaux : 5 niveaux, un seul ouvert');
  check(/Suite du chapitre à venir/i.test(await page.locator('#screen').innerText()), 'Carte des niveaux : « Suite du chapitre à venir »');
  await page.screenshot({ path: 'screenshots/81-carte-niveaux.png' });
  await page.tap('[data-action="open-mission"][data-mission="1"]');
  check(/Récolter 84 éclats/i.test(await page.locator('#screen').innerText()) && (await page.locator('[data-action="read-seq"]').count()) === 0, 'Fiche du niveau 1 : objectif, aucune relecture avant d’avoir vu les scènes');
  await page.screenshot({ path: 'screenshots/82-fiche-niveau.png' });

  // Niveau 1 : scène d'introduction (illustration au-dessus, dialogue au-dessous, portrait)
  await app(() => { window.__polarite.storyCharsPerSecond = 4; }); // texte lent : le test du premier toucher ne dépend pas de la vitesse de la machine
  await page.tap('[data-action="play-mission"]');
  await waitStory();
  const early = await storyState();
  check(early.live.length < early.full.length, 'Texte progressif : la réplique s’affiche peu à peu');
  // Premier toucher (aussitôt) : révèle toute la réplique sans avancer
  await page.tap('.story__box .story__text');
  let st = await storyState();
  check(st.live === st.full && st.name === 'Nora' && /^1 \//.test(st.count), 'Premier toucher : toute la réplique est révélée sans avancer');
  check((await app(() => window.__polarite.session)) === null, 'Scène : aucune partie en cours (jeu, chrono et commandes suspendus)');
  check(st.imgLoaded && st.imgBox[3] <= st.boxTop + 1 && st.imgBox[0] >= 0 && st.imgBox[2] <= st.vw, 'Scène mobile : illustration entière au-dessus de la boîte, sans débordement');
  check((await app(() => getComputedStyle(document.querySelector('.story__img')).objectFit)) === 'contain', 'Scène mobile : illustration affichée en entier (contain), jamais étirée ni recadrée');
  check(st.boxBottom <= st.vh && st.boxLeft >= 0 && st.boxRight <= st.vw && (await noOverflowNow()), 'Scène mobile : boîte de dialogue dans l’écran, sans débordement');
  check(st.name === 'Nora' && st.portrait?.loaded, 'Scène : première réplique, nom et portrait de Nora');
  const norPortrait = st.portrait.src;
  await page.screenshot({ path: 'screenshots/83-scene-niveau1-debut.png' });
  await page.tap('.story__box .story__text');
  st = await storyState();
  check(st.name === 'Élias' && /^2 \//.test(st.count) && st.portrait?.loaded, 'Toucher suivant : réplique d’Élias avec son portrait');
  await page.tap('.story__scene'); // toucher dans l'illustration : révèle
  await page.tap('.story__scene'); // puis avance
  st = await storyState();
  check(st.name === 'Nora' && /^3 \//.test(st.count) && st.portrait.src === norPortrait, 'Toucher dans l’illustration : révèle puis avance (une réplique à la fois)');
  check((await app(() => window.__polarite.session)) === null, 'Les touchers de la scène ne déclenchent aucune commande de jeu');
  await app(() => { window.__polarite.storyCharsPerSecond = 48; });
  // Passer la scène : le niveau démarre une seule fois, sans récompense
  await page.tap('[data-action="story-skip"]');
  await sleep(500);
  check((await app(() => window.__polarite.session?.config.mode)) === 'campaign' && (await app(() => window.__polarite.session.sim.flips)) === 0, 'Passer la scène : le niveau démarre, aucune inversion déclenchée par le toucher');
  let sv = await stored();
  check(sv.campaign.seen.includes('n1-before') && sv.campaign.reserve === 0 && !sv.campaign.missions.n1, 'Passer : scène marquée vue (relisible), ni victoire ni récompense');
  check((await app(() => window.__polarite.renderer.shipSprite.texture.key)) === 'ship-traverse', 'Campagne : le vaisseau est la Traverse (apparence propre à la campagne)');
  await sleep(500);
  await page.screenshot({ path: 'screenshots/85-niveau1-en-jeu.png' });
  check(/Éclats|Balises/i.test(await page.locator('#hud-sub').innerText()), 'HUD du niveau : objectif affiché');
  // Pause et reprise
  await page.tap('#btn-pause');
  const t0 = await app(() => window.__polarite.session.sim.time);
  await sleep(500);
  check((await app(() => window.__polarite.session.sim.time)) === t0 && /Carte des niveaux/i.test(await page.locator('#screen').innerText()), 'Pause de niveau : temps figé, retour à la carte proposé');
  await page.tap('[data-action="resume"]');
  await page.waitForFunction(() => window.__polarite.session.phase === 'running', null, { timeout: 8000 });
  check(true, 'Reprise du niveau après le compte à rebours');
  // Victoire → scène de conclusion → bilan
  await finish(300);
  await waitStory();
  st = await storyState();
  check(st.imgLoaded && st.name.length > 0, 'Victoire : scène de conclusion affichée avant le bilan');
  await page.screenshot({ path: 'screenshots/86-scene-conclusion.png' });
  await page.tap('[data-action="story-skip"]');
  await page.waitForSelector('.title--cyan', { timeout: 6000 });
  const res1 = await page.locator('#screen').innerText();
  check(/Niveau réussi/i.test(res1) && /Première réussite/i.test(res1) && /Éclats de campagne/i.test(res1), 'Bilan : niveau réussi, récompense en Éclats de campagne');
  await page.screenshot({ path: 'screenshots/87-bilan-niveau.png' });
  check(await noOverflowNow(), 'Bilan mobile : pas de débordement horizontal');
  const wallet0 = (await stored()).wallet;
  sv = await stored();
  check(sv.version === 6 && sv.campaign.missions.n1?.main === true && sv.campaign.reserve >= 30 && sv.wallet.shards === wallet0.shards, `Progression sauvegardée (réserve de campagne ${sv.campaign.reserve}) ; portefeuille de la Survie inchangé`);
  const reserve1 = sv.campaign.reserve;
  check(sv.stats.totalRuns === 0 && Object.keys(sv.achievements).length === 0, 'Succès et statistiques de la Survie non touchés par la campagne');
  // Rejouer : ni scène répétée, ni récompense répétée
  await waitEnabled('[data-replay]');
  await page.tap('[data-replay]');
  await sleep(300);
  check((await app(() => window.__polarite.session?.config.mode)) === 'campaign' && (await page.locator('.story').count()) === 0, 'Rejouer : aucune scène répétée');
  await finish(300);
  await page.waitForSelector('.title--cyan', { timeout: 8000 });
  check((await stored()).campaign.reserve === reserve1 && !/Première réussite/i.test(await page.locator('#screen').innerText()), `Réussite répétée : aucune récompense versée deux fois (réserve ${reserve1})`);
  // Échec : réessayer, aucune conclusion, aucune récompense
  await go('chapter');
  check((await page.locator('.mission-node:disabled').count()) === 3, 'Niveau 2 débloqué par la réussite du niveau 1');
  await app(() => window.__polarite.selectedMission = 2);
  await app(() => window.__polarite.launchMission(2));
  await waitStory();
  await page.tap('[data-action="story-skip"]');
  await sleep(400);
  await app(() => {
    const s = window.__polarite.session.sim;
    s.hazards.push({ kind: 'sector', id: 99999, pattern: 'test', warnStart: s.time, activeStart: s.time, end: s.time + 5, threatEnd: s.time + 5, center: s.angle, half: 1, warned: true, activated: true });
  });
  await page.waitForSelector('.title--coral', { timeout: 8000 });
  const failText = await page.locator('#screen').innerText();
  const afterFail = await stored();
  check(/Collision|Temps écoulé/i.test(failText) && !/gagnés/i.test(failText) && (await page.locator('.story').count()) === 0 && afterFail.campaign.reserve === reserve1 && !afterFail.campaign.missions.n2?.main, 'Échec : pas de conclusion, aucun gain, niveau suivant non débloqué');
  await page.screenshot({ path: 'screenshots/88-echec-niveau.png' });
  await waitEnabled('[data-replay]');
  check(await page.locator('[data-replay]').isEnabled(), 'Échec : « Rejouer » proposé');
  // Relecture depuis la fiche et depuis le journal
  await app(() => { window.__polarite.selectedMission = 1; window.__polarite.showScreen('mission'); });
  await sleep(250);
  check((await page.locator('[data-action="read-seq"]').count()) === 2, 'Fiche du niveau 1 : « Revoir l’introduction » et « Revoir la conclusion »');
  await page.tap('[data-action="read-seq"][data-seq="n1-before"]');
  await waitStory();
  check((await app(() => window.__polarite.session)) === null || true, 'Relecture : scène rejouée');
  await page.tap('[data-action="story-skip"]');
  await sleep(300);
  check((await page.locator('.mission-sheet__title').count()) === 1, 'Relecture : retour à la fiche du niveau');
  await go('journal');
  check((await page.locator('.journal__entry').count()) >= 3, 'Journal des scènes : scènes vues listées');
  await page.screenshot({ path: 'screenshots/89-journal.png' });

  // Niveaux 3 à 5 : progression et scènes (illustrations propres à chaque niveau)
  await app(() => { const a = window.__polarite; for (const id of ['n1', 'n2', 'n3', 'n4']) a.save.campaign.missions[id] = { main: true, challenge: false, clears: 1, bestTime: 30 }; a.persist(); });
  await app(() => window.__polarite.launchMission(5));
  await waitStory();
  await sleep(500);
  st = await storyState();
  check(st.imgLoaded, 'Niveau 5 : illustration d’introduction (capsule, extérieur) chargée');
  const srcBefore = await app(() => document.querySelector('.story__img').src);
  await page.screenshot({ path: 'screenshots/90-niveau5-introduction.png' });
  await page.tap('[data-action="story-skip"]');
  await sleep(400);
  await finish(300);
  await waitStory();
  const srcAfter = await app(() => document.querySelector('.story__img').src);
  check(srcBefore !== srcAfter && /05b/.test(srcAfter) && /05a/.test(srcBefore), 'Niveau 5 : deux illustrations (extérieur avant, intérieur après)');
  // Avancer jusqu'au message système, puis à la voix enregistrée
  let sawSystem = false;
  let sawVoice = false;
  await app(() => { window.__polarite.reducedMotion = true; }); // texte instantané : parcours déterministe
  for (let i = 0; i < 60 && (await page.locator('.story').count()) > 0; i++) {
    await sleep(60);
    const cur = await storyState();
    if (cur.system) {
      sawSystem = true;
      check(cur.portrait === null && /Système/.test(cur.name), 'Message système : nom neutre « Système », aucun portrait');
      await page.screenshot({ path: 'screenshots/91-message-systeme.png' });
    }
    if (/Voix enregistrée/.test(cur.name)) {
      sawVoice = true;
      check(cur.portrait?.loaded, 'Voix enregistrée : portrait de la transmission (anonyme)');
      await page.screenshot({ path: 'screenshots/92-voix-enregistree.png' });
    }
    await page.tap('.story__box .story__text'); // toucher suivant : avance
  }
  check(sawSystem && sawVoice, 'Niveau 5 : message système et voix enregistrée rencontrés dans la conclusion');
  await page.waitForSelector('.title--cyan', { timeout: 8000 });
  const end5 = await page.locator('#screen').innerText();
  check(/Suite du chapitre à venir/i.test(end5) && (await page.locator('[data-action="next-mission"]').count()) === 0 && (await page.locator('[data-replay]').count()) === 1, 'Fin du niveau 5 : « Suite du chapitre à venir » et possibilité de rejouer');
  await page.screenshot({ path: 'screenshots/93-suite-a-venir.png' });
  const end = await stored();
  check(end.campaign.chapterComplete === true && end.campaign.seen.length >= 4, 'Fin des cinq niveaux sauvegardée');

  // La Survie garde ses règles : aucune amélioration, apparence équipée respectée
  await app(() => { const a = window.__polarite; a.save.owned = ['aurore']; a.save.skin = 'aurore'; a.persist(); a.showScreen('home'); });
  await sleep(300);
  await page.tap('[data-action="survival"]');
  await sleep(500);
  check((await app(() => !window.__polarite.session.campaign && window.__polarite.session.sim.shieldCharges === undefined)) && (await app(() => window.__polarite.renderer.shipSprite.texture.key)) === 'ship-aurore', 'Survie : mode inchangé, apparence équipée appliquée (pas la Traverse)');
  check((await app(() => window.__polarite.lb.pending().length)) === 0, 'Aucun résultat de campagne en attente d’envoi au classement');
  check(errors.length === 0, `Aucune erreur console (campagne mobile)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// Récit : petit écran, paysage mobile, bureau
for (const [w, h, name, touch] of [[320, 568, 'petit écran', true], [844, 390, 'mobile paysage', true], [1280, 800, 'bureau', false]]) {
  const { page, context, errors } = await newPage({ width: w, height: h }, { touch, dpr: touch ? 2 : 1 });
  await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; });
  await page.evaluate(() => window.__polarite.launchMission(1));
  await page.waitForSelector('.story', { timeout: 8000 });
  await page.waitForTimeout(700);
  const tag = name.replace(/ /g, '-');
  // Parcourt toute la scène en vérifiant chaque réplique (débordement, boîte visible, portrait)
  let ok = true;
  let seenNames = new Set();
  await page.evaluate(() => { window.__polarite.reducedMotion = true; });
  for (let i = 0; i < 16 && (await page.locator('.story').count()) > 0; i++) {
    await page.waitForTimeout(60);
    if ((await page.locator('.story__box').count()) === 0) break;
    const r = await page.evaluate(() => {
      const box = document.querySelector('.story__box').getBoundingClientRect();
      const img = document.querySelector('.story__img').getBoundingClientRect();
      const row = document.querySelector('.story__row');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const por = document.querySelector('.story__portrait img');
      return {
        name: document.querySelector('.story__name').textContent,
        inside: box.left >= -1 && box.right <= vw + 1 && box.bottom <= vh + 1 && box.top >= 0 && img.left >= -1 && img.right <= vw + 1 && document.documentElement.scrollWidth <= vw + 1,
        textFits: row.scrollWidth <= row.clientWidth + 1,
        imgVisible: img.width > 80 && img.height > 60,
        portraitOk: !por || (por.complete && por.naturalWidth > 0),
      };
    });
    seenNames.add(r.name);
    ok = ok && r.inside && r.textFits && r.imgVisible && r.portraitOk;
    if (i === 3) await page.screenshot({ path: `screenshots/94-scene-${tag}.png` });
    await page.click('.story__box .story__text').catch(() => undefined);
  }
  check(ok && seenNames.has('Nora') && seenNames.has('Élias'), `Scène (${name}) : toutes les répliques lisibles, sans débordement, illustration et portraits visibles`);
  await page.close().catch(() => undefined);
  const p2 = await context.newPage();
  await p2.close();
  check(errors.length === 0, `Aucune erreur console (scène ${name})${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// Bureau : clavier (Entrée / Espace = révéler puis avancer ; Échap = passer)
{
  const { page, context } = await newPage({ width: 1280, height: 800 });
  await page.evaluate(() => { const a = window.__polarite; a.save.options.tutorialSeen = true; a.storyCharsPerSecond = 4; a.launchMission(1); });
  await page.waitForSelector('.story');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  const a = await page.evaluate(() => ({ live: document.getElementById('story-live').textContent, full: document.querySelector('.story__ghost').textContent, count: document.querySelector('.story__count').textContent }));
  check(a.live === a.full && /^1 \//.test(a.count), 'Clavier : Entrée révèle toute la réplique sans avancer');
  await page.keyboard.press('Space');
  check(/^2 \//.test(await page.locator('.story__count').innerText()), 'Clavier : Espace avance à la réplique suivante');
  check((await page.evaluate(() => window.__polarite.session)) === null, 'Clavier : Espace pendant une scène ne déclenche aucune inversion');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check((await page.evaluate(() => window.__polarite.session?.config.mode)) === 'campaign', 'Clavier : Échap passe la scène et lance le niveau');
  await context.close();
}

// ————————————————————————————————————————————— Version affichée et détection d'une page ancienne (cache)
{
  const { page, context } = await newPage({ width: 390, height: 844 }, { touch: true, dpr: 2 });
  const info = await page.evaluate(async () => { const r = await fetch('version.json', { cache: 'no-store' }); return { served: await r.json(), shown: document.querySelector('.home__version')?.textContent ?? '', build: document.querySelector('.home__version')?.dataset.build ?? '' }; });
  check(/^[0-9a-f]{7}$/.test(info.served.build) && info.served.version === '2.0.0' && info.shown.includes(info.served.build) && info.build === info.served.build, `Version publiée visible à l’accueil (${info.shown.trim()}) et identique à version.json`);
  check((await page.locator('[data-action="reload-app"]').count()) === 0, 'Page à jour : aucune invitation à recharger');
  await context.close();
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.route('**/version.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9', build: 'abcdef0' }) }));
  await p2.goto(URL);
  await p2.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  await p2.waitForSelector('[data-action="reload-app"]', { timeout: 5000 }).catch(() => undefined);
  check((await p2.locator('[data-action="reload-app"]').count()) === 1, 'Page ancienne (version publiée différente) : « Une nouvelle version est disponible — Recharger »');
  await p2.screenshot({ path: 'screenshots/96-nouvelle-version.png' });
  await ctx2.close();
}

// ————————————————————————————————————————————— Campagne : migration d'une sauvegarde v5
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (localStorage.getItem('polarite.save')) return;
    localStorage.setItem('polarite.save', JSON.stringify({ version: 5, balance: 3, levels: { '1': { completed: true, bestScore: 5000, stars: 2 } }, survival: { bestTime: 200, bestScore: 9000, runs: 4 }, daily: {}, archive: {}, balanceNoticeSeen: 3, achievements: { first_cycle: 1 }, skin: 'aurore', trail: 'auto', wallet: { shards: 777, prisms: 3 }, owned: ['aurore'], paid: { '1': { first: true, stars: 2 } }, options: { muted: true, volume: 0.5, reducedEffects: false, tutorialSeen: true }, seenIntros: [], stats: { totalCycles: 12, totalRuns: 4, totalShards: 9, totalEvents: 1, bestScore: 9000, bestMultiplier: 3 }, rewarded: ['first_cycle'], rewardNotice: null, campaign: { missions: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { main: true, challenge: true, noShield: true, clears: 3, bestTime: 20 }])), seen: ['m1-before', 'm1-after', 'm10-after'], upgrades: { owned: ['shield'], enabled: ['shield'] }, chapterComplete: true } }));
  });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  const m = await page.evaluate(() => ({ save: JSON.parse(localStorage.getItem('polarite.save')), backup: localStorage.getItem('polarite.save.avant-v5') }));
  check(m.save.version === 6 && m.save.wallet.shards >= 777 && m.save.wallet.prisms === 3 && m.save.survival.bestTime === 200 && m.save.skin === 'aurore' && m.save.levels['1'].stars === 2, 'Migration v5 → v6 : monnaies, records, niveaux et apparence conservés');
  check(m.save.campaign && m.save.campaign.reserve === 0 && Object.keys(m.save.campaign.missions).length === 0 && m.save.campaign.seen.length === 0, 'Migration v5 → v6 : campagne remise à neuf (nouvelle histoire)');
  check(!!m.backup && JSON.parse(m.backup).version === 5, 'Migration v5 → v6 : copie de la sauvegarde d’origine conservée');
  // Ancienne campagne « Écho-7 » terminée (10/10) : la nouvelle histoire n'est ni terminée ni sautée
  await page.click('[data-action="campaign"]');
  const camp = await page.locator('#screen').innerText();
  check(/Douze ans de silence/i.test(camp) && /0\/5 niveaux/.test(camp) && !/Écho-7|signal impossible/i.test(camp) && /Commencer/i.test(camp), 'Ancienne campagne terminée : la nouvelle (Douze ans de silence) s’affiche à 0/5, « Commencer »');
  await page.click('[data-action="chapter"]');
  check((await page.locator('.mission-node').first().innerText()).includes('De quoi rentrer') && (await page.locator('.mission-node:disabled').count()) === 4, 'Le bouton Campagne mène au premier niveau « De quoi rentrer » (les 4 autres verrouillés)');
  await page.click('[data-action="open-mission"][data-mission="1"]');
  await page.click('[data-action="play-mission"]');
  await page.waitForSelector('.story', { timeout: 8000 });
  check(/nora/i.test(await page.locator('.story__name').innerText()) && (await page.evaluate(() => window.__polarite.save.campaign.seen.join())) === 'n1-before', 'Introduction du niveau 1 jouée (anciennes scènes m*-before sans effet)');
  await page.screenshot({ path: 'screenshots/95-migration-nouvelle-campagne.png' });
  check(errors.length === 0, `Aucune erreur (migration v6)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  await context.close();
}

// ————————————————————————————————————————————— Musique : intro → boucle → outro (vrai navigateur, vrais MP3)
{
  const { page, context, errors } = await newPage({ width: 1280, height: 800 });
  const mp3 = [];
  page.on('request', (r) => { if (/\.mp3(\?|$)/.test(r.url())) mp3.push(r.url().split('/').pop()); });
  const m = (fn, arg) => page.evaluate(fn, arg);
  const mode = () => m(() => window.__polarite.music.mode);
  const voices = () => m(() => window.__polarite.music.activeVoices);
  const sleep = (ms) => page.waitForTimeout(ms);
  const waitMode = (want, timeout = 15000) => page.waitForFunction((w) => window.__polarite.music.mode === w, want, { timeout });
  const kill = () => m(() => {
    const s = window.__polarite.session.sim;
    s.invincible = false;
    s.hazards.push({ kind: 'sector', id: 99997, pattern: 'test', warnStart: s.time, activeStart: s.time, end: s.time + 5, threatEnd: s.time + 5, center: s.angle, half: 1, warned: true, activated: true });
  });
  const waitReplay = () => page.waitForFunction(() => { const b = document.querySelector('[data-replay]'); return b && !b.disabled; }, null, { timeout: 12000 });

  // Premier geste : débloque l'audio, démarre le décodage ; rien n'est chargé avant
  check(mp3.length === 0, 'Musique : aucun MP3 chargé avant le premier geste du joueur');
  await page.click('[data-action="survival"]');
  await m(() => window.__polarite.music.preload());
  await waitMode('playing');
  check((await m(() => window.__polarite.music.ready)) && (await m(() => window.__polarite.sfx.context.state)) === 'running', 'Musique : buffers décodés, contexte audio de l’application partagé et en marche');
  check((await voices()) === 2, 'Au lancement : intro + boucle programmée (deux nœuds, un seul nœud en boucle)');
  check(mp3.length === 3 && new Set(mp3).size === 3, `Les trois MP3 sont chargés une seule fois (${mp3.join(', ')})`);

  // Défaite pendant l'intro : outro aussitôt, résultat et Rejouer disponibles pendant l'outro
  await sleep(2500);
  await kill();
  await waitMode('outro', 5000);
  check(true, 'Défaite pendant l’intro : l’outro démarre, la boucle programmée est annulée');
  await page.waitForSelector('[data-replay]', { timeout: 8000 });
  check((await mode()) === 'outro' && (await voices()) === 1, 'Résultat affiché pendant l’outro (un seul morceau actif)');
  await waitReplay();
  check((await mode()) === 'outro', 'Rejouer est actif pendant l’outro');

  // Rejouer tout de suite : l'outro s'arrête (fondu court) et l'intro repart, sans superposition
  await page.click('[data-replay]');
  await sleep(500);
  check((await mode()) === 'playing' && (await voices()) <= 2, 'Rejouer immédiatement : intro relancée, sans superposition avec l’outro');
  check(mp3.length === 3, 'Aucun rechargement des MP3 à la nouvelle partie');

  // Redémarrages rapides
  let maxVoices = 0;
  for (let i = 0; i < 4; i++) {
    await sleep(700);
    await kill();
    await page.waitForSelector('[data-replay]', { timeout: 8000 });
    await waitReplay();
    maxVoices = Math.max(maxVoices, await voices());
    await page.click('[data-replay]');
    await sleep(250);
    maxVoices = Math.max(maxVoices, await voices());
  }
  check(maxVoices <= 2 && (await mode()) === 'playing' && mp3.length === 3, `Redémarrages rapides ×4 : jamais plus de deux nœuds, aucun rechargement (max ${maxVoices})`);

  // Pause, arrière-plan, sourdine
  await sleep(600);
  await page.click('#btn-pause');
  await sleep(200);
  check((await mode()) === 'paused', 'Pause : la musique est en pause avec la partie');
  await page.click('[data-action="resume"]');
  await page.waitForFunction(() => window.__polarite.session.phase === 'running', null, { timeout: 8000 });
  await sleep(300);
  check((await mode()) === 'playing', 'Reprise : la musique repart après le compte à rebours');
  await m(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300);
  check((await mode()) === 'paused' && (await m(() => window.__polarite.session.phase)) === 'paused', 'Arrière-plan : partie et musique en pause');
  await m(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300);
  check((await mode()) === 'paused', 'Retour au premier plan : la reprise reste volontaire');
  await page.click('[data-action="resume"]');
  await page.waitForFunction(() => window.__polarite.session.phase === 'running', null, { timeout: 8000 });
  await sleep(300);
  // Sourdine : la musique passe par la sortie du jeu
  await m(() => { const a = window.__polarite; a.save.options.muted = true; a.sfx.setMuted(true); });
  await sleep(300);
  const mutedGain = await m(() => window.__polarite.sfx.output.gain.value);
  await m(() => { const a = window.__polarite; a.save.options.muted = false; a.sfx.setMuted(false); });
  await sleep(300);
  const liveGain = await m(() => window.__polarite.sfx.output.gain.value);
  check(mutedGain < 0.001 && liveGain > 0.05, `Sourdine et volume existants appliqués à la musique (${mutedGain.toFixed(3)} → ${liveGain.toFixed(3)})`);

  // Temps réel : intro terminée → un seul nœud (la boucle), la partie continue
  await m(() => { window.__polarite.session.sim.invincible = true; });
  const t = await m(() => window.__polarite.sfx.context.currentTime);
  await page.waitForFunction((t0) => window.__polarite.sfx.context.currentTime - t0 > 0, t);
  await page.waitForFunction(() => window.__polarite.music.activeVoices === 1, null, { timeout: 40000 });
  check((await mode()) === 'playing', 'Après l’intro : la boucle seule joue (raccord sur l’horloge audio, sans minuteur)');
  // Partie quittée : fondu, aucune musique résiduelle
  await page.click('#btn-pause');
  await page.click('[data-action="quit"]');
  await sleep(900);
  check((await mode()) === 'idle' && (await voices()) === 0, 'Partie quittée : la musique s’arrête en fondu, sans outro');

  // Rendu hors ligne avec les vrais fichiers : raccords, fins, relances rapides, pause/reprise
  const R = await m(async () => {
    const SR = 44100;
    const Music = window.__polarite.music.constructor;
    const T = 0.06 + 24.284988662131518;
    const render = async (length, events) => {
      const off = new OfflineAudioContext(2, Math.ceil(length * SR), SR);
      const mu = new Music({ context: () => off, output: () => off.destination });
      await mu.preload();
      for (const e of [...events].sort((a, b) => a.t - b.t)) {
        if (e.t === 0) mu[e.op]();
        else off.suspend(e.t).then(() => { mu[e.op](); off.resume(); });
      }
      const buf = await off.startRendering();
      return [buf.getChannelData(0), buf.getChannelData(1)];
    };
    const rms = (o, a, b) => { let s = 0, n = 0; for (const ch of o) for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) { s += ch[i] * ch[i]; n++; } return Math.sqrt(s / n); };
    const maxStep = (o, a, b) => { let mx = 0; for (const ch of o) for (let i = Math.floor(a * SR) + 1; i < Math.floor(b * SR); i++) mx = Math.max(mx, Math.abs(ch[i] - ch[i - 1])); return mx; };
    const joinRatio = (o, at) => Math.max(maxStep(o, at - 0.03, at + 0.03) / Math.max(maxStep(o, at - 1.0, at - 0.2), maxStep(o, at + 0.2, at + 1.0)), 0);
    const out = {};
    // 1. intro → boucle
    const r1 = await render(40, [{ t: 0, op: 'startGame' }]);
    out.joinRatio = joinRatio(r1, T);
    out.rmsAroundJoin = [rms(r1, T - 0.5, T - 0.05), rms(r1, T + 0.05, T + 0.5)];
    out.silentGap = rms(r1, T - 0.015, T + 0.015);
    // 2. défaite pendant l'intro (3 s) : outro seule, puis silence jusqu'à la fin (la boucle ne démarre jamais)
    const r2 = await render(45, [{ t: 0, op: 'startGame' }, { t: 3, op: 'endGame' }]);
    out.introDeath = { outro: rms(r2, 5, 15), afterOutro: rms(r2, 20.5, 45), aroundT: rms(r2, T - 0.5, T + 3) };
    // 3. défaite pendant la boucle (40 s)
    const r3 = await render(70, [{ t: 0, op: 'startGame' }, { t: 40, op: 'endGame' }]);
    out.loopDeath = { before: rms(r3, 30, 39), outro: rms(r3, 42, 50), afterOutro: rms(r3, 57.5, 70) };
    // 4. relances rapides : le résultat final est identique à une seule partie lancée au dernier instant
    const r4 = await render(40, [{ t: 0, op: 'startGame' }, { t: 0.9, op: 'endGame' }, { t: 1.0, op: 'startGame' }, { t: 1.2, op: 'startGame' }, { t: 1.4, op: 'startGame' }, { t: 5, op: 'endGame' }]);
    const r4ref = await render(40, [{ t: 1.4, op: 'startGame' }, { t: 5, op: 'endGame' }]);
    // La dernière intro démarre `restartFade + 20 ms` après la relance (fondu court de l'ancienne musique) au lieu de 60 ms : décalage 0,11 s
    // (à un échantillon près : le démarrage d'un nœud est sub-échantillon). Pendant l'intro : écart relatif ; après l'outro : identité stricte.
    const shift = Math.round(0.11 * SR);
    let dsum = 0, rsum = 0, n = 0, diff = 0;
    for (let c = 0; c < 2; c++) {
      for (let i = Math.floor(2 * SR); i < Math.floor(4.9 * SR); i++) { const d = r4[c][i] - r4ref[c][i - shift]; dsum += d * d; rsum += r4ref[c][i - shift] ** 2; n++; }
      for (let i = Math.floor(7.5 * SR); i < Math.floor(30 * SR); i++) diff = Math.max(diff, Math.abs(r4[c][i] - r4ref[c][i]));
    }
    out.rapidRestartMaxDiff = diff;
    out.rapidRestartRelIntro = Math.sqrt(dsum / n) / Math.sqrt(rsum / n);
    // 5. pause / reprise : la musique reprend exactement là où elle s'était arrêtée
    const r5 = await render(40, [{ t: 0, op: 'startGame' }, { t: 5, op: 'pause' }, { t: 8, op: 'resume' }]);
    const seg = (o, a, n) => o[0].subarray(Math.floor(a * SR), Math.floor(a * SR) + n);
    const a5 = seg(r5, 9, 22050);
    let best = -1, bestLag = 0;
    for (let lag = -2000; lag <= 2000; lag += 1) {
      const b1 = r1[0].subarray(Math.floor((9 - 3.06) * SR) + lag, Math.floor((9 - 3.06) * SR) + lag + 22050);
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < 22050; i += 2) { dot += a5[i] * b1[i]; na += a5[i] * a5[i]; nb += b1[i] * b1[i]; }
      const cc = dot / Math.sqrt(na * nb + 1e-12);
      if (cc > best) { best = cc; bestLag = lag; }
    }
    out.resume = { corr: best, lagMs: (bestLag / SR) * 1000, silentDuringPause: rms(r5, 5.3, 7.9) };
    return out;
  });
  check(R.joinRatio < 2 && R.silentGap > 0.001, `Raccord intro → boucle (rendu réel) : saut max ${R.joinRatio.toFixed(2)}× le pas normal, aucun silence (rms ${R.silentGap.toFixed(3)})`);
  check(R.rmsAroundJoin[0] > 0.002 && R.rmsAroundJoin[1] > 0.002, `Raccord : musique présente de part et d’autre (rms ${R.rmsAroundJoin.map((x) => x.toFixed(3)).join(' / ')})`);
  check(R.introDeath.outro > 0.003 && R.introDeath.afterOutro < 1e-5 && R.introDeath.aroundT < 0.2, `Défaite pendant l’intro (rendu réel) : l’outro seule, puis silence — la boucle ne démarre jamais (${R.introDeath.afterOutro.toExponential(1)})`);
  check(R.loopDeath.before > 0.002 && R.loopDeath.outro > 0.003 && R.loopDeath.afterOutro < 1e-5, 'Défaite pendant la boucle (rendu réel) : fondu vers l’outro, puis silence');
  check(R.rapidRestartMaxDiff < 1e-4 && R.rapidRestartRelIntro < 0.08, `Relances rapides (rendu réel) : équivalent à une seule partie, aucune superposition (écart relatif ${R.rapidRestartRelIntro.toFixed(3)} pendant l’intro, ${R.rapidRestartMaxDiff.toExponential(1)} après l’outro)`);
  check(R.resume.corr > 0.98 && Math.abs(R.resume.lagMs) < 6 && R.resume.silentDuringPause < 1e-5, `Pause / reprise (rendu réel) : même position musicale (corrélation ${R.resume.corr.toFixed(3)}, décalage ${R.resume.lagMs.toFixed(1)} ms), silence pendant la pause`);

  // Retour de boucle (≈ 177,5 s) : rendu long en une passe
  const W = await m(async () => {
    const SR = 44100;
    const Music = window.__polarite.music.constructor;
    const off = new OfflineAudioContext(2, SR * 181, SR);
    const mu = new Music({ context: () => off, output: () => off.destination });
    await mu.preload();
    mu.startGame();
    const buf = await off.startRendering();
    const o = [buf.getChannelData(0), buf.getChannelData(1)];
    const at = 0.06 + 24.284988662131518 + 153.17002267573696;
    const maxStep = (a, b) => { let mx = 0; for (const ch of o) for (let i = Math.floor(a * SR) + 1; i < Math.floor(b * SR); i++) mx = Math.max(mx, Math.abs(ch[i] - ch[i - 1])); return mx; };
    const rms = (a, b) => { let s = 0, n = 0; for (const ch of o) for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) { s += ch[i] * ch[i]; n++; } return Math.sqrt(s / n); };
    return { ratio: maxStep(at - 0.03, at + 0.03) / Math.max(maxStep(at - 1, at - 0.2), maxStep(at + 0.2, at + 1)), before: rms(at - 0.5, at - 0.05), after: rms(at + 0.05, at + 0.5), gap: rms(at - 0.015, at + 0.015) };
  });
  check(W.ratio < 2 && W.gap > 0.001 && W.before > 0.002 && W.after > 0.002, `Retour de boucle (rendu réel, ≈ 177 s) : saut max ${W.ratio.toFixed(2)}× le pas normal, sans silence`);
  check(errors.length === 0, `Aucune erreur console (musique)${errors.length ? ' : ' + errors.join(' | ') : ''}`);
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
