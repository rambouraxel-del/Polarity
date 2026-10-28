/**
 * Outil de contrôle de La Faille (univers 2) : chronologie des attaques d'une partie jouée par le robot, avec leur calage sur la carte musicale.
 * Usage : npx tsx scripts/world2-timeline.ts [graine] [parties]
 * Pour chaque attaque : temps local de l'annonce, de l'activation (premier contact), écart au battement / à la percussion / à l'impact le plus proche,
 * intensité du morceau et passage (calme, montée).
 */
import { SIM } from '../src/config/balance';
import { W2_BEATS, W2_BUILDS, W2_DROPS, W2_HITS, W2_DROP_STRENGTH, inCalm, intensityAt } from '../src/config/world2';
import { WORLDS, worldStart } from '../src/config/worlds';
import { createSimulation } from '../src/modes/run';
import { Bot } from '../src/sim/bot';
import { firstOrbitContact, type Hazard } from '../src/sim/hazards';

const seed0 = Number(process.argv[2] ?? 1000);
const games = Number(process.argv[3] ?? 1);
const near = (list: readonly number[], t: number): number => {
  let best = Infinity;
  for (const x of list) if (Math.abs(x - t) < Math.abs(best)) best = x - t;
  return best;
};
const ms = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${Math.round(x * 1000)}` : '—');

for (let g = 0; g < games; g++) {
  const seed = seed0 + g * 7919;
  const sim = createSimulation({ mode: 'survival', seed, worlds: true, bonus: false });
  const bot = new Bot(sim, true);
  const seen = new Set<number>();
  console.log(`graine ${seed}`);
  console.log('  annonce  activ.   motif            batt.   perc.   impact   intens. note');
  const end = worldStart(1) + WORLDS.span;
  while (sim.state === 'running' && sim.time < end) {
    bot.tick();
    sim.step();
    sim.events.length = 0;
    if (sim.world !== 2) continue;
    const groups = new Map<string, Hazard[]>();
    for (const h of sim.hazards) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      const key = `${h.pattern}@${h.warnStart.toFixed(3)}`;
      groups.set(key, [...(groups.get(key) ?? []), h]);
    }
    for (const [key, hs] of groups) {
      const [pattern] = key.split('@');
      const contact = Math.min(...hs.map(firstOrbitContact));
      const l = contact - worldStart(1);
      const note = [inCalm(l) ? 'CALME' : '', W2_BUILDS.some(([a, b]) => l >= a && l < b) ? 'montée' : '', hs.length > 1 ? `${hs.length} dangers` : ''].filter(Boolean).join(' ');
      const impIdx = W2_DROPS.findIndex((d) => Math.abs(d - l) < 0.02);
      console.log(
        `  ${(hs[0].warnStart - worldStart(1)).toFixed(2).padStart(7)} ${l.toFixed(2).padStart(7)}  ${pattern.padEnd(15)} ${ms(near(W2_BEATS, l)).padStart(6)} ${ms(near(W2_HITS, l)).padStart(7)} ${ms(near(W2_DROPS, l)).padStart(7)}${impIdx >= 0 ? `*${W2_DROP_STRENGTH[impIdx].toFixed(1)}` : '    '} ${intensityAt(l).toFixed(2).padStart(6)}  ${note}`,
      );
    }
  }
  console.log(`  état ${sim.state} à ${sim.time.toFixed(1)} s`);
}
void SIM;
