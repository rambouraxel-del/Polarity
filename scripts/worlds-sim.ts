/**
 * Outil d'équilibrage du VOYAGE DES UNIVERS (joueur automatique) : npx tsx scripts/worlds-sim.ts [minutes] [parties]
 * Pour chaque partie : temps de survie, univers atteint, vagues et reports par univers. Le bot est bien plus réactif qu'un humain :
 * il vérifie la COHÉRENCE du générateur (aucune vague inévitable, univers franchissables), pas le ressenti.
 */
import { SIM } from '../src/config/balance';
import { WORLD_LIST, worldIndexAt } from '../src/config/worlds';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';

const minutes = Number(process.argv[2] ?? 9);
const games = Number(process.argv[3] ?? 6);
const maxSteps = Math.round((minutes * 60) / SIM.dt);
for (let g = 0; g < games; g++) {
  const seed = 1000 + g * 7919;
  const sim = createSimulation({ mode: 'survival', seed, worlds: true, bonus: false });
  const waves = WORLD_LIST.map(() => 0);
  const kinds = WORLD_LIST.map(() => new Map<string, number>());
  sim.director.onWave = (t, id) => {
    const i = worldIndexAt(t);
    waves[i]++;
    kinds[i].set(id, (kinds[i].get(id) ?? 0) + 1);
  };
  const bot = new Bot(sim, true);
  const t0 = performance.now();
  for (let i = 0; i < maxSteps && sim.state === 'running'; i++) {
    bot.tick();
    sim.step();
    sim.events.length = 0;
  }
  const ms = performance.now() - t0;
  const dead = sim.state === 'dead';
  console.log(`seed ${seed}: ${dead ? 'mort' : 'vivant'} à ${sim.time.toFixed(1)} s · univers ${sim.world} · vagues ${waves.join('/')} · reportées ${sim.director.deferred} · ${(ms / (sim.time || 1)).toFixed(2)} ms par s simulée`);
  if (g === 0) for (let i = 0; i < kinds.length; i++) console.log(`   U${i + 1}: ${[...kinds[i].entries()].map(([k, n]) => `${k}×${n}`).join(' ')}`);
}
