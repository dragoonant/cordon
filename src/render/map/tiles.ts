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
 *   2. Fill that mask with either a per-kind *atlas* texture repeated as one
 *      continuous `TilingSprite` (rotated 45° so its grid lines up with the
 *      iso diamond grid, scaled to a ~2-tile repeat, and given a per-map/
 *      per-kind random offset so the art's own imperfections don't read as
 *      an obvious repeat) or, when no art at all is published for that kind,
 *      a flat `baseColor` fill — same fallback contract as before.
 *
 *      The atlas (`buildTerrainAtlas`) is what breaks up an otherwise very
 *      visible same-kind repeat (most noticeably urban's rooftop grid): each
 *      terrain kind can have several textures published (`terrain_<kind>.png`
 *      plus `terrain_<kind>_<n>.png` variants — see tools/art/plan.ts's
 *      `terrainVariants` category), so instead of tiling ONE texture, this
 *      composites a GxG grid of them (G=2 for <=3 textures, else 3) — cells
 *      deterministically shuffled and flipped per (map.id, kind) — into one
 *      combined texture, and *that* combined texture is what gets tiled.
 *      Since the tile scale is still calibrated to a single cell's size, the
 *      combined image's own repeat period becomes G times more tiles than
 *      before: a viewer has to cross G tiles' worth of ground before the
 *      pattern repeats, instead of one texture's width. A kind with only its
 *      base texture published still gets a (smaller) atlas of flipped copies
 *      of that one texture, which is a free win against its own repeat too.
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
 * `maskTexturesToFree` cleanup at the end of `bakeTiles`). The per-(map,kind)
 * *atlas* textures are a different lifetime again — see `buildTerrainAtlas`'s
 * doc comment.
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

// ---------------------------------------------------------------------------
// Terrain variants + per-(map, kind) atlas
//
// tools/art's `terrainVariants` category (see tools/art/plan.ts) publishes
// extra same-kind textures — `terrain_<kind>_<n>.png`, 1-indexed — alongside
// the base `terrain_<kind>.png`. This section discovers whatever variants
// exist for a kind, then composites the base + all its variants into one
// shuffled/flipped atlas per (map.id, kind) — see `buildTerrainAtlas`.
// ---------------------------------------------------------------------------

interface MapManifestImage {
  key: string;
  kind: string;
  path: string;
  variant?: number;
}

/**
 * `public/sprites/map/manifest.json` is rebuilt from disk by
 * `tools/art/generate.ts` every time terrain/terrain-variants/objects/decor
 * art is published (see `buildMapManifestFromDisk`) — fetched once and cached
 * for the process lifetime, same rationale as `terrainTextureCache`. Resolves
 * to null (never rejects) if the manifest can't be fetched/parsed, so callers
 * fall back to probing filenames directly instead.
 */
let mapManifestPromise: Promise<MapManifestImage[] | null> | null = null;
function loadMapManifest(): Promise<MapManifestImage[] | null> {
  mapManifestPromise ??= (async () => {
    try {
      if (typeof fetch !== 'function') return null;
      const res = await fetch('/sprites/map/manifest.json');
      if (!res.ok) return null;
      const data = (await res.json()) as { images?: MapManifestImage[] };
      return Array.isArray(data.images) ? data.images : null;
    } catch {
      return null;
    }
  })();
  return mapManifestPromise;
}

/** No terrain kind is planned to ever have more variants than this — bounds the filename-probing fallback below. */
const MAX_VARIANT_PROBE = 12;

/** `terrain_<kind>_<n>` keys for `terrain`, in `n` order, discovered via the manifest (preferred) or by probing sequential filenames until one is missing (fallback — e.g. a dev server with a stale/no manifest). */
async function terrainVariantKeys(terrain: Terrain): Promise<string[]> {
  const manifest = await loadMapManifest();
  if (manifest) {
    return manifest
      .filter(
        (img): img is MapManifestImage & { variant: number } =>
          img.kind === 'terrain' && typeof img.variant === 'number' && img.key === `terrain_${terrain}_${img.variant}`
      )
      .sort((a, b) => a.variant - b.variant)
      .map((img) => img.key);
  }
  const keys: string[] = [];
  for (let n = 1; n <= MAX_VARIANT_PROBE; n++) {
    const key = `terrain_${terrain}_${n}`;
    const url = await probeFirstExisting(`/sprites/map/${key}`, ['png']);
    if (!url) break;
    keys.push(key);
  }
  return keys;
}

/** Base texture (if any) plus every published variant texture for `terrain`, in stable order (base first, then variants by `n`). Cached per terrain for the process lifetime — texture *assets* are shared across maps; only their per-map atlas arrangement (below) differs. */
const terrainTextureSetCache = new Map<Terrain, Promise<Texture[]>>();
function loadTerrainTextureSet(terrain: Terrain): Promise<Texture[]> {
  let cached = terrainTextureSetCache.get(terrain);
  if (cached) return cached;
  cached = (async () => {
    const [base, variantKeys] = await Promise.all([loadTerrainTexture(terrain), terrainVariantKeys(terrain)]);
    const variantTextures = await Promise.all(
      variantKeys.map(async (key) => {
        try {
          return await Assets.load<Texture>(`/sprites/map/${key}.png`);
        } catch {
          return null;
        }
      })
    );
    return [base, ...variantTextures].filter((t): t is Texture => t !== null);
  })();
  terrainTextureSetCache.set(terrain, cached);
  return cached;
}

/** Every terrain texture (base + variants) is published at this size (tools/art/plan.ts's `buildTerrainPrompt`/`buildTerrainVariantPrompt` both request 512x512) — used as the atlas cell size and as the `TilingSprite` scale calibration, not measured off any individual texture, so the math below stays correct regardless of how many cells an atlas has. */
const ATLAS_CELL_PX = 512;
/** Each atlas cell's source image is drawn this many px oversized on every edge (bleeding into the next cell) so a soft mask (below) can blend the two textures at their shared boundary instead of a hard cut. */
const ATLAS_CELL_FEATHER_PX = 8;
/** Blur strength for a cell's mask — small enough that the fade lands within the ~8px oversize band instead of eating into the cell's own interior. */
const ATLAS_CELL_MASK_BLUR_PX = 4;

/** `<=3` textures atlas as 2x2 (repeating one), more than that as 3x3 (repeating none up to 9). */
function atlasGridSize(textureCount: number): number {
  return textureCount <= 3 ? 2 : 3;
}

/** Deterministic Fisher-Yates shuffle of `[0, count)`, seeded so the same (map, kind) always produces the same order. */
function shuffledIndices(count: number, seed: number, salt: number): number[] {
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(hash01(seed, salt + i, 701) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deterministically assigns a texture index to each of `cellCount` grid
 * cells, repeating textures if there are fewer than `cellCount`, then does a
 * best-effort local swap pass so the same texture doesn't land in two
 * orthogonally-adjacent cells when some other cell's assignment can be
 * swapped in without creating its own new collision at the swap site.
 */
function assignCellTextures(textureCount: number, cellCount: number, gridSize: number, seed: number): number[] {
  const cells: number[] = [];
  let batch = 0;
  while (cells.length < cellCount) {
    for (const idx of shuffledIndices(textureCount, seed, batch * textureCount)) {
      cells.push(idx);
      if (cells.length >= cellCount) break;
    }
    batch++;
  }
  if (textureCount > 1) {
    for (let i = 0; i < cellCount; i++) {
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      const neighbors = [
        col > 0 ? i - 1 : -1,
        col < gridSize - 1 ? i + 1 : -1,
        row > 0 ? i - gridSize : -1,
        row < gridSize - 1 ? i + gridSize : -1,
      ].filter((n) => n >= 0);
      if (neighbors.some((n) => cells[n] === cells[i])) {
        const swapWith = cells.findIndex((v, j) => j > i && v !== cells[i] && !neighbors.includes(j));
        if (swapWith >= 0) {
          [cells[i], cells[swapWith]] = [cells[swapWith], cells[i]];
        }
      }
    }
  }
  return cells;
}

/** Deterministic per-cell horizontal/vertical flip, seeded so the same (map, kind) always flips the same way. */
function cellFlip(seed: number, cellIndex: number): { flipX: boolean; flipY: boolean } {
  return {
    flipX: hash01(seed, cellIndex, 811) < 0.5,
    flipY: hash01(seed, cellIndex, 822) < 0.5,
  };
}

/** key -> atlas texture, so re-baking the SAME map (e.g. re-entering it) reuses the atlas instead of rebuilding it. Cleared per-map by `purgeAtlasesForOtherMaps` and entirely by `destroyTerrainAtlases`. */
const atlasCache = new Map<string, Promise<Texture | null>>();
/** The map.id the cache above currently holds entries for — any entry for a *different* map is stale (that map isn't showing) and gets freed the next time `bakeTiles` runs for a new map. */
let atlasCacheMapId: string | null = null;

function atlasCacheKey(mapId: string, kind: Terrain): string {
  return `${mapId}::${kind}`;
}

/**
 * Frees every cached atlas that doesn't belong to `mapId` — called at the top
 * of `bakeTiles`. A no-op while re-baking the same map (the common case: the
 * player re-entering a map they've already visited), so that case never
 * rebuilds atlases it already has. Switching to a genuinely different map
 * frees the outgoing map's atlases immediately rather than letting them pile
 * up — same "destroy on switch" contract as the tile layer's own RenderTexture
 * (see `MapScene.disposeTileSprite`).
 */
function purgeAtlasesForOtherMaps(app: Application, mapId: string): void {
  if (atlasCacheMapId === mapId) return;
  const prefix = `${mapId}::`;
  for (const [key, texturePromise] of atlasCache) {
    if (key.startsWith(prefix)) continue;
    atlasCache.delete(key);
    // Same "destroy on the next real render tick" rationale as `freeMaskTextures` above — an
    // atlas may still be bound as a TilingSprite's texture from the bake that's finishing right
    // now (the outgoing map's last frame), so destroying it synchronously here would race that.
    texturePromise.then((tex) => tex && app.ticker.addOnce(() => tex.destroy(true))).catch(() => {});
  }
  atlasCacheMapId = mapId;
}

/** Frees every cached atlas unconditionally — call from `MapScene.destroy()` so the last map's atlases don't outlive the scene. Safe to call even if no atlas was ever built. */
export function destroyTerrainAtlases(app: Application): void {
  for (const texturePromise of atlasCache.values()) {
    texturePromise.then((tex) => tex && app.ticker.addOnce(() => tex.destroy(true))).catch(() => {});
  }
  atlasCache.clear();
  atlasCacheMapId = null;
}

/**
 * Composites `textures` (a terrain kind's base + variant art) into one GxG
 * grid atlas texture — G=2 for <=3 textures, else 3 (up to 9 cells) — so
 * `bakeTiles` can tile ONE combined image per kind instead of one bare
 * texture, breaking up that kind's own visible repeat (see this file's top
 * doc comment). Cell-to-cell assignment and flip are deterministic per
 * (map.id, kind) via `assignCellTextures`/`cellFlip`, and results are cached
 * under that key (see `atlasCache`) — a second call for the same (map, kind)
 * returns the same texture without re-rendering.
 *
 * Each cell's source image is drawn `ATLAS_CELL_FEATHER_PX` oversized on
 * every edge and masked with a *blurred* (not hard-edged) rect the size of
 * just its own cell — same masking technique as `buildKindMask` above, at
 * cell scale — so the oversized bleed fades out across that blur instead of
 * abutting the neighbouring cell's image with a hard seam.
 *
 * Returns null (no atlas, caller falls back to `baseColor`) when `textures`
 * is empty. The returned texture is a cached/shared resource, same
 * ownership contract as `terrainTextureCache`'s textures — callers must NOT
 * destroy it themselves (see `purgeAtlasesForOtherMaps`/`destroyTerrainAtlases`).
 */
function buildTerrainAtlas(app: Application, mapId: string, kind: Terrain, textures: Texture[]): Promise<Texture | null> {
  if (textures.length === 0) return Promise.resolve(null);
  const cacheKey = atlasCacheKey(mapId, kind);
  const cached = atlasCache.get(cacheKey);
  if (cached) return cached;

  const built = (async () => {
    const gridSize = atlasGridSize(textures.length);
    const cellCount = gridSize * gridSize;
    const atlasPx = gridSize * ATLAS_CELL_PX;
    const seed = stringHash(`${mapId}:${kind}`);
    const cellTexIdx = assignCellTextures(textures.length, cellCount, gridSize, seed);

    const container = new Container();
    const maskTexturesToFree: Texture[] = [];
    const frame = new Rectangle(0, 0, atlasPx, atlasPx);

    for (let cell = 0; cell < cellCount; cell++) {
      const row = Math.floor(cell / gridSize);
      const col = cell % gridSize;
      const cellX = col * ATLAS_CELL_PX;
      const cellY = row * ATLAS_CELL_PX;
      const tex = textures[cellTexIdx[cell]];
      const { flipX, flipY } = cellFlip(seed, cell);

      const size = ATLAS_CELL_PX + ATLAS_CELL_FEATHER_PX * 2;
      const img = new Sprite(tex);
      img.anchor.set(0.5);
      img.width = size;
      img.height = size;
      if (flipX) img.scale.x *= -1;
      if (flipY) img.scale.y *= -1;
      img.x = cellX + ATLAS_CELL_PX / 2;
      img.y = cellY + ATLAS_CELL_PX / 2;

      const maskGfx = new Graphics();
      maskGfx.rect(cellX, cellY, ATLAS_CELL_PX, ATLAS_CELL_PX).fill({ color: 0xffffff });
      maskGfx.filters = [new BlurFilter({ strength: ATLAS_CELL_MASK_BLUR_PX, quality: 3 })];
      const maskTexture = app.renderer.generateTexture({ target: maskGfx, frame });
      maskGfx.destroy({ children: true, texture: false });
      maskTexturesToFree.push(maskTexture);

      const maskSprite = new Sprite(maskTexture);
      maskSprite.renderable = false;
      img.mask = maskSprite;

      container.addChild(maskSprite, img);
    }

    const atlasTexture = app.renderer.generateTexture({ target: container, frame });
    for (const child of container.children) {
      if (child instanceof Sprite) child.mask = null;
    }
    container.destroy({ children: true, texture: false });
    freeMaskTextures(app, maskTexturesToFree);
    return atlasTexture;
  })();

  atlasCache.set(cacheKey, built);
  return built;
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

  // Free any OTHER map's cached atlases before building this map's — a no-op when re-baking the
  // same map.id (see purgeAtlasesForOtherMaps's doc comment).
  purgeAtlasesForOtherMaps(app, map.id);

  const textures = new Map<Terrain, Texture | null>();
  await Promise.all(
    [...tilesByTerrain.keys()].map(async (t) => {
      const textureSet = await loadTerrainTextureSet(t);
      textures.set(t, await buildTerrainAtlas(app, map.id, t, textureSet));
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
      // Calibrated to ATLAS_CELL_PX (one cell/one bare texture's size), NOT tex.width (the whole
      // atlas) — so a GxG atlas naturally repeats every G times more tiles than a single texture
      // would, instead of squeezing the whole grid into the same footprint. See this file's top
      // doc comment ("the combined image's own repeat period becomes G times more tiles").
      const k = (TILE_W * TERRAIN_REPEAT_TILES) / (ATLAS_CELL_PX * Math.SQRT2);
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
