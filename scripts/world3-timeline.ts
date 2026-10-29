/**
 * Chronologie de La Mer nébulaire (univers 3) : calendrier musical (ondes de pression, puits, éclipse, calmes) puis dangers lancés par le directeur pour une graine,
 * avec leur premier contact avec l'orbite et la distance au repère musical le plus proche. Sert à contrôler le calage des attaques sur la carte du morceau.
 * Usage : npx tsx scripts/world3-timeline.ts [graine]
 */
import { W3_BEATS, W3_CALM, W3_DROPS, W3_DROP_STRENGTH, W3_ECLIPSE, W3_WAVE_AT, W3_WELL_AT, WORLD3_AT } from '../src/config/world3';
import { worldIndexAt, worldStart } from '../src/config/worlds';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';
import { firstOrbitContact } from '../src/sim/hazards';

const seed = Number(process.argv[2] ?? 1000);
const T0 = worldStart(2);
const near = (list: readonly number[], x: number): number => list.reduce((m, b) => (Math.abs(b - x) < Math.abs(m - x) ? b : m), Infinity);

console.log(`Mer nébulaire, graine ${seed}`);
console.log(`  ondes de pression (sur impact)   : ${W3_WAVE_AT.map((t) => t.toFixed(2)).join(' · ')}`);
console.log(`  puits gravitationnels (sur battement) : ${W3_WELL_AT.map((t) => t.toFixed(2)).join(' · ')}`);
console.log(`  éclipse : entrée ${(W3_ECLIPSE.start + WORLD3_AT).toFixed(2)} s → révélation ${(W3_ECLIPSE.reveal + WORLD3_AT).toFixed(2)} s`);
console.log(`  calmes : ${W3_CALM.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join(' · ')}`);
console.log(`  impacts : ${W3_DROPS.map((t, i) => `${t.toFixed(1)}(${W3_DROP_STRENGTH[i].toFixed(2)})`).join(' ')}`);

const sim = createSimulation({ mode: 'survival', seed, worlds: true, bonus: false });
const bot = new Bot(sim, true);
const seen = new Set<number>();
const rows: string[] = [];
sim.director.onWave = (t, id) => {
  if (worldIndexAt(t) === 2) rows.push(`  ${(t - T0).toFixed(1).padStart(6)} s  ${id}`);
};
while (sim.state === 'running' && sim.time < worldStart(3)) {
  bot.tick();
  sim.step();
  sim.events.length = 0;
  if (sim.world !== 3) continue;
  for (const h of sim.hazards) {
    if (seen.has(h.id) || h.kind !== 'projectile' || h.fragment) continue;
    seen.add(h.id);
    const c = firstOrbitContact(h) - T0;
    const beat = near(W3_BEATS, c);
    const split = h.split ? ` · rupture ${(h.split.t - T0).toFixed(2)} s (impact le plus proche ${near(W3_DROPS, h.split.t - T0).toFixed(2)})` : '';
    rows.push(`          └ ${h.pattern} contact ${c.toFixed(2)} s (battement le plus proche ${(c - beat >= 0 ? '+' : '') + ((c - beat) * 1000).toFixed(0)} ms)${split}`);
  }
}
console.log(`\nDangers (${sim.state === 'running' ? 'robot vivant' : 'robot mort'} à ${(sim.time - T0).toFixed(1)} s) :`);
console.log(rows.join('\n'));
