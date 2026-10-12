/** Coût du directeur de vagues (validateur d'évitement inclus) : durée de chaque appel à Director.update qui lance une vague. */
import { survivalProfile } from '../src/modes/profiles';
import { Bot } from '../src/sim/bot';
import { Simulation } from '../src/sim/simulation';

const sim = new Simulation({ seed: 7, profile: survivalProfile(), timeLimit: null });
const bot = new Bot(sim);
const orig = sim.director.update.bind(sim.director);
const times: number[] = [];
sim.director.update = (now, world) => {
  const t0 = performance.now();
  const r = orig(now, world);
  if (r || performance.now() - t0 > 0.05) times.push(performance.now() - t0);
  return r;
};
for (let i = 0; i < 8 * 60 * 120 && sim.state === 'running'; i++) {
  bot.tick();
  sim.step();
  sim.events.length = 0;
}
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.floor(times.length * p)].toFixed(2);
console.log(`appels ${times.length} | médiane ${q(0.5)} ms | p95 ${q(0.95)} ms | p99 ${q(0.99)} ms | max ${times[times.length - 1].toFixed(2)} ms`);
