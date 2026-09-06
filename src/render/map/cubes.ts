/**
 * SRW-style raised blocks for impassable ('blocked') and space-station
 * ('structure') tiles — the one part of the terrain that never got a flat
 * tint (see tiles.ts's header): instead of a texture or a color wash, these
 * tiles get an actual extruded cube/slab, exactly like Super Robot Wars'
 * overworld obstacles.
 *
 * Unlike the baked ground (`tiles.ts`, one static RenderTexture), these are
 * LIVE display objects added straight into `MapScene`'s `entitiesLayer`
 * (sortable by zIndex, same convention as `SquadView`/`ObjectiveView`) so a
 * squad walking "behind" a tall block correctly draws behind it, and one
 * walking in front draws over it.
 *
 * One tile = one diamond extruded upward by `height` px:
 *   - top face: the tile's diamond, raised, filled with a light color.
 *   - left face: the quad between the tile's un-raised left/bottom edge and
 *     its raised counterpart — this is the edge that borders the SOUTH
 *     neighbor (tx, ty+1); see the vertex-direction derivation below.
 *   - right face: same idea for the bottom/right edge, which borders the
 *     EAST neighbor (tx+1, ty).
 *   - top face's own outline is stroked with a thin light "cel" edge, but
 *     only on the segments that border a DIFFERENT (non-same-terrain)
 *     neighbor — so adjacent blocked (or adjacent structure) tiles fuse
 *     into one continuous slab with an outline only at the slab's true
 *     outer boundary, not on every internal tile seam. The two side faces
 *     use that same same-terrain-neighbor test to skip drawing altogether
 *     when hidden by a neighboring block of the same kind (same fusion,
 *     applied to the faces instead of just the outline).
 *
 * The top/right/bottom/left vertex directions used below are derived once
 * from `toIso`'s linear form (see the inline derivation) rather than eyeballed,
 * so the neighbor-edge mapping (top edge -> north, right edge -> east,
 * bottom edge -> south, left edge -> west) is exact, not approximate.
 */
import { Container, Graphics } from 'pixi.js';
import type { MapDef, Terrain } from '@sim/types';
import { TILE_H, TILE_W } from './constants';
import { toIso } from './iso';
import { terrainOf } from './tiles';

interface CubeStyle {
  height: number;
  top: number;
  left: number;
  right: number;
  edge: number;
  edgeAlpha: number;
}

/** Only these two kinds are ever raised blocks — see tiles.ts's FLAT_TINTS for every other kind. */
const CUBE_STYLE: Partial<Record<Terrain, CubeStyle>> = {
  blocked: {
    height: TILE_H * 0.9,
    top: 0x50555f,
    left: 0x363a42,
    right: 0x24272d,
    edge: 0xd8f0ff,
    edgeAlpha: 0.55,
  },
  structure: {
    height: TILE_H * 0.5,
    top: 0x8c9aa6,
    left: 0x6b7680,
    right: 0x4d565e,
    edge: 0xd8f0ff,
    edgeAlpha: 0.5,
  },
};

const hw = TILE_W / 2;
const hh = TILE_H / 2;

/** Un-raised tile diamond vertices, relative to the tile's projected center. Top/right/bottom/left border north/east/south/west respectively (see this file's header). */
const T = { x: 0, y: -hh };
const R = { x: hw, y: 0 };
const B = { x: 0, y: hh };
const L = { x: -hw, y: 0 };

function raised(p: { x: number; y: number }, height: number): { x: number; y: number } {
  return { x: p.x, y: p.y - height };
}

/** One tile's cube as its own display object, positioned at the tile's projected ground point (same convention entitiesLayer already uses for squads/objectives — no extra bounds offset). */
function buildOneCube(map: MapDef, tx: number, ty: number, terrain: Terrain, style: CubeStyle): Container {
  const north = terrainOf(map, tx, ty - 1) === terrain;
  const east = terrainOf(map, tx + 1, ty) === terrain;
  const south = terrainOf(map, tx, ty + 1) === terrain;
  const west = terrainOf(map, tx - 1, ty) === terrain;

  const T2 = raised(T, style.height);
  const R2 = raised(R, style.height);
  const B2 = raised(B, style.height);
  const L2 = raised(L, style.height);

  const g = new Graphics();

  // Side faces — skipped where a same-terrain neighbor hides them (fuses adjacent blocks into a slab).
  if (!south) {
    g.poly([L.x, L.y, B.x, B.y, B2.x, B2.y, L2.x, L2.y], true).fill({ color: style.left });
  }
  if (!east) {
    g.poly([B.x, B.y, R.x, R.y, R2.x, R2.y, B2.x, B2.y], true).fill({ color: style.right });
  }

  // Top face, always drawn (it's what makes adjacent same-kind tiles read as one continuous slab top).
  g.poly([T2.x, T2.y, R2.x, R2.y, B2.x, B2.y, L2.x, L2.y], true).fill({ color: style.top });

  // Outline only on edges that border a genuinely different neighbor (or the map edge) — internal
  // slab seams stay unstroked so a run of blocked tiles reads as one shape, not a row of tiles.
  if (!north) g.moveTo(T2.x, T2.y).lineTo(R2.x, R2.y).stroke({ width: 1, color: style.edge, alpha: style.edgeAlpha });
  if (!east) g.moveTo(R2.x, R2.y).lineTo(B2.x, B2.y).stroke({ width: 1, color: style.edge, alpha: style.edgeAlpha });
  if (!south) g.moveTo(B2.x, B2.y).lineTo(L2.x, L2.y).stroke({ width: 1, color: style.edge, alpha: style.edgeAlpha });
  if (!west) g.moveTo(L2.x, L2.y).lineTo(T2.x, T2.y).stroke({ width: 1, color: style.edge, alpha: style.edgeAlpha });
  // Vertical corner edges on the two visible faces read as crisp block corners.
  if (!south) g.moveTo(L.x, L.y).lineTo(L2.x, L2.y).stroke({ width: 1, color: style.edge, alpha: style.edgeAlpha * 0.6 });
  if (!east) g.moveTo(R.x, R.y).lineTo(R2.x, R2.y).stroke({ width: 1, color: style.edge, alpha: style.edgeAlpha * 0.6 });
  if (!south || !east) {
    g.moveTo(B.x, B.y).lineTo(B2.x, B2.y).stroke({ width: 1, color: style.edge, alpha: style.edgeAlpha * 0.6 });
  }

  const container = new Container();
  container.addChild(g);
  const center = toIso({ x: tx + 0.5, y: ty + 0.5 });
  container.x = center.x;
  container.y = center.y;
  container.zIndex = center.y;
  return container;
}

/**
 * Builds one live Container per blocked/structure tile on `map`, ready for
 * `MapScene` to add directly into its sortable `entitiesLayer` (each cube's
 * `zIndex` is already set to its ground-point y, same depth-sort key
 * squads/objectives use). Pure/synchronous — no textures, no async load.
 */
export function buildBlockedCubes(map: MapDef): Container[] {
  const cubes: Container[] = [];
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const terrain = terrainOf(map, tx, ty);
      const style = CUBE_STYLE[terrain];
      if (!style) continue;
      cubes.push(buildOneCube(map, tx, ty, terrain, style));
    }
  }
  return cubes;
}
