import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { newRun, prepareMap, travelTo, reachableNodes, currentNode } from '../../src/sim/run';
import { createWorld, deploySquad, orderMove, stepWorld, playerSquads, buildBattleSides, setPendingCallouts, beginBattle, applyBattleResult } from '../../src/sim/world';
import { resolveBattle } from '../../src/sim/battle';
import { hashString } from '../../src/sim/rng';
import type { SideBundle, WorldState } from '../../src/sim/world';
import type { MapDef, Vec2 } from '../../src/sim/types';

const data = loadGameData();
const save = defaultSave(data);
const run = newRun(data, save.unlocks, 3, 0);

// travel to node_c2_r0 (seed3 had a warning there) - or just find first battle/rescue node deterministically like harness would
function dist(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Force travel toward the lowtown rescue map: walk the same path the harness's chooseNode would.
// Simplify: just travel greedily preferring rescue.
function chooseNode(run: any, reachable: any[]): string {
  const byKind = (k: string) => reachable.filter((n: any) => n.kind === k);
  const rescues = byKind('rescue');
  if (rescues.length) return rescues[0].id;
  const battles = byKind('battle');
  if (battles.length) return battles[0].id;
  return reachable[0].id;
}

let found = false;
while (!found) {
  const reachable = reachableNodes(run);
  if (!reachable.length) break;
  const nid = chooseNode(run, reachable);
  travelTo(run, nid);
  const node = currentNode(run);
  console.log('visited', node.id, node.kind, node.mapKind, node.mapId);
  if (node.kind === 'rescue') {
    const prepared = prepareMap(run, data)!;
    if (prepared.map.id === 'map_surface_lowtown_rescue') { found = true; break; }
  }
  if (node.kind === 'battle' || node.kind === 'rescue' || node.kind === 'boss' || node.kind === 'rival') {
    // simulate minimally just to move on (skip actual battle sim; not needed for this probe)
    break;
  }
}

const node = currentNode(run);
console.log('final node', node.id, node.kind, node.mapId);
const prepared = prepareMap(run, data);
if (!prepared) { console.log('no map'); process.exit(1); }
const map = prepared.map;
console.log('map', map.id, 'timeLimit', map.timeLimit);

const seed = hashString(`${run.seed}:${run.currentNodeId}:${run.turn}`);
const player: SideBundle = {
  squads: run.squads.map((s) => ({ ...s, slots: [...s.slots] })),
  pilots: run.pilots,
  mechs: run.mechs,
};
const world = createWorld(map, seed, data, player, prepared.enemies);
for (const squad of playerSquads(world)) deploySquad(world, map, squad.id, data);

function nearestIncompleteObjectiveTarget(world: WorldState, map: MapDef, from: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDist = Infinity;
  for (const def of map.objectives) {
    const state = world.objectives[def.id];
    if (!state || state.status === 'complete' || state.status === 'failed') continue;
    let pos: Vec2;
    if (def.kind === 'destroy_target') {
      const targetSquad = def.targetSquadId ? world.squads[def.targetSquadId] : undefined;
      pos = targetSquad ? targetSquad.pos : state.pos;
    } else {
      pos = state.pos;
    }
    const d = dist(from, pos);
    if (d < bestDist) { bestDist = d; best = pos; }
  }
  return best;
}

let lastBucket = -1;
let steps = 0;
const cap = map.timeLimit || 900;
while (world.phase !== 'ended' && world.time < cap && steps < 6000) {
  steps++;
  if (world.phase === 'battle_pending') {
    const sides = buildBattleSides(world, map, data);
    setPendingCallouts(world, []);
    beginBattle(world);
    const result = resolveBattle(sides.sideA, sides.sideB, sides.ctx, data);
    applyBattleResult(world, map, result, data);
    console.log(`t=${world.time.toFixed(1)} BATTLE ${sides.sideA.squad.id} vs ${sides.sideB.squad.id} winner=${result.winner} deathsA=${result.pilotDeaths.filter(d=>d.side==='A').length} mechsLostA=${result.mechsLost.filter(m=>m.side==='A').length}`);
    continue;
  }
  const bucket = Math.floor(world.time / 3);
  if (bucket !== lastBucket) {
    lastBucket = bucket;
    for (const squad of playerSquads(world)) {
      if (squad.state === 'docked' || squad.state === 'destroyed' || squad.state === 'engaged' || squad.state === 'routed') continue;
      const target = nearestIncompleteObjectiveTarget(world, map, squad.pos);
      if (target) orderMove(world, map, squad.id, target, data);
    }
    if (bucket % 10 === 0) {
      const convoyState = world.objectives['obj_lowtown_convoy'];
      console.log(
        `t=${world.time.toFixed(0)} convoyPos=(${convoyState?.pos.x.toFixed(1)},${convoyState?.pos.y.toFixed(1)}) progress=${convoyState?.progress.toFixed(2)} hp=${convoyState?.hp} status=${convoyState?.status}`,
        playerSquads(world).map((s) => `${s.id}:${s.state}@(${s.pos.x.toFixed(1)},${s.pos.y.toFixed(1)})`).join(' ')
      );
    }
  }
  stepWorld(world, map, 0.1, data);
}
console.log('END phase', world.phase, 'outcome', world.outcome, 'time', world.time.toFixed(1));
console.log('objectives', Object.values(world.objectives).map((o) => `${o.id}:${o.status}:${o.progress.toFixed(2)}:hp=${o.hp}`));
