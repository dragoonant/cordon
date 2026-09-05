/**
 * CORDON — "Captain guidance" fallback line for the map Ticker.
 *
 * The Ticker normally shows `store.captainLine` (scripted / event-driven).
 * When nothing scripted has spoken recently, MapScreen falls back to this
 * ambient, always-available instruction so a first-time player is never
 * looking at a blank Ticker wondering what to do next. Pure projection of
 * WorldState/MapDef — no mutation, no sim logic.
 */
import type { GameData, MapDef, ObjectiveDef, WorldState } from '@sim/types';
import { enemySquads, playerSquads } from '@sim/world';
import { tileDist } from './mapHelpers';

const LOW_FUEL_RATIO = 0.2;
const BLOCK_RADIUS_PAD = 1; // tiles of slack when checking "enemy near the ring"

/**
 * Returns a short, contextual instruction for the current map state, or
 * null when nothing useful applies (e.g. no squads on the map yet at all).
 * `data` is accepted for symmetry with other map helpers and future use
 * (e.g. named callouts) though the current cases don't need it.
 */
export function guidanceLine(world: WorldState, map: MapDef, data: GameData): string | null {
  void data;
  const squads = playerSquads(world).filter((sq) => sq.state !== 'destroyed');
  if (squads.length === 0) return null;

  if (squads.every((sq) => sq.state === 'docked')) {
    return 'Deploy from the Lantern — left panel.';
  }

  const incomplete = map.objectives.filter((o) => {
    const st = world.objectives[o.id];
    return st && st.status !== 'complete' && st.status !== 'failed';
  });

  const idle = squads.some((sq) => sq.state === 'idle');
  if (idle && incomplete.length > 0) {
    const target = incomplete[0];
    return `Move a squadron into the ring around ${target.name}.`;
  }

  const blocked = findBlockedObjective(world, incomplete);
  if (blocked) {
    return `Enemies are blocking ${blocked.name} — engage or bait them away.`;
  }

  const lowFuel = squads.find(
    (sq) => sq.state !== 'docked' && sq.state !== 'returning' && sq.maxFuel > 0 && sq.fuel / sq.maxFuel < LOW_FUEL_RATIO,
  );
  if (lowFuel) {
    return `${lowFuel.name} is low on fuel — Recall to refuel.`;
  }

  const required = map.objectives.filter((o) => o.required);
  const requiredIncomplete = required.some((o) => {
    const st = world.objectives[o.id];
    return !st || st.status !== 'complete';
  });
  if (required.length > 0 && !requiredIncomplete) {
    return "That's the mission. Withdraw or mop up.";
  }

  return null;
}

function findBlockedObjective(world: WorldState, incomplete: ObjectiveDef[]): ObjectiveDef | null {
  const enemies = enemySquads(world).filter((sq) => sq.state !== 'destroyed');
  if (enemies.length === 0) return null;
  for (const o of incomplete) {
    const st = world.objectives[o.id];
    if (!st) continue;
    const near = enemies.some((sq) => tileDist(sq.pos, st.pos) <= o.radius + BLOCK_RADIUS_PAD);
    if (near) return o;
  }
  return null;
}
