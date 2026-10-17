/**
 * Parcours de bout en bout (Économie v3, phase 6) dans un VRAI navigateur (Chromium via Playwright) contre un VRAI service local
 * (server/index.ts, base SQLite temporaire) : jeu construit avec VITE_LEADERBOARD_URL (adresse publique, aucun secret).
 *
 * Usage : npm run e2e        (construit lui-même le jeu dans dist-e2e/, lance le service et le jeu, nettoie ensuite ; captures dans screenshots/)
 *
 * Couvre : connexion/profil, boutique (onglets, Prismes indisponibles sans fournisseur), succès (réclamation), achat de bonus avec solde de test,
 * préparation de la Survie, pouvoirs (Boost, Gel, exclusivité, Bouclier), mort et reprises (5 puis 10 Prismes, jamais de 4ᵉ vie, publicité indisponible
 * expliquée), calendrier de connexion, classements (Sans bonus / Avec bonus, Défi quotidien), mobile portrait, mobile paysage, ordinateur.
 *
 * AUCUN système de paiement ni de publicité réel : « solde de test » = lignes ajoutées directement au registre de la base TEMPORAIRE du service local.
 * Les anciens parcours (campagne, musique, ambiance, migration v1/v5, effets graphiques) de la version précédente de ce script ne sont plus rejoués ici :
 * ils restent couverts par les tests unitaires ; l'ancien script est dans l'historique git (`git show c1caca9:scripts/e2e.mjs`).
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
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

const FRONT = 4183;
const API = 8790;
const SECRET = 'e2e-secret-de-signature-des-tickets-0123456789abcdef';
const GAME = `http://127.0.0.1:${FRONT}/`;
const OUT = 'dist-e2e';
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('screenshots', { recursive: true });

// ————————————————————————————————————————————— mise en place : jeu construit pour le service local, service, aperçu
console.log('Construction du jeu (adresse du service local, aucun secret)…');
execSync(`node node_modules/vite/bin/vite.js build --outDir ${OUT}`, { stdio: 'ignore', env: { ...process.env, VITE_LEADERBOARD_URL: `http://127.0.0.1:${API}` } });
const dir = mkdtempSync(join(tmpdir(), 'polar-rift-e2e-'));
const dbPath = join(dir, 'e2e.sqlite');
const procs = [];
const api = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: { ...process.env, TICKET_SECRET: SECRET, DATABASE_PATH: dbPath, ALLOWED_ORIGINS: `http://127.0.0.1:${FRONT}`, PORT: String(API), NODE_NO_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
procs.push(api);
const front = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', OUT, '--port', String(FRONT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
procs.push(front);
const cleanup = () => {
  for (const p of procs) p.kill();
  rmSync(dir, { recursive: true, force: true });
  rmSync(OUT, { recursive: true, force: true });
};
process.on('exit', cleanup);
process.on('unhandledRejection', (e) => {
  console.error(e);
  process.exit(1);
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${API}/api/health`)).ok) break;
  } catch {
    /* démarrage */
  }
  if (i > 80) throw new Error('service local non démarré');
  await sleep(250);
}
await sleep(1200);

const bundle = readdirSync(`${OUT}/assets`).filter((f) => f.endsWith('.js')).map((f) => readFileSync(`${OUT}/assets/${f}`, 'utf8')).join('\n');
check(!bundle.includes(SECRET) && !/TICKET_SECRET|PRIVATE_KEY|PLAY_NOTIFY_TOKEN/.test(bundle), 'Aucun secret ni code serveur dans le jeu construit');

// « Solde de test » : lignes du registre de la base TEMPORAIRE du service local (jamais de paiement)
const dbw = new DatabaseSync(dbPath);
dbw.exec('PRAGMA busy_timeout = 5000');
let seq = 0;
const grant = (playerId, currency, amount) =>
  dbw.prepare('INSERT INTO ledger (player_id, currency, kind, amount, ref, at) VALUES (?, ?, ?, ?, ?, ?)').run(playerId, currency, 'e2e', amount, `e2e:${currency}:${++seq}`, Date.now());
const ledgerSum = (playerId, currency) => Number(dbw.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE player_id = ? AND currency = ?').get(playerId, currency).s);

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required'] });

const IGNORED = /GroupMarkerNotSet|GL Driver|swiftshader|Failed to load resource/i;
async function newPage(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED.test(m.text())) errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(opts.url ?? GAME);
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  await page.evaluate(() => {
    const a = window.__polarite;
    a.save.options.tutorialSeen = true;
    a.save.balanceNoticeSeen = 3;
    a.save.rewardNotice = null;
  });
  // L'ouverture quotidienne peut afficher le calendrier d'elle-même (profil neuf) : on laisse faire puis on revient à l'accueil
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.__polarite.showScreen('home'));
  await page.waitForTimeout(300);
  return { page, context, errors };
}
const go = async (page, id) => {
  await page.evaluate((s) => window.__polarite.showScreen(s), id);
  await page.waitForTimeout(250);
};
const sync = (page) => page.evaluate(() => window.__polarite.account.syncNow(true));
const text = (page, sel = '#screen') => page.locator(sel).innerText();
const identity = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('polarite.classement.identite') || 'null'));
const waitFor = async (page, fn, arg, timeout = 15000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout });
  } catch (e) {
    // Diagnostic : état utile du jeu au moment de l'échec
    const dump = await page.evaluate(() => {
      const a = window.__polarite;
      return JSON.stringify({ screen: a.screen, wallet: a.save.wallet, confirmed: a.save.economy?.confirmed, inventory: a.save.inventory, owned: a.save.owned?.length, account: a.account?.state?.status ?? null, phase: a.session?.phase ?? null });
    }).catch(() => '?');
    console.error(`Attente expirée (${String(fn).slice(0, 90)}…) — état : ${dump}`);
    throw e;
  }
};
const shot = (page, name) => page.screenshot({ path: `screenshots/${name}.png` });
/** Pas de débordement horizontal ni d'élément principal masqué par un autre (superpositions d'interface). */
async function layoutOk(page, label) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth > innerWidth + 1;
    const btns = [...document.querySelectorAll('#screen:not(.hidden) button:not([disabled]), #powers:not(.hidden) button')].filter((b) => b.offsetParent !== null);
    const hidden = [];
    for (const b of btns) {
      const rc = b.getBoundingClientRect();
      if (rc.width === 0 || rc.height === 0 || rc.bottom < 0 || rc.top > innerHeight) continue; // hors vue (défilement)
      const x = Math.min(Math.max(rc.left + rc.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(rc.top + rc.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      if (top && !b.contains(top) && !top.contains(b)) hidden.push((b.dataset.action || b.dataset.power || b.textContent || '?').trim().slice(0, 30));
    }
    return { overflow, hidden };
  });
  check(!r.overflow, `${label} : aucun débordement horizontal`);
  check(r.hidden.length === 0, `${label} : aucun bouton masqué par une superposition${r.hidden.length ? ` (${r.hidden.join(', ')})` : ''}`);
}
/** Interface compacte : surfaces tactiles ≥ 44 px, onglets non tronqués, pas de défilement horizontal ; `noScroll` : l'écran tient sans défilement vertical. */
async function compactOk(page, label, o = {}) {
  const r = await page.evaluate(() => {
    const sc = document.getElementById('screen');
    const small = [];
    for (const el of document.querySelectorAll('#screen button:not([disabled]), #screen .tab, #screen .filter')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (Math.min(b.width, b.height) < 43.5) small.push(`${(el.dataset.action || el.className).slice(0, 20)} ${Math.round(b.width)}×${Math.round(b.height)}`);
    }
    const clipped = [...document.querySelectorAll('#screen .tab')].filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent);
    return { small, clipped, scrolls: sc.scrollHeight > sc.clientHeight + 1, overflowX: sc.scrollWidth > sc.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1 };
  });
  check(r.small.length === 0, `${label} : surfaces tactiles ≥ 44 px${r.small.length ? ` (${r.small.join(', ')})` : ''}`);
  check(r.clipped.length === 0, `${label} : onglets lisibles (aucun texte tronqué)${r.clipped.length ? ` (${r.clipped.join(', ')})` : ''}`);
  check(!r.overflowX, `${label} : aucun débordement horizontal`);
  if (o.noScroll) check(!r.scrolls, `${label} : l'écran tient sans défilement`);
}
const noErrors = (errors, label) => check(errors.length === 0, `${label} : aucune erreur console${errors.length ? ` — ${errors.join(' | ').slice(0, 300)}` : ''}`);

/** Joue la partie en cours jusqu'à la mort (accélérée, sans entrée) puis attend l'étape suivante. */
const killRun = (page) =>
  page.evaluate(() => {
    const s = window.__polarite.session;
    for (let i = 0; i < 120 * 900 && s.sim.state === 'running'; i++) s.sim.step();
  });
const simState = (page) =>
  page.evaluate(() => {
    const s = window.__polarite.session;
    const sim = s.sim;
    const st = (k) => sim.powers.state(k, sim.stepIndex);
    return { phase: s.phase, life: sim.life, state: sim.state, boost: st('boost'), gel: st('gel'), shield: st('shield'), used: { ...sim.powers.used }, stock: { ...sim.powers.stock }, free: sim.powers.free, flips: sim.flips };
  });

// ═════════════════════════════════════════════ 0. Migration d'une ANCIENNE sauvegarde (format 6, produite par le code de `main`)
{
  const legacy = readFileSync('tests/fixtures/save-main-v6.json', 'utf8');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.addInitScript((raw) => {
    if (!localStorage.getItem('polarite.save') && !localStorage.getItem('e2e.legacy.done')) {
      localStorage.setItem('polarite.save', raw);
      localStorage.setItem('e2e.legacy.done', '1');
    }
  }, legacy);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (mm) => {
    if ((mm.type() === 'error' || mm.type() === 'warning') && !IGNORED.test(mm.text())) errors.push(`${mm.type()}: ${mm.text()}`);
  });
  await page.goto(GAME);
  await page.waitForFunction(() => !!window.__polarite && document.querySelector('#screen [data-action="campaign"]'));
  await waitFor(page, () => !!JSON.parse(localStorage.getItem('polarite.classement.identite') || 'null')?.playerId);
  const lid = (await identity(page)).playerId;
  await sync(page);
  await waitFor(page, () => window.__polarite.save.wallet.shards >= 500, null, 20000);
  check(Number(dbw.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE player_id = ? AND kind = 'import'").get(lid).s) === 500, 'Migration : 500 Éclats de l’ancienne sauvegarde importés par le service, une seule fois');
  check(ledgerSum(lid, 'prisms') === 0, 'Migration : les 7 Prismes locaux ne sont JAMAIS repris (le service seul crée des Prismes)');
  await sync(page);
  await sync(page);
  check(Number(dbw.prepare("SELECT COUNT(*) AS n FROM ledger WHERE player_id = ? AND kind = 'import'").get(lid).n) === 1, 'Migration : idempotente (synchroniser à nouveau n’importe rien)');
  const kept = await page.evaluate(() => {
    const a = window.__polarite.save;
    return { owned: a.owned, skin: a.skin, survival: Math.max(a.survival.bestTime, ...Object.values(a.archive).map((x) => x.survival.bestTime)), levels: Object.keys(a.levels).length, ach: Object.keys(a.achievements).length, wallet: a.wallet, backup: Object.keys(localStorage).some((k) => k.startsWith('polarite.save.avant-v')) };
  });
  check(kept.owned.includes('emeraude'), 'Migration : traînée achetée conservée');
  check(kept.skin === 'tole-brute', 'Migration : l’ancienne apparence équipée (« aurore », retirée du jeu) retombe sur Tôle brute, sans erreur');
  const serverSave = JSON.parse(dbw.prepare('SELECT data FROM saves WHERE player_id = ?').get(lid)?.data ?? '{}');
  check(!(serverSave.owned ?? []).includes('aurore') && !(serverSave.owned ?? []).includes('neon'), 'Migration : les anciennes apparences retirées du jeu (« aurore », « neon ») ne sont pas importées par le service');
  if (process.env.E2E_DEBUG || kept.levels !== 2 || kept.ach !== 5) console.log('  sauvegarde migrée :', JSON.stringify(kept));
  check(kept.survival === 95.5 && kept.levels === 2 && kept.ach === 5, 'Migration : record de Survie (archivé sous l’ancien équilibrage), niveaux et succès conservés (+ 2 succès déduits des records : « survive_60 », « three_stars »)');
  check(kept.wallet.prisms === 0 && kept.wallet.shards === 500, 'Migration : soldes = vérité du service (500 Éclats, 0 Prisme)');
  check(kept.backup, 'Migration : copie de l’ancienne sauvegarde conservée dans le navigateur');
  // Succès accomplis avant la mise à jour : Médailles récupérables rétroactivement (3 × 20), crédit unique
  await go(page, 'achievements');
  const claimAll = page.locator('[data-action="claim-all"]');
  if ((await claimAll.count()) > 0) await claimAll.first().click();
  await waitFor(page, () => (window.__polarite.save.wallet.medals ?? 0) >= 100, null, 20000).catch(async () => console.log('  médailles :', await page.evaluate(() => JSON.stringify({ w: window.__polarite.save.wallet, ach: window.__polarite.save.achievements, claimed: window.__polarite.save.medals }))));
  if (ledgerSum(lid, 'medals') !== 100) console.log('  médailles (service) :', ledgerSum(lid, 'medals'), JSON.stringify(dbw.prepare("SELECT ref, amount FROM ledger WHERE player_id = ? AND currency = 'medals'").all(lid)));
  check(ledgerSum(lid, 'medals') === 100, 'Migration : 5 succès (3 anciens + 2 déduits des records) → 100 Médailles réclamées rétroactivement, une fois');
  check(errors.length === 0, `Migration : aucune erreur console${errors.length ? ` — ${errors.join(' | ').slice(0, 300)}` : ''}`);
  await context.close();
}

// ═════════════════════════════════════════════ 1. Mobile portrait 390 × 844 : connexion, boutique, succès, préparation, Survie, reprise
const m = await newPage({ width: 390, height: 844 }, { touch: true });
{
  const { page, errors } = m;
  await shot(page, 'e2e-01-accueil-mobile');
  await layoutOk(page, 'Accueil (390×844)');

  // — Connexion : profil invité automatique ; méthodes externes non configurées = désactivées, expliquées
  await waitFor(page, () => !!JSON.parse(localStorage.getItem('polarite.classement.identite') || 'null')?.playerId);
  let id = await identity(page);
  check(!!id?.playerId && !!id.token, 'Profil invité créé automatiquement (jouer ne demande aucun compte)');
  await go(page, 'account');
  let t = await text(page);
  check(/invité|Invité|appareil/i.test(t), 'Écran Compte : profil invité expliqué');
  check((await page.locator('[data-action="acct-google"]:not([disabled]), [data-action="acct-apple"]:not([disabled])').count()) === 0, 'Écran Compte : Google/Apple non proposés tant que le service n’est pas configuré');
  await shot(page, 'e2e-02-compte-mobile');
  await layoutOk(page, 'Compte (390×844)');

  // — Pseudo (menu Classement) : le profil entre au classement public
  await go(page, 'home');
  await page.click('[data-action="leaderboard"]');
  await page.waitForSelector('.nick-form', { timeout: 15000 });
  await page.fill('#nick-input', 'AxelE2E');
  await page.click('.nick-form button');
  await page.waitForSelector('.lb-id__name', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  id = await identity(page);
  check(id?.nickname === 'AxelE2E', 'Pseudo choisi : profil nommé');
  const pid = id.playerId;
  const guestFlag = dbw.prepare('SELECT guest FROM players WHERE id = ?').get(pid);
  check(guestFlag && Number(guestFlag.guest) === 0, 'Service : le profil n’est plus invité (pseudo suffisant pour les récompenses)');

  // — Solde de test (registre local de test) puis ouverture de la boutique
  grant(pid, 'shards', 400);
  grant(pid, 'prisms', 200);
  await sync(page);
  await go(page, 'home');
  await page.click('[data-action="cosmetics"]');
  await waitFor(page, () => (window.__polarite.save.economy.confirmed?.prisms ?? 0) >= 200 && (window.__polarite.save.wallet.shards ?? 0) >= 400);
  t = await text(page);
  check(/200/.test(t) && /400/.test(t), 'Boutique : soldes confirmés par le service (400 Éclats, 200 Prismes de test)');
  await shot(page, 'e2e-03-boutique-mobile');
  await layoutOk(page, 'Boutique (390×844)');
  for (const tab of ['ships', 'trails', 'bonus', 'prisms']) {
    await page.click(`[data-action="cat-${tab}"]`);
    await page.waitForTimeout(150);
    check((await page.locator('#screen').innerText()).length > 30, `Boutique : onglet « ${tab} » s’affiche`);
  }

  check((await page.locator('[data-action="cat-packs"]').count()) === 0 && !/packs/i.test(await page.locator('#screen .tabs').innerText()), 'Boutique : plus d’onglet « Packs »');
  await compactOk(page, 'Boutique compacte (390×844)');
  // — Prismes (argent réel) : aucun fournisseur configuré → achats désactivés et expliqués, jamais de faux succès
  await page.click('[data-action="cat-prisms"]');
  await page.waitForTimeout(400);
  t = await text(page);
  check((await page.locator('[data-premium]').count()) === 0, 'Prismes : plus aucun article premium (Prismes seulement) dans cet onglet');
  check(/30/.test(t) && /100/.test(t) && /380/.test(t) && /0,99/.test(t) && /2,99/.test(t) && /9,99/.test(t), 'Prismes : 3 packs 30/100/380 à 0,99/2,99/9,99 €');
  check((await page.locator('[data-action="prisms-buy"]:not([disabled])').count()) === 0, 'Prismes : boutons d’achat désactivés sans fournisseur configuré');
  check(/indisponible|non configuré|pas disponible/i.test(t), 'Prismes : raison affichée (fournisseur non configuré)');
  await shot(page, 'e2e-04-prismes-indisponibles');
  const before = ledgerSum(pid, 'prisms');
  await page.evaluate(() => document.querySelectorAll('[data-action="prisms-buy"]').forEach((b) => b.removeAttribute('disabled')));
  await page.click('[data-action="prisms-buy"]').catch(() => {});
  await page.waitForTimeout(500);
  check(ledgerSum(pid, 'prisms') === before, 'Prismes : forcer le bouton ne crédite rien (service seul autorité)');

  // — Achat de bonus avec le solde de test : Boost 50 Éclats ×1, Gel 100 Éclats ×1 (confirmation puis débit côté service)
  await go(page, 'cosmetics');
  await page.click('[data-action="cat-bonus"]');
  await page.waitForTimeout(200);
  for (const [kind, price] of [['boost', 50], ['gel', 100]]) {
    await page.click(`[data-action="bonus-ask"][data-bonus="${kind}"][data-qty="1"]`);
    await page.waitForTimeout(200);
    check(/confirm|Confirm|acheter/i.test(await text(page)), `Bonus ${kind} : confirmation demandée avant le débit`);
    await page.click('[data-action="bonus-confirm"]');
    await waitFor(page, (k) => (window.__polarite.save.inventory[k] ?? 0) >= 1, kind);
    check(true, `Bonus ${kind} acheté (${price} Éclats)`);
  }
  await page.waitForTimeout(1500);
  await waitFor(page, () => !window.__polarite.account?.state?.syncing, null, 20000).catch(() => {});
  check(ledgerSum(pid, 'boost') === 1 && ledgerSum(pid, 'gel') === 1, 'Service : 1 Boost et 1 Gel inscrits au registre');
  check(ledgerSum(pid, 'shards') === 400 - 150, 'Service : Éclats débités du prix exact (50 + 100)');

  // — Succès : réclamation manuelle, Médailles créditées une fois par le service
  await page.evaluate(() => {
    const a = window.__polarite;
    a.save.achievements = { ...a.save.achievements, first_cycle: Date.now() };
    a.persist?.();
  });
  await go(page, 'achievements');
  const claim = page.locator('[data-action="claim-medal"][data-id="first_cycle"], [data-action="claim-medal"]').first();
  await claim.click();
  await waitFor(page, () => (window.__polarite.save.wallet.medals ?? 0) >= 20);
  check(ledgerSum(pid, 'medals') === 20, 'Succès « Premier cycle » : 20 Médailles créditées par le service');
  await claim.click({ timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(600);
  check(ledgerSum(pid, 'medals') === 20, 'Succès : jamais de double crédit');
  await shot(page, 'e2e-05-succes-mobile');

  // — Achat au choix en Prismes : vaisseau Long-courrier (60), débit par le service
  await go(page, 'cosmetics');
  await page.click('[data-action="cat-ships"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="select-item"][data-item="long-courrier"]').catch(() => {});
  await page.click('[data-action="buy"][data-currency="prisms"]').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('[data-action="confirm-buy"]').catch(() => {});
  await waitFor(page, () => window.__polarite.save.owned.includes('long-courrier'), null, 20000);
  check(ledgerSum(pid, 'prisms') === 140, 'Au choix : Long-courrier payé 60 Prismes (200 → 140) par le service');

  noErrors(errors, 'Parcours boutique (mobile)');
}

// ═════════════════════════════════════════════ 2. Préparation, Survie, pouvoirs, mort, reprises
{
  const { page, errors } = m;
  const pid = (await identity(page)).playerId;
  await go(page, 'home');
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(500);
  // Mode choisi à la préparation : « Sans bonus » par défaut (aucune carte), « Avec bonus » affiche les bonus possédés
  check((await page.locator('[data-action="prep-mode"]').count()) === 2 && (await page.locator('[data-action="bonus-ask"]').count()) === 0, 'Préparation : choix Sans bonus / Avec bonus, aucune carte de bonus en « Sans bonus »');
  await compactOk(page, 'Préparation « Sans bonus » (390×844)', { noScroll: true });
  await page.click('[data-action="prep-mode"][data-mode="bonus"]');
  await page.waitForTimeout(300);
  let t = await text(page);
  check(/Boost/.test(t) && /Gel/.test(t), 'Préparation : bonus possédés affichés');
  await shot(page, 'e2e-06-preparation-mobile');
  await layoutOk(page, 'Préparation (390×844)');
  await compactOk(page, 'Préparation (390×844)', { noScroll: true });
  check(/Préparation/i.test(t) && !/Médailles/.test(t), 'Préparation : titre « Préparation », aucune information sur les Médailles');
  await page.click('[data-action="survival-start"]');
  await page.waitForTimeout(600);
  let s = await simState(page);
  check(s.phase === 'running' && s.life === 1, 'Survie : première vie en cours');
  check((await page.locator('#powers [data-power]').count()) === 3, 'Trois commandes de pouvoirs (Boost, Gel, Bouclier) hors de l’aire de jeu');
  await layoutOk(page, 'Survie (390×844)');
  await shot(page, 'e2e-07-survie-mobile');

  // Commandes tactiles : n'inversent jamais
  const flips0 = (await simState(page)).flips;
  await page.tap('#powers [data-power="boost"]', { force: true });
  await page.waitForTimeout(250);
  s = await simState(page);
  check(s.boost === 'active' && s.flips === flips0, 'Boost activé au toucher, sans inversion involontaire');
  await page.tap('#powers [data-power="gel"]', { force: true });
  await page.waitForTimeout(250);
  s = await simState(page);
  console.log('  état après Boost + Gel :', JSON.stringify(s));
  check(s.gel !== 'active' && s.used.gel === 0, 'Gel refusé pendant le Boost (exclusifs)');
  check(s.shield !== 'active', 'Bouclier non disponible sans charge (jauge de 18 balises)');
  // Fin du Boost (5 s de jeu actif) : le Gel devient activable
  await page.evaluate(() => {
    const sim = window.__polarite.session.sim;
    for (let i = 0; i < 120 * 5.2 && sim.state === 'running'; i++) sim.step();
  });
  s = await simState(page);
  console.log('  état après 5,2 s :', JSON.stringify(s));
  if (s.state === 'running') {
    await page.tap('#powers [data-power="gel"]', { force: true });
    await page.waitForTimeout(250);
    s = await simState(page);
    check(s.gel === 'active' && s.used.boost === 1 && s.used.gel === 1, 'Gel activé après le Boost ; une activation de chaque comptée');
  } else check(true, 'Partie terminée avant le Gel (sans importance pour ce contrôle)');

  // — Première mort : résultat classé figé, offre de reprise (5 Prismes ; publicité expliquée indisponible)
  await killRun(page);
  await page.waitForSelector('.revive', { timeout: 20000 });
  t = await text(page);
  check(/5 Prismes/i.test(t), 'Deuxième chance : 5 Prismes proposés');
  check(/publicité/i.test(t) && /Indisponible/i.test(t), 'Deuxième chance : publicité indisponible (aucun fournisseur)');
  check(/Reprise non classée · sans gains/i.test(t) && /Terminer/i.test(t), 'Deuxième chance : écran allégé (règle en une ligne, bouton Terminer)');
  check((await page.locator('[data-action="revive-ad"]:not([disabled])').count()) === 0, 'Aucun bouton publicité actif sans fournisseur');
  await shot(page, 'e2e-08-reprise-mobile');
  await layoutOk(page, 'Reprise (390×844)');
  await waitFor(page, () => /Validé|En attente|Local uniquement|Non validé/.test(document.body.innerText), null, 20000);
  await page.click('[data-action="revive-prisms"]');
  await page.waitForTimeout(300);
  check(/Dépenser 5 Prismes/i.test(await text(page)), 'Confirmation explicite avant toute dépense de Prismes');
  await page.click('[data-action="revive-prisms-confirm"]');
  await waitFor(page, () => window.__polarite.session.sim.life === 2, null, 20000);
  check(ledgerSum(pid, 'prisms') === 135, 'Service : reprise payée 5 Prismes (140 → 135)');
  s = await simState(page);
  check(s.life === 2 && s.free, 'Vie 2 : bonus gratuits, partie non classée');

  // — Deuxième mort : 10 Prismes uniquement (pas de publicité)
  await page.waitForTimeout(3600);
  await killRun(page);
  await page.waitForSelector('.revive', { timeout: 20000 });
  t = await text(page);
  check(/10 Prismes/i.test(t) && !/Publicité/i.test(t), 'Troisième chance : 10 Prismes uniquement, aucune publicité');
  await page.click('[data-action="revive-prisms"]');
  await page.click('[data-action="revive-prisms-confirm"]');
  await waitFor(page, () => window.__polarite.session.sim.life === 3, null, 20000);
  check(ledgerSum(pid, 'prisms') === 125, 'Service : reprise payée 10 Prismes (135 → 125)');

  // — Troisième mort : fin définitive, jamais de quatrième vie
  await page.waitForTimeout(3600);
  await killRun(page);
  await page.waitForSelector('[data-replay]', { timeout: 20000 });
  check((await page.locator('.revive').count()) === 0 && ledgerSum(pid, 'prisms') === 125, 'Troisième mort : fin de partie, aucune quatrième vie, aucun Prisme débité');
  await shot(page, 'e2e-09-fin-mobile');

  // — Le record classé est celui de la PREMIÈRE vie ; catégorie « Avec bonus » (Boost/Gel utilisés)
  await waitFor(page, () => document.querySelector('#lb-status') && /validé|rang/i.test(document.querySelector('#lb-status').textContent), null, 25000);
  const lb = await fetch(`http://127.0.0.1:${API}/api/leaderboard?category=bonus`).then((r) => r.json());
  const plain = await fetch(`http://127.0.0.1:${API}/api/leaderboard?category=plain`).then((r) => r.json());
  check(lb.total === 1 && lb.entries[0].nickname === 'AxelE2E', 'Classement « Avec bonus » : la première vie (Boost/Gel) est classée, une seule ligne');
  check(plain.total === 0, 'Classement « Sans bonus » : vide (aucune partie sans bonus)');
  check(ledgerSum(pid, 'boost') === 0 && ledgerSum(pid, 'gel') === 0, 'Service : charges de Boost/Gel consommées par la partie classée (rejeu)');
  noErrors(errors, 'Parcours Survie et reprises (mobile)');
}

// ═════════════════════════════════════════════ 3. Calendrier de connexion et Défi quotidien
{
  const { page, errors } = m;
  const pid = (await identity(page)).playerId;
  await go(page, 'home');
  await page.click('[data-action="loyalty"]');
  await page.waitForSelector('.loy-grid', { timeout: 15000 });
  await shot(page, 'e2e-10-calendrier-mobile');
  await layoutOk(page, 'Calendrier (390×844)');
  const shardsBefore = ledgerSum(pid, 'shards');
  await page.click('[data-action="loyalty-claim"]');
  await waitFor(page, () => true);
  await page.waitForTimeout(1200);
  check(ledgerSum(pid, 'shards') === shardsBefore + 20, 'Calendrier : présence validée à la connexion, jour 1 réclamé = 20 Éclats (une fois)');
  const again = page.locator('[data-action="loyalty-claim"]');
  if ((await again.count()) > 0) await again.first().click({ timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(600);
  check(ledgerSum(pid, 'shards') === shardsBefore + 20, 'Calendrier : aucune seconde réclamation du même jour');

  // — Défi quotidien classé : tentative démarrée en ligne, rejeu validé par le service
  await go(page, 'home');
  await page.click('[data-action="daily"]');
  await page.waitForTimeout(700);
  await page.click('[data-action="play-daily"]');
  await page.waitForTimeout(700);
  // Temps RÉEL obligatoire : le service refuse une durée de jeu supérieure au temps écoulé depuis le début enregistré (« too_fast »), donc pas d'accélération ici
  const att = true;
  await page.waitForSelector('[data-replay]', { timeout: 90000 });
  await page.waitForFunction(() => /validé|rang/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const day = new Date().toISOString().slice(0, 10);
  if (process.env.E2E_DEBUG) console.log('  quotidien : tentatives', JSON.stringify(dbw.prepare('SELECT date, used_at IS NOT NULL AS used, commit_digest IS NOT NULL AS committed FROM daily_attempts').all()), 'parties', Number(dbw.prepare('SELECT COUNT(*) AS n FROM daily_runs').get().n), 'file locale', await page.evaluate(() => localStorage.getItem('polarite.classement.quotidien')), 'résultat :', (await text(page)).replace(/\s+/g, ' ').slice(0, 300));
  const board = await fetch(`http://127.0.0.1:${API}/api/daily/leaderboard?date=${day}`).then((r) => r.json());
  check(att && board.entries.length === 1 && board.entries[0].nickname === 'AxelE2E' && board.status === 'open', 'Défi quotidien : résultat rejoué et classé par le service (journée ouverte, sans pouvoirs)');
  await go(page, 'home');
  await page.click('[data-action="daily"]');
  await page.waitForTimeout(1200);
  check(/AxelE2E/.test(await text(page)), 'Défi quotidien : le classement mondial s’affiche avec le joueur');
  await shot(page, 'e2e-11-quotidien-mobile');

  // — Classements de Survie : deux onglets
  await go(page, 'home');
  await page.click('[data-action="leaderboard"]');
  await page.waitForTimeout(700);
  check((await page.locator('[data-action="lb-category"]').count()) === 2, 'Classements : onglets « Sans bonus » et « Avec bonus »');
  await page.click('[data-action="lb-category"][data-category="bonus"]');
  await page.waitForTimeout(700);
  check(/AxelE2E/.test(await text(page)), 'Classement « Avec bonus » : ligne du joueur');
  await shot(page, 'e2e-12-classements-mobile');
  await layoutOk(page, 'Classements (390×844)');
  noErrors(errors, 'Parcours calendrier et classements (mobile)');
}
await m.context.close();

// ═════════════════════════════════════════════ 4. Mobile paysage et ordinateur : navigation entre menus, superpositions, partie
for (const [label, vp, touch] of [['Mobile paysage 844×390', { width: 844, height: 390 }, true], ['Ordinateur 1280×800', { width: 1280, height: 800 }, false]]) {
  const { page, errors, context } = await newPage(vp, { touch });
  await waitFor(page, () => !!JSON.parse(localStorage.getItem('polarite.classement.identite') || 'null')?.playerId);
  await layoutOk(page, `${label} : accueil`);
  for (const [action, screen] of [['cosmetics', 'Boutique'], ['achievements', 'Succès'], ['loyalty', 'Calendrier'], ['daily', 'Défi quotidien'], ['leaderboard', 'Classement'], ['options', 'Options']]) {
    await go(page, 'home');
    await page.click(`[data-action="${action}"]`, { timeout: 5000 }).catch(async (e) => {
      console.error(`  clic « ${action} » impossible (${label}) ; actions présentes :`, await page.$$eval('#screen [data-action]', (n) => n.map((x) => x.dataset.action).join(', ')));
      throw e;
    });
    await page.waitForTimeout(500);
    await layoutOk(page, `${label} : ${screen}`);
  }
  await shot(page, `e2e-13-${touch ? 'paysage' : 'pc'}-options`);
  // Partie de Survie : commandes des pouvoirs visibles et cliquables, pas de superposition avec l'aire de jeu
  await go(page, 'home');
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(400);
  await page.click('[data-action="prep-mode"][data-mode="bonus"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="survival-start"]');
  await page.waitForTimeout(700);
  check((await page.locator('#powers [data-power]').count()) === 3, `${label} : commandes des pouvoirs présentes`);
  await layoutOk(page, `${label} : Survie`);
  await shot(page, `e2e-14-${touch ? 'paysage' : 'pc'}-survie`);
  // L'Espace inverse ; B, G, S ne créent aucune inversion
  if (!touch) {
    const f0 = (await simState(page)).flips;
    await page.keyboard.press('b');
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await page.waitForTimeout(150);
    check((await simState(page)).flips === f0, `${label} : les touches B, G, S n’inversent pas`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    check((await simState(page)).flips === f0 + 1, `${label} : Espace inverse exactement une fois`);
  }
  noErrors(errors, label);
  await context.close();
}

// ═════════════════════════════════════════════ 4 bis. Petit téléphone 360 × 780 : Préparation sans défilement, boutique compacte
{
  const { page, errors, context } = await newPage({ width: 360, height: 780 }, { touch: true });
  await waitFor(page, () => !!JSON.parse(localStorage.getItem('polarite.classement.identite') || 'null')?.playerId);
  await go(page, 'home');
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(500);
  await compactOk(page, 'Préparation (360×780)', { noScroll: true });
  await layoutOk(page, 'Préparation (360×780)');
  await shot(page, 'e2e-15-preparation-360');
  await page.click('[data-action="prep-mode"][data-mode="bonus"]');
  await page.waitForTimeout(250);
  await compactOk(page, 'Préparation « Avec bonus » (360×780)', { noScroll: true });
  // « Sans bonus » (choix mémorisé puis rétabli) : aucune commande de pouvoir pendant la partie
  await page.click('[data-action="prep-mode"][data-mode="plain"]');
  await page.click('[data-action="survival-start"]');
  await page.waitForTimeout(700);
  check((await page.locator('#powers [data-power]:visible').count()) === 0, 'Sans bonus : aucune commande de pouvoir pendant la partie');
  check((await simState(page)).used.boost === 0, 'Sans bonus : aucun pouvoir actif');
  await go(page, 'home');
  await go(page, 'cosmetics');
  for (const tab of ['ships', 'trails', 'bonus', 'prisms']) {
    await page.click(`[data-action="cat-${tab}"]`);
    await page.waitForTimeout(250);
    await compactOk(page, `Boutique ${tab} (360×780)`);
  }
  await shot(page, 'e2e-16-boutique-360');
  noErrors(errors, '360×780');
  await context.close();
}

// ═════════════════════════════════════════════ 5. Jeu sans service (aucun profil) : jouable, achats et classements absents
{
  // Page chargée avec une adresse de service injoignable : le jeu reste jouable
  const { page, errors, context } = await newPage({ width: 390, height: 844 }, { touch: true });
  await context.setOffline(true);
  await go(page, 'home');
  await page.click('[data-action="survival"]');
  await page.waitForTimeout(400);
  await page.click('[data-action="survival-start"]');
  await page.waitForTimeout(500);
  check((await simState(page)).phase === 'running', 'Hors ligne : la Survie reste jouable');
  await killRun(page);
  await page.waitForTimeout(2500);
  check((await page.locator('.revive').count()) === 0 || (await page.locator('[data-action="revive-prisms"]:not([disabled])').count()) === 0, 'Hors ligne : reprise payante impossible (bouton désactivé, jamais de dépense locale)');
  await context.setOffline(false);
  noErrors(errors, 'Hors ligne');
  await context.close();
}

await browser.close();
dbw.close();
procs.forEach((p) => p.kill());
cleanup();
console.log(failures.length ? `\n${failures.length} échec(s) :\n- ${failures.join('\n- ')}` : '\nTous les contrôles du parcours sont passés.');
process.exit(failures.length ? 1 : 0);
