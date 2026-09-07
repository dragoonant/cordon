/**
 * CORDON — the real-time overworld simulation.
 *
 * Owns squad movement, fuel, overworld callouts, objectives, enemy AI,
 * contact detection and win/lose. Never imports battle.ts — the UI calls
 * resolveBattle() itself and hands the BattleResult to applyBattleResult().
 *
 * All randomness is drawn from an Rng seeded/reseeded via world.rngState so
 * two worlds built and stepped identically produce identical output.
 */
import type {
  Id,
  Vec2,
  Mobility,
  MapDef,
  MapKind,
  GameData,
  Squad,
  SquadEffect,
  Pilot,
  Mech,
  FrameDef,
  WorldState,
  WorldEvent,
  ObjectiveState,
  ObjectiveDef,
  BattleSide,
  BattleContext,
  BattleResult,
  ActiveCallout,
  Aptitude,
  Aptitudes,
} from './types';
import { findPath, terrainAt, moveCost, isPassable } from './pathfind';
import { Rng, hashString } from './rng';

export interface SideBundle {
  squads: Squad[];
  pilots: Record<Id, Pilot>;
  mechs: Record<Id, Mech>;
}

const EVENT_CAP = 200;
const CONTACT_RADIUS = 0.75;
const VISION_BASE = 6;
const DEPLOY_VISION = 8;
const CARRIER_RADIUS = 1.5;
const CARRIER_DPS = 5;

// ---------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pushEvent(world: WorldState, evt: WorldEvent): void {
  world.events.push(evt);
  if (world.events.length > EVENT_CAP) {
    world.events.splice(0, world.events.length - EVENT_CAP);
  }
}

function isEnemyFaction(squad: Squad): boolean {
  return squad.faction === 'compact';
}

function playerSquadsList(world: WorldState): Squad[] {
  return Object.values(world.squads).filter((s) => !isEnemyFaction(s));
}

function enemySquadsList(world: WorldState): Squad[] {
  return Object.values(world.squads).filter((s) => isEnemyFaction(s));
}

/** On the map and able to act (not still at the carrier, not destroyed). */
function onMap(squad: Squad): boolean {
  return squad.state !== 'docked' && squad.state !== 'destroyed';
}

function livingMechCount(squad: Squad, world: WorldState): number {
  let n = 0;
  for (const slot of squad.slots) {
    if (!slot) continue;
    const mech = world.mechs[slot.mechId];
    if (mech && !mech.destroyed && mech.hp > 0) n++;
  }
  return n;
}

function livingMechsOf(squad: Squad, world: WorldState, data: GameData): { mech: Mech; frame: FrameDef }[] {
  const out: { mech: Mech; frame: FrameDef }[] = [];
  for (const slot of squad.slots) {
    if (!slot) continue;
    const mech = world.mechs[slot.mechId];
    if (!mech || mech.destroyed || mech.hp <= 0) continue;
    const frame = data.frames[mech.frameId];
    if (!frame) continue;
    out.push({ mech, frame });
  }
  return out;
}

function hasSystemEffect(mech: Mech, data: GameData, effect: string): boolean {
  const a = mech.system && data.systems[mech.system];
  const b = mech.system2 && data.systems[mech.system2];
  return (!!a && a.effect === effect) || (!!b && b.effect === effect);
}

function computeMaxFuel(squad: Squad, world: WorldState, data: GameData): number {
  let cells = 0;
  for (const { mech } of livingMechsOf(squad, world, data)) {
    if (mech.system && data.systems[mech.system]?.effect === 'fuel_cell') cells++;
    if (mech.system2 && data.systems[mech.system2]?.effect === 'fuel_cell') cells++;
  }
  return 90 + 30 * cells;
}

function mobilitySpeedMult(mobility: Mobility, mapKind: MapKind): number {
  if (mobility === 'aerospace') return 1;
  if (mobility === 'space' && mapKind === 'surface') return 0.6;
  if (mobility === 'ground' && mapKind === 'space') return 0.5;
  return 1; // native fit
}

/** The squad's worst-fit mobility for the current map — used for both pathing and speed. */
function squadMobility(squad: Squad, world: WorldState, data: GameData, mapKind: MapKind): Mobility {
  const mechs = livingMechsOf(squad, world, data);
  if (mechs.length === 0) return 'ground';
  let worst = mechs[0].frame.mobility;
  let worstMult = mobilitySpeedMult(worst, mapKind);
  for (const { frame } of mechs) {
    const m = mobilitySpeedMult(frame.mobility, mapKind);
    if (m < worstMult) {
      worstMult = m;
      worst = frame.mobility;
    }
  }
  return worst;
}

function computeSquadSpeed(squad: Squad, world: WorldState, map: MapDef, data: GameData): number {
  const mechs = livingMechsOf(squad, world, data);
  if (mechs.length === 0) return 0;
  if (squad.effects.some((e) => e.type === 'rest')) return 0;

  const baseSpeed = Math.min(...mechs.map((m) => m.frame.speed));
  const mobility = squadMobility(squad, world, data, map.kind);
  const mobilityMult = mobilitySpeedMult(mobility, map.kind);
  const terrain = terrainAt(map, squad.pos);
  const costInverse = 1 / moveCost(terrain, mobility, map.kind);
  const burnMult = squad.effects.some((e) => e.type === 'burn') ? 2 : 1;
  const boosterMult = mechs.some(({ mech }) => hasSystemEffect(mech, data, 'booster')) ? 1.15 : 1;
  const fuelMult = squad.fuel <= 0 ? 0.5 : 1;

  return baseSpeed * mobilityMult * costInverse * burnMult * boosterMult * fuelMult;
}

function moveAlongPath(squad: Squad, dt: number, speed: number): void {
  let remaining = speed * dt;
  while (remaining > 1e-9 && squad.path.length > 0) {
    const wp = squad.path[0];
    const dx = wp.x - squad.pos.x;
    const dy = wp.y - squad.pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= remaining) {
      squad.pos = { x: wp.x, y: wp.y };
      squad.path.shift();
      remaining -= d;
    } else {
      const t = d === 0 ? 0 : remaining / d;
      squad.pos = { x: squad.pos.x + dx * t, y: squad.pos.y + dy * t };
      remaining = 0;
    }
  }
}

function addEffect(squad: Squad, eff: SquadEffect): void {
  squad.effects = squad.effects.filter((e) => e.type !== eff.type);
  squad.effects.push(eff);
}

function highestAptitude(apt: Aptitudes): Aptitude {
  let best: Aptitude = 'gunnery';
  let bestVal = -Infinity;
  (Object.keys(apt) as Aptitude[]).forEach((k) => {
    if (apt[k] > bestVal) {
      bestVal = apt[k];
      best = k;
    }
  });
  return best;
}

function allPlayerPilotIds(world: WorldState): Id[] {
  const ids = new Set<Id>();
  for (const squad of playerSquadsList(world)) {
    for (const slot of squad.slots) if (slot) ids.add(slot.pilotId);
  }
  return [...ids];
}

function deployedPlayerPilotIds(world: WorldState): Id[] {
  const ids = new Set<Id>();
  for (const squad of playerSquadsList(world)) {
    if (!onMap(squad)) continue;
    for (const slot of squad.slots) if (slot) ids.add(slot.pilotId);
  }
  return [...ids];
}

function regenNerveAllPlayers(world: WorldState, amount: number): void {
  for (const pilotId of allPlayerPilotIds(world)) {
    const pilot = world.pilots[pilotId];
    if (pilot && pilot.alive) pilot.nerve = Math.min(pilot.maxNerve, pilot.nerve + amount);
  }
}

// ---------------------------------------------------------------------------
// createWorld
// ---------------------------------------------------------------------------

/**
 * Builds the initial WorldState. Player squads start docked at the carrier;
 * enemy squads with spawnAt === 0 are placed immediately, the rest wait in
 * pendingSpawns. Pure — does not mutate `player` or `enemies`.
 */
export function createWorld(map: MapDef, seed: number, data: GameData, player: SideBundle, enemies: SideBundle): WorldState {
  const pilots: Record<Id, Pilot> = { ...player.pilots, ...enemies.pilots };
  const mechs: Record<Id, Mech> = { ...player.mechs, ...enemies.mechs };
  const squads: Record<Id, Squad> = {};
  const objectives: Record<Id, ObjectiveState> = {};
  const pendingSpawns: Id[] = [];

  for (const def of map.objectives) {
    objectives[def.id] = {
      id: def.id,
      status: 'active',
      progress: 0,
      hp: def.hp,
      pos: { ...def.pos },
      pathIndex: def.kind === 'convoy' ? 0 : undefined,
    };
  }

  for (const squad of player.squads) {
    squads[squad.id] = {
      ...squad,
      pos: { ...map.deployZone.pos },
      path: [],
      targetPos: null,
      state: 'docked',
      engageCooldown: 0,
      effects: [],
    };
  }

  const spawnById = new Map(map.enemySquads.map((e) => [e.id, e]));
  for (const squad of enemies.squads) {
    const spawn = spawnById.get(squad.id);
    const s: Squad = {
      ...squad,
      pos: spawn ? { ...spawn.pos } : { ...squad.pos },
      path: [],
      targetPos: null,
      state: 'idle',
      engageCooldown: 0,
      effects: [],
      ai: squad.ai ?? spawn?.ai,
    };
    if (spawn && spawn.spawnAt > 0) {
      s.state = 'docked';
      pendingSpawns.push(squad.id);
    }
    squads[squad.id] = s;
  }

  const rng = new Rng(seed);

  const world: WorldState = {
    mapId: map.id,
    tick: 0,
    time: 0,
    speed: 1,
    phase: 'deploy',
    squads,
    pilots,
    mechs,
    objectives,
    visibleEnemyIds: [],
    pendingBattle: null,
    lastBattle: null,
    carrierHp: 300,
    carrierMaxHp: 300,
    outcome: null,
    events: [],
    rngState: rng.getState(),
    pendingSpawns,
  };

  for (const squad of Object.values(squads)) {
    squad.maxFuel = computeMaxFuel(squad, world, data);
    squad.fuel = squad.maxFuel;
  }

  updateVisibility(world, map, data);

  return world;
}

// ---------------------------------------------------------------------------
// stepWorld and its substeps
// ---------------------------------------------------------------------------

const FIXED_STEP = 1 / 30;

/**
 * Advances world.time by dtReal * world.speed, sub-stepped at a fixed 1/30s
 * for numerical stability regardless of the caller's frame rate. No-ops
 * unless phase === 'running'. Mutates world in place.
 */
export function stepWorld(world: WorldState, map: MapDef, dtReal: number, data: GameData): void {
  if (world.phase !== 'running') return;
  let remaining = dtReal * world.speed;
  if (!(remaining > 0)) return;

  while (remaining > 1e-9) {
    const dt = Math.min(FIXED_STEP, remaining);
    // Advance the clock first so the win/lose check inside substep sees the
    // post-step time (otherwise the time-limit test lags one step behind).
    world.tick++;
    world.time += dt;
    substep(world, map, data, dt);
    remaining -= dt;
    if (world.phase !== 'running') break;
  }
}

function substep(world: WorldState, map: MapDef, data: GameData, dt: number): void {
  processSpawns(world, map);
  updateEnemyAI(world, map, data);
  stepMovementAndFuel(world, map, data, dt);
  tickEffects(world, dt);
  applyRadiationDamage(world, map, dt);
  updateObjectives(world, map, dt);
  updateCarrier(world, map, dt);
  tickPeriodicNerve(world, dt);
  updateVisibility(world, map, data);
  detectContact(world, map, data);
  checkWinLose(world, map);
}

// --- movement / fuel --------------------------------------------------------

function stepMovementAndFuel(world: WorldState, map: MapDef, data: GameData, dt: number): void {
  for (const squad of Object.values(world.squads)) {
    if (squad.state === 'destroyed') continue;

    const maxFuel = computeMaxFuel(squad, world, data);
    squad.maxFuel = maxFuel;

    if (squad.state === 'docked') {
      squad.fuel = maxFuel;
      continue;
    }
    if (squad.state === 'engaged') continue;

    const wasMoving = squad.path.length > 0;
    if (!wasMoving) continue;

    const speed = computeSquadSpeed(squad, world, map, data);
    if (speed > 0) moveAlongPath(squad, dt, speed);

    const burnMult = squad.effects.some((e) => e.type === 'burn') ? 3 : 1;
    squad.fuel = Math.max(0, squad.fuel - dt * burnMult);

    if (squad.path.length === 0) {
      if (squad.state === 'returning' || squad.state === 'routed') {
        squad.state = 'docked';
        squad.fuel = maxFuel;
        pushEvent(world, { t: 'squad_docked', squadId: squad.id });
      } else if (squad.state === 'moving') {
        squad.state = 'idle';
      }
      squad.targetPos = null;
    }
  }
}

// --- effects -----------------------------------------------------------------

function tickEffects(world: WorldState, dt: number): void {
  for (const squad of Object.values(world.squads)) {
    if (squad.engageCooldown > 0) squad.engageCooldown = Math.max(0, squad.engageCooldown - dt);
    if (squad.effects.length === 0) continue;

    const next: SquadEffect[] = [];
    for (const eff of squad.effects) {
      const remaining = eff.remaining - dt;
      if (remaining > 0) {
        next.push({ ...eff, remaining });
      } else if (eff.type === 'burn' && eff.magnitude === 1) {
        // burn_hard's forced idle period after the burn expires
        next.push({ type: 'rest', remaining: 15 });
      }
    }
    squad.effects = next;
  }
}

function applyRadiationDamage(world: WorldState, map: MapDef, dt: number): void {
  for (const squad of Object.values(world.squads)) {
    if (squad.state === 'destroyed' || squad.state === 'docked') continue;
    if (terrainAt(map, squad.pos) !== 'radiation') continue;

    for (const slot of squad.slots) {
      if (!slot) continue;
      const mech = world.mechs[slot.mechId];
      if (!mech || mech.destroyed || mech.hp <= 0) continue;
      mech.hp = Math.max(0, mech.hp - 2 * dt);
      if (mech.hp <= 0) mech.destroyed = true;
    }

    if (livingMechCount(squad, world) === 0) {
      squad.state = 'destroyed';
      pushEvent(world, { t: 'squad_destroyed', squadId: squad.id });
    }
  }
}

// --- enemy AI ------------------------------------------------------------

function findSquadWithPilot(world: WorldState, pilotId: Id): Squad | null {
  for (const squad of Object.values(world.squads)) {
    if (squad.state === 'destroyed') continue;
    for (const slot of squad.slots) {
      if (slot && slot.pilotId === pilotId) return squad;
    }
  }
  return null;
}

function nearestPlayerSquad(world: WorldState, from: Squad, radius: number): Squad | null {
  let best: Squad | null = null;
  let bestDist = Infinity;
  for (const s of playerSquadsList(world)) {
    if (!onMap(s)) continue;
    const d = dist(from.pos, s.pos);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best && bestDist <= radius ? best : null;
}

function nearestActiveObjective(world: WorldState, map: MapDef, pos: Vec2): ObjectiveState | null {
  let best: ObjectiveState | null = null;
  let bestDist = Infinity;
  for (const def of map.objectives) {
    const state = world.objectives[def.id];
    if (!state || state.status !== 'active') continue;
    const d = dist(pos, state.pos);
    if (d < bestDist) {
      bestDist = d;
      best = state;
    }
  }
  return best;
}

function ensurePathToward(world: WorldState, map: MapDef, data: GameData, squad: Squad, target: Vec2): void {
  const last = squad.path.length > 0 ? squad.path[squad.path.length - 1] : null;
  if (last && dist(last, target) < 0.6) return; // already heading there closely enough
  const mobility = squadMobility(squad, world, data, map.kind);
  squad.path = findPath(map, squad.pos, target, mobility);
  if (squad.path.length > 0) squad.state = 'moving';
}

function updateEnemyAI(world: WorldState, map: MapDef, data: GameData): void {
  for (const squad of enemySquadsList(world)) {
    if (squad.state === 'destroyed' || squad.state === 'docked' || squad.state === 'engaged') continue;
    if (squad.effects.some((e) => e.type === 'rest')) {
      squad.path = [];
      continue;
    }

    const override = squad.effects.find((e) => (e.type === 'pinged' || e.type === 'bait') && e.sourcePilotId);
    if (override && override.sourcePilotId) {
      const targetSquad = findSquadWithPilot(world, override.sourcePilotId);
      if (targetSquad) {
        ensurePathToward(world, map, data, squad, targetSquad.pos);
        continue;
      }
    }

    const ai = squad.ai;
    if (!ai) {
      squad.path = [];
      continue;
    }

    if (ai.behavior === 'boss') {
      const anyComplete = Object.values(world.objectives).some((o) => o.status === 'complete');
      if (anyComplete) ai.behavior = 'hunt';
    }

    switch (ai.behavior) {
      case 'guard':
      case 'boss':
        squad.path = [];
        break;
      case 'patrol': {
        if (!ai.patrolPoints || ai.patrolPoints.length === 0) {
          squad.path = [];
          break;
        }
        const idx = ai.patrolIndex ?? 0;
        const point = ai.patrolPoints[idx % ai.patrolPoints.length];
        if (squad.path.length === 0 && dist(squad.pos, point) < 0.3) {
          ai.patrolIndex = (idx + 1) % ai.patrolPoints.length;
        } else {
          ensurePathToward(world, map, data, squad, point);
        }
        break;
      }
      case 'hunt': {
        const target = nearestPlayerSquad(world, squad, ai.aggroRadius);
        if (target) ensurePathToward(world, map, data, squad, target.pos);
        else squad.path = [];
        break;
      }
      case 'intercept_objective': {
        const obj = nearestActiveObjective(world, map, squad.pos);
        if (obj) ensurePathToward(world, map, data, squad, obj.pos);
        else squad.path = [];
        break;
      }
    }
  }
}

// --- objectives ------------------------------------------------------------

function isConvoyEscorted(world: WorldState, def: ObjectiveDef, state: ObjectiveState): boolean {
  return playerSquadsList(world).some(
    (s) => onMap(s) && livingMechCount(s, world) > 0 && (s.escortingObjectiveId === def.id || dist(s.pos, state.pos) <= 2)
  );
}

function completeObjective(world: WorldState, map: MapDef, def: ObjectiveDef, state: ObjectiveState): void {
  if (state.status === 'complete') return;
  state.status = 'complete';
  state.progress = 1;
  pushEvent(world, { t: 'objective', objectiveId: def.id, status: 'complete' });
  regenNerveAllPlayers(world, 5);
  if (def.kind === 'derelict' && def.ambushSquadIds) {
    for (const id of def.ambushSquadIds) forceSpawn(world, map, id);
  }
}

function failObjective(world: WorldState, def: ObjectiveDef, state: ObjectiveState): void {
  if (state.status === 'failed') return;
  state.status = 'failed';
  pushEvent(world, { t: 'objective', objectiveId: def.id, status: 'failed' });
}

function progressHold(
  world: WorldState,
  map: MapDef,
  dt: number,
  def: ObjectiveDef,
  state: ObjectiveState,
  holdSeconds: number,
  blockedByEnemy: boolean
): void {
  const playerPresent = playerSquadsList(world).some((s) => onMap(s) && dist(s.pos, state.pos) <= def.radius);
  const enemyPresent = blockedByEnemy && enemySquadsList(world).some((s) => onMap(s) && dist(s.pos, state.pos) <= def.radius);
  if (playerPresent && !enemyPresent) {
    state.progress = Math.min(1, state.progress + dt / holdSeconds);
    if (state.progress >= 1) completeObjective(world, map, def, state);
  }
}

function updateConvoyMovement(world: WorldState, map: MapDef, dt: number, def: ObjectiveDef, state: ObjectiveState): void {
  if (!isConvoyEscorted(world, def, state)) return;
  if (!def.path || def.path.length === 0) return;
  const idx = state.pathIndex ?? 0;
  if (idx >= def.path.length) {
    completeObjective(world, map, def, state);
    return;
  }
  const target = def.path[idx];
  const speed = def.convoySpeed ?? 1;
  const dx = target.x - state.pos.x;
  const dy = target.y - state.pos.y;
  const d = Math.hypot(dx, dy);
  const step = speed * dt;
  if (d <= step) {
    state.pos = { x: target.x, y: target.y };
    state.pathIndex = idx + 1;
    if (state.pathIndex >= def.path.length) completeObjective(world, map, def, state);
  } else {
    const t = d === 0 ? 0 : step / d;
    state.pos = { x: state.pos.x + dx * t, y: state.pos.y + dy * t };
  }
  // Progress = distance travelled along the route, so the HUD arc means something.
  if (state.status !== 'complete') state.progress = convoyProgress(def.path, state.pos, state.pathIndex ?? 0);
}

function convoyProgress(path: Vec2[], pos: Vec2, pathIndex: number): number {
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    seg.push(l);
    total += l;
  }
  if (total === 0) return 0;
  // Completed segments are those before the current target waypoint.
  let done = 0;
  for (let i = 1; i < Math.min(pathIndex, path.length); i++) done += seg[i - 1];
  if (pathIndex >= 1 && pathIndex < path.length) {
    const prev = path[pathIndex - 1];
    done += Math.hypot(pos.x - prev.x, pos.y - prev.y);
  }
  return Math.max(0, Math.min(1, done / total));
}

function updateObjectives(world: WorldState, map: MapDef, dt: number): void {
  for (const def of map.objectives) {
    const state = world.objectives[def.id];
    if (!state || state.status === 'complete' || state.status === 'failed') continue;

    // Enemies loitering on a convoy/station chip away its HP unless it's
    // actively escorted (stay_with_them / nearby squad).
    if ((def.kind === 'convoy' || def.kind === 'evac_station' || def.kind === 'evac_colony') && def.hp !== undefined) {
      const enemyNear = enemySquadsList(world).some((s) => onMap(s) && dist(s.pos, state.pos) <= def.radius);
      const escorted = def.kind === 'convoy' && isConvoyEscorted(world, def, state);
      if (enemyNear && !escorted) {
        state.hp = Math.max(0, (state.hp ?? def.hp) - 3 * dt);
        if (state.hp <= 0) {
          failObjective(world, def, state);
          continue;
        }
      }
    }

    switch (def.kind) {
      case 'evac_station':
      case 'evac_colony':
        progressHold(world, map, dt, def, state, def.holdSeconds ?? 10, true);
        break;
      case 'relay':
        progressHold(world, map, dt, def, state, def.holdSeconds ?? 3, false);
        break;
      case 'derelict':
        progressHold(world, map, dt, def, state, def.holdSeconds ?? 5, false);
        break;
      case 'convoy':
        updateConvoyMovement(world, map, dt, def, state);
        break;
      case 'destroy_target': {
        const target = def.targetSquadId ? world.squads[def.targetSquadId] : undefined;
        if (!def.targetSquadId || !target || target.state === 'destroyed') {
          completeObjective(world, map, def, state);
        }
        break;
      }
      case 'reach_exit':
        if (playerSquadsList(world).some((s) => onMap(s) && dist(s.pos, state.pos) <= def.radius)) {
          completeObjective(world, map, def, state);
        }
        break;
    }
  }
}

function forceSpawn(world: WorldState, map: MapDef, squadId: Id): void {
  const spawnDef = map.enemySquads.find((e) => e.id === squadId);
  const squad = world.squads[squadId];
  if (!spawnDef || !squad) return;
  const idx = world.pendingSpawns.indexOf(squadId);
  if (idx >= 0) world.pendingSpawns.splice(idx, 1);
  if (squad.state !== 'docked') return; // already spawned
  squad.pos = { ...spawnDef.pos };
  squad.state = 'idle';
  if (!squad.ai) squad.ai = spawnDef.ai;
  pushEvent(world, { t: 'spawn', squadId });
}

function processSpawns(world: WorldState, map: MapDef): void {
  if (world.pendingSpawns.length === 0) return;
  for (const id of [...world.pendingSpawns]) {
    const spawnDef = map.enemySquads.find((e) => e.id === id);
    if (!spawnDef) continue;
    if (world.time >= spawnDef.spawnAt) forceSpawn(world, map, id);
  }
}

// --- carrier -----------------------------------------------------------------

function updateCarrier(world: WorldState, map: MapDef, dt: number): void {
  if (!map.carrierOnMap || world.carrierHp <= 0) return;
  const attackers = enemySquadsList(world).filter((s) => onMap(s) && dist(s.pos, map.deployZone.pos) <= CARRIER_RADIUS);
  if (attackers.length === 0) return;
  const before = world.carrierHp;
  const after = Math.max(0, before - attackers.length * CARRIER_DPS * dt);
  world.carrierHp = after;
  // Rate-limit the UI event to ~once per 2s (5dps * 2s = 10hp) without needing
  // extra state: emit only when a 10hp boundary is crossed, or on final death.
  if (Math.floor(before / 10) !== Math.floor(after / 10) || (after === 0 && before > 0)) {
    pushEvent(world, { t: 'carrier_hit', damage: before - after, hpAfter: after });
  }
}

// --- nerve regen -------------------------------------------------------------

function tickPeriodicNerve(world: WorldState, dt: number): void {
  const prevBucket = Math.floor((world.time - dt) / 20);
  const bucket = Math.floor(world.time / 20);
  if (bucket <= prevBucket) return;
  for (const pilotId of deployedPlayerPilotIds(world)) {
    const pilot = world.pilots[pilotId];
    if (pilot && pilot.alive) pilot.nerve = Math.min(pilot.maxNerve, pilot.nerve + 1);
  }
}

// --- visibility --------------------------------------------------------------

function squadHasRecon(squad: Squad, world: WorldState, data: GameData): boolean {
  return livingMechsOf(squad, world, data).some(({ mech }) => hasSystemEffect(mech, data, 'recon'));
}

function updateVisibility(world: WorldState, map: MapDef, data: GameData): void {
  const relayCaptured = map.objectives.some((o) => o.kind === 'relay' && world.objectives[o.id]?.status === 'complete');
  const players = playerSquadsList(world).filter(onMap);
  const visible: Id[] = [];

  for (const squad of enemySquadsList(world)) {
    if (!onMap(squad)) continue;
    if (squad.effects.some((e) => e.type === 'revealed' || e.type === 'marked')) {
      visible.push(squad.id);
      continue;
    }
    if (relayCaptured) {
      visible.push(squad.id);
      continue;
    }
    let seen = false;
    for (const p of players) {
      const radius = VISION_BASE + (squadHasRecon(p, world, data) ? 2 : 0);
      if (dist(p.pos, squad.pos) <= radius) {
        seen = true;
        break;
      }
    }
    if (!seen && dist(squad.pos, map.deployZone.pos) <= DEPLOY_VISION) seen = true;
    if (seen) visible.push(squad.id);
  }

  world.visibleEnemyIds = visible;
}

// --- contact -------------------------------------------------------------

function detectContact(world: WorldState, map: MapDef, data: GameData): void {
  if (world.phase !== 'running') return;
  const players = playerSquadsList(world).filter((s) => onMap(s) && s.engageCooldown <= 0 && s.state !== 'engaged');
  const enemies = enemySquadsList(world).filter((s) => onMap(s) && s.engageCooldown <= 0 && s.state !== 'engaged');

  for (const p of players) {
    for (const e of enemies) {
      if (dist(p.pos, e.pos) <= CONTACT_RADIUS) {
        const mid = { x: (p.pos.x + e.pos.x) / 2, y: (p.pos.y + e.pos.y) / 2 };
        world.pendingBattle = {
          squadAId: p.id,
          squadBId: e.id,
          terrain: terrainAt(map, mid),
          callouts: [],
        };
        world.phase = 'battle_pending';
        p.path = [];
        p.state = 'engaged';
        e.path = [];
        e.state = 'engaged';
        pushEvent(world, { t: 'contact', squadAId: p.id, squadBId: e.id });
        emitRivalContact(world, p, e, data);
        return; // only one battle at a time
      }
    }
  }
}

/**
 * The rival encounter's one scripted beat: when a squad first meets the rival
 * wing, a pilot who has something to say to them says it, and the rival
 * answers. Every pilot already ships `lines.rivalContact` in pilots.json —
 * it had no consumer until now.
 *
 * Fires at most once per map (RIVAL_SPAWN_ID is a single squad), and only for
 * pilots with authored lines, so grunt-only squads stay silent.
 */
const RIVAL_SPAWN_ID = 'spawn_rival';

function emitRivalContact(world: WorldState, player: Squad, enemy: Squad, data: GameData): void {
  if (enemy.id !== RIVAL_SPAWN_ID) return;
  if (world.events.some((e) => e.t === 'rival_contact')) return; // once per map

  const rng = new Rng(world.rngState);
  const speak = (pilotId: Id | undefined): void => {
    if (!pilotId) return;
    const def = data.pilots[pilotDefIdOfLocal(pilotId)];
    const pool = def?.lines.rivalContact;
    if (!pool || pool.length === 0) return;
    pushEvent(world, { t: 'rival_contact', pilotId, line: rng.pick(pool) });
  };

  // One of ours — prefer the squad leader, else the first pilot with lines.
  const ourPilots = player.slots.filter((s) => s !== null).map((s) => s!.pilotId);
  const lead = ourPilots.find((id) => id === player.leaderPilotId) ?? ourPilots[0];
  speak(lead);
  // ...and Duskfang answers.
  const theirs = enemy.slots.filter((s) => s !== null).map((s) => s!.pilotId);
  speak(theirs.find((id) => data.pilots[pilotDefIdOfLocal(id)]?.archetype === 'rival'));

  world.rngState = rng.getState();
}

/** Enemy pilot instance ids are `${defId}#${spawnId}#${slot}`; player ids pass through. */
function pilotDefIdOfLocal(pilotId: Id): Id {
  const i = pilotId.indexOf('#');
  return i === -1 ? pilotId : pilotId.slice(0, i);
}

// --- win / lose ----------------------------------------------------------

function endMap(world: WorldState, outcome: 'victory' | 'defeat'): void {
  world.outcome = outcome;
  world.phase = 'ended';
  pushEvent(world, { t: 'map_end', outcome });
}

function checkWinLose(world: WorldState, map: MapDef): void {
  if (world.phase === 'ended') return;

  const requiredDefs = map.objectives.filter((o) => o.required);
  if (requiredDefs.some((o) => world.objectives[o.id]?.status === 'failed')) {
    endMap(world, 'defeat');
    return;
  }
  if (map.carrierOnMap && world.carrierHp <= 0) {
    endMap(world, 'defeat');
    return;
  }
  const players = playerSquadsList(world);
  if (players.length > 0 && players.every((s) => s.state === 'destroyed')) {
    endMap(world, 'defeat');
    return;
  }

  const requiredComplete = requiredDefs.every((o) => world.objectives[o.id]?.status === 'complete');
  const bossSpawns = map.enemySquads.filter((e) => e.isBoss);
  const bossDead = bossSpawns.every((b) => !world.squads[b.id] || world.squads[b.id].state === 'destroyed');

  if (requiredComplete && bossDead) {
    endMap(world, 'victory');
    return;
  }

  if (map.timeLimit > 0 && world.time >= map.timeLimit) {
    endMap(world, requiredComplete && bossDead ? 'victory' : 'defeat');
  }
}

// ---------------------------------------------------------------------------
// player commands
// ---------------------------------------------------------------------------

/** Deploys a docked squad at the carrier/landing zone. Mutates world. */
export function deploySquad(world: WorldState, map: MapDef, squadId: Id, data: GameData): { ok: boolean; reason?: string } {
  const squad = world.squads[squadId];
  if (!squad) return { ok: false, reason: 'no such squad' };
  if (world.phase !== 'deploy' && world.phase !== 'running') return { ok: false, reason: 'wrong phase' };
  if (squad.state !== 'docked') return { ok: false, reason: 'already on the map' };
  if (livingMechCount(squad, world) === 0) return { ok: false, reason: 'no living mechs' };

  const ids = playerSquadsList(world).map((s) => s.id);
  const idx = Math.max(0, ids.indexOf(squadId));
  const offset = { x: (idx % 3) * 0.4 - 0.4, y: Math.floor(idx / 3) * 0.4 };

  squad.pos = { x: map.deployZone.pos.x + offset.x, y: map.deployZone.pos.y + offset.y };
  squad.path = [];
  squad.targetPos = null;
  squad.state = 'idle';
  squad.maxFuel = computeMaxFuel(squad, world, data);
  squad.fuel = squad.maxFuel;

  if (world.phase === 'deploy') world.phase = 'running';

  pushEvent(world, { t: 'deployed', squadId });
  return { ok: true };
}

/** Recomputes the squad's path to `target` using its worst-fit mobility. Mutates world. */
export function orderMove(world: WorldState, map: MapDef, squadId: Id, target: Vec2, data: GameData): { ok: boolean; reason?: string } {
  const squad = world.squads[squadId];
  if (!squad) return { ok: false, reason: 'no such squad' };
  if (!onMap(squad)) return { ok: false, reason: 'not deployed' };
  if (squad.state === 'engaged') return { ok: false, reason: 'in combat' };
  if (squad.state === 'routed') return { ok: false, reason: 'routed' };

  const mobility = squadMobility(squad, world, data, map.kind);
  const path = findPath(map, squad.pos, target, mobility);
  if (path.length === 0) return { ok: false, reason: 'unreachable' };

  squad.path = path;
  squad.targetPos = { x: target.x, y: target.y };
  squad.state = 'moving';
  return { ok: true };
}

/** Paths the squad home; docks and refuels on arrival. Mutates world. */
export function orderReturn(world: WorldState, map: MapDef, squadId: Id, data: GameData): { ok: boolean; reason?: string } {
  const squad = world.squads[squadId];
  if (!squad) return { ok: false, reason: 'no such squad' };
  if (!onMap(squad)) return { ok: false, reason: 'not deployed' };
  if (squad.state === 'engaged') return { ok: false, reason: 'in combat' };

  const mobility = squadMobility(squad, world, data, map.kind);
  const path = findPath(map, squad.pos, map.deployZone.pos, mobility);
  squad.targetPos = { ...map.deployZone.pos };

  if (path.length === 0) {
    squad.path = [];
    squad.state = 'docked';
    squad.maxFuel = computeMaxFuel(squad, world, data);
    squad.fuel = squad.maxFuel;
    pushEvent(world, { t: 'squad_docked', squadId });
  } else {
    squad.path = path;
    squad.state = 'returning';
  }
  return { ok: true };
}

export function setSpeed(world: WorldState, speed: 0 | 1 | 2 | 4): void {
  world.speed = speed;
}

export function setPendingCallouts(world: WorldState, callouts: ActiveCallout[]): void {
  if (world.pendingBattle) world.pendingBattle.callouts = callouts;
}

// ---------------------------------------------------------------------------
// overworld callouts (GDD §7.2)
// ---------------------------------------------------------------------------

/** Validates and applies an overworld callout, deducting the caster's Nerve. Mutates world. */
export function useOverworldCallout(
  world: WorldState,
  map: MapDef,
  squadId: Id,
  pilotId: Id,
  calloutId: Id,
  data: GameData
): { ok: boolean; reason?: string } {
  const squad = world.squads[squadId];
  if (!squad) return { ok: false, reason: 'no such squad' };
  const inSquad = squad.slots.some((s) => s && s.pilotId === pilotId);
  if (!inSquad) return { ok: false, reason: 'pilot not in squad' };
  const pilot = world.pilots[pilotId];
  if (!pilot) return { ok: false, reason: 'no such pilot' };
  const def = data.callouts[calloutId];
  if (!def) return { ok: false, reason: 'no such callout' };
  if (def.kind !== 'overworld') return { ok: false, reason: 'not an overworld callout' };
  if (!pilot.callouts.includes(calloutId)) return { ok: false, reason: 'pilot does not know this callout' };
  if (pilot.nerve < def.nerveCost) return { ok: false, reason: 'not enough nerve' };

  switch (def.effect) {
    case 'burn_hard': {
      addEffect(squad, { type: 'burn', remaining: def.duration ?? 30, magnitude: 1, sourcePilotId: pilotId });
      break;
    }
    case 'ping_sector': {
      const radius = def.radius ?? 8;
      const duration = def.duration ?? 20;
      for (const enemy of enemySquadsList(world)) {
        if (!onMap(enemy) || dist(enemy.pos, squad.pos) > radius) continue;
        addEffect(enemy, { type: 'revealed', remaining: duration });
        addEffect(enemy, { type: 'pinged', remaining: duration, sourcePilotId: pilotId });
      }
      break;
    }
    case 'rally_channel': {
      const radius = def.radius ?? 8;
      for (const ally of playerSquadsList(world)) {
        if (!onMap(ally) || dist(ally.pos, squad.pos) > radius) continue;
        ally.morale = Math.min(100, ally.morale + 20);
      }
      squad.morale = Math.max(0, squad.morale - 15);
      break;
    }
    case 'fall_back': {
      squad.pos = { ...map.deployZone.pos };
      squad.path = [];
      squad.targetPos = null;
      squad.state = 'idle';
      squad.engageCooldown = 5;
      for (const slot of squad.slots) {
        if (!slot) continue;
        const mech = world.mechs[slot.mechId];
        if (!mech) continue;
        const frame = data.frames[mech.frameId];
        const maxHp = frame ? Math.max(1, frame.hp - mech.maxHpPenalty) : mech.hp;
        mech.hp = Math.max(1, mech.hp - maxHp * 0.1);
      }
      if (world.pendingBattle && (world.pendingBattle.squadAId === squadId || world.pendingBattle.squadBId === squadId)) {
        const otherId = world.pendingBattle.squadAId === squadId ? world.pendingBattle.squadBId : world.pendingBattle.squadAId;
        const other = world.squads[otherId];
        if (other && other.state === 'engaged') other.state = 'idle';
        world.pendingBattle = null;
        world.phase = 'running';
      }
      break;
    }
    case 'come_get_some': {
      const radius = def.radius ?? 8;
      const duration = def.duration ?? 20;
      for (const enemy of enemySquadsList(world)) {
        if (!onMap(enemy) || dist(enemy.pos, squad.pos) > radius) continue;
        addEffect(enemy, { type: 'bait', remaining: duration, sourcePilotId: pilotId });
      }
      break;
    }
    case 'stay_with_them': {
      const nearby = map.objectives.find((o) => o.kind === 'convoy' && dist(squad.pos, world.objectives[o.id]?.pos ?? o.pos) <= 3);
      if (!nearby) return { ok: false, reason: 'no convoy nearby' };
      squad.escortingObjectiveId = nearby.id;
      addEffect(squad, { type: 'escort', remaining: def.duration ?? 99999, sourcePilotId: pilotId });
      break;
    }
    default:
      return { ok: false, reason: 'unsupported callout effect' };
  }

  pilot.nerve -= def.nerveCost;
  pushEvent(world, { t: 'callout', squadId, pilotId, calloutId, line: def.line });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// battle handoff
// ---------------------------------------------------------------------------

function buildSide(world: WorldState, squad: Squad): BattleSide {
  const pilots: Record<Id, Pilot> = {};
  const mechs: Record<Id, Mech> = {};
  for (const slot of squad.slots) {
    if (!slot) continue;
    if (world.pilots[slot.pilotId]) pilots[slot.pilotId] = world.pilots[slot.pilotId];
    if (world.mechs[slot.mechId]) mechs[slot.mechId] = world.mechs[slot.mechId];
  }
  return { squad, pilots, mechs };
}

/** Pure: builds the BattleSide/BattleContext for the pending contact. Requires world.pendingBattle. */
export function buildBattleSides(world: WorldState, map: MapDef, data: GameData): { sideA: BattleSide; sideB: BattleSide; ctx: BattleContext } {
  const pb = world.pendingBattle;
  if (!pb) throw new Error('buildBattleSides: no pending battle');
  const squadA = world.squads[pb.squadAId];
  const squadB = world.squads[pb.squadBId];
  const sideA = buildSide(world, squadA);
  const sideB = buildSide(world, squadB);

  const markedSquadIds: Id[] = [];
  if (squadA.effects.some((e) => e.type === 'marked')) markedSquadIds.push(squadA.id);
  if (squadB.effects.some((e) => e.type === 'marked')) markedSquadIds.push(squadB.id);

  const seed = hashString(`${world.rngState}:${squadA.id}:${squadB.id}:${world.tick}`);
  const ctx: BattleContext = {
    seed,
    mapKind: map.kind,
    terrain: pb.terrain,
    weather: map.weather,
    calloutsA: pb.callouts,
    calloutsB: [],
    markedSquadIds,
  };
  return { sideA, sideB, ctx };
}

export function beginBattle(world: WorldState): void {
  if (world.phase === 'battle_pending') world.phase = 'battle';
}

function applyLastTransmissionEffect(
  world: WorldState,
  data: GameData,
  evt: Extract<BattleResult['events'][number], { t: 'last_transmission' }>,
  aId: Id,
  bId: Id
): void {
  const enemySideId = evt.side === 'A' ? bId : aId; // "the enemy" relative to the pilot who died

  switch (evt.effect) {
    case 'lt_dont_stop': {
      for (const squad of playerSquadsList(world)) addEffect(squad, { type: 'burn', remaining: 30, magnitude: 0 });
      for (const pilotId of allPlayerPilotIds(world)) {
        const pilot = world.pilots[pilotId];
        if (pilot && pilot.alive) pilot.nerve = pilot.maxNerve;
      }
      break;
    }
    case 'lt_marking_them': {
      const squad = world.squads[enemySideId];
      if (squad) addEffect(squad, { type: 'marked', remaining: 99999 });
      break;
    }
    case 'lt_hold_them_here': {
      const squad = world.squads[enemySideId];
      if (squad) addEffect(squad, { type: 'rest', remaining: 20 });
      break;
    }
    case 'lt_light_it_up': {
      for (const squad of enemySquadsList(world)) addEffect(squad, { type: 'revealed', remaining: 99999 });
      break;
    }
    case 'lt_go_home': {
      for (const squad of playerSquadsList(world)) {
        squad.maxFuel = computeMaxFuel(squad, world, data);
        squad.fuel = squad.maxFuel;
      }
      break;
    }
    case 'lt_tell_them': {
      for (const pilotId of allPlayerPilotIds(world)) {
        const pilot = world.pilots[pilotId];
        if (!pilot || !pilot.alive) continue;
        const bond = pilot.bonds[evt.pilotId] ?? 0;
        if (bond > 0) {
          const key = highestAptitude(pilot.aptitudes);
          pilot.aptitudes[key] = Math.min(100, pilot.aptitudes[key] + 3);
        }
      }
      break;
    }
    default:
      break; // lt_take_the_frame / lt_got_the_shot are battle-internal (handled by battle.ts)
  }
}

function finalizeSquadAfterBattle(
  world: WorldState,
  map: MapDef,
  data: GameData,
  squad: Squad | undefined,
  side: 'A' | 'B',
  squadId: Id,
  result: BattleResult
): void {
  if (!squad) return;

  if (livingMechCount(squad, world) === 0) {
    if (squad.state !== 'destroyed') {
      squad.state = 'destroyed';
      pushEvent(world, { t: 'squad_destroyed', squadId });
    }
    squad.path = [];
    return;
  }

  const isPlayer = !isEnemyFaction(squad);
  const won = result.winner === side;
  const lost = result.winner !== 'draw' && result.winner !== side;

  if (lost) {
    squad.state = 'routed';
    squad.engageCooldown = 8;
    const home = isPlayer ? map.deployZone.pos : squad.ai?.homePos ?? squad.pos;
    const mobility = squadMobility(squad, world, data, map.kind);
    // Knock the loser back a few tiles toward home so it isn't left standing
    // on top of the winner (and instantly re-engaging when cooldowns lapse).
    const dx = home.x - squad.pos.x;
    const dy = home.y - squad.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let dist = 2.5; dist > 0; dist -= 0.5) {
      const cand = { x: squad.pos.x + (dx / len) * dist, y: squad.pos.y + (dy / len) * dist };
      const tx = Math.floor(cand.x);
      const ty = Math.floor(cand.y);
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      if (!isPassable(map.tiles[ty][tx], mobility, map.kind)) continue;
      squad.pos = cand;
      break;
    }
    squad.path = findPath(map, squad.pos, home, mobility);
    squad.targetPos = { ...home };
  } else if (won) {
    squad.state = 'idle';
    squad.engageCooldown = 3;
    squad.path = [];
  } else {
    squad.state = 'idle';
    squad.engageCooldown = 5;
    squad.path = [];
  }
}

/** Standing surrendered for refusing a contact. */
export const FALL_BACK_STANDING_COST = 6;

/**
 * Refuses a pending contact: the player squad breaks off instead of
 * fighting. Mirrors the losing side of a battle — routed state, knocked
 * back toward the deploy zone, engage cooldown — but with no shots fired
 * and no salvage. Returns the Standing the run should surrender, which the
 * caller applies (world.ts has no RunState reference).
 *
 * Exists because the rival's 'hunt' AI can corner a squad that has no
 * winning line at all (the support squad forecasts ~0% against the ace);
 * without this the encounter is a forced loss rather than a decision.
 */
export function fallBack(world: WorldState, map: MapDef, data: GameData): { ok: boolean; reason?: string; standingCost: number } {
  const pb = world.pendingBattle;
  if (!pb) return { ok: false, reason: 'no pending contact', standingCost: 0 };
  const squad = world.squads[pb.squadAId];
  const enemy = world.squads[pb.squadBId];
  if (!squad) return { ok: false, reason: 'no squad', standingCost: 0 };

  squad.state = 'routed';
  squad.engageCooldown = 12; // longer than a rout: you chose the distance
  const home = map.deployZone.pos;
  const mobility = squadMobility(squad, world, data, map.kind);
  const dx = home.x - squad.pos.x;
  const dy = home.y - squad.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  for (let dist = 4; dist > 0; dist -= 0.5) {
    const cand = { x: squad.pos.x + (dx / len) * dist, y: squad.pos.y + (dy / len) * dist };
    const tx = Math.floor(cand.x);
    const ty = Math.floor(cand.y);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
    if (!isPassable(map.tiles[ty][tx], mobility, map.kind)) continue;
    squad.pos = cand;
    break;
  }
  squad.path = findPath(map, squad.pos, home, mobility);
  squad.targetPos = { ...home };
  // Hold the pursuer off too, or 'hunt' re-contacts on the next tick.
  if (enemy) enemy.engageCooldown = Math.max(enemy.engageCooldown, 10);

  world.pendingBattle = null;
  world.phase = 'running';
  pushEvent(world, { t: 'fell_back', squadId: squad.id, fromSquadId: pb.squadBId, standingCost: FALL_BACK_STANDING_COST });
  return { ok: true, standingCost: FALL_BACK_STANDING_COST };
}

/**
 * Folds a resolved battle back into the map: copies pilots/mechs, marks
 * destroyed/routed squads, applies last-transmission map effects and the
 * "things go wrong" comeback nerve, then re-checks win/lose. Mutates world.
 */
export function applyBattleResult(world: WorldState, map: MapDef, result: BattleResult, data: GameData): void {
  const aId = result.sideA.squad.id;
  const bId = result.sideB.squad.id;

  Object.assign(world.pilots, result.sideA.pilots, result.sideB.pilots);
  Object.assign(world.mechs, result.sideA.mechs, result.sideB.mechs);

  const squadA = world.squads[aId];
  const squadB = world.squads[bId];
  if (squadA) squadA.morale = result.sideA.squad.morale;
  if (squadB) squadB.morale = result.sideB.squad.morale;

  const rng = new Rng(world.rngState);
  for (const death of result.pilotDeaths) {
    const squad = death.side === 'A' ? squadA : squadB;
    if (death.side === 'A') {
      pushEvent(world, { t: 'captain', line: rng.pick(data.captainLines.pilotLost) });
    }
    if (squad) {
      for (const slot of squad.slots) {
        if (!slot || slot.pilotId === death.pilotId) continue;
        const p = world.pilots[slot.pilotId];
        if (p && p.alive) p.nerve = Math.min(p.maxNerve, p.nerve + 8);
      }
    }
  }
  world.rngState = rng.getState();

  finalizeSquadAfterBattle(world, map, data, squadA, 'A', aId, result);
  finalizeSquadAfterBattle(world, map, data, squadB, 'B', bId, result);

  for (const evt of result.events) {
    if (evt.t !== 'last_transmission') continue;
    pushEvent(world, { t: 'last_transmission', pilotId: evt.pilotId, calloutId: evt.calloutId, line: evt.line });
    applyLastTransmissionEffect(world, data, evt, aId, bId);
  }

  pushEvent(world, { t: 'battle_resolved', squadAId: aId, squadBId: bId, winner: result.winner });

  world.lastBattle = result;
  world.pendingBattle = null;
  world.phase = 'running';
  checkWinLose(world, map);
}

export function withdraw(world: WorldState): void {
  world.outcome = 'withdraw';
  world.phase = 'ended';
  pushEvent(world, { t: 'map_end', outcome: 'withdraw' });
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

export function playerSquads(world: WorldState): Squad[] {
  return playerSquadsList(world);
}

export function enemySquads(world: WorldState): Squad[] {
  return enemySquadsList(world);
}

export function squadAlive(squad: Squad, world: WorldState): boolean {
  return squad.state !== 'destroyed' && livingMechCount(squad, world) > 0;
}

export function squadHpSummary(squad: Squad, world: WorldState, data: GameData): { hp: number; maxHp: number; alive: number; total: number } {
  let hp = 0;
  let maxHp = 0;
  let alive = 0;
  let total = 0;
  for (const slot of squad.slots) {
    if (!slot) continue;
    const mech = world.mechs[slot.mechId];
    if (!mech) continue;
    total++;
    const frame = data.frames[mech.frameId];
    const mechMaxHp = frame ? Math.max(1, frame.hp - mech.maxHpPenalty) : mech.hp;
    hp += Math.max(0, mech.hp);
    maxHp += mechMaxHp;
    if (!mech.destroyed && mech.hp > 0) alive++;
  }
  return { hp, maxHp, alive, total };
}
