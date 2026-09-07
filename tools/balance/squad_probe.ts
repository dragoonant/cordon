/**
 * Forecast every starting player squad against every ordinary enemy spawn on
 * a sample of maps, to see which squads can actually fight.
 * Usage: npx tsx tools/balance/squad_probe.ts [seed]
 */
import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { newRun, prepareMap, travelTo, reachableNodes } from '../../src/sim/run';
import { forecast } from '../../src/sim/forecast';
import type { BattleSide, BattleContext, Squad, Pilot, Mech, Id } from '../../src/sim/types';

const data = loadGameData();
const seed = Number(process.argv[2] ?? 7);

function sideOf(squad: Squad, pilots: Record<Id, Pilot>, mechs: Record<Id, Mech>): BattleSide {
  const p: Record<Id, Pilot> = {}, m: Record<Id, Mech> = {};
  for (const s of squad.slots) { if (!s) continue; if (pilots[s.pilotId]) p[s.pilotId] = pilots[s.pilotId]; if (mechs[s.mechId]) m[s.mechId] = mechs[s.mechId]; }
  return { squad, pilots: p, mechs: m };
}

const run = newRun(data, defaultSave(data).unlocks, seed, 0);
travelTo(run, reachableNodes(run)[0].id);
const all = run.sectors.flatMap((s) => s.nodes);

for (const threat of [1, 2, 3] as const) {
  const node = all.find((n) => n.kind === 'battle' || n.kind === 'rescue')!;
  node.threat = threat;
  node.mapId = undefined;
  run.currentNodeId = node.id;
  const prepared = prepareMap(run, data)!;
  console.log(`\n--- threat ${threat} · map ${prepared.map.id}`);
  for (const playerSquad of run.squads) {
    const sideA = sideOf(playerSquad, run.pilots, run.mechs);
    const results: string[] = [];
    for (const es of prepared.enemies.squads) {
      const sideB = sideOf(es, prepared.enemies.pilots, prepared.enemies.mechs);
      if (Object.keys(sideB.pilots).length === 0) continue;
      const ctx: BattleContext = { seed, mapKind: prepared.map.kind, terrain: 'open', weather: prepared.map.weather, calloutsA: [], calloutsB: [], markedSquadIds: [] };
      const f = forecast(sideA, sideB, ctx, data, 200);
      results.push(`${es.id.replace(/^sq_/, '')}:${(f.winProb * 100).toFixed(0)}%`);
    }
    console.log(`  ${playerSquad.name.padEnd(13)} ${results.join('  ')}`);
  }
}
