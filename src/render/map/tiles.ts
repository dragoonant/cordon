/**
 * Bakes the static terrain layer once per `load()`.
 *
 * Unlike a naive "one rotated sprite per tile diamond" renderer (which always
 * shows a faint diamond seam at every tile boundary, textured or not), this
 * bakes ONE continuous fill per terrain KIND present on the map:
 *
 *   1. For each kind, build a single Graphics union of every one of that
 *      kind's tile diamonds (each inflated ~1.5px so same-kind neighbours
 *      fuse into one shape with no internal seam), blur it, and render it to
 *      a texture — that's the kind's mask (see `buildKindMask`).
 *   2. Fill that mask with either a `terrain_<kind>.png` texture repeated as
 *      one continuous `TilingSprite` (rotated 45° so its grid lines up with
 *      the iso diamond grid, scaled to a ~2-tile repeat, and given a
 *      per-map/per-kind random offset so the texture's own imperfections
 *      don't read as an obvious repeat) or, when that art is missing, a flat
 *      `baseColor` fill — same fallback contract as before.
 *   3. Layer every kind (fixed order, `blocked` last) into one container.
 *      Because each layer is a blurred *alpha* mask, adjacent kinds
 *      cross-fade at their true boundary instead of hard-cutting — that's
 *      the whole "soften the boundary" effect — while two tiles of the SAME
 *      kind show no seam at all, because they're one continuous fill under
 *      one continuous (fused) mask.
 *
 * The result is flattened via `renderer.generateTexture` into a single
 * Sprite exactly as before, so per-frame rendering never re-touches terrain
 * geometry. The per-kind mask RenderTextures are intermediate GPU resources
 * created fresh every bake — they are NOT the shared/cached terrain PNGs, so
 * this module destroys them itself once the final bake is done (see the
 * `maskTexturesToFree` cleanup at the end of `bakeTiles`).
 *
 * The returned Sprite wraps a `RenderTexture`, a GPU resource tied to this
 * app's renderer — `MapScene` is responsible for destroying it (texture:
 * true) when the map is torn down or swapped, unlike the shared canvas-baked
 * textures in `src/render/sprites`.
 */
import {
  Assets,
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TilingSprite,
  type Application,
} from 'pixi.js';
import type { MapDef, MapKind, Terrain } from '@sim/types';
import { probeFirstExisting } from '@render/sprites/assetProbe';
import { TILE_H, TILE_W } from './constants';
import { hash01, stringHash } from './hash';
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

/** Fixed draw order (surface kinds, then space kinds, `blocked` always last so its mask/outline wins at any boundary). Matches the `Terrain` union order in src/sim/types.ts. */
const TERRAIN_DRAW_ORDER: Terrain[] = [
  'open',
  'forest',
  'urban',
  'mountain',
  'water',
  'void',
  'debris',
  'radiation',
  'gravity',
  'structure',
  'blocked',
];

/** Absolute px each tile diamond is inflated by before union-fill, so same-kind neighbours fuse with no seam (their overlapping anti-aliased edges land on solid interior, not on each other). Padded proportionally (TILE_H/TILE_W) so the inflate reads as isotropic on the iso ground plane, not stretched. */
const MASK_DIAMOND_PAD_X = 1.5;
const MASK_DIAMOND_PAD_Y = MASK_DIAMOND_PAD_X * (TILE_H / TILE_W);

/** Gaussian blur strength (px) applied to each kind's union mask — this is what turns a hard kind-vs-kind boundary into a soft cross-fade. */
const MASK_BLUR_PX = 3;

/** How many tiles wide one repeat of the terrain texture should read as, once rotated onto the iso grid — bigger than 1 so the art's own non-seamless edges are far apart and less noticeable. */
const TERRAIN_REPEAT_TILES = 2;

const OUTLINE_ALPHA = 0.05;

function inflatedDiamondPoints(cx: number, cy: number): number[] {
  const hw = TILE_W / 2 + MASK_DIAMOND_PAD_X;
  const hh = TILE_H / 2 + MASK_DIAMOND_PAD_Y;
  return [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy];
}

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

interface TileCoord {
  tx: number;
  ty: number;
}

/**
 * Renders `tiles`' inflated, blurred diamond union to a texture the size of
 * the whole map (so it lines up 1:1, at local (0,0), with everything else
 * baked in `bakeTiles`) and wraps it in a non-rendering Sprite for use as an
 * alpha mask. Caller owns the returned texture and must destroy it (it's a
 * fresh RenderTexture, not a shared asset).
 */
function buildKindMask(
  app: Application,
  tiles: TileCoord[],
  offsetX: number,
  offsetY: number,
  boundsW: number,
  boundsH: number
): { maskSprite: Sprite; maskTexture: Texture } {
  const gfx = new Graphics();
  for (const { tx, ty } of tiles) {
    const center = toIso({ x: tx + 0.5, y: ty + 0.5 });
    gfx.poly(inflatedDiamondPoints(center.x + offsetX, center.y + offsetY), true).fill({ color: 0xffffff });
  }
  gfx.filters = [new BlurFilter({ strength: MASK_BLUR_PX, quality: 3 })];
  const maskTexture = app.renderer.generateTexture({ target: gfx, frame: new Rectangle(0, 0, boundsW, boundsH) });
  gfx.destroy({ children: true, texture: false });

  const maskSprite = new Sprite(maskTexture);
  // Used purely as a mask, never drawn as ordinary content.
  maskSprite.renderable = false;
  return { maskSprite, maskTexture };
}

/**
 * Destroying a RenderTexture that was just used as a mask within the same
 * synchronous `generateTexture()` call races the renderer's internal
 * bind-group bookkeeping (observed as a harmless-but-noisy PixiJS console
 * warning: "'textureSource'/'textureSampler' was destroyed while still bound
 * to a shader") — that bookkeeping isn't cleared until the renderer actually
 * renders another frame, so a plain `requestAnimationFrame` (which can fire
 * before Pixi's own ticker gets to render) isn't reliably late enough.
 * `app.ticker.addOnce` runs during that next real render tick instead, which
 * is.
 */
function freeMaskTextures(app: Application, textures: Texture[]): void {
  if (textures.length === 0) return;
  app.ticker.addOnce(() => {
    for (const t of textures) t.destroy(true);
  });
}

export async function bakeTiles(app: Application, map: MapDef): Promise<Sprite> {
  const bounds = mapIsoBounds(map);
  const offsetX = -bounds.minX;
  const offsetY = -bounds.minY;
  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxY - bounds.minY;

  const tilesByTerrain = new Map<Terrain, TileCoord[]>();
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const terrain = terrainOf(map, tx, ty);
      let list = tilesByTerrain.get(terrain);
      if (!list) tilesByTerrain.set(terrain, (list = []));
      list.push({ tx, ty });
    }
  }

  const textures = new Map<Terrain, Texture | null>();
  await Promise.all(
    [...tilesByTerrain.keys()].map(async (t) => {
      textures.set(t, await loadTerrainTexture(t));
    })
  );

  const container = new Container();
  const maskTexturesToFree: Texture[] = [];
  const maskedFills: (TilingSprite | Graphics)[] = [];
  const mapSeed = stringHash(map.id);

  for (const terrain of TERRAIN_DRAW_ORDER) {
    const tiles = tilesByTerrain.get(terrain);
    if (!tiles || tiles.length === 0) continue;

    const { maskSprite, maskTexture } = buildKindMask(app, tiles, offsetX, offsetY, boundsW, boundsH);
    maskTexturesToFree.push(maskTexture);

    const tex = textures.get(terrain) ?? null;
    let fill: TilingSprite | Graphics;
    if (tex) {
      const ts = new TilingSprite({ texture: tex, width: boundsW, height: boundsH });
      const k = (TILE_W * TERRAIN_REPEAT_TILES) / (tex.width * Math.SQRT2);
      ts.tileScale.set(k, k * 0.5);
      ts.tileRotation = Math.PI / 4;
      // Deterministic per-map/per-kind offset so the texture's own repeat (it isn't perfectly
      // seamless) lands somewhere different on every map instead of always the same spot.
      const seed = stringHash(terrain);
      ts.tilePosition.set(
        (hash01(mapSeed, seed, 11) - 0.5) * tex.width,
        (hash01(mapSeed, seed, 22) - 0.5) * tex.width
      );
      fill = ts;
    } else {
      const g = new Graphics();
      g.rect(0, 0, boundsW, boundsH).fill({ color: baseColor(terrain, map.kind) });
      fill = g;
    }
    fill.mask = maskSprite;
    maskedFills.push(fill);

    const layer = new Container();
    layer.addChild(maskSprite, fill);
    container.addChild(layer);
  }

  // Impassable tiles get a faint outline (the only per-tile edge drawn anywhere in this bake) —
  // every other terrain boundary is communicated purely by the soft mask cross-fade above.
  const blockedTiles = tilesByTerrain.get('blocked');
  if (blockedTiles && blockedTiles.length > 0) {
    const outline = new Graphics();
    for (const { tx, ty } of blockedTiles) {
      const center = toIso({ x: tx + 0.5, y: ty + 0.5 });
      outline
        .poly(tileDiamondPoints(center.x + offsetX, center.y + offsetY), true)
        .stroke({ width: 1, color: 0xffffff, alpha: OUTLINE_ALPHA });
    }
    container.addChild(outline);
  }

  const texture = app.renderer.generateTexture(container);
  // Clear each fill's `.mask` through the normal runtime setter (not just by
  // destroying the mask Sprite) before tearing anything down — destroying a
  // masked object's mask sprite out from under it, in child-index order,
  // left a stale GPU bind-group entry for the mask's texture (harmless, but
  // noisy: "'textureSource' was destroyed while still bound to a shader").
  for (const fill of maskedFills) fill.mask = null;
  // texture:false — these are the shared/cached terrain PNGs and per-frame
  // Graphics, not the RenderTexture we just baked; that one's owned by the
  // returned Sprite and is MapScene's responsibility to destroy. The
  // intermediate per-kind mask RenderTextures are ours to free, below.
  container.destroy({ children: true, texture: false });
  freeMaskTextures(app, maskTexturesToFree);

  const sprite = new Sprite(texture);
  sprite.label = 'tile-layer';
  sprite.x = bounds.minX;
  sprite.y = bounds.minY;
  return sprite;
}
