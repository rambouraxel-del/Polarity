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
