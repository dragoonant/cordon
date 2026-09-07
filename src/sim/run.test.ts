import { describe, expect, it } from 'vitest';
import {
  applyRunEnd,
  applySalvage,
  ascensionModifiers,
  currentNode,
  depotBuy,
  depotStock,
  finishMap,
  newRun,
  pilotDefIdOf,
  prepareMap,
  reachableNodes,
  recordBattle,
  resolveDistress,
  salvageNode,
  travelTo,
} from './run';
import { canPilotFly } from './pilots';
import { FIXTURE_DATA, fixtureUnlocks, mapSurfaceA } from './__fixtures__/runFixtures';
import { defaultSave, exportSave, importSave, loadSave, persist } from '../save';
import type { BattleResult, Id, RunState, WorldState } from './types';

function freshRun(seed = 1234, ascension = 0): RunState {
  return newRun(FIXTURE_DATA, fixtureUnlocks(), seed, ascension);
}

// ---------------------------------------------------------------------------
// newRun
// ---------------------------------------------------------------------------

describe('newRun', () => {
  it('is deterministic for a given seed/ascension', () => {
    const a = freshRun(777);
    const b = freshRun(777);
    expect(a).toEqual(b);
  });

  it('produces a different graph for a different seed', () => {
    const a = freshRun(1);
    const b = freshRun(2);
    expect(a.sectors[0].nodes.map((n) => n.kind)).not.toEqual(b.sectors[0].nodes.map((n) => n.kind));
  });

  it('builds a valid sector graph: one start, one boss, every node reachable, boss reachable from every col-4 node', () => {
    const run = freshRun(42);
    const nodes = run.sectors[0].nodes;
    const byCol = (c: number) => nodes.filter((n) => n.col === c);

    expect(byCol(0)).toHaveLength(1);
    expect(byCol(0)[0].kind).toBe('start');
    expect(byCol(5)).toHaveLength(1);
    expect(byCol(5)[0].kind).toBe('boss');
    for (let c = 1; c <= 4; c++) {
      expect(byCol(c).length).toBeGreaterThanOrEqual(2);
      expect(byCol(c).length).toBeLessThanOrEqual(3);
    }

    // Every non-start node has at least one incoming edge.
    const incoming = new Set<Id>();
    for (const n of nodes) for (const e of n.edges) incoming.add(e);
    for (const n of nodes) {
      if (n.col === 0) continue;
      expect(incoming.has(n.id)).toBe(true);
    }
    // Every non-boss node has at least one outgoing edge.
    for (const n of nodes) {
      if (n.col === 5) continue;
      expect(n.edges.length).toBeGreaterThan(0);
    }
    // Boss reachable from every col-4 node (col 5 has a single node, so any edge from col4 lands on it).
    const boss = byCol(5)[0];
    for (const n of byCol(4)) {
      expect(n.edges).toContain(boss.id);
    }
    // Full reachability from start via BFS.
    const start = byCol(0)[0];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set<Id>([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const cur = byId.get(queue.shift()!)!;
      for (const e of cur.edges) {
        if (!seen.has(e)) {
          seen.add(e);
          queue.push(e);
        }
      }
    }
    expect(seen.size).toBe(nodes.length);
  });

  it('enforces node-kind constraints: at least one depot, at least one rescue, at most one rival', () => {
    const run = freshRun(9001);
    const interior = run.sectors[0].nodes.filter((n) => n.col >= 1 && n.col <= 4);
    expect(interior.filter((n) => n.kind === 'depot').length).toBeGreaterThanOrEqual(1);
    expect(interior.filter((n) => n.kind === 'rescue').length).toBeGreaterThanOrEqual(1);
    expect(interior.filter((n) => n.kind === 'rival').length).toBeLessThanOrEqual(1);
  });

  it('gives the starting roster the first 6 unlocked relay pilots (excluding captain/rival) in 2 squads of 3', () => {
    const run = freshRun();
    const ids = Object.keys(run.pilots);
    expect(ids).toHaveLength(6);
    expect(ids).toEqual(['pilot_veteran', 'pilot_hotshot', 'pilot_marksman', 'pilot_rookie', 'pilot_engineer', 'pilot_scout']);
    expect(run.squads).toHaveLength(2);
    expect(run.squads[0].name).toBe('Lantern One');
    expect(run.squads[1].name).toBe('Lantern Two');
    for (const squad of run.squads) {
      const filled = squad.slots.filter((s) => s !== null);
      expect(filled).toHaveLength(3);
      expect(squad.slots[0]).not.toBeNull();
      expect(squad.slots[1]).not.toBeNull();
      expect(squad.slots[3]).not.toBeNull();
      expect(squad.leaderPilotId).not.toBeNull();
      for (const slot of filled) {
        const pilot = run.pilots[slot!.pilotId];
        const mech = run.mechs[slot!.mechId];
        expect(mech).toBeDefined();
        const frame = FIXTURE_DATA.frames[mech.frameId];
        expect(canPilotFly(pilot, frame)).toBe(true);
      }
    }
  });

  it('applies ascension modifiers: scrap cut, halved nerve, no depots, forced early rival', () => {
    const base = freshRun(55, 0);
    const cut = freshRun(55, 1);
    expect(cut.scrap).toBe(Math.round(base.scrap * 0.8));

    const halved = freshRun(55, 2);
    for (const id of Object.keys(halved.pilots)) {
      expect(halved.pilots[id].nerve).toBe(Math.floor(FIXTURE_DATA.pilots[id].maxNerve / 2));
    }

    const noDepot = freshRun(55, 4);
    const interior = noDepot.sectors[0].nodes.filter((n) => n.col >= 1 && n.col <= 4);
    expect(interior.some((n) => n.kind === 'depot')).toBe(false);

    const earlyRival = freshRun(55, 5);
    const col1 = earlyRival.sectors[0].nodes.filter((n) => n.col === 1);
    expect(col1.some((n) => n.kind === 'rival')).toBe(true);
    const allRivals = earlyRival.sectors[0].nodes.filter((n) => n.kind === 'rival');
    expect(allRivals).toHaveLength(1);
  });
});

describe('ascensionModifiers', () => {
  it('returns a cumulative, capped list', () => {
    expect(ascensionModifiers(0)).toEqual([]);
    expect(ascensionModifiers(2)).toHaveLength(2);
    expect(ascensionModifiers(99)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('currentNode / reachableNodes / travelTo', () => {
  it('travels to a reachable node and no-ops otherwise', () => {
    const run = freshRun();
    const start = currentNode(run);
    const options = reachableNodes(run);
    expect(options.length).toBeGreaterThan(0);
    const target = options[0];

    travelTo(run, 'node_does_not_exist');
    expect(run.currentNodeId).toBe(start.id); // unreachable id -> no-op

    travelTo(run, target.id);
    expect(run.currentNodeId).toBe(target.id);
    expect(currentNode(run).visited).toBe(true);
    expect(run.turn).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// prepareMap
// ---------------------------------------------------------------------------

describe('prepareMap', () => {
  it('returns null for node kinds with no map (start)', () => {
    const run = freshRun();
    expect(prepareMap(run, FIXTURE_DATA)).toBeNull();
  });

  it('picks a map of the node\'s mapKind and instantiates enemies with unique pilot ids', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'battle';
    node.mapKind = 'space';
    node.mapId = undefined;
    run.currentNodeId = node.id;

    const prepared = prepareMap(run, FIXTURE_DATA);
    expect(prepared).not.toBeNull();
    expect(prepared!.map.kind).toBe('space');

    const pilotIds = Object.keys(prepared!.enemies.pilots);
    expect(new Set(pilotIds).size).toBe(pilotIds.length); // unique
    for (const id of pilotIds) {
      expect(id).toContain('#');
      expect(FIXTURE_DATA.pilots[pilotDefIdOf(id)]).toBeDefined();
    }
    // Caches the chosen map id on the node for stability across repeated calls.
    expect(node.mapId).toBe(prepared!.map.id);
    const again = prepareMap(run, FIXTURE_DATA);
    expect(again!.map.id).toBe(prepared!.map.id);
  });

  it('sizes the rival wing to the player, not to node threat', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'rival';
    node.mapId = undefined;
    run.currentNodeId = node.id;

    const prepared = prepareMap(run, FIXTURE_DATA)!;
    const rival = prepared.enemies.squads.find((s) => s.id === 'spawn_rival')!;
    const wing = rival.slots.filter((s) => s !== null);

    // The wing matches the player's headcount (rival + one fewer grunt), so
    // the encounter reads as a matched formation rather than a gank.
    const playerBest = Math.max(
      ...run.squads.map((sq) => sq.slots.filter((s) => s && run.pilots[s.pilotId]?.alive).length)
    );
    expect(wing.length).toBe(playerBest);

    // The wing's effective HP tracks the player's rather than raw Compact
    // tonnage — this is what keeps the duel from being an unwinnable wall
    // (it was ~2% win for a starting squad when frames ran at full HP).
    const effHp = wing.reduce((sum, slot) => {
      const mech = prepared.enemies.mechs[slot!.mechId];
      const frame = FIXTURE_DATA.frames[mech.frameId];
      return sum + Math.max(1, frame.hp - mech.maxHpPenalty);
    }, 0);
    const playerHp = Math.max(
      ...run.squads.map((sq) =>
        sq.slots.reduce((sum, slot) => {
          if (!slot || !run.pilots[slot.pilotId]?.alive) return sum;
          const mech = run.mechs[slot.mechId];
          const frame = mech && FIXTURE_DATA.frames[mech.frameId];
          return frame ? sum + Math.max(1, frame.hp - mech.maxHpPenalty) : sum;
        }, 0)
      )
    );
    expect(effHp).toBeLessThan(playerHp * 1.35);
    expect(effHp).toBeGreaterThan(playerHp * 0.9);
  });

  it('scales ordinary enemy squads by threat: +6 aptitude per level and extra mechs', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'battle';
    node.mapKind = 'space';
    node.mapId = undefined;
    node.threat = 3;
    run.currentNodeId = node.id;

    const prepared = prepareMap(run, FIXTURE_DATA)!;
    const grunt1Instance = Object.entries(prepared.enemies.pilots).find(([id]) => pilotDefIdOf(id) === 'pilot_grunt_1');
    expect(grunt1Instance).toBeDefined();
    const [, pilot] = grunt1Instance!;
    expect(pilot.aptitudes.gunnery).toBe(Math.min(100, FIXTURE_DATA.pilots.pilot_grunt_1.baseAptitudes.gunnery + 12));
    // threat 3 adds two bodies beyond the spawn's own composition (if slots allow)
    const spawn = prepared.map.enemySquads[0];
    const squad = prepared.enemies.squads.find((q) => q.id === spawn.id)!;
    const filled = squad.slots.filter(Boolean).length;
    expect(filled).toBe(Math.min(6, spawn.composition.length + 2));
  });

  it('prefers a rescue-flavored map for rescue nodes', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'rescue';
    node.mapKind = 'space';
    node.mapId = undefined;
    run.currentNodeId = node.id;
    const prepared = prepareMap(run, FIXTURE_DATA)!;
    expect(prepared.map.id).toBe('map_space_rescue_a');
  });

  it('prefers a boss-flavored map for the boss node', () => {
    const run = freshRun();
    const boss = run.sectors[0].nodes.find((n) => n.kind === 'boss')!;
    boss.mapKind = 'surface';
    boss.mapId = undefined;
    run.currentNodeId = boss.id;
    const prepared = prepareMap(run, FIXTURE_DATA)!;
    expect(prepared.map.id).toBe('map_surface_boss_a');
  });

  it('appends the rival squad on a rival node', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'rival';
    node.mapKind = 'surface';
    node.mapId = undefined;
    run.currentNodeId = node.id;

    const prepared = prepareMap(run, FIXTURE_DATA)!;
    expect(prepared.enemies.squads.some((s) => s.id === 'spawn_rival')).toBe(true);
    const rivalPilotId = Object.keys(prepared.enemies.pilots).find((id) => pilotDefIdOf(id) === 'pilot_rival');
    expect(rivalPilotId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// recordBattle
// ---------------------------------------------------------------------------

describe('recordBattle', () => {
  function winningResultFor(run: RunState): BattleResult {
    const squad = run.squads[0];
    const memberIds = squad.slots.filter((s) => s !== null).map((s) => s!.pilotId);
    const sideAPilots: Record<Id, any> = {};
    for (const id of memberIds) {
      sideAPilots[id] = { ...run.pilots[id], nerve: run.pilots[id].nerve - 5 }; // battle spent some nerve
    }
    const sideAMechs: Record<Id, any> = {};
    for (const id of memberIds) {
      const mechId = squad.slots.find((s) => s !== null && s.pilotId === id)!.mechId;
      sideAMechs[mechId] = { ...run.mechs[mechId], hp: run.mechs[mechId].hp - 10 };
    }
    return {
      seed: 1,
      winner: 'A',
      events: [],
      sideA: { squad, pilots: sideAPilots, mechs: sideAMechs },
      sideB: { squad, pilots: {}, mechs: {} },
      pilotDeaths: [],
      mechsLost: [],
      salvage: { weapons: ['weapon_vulcan'], systems: [], frames: [], scrap: 15 },
      growth: { [memberIds[0]]: { gunnery: 2 } },
      killsByPilot: { [memberIds[0]]: 9 },
    };
  }

  it('syncs pilots/mechs, applies growth/kills/ace/nerve/bonds/salvage on a win', () => {
    const run = freshRun();
    const memberIds = run.squads[0].slots.filter((s) => s !== null).map((s) => s!.pilotId);
    const result = winningResultFor(run);
    const scrapBefore = run.scrap;

    recordBattle(run, result, FIXTURE_DATA);

    const leaderId = memberIds[0];
    const def = FIXTURE_DATA.pilots[leaderId];
    expect(run.pilots[leaderId].aptitudes.gunnery).toBeCloseTo(def.baseAptitudes.gunnery + 2 * def.growth.gunnery, 5);
    expect(run.pilots[leaderId].kills).toBe(9);
    expect(run.pilots[leaderId].ace).toBe(true);
    expect(run.pilots[leaderId].battles).toBe(1);
    expect(run.pilots[leaderId].nerve).toBe(Math.min(def.maxNerve, def.maxNerve - 5 + 3));

    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        expect(run.pilots[memberIds[i]].bonds[memberIds[j]]).toBe(2);
      }
    }

    expect(run.scrap).toBe(scrapBefore + 15);
    expect(run.weapons).toContain('weapon_vulcan');
  });

  it('still syncs pilot/mech state on a loss, but applies no rewards', () => {
    const run = freshRun();
    const result = winningResultFor(run);
    result.winner = 'B';
    const scrapBefore = run.scrap;
    const memberIds = Object.keys(result.sideA.pilots);

    recordBattle(run, result, FIXTURE_DATA);

    expect(run.pilots[memberIds[0]].nerve).toBe(result.sideA.pilots[memberIds[0]].nerve); // synced, no +3
    expect(run.pilots[memberIds[0]].kills).toBe(0); // no kill credit on a loss
    expect(run.scrap).toBe(scrapBefore); // no salvage
  });
});

// ---------------------------------------------------------------------------
// finishMap
// ---------------------------------------------------------------------------

function baseWorld(run: RunState): WorldState {
  return {
    mapId: mapSurfaceA.id,
    tick: 0,
    time: 0,
    speed: 1,
    phase: 'ended',
    squads: {},
    pilots: { ...run.pilots },
    mechs: { ...run.mechs },
    objectives: {},
    visibleEnemyIds: [],
    pendingBattle: null,
    lastBattle: null,
    carrierHp: 100,
    carrierMaxHp: 100,
    outcome: 'victory',
    events: [],
    rngState: 0,
    pendingSpawns: [],
  };
}

describe('finishMap', () => {
  it('handles death, non-recoverable loss, recoverable ejection, objective rewards, and standing', () => {
    const run = freshRun();
    const battleNode = run.sectors[0].nodes.find((n) => n.col === 1)!;
    battleNode.kind = 'battle';
    run.currentNodeId = battleNode.id;

    const rookieMechId = run.squads[1].slots[0]!.mechId; // pilot_rookie
    const engineerMechId = run.squads[1].slots[1]!.mechId; // pilot_engineer

    const world = baseWorld(run);
    world.pilots = { ...run.pilots, pilot_rookie: { ...run.pilots.pilot_rookie, alive: false } };
    world.mechs = {
      ...run.mechs,
      [rookieMechId]: { ...run.mechs[rookieMechId], destroyed: true },
      [engineerMechId]: { ...run.mechs[engineerMechId], destroyed: true },
    };
    world.lastBattle = {
      seed: 1,
      winner: 'A',
      events: [],
      sideA: { squad: run.squads[1], pilots: {}, mechs: {} },
      sideB: { squad: run.squads[1], pilots: {}, mechs: {} },
      pilotDeaths: [{ side: 'A', pilotId: 'pilot_rookie' }],
      mechsLost: [
        { side: 'A', mechId: engineerMechId, recoverable: true },
        { side: 'A', mechId: rookieMechId, recoverable: false },
      ],
      salvage: { weapons: [], systems: [], frames: [], scrap: 0 },
      growth: {},
      killsByPilot: {},
    };
    world.objectives = {
      obj_reach_exit: { id: 'obj_reach_exit', status: 'complete', progress: 1, pos: { x: 11, y: 4 } },
    };
    world.outcome = 'victory';

    const standingBefore = run.standing;
    const scrapBefore = run.scrap;
    const entry = finishMap(run, world, mapSurfaceA, FIXTURE_DATA);

    expect(run.pilots.pilot_rookie.alive).toBe(false);
    expect(run.squads[1].slots.some((s) => s?.pilotId === 'pilot_rookie')).toBe(false);
    expect(run.mechs[rookieMechId]).toBeUndefined();

    expect(run.mechs[engineerMechId]).toBeDefined();
    expect(run.mechs[engineerMechId].destroyed).toBe(false);
    expect(run.mechs[engineerMechId].hp).toBe(1);
    expect(run.pilots.pilot_engineer.alive).toBe(true);
    expect(run.pilots.pilot_engineer.injuredFor).toBe(1);
    expect(run.squads[1].slots.some((s) => s?.pilotId === 'pilot_engineer')).toBe(false);

    expect(run.standing).toBe(standingBefore + 5);
    expect(run.scrap).toBe(scrapBefore + 20);
    expect(battleNode.cleared).toBe(true);

    expect(entry.kind).toBe('battle');
    expect(entry.outcome).toBe('victory');
    expect(entry.pilotDeaths).toEqual(['pilot_rookie']);
    expect(entry.scrapGained).toBe(20);
    expect(run.history).toContain(entry);
    expect(run.status).toBe('active');
  });

  it('sets status won on a boss victory', () => {
    const run = freshRun();
    const boss = run.sectors[0].nodes.find((n) => n.kind === 'boss')!;
    run.currentNodeId = boss.id;
    const world = baseWorld(run);
    world.outcome = 'victory';
    finishMap(run, world, mapSurfaceA, FIXTURE_DATA);
    expect(run.status).toBe('won');
  });

  it('sets status lost when no pilot survives', () => {
    const run = freshRun();
    const battleNode = run.sectors[0].nodes.find((n) => n.col === 1)!;
    run.currentNodeId = battleNode.id;
    const world = baseWorld(run);
    world.pilots = Object.fromEntries(Object.entries(run.pilots).map(([id, p]) => [id, { ...p, alive: false }]));
    world.outcome = 'defeat';
    const entry = finishMap(run, world, mapSurfaceA, FIXTURE_DATA);
    expect(run.status).toBe('lost');
    expect(entry.pilotDeaths.sort()).toEqual(Object.keys(run.pilots).sort());
  });

  it('penalizes standing for a failed required objective', () => {
    const run = freshRun();
    const battleNode = run.sectors[0].nodes.find((n) => n.col === 1)!;
    run.currentNodeId = battleNode.id;
    const world = baseWorld(run);
    world.objectives = { obj_reach_exit: { id: 'obj_reach_exit', status: 'failed', progress: 0, pos: { x: 0, y: 0 } } };
    world.outcome = 'defeat';
    const standingBefore = run.standing;
    finishMap(run, world, mapSurfaceA, FIXTURE_DATA);
    expect(run.standing).toBe(standingBefore - 10);
  });
});

// ---------------------------------------------------------------------------
// resolveDistress
// ---------------------------------------------------------------------------

describe('resolveDistress', () => {
  it('applies a recruit outcome and returns the narration text', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'distress';
    node.eventId = 'event_stranded';
    run.currentNodeId = node.id;

    expect(run.pilots.pilot_salvager).toBeUndefined();
    const text = resolveDistress(run, 'choice_recover', FIXTURE_DATA);
    expect(run.pilots.pilot_salvager).toBeDefined();
    expect(text).toBe(FIXTURE_DATA.events.event_stranded.choices[0].outcome.text);
    expect(node.cleared).toBe(true);
  });

  it('applies scrap/standing/injury outcomes', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'distress';
    node.eventId = 'event_black_market';
    run.currentNodeId = node.id;
    run.scrap = 100;

    resolveDistress(run, 'choice_walk_away', FIXTURE_DATA);
    expect(Object.values(run.pilots).some((p) => p.injuredFor === 1)).toBe(true);
  });

  it('returns an empty string for an unknown choice id', () => {
    const run = freshRun();
    const node = run.sectors[0].nodes.find((n) => n.col === 1)!;
    node.kind = 'distress';
    node.eventId = 'event_ambush';
    run.currentNodeId = node.id;
    expect(resolveDistress(run, 'nope', FIXTURE_DATA)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// salvageNode
// ---------------------------------------------------------------------------

describe('salvageNode', () => {
  it('rolls salvage into inventory and is deterministic for a given rng state', () => {
    const run1 = freshRun(555);
    const run2 = freshRun(555);
    const node1 = run1.sectors[0].nodes.find((n) => n.col === 1)!;
    node1.kind = 'salvage';
    run1.currentNodeId = node1.id;
    const node2 = run2.sectors[0].nodes.find((n) => n.col === 1)!;
    node2.kind = 'salvage';
    run2.currentNodeId = node2.id;

    const scrapBefore = run1.scrap;
    const drop1 = salvageNode(run1, FIXTURE_DATA);
    const drop2 = salvageNode(run2, FIXTURE_DATA);

    expect(drop1).toEqual(drop2);
    expect(drop1.scrap).toBe(30);
    expect(drop1.weapons.length).toBeLessThanOrEqual(2);
    expect(run1.scrap).toBe(scrapBefore + 30);
    expect(node1.cleared).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// depotStock / depotBuy
// ---------------------------------------------------------------------------

describe('depotStock / depotBuy', () => {
  it('offers 3 weapons, 2 systems, 1 frame at base cost, discounted at standing >= 70', () => {
    const run = freshRun();
    run.standing = 50;
    const rngStateBefore = run.rngState;
    const stock = depotStock(run, FIXTURE_DATA);
    expect(run.rngState).toBe(rngStateBefore); // depotStock is pure w.r.t. run

    expect(stock.weapons).toHaveLength(3);
    expect(stock.systems).toHaveLength(2);
    expect(stock.frames).toHaveLength(1);
    expect(stock.weapons[0].cost).toBe(40);
    expect(stock.systems[0].cost).toBe(55);
    expect(stock.frames[0].cost).toBe(120);

    run.standing = 75;
    const discounted = depotStock(run, FIXTURE_DATA);
    expect(discounted.weapons[0].cost).toBe(Math.round(40 * 0.8));
    expect(discounted.systems[0].cost).toBe(Math.round(55 * 0.8));
    expect(discounted.frames[0].cost).toBe(Math.round(120 * 0.8));
  });

  it('is stable for the same node id + seed across calls', () => {
    const run = freshRun();
    const a = depotStock(run, FIXTURE_DATA);
    const b = depotStock(run, FIXTURE_DATA);
    expect(a).toEqual(b);
  });

  it('buys on success and refuses when unaffordable', () => {
    const run = freshRun();
    const stock = depotStock(run, FIXTURE_DATA);
    run.scrap = stock.weapons[0].cost;
    const bought = depotBuy(run, 'weapon', stock.weapons[0].id, stock.weapons[0].cost);
    expect(bought.ok).toBe(true);
    expect(run.scrap).toBe(0);
    expect(run.weapons).toContain(stock.weapons[0].id);

    const refused = depotBuy(run, 'weapon', stock.weapons[1].id, stock.weapons[1].cost);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/insufficient/i);
  });
});

// ---------------------------------------------------------------------------
// applySalvage
// ---------------------------------------------------------------------------

describe('applySalvage', () => {
  it('adds items and scrap to inventory', () => {
    const run = freshRun();
    const scrapBefore = run.scrap;
    applySalvage(run, { weapons: ['weapon_vulcan'], systems: ['system_shield'], frames: ['frame_medium_ground_relay'], scrap: 25 });
    expect(run.weapons).toContain('weapon_vulcan');
    expect(run.systems).toContain('system_shield');
    expect(run.frames).toContain('frame_medium_ground_relay');
    expect(run.scrap).toBe(scrapBefore + 25);
  });
});

// ---------------------------------------------------------------------------
// applyRunEnd
// ---------------------------------------------------------------------------

describe('applyRunEnd', () => {
  it('advances counters, rotates in one locked item, and unlocks pilots on boss/rival milestones', () => {
    const run = freshRun();
    run.status = 'won';
    run.history = [
      { nodeId: 'node_c1_r0', kind: 'rival', outcome: 'victory', pilotDeaths: ['pilot_hotshot'], scrapGained: 0 },
      { nodeId: 'node_c5_r0', kind: 'boss', outcome: 'victory', pilotDeaths: [], scrapGained: 40 },
    ];
    const unlocks = fixtureUnlocks();
    const next = applyRunEnd(unlocks, run, FIXTURE_DATA);

    expect(next.runsAttempted).toBe(unlocks.runsAttempted + 1);
    expect(next.runsWon).toBe(unlocks.runsWon + 1);
    expect(next.ascensionMax).toBe(unlocks.ascensionMax + 1);
    expect(next.rivalEncounters).toBe(1);
    expect(next.rivalDefeats).toBe(1);
    expect(next.totalPilotDeaths).toBe(1);
    expect(next.pilots).toContain('pilot_salvager'); // 7th, boss reached
    expect(next.pilots).toContain('pilot_wildcard'); // 8th, rival beaten
    expect(next.fragments).toEqual(['frag_run_1']);

    const gainedWeapon = next.weapons.filter((id) => !unlocks.weapons.includes(id));
    const gainedSystem = next.systems.filter((id) => !unlocks.systems.includes(id));
    const gainedFrame = next.frames.filter((id) => !unlocks.frames.includes(id));
    expect(gainedWeapon.length + gainedSystem.length + gainedFrame.length).toBe(1);

    // Pure: original unlocks untouched.
    expect(unlocks.pilots).not.toContain('pilot_salvager');
  });

  it('caps fragments at 10 and does not duplicate an unlock already held', () => {
    const run = freshRun();
    run.status = 'lost';
    run.history = [];
    const unlocks = fixtureUnlocks();
    unlocks.fragments = Array.from({ length: 10 }, (_, i) => `frag_run_${i}`);
    unlocks.runsAttempted = 10;
    const next = applyRunEnd(unlocks, run, FIXTURE_DATA);
    expect(next.fragments).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// save/index.ts — persistence roundtrip (owned test files don't include a
// dedicated save test, so this coverage lives here; see file list in report)
// ---------------------------------------------------------------------------

describe('save persistence', () => {
  it('defaultSave seeds unlocks from unlockedByDefault content', () => {
    const save = defaultSave(FIXTURE_DATA);
    expect(save.version).toBe(1);
    expect(save.unlocks.pilots.sort()).toEqual(
      Object.values(FIXTURE_DATA.pilots)
        .filter((p) => p.unlockedByDefault)
        .map((p) => p.id)
        .sort()
    );
    expect(save.activeRun).toBeNull();
    expect(save.activeWorld).toBeNull();
  });

  it('roundtrips through exportSave/importSave', () => {
    const save = defaultSave(FIXTURE_DATA);
    const json = exportSave(save);
    const imported = importSave(json);
    expect(imported).toEqual(save);
  });

  it('importSave throws on a version mismatch or malformed JSON', () => {
    const save = defaultSave(FIXTURE_DATA);
    const badVersion = { ...save, version: 999 };
    expect(() => importSave(JSON.stringify(badVersion))).toThrow();
    expect(() => importSave('not json')).toThrow();
  });

  it('persist/loadSave roundtrip via the in-memory fallback (no IndexedDB in vitest)', async () => {
    const save = defaultSave(FIXTURE_DATA);
    save.settings.music = 0.42;
    await persist(save);
    const loaded = await loadSave();
    expect(loaded).toEqual(save);
  });
});
