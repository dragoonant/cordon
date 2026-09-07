import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  deploySquad,
  orderMove,
  orderReturn,
  useOverworldCallout,
  applyBattleResult,
  withdraw,
  fallBack,
  FALL_BACK_STANDING_COST,
  playerSquads,
  enemySquads,
  squadAlive,
  squadHpSummary,
} from './world';
import {
  buildGameData,
  playerSideBundle,
  enemySideBundleSurface,
  enemySideBundleSpace,
  SURFACE_MAP_ID,
  SPACE_MAP_ID,
  SURFACE_EVAC_ID,
  SURFACE_CONVOY_ID,
  SURFACE_RELAY_ID,
  SURFACE_ENEMY_SQUAD_ID,
  SPACE_ENEMY_SQUAD_ID,
  SPACE_DESTROY_OBJECTIVE_ID,
  SPACE_ENEMY_POS,
  SQUAD_ALPHA_ID,
  SQUAD_BRAVO_ID,
  makeMech,
  makeSquad,
  makeRuntimePilot,
  FRAME_LINE_ID,
} from './__fixtures__/worldFixtures';
import type { BattleResult, Id, Mech, MapDef, Pilot, Squad, WorldState } from './types';

function freshSurfaceWorld() {
  const data = buildGameData();
  const map = data.maps[SURFACE_MAP_ID];
  const world = createWorld(map, 12345, data, playerSideBundle(), enemySideBundleSurface());
  return { data, map, world };
}

function freshSpaceWorld() {
  const data = buildGameData();
  const map = data.maps[SPACE_MAP_ID];
  const world = createWorld(map, 777, data, playerSideBundle(), enemySideBundleSpace());
  return { data, map, world };
}

function deployAll(world: WorldState, map: MapDef, data: ReturnType<typeof buildGameData>) {
  for (const s of playerSquads(world)) deploySquad(world, map, s.id, data);
}

// ---------------------------------------------------------------------------

describe('createWorld', () => {
  it('starts player squads docked and enemy squads (spawnAt 0) placed', () => {
    const { world } = freshSurfaceWorld();
    expect(world.squads[SQUAD_ALPHA_ID].state).toBe('docked');
    expect(world.squads[SURFACE_ENEMY_SQUAD_ID].state).toBe('idle');
    expect(world.phase).toBe('deploy');
    expect(world.pendingSpawns).toEqual([]);
  });
});

describe('determinism', () => {
  it('two identically-built worlds stepped the same way produce identical state', () => {
    const dataA = buildGameData();
    const dataB = buildGameData();
    const mapA = dataA.maps[SURFACE_MAP_ID];
    const mapB = dataB.maps[SURFACE_MAP_ID];
    const worldA = createWorld(mapA, 999, dataA, playerSideBundle(), enemySideBundleSurface());
    const worldB = createWorld(mapB, 999, dataB, playerSideBundle(), enemySideBundleSurface());

    deployAll(worldA, mapA, dataA);
    deployAll(worldB, mapB, dataB);
    orderMove(worldA, mapA, SQUAD_ALPHA_ID, { x: 10, y: 6 }, dataA);
    orderMove(worldB, mapB, SQUAD_ALPHA_ID, { x: 10, y: 6 }, dataB);

    for (let i = 0; i < 60; i++) {
      stepWorld(worldA, mapA, 1, dataA);
      stepWorld(worldB, mapB, 1, dataB);
    }

    expect(JSON.stringify(worldA)).toBe(JSON.stringify(worldB));
  });
});

describe('deploySquad', () => {
  it('places the squad at the deploy zone, docked -> idle, full fuel, and flips deploy -> running', () => {
    const { world, map, data } = freshSurfaceWorld();
    const res = deploySquad(world, map, SQUAD_ALPHA_ID, data);
    expect(res.ok).toBe(true);
    const squad = world.squads[SQUAD_ALPHA_ID];
    expect(squad.state).toBe('idle');
    expect(squad.fuel).toBe(squad.maxFuel);
    expect(squad.fuel).toBeGreaterThan(0);
    expect(Math.hypot(squad.pos.x - map.deployZone.pos.x, squad.pos.y - map.deployZone.pos.y)).toBeLessThan(1);
    expect(world.phase).toBe('running');
    expect(world.events.some((e) => e.t === 'deployed' && e.squadId === SQUAD_ALPHA_ID)).toBe(true);
  });

  it('fails to deploy an already-deployed squad', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const res = deploySquad(world, map, SQUAD_ALPHA_ID, data);
    expect(res.ok).toBe(false);
  });

  it('fails to deploy a squad with no living mechs', () => {
    const { world, map, data } = freshSurfaceWorld();
    for (const slot of world.squads[SQUAD_ALPHA_ID].slots) {
      if (slot) world.mechs[slot.mechId].destroyed = true;
    }
    const res = deploySquad(world, map, SQUAD_ALPHA_ID, data);
    expect(res.ok).toBe(false);
  });

  it('fuel_cell systems raise maxFuel above the 90 baseline', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data); // has one fuel_cell mech
    deploySquad(world, map, SQUAD_BRAVO_ID, data); // has none
    expect(world.squads[SQUAD_ALPHA_ID].maxFuel).toBe(120);
    expect(world.squads[SQUAD_BRAVO_ID].maxFuel).toBe(90);
  });
});

describe('movement', () => {
  it('a moving squad eventually arrives and goes idle', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const target = { x: 10.5, y: 2.5 }; // a tile center — findPath's waypoints land exactly here
    const res = orderMove(world, map, SQUAD_ALPHA_ID, target, data);
    expect(res.ok).toBe(true);
    expect(world.squads[SQUAD_ALPHA_ID].state).toBe('moving');

    for (let i = 0; i < 200 && world.squads[SQUAD_ALPHA_ID].state === 'moving'; i++) {
      stepWorld(world, map, 1, data);
    }

    const squad = world.squads[SQUAD_ALPHA_ID];
    expect(squad.state).toBe('idle');
    expect(squad.path).toEqual([]);
    expect(Math.hypot(squad.pos.x - target.x, squad.pos.y - target.y)).toBeLessThan(0.2);
  });

  it('fails to order movement to an unreachable point off the map', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const res = orderMove(world, map, SQUAD_ALPHA_ID, { x: 999, y: 999 }, data);
    expect(res.ok).toBe(false);
  });
});

describe('fuel', () => {
  it('drains while moving and refuels fully on return/dock', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const squad = world.squads[SQUAD_ALPHA_ID];
    const startFuel = squad.fuel;

    orderMove(world, map, SQUAD_ALPHA_ID, { x: 10, y: 2 }, data);
    stepWorld(world, map, 3, data);
    expect(squad.fuel).toBeLessThan(startFuel);

    const res = orderReturn(world, map, SQUAD_ALPHA_ID, data);
    expect(res.ok).toBe(true);
    for (let i = 0; i < 300 && squad.state !== 'docked'; i++) stepWorld(world, map, 1, data);

    expect(squad.state).toBe('docked');
    expect(squad.fuel).toBe(squad.maxFuel);
  });
});

describe('visibility', () => {
  it('hides a distant enemy and reveals one that comes within range', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    stepWorld(world, map, 0.1, data);
    expect(world.visibleEnemyIds).not.toContain(SURFACE_ENEMY_SQUAD_ID);

    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: world.squads[SQUAD_ALPHA_ID].pos.x + 1, y: world.squads[SQUAD_ALPHA_ID].pos.y };
    stepWorld(world, map, 0.1, data);
    expect(world.visibleEnemyIds).toContain(SURFACE_ENEMY_SQUAD_ID);
  });

  it('relay capture reveals every enemy on the map regardless of distance', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    world.objectives[SURFACE_RELAY_ID].status = 'complete';
    stepWorld(world, map, 0.1, data);
    expect(world.visibleEnemyIds).toContain(SURFACE_ENEMY_SQUAD_ID);
  });
});

describe('contact', () => {
  it('triggers battle_pending exactly once when squads meet', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const playerSquad = world.squads[SQUAD_ALPHA_ID];
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: playerSquad.pos.x + 0.1, y: playerSquad.pos.y };

    stepWorld(world, map, 0.1, data);
    expect(world.phase).toBe('battle_pending');
    expect(world.pendingBattle).not.toBeNull();
    expect(world.pendingBattle?.squadAId).toBe(SQUAD_ALPHA_ID);
    expect(world.pendingBattle?.squadBId).toBe(SURFACE_ENEMY_SQUAD_ID);
    expect(playerSquad.state).toBe('engaged');

    const contactEvents = world.events.filter((e) => e.t === 'contact');
    expect(contactEvents.length).toBe(1);

    // further steps must not do anything while battle_pending
    stepWorld(world, map, 5, data);
    expect(world.phase).toBe('battle_pending');
    expect(world.events.filter((e) => e.t === 'contact').length).toBe(1);
  });
});

function buildMinimalBattleResult(opts: {
  winner: 'A' | 'B' | 'draw';
  squadA: Squad;
  squadB: Squad;
  pilotsA: Record<Id, Pilot>;
  pilotsB: Record<Id, Pilot>;
  mechsA: Record<Id, Mech>;
  mechsB: Record<Id, Mech>;
  pilotDeaths?: BattleResult['pilotDeaths'];
  events?: BattleResult['events'];
}): BattleResult {
  return {
    seed: 1,
    winner: opts.winner,
    events: opts.events ?? [{ t: 'end', winner: opts.winner, reason: 'annihilation' }],
    sideA: { squad: opts.squadA, pilots: opts.pilotsA, mechs: opts.mechsA },
    sideB: { squad: opts.squadB, pilots: opts.pilotsB, mechs: opts.mechsB },
    pilotDeaths: opts.pilotDeaths ?? [],
    mechsLost: [],
    salvage: { weapons: [], systems: [], frames: [], scrap: 0 },
    growth: {},
    killsByPilot: {},
  };
}

describe('rival contact lines', () => {
  it('stays silent for an ordinary contact', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const p = world.squads[SQUAD_ALPHA_ID];
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: p.pos.x + 0.1, y: p.pos.y };
    stepWorld(world, map, 0.1, data);
    expect(world.events.some((e) => e.t === 'rival_contact')).toBe(false);
  });

  it('fires once when the rival wing is met, with both sides speaking', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const p = world.squads[SQUAD_ALPHA_ID];
    // Rename the ordinary spawn to the rival id so detectContact treats it as
    // the rival wing (buildRivalSquad lives in run.ts and isn't under test here).
    const enemy = world.squads[SURFACE_ENEMY_SQUAD_ID];
    delete world.squads[SURFACE_ENEMY_SQUAD_ID];
    enemy.id = 'spawn_rival';
    world.squads['spawn_rival'] = enemy;
    enemy.pos = { x: p.pos.x + 0.1, y: p.pos.y };

    stepWorld(world, map, 0.1, data);
    const said = world.events.filter((e) => e.t === 'rival_contact');
    expect(said.length).toBeGreaterThan(0);
    for (const e of said) {
      expect(typeof (e as { line: string }).line).toBe('string');
      expect((e as { line: string }).line.length).toBeGreaterThan(0);
    }

    // Never repeats on the same map.
    const count = said.length;
    world.pendingBattle = null;
    world.phase = 'running';
    p.state = 'idle';
    p.engageCooldown = 0;
    enemy.state = 'idle';
    enemy.engageCooldown = 0;
    stepWorld(world, map, 0.1, data);
    expect(world.events.filter((e) => e.t === 'rival_contact').length).toBe(count);
  });
});

describe('rival blocks victory', () => {
  /** Turns the ordinary surface spawn into the rival wing. */
  function makeRival(world: ReturnType<typeof freshSurfaceWorld>['world']) {
    const enemy = world.squads[SURFACE_ENEMY_SQUAD_ID];
    delete world.squads[SURFACE_ENEMY_SQUAD_ID];
    enemy.id = 'spawn_rival';
    world.squads['spawn_rival'] = enemy;
    return enemy;
  }

  it('does not end the map while the rival is alive, even with objectives done', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    makeRival(world);
    for (const def of map.objectives) {
      if (def.required) world.objectives[def.id].status = 'complete';
    }
    stepWorld(world, map, 0.1, data);
    // Previously the rival was invisible to checkWinLose (it isn't in
    // map.enemySquads), so the node's whole point could be skipped.
    expect(world.phase).not.toBe('ended');
    expect(world.outcome).toBeNull();
  });

  it('ends in victory once the rival is destroyed', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const rival = makeRival(world);
    for (const def of map.objectives) {
      if (def.required) world.objectives[def.id].status = 'complete';
    }
    rival.state = 'destroyed';
    stepWorld(world, map, 0.1, data);
    expect(world.outcome).toBe('victory');
  });

  it('falling back also settles it, so the map stays winnable', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const rival = makeRival(world);
    const p = world.squads[SQUAD_ALPHA_ID];
    rival.pos = { x: p.pos.x + 0.1, y: p.pos.y };
    stepWorld(world, map, 0.1, data);
    expect(world.phase).toBe('battle_pending');
    expect(fallBack(world, map, data).ok).toBe(true);

    for (const def of map.objectives) {
      if (def.required) world.objectives[def.id].status = 'complete';
    }
    stepWorld(world, map, 0.1, data);
    expect(world.outcome).toBe('victory');
  });
});

describe('fallBack', () => {
  it('breaks off a pending contact: no battle, squad routed and pushed clear', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const playerSquad = world.squads[SQUAD_ALPHA_ID];
    const enemy = world.squads[SURFACE_ENEMY_SQUAD_ID];
    enemy.pos = { x: playerSquad.pos.x + 0.1, y: playerSquad.pos.y };
    stepWorld(world, map, 0.1, data);
    expect(world.phase).toBe('battle_pending');

    const posBefore = { ...playerSquad.pos };
    const res = fallBack(world, map, data);

    expect(res.ok).toBe(true);
    expect(res.standingCost).toBe(FALL_BACK_STANDING_COST);
    expect(world.pendingBattle).toBeNull();
    expect(world.phase).toBe('running');
    expect(playerSquad.state).toBe('routed');
    // Both sides held off, or 'hunt' re-contacts on the very next tick.
    expect(playerSquad.engageCooldown).toBeGreaterThan(0);
    expect(enemy.engageCooldown).toBeGreaterThan(0);
    // Moved away from where contact happened.
    expect(playerSquad.pos).not.toEqual(posBefore);
    expect(world.events.some((e) => e.t === 'fell_back')).toBe(true);
    // No battle was fought.
    expect(world.lastBattle).toBeNull();
  });

  it('is a no-op with no pending contact', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const res = fallBack(world, map, data);
    expect(res.ok).toBe(false);
    expect(res.standingCost).toBe(0);
  });
});

describe('applyBattleResult', () => {
  it('routes the loser toward home and gives the winner a shorter cooldown', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const playerSquad = world.squads[SQUAD_ALPHA_ID];
    const enemySquad = world.squads[SURFACE_ENEMY_SQUAD_ID];
    playerSquad.pos = { x: 8, y: 8 };
    enemySquad.pos = { x: 8.1, y: 8 };
    stepWorld(world, map, 0.1, data); // -> battle_pending

    const result = buildMinimalBattleResult({
      winner: 'B',
      squadA: { ...playerSquad, morale: 40 },
      squadB: { ...enemySquad, morale: 90 },
      pilotsA: { ...pickPilots(world, playerSquad) },
      pilotsB: { ...pickPilots(world, enemySquad) },
      mechsA: { ...pickMechs(world, playerSquad) },
      mechsB: { ...pickMechs(world, enemySquad) },
    });

    applyBattleResult(world, map, result, data);

    expect(world.phase).toBe('running');
    expect(world.pendingBattle).toBeNull();
    expect(world.squads[SQUAD_ALPHA_ID].state).toBe('routed');
    expect(world.squads[SQUAD_ALPHA_ID].engageCooldown).toBe(8);
    expect(world.squads[SQUAD_ALPHA_ID].morale).toBe(40);
    expect(world.squads[SQUAD_ALPHA_ID].path.length).toBeGreaterThan(0);
    expect(world.squads[SURFACE_ENEMY_SQUAD_ID].state).toBe('idle');
    expect(world.squads[SURFACE_ENEMY_SQUAD_ID].engageCooldown).toBe(3);
    expect(world.events.some((e) => e.t === 'battle_resolved')).toBe(true);
  });

  it('marks a squad with zero living mechs as destroyed', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const playerSquad = world.squads[SQUAD_ALPHA_ID];
    const enemySquad = world.squads[SURFACE_ENEMY_SQUAD_ID];
    enemySquad.pos = { ...playerSquad.pos };
    stepWorld(world, map, 0.1, data);

    const destroyedEnemyMechs = { ...pickMechs(world, enemySquad) };
    for (const id of Object.keys(destroyedEnemyMechs)) destroyedEnemyMechs[id] = { ...destroyedEnemyMechs[id], hp: 0, destroyed: true };

    const result = buildMinimalBattleResult({
      winner: 'A',
      squadA: { ...playerSquad },
      squadB: { ...enemySquad },
      pilotsA: { ...pickPilots(world, playerSquad) },
      pilotsB: { ...pickPilots(world, enemySquad) },
      mechsA: { ...pickMechs(world, playerSquad) },
      mechsB: destroyedEnemyMechs,
    });

    applyBattleResult(world, map, result, data);
    expect(world.squads[SURFACE_ENEMY_SQUAD_ID].state).toBe('destroyed');
    expect(world.events.some((e) => e.t === 'squad_destroyed' && e.squadId === SURFACE_ENEMY_SQUAD_ID)).toBe(true);
  });

  it('applies lt_dont_stop: burn effect + full nerve for all player squads/pilots, plus a captain line and comeback nerve', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    deploySquad(world, map, SQUAD_BRAVO_ID, data);
    const playerSquad = world.squads[SQUAD_ALPHA_ID];
    const enemySquad = world.squads[SURFACE_ENEMY_SQUAD_ID];
    enemySquad.pos = { ...playerSquad.pos };
    stepWorld(world, map, 0.1, data);

    for (const pid of Object.keys(world.pilots)) world.pilots[pid].nerve = 1;

    const deadPilotId = playerSquad.slots.find((s) => s)!.pilotId;

    const result = buildMinimalBattleResult({
      winner: 'B',
      squadA: { ...playerSquad },
      squadB: { ...enemySquad },
      pilotsA: { ...pickPilots(world, playerSquad) },
      pilotsB: { ...pickPilots(world, enemySquad) },
      mechsA: { ...pickMechs(world, playerSquad) },
      mechsB: { ...pickMechs(world, enemySquad) },
      pilotDeaths: [{ side: 'A', pilotId: deadPilotId }],
      events: [{ t: 'last_transmission', side: 'A', pilotId: deadPilotId, calloutId: 'lt_dont_stop_test', line: 'Do not stop.', effect: 'lt_dont_stop' }],
    });

    applyBattleResult(world, map, result, data);

    expect(world.squads[SQUAD_BRAVO_ID].effects.some((e) => e.type === 'burn')).toBe(true);
    const playerPilotIds = [SQUAD_ALPHA_ID, SQUAD_BRAVO_ID].flatMap((sid) =>
      world.squads[sid].slots.filter((s): s is NonNullable<typeof s> => !!s).map((s) => s.pilotId)
    );
    for (const pid of playerPilotIds) {
      const pilot = world.pilots[pid];
      if (pilot.alive) expect(pilot.nerve).toBe(pilot.maxNerve);
    }
    expect(world.events.some((e) => e.t === 'captain')).toBe(true);
    expect(world.events.some((e) => e.t === 'last_transmission' && e.calloutId === 'lt_dont_stop_test')).toBe(true);
  });
});

function pickPilots(world: WorldState, squad: Squad) {
  const out: Record<Id, Pilot> = {};
  for (const slot of squad.slots) if (slot) out[slot.pilotId] = world.pilots[slot.pilotId];
  return out;
}
function pickMechs(world: WorldState, squad: Squad) {
  const out: Record<Id, Mech> = {};
  for (const slot of squad.slots) if (slot) out[slot.mechId] = world.mechs[slot.mechId];
  return out;
}

describe('objectives', () => {
  it('evac_station progresses only when a player squad holds it with no enemy present', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    world.squads[SQUAD_ALPHA_ID].pos = { x: 10, y: 6 }; // on the station
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: 18, y: 10 }; // far away

    stepWorld(world, map, 2, data);
    const progressed = world.objectives[SURFACE_EVAC_ID].progress;
    expect(progressed).toBeGreaterThan(0);

    // now bring the enemy into the station radius — progress should stop advancing
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: 10, y: 6 };
    stepWorld(world, map, 2, data);
    expect(world.objectives[SURFACE_EVAC_ID].progress).toBeCloseTo(progressed, 5);
  });

  it('completes evac_station after holdSeconds and grants nerve', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    world.squads[SQUAD_ALPHA_ID].pos = { x: 10, y: 6 };
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: 18, y: 10 };
    for (const pid of Object.keys(world.pilots)) world.pilots[pid].nerve = 0;

    stepWorld(world, map, 6, data);

    expect(world.objectives[SURFACE_EVAC_ID].status).toBe('complete');
    expect(world.events.some((e) => e.t === 'objective' && e.objectiveId === SURFACE_EVAC_ID && e.status === 'complete')).toBe(true);
    const alphaPilotId = world.squads[SQUAD_ALPHA_ID].slots.find((s) => s)!.pilotId;
    expect(world.pilots[alphaPilotId].nerve).toBeGreaterThanOrEqual(5);
  });

  it('convoy only moves once escorted, and fails when its HP is drained to 0', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: 18, y: 10 }; // clear of the convoy

    const startPos = { ...world.objectives[SURFACE_CONVOY_ID].pos };
    stepWorld(world, map, 3, data);
    expect(world.objectives[SURFACE_CONVOY_ID].pos).toEqual(startPos); // not escorted yet, doesn't move

    world.squads[SQUAD_ALPHA_ID].pos = { ...world.objectives[SURFACE_CONVOY_ID].pos };
    stepWorld(world, map, 3, data);
    const moved = world.objectives[SURFACE_CONVOY_ID].pos;
    expect(moved.x !== startPos.x || moved.y !== startPos.y).toBe(true);

    // now drain its hp via a nearby, unescorted enemy
    world.squads[SQUAD_ALPHA_ID].pos = { x: 0, y: 0 }; // pull escort away
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { ...world.objectives[SURFACE_CONVOY_ID].pos };
    for (let i = 0; i < 300 && world.objectives[SURFACE_CONVOY_ID].status === 'active'; i++) stepWorld(world, map, 1, data);
    expect(world.objectives[SURFACE_CONVOY_ID].status).toBe('failed');
  });

  it('relay capture flips visibility map-wide once complete', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    world.squads[SQUAD_ALPHA_ID].pos = { x: 17, y: 2 };
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { x: 18, y: 10 };

    for (let i = 0; i < 200 && world.objectives[SURFACE_RELAY_ID].status !== 'complete'; i++) stepWorld(world, map, 1, data);

    expect(world.objectives[SURFACE_RELAY_ID].status).toBe('complete');
    expect(world.visibleEnemyIds).toContain(SURFACE_ENEMY_SQUAD_ID);
  });
});

describe('win / lose', () => {
  it('declares victory once the required objective completes (destroy_target on the space map)', () => {
    const { world, map, data } = freshSpaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    world.squads[SQUAD_ALPHA_ID].pos = { ...SPACE_ENEMY_POS };
    world.squads[SPACE_ENEMY_SQUAD_ID].state = 'destroyed';

    stepWorld(world, map, 0.1, data);

    expect(world.objectives[SPACE_DESTROY_OBJECTIVE_ID].status).toBe('complete');
    expect(world.phase).toBe('ended');
    expect(world.outcome).toBe('victory');
    expect(world.events.some((e) => e.t === 'map_end' && e.outcome === 'victory')).toBe(true);
  });

  it('declares defeat when every player squad is destroyed', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    deploySquad(world, map, SQUAD_BRAVO_ID, data);
    world.squads[SQUAD_ALPHA_ID].state = 'destroyed';
    world.squads[SQUAD_BRAVO_ID].state = 'destroyed';

    stepWorld(world, map, 0.1, data);

    expect(world.phase).toBe('ended');
    expect(world.outcome).toBe('defeat');
  });

  it('time limit: victory if required objectives are complete, defeat otherwise', () => {
    const { world, map, data } = freshSpaceWorld();
    const shortMap: MapDef = { ...map, timeLimit: 1 };
    deploySquad(world, shortMap, SQUAD_ALPHA_ID, data);
    stepWorld(world, shortMap, 2, data); // required destroy_target objective never completes

    expect(world.phase).toBe('ended');
    expect(world.outcome).toBe('defeat');
  });

  it('withdraw sets outcome and ends the map', () => {
    const { world } = freshSurfaceWorld();
    withdraw(world);
    expect(world.phase).toBe('ended');
    expect(world.outcome).toBe('withdraw');
  });
});

describe('overworld callouts', () => {
  function pilotOf(world: WorldState, squadId: string) {
    const squad = world.squads[squadId];
    const slot = squad.slots.find((s) => s)!;
    return { pilotId: slot.pilotId, squad };
  }

  it('burn_hard grants a burn effect and deducts nerve', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const { pilotId } = pilotOf(world, SQUAD_ALPHA_ID);
    const before = world.pilots[pilotId].nerve;

    const res = useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_burn_hard', data);
    expect(res.ok).toBe(true);
    expect(world.squads[SQUAD_ALPHA_ID].effects.some((e) => e.type === 'burn')).toBe(true);
    expect(world.pilots[pilotId].nerve).toBe(before - data.callouts.co_burn_hard.nerveCost);
  });

  it('ping_sector reveals and pings nearby enemies', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const { pilotId } = pilotOf(world, SQUAD_ALPHA_ID);
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { ...world.squads[SQUAD_ALPHA_ID].pos };

    const res = useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_ping_sector', data);
    expect(res.ok).toBe(true);
    const eff = world.squads[SURFACE_ENEMY_SQUAD_ID].effects;
    expect(eff.some((e) => e.type === 'revealed')).toBe(true);
    expect(eff.some((e) => e.type === 'pinged')).toBe(true);
  });

  it('rally_channel buffs allies in range and costs the caster morale', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    deploySquad(world, map, SQUAD_BRAVO_ID, data);
    world.squads[SQUAD_ALPHA_ID].morale = 50;
    world.squads[SQUAD_BRAVO_ID].morale = 50;
    const { pilotId } = pilotOf(world, SQUAD_ALPHA_ID);

    const res = useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_rally_channel', data);
    expect(res.ok).toBe(true);
    expect(world.squads[SQUAD_ALPHA_ID].morale).toBe(55); // +20 then -15
    expect(world.squads[SQUAD_BRAVO_ID].morale).toBe(70);
  });

  it('fall_back teleports home, damages mechs, and clears a pending contact', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const { pilotId, squad } = pilotOf(world, SQUAD_ALPHA_ID);
    squad.pos = { x: 15, y: 8 };
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { ...squad.pos };
    stepWorld(world, map, 0.1, data); // -> battle_pending
    expect(world.phase).toBe('battle_pending');

    const mechId = squad.slots.find((s) => s)!.mechId;
    const hpBefore = world.mechs[mechId].hp;

    const res = useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_fall_back', data);
    expect(res.ok).toBe(true);
    expect(world.phase).toBe('running');
    expect(world.pendingBattle).toBeNull();
    expect(world.mechs[mechId].hp).toBeLessThan(hpBefore);
    expect(Math.hypot(squad.pos.x - map.deployZone.pos.x, squad.pos.y - map.deployZone.pos.y)).toBeLessThan(0.5);
  });

  it('come_get_some baits nearby enemies toward the caster', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const { pilotId } = pilotOf(world, SQUAD_ALPHA_ID);
    world.squads[SURFACE_ENEMY_SQUAD_ID].pos = { ...world.squads[SQUAD_ALPHA_ID].pos };

    const res = useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_come_get_some', data);
    expect(res.ok).toBe(true);
    expect(world.squads[SURFACE_ENEMY_SQUAD_ID].effects.some((e) => e.type === 'bait')).toBe(true);
  });

  it('stay_with_them attaches the squad to a nearby convoy', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const { pilotId, squad } = pilotOf(world, SQUAD_ALPHA_ID);
    squad.pos = { ...world.objectives[SURFACE_CONVOY_ID].pos };

    const res = useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_stay_with_them', data);
    expect(res.ok).toBe(true);
    expect(squad.escortingObjectiveId).toBe(SURFACE_CONVOY_ID);
    expect(squad.effects.some((e) => e.type === 'escort')).toBe(true);
  });

  it('stay_with_them fails when no convoy is nearby', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const { pilotId, squad } = pilotOf(world, SQUAD_ALPHA_ID);
    squad.pos = { x: 0, y: 0 };
    const res = useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_stay_with_them', data);
    expect(res.ok).toBe(false);
  });

  it('rejects a callout the pilot does not know, and one without enough nerve', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const { pilotId } = pilotOf(world, SQUAD_ALPHA_ID);

    world.pilots[pilotId].callouts = [];
    expect(useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_burn_hard', data).ok).toBe(false);

    world.pilots[pilotId].callouts = ['co_burn_hard'];
    world.pilots[pilotId].nerve = 0;
    expect(useOverworldCallout(world, map, SQUAD_ALPHA_ID, pilotId, 'co_burn_hard', data).ok).toBe(false);
  });
});

describe('queries', () => {
  it('playerSquads / enemySquads / squadAlive / squadHpSummary', () => {
    const { world, data } = freshSurfaceWorld();
    expect(playerSquads(world).map((s) => s.id).sort()).toEqual([SQUAD_ALPHA_ID, SQUAD_BRAVO_ID].sort());
    expect(enemySquads(world).map((s) => s.id)).toEqual([SURFACE_ENEMY_SQUAD_ID]);
    expect(squadAlive(world.squads[SQUAD_ALPHA_ID], world)).toBe(true);

    const summary = squadHpSummary(world.squads[SQUAD_ALPHA_ID], world, data);
    expect(summary.total).toBe(2);
    expect(summary.alive).toBe(2);
    expect(summary.maxHp).toBeGreaterThan(0);
  });
});

describe('worst-mobility squad handling', () => {
  it('a squad with a space frame on a surface map moves slower than a native ground squad', () => {
    const { world, map, data } = freshSurfaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data); // both mechs ground
    deploySquad(world, map, SQUAD_BRAVO_ID, data); // single space-mobility mech
    const shared = { x: 2, y: 2 };
    world.squads[SQUAD_ALPHA_ID].pos = { ...shared };
    world.squads[SQUAD_BRAVO_ID].pos = { ...shared };
    orderMove(world, map, SQUAD_ALPHA_ID, { x: 12, y: 2 }, data);
    orderMove(world, map, SQUAD_BRAVO_ID, { x: 12, y: 2 }, data);

    stepWorld(world, map, 1, data);

    const dA = Math.hypot(world.squads[SQUAD_ALPHA_ID].pos.x - shared.x, world.squads[SQUAD_ALPHA_ID].pos.y - shared.y);
    const dB = Math.hypot(world.squads[SQUAD_BRAVO_ID].pos.x - shared.x, world.squads[SQUAD_BRAVO_ID].pos.y - shared.y);
    // sq_bravo's frame is faster at 1x (4 vs 3) but takes the 0.6x surface
    // penalty (2.4 eff.) vs sq_alpha's native 3.0 — sq_alpha should be ahead.
    expect(dA).toBeGreaterThan(dB);
  });
});

describe('radiation damage', () => {
  it('drains mech HP per second while standing on a radiation tile', () => {
    const { world, map, data } = freshSpaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    const squad = world.squads[SQUAD_ALPHA_ID];
    squad.pos = { x: 10.5, y: 6.5 }; // inside the radiation strip
    const mechId = squad.slots.find((s) => s)!.mechId;
    const before = world.mechs[mechId].hp;

    stepWorld(world, map, 3, data);

    expect(world.mechs[mechId].hp).toBeLessThan(before);
  });
});

describe('carrier', () => {
  it('takes damage from enemy squads near the deploy zone on a carrier map', () => {
    const { world, map, data } = freshSpaceWorld();
    deploySquad(world, map, SQUAD_ALPHA_ID, data);
    world.squads[SPACE_ENEMY_SQUAD_ID].pos = { ...map.deployZone.pos };

    stepWorld(world, map, 5, data);

    expect(world.carrierHp).toBeLessThan(world.carrierMaxHp);
  });
});

// A tiny extra sanity check that unused imports (makeMech/makeSquad/makeRuntimePilot/
// FRAME_LINE_ID) are exercised, keeping the fixtures' builder API covered too.
describe('fixture builders', () => {
  it('build a standalone squad/mech/pilot with sensible defaults', () => {
    const pilot = makeRuntimePilot('pilot_x');
    const mech = makeMech('mech_x', FRAME_LINE_ID);
    const squad = makeSquad('sq_x', 'compact', 'pilot_x', [{ pilotId: 'pilot_x', mechId: 'mech_x' }, null, null, null, null, null]);
    expect(pilot.alive).toBe(true);
    expect(mech.destroyed).toBe(false);
    expect(squad.slots[0]?.pilotId).toBe('pilot_x');
  });
});
