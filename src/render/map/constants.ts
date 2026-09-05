/**
 * CORDON — map renderer constants.
 *
 * TILE_SIZE is the single source of truth for the world-space scale: every
 * `Vec2` coming out of `src/sim` is in fractional tiles, and every Pixi
 * display object in `src/render/map` lives in the `worldLayer`'s pixel space,
 * which is `tiles * TILE_SIZE`.
 */

export const TILE_SIZE = 48;

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;

/** Extra world-space (px) the camera is allowed to pan past the map edge. */
export const CAMERA_MARGIN = TILE_SIZE * 2;

/** How fast interpolated positions chase their sim target, in "per second". */
export const POSITION_LERP_RATE = 12;

/** Distance (in tiles) beyond which a position jump is treated as a teleport (snap, no lerp). */
export const TELEPORT_SNAP_DISTANCE = 3;

/** How long a squad takes to fade fully in/out when it enters/leaves visibility. */
export const VISIBILITY_FADE_SECONDS = 0.3;

export const STATUS_COLOR = {
  pending: 0x9aa0a6,
  active: 0xffa53c,
  complete: 0x4caf6d,
  failed: 0xd9534f,
} as const;
