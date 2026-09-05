import type { Vec2 } from '@sim/types';
import { POSITION_LERP_RATE, TELEPORT_SNAP_DISTANCE } from './constants';

/**
 * Chases `target` from `current` at `ratePerSec` (exponential-ish smoothing).
 * Snaps instantly when the gap is bigger than `TELEPORT_SNAP_DISTANCE` tiles
 * so a sim-side teleport (respawn, orderReturn dock, etc.) doesn't produce a
 * visible slide across the map.
 */
export function lerpTowards(current: Vec2, target: Vec2, dt: number, ratePerSec = POSITION_LERP_RATE): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dist = Math.hypot(dx, dy);
  if (dist > TELEPORT_SNAP_DISTANCE || dist < 1e-5) {
    return { x: target.x, y: target.y };
  }
  const t = Math.min(1, ratePerSec * dt);
  return { x: current.x + dx * t, y: current.y + dy * t };
}

/** Linear step of a scalar toward `target`, moving at most `maxDelta`. Used for alpha fades. */
export function stepTowards(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return current;
}
