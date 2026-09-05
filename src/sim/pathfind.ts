/**
 * CORDON — overworld pathfinding & terrain queries.
 *
 * Pure grid utilities used by world.ts. No mutation, no randomness, no time.
 * Positions are fractional tile coordinates; tile centers sit at (x+0.5, y+0.5).
 * `map.tiles[y][x]` is the terrain grid.
 */
import type { MapDef, Mobility, Terrain, Vec2, MapKind } from './types';

/** Terrain under a (fractional) map position. Out-of-bounds positions clamp to the nearest edge tile. */
export function terrainAt(map: MapDef, pos: Vec2): Terrain {
  const tx = clampInt(Math.floor(pos.x), 0, map.width - 1);
  const ty = clampInt(Math.floor(pos.y), 0, map.height - 1);
  return map.tiles[ty][tx];
}

/** Whether a mobility type may ever occupy a tile of this terrain (ignoring cost). */
export function isPassable(terrain: Terrain, mobility: Mobility, _mapKind: MapKind): boolean {
  if (terrain === 'blocked') return false;
  if (terrain === 'water') return mobility === 'aerospace';
  // mountain, forest, urban, debris, radiation, gravity, structure, open, void
  // are all passable for every mobility rating; the cost (not passability) is
  // where mobility differences show up (see moveCost below).
  return true;
}

/**
 * Multiplier applied to the base distance of entering a tile of this terrain.
 * 1 = normal. Values follow the "Rules of the map" table in API.md.
 */
export function moveCost(terrain: Terrain, mobility: Mobility, _mapKind: MapKind): number {
  switch (terrain) {
    case 'open':
    case 'void':
      return 1;
    case 'forest':
      return 1.4;
    case 'urban':
      return 1.2;
    case 'mountain':
      return mobility === 'aerospace' ? 1.5 : 2.5;
    case 'water':
      // Only aerospace ever enters water tiles (see isPassable); flying over
      // it costs nothing extra.
      return 1;
    case 'debris':
      return 1.3;
    case 'radiation':
      // Cost is cheap on purpose — the danger is the HP drain applied by
      // world.ts, not slower movement.
      return 1;
    case 'gravity':
      return mobility === 'aerospace' ? 1.3 : 1.8;
    case 'structure':
      return 1.1;
    case 'blocked':
      return Infinity;
    default:
      return 1;
  }
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

/**
 * 8-neighbour A* over tile cells. Diagonal moves that would cut through a
 * blocked corner (either orthogonal neighbour impassable) are rejected.
 * Returns tile-center waypoints from (but excluding) the start tile through
 * the destination tile, or [] if `to` is out of bounds, its tile is
 * impassable, or no route exists.
 */
export function findPath(map: MapDef, from: Vec2, to: Vec2, mobility: Mobility): Vec2[] {
  const sx = clampInt(Math.floor(from.x), 0, map.width - 1);
  const sy = clampInt(Math.floor(from.y), 0, map.height - 1);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return [];
  if (!isPassable(map.tiles[ty][tx], mobility, map.kind)) return [];
  if (sx === tx && sy === ty) return [];

  const width = map.width;
  const key = (x: number, y: number) => y * width + x;

  const open: Node[] = [];
  const openIndex = new Map<number, Node>();
  const closed = new Set<number>();

  const h = (x: number, y: number) => octile(x, y, tx, ty);

  const start: Node = { x: sx, y: sy, g: 0, f: h(sx, sy), parent: null };
  open.push(start);
  openIndex.set(key(sx, sy), start);

  const DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  let goal: Node | null = null;
  let guard = 0;
  const guardMax = width * map.height * 8 + 64;

  while (open.length > 0) {
    if (++guard > guardMax) break; // safety valve; should never trigger on valid grids

    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    openIndex.delete(key(current.x, current.y));
    const ck = key(current.x, current.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (current.x === tx && current.y === ty) {
      goal = current;
      break;
    }

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= map.height) continue;
      const nTerrain = map.tiles[ny][nx];
      if (!isPassable(nTerrain, mobility, map.kind)) continue;
      if (dx !== 0 && dy !== 0) {
        // corner-cutting guard: both orthogonal neighbours must be enterable
        const orthoA = map.tiles[current.y][nx];
        const orthoB = map.tiles[ny][current.x];
        if (!isPassable(orthoA, mobility, map.kind) || !isPassable(orthoB, mobility, map.kind)) continue;
      }
      if (closed.has(key(nx, ny))) continue;

      const stepDist = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const cost = stepDist * moveCost(nTerrain, mobility, map.kind);
      const g = current.g + cost;

      const existing = openIndex.get(key(nx, ny));
      if (existing && existing.g <= g) continue;

      const node: Node = { x: nx, y: ny, g, f: g + h(nx, ny), parent: current };
      if (existing) {
        const idx = open.indexOf(existing);
        if (idx >= 0) open.splice(idx, 1);
      }
      open.push(node);
      openIndex.set(key(nx, ny), node);
    }
  }

  if (!goal) return [];

  const cells: Node[] = [];
  let n: Node | null = goal;
  while (n) {
    cells.push(n);
    n = n.parent;
  }
  cells.reverse(); // start ... goal
  cells.shift(); // drop the start tile itself

  return cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
}

function octile(x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  return dx > dy ? (dx - dy) + dy * Math.SQRT2 : (dy - dx) + dx * Math.SQRT2;
}
