/**
 * Diagnose the rival duel: forecast the player's starting squad against the
 * rival wing at each threat level. Usage: npx tsx tools/balance/rival_probe.ts [seed]
 */
import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { newRun, prepareMap, travelTo, reachableNodes } from '../../src/sim/run';
import { forecast } from '../../src/sim/forecast';
import type { BattleSide, BattleContext, Squad, Pilot, Mech, Id } from '../../src/sim/types';

const data = loadGameData();
const seed = Number(process.argv[2] ?? 7);

function sideOf(squad: Squad, pilots: Record<Id, Pilot>, mechs: Record<Id, Mech>): BattleSide {
  const p: Record<Id, Pilot> = {};
  const m: Record<Id, Mech> = {};
  for (const slot of squad.slots) {
    if (!slot) continue;
    if (pilots[slot.pilotId]) p[slot.pilotId] = pilots[slot.pilotId];
    if (mechs[slot.mechId]) m[slot.mechId] = mechs[slot.mechId];
  }
  return { squad, pilots: p, mechs: m };
}

for (const threat of [1, 2, 3] as const) {
  const run = newRun(data, defaultSave(data).unlocks, seed, 0);
  travelTo(run, reachableNodes(run)[0].id);
  const all = run.sectors.flatMap((s) => s.nodes);
  // Force a rival node if this seed didn't roll one — we're probing the duel, not map layout.
  const rivalNode = all.find((n) => n.kind === 'rival') ?? all.find((n) => n.kind === 'battle')!;
  rivalNode.kind = 'rival';
  run.currentNodeId = rivalNode.id;
  rivalNode.visited = true;
  rivalNode.threat = threat;
  const prepared = prepareMap(run, data)!;
  const rival = prepared.enemies.squads.find((s) => s.id === 'spawn_rival')!;
  const sideB = sideOf(rival, prepared.enemies.pilots, prepared.enemies.mechs);

  for (const playerSquad of run.squads) {
    const sideA = sideOf(playerSquad, run.pilots, run.mechs);
    if (Object.keys(sideA.pilots).length === 0) continue;
    const ctx: BattleContext = {
      seed,
      mapKind: prepared.map.kind,
      terrain: 'open',
      weather: prepared.map.weather,
      calloutsA: [],
      calloutsB: [],
      markedSquadIds: [],
    };
    const f = forecast(sideA, sideB, ctx, data, 300);
    console.log(
      `threat ${threat} · ${playerSquad.name.padEnd(14)} WIN ${(f.winProb * 100).toFixed(0)}% draw ${(f.drawProb * 100).toFixed(0)}% loss ${(f.lossProb * 100).toFixed(0)}%  dealt ${f.expectedDamageDealt.toFixed(0)} taken ${f.expectedDamageTaken.toFixed(0)}`
    );
  }
  const rp = Object.values(sideB.pilots)[0];
  console.log(`   rival wing: ${Object.keys(sideB.pilots).length} pilots; lead apt=`, rp && rp.aptitudes,
    '\n   frames:', Object.values(sideB.mechs).map((m) => `${m.frameId} hp${m.hp} A=${m.weaponA} B=${m.weaponB}`).join(' | '));
}
