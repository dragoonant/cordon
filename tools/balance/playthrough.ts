/**
 * CORDON — headless end-to-end playthrough harness.
 *
 * Plays N complete runs with a simple scripted commander, mirroring the exact
 * sim call order the real UI (src/ui/store.ts) uses per node/map/battle:
 *   launchMap            -> createWorld
 *   tick                 -> stepWorld
 *   battle_pending        -> buildBattleSides -> (forecast, read-only) ->
 *                            setPendingCallouts -> buildBattleSides (again,
 *                            to pick up the callouts) -> beginBattle ->
 *                            resolveBattle -> (winner A) recordBattle
 *   battleFinished        -> applyBattleResult
 *   map ended             -> finishMap
 *   node_map (distress)   -> resolveDistress
 *   node_map (salvage)    -> salvageNode
 *   node_map (depot)      -> depotStock -> depotBuy(+repairAll)
 *   run end               -> applyRunEnd
 *
 * This file (and its .test.ts) is the only thing this tool owns — no src/
 * file is modified here. Determinism: every seed used anywhere in this file
 * is derived from the run's own seed (`run.seed`) via the sim's own
 * `hashString`/`Rng`, exactly like the real UI does; the only exception is
 * the wall-clock timing captured purely for the printed/report "sim wall
 * time" column, which never feeds back into any decision or seed.
 *
 * Usage: npx tsx tools/balance/playthrough.ts [runs=20] [seed=1]
 */
import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { repairAll } from '../../src/sim/hangar';
import { hashString } from '../../src/sim/rng';
import { resolveBattle } from '../../src/sim/battle';
import { forecast as computeForecast } from '../../src/sim/forecast';
import {
  applyRunEnd,
  currentNode,
  depotBuy,
  depotStock,
  finishMap,
  newRun,
  prepareMap,
  reachableNodes,
  recordBattle,
  resolveDistress,
  salvageNode,
  travelTo,
} from '../../src/sim/run';
import {
  applyBattleResult,
  beginBattle,
  buildBattleSides,
  createWorld,
  deploySquad,
  orderMove,
  playerSquads,
  setPendingCallouts,
  stepWorld,
} from '../../src/sim/world';
import type { SideBundle } from '../../src/sim/world';
import type {
  ActiveCallout,
  BattleContext,
  GameData,
  Id,
  MapDef,
  RunNode,
  RunState,
  Unlocks,
  Vec2,
  WorldState,
} from '../../src/sim/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunLog {
  seed: number;
  result: 'won' | 'lost' | 'stuck' | 'error';
  nodesVisited: number;
  battlesFought: number;
  battlesWon: number;
  pilotDeaths: Id[];
  mechsLost: number;
  finalScrap: number;
  finalStanding: number;
  bossReached: boolean;
  rivalMet: boolean;
  wallTimeMs: number;
  newlyUnlocked: string[];
  warnings: string[];
  error?: { message: string; stack: string };
}

export interface SweepSummary {
  runs: number;
  winRate: number;
  avgDeathsPerRun: number;
  avgBattlesPerRun: number;
  avgNodesPerRun: number;
  mostKilledPilot: { pilotId: Id; kills: number } | null;
  unlockIdsGained: string[];
  exceptions: { seed: number; message: string }[];
  warnCount: number;
}

export interface SweepResult {
  logs: RunLog[];
  summary: SweepSummary;
}

const NODE_VISIT_CAP = 40;
const PUNCH_OUT_ID = 'co_punch_out';
const PUNCH_OUT_DEATH_RISK_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// Commander policy: node selection
// ---------------------------------------------------------------------------

/** Deterministic tie-break: lowest node id wins among equally-preferred candidates. */
function lowestId(nodes: RunNode[]): RunNode {
  return [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

function averagePilotKills(run: RunState): number {
  const pilots = Object.values(run.pilots);
  if (pilots.length === 0) return 0;
  return pilots.reduce((sum, p) => sum + p.kills, 0) / pilots.length;
}

/**
 * Picks the next node to travel to, preferring in order: depot (if scrap >=
 * 120), rescue, battle, salvage, distress, rival (only once avg pilot kills
 * >= 3), boss (only when it's the only reachable option). Falls back to the
 * lowest-id reachable node so the run always makes progress.
 */
function chooseNode(run: RunState, reachable: RunNode[]): Id {
  const byKind = (kind: RunNode['kind']) => reachable.filter((n) => n.kind === kind);

  const depots = byKind('depot');
  if (run.scrap >= 120 && depots.length) return lowestId(depots).id;

  const rescues = byKind('rescue');
  if (rescues.length) return lowestId(rescues).id;

  const battles = byKind('battle');
  if (battles.length) return lowestId(battles).id;

  const salvages = byKind('salvage');
  if (salvages.length) return lowestId(salvages).id;

  const distresses = byKind('distress');
  if (distresses.length) return lowestId(distresses).id;

  const rivals = byKind('rival');
  if (rivals.length && averagePilotKills(run) >= 3) return lowestId(rivals).id;

  const bosses = byKind('boss');
  if (bosses.length && bosses.length === reachable.length) return lowestId(bosses).id;

  // Fallback: whatever's reachable (depot too poor to afford, rival below the
  // kill threshold, or a boss that isn't technically "the only option" by the
  // above check but is still all that's left) — pick deterministically.
  return lowestId(reachable).id;
}

// ---------------------------------------------------------------------------
// Commander policy: map movement
// ---------------------------------------------------------------------------

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Nearest incomplete objective's *current* target position: for
 * 'destroy_target' that's the boss squad's live position, for 'convoy' the
 * convoy's live position (both move over time), for everything else the
 * objective's (static) position.
 */
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
      pos = state.pos; // convoy's state.pos already tracks its live position
    }
    const d = dist(from, pos);
    if (d < bestDist) {
      bestDist = d;
      best = pos;
    }
  }
  return best;
}

function runCommanderMovement(world: WorldState, map: MapDef, data: GameData): void {
  for (const squad of playerSquads(world)) {
    if (squad.state === 'docked' || squad.state === 'destroyed' || squad.state === 'engaged' || squad.state === 'routed') continue;
    const target = nearestIncompleteObjectiveTarget(world, map, squad.pos);
    if (target) orderMove(world, map, squad.id, target, data);
  }
}

// ---------------------------------------------------------------------------
// Battle handling (mirrors src/ui/store.ts's commitBattle -> battleFinished)
// ---------------------------------------------------------------------------

interface BattleOutcome {
  winnerA: boolean;
  mechsLostA: number;
}

function handleBattlePending(world: WorldState, map: MapDef, data: GameData, run: RunState): BattleOutcome {
  // Read-only forecast pass to decide on a defensive callout, same shape as
  // the store's tick() (buildBattleSides -> forecast with calloutsA: []).
  const preSides = buildBattleSides(world, map, data);
  const callouts: ActiveCallout[] = [];
  const punchOutDef = data.callouts[PUNCH_OUT_ID];
  if (punchOutDef) {
    const fc = computeForecast(preSides.sideA, preSides.sideB, { ...preSides.ctx, calloutsA: [] }, data, 60);
    for (const pm of fc.perMech) {
      if (pm.pilotDeathRisk <= PUNCH_OUT_DEATH_RISK_THRESHOLD) continue;
      const pilot = preSides.sideA.pilots[pm.pilotId];
      if (pilot && pilot.callouts.includes(PUNCH_OUT_ID) && pilot.nerve >= punchOutDef.nerveCost) {
        callouts.push({ calloutId: PUNCH_OUT_ID, pilotId: pm.pilotId });
      }
    }
  }

  // Exact order the store's commitBattle() uses: setPendingCallouts BEFORE
  // (re)building sides, so ctx.calloutsA reflects the committed callouts.
  setPendingCallouts(world, callouts);
  const sides = buildBattleSides(world, map, data);
  const ctx: BattleContext = { ...sides.ctx, calloutsA: callouts };
  beginBattle(world);
  const result = resolveBattle(sides.sideA, sides.sideB, ctx, data);
  for (const c of callouts) {
    const p = result.sideA.pilots[c.pilotId];
    const def = data.callouts[c.calloutId];
    if (p && def) p.nerve = Math.max(0, p.nerve - def.nerveCost);
  }
  if (result.winner === 'A') recordBattle(run, result, data);
  applyBattleResult(world, map, result, data);

  return {
    winnerA: result.winner === 'A',
    mechsLostA: result.mechsLost.filter((m) => m.side === 'A').length,
  };
}

// ---------------------------------------------------------------------------
// Map node simulation
// ---------------------------------------------------------------------------

const COMMANDER_INTERVAL = 3; // seconds
const MAP_STEP_DT = 0.1; // seconds

interface MapNodeResult {
  battlesFought: number;
  battlesWon: number;
  mechsLostA: number;
}

function handleMapNode(run: RunState, data: GameData, warnings: string[]): MapNodeResult {
  const node = currentNode(run);
  const prepared = prepareMap(run, data);
  if (!prepared) {
    warnings.push(`prepareMap returned null for node ${node.id} (kind=${node.kind}, mapKind=${node.mapKind})`);
    return { battlesFought: 0, battlesWon: 0, mechsLostA: 0 };
  }
  const { map, enemies } = prepared;

  // Same seed derivation as store.launchMap().
  const seed = hashString(`${run.seed}:${run.currentNodeId}:${run.turn}`);
  const player: SideBundle = {
    squads: run.squads.map((s) => ({ ...s, slots: [...s.slots] })),
    pilots: run.pilots,
    mechs: run.mechs,
  };
  const world = createWorld(map, seed, data, player, enemies);

  for (const squad of playerSquads(world)) {
    deploySquad(world, map, squad.id, data); // no-op (ok:false) for squads with zero living mechs
  }

  let battlesFought = 0;
  let battlesWon = 0;
  let mechsLostA = 0;

  const cap = map.timeLimit || 900;
  const maxSteps = Math.ceil(cap / MAP_STEP_DT) + 100; // safety valve against a stepWorld/phase bug hanging the harness
  let steps = 0;
  let lastCommanderBucket = -1;

  while (world.phase !== 'ended' && world.time < cap && steps < maxSteps) {
    steps++;

    if (world.phase === 'battle_pending') {
      const outcome = handleBattlePending(world, map, data, run);
      battlesFought++;
      if (outcome.winnerA) battlesWon++;
      mechsLostA += outcome.mechsLostA;
      continue;
    }

    if (world.phase !== 'running' && world.phase !== 'deploy') {
      warnings.push(`unexpected world.phase '${world.phase}' during map ${map.id} (node ${node.id}) simulation loop`);
      break;
    }

    const bucket = Math.floor(world.time / COMMANDER_INTERVAL);
    if (bucket !== lastCommanderBucket) {
      lastCommanderBucket = bucket;
      runCommanderMovement(world, map, data);
    }
    stepWorld(world, map, MAP_STEP_DT, data);
  }

  if (world.phase !== 'ended') {
    warnings.push(
      `map ${map.id} (node ${node.id}) never reached phase 'ended' within cap=${cap}s (steps=${steps}, time=${world.time.toFixed(2)})`
    );
  }
  if (world.time > cap + 1) {
    warnings.push(`world.time ${world.time.toFixed(2)} exceeded cap+1 (${cap + 1}) for map ${map.id} (node ${node.id})`);
  }
  if (world.outcome === 'victory') {
    const requiredDefs = map.objectives.filter((o) => o.required);
    const allComplete = requiredDefs.every((o) => world.objectives[o.id]?.status === 'complete');
    if (!allComplete) warnings.push(`map ${map.id} (node ${node.id}) reported victory but not all required objectives are complete`);
  }

  finishMap(run, world, map, data);

  for (const squad of run.squads) {
    for (const slot of squad.slots) {
      if (!slot) continue;
      const pilot = run.pilots[slot.pilotId];
      if (pilot && !pilot.alive) {
        warnings.push(`dead pilot ${slot.pilotId} still assigned to squad ${squad.id} slot after finishMap (node ${node.id})`);
      }
    }
  }
  if (run.scrap < 0) warnings.push(`run.scrap went negative (${run.scrap}) after finishMap (node ${node.id})`);

  return { battlesFought, battlesWon, mechsLostA };
}

// ---------------------------------------------------------------------------
// Non-map node handling
// ---------------------------------------------------------------------------

function handleDistress(run: RunState, data: GameData, warnings: string[]): void {
  const node = currentNode(run);
  const eventDef = node.eventId ? data.events[node.eventId] : undefined;
  if (!eventDef || eventDef.choices.length === 0) {
    warnings.push(`distress node ${node.id} has no resolvable event/choices (eventId=${node.eventId})`);
    return;
  }
  resolveDistress(run, eventDef.choices[0].id, data);
  if (run.scrap < 0) warnings.push(`run.scrap went negative (${run.scrap}) after distress node ${node.id}`);
}

function handleSalvage(run: RunState, data: GameData): void {
  salvageNode(run, data);
}

function handleDepot(run: RunState, data: GameData, warnings: string[]): void {
  const stock = depotStock(run, data);
  const cheapestFrame = [...stock.frames].sort((a, b) => a.cost - b.cost)[0];
  if (cheapestFrame && run.scrap >= cheapestFrame.cost) {
    depotBuy(run, 'frame', cheapestFrame.id, cheapestFrame.cost);
  } else {
    const cheapestWeapon = [...stock.weapons].sort((a, b) => a.cost - b.cost)[0];
    if (cheapestWeapon && run.scrap >= cheapestWeapon.cost) {
      depotBuy(run, 'weapon', cheapestWeapon.id, cheapestWeapon.cost);
    }
  }
  repairAll(run, data);
  // The real UI marks a depot node cleared via leaveNode(); depotStock/Buy
  // don't touch `cleared` themselves, so mirror leaveNode()'s effect here.
  currentNode(run).cleared = true;
  if (run.scrap < 0) warnings.push(`run.scrap went negative (${run.scrap}) after depot node ${currentNode(run).id}`);
}

// ---------------------------------------------------------------------------
// One full run
// ---------------------------------------------------------------------------

interface PlayOneRunOutcome {
  run: RunState;
  battlesFought: number;
  battlesWon: number;
  mechsLost: number;
  warnings: string[];
  unlocksOut: Unlocks;
  newlyUnlocked: string[];
}

function diffUnlocks(before: Unlocks, after: Unlocks): string[] {
  const diffs: string[] = [];
  (['pilots', 'frames', 'weapons', 'systems'] as const).forEach((cat) => {
    const seen = new Set(before[cat]);
    for (const id of after[cat]) {
      if (!seen.has(id)) diffs.push(`${cat}:${id}`);
    }
  });
  return diffs;
}

function playOneRun(data: GameData, unlocksIn: Unlocks, seed: number): PlayOneRunOutcome {
  const warnings: string[] = [];
  const run = newRun(data, unlocksIn, seed, 0);

  let battlesFought = 0;
  let battlesWon = 0;
  let mechsLost = 0;

  while (run.status === 'active' && run.turn < NODE_VISIT_CAP) {
    const reachable = reachableNodes(run);
    if (reachable.length === 0) {
      warnings.push(`no reachable nodes from ${run.currentNodeId} while run still active (turn ${run.turn}) — dead end in node graph`);
      break;
    }
    const nextId = chooseNode(run, reachable);
    travelTo(run, nextId);
    const node = currentNode(run);
    if (node.kind === 'start') warnings.push(`travelled into a 'start' node mid-run: ${node.id}`);

    switch (node.kind) {
      case 'distress':
        handleDistress(run, data, warnings);
        break;
      case 'salvage':
        handleSalvage(run, data);
        break;
      case 'depot':
        handleDepot(run, data, warnings);
        break;
      case 'battle':
      case 'rescue':
      case 'rival':
      case 'boss': {
        const res = handleMapNode(run, data, warnings);
        battlesFought += res.battlesFought;
        battlesWon += res.battlesWon;
        mechsLost += res.mechsLostA;
        break;
      }
      case 'start':
        break; // unreachable in practice; the graph never routes back to start
      default:
        warnings.push(`unhandled node kind '${node.kind}' at ${node.id}`);
    }

    if (run.scrap < 0) warnings.push(`run.scrap went negative (${run.scrap}) after node ${node.id} (${node.kind})`);
  }

  // Sanity check: only sector.nodes[0] should ever be a visited 'start' node.
  for (const sector of run.sectors) {
    for (const n of sector.nodes) {
      if (n.visited && n.kind === 'start' && n.col !== 0) {
        warnings.push(`visited non-origin 'start' node ${n.id} (col ${n.col})`);
      }
    }
  }

  if (run.status === 'active') {
    // Hit the node-visit cap without winning or losing — report as 'stuck'
    // and, matching the real game (applyRunEnd only fires when a run
    // actually concludes), do NOT advance meta-unlocks for this run.
    return { run, battlesFought, battlesWon, mechsLost, warnings, unlocksOut: unlocksIn, newlyUnlocked: [] };
  }

  if (run.status === 'won' && battlesFought === 0) {
    warnings.push(`run ${seed} reported 'won' with zero battles fought`);
  }

  const unlocksOut = applyRunEnd(unlocksIn, run, data);
  const newlyUnlocked = diffUnlocks(unlocksIn, unlocksOut);
  return { run, battlesFought, battlesWon, mechsLost, warnings, unlocksOut, newlyUnlocked };
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/** Runs `runsCount` complete playthroughs, seeds `seedBase..seedBase+runsCount-1`. */
export function runSweep(runsCount: number, seedBase: number): SweepResult {
  const data = loadGameData();
  let unlocks = defaultSave(data).unlocks;

  const logs: RunLog[] = [];
  const killsByPilot = new Map<Id, number>();

  for (let i = 0; i < runsCount; i++) {
    const seed = seedBase + i;
    const t0 = Date.now(); // wall-clock only, for the reported timing column — never fed back into the sim
    try {
      const outcome = playOneRun(data, unlocks, seed);
      unlocks = outcome.unlocksOut;
      const wallTimeMs = Date.now() - t0;
      const run = outcome.run;

      for (const pilot of Object.values(run.pilots)) {
        killsByPilot.set(pilot.id, (killsByPilot.get(pilot.id) ?? 0) + pilot.kills);
      }

      const result: RunLog['result'] = run.status === 'won' ? 'won' : run.status === 'lost' ? 'lost' : 'stuck';
      logs.push({
        seed,
        result,
        nodesVisited: run.turn,
        battlesFought: outcome.battlesFought,
        battlesWon: outcome.battlesWon,
        pilotDeaths: run.history.flatMap((h) => h.pilotDeaths),
        mechsLost: outcome.mechsLost,
        finalScrap: run.scrap,
        finalStanding: run.standing,
        bossReached: run.history.some((h) => h.kind === 'boss'),
        rivalMet: run.history.some((h) => h.kind === 'rival'),
        wallTimeMs,
        newlyUnlocked: outcome.newlyUnlocked,
        warnings: outcome.warnings,
      });
    } catch (e) {
      const err = e as Error;
      logs.push({
        seed,
        result: 'error',
        nodesVisited: 0,
        battlesFought: 0,
        battlesWon: 0,
        pilotDeaths: [],
        mechsLost: 0,
        finalScrap: 0,
        finalStanding: 0,
        bossReached: false,
        rivalMet: false,
        wallTimeMs: Date.now() - t0,
        newlyUnlocked: [],
        warnings: [],
        error: { message: err?.message ?? String(e), stack: err?.stack ?? '' },
      });
    }
  }

  const completed = logs.filter((l) => l.result !== 'error');
  const wonCount = completed.filter((l) => l.result === 'won').length;
  const avg = (f: (l: RunLog) => number) => (completed.length ? completed.reduce((s, l) => s + f(l), 0) / completed.length : 0);

  let mostKilledPilot: SweepSummary['mostKilledPilot'] = null;
  for (const [pilotId, kills] of killsByPilot) {
    if (!mostKilledPilot || kills > mostKilledPilot.kills) mostKilledPilot = { pilotId, kills };
  }

  const unlockIdsGained: string[] = [];
  for (const l of logs) unlockIdsGained.push(...l.newlyUnlocked);

  const summary: SweepSummary = {
    runs: runsCount,
    winRate: completed.length ? wonCount / completed.length : 0,
    avgDeathsPerRun: avg((l) => l.pilotDeaths.length),
    avgBattlesPerRun: avg((l) => l.battlesFought),
    avgNodesPerRun: avg((l) => l.nodesVisited),
    mostKilledPilot,
    unlockIdsGained,
    exceptions: logs.filter((l) => l.error).map((l) => ({ seed: l.seed, message: l.error!.message })),
    warnCount: logs.reduce((s, l) => s + l.warnings.length, 0),
  };

  return { logs, summary };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printTable(logs: RunLog[]): void {
  const header = [
    'seed'.padEnd(6),
    'result'.padEnd(7),
    'nodes'.padEnd(6),
    'battles'.padEnd(8),
    'won'.padEnd(4),
    'deaths'.padEnd(7),
    'mechsLost'.padEnd(10),
    'scrap'.padEnd(7),
    'standing'.padEnd(9),
    'boss'.padEnd(5),
    'rival'.padEnd(6),
    'wallMs'.padEnd(7),
  ].join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const l of logs) {
    if (l.result === 'error') {
      console.log(`${String(l.seed).padEnd(6)}${'ERROR'.padEnd(7)} ${l.error?.message ?? ''}`);
      continue;
    }
    console.log(
      [
        String(l.seed).padEnd(6),
        l.result.padEnd(7),
        String(l.nodesVisited).padEnd(6),
        String(l.battlesFought).padEnd(8),
        String(l.battlesWon).padEnd(4),
        String(l.pilotDeaths.length).padEnd(7),
        String(l.mechsLost).padEnd(10),
        String(l.finalScrap).padEnd(7),
        String(l.finalStanding).padEnd(9),
        (l.bossReached ? 'yes' : 'no').padEnd(5),
        (l.rivalMet ? 'yes' : 'no').padEnd(6),
        String(l.wallTimeMs).padEnd(7),
      ].join('')
    );
    if (l.pilotDeaths.length) console.log(`       deaths: ${l.pilotDeaths.join(', ')}`);
    if (l.newlyUnlocked.length) console.log(`       unlocked: ${l.newlyUnlocked.join(', ')}`);
  }
}

function printWarnings(logs: RunLog[]): void {
  const withWarnings = logs.filter((l) => l.warnings.length);
  if (!withWarnings.length) return;
  console.log('\n== Warnings ==');
  for (const l of withWarnings) {
    for (const w of l.warnings) console.log(`WARN [seed ${l.seed}]: ${w}`);
  }
}

function printExceptions(logs: RunLog[]): void {
  const errored = logs.filter((l) => l.error);
  if (!errored.length) return;
  console.log('\n== Exceptions ==');
  for (const l of errored) {
    console.log(`seed ${l.seed}: ${l.error!.message}`);
    if (l.error!.stack) console.log(l.error!.stack);
  }
}

function printSummary(summary: SweepSummary): void {
  console.log('\n== Summary ==');
  console.log(`runs: ${summary.runs}`);
  console.log(`win rate: ${(summary.winRate * 100).toFixed(1)}%`);
  console.log(`avg pilot deaths / run: ${summary.avgDeathsPerRun.toFixed(2)}`);
  console.log(`avg battles / run: ${summary.avgBattlesPerRun.toFixed(2)}`);
  console.log(`avg nodes visited / run: ${summary.avgNodesPerRun.toFixed(2)}`);
  console.log(
    `most-killed pilot: ${summary.mostKilledPilot ? `${summary.mostKilledPilot.pilotId} (${summary.mostKilledPilot.kills} kills)` : 'n/a'}`
  );
  console.log(`unlock ids gained across sweep: ${summary.unlockIdsGained.length ? summary.unlockIdsGained.join(', ') : 'none'}`);
  console.log(`warnings emitted: ${summary.warnCount}`);
  console.log(`exceptions: ${summary.exceptions.length}`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const runsCount = Number(process.argv[2] ?? 20);
  const seedBase = Number(process.argv[3] ?? 1);
  const { logs, summary } = runSweep(runsCount, seedBase);
  printTable(logs);
  printWarnings(logs);
  printExceptions(logs);
  printSummary(summary);
}

const invokedPath = typeof process !== 'undefined' ? process.argv[1]?.replace(/\\/g, '/') ?? '' : '';
if (/\/playthrough\.(ts|js|mjs|cjs)$/.test(invokedPath)) {
  main();
}
