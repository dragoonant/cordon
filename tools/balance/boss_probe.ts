/** Diagnose the boss map: play it with a simple commander and report why it ends. */
import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { newRun, prepareMap, travelTo, reachableNodes, currentNode, recordBattle } from '../../src/sim/run';
import { createWorld, stepWorld, deploySquad, orderMove, buildBattleSides, beginBattle, applyBattleResult, setPendingCallouts, playerSquads, enemySquads } from '../../src/sim/world';
import { resolveBattle } from '../../src/sim/battle';

const data = loadGameData();
const seed = Number(process.argv[2] ?? 7);
const run = newRun(data, defaultSave(data).unlocks, seed, 0);
// Jump straight to the boss node.
const boss = run.sectors[0].nodes.find((n) => n.kind === 'boss')!;
travelTo(run, reachableNodes(run)[0].id);
run.currentNodeId = boss.id;
boss.visited = true;
const prepared = prepareMap(run, data)!;
const map = prepared.map;
const world = createWorld(map, 99, data, { squads: run.squads, pilots: run.pilots, mechs: run.mechs }, prepared.enemies);
for (const sq of run.squads) deploySquad(world, map, sq.id, data);

const bossSquad = enemySquads(world).find((s) => s.id.includes('boss'))!;
console.log('map', map.id, 'timeLimit', map.timeLimit, 'boss squad', bossSquad.id, 'at', bossSquad.pos, 'ai', bossSquad.ai?.behavior);
console.log('objectives', map.objectives.map((o) => `${o.id}:${o.kind}${o.required ? '*' : ''}@${o.pos.x},${o.pos.y}`).join(' '));
console.log('deploy', map.deployZone.pos);

let lastOrder = -99;
let battles = 0;
const log: string[] = [];
while (world.phase !== 'ended' && world.time < (map.timeLimit || 900) + 5) {
  if (world.phase === 'battle_pending') {
    const sides = buildBattleSides(world, map, data);
    setPendingCallouts(world, []);
    beginBattle(world);
    const r = resolveBattle(sides.sideA, sides.sideB, { ...sides.ctx, calloutsA: [] }, data);
    if (r.winner === 'A') recordBattle(run, r, data);
    applyBattleResult(world, map, r, data);
    battles++;
    log.push(`t=${world.time.toFixed(0)} battle ${sides.sideA.squad.id} vs ${sides.sideB.squad.id} -> ${r.winner} deathsA=${r.pilotDeaths.filter((d) => d.side === 'A').length}`);
    continue;
  }
  if (world.time - lastOrder > 3) {
    lastOrder = world.time;
    for (const sq of playerSquads(world)) {
      if (sq.state === 'destroyed' || sq.state === 'docked') continue;
      const target = bossSquad.state !== 'destroyed' ? bossSquad.pos : map.objectives[0].pos;
      const r = orderMove(world, map, sq.id, target, data);
      if (!r.ok && log.length < 40) log.push(`t=${world.time.toFixed(0)} move ${sq.id} -> ${target.x.toFixed(1)},${target.y.toFixed(1)} FAILED ${r.reason}`);
    }
  }
  stepWorld(world, map, 0.1, data);
}
console.log(log.slice(0, 40).join('\n'));
console.log('END phase', world.phase, 'outcome', world.outcome, 'time', world.time.toFixed(0), 'carrier', world.carrierHp, 'battles', battles);
console.log('objectives', Object.values(world.objectives).map((o) => `${o.id}:${o.status}`).join(' '));
console.log('player squads', playerSquads(world).map((s) => `${s.id}:${s.state}@${s.pos.x.toFixed(1)},${s.pos.y.toFixed(1)} fuel=${s.fuel.toFixed(0)}`).join(' | '));
console.log('enemy squads', enemySquads(world).map((s) => `${s.id}:${s.state}@${s.pos.x.toFixed(1)},${s.pos.y.toFixed(1)}`).join(' | '));
console.log('last events', world.events.slice(-8).map((e) => JSON.stringify(e)).join('\n'));
