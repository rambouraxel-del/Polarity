/**
 * Outil d'équilibrage : fait jouer deux bots sur chaque niveau et en Survie.
 *  - « expert » : esquive parfaite et recherche active des balises ;
 *  - « prudent » : esquive parfaite mais n'inverse que lorsque c'est nécessaire.
 * Usage : npm run sim [-- minutesDeSurvie]
 * Les bots ont des réflexes surhumains : ces chiffres aident à placer les seuils, ils ne remplacent pas des essais.
 */
import { LEVEL_DURATION } from '../src/config/balance';
import { LEVELS } from '../src/config/levels';
import { levelProfile, survivalProfile } from '../src/modes/profiles';
import { playWithBot } from '../src/sim/bot';
import { Simulation } from '../src/sim/simulation';

const runs = 6;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
const round = (n: number) => Math.round(n / 500) * 500;

for (const level of LEVELS) {
  const res: Record<string, number[]> = { expert: [], prudent: [] };
  let wins = 0;
  let deferred = 0;
  for (let r = 0; r < runs; r++) {
    for (const greed of [true, false]) {
      const sim = new Simulation({ seed: 1000 + r * 7919 + level.id, profile: levelProfile(level), timeLimit: LEVEL_DURATION });
      playWithBot(sim, LEVEL_DURATION + 1, greed);
      if (sim.state === 'complete') wins++;
      deferred += sim.director.deferred;
      res[greed ? 'expert' : 'prudent'].push(sim.scoring.score);
    }
  }
  const e = median(res.expert);
  const p = median(res.prudent);
  console.log(
    `Niveau ${String(level.id).padStart(2)} ${level.name.padEnd(20)} réussites ${wins}/${2 * runs} | expert ${e} | prudent ${p} | seuils actuels ${level.stars.join('/')} | suggérés ${round(p * 0.45)}/${round(p * 0.9)}/${round(e * 0.75)} | reports ${deferred}`,
  );
}

const minutes = Number(process.argv[2] ?? 5);
for (let r = 0; r < 3; r++) {
  const t0 = Date.now();
  const sim = new Simulation({ seed: 42 + r, profile: survivalProfile(), timeLimit: null });
  playWithBot(sim, minutes * 60);
  console.log(
    `Survie #${r} : ${sim.state} à ${sim.time.toFixed(1)} s, score ${sim.scoring.score}, vagues ${sim.director.waveCount}, reports ${sim.director.deferred}, inversions/min ${(sim.flips / (sim.time / 60)).toFixed(0)}, ${Date.now() - t0} ms`,
  );
}

// ————— Profil de la Survie (v1.1) : courbe, rythme et mix de motifs par tranche de temps
import { SURVIVAL } from '../src/config/survival';
import { survivalDifficulty } from '../src/modes/profiles';
import type { PatternId } from '../src/sim/patterns';

const DOUBLES: PatternId[] = ['parallel', 'cross', 'twinArcs', 'echo', 'chase'];
const COMBOS: PatternId[] = ['shotArc', 'pincer'];
console.log('\nSurvie v1.1 — d(t) : v1.1 / v1.0');
for (const t of [30, 60, 120, 180, 300, 600]) {
  console.log(`  ${String(t).padStart(4)} s : ${survivalDifficulty(t).toFixed(3)} / ${survivalDifficulty(t, SURVIVAL.legacyTau).toFixed(3)}`);
}
const windows: [number, number][] = [[0, 30], [30, 60], [60, 120], [120, 180], [180, 300], [300, 420]];
const seeds = 10;
const waves: { t: number; id: PatternId }[][] = [];
for (let seed = 1; seed <= seeds; seed++) {
  const sim = new Simulation({ seed: seed * 313, profile: survivalProfile(), timeLimit: null, invincible: true });
  const log: { t: number; id: PatternId }[] = [];
  sim.director.onWave = (t, id) => log.push({ t, id });
  for (let i = 0; i < 420 * 120; i++) {
    sim.step();
    sim.events.length = 0;
  }
  waves.push(log);
}
console.log('\nVagues par minute et mix (moyenne sur ' + seeds + ' graines, sans collision)');
for (const [a, b] of windows) {
  let n = 0;
  let dbl = 0;
  let cmb = 0;
  for (const log of waves) for (const w of log) if (w.t >= a && w.t < b) { n++; if (DOUBLES.includes(w.id)) dbl++; if (COMBOS.includes(w.id)) cmb++; }
  const perMin = (n / seeds) / ((b - a) / 60);
  console.log(`  ${String(a).padStart(3)}–${String(b).padEnd(3)} s : ${perMin.toFixed(1)} vagues/min | doubles ${(100 * dbl / Math.max(1, n)).toFixed(0)} % | projectile+secteur ${(100 * cmb / Math.max(1, n)).toFixed(0)} %`);
}
