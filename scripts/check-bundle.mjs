// Contrôle du bundle publié : aucun secret ni code serveur ne doit se retrouver dans dist/ (publié sur Internet).
// Usage : npm run check:bundle  (après npm run build ; exécuté aussi par le workflow GitHub Pages).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const FORBIDDEN = ['TICKET_SECRET', 'DATABASE_PATH', 'ALLOWED_ORIGINS', 'BLOCKED_WORDS', 'node:sqlite', 'DatabaseSync', 'token_hash', 'moderation_log', 'server:admin',
  // Publicité : le SDK AdMob n'existe que dans les applications natives ; ni identifiant publicitaire ni script de régie dans le web
  'ca-app-pub-', 'googlesyndication', 'pagead2', 'play-services-ads', 'GoogleMobileAds'];
// Valeurs réelles d'éventuels secrets présents dans l'environnement de construction : leur présence dans le bundle serait une fuite
const SECRET_VALUES = [process.env.TICKET_SECRET].filter((v) => typeof v === 'string' && v.length >= 8);
const TEXT = /\.(js|mjs|css|html|json|map|txt|svg|webmanifest)$/i;

function* walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
const problems = [];
try {
  for (const f of walk(dir)) {
    if (!TEXT.test(f)) continue;
    files++;
    const txt = readFileSync(f, 'utf8');
    for (const w of FORBIDDEN) if (txt.includes(w)) problems.push(`${f} : contient « ${w} »`);
    for (const v of SECRET_VALUES) if (txt.includes(v)) problems.push(`${f} : contient la valeur d'un secret d'environnement`);
  }
} catch (e) {
  console.error(`Dossier ${dir} illisible : lancez d'abord npm run build (${e.message}).`);
  process.exit(2);
}
if (files === 0) {
  console.error(`Aucun fichier à contrôler dans ${dir} : lancez d'abord npm run build.`);
  process.exit(2);
}
if (problems.length > 0) {
  console.error('FUITE POSSIBLE dans le bundle :\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Bundle sain : ${files} fichiers contrôlés, aucun secret ni code serveur.`);
