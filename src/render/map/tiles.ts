/**
 * Bakes the static terrain layer once per `load()`: a Graphics tree built
 * tile-by-tile, then flattened via `renderer.generateTexture` into a single
 * Sprite so per-frame rendering never re-touches terrain geometry.
 */
import { Graphics, Sprite, type Application } from 'pixi.js';
import type { MapDef, MapKind, Terrain } from '@sim/types';
import { TILE_SIZE } from './constants';
import { hash01 } from './hash';

const SURFACE_COLORS: Partial<Record<Terrain, number>> = {
  open: 0x3f4a35,
  forest: 0x2c4a2e,
  urban: 0x4b4b52,
  mountain: 0x5c5347,
  water: 0x2a4a63,
  blocked: 0x15161a,
};

const SPACE_COLORS: Partial<Record<Terrain, number>> = {
  void: 0x0a0c14,
  debris: 0x2b2e38,
  radiation: 0x3a1f2a,
  gravity: 0x1c2438,
  structure: 0x333a46,
  blocked: 0x05060a,
};

function baseColor(terrain: Terrain, kind: MapKind): number {
  const table = kind === 'surface' ? SURFACE_COLORS : SPACE_COLORS;
  const fallback = kind === 'surface' ? SURFACE_COLORS.open! : SPACE_COLORS.void!;
  return table[terrain] ?? fallback;
}

export function bakeTiles(app: Application, map: MapDef): Sprite {
  const g = new Graphics();
  for (let y = 0; y < map.height; y++) {
    const row = map.tiles[y];
    for (let x = 0; x < map.width; x++) {
      const terrain: Terrain = row?.[x] ?? (map.kind === 'surface' ? 'open' : 'void');
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      g.rect(px, py, TILE_SIZE, TILE_SIZE).fill({ color: baseColor(terrain, map.kind) });
      drawDecoration(g, terrain, x, y, px, py);
    }
  }
  if (map.kind === 'surface') {
    drawGrid(g, map.width, map.height);
  }
  const texture = app.renderer.generateTexture(g);
  g.destroy();
  const sprite = new Sprite(texture);
  sprite.label = 'tile-layer';
  return sprite;
}

function drawGrid(g: Graphics, width: number, height: number): void {
  const w = width * TILE_SIZE;
  const h = height * TILE_SIZE;
  for (let x = 0; x <= width; x++) {
    g.moveTo(x * TILE_SIZE, 0).lineTo(x * TILE_SIZE, h);
  }
  for (let y = 0; y <= height; y++) {
    g.moveTo(0, y * TILE_SIZE).lineTo(w, y * TILE_SIZE);
  }
  g.stroke({ width: 1, color: 0xffffff, alpha: 0.08 });
}

function drawDecoration(g: Graphics, terrain: Terrain, tx: number, ty: number, px: number, py: number): void {
  switch (terrain) {
    case 'forest': {
      const n = 3 + Math.floor(hash01(tx, ty, 1) * 3);
      for (let i = 0; i < n; i++) {
        const rx = px + 6 + hash01(tx, ty, i * 7 + 2) * (TILE_SIZE - 12);
        const ry = py + 6 + hash01(tx, ty, i * 7 + 3) * (TILE_SIZE - 12);
        g.circle(rx, ry, 2.5).fill({ color: 0x1c3a1f, alpha: 0.9 });
      }
      break;
    }
    case 'urban': {
      for (let i = 0; i < 3; i++) {
        const bw = 6 + hash01(tx, ty, i * 3 + 1) * 8;
        const bh = 6 + hash01(tx, ty, i * 3 + 2) * 8;
        const bx = px + 4 + hash01(tx, ty, i * 3 + 3) * (TILE_SIZE - bw - 8);
        const by = py + 4 + hash01(tx, ty, i * 3 + 4) * (TILE_SIZE - bh - 8);
        g.rect(bx, by, bw, bh).fill({ color: 0x36363d, alpha: 0.8 });
      }
      break;
    }
    case 'mountain': {
      for (let i = 0; i < 3; i++) {
        const offset = i * (TILE_SIZE / 3);
        g.moveTo(px + offset, py + TILE_SIZE).lineTo(px + offset + TILE_SIZE / 3, py);
      }
      g.stroke({ width: 2, color: 0x3d372c, alpha: 0.6 });
      break;
    }
    case 'water': {
      for (let i = 0; i < 2; i++) {
        const wy = py + TILE_SIZE * (0.35 + i * 0.35);
        g.moveTo(px + 4, wy).quadraticCurveTo(px + TILE_SIZE / 2, wy - 4, px + TILE_SIZE - 4, wy);
      }
      g.stroke({ width: 1.5, color: 0x5c86a8, alpha: 0.5 });
      break;
    }
    case 'void': {
      const speckChance = hash01(tx, ty, 9);
      const speckCount = speckChance < 0.35 ? 1 + Math.floor(hash01(tx, ty, 10) * 2) : 0;
      for (let i = 0; i < speckCount; i++) {
        const sx = px + hash01(tx, ty, 20 + i) * TILE_SIZE;
        const sy = py + hash01(tx, ty, 30 + i) * TILE_SIZE;
        const a = 0.5 + hash01(tx, ty, 40 + i) * 0.4;
        g.circle(sx, sy, 0.8).fill({ color: 0xffffff, alpha: a });
      }
      break;
    }
    case 'debris': {
      for (let i = 0; i < 2; i++) {
        const cx = px + 10 + hash01(tx, ty, i * 5 + 1) * (TILE_SIZE - 20);
        const cy = py + 10 + hash01(tx, ty, i * 5 + 2) * (TILE_SIZE - 20);
        const s = 4 + hash01(tx, ty, i * 5 + 3) * 4;
        g.poly(
          [cx - s, cy + s * 0.4, cx - s * 0.2, cy - s, cx + s, cy - s * 0.2, cx + s * 0.3, cy + s],
          true
        ).fill({ color: 0x4a4e5c, alpha: 0.7 });
      }
      break;
    }
    case 'radiation': {
      for (let i = -1; i < 2; i++) {
        g.moveTo(px, py + TILE_SIZE / 2 + i * 10).lineTo(px + TILE_SIZE, py - TILE_SIZE / 2 + i * 10);
      }
      g.stroke({ width: 1, color: 0xaa3344, alpha: 0.25 });
      break;
    }
    case 'gravity': {
      const cx = px + TILE_SIZE / 2;
      const cy = py + TILE_SIZE / 2;
      g.circle(cx, cy, TILE_SIZE * 0.15).stroke({ width: 1, color: 0x5f7bb0, alpha: 0.35 });
      g.circle(cx, cy, TILE_SIZE * 0.3).stroke({ width: 1, color: 0x5f7bb0, alpha: 0.25 });
      g.circle(cx, cy, TILE_SIZE * 0.45).stroke({ width: 1, color: 0x5f7bb0, alpha: 0.15 });
      break;
    }
    case 'structure': {
      g.moveTo(px + 4, py + 4).lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
      g.moveTo(px + TILE_SIZE - 4, py + 4).lineTo(px + 4, py + TILE_SIZE - 4);
      g.stroke({ width: 1.5, color: 0x5a6478, alpha: 0.4 });
      break;
    }
    default:
      break;
  }
}
