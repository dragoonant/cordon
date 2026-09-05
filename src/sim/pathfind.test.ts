import { describe, it, expect } from 'vitest';
import { findPath, terrainAt, isPassable, moveCost } from './pathfind';
import type { MapDef, Terrain } from './types';

function makeMap(rows: string[], kind: MapDef['kind'] = 'surface'): MapDef {
  const legend: Record<string, Terrain> = {
    '.': kind === 'surface' ? 'open' : 'void',
    '#': 'blocked',
    w: 'water',
    m: 'mountain',
    f: 'forest',
  };
  const tiles: Terrain[][] = rows.map((row) => row.split('').map((ch) => legend[ch] ?? 'open'));
  return {
    id: 'test_map',
    name: 'test',
    kind,
    width: tiles[0].length,
    height: tiles.length,
    tiles,
    weather: 'clear',
    deployZone: { pos: { x: 0.5, y: 0.5 }, radius: 1 },
    carrierOnMap: false,
    objectives: [],
    enemySquads: [],
    timeLimit: 0,
    description: '',
    briefing: '',
  };
}

describe('terrainAt / isPassable / moveCost', () => {
  it('reads the tile under a fractional position', () => {
    const map = makeMap(['..#', '...', '...']);
    expect(terrainAt(map, { x: 2.1, y: 0.1 })).toBe('blocked');
    expect(terrainAt(map, { x: 0.9, y: 2.9 })).toBe('open');
  });

  it('blocks everything on blocked tiles', () => {
    expect(isPassable('blocked', 'ground', 'surface')).toBe(false);
    expect(isPassable('blocked', 'aerospace', 'surface')).toBe(false);
  });

  it('water is aerospace-only', () => {
    expect(isPassable('water', 'ground', 'surface')).toBe(false);
    expect(isPassable('water', 'space', 'surface')).toBe(false);
    expect(isPassable('water', 'aerospace', 'surface')).toBe(true);
  });

  it('mountain is passable for everyone but costs more for ground than aerospace', () => {
    expect(isPassable('mountain', 'ground', 'surface')).toBe(true);
    expect(moveCost('mountain', 'ground', 'surface')).toBeCloseTo(2.5);
    expect(moveCost('mountain', 'aerospace', 'surface')).toBeCloseTo(1.5);
  });

  it('gravity costs more for space frames than aerospace', () => {
    expect(moveCost('gravity', 'space', 'space')).toBeGreaterThan(moveCost('gravity', 'aerospace', 'space'));
  });
});

describe('findPath', () => {
  it('finds a straight line on open terrain', () => {
    const map = makeMap(['.....', '.....', '.....']);
    const path = findPath(map, { x: 0.5, y: 1.5 }, { x: 4.5, y: 1.5 }, 'ground');
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(4.5);
    expect(last.y).toBeCloseTo(1.5);
    // straight line: every waypoint should stay on row 1
    for (const p of path) expect(p.y).toBeCloseTo(1.5);
  });

  it('routes around a wall instead of failing', () => {
    const map = makeMap(['.....', '.###.', '.....']);
    const path = findPath(map, { x: 0.5, y: 1.5 }, { x: 4.5, y: 1.5 }, 'ground');
    expect(path.length).toBeGreaterThan(0);
    // must not step onto any of the blocked tiles at (1..3, 1)
    for (const p of path) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      if (ty === 1) expect(tx === 0 || tx === 4).toBe(true);
    }
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(4.5);
    expect(last.y).toBeCloseTo(1.5);
  });

  it('returns a single waypoint (the tile center) when already in the destination tile', () => {
    const map = makeMap(['.....', '.....', '.....']);
    const path = findPath(map, { x: 1.2, y: 1.8 }, { x: 1.9, y: 1.1 }, 'ground');
    expect(path).toEqual([{ x: 1.5, y: 1.5 }]);
  });

  it('returns [] when the destination is out of map bounds', () => {
    const map = makeMap(['.....', '.....', '.....']);
    const path = findPath(map, { x: 0.5, y: 0.5 }, { x: 4.5, y: 9.5 }, 'ground'); // only 3 rows tall
    expect(path).toEqual([]);
  });

  it('returns [] when a tile is fully boxed in on every side (including diagonals)', () => {
    const map = makeMap(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const path = findPath(map, { x: 2.5, y: 2.5 }, { x: 0.5, y: 0.5 }, 'ground');
    expect(path).toEqual([]);
  });

  it('a ground squad cannot cross water; an aerospace squad can', () => {
    const map = makeMap(['.....', 'wwwww', '.....']);
    const groundPath = findPath(map, { x: 0.5, y: 0.5 }, { x: 0.5, y: 2.5 }, 'ground');
    expect(groundPath).toEqual([]);
    const airPath = findPath(map, { x: 0.5, y: 0.5 }, { x: 0.5, y: 2.5 }, 'aerospace');
    expect(airPath.length).toBeGreaterThan(0);
  });

  it('disallows cutting diagonally through a blocked corner', () => {
    // (1,0) and (0,1) around (0,0)->(1,1) diagonal are both open, but block one
    // orthogonal neighbour so the diagonal must be rejected.
    const map = makeMap(['.#', '..']);
    const path = findPath(map, { x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 }, 'ground');
    // must not go straight diagonal (only 1 step); must detour through (0,1)->(1,1) or similar
    expect(path.length).toBeGreaterThanOrEqual(2);
  });

  it('is unreachable when start and goal are in disconnected pockets', () => {
    const map = makeMap(['..#..', '..#..', '..#..']);
    const path = findPath(map, { x: 0.5, y: 1.5 }, { x: 4.5, y: 1.5 }, 'ground');
    expect(path).toEqual([]);
  });
});
