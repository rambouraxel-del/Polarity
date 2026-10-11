/**
 * Outil d'équilibrage : fait jouer le bot sur chaque niveau et en Survie.
 * Usage : npm run sim [-- survie-minutes]
 * Le bot est surhumain en réflexes : ces chiffres calibrent les seuils, ils ne remplacent pas des essais.
 */
import { LEVELS } from '../src/config/levels';
import { levelProfile, survivalProfile } from '../src/modes/profiles';
import { playWithBot } from '../src/sim/bot';
import { Simulation } from '../src/sim/simulation';
import { LEVEL_DURATION } from '../src/config/balance';

const runs = 6;
for (const level of LEVELS) {
  const scores: number[] = [];
  let wins = 0;
  let deferred = 0;
  let flips = 0;
  const t0 = Date.now();
  for (let r = 0; r < runs; r++) {
    const sim = new Simulation({ seed: 1000 + r * 7919 + level.id, profile: levelProfile(level), timeLimit: LEVEL_DURATION });
    playWithBot(sim, LEVEL_DURATION + 1);
    if (sim.state === 'complete') wins++;
    scores.push(sim.scoring.score);
    deferred += sim.director.deferred;
    flips += sim.flips / (sim.time / 60);
  }
  scores.sort((a, b) => a - b);
  console.log(
    `Niveau ${level.id} ${level.name.padEnd(20)} réussites ${wins}/${runs} score min ${scores[0]} méd ${scores[runs >> 1]} max ${scores[runs - 1]} | seuils ${level.stars.join('/')} | reports ${deferred} | inv/min ${(flips / runs).toFixed(0)} | ${Date.now() - t0} ms`,
  );
}

const minutes = Number(process.argv[2] ?? 5);
for (let r = 0; r < 3; r++) {
  const t0 = Date.now();
  const sim = new Simulation({ seed: 42 + r, profile: survivalProfile(), timeLimit: null });
  playWithBot(sim, minutes * 60);
  console.log(
    `Survie #${r} : ${sim.state} à ${sim.time.toFixed(1)} s, score ${sim.scoring.score}, vagues ${sim.director.waveCount}, reports ${sim.director.deferred}, inv/min ${(sim.flips / (sim.time / 60)).toFixed(0)}, mult moyen ${(sim.scoring.score/Math.max(1,sim.scoring.beacons*100+sim.scoring.cycles*500)).toFixed(2)}, ${Date.now() - t0} ms`,
  );
}
