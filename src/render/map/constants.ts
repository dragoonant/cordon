/**
 * CORDON — map renderer constants.
 *
 * The map renders as a 2:1 isometric projection (Ogre Battle 64 style):
 * every `Vec2` coming out of `src/sim` is in fractional tiles, and
 * `iso.ts#toIso` turns that into the projected pixel space that every Pixi
 * display object in `src/render/map` actually lives in (the `worldLayer`).
 * `TILE_W`/`TILE_H` are the single source of truth for that projection — see
 * `iso.ts` for the forward/inverse transform and depth-sort key.
 */

/** Full diamond width/height of one tile in the 2:1 isometric projection. */
export const TILE_W = 96;
export const TILE_H = 48;

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;

/** Extra world-space (px) the camera is allowed to pan past the map's projected diamond. */
export const CAMERA_MARGIN = TILE_H * 2;

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
