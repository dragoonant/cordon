/**
 * Bakes the static terrain layer once per `load()`: every tile is drawn as a
 * 2:1 isometric diamond (textured, when `/sprites/map/terrain_<terrain>.png`
 * is published — see `loadTerrainTexture` below — else a flat-colored
 * fallback diamond with cheap per-terrain decoration), then the whole thing
 * is flattened via `renderer.generateTexture` into a single Sprite so
 * per-frame rendering never re-touches terrain geometry.
 *
 * The returned Sprite wraps a `RenderTexture`, a GPU resource tied to this
 * app's renderer — `MapScene` is responsible for destroying it (texture:
 * true) when the map is torn down or swapped, unlike the shared canvas-baked
 * textures in `src/render/sprites`.
 */
import { Assets, Container, Graphics, Sprite, Texture, type Application } from 'pixi.js';
import type { MapDef, MapKind, Terrain } from '@sim/types';
import { probeFirstExisting } from '@render/sprites/assetProbe';
import { TILE_H, TILE_W } from './constants';
import { hash01 } from './hash';
import { mapIsoBounds, tileDiamondPoints, toIso } from './iso';

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

// Inflate the filled diamond slightly so adjacent tiles overlap by ~1px and
// hide anti-aliasing seams; the outline is drawn at true size on top.
const FILL_OVERLAP = 1.07; // enough to swallow the rotated sprites' anti-aliased edges
const OUTLINE_ALPHA = 0.025;

/** Per-terrain hand-authored art, probed once and cached for the process lifetime (another agent publishes these to `public/sprites/map/`). */
const terrainTextureCache = new Map<string, Promise<Texture | null>>();
function loadTerrainTexture(terrain: Terrain): Promise<Texture | null> {
  let cached = terrainTextureCache.get(terrain);
  if (cached) return cached;
  cached = (async () => {
    const url = await probeFirstExisting(`/sprites/map/terrain_${terrain}`, ['png', 'jpg']);
    if (!url) return null;
    try {
      return await Assets.load<Texture>(url);
    } catch {
      return null;
    }
  })();
  terrainTextureCache.set(terrain, cached);
  return cached;
}

function terrainOf(map: MapDef, tx: number, ty: number): Terrain {
  return map.tiles[ty]?.[tx] ?? (map.kind === 'surface' ? 'open' : 'void');
}

export async function bakeTiles(app: Application, map: MapDef): Promise<Sprite> {
  const bounds = mapIsoBounds(map);
  const offsetX = -bounds.minX;
  const offsetY = -bounds.minY;

  const terrainsUsed = new Set<Terrain>();
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) terrainsUsed.add(terrainOf(map, tx, ty));
  }
  const textures = new Map<Terrain, Texture | null>();
  await Promise.all(
    [...terrainsUsed].map(async (t) => {
      textures.set(t, await loadTerrainTexture(t));
    })
  );

  const container = new Container();
  const outline = new Graphics();

  // Back-to-front by depth (tx+ty), so nearer tiles' art always draws over
  // farther ones' overlap margin.
  const maxDepth = map.width - 1 + (map.height - 1);
  for (let d = 0; d <= maxDepth; d++) {
    for (let ty = Math.max(0, d - (map.width - 1)); ty <= Math.min(d, map.height - 1); ty++) {
      const tx = d - ty;
      const terrain = terrainOf(map, tx, ty);
      const center = toIso({ x: tx + 0.5, y: ty + 0.5 });
      const cx = center.x + offsetX;
      const cy = center.y + offsetY;
      const tex = textures.get(terrain);

      if (tex) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        const k = (TILE_W * FILL_OVERLAP) / (tex.width * Math.SQRT2);
        sprite.rotation = Math.PI / 4;
        sprite.scale.set(k, k * 0.5);
        sprite.x = cx;
        sprite.y = cy;
        container.addChild(sprite);
      } else {
        const g = new Graphics();
        g.poly(tileDiamondPoints(cx, cy, FILL_OVERLAP), true).fill({ color: baseColor(terrain, map.kind) });
        drawDecoration(g, terrain, tx, ty, cx, cy);
        container.addChild(g);
      }
      outline.poly(tileDiamondPoints(cx, cy), true).stroke({ width: 1, color: 0xffffff, alpha: OUTLINE_ALPHA });
    }
  }
  container.addChild(outline);

  const texture = app.renderer.generateTexture(container);
  // texture:false — these are the shared/cached terrain PNGs and per-frame
  // Graphics, not the RenderTexture we just baked; that one's owned by the
  // returned Sprite and is MapScene's responsibility to destroy.
  container.destroy({ children: true, texture: false });

  const sprite = new Sprite(texture);
  sprite.label = 'tile-layer';
  sprite.x = bounds.minX;
  sprite.y = bounds.minY;
  return sprite;
}

/** Cheap per-terrain speckle, drawn only when no hand-authored texture exists for this terrain. Kept inside the tile's diamond footprint. */
function drawDecoration(g: Graphics, terrain: Terrain, tx: number, ty: number, cx: number, cy: number): void {
  const insetX = TILE_W * 0.28;
  const insetY = TILE_H * 0.28;
  switch (terrain) {
    case 'forest': {
      const n = 3 + Math.floor(hash01(tx, ty, 1) * 3);
      for (let i = 0; i < n; i++) {
        const rx = cx + (hash01(tx, ty, i * 7 + 2) * 2 - 1) * insetX;
        const ry = cy + (hash01(tx, ty, i * 7 + 3) * 2 - 1) * insetY;
        g.circle(rx, ry, 2.5).fill({ color: 0x1c3a1f, alpha: 0.9 });
      }
      break;
    }
    case 'urban': {
      for (let i = 0; i < 3; i++) {
        const bw = 6 + hash01(tx, ty, i * 3 + 1) * 7;
        const bh = 4 + hash01(tx, ty, i * 3 + 2) * 4;
        const bx = cx + (hash01(tx, ty, i * 3 + 3) * 2 - 1) * insetX - bw / 2;
        const by = cy + (hash01(tx, ty, i * 3 + 4) * 2 - 1) * insetY - bh / 2;
        g.rect(bx, by, bw, bh).fill({ color: 0x36363d, alpha: 0.8 });
      }
      break;
    }
    case 'mountain': {
      for (let i = -1; i <= 1; i++) {
        const px = cx + i * (insetX * 0.7);
        g.moveTo(px - 6, cy + insetY * 0.7).lineTo(px, cy - insetY * 0.7).lineTo(px + 6, cy + insetY * 0.7);
      }
      g.stroke({ width: 1.5, color: 0x3d372c, alpha: 0.6 });
      break;
    }
    case 'water': {
      for (let i = -1; i <= 1; i++) {
        const wy = cy + i * (insetY * 0.55);
        g.moveTo(cx - insetX, wy).quadraticCurveTo(cx, wy - 3, cx + insetX, wy);
      }
      g.stroke({ width: 1.5, color: 0x5c86a8, alpha: 0.5 });
      break;
    }
    case 'void': {
      const speckChance = hash01(tx, ty, 9);
      const speckCount = speckChance < 0.35 ? 1 + Math.floor(hash01(tx, ty, 10) * 2) : 0;
      for (let i = 0; i < speckCount; i++) {
        const sx = cx + (hash01(tx, ty, 20 + i) * 2 - 1) * insetX;
        const sy = cy + (hash01(tx, ty, 30 + i) * 2 - 1) * insetY;
        const a = 0.5 + hash01(tx, ty, 40 + i) * 0.4;
        g.circle(sx, sy, 0.8).fill({ color: 0xffffff, alpha: a });
      }
      break;
    }
    case 'debris': {
      for (let i = 0; i < 2; i++) {
        const dcx = cx + (hash01(tx, ty, i * 5 + 1) * 2 - 1) * insetX;
        const dcy = cy + (hash01(tx, ty, i * 5 + 2) * 2 - 1) * insetY;
        const s = 4 + hash01(tx, ty, i * 5 + 3) * 4;
        g.poly([dcx - s, dcy + s * 0.4, dcx - s * 0.2, dcy - s, dcx + s, dcy - s * 0.2, dcx + s * 0.3, dcy + s], true).fill({
          color: 0x4a4e5c,
          alpha: 0.7,
        });
      }
      break;
    }
    case 'radiation': {
      for (let i = -1; i < 2; i++) {
        g.moveTo(cx - insetX, cy + i * 6).lineTo(cx + insetX, cy - insetY * 0.6 + i * 6);
      }
      g.stroke({ width: 1, color: 0xaa3344, alpha: 0.25 });
      break;
    }
    case 'gravity': {
      g.ellipse(cx, cy, insetX * 0.5, insetY * 0.5).stroke({ width: 1, color: 0x5f7bb0, alpha: 0.35 });
      g.ellipse(cx, cy, insetX * 0.85, insetY * 0.85).stroke({ width: 1, color: 0x5f7bb0, alpha: 0.25 });
      g.ellipse(cx, cy, insetX * 1.2, insetY * 1.2).stroke({ width: 1, color: 0x5f7bb0, alpha: 0.15 });
      break;
    }
    case 'structure': {
      g.moveTo(cx - insetX, cy - insetY * 0.5).lineTo(cx + insetX, cy + insetY * 0.5);
      g.moveTo(cx + insetX, cy - insetY * 0.5).lineTo(cx - insetX, cy + insetY * 0.5);
      g.stroke({ width: 1.5, color: 0x5a6478, alpha: 0.4 });
      break;
    }
    default:
      break;
  }
}
