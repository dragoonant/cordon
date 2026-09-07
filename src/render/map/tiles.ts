/**
 * Bakes the static terrain layer once per `load()` — SRW-style ground.
 *
 * Replaces the old "per-terrain-kind masked TilingSprite of a tileable
 * texture" technique (skewed rotated rectangles that read as "long
 * rectangle" patches, per user feedback) with the look of Super Robot Wars'
 * overworld: ONE calm painted ground image per map, projected flat onto the
 * map's iso diamond, a crisp thin grid of tile diamonds over the whole
 * field, and translucent per-tile diamond TINTS (not textures) wherever a
 * tile's terrain differs from the map's dominant terrain. Impassable
 * ('blocked') and space-station ('structure') tiles are NOT baked here at
 * all — they're rendered as simple raised cube/block sprites by
 * `cubes.ts`, added as live entities so squads depth-sort against them.
 *
 * Pipeline, in `bakeTiles`:
 *   1. `buildPlateLayer` — picks one published `plate_<key>.png` (see
 *      `choosePlateKey`) deterministically from the map (space maps hash to
 *      one of two space plates; surface maps use the DOMINANT non-blocked
 *      terrain to pick plains/forest/city/ocean/shore), and draws it as a
 *      square Sprite rotated 45° with `scale.y` halved so it exactly covers
 *      the map's projected diamond (a square rotated 45° and squashed to
 *      half height on Y is precisely a 2:1 iso diamond — this game's
 *      TILE_W:TILE_H ratio), masked (hard edge, no blur — the plate's own
 *      outline IS the map's outline) to the map's outer diamond polygon.
 *      Missing art falls back to a flat two-tone radial-ish blend (a few
 *      concentric ellipses, same trick `weather.ts` uses for its nebula)
 *      in colors keyed off the same plate choice.
 *   2. `buildTintLayers` — for every terrain kind that (a) actually appears
 *      on the map, (b) isn't the map's dominant terrain, and (c) isn't
 *      'blocked'/'structure' (those are cubes, never tinted), builds ONE
 *      blurred union mask of that kind's tile diamonds (same
 *      inflate-then-blur trick the old per-kind TilingSprite fill used —
 *      see `buildKindMask`) and fills it with a flat translucent color.
 *      Because the mask is one blurred union (not per-tile fills stacked on
 *      each other), same-kind neighbours show no internal seam and
 *      different-kind boundaries cross-fade softly instead of a hard cut.
 *   3. `drawGrid` — one Graphics holding every tile-diamond boundary line as
 *      a single non-overlapping line per grid index (not a per-tile
 *      diamond stroke, which would double-stroke every shared edge), thin
 *      and pale, with every 4th line brighter — the SRW "major gridline"
 *      look.
 *   4. Bake plate + tints + grid into one `RenderTexture` via
 *      `renderer.generateTexture`, exactly like the old bake — so
 *      `MapScene` keeps destroying/replacing this sprite's texture on
 *      switch precisely as before. The cubes (`cubes.ts`) are a *separate*
 *      live object MapScene adds to `entitiesLayer`, not part of this bake.
 */
import { Application, Assets, BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { MapDef, Terrain } from '@sim/types';
import { probeFirstExisting } from '@render/sprites/assetProbe';
import { TILE_W, TILE_H } from './constants';
import { stringHash, hash01 } from './hash';
import { mapIsoBounds, toIso } from './iso';

// ---------------------------------------------------------------------------
// Terrain -> flat translucent tint (everything EXCEPT the map's dominant
// terrain gets tinted; 'open'/'void' are the common "this IS the plate"
// base kinds so they're deliberately absent here; 'blocked'/'structure' are
// raised cubes, never a flat tint — see cubes.ts).
// ---------------------------------------------------------------------------
const FLAT_TINTS: Partial<Record<Terrain, { color: number; alpha: number }>> = {
  forest: { color: 0x3f7a3a, alpha: 0.28 },
  urban: { color: 0x6c7a8c, alpha: 0.3 },
  mountain: { color: 0x8a7a66, alpha: 0.32 },
  water: { color: 0x2a5a8c, alpha: 0.35 },
  debris: { color: 0x7a7a7a, alpha: 0.22 },
  radiation: { color: 0xb04a7a, alpha: 0.28 },
  gravity: { color: 0x4a5ab0, alpha: 0.25 },
};

export function terrainOf(map: MapDef, tx: number, ty: number): Terrain {
  return map.tiles[ty]?.[tx] ?? (map.kind === 'surface' ? 'open' : 'void');
}

/** Every terrain kind actually present on the map (excluding 'blocked' — cubes, never a ground kind for dominance purposes). */
function countTerrain(map: MapDef): Map<Terrain, number> {
  const counts = new Map<Terrain, number>();
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const t = terrainOf(map, tx, ty);
      if (t === 'blocked') continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

/** The most common non-blocked terrain on the map — used both to pick the ground plate and to decide which kind is left untinted. Exported for tests. */
export function dominantTerrain(map: MapDef): Terrain {
  const counts = countTerrain(map);
  let best: Terrain = map.kind === 'surface' ? 'open' : 'void';
  let bestCount = -1;
  for (const [t, c] of counts) {
    if (c > bestCount) {
      best = t;
      bestCount = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ground plate selection + art
// ---------------------------------------------------------------------------

const PLATE_KEYS = [
  'plate_space_a',
  'plate_space_b',
  'plate_ocean',
  'plate_shore',
  'plate_plains',
  'plate_forest',
  'plate_city',
  'plate_ice',
] as const;
export type PlateKey = (typeof PLATE_KEYS)[number];

/** [outer, inner] two-tone fallback colors per plate, used only while `plate_<key>.png` isn't published yet — see `buildPlateLayer`. */
const PLATE_FALLBACK: Record<PlateKey, [number, number]> = {
  plate_space_a: [0x05060c, 0x141c30],
  plate_space_b: [0x07060c, 0x1d1030],
  plate_ocean: [0x0a2436, 0x1c4a63],
  plate_shore: [0x123246, 0x2f6f7f],
  plate_plains: [0x362f22, 0x54502f],
  plate_forest: [0x142a1c, 0x223a26],
  plate_city: [0x22262c, 0x363c46],
  plate_ice: [0x93aab8, 0xdcf0f7],
};

/**
 * Deterministic per-map plate choice. Space maps alternate between the two
 * space plates by `hash(map.id)`; surface maps use the map's dominant
 * terrain (mountain has no plate of its own — it reads close enough to
 * plains at this zoom — per spec). Maps whose id names ice/frost/glacier
 * get the ice plate regardless of terrain (no 'ice' Terrain kind exists to
 * derive this from otherwise).
 */
export function choosePlateKey(map: MapDef): PlateKey {
  if (/ice|frost|glacier/i.test(map.id)) return 'plate_ice';
  if (map.kind === 'space') {
    return hash01(stringHash(map.id), 1, 97) < 0.5 ? 'plate_space_a' : 'plate_space_b';
  }
  const dominant = dominantTerrain(map);
  if (dominant === 'forest') return 'plate_forest';
  if (dominant === 'urban') return 'plate_city';
  if (dominant === 'water') {
    const counts = countTerrain(map);
    const total = map.width * map.height;
    const waterCount = counts.get('water') ?? 0;
    return waterCount / Math.max(1, total) > 0.85 ? 'plate_ocean' : 'plate_shore';
  }
  return 'plate_plains'; // open, mountain, and any other surface fallback
}

const plateTextureCache = new Map<string, Promise<Texture | null>>();
function loadPlateTexture(key: PlateKey): Promise<Texture | null> {
  let cached = plateTextureCache.get(key);
  if (cached) return cached;
  cached = (async () => {
    const url = await probeFirstExisting(`/sprites/map/${key}`, ['png', 'jpg']);
    if (!url) return null;
    try {
      return await Assets.load<Texture>(url);
    } catch {
      return null;
    }
  })();
  plateTextureCache.set(key, cached);
  return cached;
}

/** The map's outer diamond corners (grid corners, not tile centers), in bake-local space (offset already applied). */
function mapDiamondCornerPoints(map: MapDef, offsetX: number, offsetY: number): { x: number; y: number }[] {
  return [
    toIso({ x: 0, y: 0 }),
    toIso({ x: map.width, y: 0 }),
    toIso({ x: map.width, y: map.height }),
    toIso({ x: 0, y: map.height }),
  ].map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
}

/**
 * Renders `points` (a closed polygon) to a `boundsW`x`boundsH` RenderTexture
 * and wraps it in a non-renderable Sprite for use as a `.mask` — the same
 * technique `buildKindMask` (below) uses for the per-terrain tint masks,
 * just without the blur (the plate's own diamond edge should be crisp, not
 * soft). A plain `Graphics` object set directly as `.mask` looked right at
 * a glance but rendered as an effective no-op in testing: Pixi v8's stencil
 * masking needs the mask object to actually take part in a render pass, and
 * `renderable = false` (needed so the mask shape itself doesn't also draw
 * as ordinary content) skips that — a RenderTexture-backed Sprite mask
 * doesn't have that problem (the render happened already, at bake time,
 * producing a plain alpha texture the mask filter just samples), which is
 * exactly what every other mask in this file already relies on.
 */
function buildHardMask(
  app: Application,
  points: number[],
  boundsW: number,
  boundsH: number
): { maskSprite: Sprite; maskTexture: Texture } {
  const gfx = new Graphics();
  gfx.poly(points, true).fill({ color: 0xffffff });
  const maskTexture = app.renderer.generateTexture({ target: gfx, frame: new Rectangle(0, 0, boundsW, boundsH) });
  gfx.destroy({ children: true, texture: false });
  const maskSprite = new Sprite(maskTexture);
  maskSprite.renderable = false;
  return { maskSprite, maskTexture };
}

/**
 * Builds the ground-plate layer: one painted image (or fallback gradient)
 * projected onto the map's iso diamond. See this file's header for the
 * rotate-45°-then-halve-Y trick. Returned container's children are already
 * final content, ready to sit at the bottom of the bake; `maskTexture` is
 * the caller's to free once the whole scene is baked (see `bakeTiles`).
 */
async function buildPlateLayer(
  app: Application,
  map: MapDef,
  offsetX: number,
  offsetY: number,
  boundsW: number,
  boundsH: number
): Promise<{ container: Container; maskTexture: Texture; maskedObject: Container | Graphics }> {
  const key = choosePlateKey(map);
  const corners = mapDiamondCornerPoints(map, offsetX, offsetY);
  const cx = (corners[0].x + corners[2].x) / 2;
  const cy = (corners[0].y + corners[2].y) / 2;

  const { maskSprite: maskG, maskTexture } = buildHardMask(app, corners.flatMap((p) => [p.x, p.y]), boundsW, boundsH);

  const container = new Container();
  const tex = await loadPlateTexture(key);
  let maskedObject: Container | Graphics;

  if (tex) {
    // A square rotated 45° has a diamond bounding box of side*SQRT2 on each
    // axis; squashing Y by 0.5 turns that square diamond into our 2:1 iso
    // diamond exactly (TILE_W === 2*TILE_H), so sizing off the map diamond's
    // WIDTH alone is enough — the height falls out correctly for free.
    //
    // Order matters here: Pixi composes one object's own transform as
    // scale-THEN-rotate (never rotate-then-scale), so a non-uniform
    // scale.set(s, s*0.5) followed by rotation=45° on the SAME sprite
    // rotates an already-squashed RECTANGLE — a lopsided parallelogram, not
    // a symmetric diamond. To get rotate-then-squash, the two steps have to
    // live on two different objects: an inner sprite that's scaled
    // UNIFORMLY (a true square) and rotated 45° (producing a proper
    // symmetric diamond), wrapped in an outer container whose OWN
    // scale.y = 0.5 squashes that already-rotated diamond afterward.
    const mapDiamondW = (map.width + map.height) * (TILE_W / 2);
    const side = mapDiamondW / Math.SQRT2;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    const scale = side / tex.width; // plates are published square (1024x1024)
    sprite.scale.set(scale, scale);
    sprite.rotation = Math.PI / 4;
    const diamond = new Container();
    diamond.addChild(sprite);
    diamond.scale.set(1, 0.5);
    diamond.x = cx;
    diamond.y = cy;
    diamond.mask = maskG;
    maskedObject = diamond;
    container.addChild(diamond, maskG);
  } else {
    const [outer, inner] = PLATE_FALLBACK[key];
    const fill = new Graphics();
    fill.poly(corners.flatMap((p) => [p.x, p.y]), true).fill({ color: outer });
    const blend = new Graphics();
    const mapDiamondW = (map.width + map.height) * (TILE_W / 2);
    const maxR = mapDiamondW * 0.55;
    const steps = 6;
    for (let i = steps; i >= 1; i--) {
      const f = i / steps;
      blend.ellipse(cx, cy, maxR * f, maxR * f * 0.5).fill({ color: inner, alpha: 0.1 });
    }
    blend.mask = maskG;
    maskedObject = blend;
    container.addChild(fill, blend, maskG);
  }
  return { container, maskTexture, maskedObject };
}

// ---------------------------------------------------------------------------
// Per-kind tint masks — same inflate+blur union-mask trick the old
// TilingSprite-atlas bake used to soften kind-vs-kind boundaries, just
// filling a flat translucent color instead of a tiled texture.
// ---------------------------------------------------------------------------

const MASK_DIAMOND_PAD_X = 1.5;
const MASK_DIAMOND_PAD_Y = MASK_DIAMOND_PAD_X * (TILE_H / TILE_W);
const MASK_BLUR_PX = 3;

function inflatedDiamondPoints(cx: number, cy: number): number[] {
  const hw = TILE_W / 2 + MASK_DIAMOND_PAD_X;
  const hh = TILE_H / 2 + MASK_DIAMOND_PAD_Y;
  return [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy];
}

interface TileCoord {
  tx: number;
  ty: number;
}

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
  maskSprite.renderable = false;
  return { maskSprite, maskTexture };
}

/** See `freeMaskTextures` in the old tiles.ts (destroying a mask RenderTexture synchronously right after `generateTexture` races the renderer's bind-group bookkeeping) — same fix, `ticker.addOnce`. */
function freeMaskTextures(app: Application, textures: Texture[]): void {
  if (textures.length === 0) return;
  app.ticker.addOnce(() => {
    for (const t of textures) t.destroy(true);
  });
}

function buildTintLayers(
  app: Application,
  map: MapDef,
  offsetX: number,
  offsetY: number,
  boundsW: number,
  boundsH: number
): { container: Container; maskedFills: Graphics[]; maskTexturesToFree: Texture[] } {
  const dominant = dominantTerrain(map);
  const tilesByTerrain = new Map<Terrain, TileCoord[]>();
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const terrain = terrainOf(map, tx, ty);
      if (terrain === dominant || terrain === 'blocked' || terrain === 'structure') continue;
      const tint = FLAT_TINTS[terrain];
      if (!tint) continue;
      let list = tilesByTerrain.get(terrain);
      if (!list) tilesByTerrain.set(terrain, (list = []));
      list.push({ tx, ty });
    }
  }

  const container = new Container();
  const maskedFills: Graphics[] = [];
  const maskTexturesToFree: Texture[] = [];

  for (const [terrain, tiles] of tilesByTerrain) {
    const tint = FLAT_TINTS[terrain]!;
    const { maskSprite, maskTexture } = buildKindMask(app, tiles, offsetX, offsetY, boundsW, boundsH);
    maskTexturesToFree.push(maskTexture);
    const fill = new Graphics();
    fill.rect(0, 0, boundsW, boundsH).fill({ color: tint.color, alpha: tint.alpha });
    fill.mask = maskSprite;
    maskedFills.push(fill);
    container.addChild(maskSprite, fill);
  }

  return { container, maskedFills, maskTexturesToFree };
}

// ---------------------------------------------------------------------------
// Grid — one line per grid index (not one stroke per tile diamond, which
// would double-stroke every internal shared edge), every 4th line brighter.
// ---------------------------------------------------------------------------

const GRID_COLOR = 0xd8f0ff;
const GRID_MINOR_ALPHA_SPACE = 0.22;
const GRID_MINOR_ALPHA_SURFACE = 0.18;
const GRID_MAJOR_ALPHA = 0.34;
const GRID_MAJOR_EVERY = 4;

function drawGrid(map: MapDef, offsetX: number, offsetY: number): Graphics {
  const g = new Graphics();
  const minorAlpha = map.kind === 'space' ? GRID_MINOR_ALPHA_SPACE : GRID_MINOR_ALPHA_SURFACE;

  const colLine = (i: number): [{ x: number; y: number }, { x: number; y: number }] => {
    const a = toIso({ x: i, y: 0 });
    const b = toIso({ x: i, y: map.height });
    return [
      { x: a.x + offsetX, y: a.y + offsetY },
      { x: b.x + offsetX, y: b.y + offsetY },
    ];
  };
  const rowLine = (j: number): [{ x: number; y: number }, { x: number; y: number }] => {
    const a = toIso({ x: 0, y: j });
    const b = toIso({ x: map.width, y: j });
    return [
      { x: a.x + offsetX, y: a.y + offsetY },
      { x: b.x + offsetX, y: b.y + offsetY },
    ];
  };

  // Minor lines first, majors drawn after (and brighter) so they read on top.
  for (let i = 0; i <= map.width; i++) {
    if (i % GRID_MAJOR_EVERY === 0) continue;
    const [a, b] = colLine(i);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: GRID_COLOR, alpha: minorAlpha });
  }
  for (let j = 0; j <= map.height; j++) {
    if (j % GRID_MAJOR_EVERY === 0) continue;
    const [a, b] = rowLine(j);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: GRID_COLOR, alpha: minorAlpha });
  }
  for (let i = 0; i <= map.width; i += GRID_MAJOR_EVERY) {
    const [a, b] = colLine(i);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: GRID_COLOR, alpha: GRID_MAJOR_ALPHA });
  }
  for (let j = 0; j <= map.height; j += GRID_MAJOR_EVERY) {
    const [a, b] = rowLine(j);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: GRID_COLOR, alpha: GRID_MAJOR_ALPHA });
  }
  return g;
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------

/**
 * Largest baked-tile texture edge we will ask the GPU for, in device pixels.
 * WebGL implementations commonly cap at 4096; staying under it keeps a
 * margin for drivers that report less.
 */
const MAX_BAKE_DIMENSION = 4000;

export async function bakeTiles(app: Application, map: MapDef): Promise<Sprite> {
  const bounds = mapIsoBounds(map);
  const offsetX = -bounds.minX;
  const offsetY = -bounds.minY;
  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxY - bounds.minY;

  const [plateResult, tintResult] = await Promise.all([
    buildPlateLayer(app, map, offsetX, offsetY, boundsW, boundsH),
    Promise.resolve(buildTintLayers(app, map, offsetX, offsetY, boundsW, boundsH)),
  ]);

  const container = new Container();
  container.addChild(plateResult.container, tintResult.container, drawGrid(map, offsetX, offsetY));

  // The baked plate is one texture covering the whole iso diamond, and
  // generateTexture multiplies by the renderer resolution — so on a HiDPI
  // display a large map silently blows past the GPU's max texture size and
  // bakes to nothing. (A 40x26 map is 3168x1584 CSS px; at resolution 2 that
  // is 6336x3168, over the common 4096 limit, and the map rendered black.)
  // Clamp the bake resolution to fit the budget; big maps lose a little
  // crispness rather than disappearing.
  const maxDim = Math.max(boundsW, boundsH);
  const resolution = Math.max(0.5, Math.min(app.renderer.resolution, MAX_BAKE_DIMENSION / Math.max(1, maxDim)));
  const texture = app.renderer.generateTexture({ target: container, resolution });
  // Clear masks via the runtime setter before destroying anything, same
  // "avoid stale GPU bind-group" reasoning as the old bake.
  plateResult.maskedObject.mask = null;
  for (const fill of tintResult.maskedFills) fill.mask = null;
  container.destroy({ children: true, texture: false });
  freeMaskTextures(app, [plateResult.maskTexture, ...tintResult.maskTexturesToFree]);

  const sprite = new Sprite(texture);
  sprite.label = 'tile-layer';
  sprite.x = bounds.minX;
  sprite.y = bounds.minY;
  return sprite;
}
