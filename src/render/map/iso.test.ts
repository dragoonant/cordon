import { describe, expect, it } from 'vitest';
import { depth, fromIso, isoRadii, mapIsoBounds, tileDiamondPoints, toIso } from './iso';
import { TILE_H, TILE_W } from './constants';

describe('toIso / fromIso', () => {
  it('projects the origin to the origin', () => {
    expect(toIso({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('moves right+down on screen as tx increases', () => {
    const p = toIso({ x: 1, y: 0 });
    expect(p.x).toBeCloseTo(TILE_W / 2);
    expect(p.y).toBeCloseTo(TILE_H / 2);
  });

  it('moves left+down on screen as ty increases', () => {
    const p = toIso({ x: 0, y: 1 });
    expect(p.x).toBeCloseTo(-TILE_W / 2);
    expect(p.y).toBeCloseTo(TILE_H / 2);
  });

  it('is linear: toIso(a) - toIso(b) === toIso(a - b)', () => {
    const a = { x: 5.3, y: 2.1 };
    const b = { x: 1.7, y: 4.4 };
    const diff = toIso(a);
    const base = toIso(b);
    const delta = toIso({ x: a.x - b.x, y: a.y - b.y });
    expect(diff.x - base.x).toBeCloseTo(delta.x);
    expect(diff.y - base.y).toBeCloseTo(delta.y);
  });

  it('fromIso is the exact inverse of toIso for arbitrary fractional tiles', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 3.5, y: 6.25 },
      { x: -2, y: 10 },
      { x: 25.9, y: 15.1 },
    ];
    for (const p of samples) {
      const projected = toIso(p);
      const back = fromIso(projected.x, projected.y);
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
    }
  });
});

describe('depth', () => {
  it('increases back-to-front (increasing tx+ty)', () => {
    expect(depth({ x: 0, y: 0 })).toBe(0);
    expect(depth({ x: 3, y: 4 })).toBe(7);
    expect(depth({ x: 1, y: 1 })).toBeLessThan(depth({ x: 2, y: 1 }));
  });
});

describe('isoRadii', () => {
  it('scales x/y radii by the tile half-width/half-height', () => {
    expect(isoRadii(1)).toEqual({ rx: TILE_W / 2, ry: TILE_H / 2 });
    expect(isoRadii(0.5)).toEqual({ rx: TILE_W / 4, ry: TILE_H / 4 });
  });
});

describe('tileDiamondPoints', () => {
  it('returns the four vertices of a tile-sized diamond centered at (cx, cy)', () => {
    const pts = tileDiamondPoints(10, 20);
    expect(pts).toEqual([10, 20 - TILE_H / 2, 10 + TILE_W / 2, 20, 10, 20 + TILE_H / 2, 10 - TILE_W / 2, 20]);
  });

  it('scale inflates the diamond proportionally', () => {
    const pts = tileDiamondPoints(0, 0, 2);
    expect(pts).toEqual([0, -TILE_H, TILE_W, 0, 0, TILE_H, -TILE_W, 0]);
  });
});

describe('mapIsoBounds', () => {
  it('is symmetric around x=0 for a square map, and starts at y=0 (top corner) minus the half-tile pad', () => {
    const b = mapIsoBounds({ width: 10, height: 10 });
    expect(b.minX).toBeCloseTo(-b.maxX);
    expect(b.minY).toBeCloseTo(-TILE_H / 2);
  });

  it('grows asymmetrically for a rectangular map (e.g. the 26x16 perf target)', () => {
    const b = mapIsoBounds({ width: 26, height: 16 });
    expect(b.maxX - b.minX).toBeCloseTo((26 + 16) * (TILE_W / 2) + TILE_W);
    expect(b.maxY - b.minY).toBeCloseTo((26 + 16) * (TILE_H / 2) + TILE_H);
  });
});
