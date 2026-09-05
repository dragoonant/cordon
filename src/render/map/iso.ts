/**
 * The 2:1 isometric projection (Ogre Battle 64 style) — the single place
 * that converts between sim-space tile coordinates (`Vec2`, fractional
 * tiles, `[y][x]` grid) and the projected pixel space every display object
 * in `src/render/map` actually lives in.
 *
 * The map is `MapDef.tiles[y][x]`; "tx"/"ty" below always mean that grid's
 * x/y, never the projected pixel x/y.
 *
 * The transform is linear (no translation), which matters for a few callers:
 * `toIso(a) - toIso(b) === toIso({x: a.x - b.x, y: a.y - b.y})`, so relative
 * offsets (deltas, path segments) can be projected the same way as points.
 */
import type { Vec2 } from '@sim/types';
import { TILE_H, TILE_W } from './constants';

export interface IsoPoint {
  x: number;
  y: number;
}

/** Tile-space → projected pixel space. */
export function toIso(p: Vec2): IsoPoint {
  return {
    x: (p.x - p.y) * (TILE_W / 2),
    y: (p.x + p.y) * (TILE_H / 2),
  };
}

/** Projected pixel space → tile-space. Exact inverse of `toIso`. */
export function fromIso(px: number, py: number): Vec2 {
  const a = px / (TILE_W / 2); // tx - ty
  const b = py / (TILE_H / 2); // tx + ty
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Painter's-algorithm depth key: strictly increasing back-to-front. */
export function depth(p: Vec2): number {
  return p.x + p.y;
}

/** x/y radii for a tile-space radius `r`, so radial UI (rings, pulses) reads as a flat disc on the iso ground plane. */
export function isoRadii(r: number): { rx: number; ry: number } {
  return { rx: r * (TILE_W / 2), ry: r * (TILE_H / 2) };
}

export interface IsoBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The projected diamond's bounding box for a `width`x`height` tile grid —
 * i.e. the projection of the grid's four corners (not tile centers), padded
 * by half a tile so per-tile diamonds that touch the edge aren't clipped.
 * Used by the camera (fit/clamp) and the tile baker (render-texture bounds).
 */
export function mapIsoBounds(map: { width: number; height: number }): IsoBounds {
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: map.width, y: 0 },
    { x: 0, y: map.height },
    { x: map.width, y: map.height },
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const p = toIso(c);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: minX - TILE_W / 2,
    maxX: maxX + TILE_W / 2,
    minY: minY - TILE_H / 2,
    maxY: maxY + TILE_H / 2,
  };
}

/** The four vertices (top, right, bottom, left) of one tile's diamond, centered at `(cx, cy)`, as an `x,y,x,y,...` poly array. `scale` inflates it (>1) to hide anti-aliasing seams between adjacent tiles. */
export function tileDiamondPoints(cx: number, cy: number, scale = 1): number[] {
  const hw = (TILE_W / 2) * scale;
  const hh = (TILE_H / 2) * scale;
  return [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy];
}
