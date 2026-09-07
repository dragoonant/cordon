/**
 * Forecast a fresh starting squad against each garrison on the territory maps,
 * at the threat levels those nodes can actually roll.
 * Usage: npx tsx tools/balance/territory_probe.ts [seed]
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

for (const mapId of ['map_surface_ashline_corridor', 'map_space_kessler_anchorage']) {
  for (const threat of [2, 3] as const) {
    const run = newRun(data, defaultSave(data).unlocks, seed, 0);
    travelTo(run, reachableNodes(run)[0].id);
    const node = run.sectors.flatMap((s) => s.nodes).find((n) => n.col === 2)!;
    node.kind = 'territory';
    node.threat = threat;
    node.mapId = mapId;
    run.currentNodeId = node.id;
    const prepared = prepareMap(run, data)!;
    if (prepared.map.id !== mapId) { console.log('map mismatch', prepared.map.id); continue; }

    console.log(`\n=== ${mapId} threat ${threat}`);
    for (const playerSquad of run.squads) {
      const sideA = sideOf(playerSquad, run.pilots, run.mechs);
      const out: string[] = [];
      for (const es of prepared.enemies.squads) {
        const sideB = sideOf(es, prepared.enemies.pilots, prepared.enemies.mechs);
        if (Object.keys(sideB.pilots).length === 0) continue;
        const ctx: BattleContext = { seed, mapKind: prepared.map.kind, terrain: 'open', weather: prepared.map.weather, calloutsA: [], calloutsB: [], markedSquadIds: [] };
        const f = forecast(sideA, sideB, ctx, data, 200);
        out.push(`${es.id.replace(/^sq_(ash|kes)_/, '')}:${(f.winProb * 100).toFixed(0)}%`);
      }
      console.log(`  ${playerSquad.name.padEnd(13)} ${out.join('  ')}`);
    }
  }
}
