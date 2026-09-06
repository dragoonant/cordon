/**
 * Deterministic scenery scatter for the overworld map — small decoration
 * sprites (rocks, tree clumps, wrecks, asteroids, ...) placed across eligible
 * terrain tiles for visual variety, distinct from the terrain fill itself
 * (`tiles.ts`) and from objective/set-piece art (`objectiveView.ts`).
 *
 * Placement is a pure function of `map.id` + tile coordinates (via
 * `hash01`/`stringHash`, same rule as the old tile speckle this replaces —
 * see hash.ts's header), so a given map always scatters identically across
 * loads. Objective radii and the deploy zone are kept clear so decorations
 * never visually collide with interactive markers.
 *
 * Art: `/sprites/map/deco_<key>.png`, green-keyed like map objects — see
 * `tools/art/plan.ts#buildDecorPrompt` / `DECOR_KEYS`. Missing art is simply
 * skipped (no fallback shape) — decor is pure flavor, not gameplay-critical.
 */
import { Container, Sprite, Texture, type Application } from 'pixi.js';
import type { MapDef, Terrain } from '@sim/types';
import { loadChromaKeyedTexture } from '@render/sprites/chromaKey';
import { hash01, stringHash } from './hash';
import { mapIsoBounds, toIso } from './iso';

export const DECOR_KEYS = [
  'rock_a',
  'rock_b',
  'tree_clump',
  'crater',
  'ruin_wall',
  'wreck_small',
  'asteroid_a',
  'asteroid_b',
  'crystal_shard',
  'antenna_small',
] as const;
export type DecorKey = (typeof DECOR_KEYS)[number];

interface DecorRule {
  key: DecorKey;
  weight: number;
}

interface TerrainDecorConfig {
  /** Chance (0..1) a given eligible tile gets at least one decoration. */
  density: number;
  /** 1 or 2 — the max decorations one tile can get. */
  maxCount: number;
  pool: DecorRule[];
}

/**
 * Per GDD-style terrain flavor: which decor keys can appear on which
 * terrain, and how often. Terrain kinds not listed here never get decor —
 * that's `water` (never had decor) AND, as of the SRW-style ground pass
 * (see tiles.ts), `urban` too: the urban ground plate/tint already carries
 * the "city" read on its own, and doubling that up with rooftop-clutter
 * decor sprites fought the calm/clean SRW look the terrain rework was
 * chasing. Every remaining density is roughly half what it was before that
 * pass, for the same reason (less visual noise competing with the new
 * ground).
 */
const TERRAIN_DECOR: Partial<Record<Terrain, TerrainDecorConfig>> = {
  open: { density: 0.06, maxCount: 1, pool: [{ key: 'rock_a', weight: 2 }, { key: 'rock_b', weight: 2 }, { key: 'crater', weight: 1 }] },
  forest: { density: 0.28, maxCount: 2, pool: [{ key: 'tree_clump', weight: 1 }] },
  mountain: {
    density: 0.22,
    maxCount: 2,
    pool: [{ key: 'rock_a', weight: 3 }, { key: 'rock_b', weight: 3 }, { key: 'crystal_shard', weight: 1 }],
  },
  void: { density: 0.015, maxCount: 1, pool: [{ key: 'asteroid_a', weight: 1 }, { key: 'asteroid_b', weight: 1 }] },
  debris: {
    density: 0.25,
    maxCount: 2,
    pool: [{ key: 'wreck_small', weight: 2 }, { key: 'asteroid_a', weight: 1 }, { key: 'asteroid_b', weight: 1 }],
  },
  radiation: { density: 0.08, maxCount: 1, pool: [{ key: 'crystal_shard', weight: 1 }] },
  gravity: { density: 0.05, maxCount: 1, pool: [{ key: 'asteroid_a', weight: 1 }, { key: 'asteroid_b', weight: 1 }] },
  structure: { density: 0.13, maxCount: 1, pool: [{ key: 'antenna_small', weight: 1 }, { key: 'ruin_wall', weight: 1 }] },
};

const MIN_HEIGHT_PX = 18;
const MAX_HEIGHT_PX = 34;
/** Reference height every decor texture is loaded/cached at; per-placement height (18-34px) is then just a uniform Sprite scale off this, so N unique keys means exactly N chroma-key loads no matter how many times each is placed. */
const DECOR_REFERENCE_HEIGHT = 32;
/** Extra tile-radius kept clear beyond an objective's/deploy zone's own radius, so decor never visually overlaps an interactive marker. */
const EXCLUSION_MARGIN = 0.5;
/** Above this many placements, bake into one static RenderTexture layer (perf) instead of individual Sprites — see `buildDecorLayer`'s doc comment. */
const BAKE_THRESHOLD = 300;

function pickWeighted(pool: DecorRule[], r: number): DecorKey {
  const total = pool.reduce((n, p) => n + p.weight, 0);
  let t = r * total;
  for (const p of pool) {
    if (t < p.weight) return p.key;
    t -= p.weight;
  }
  return pool[pool.length - 1].key;
}

function isExcluded(map: MapDef, tx: number, ty: number): boolean {
  const cx = tx + 0.5;
  const cy = ty + 0.5;
  const dz = map.deployZone;
  if (Math.hypot(cx - dz.pos.x, cy - dz.pos.y) < dz.radius + EXCLUSION_MARGIN) return true;
  for (const obj of map.objectives) {
    if (Math.hypot(cx - obj.pos.x, cy - obj.pos.y) < obj.radius + EXCLUSION_MARGIN) return true;
  }
  return false;
}

export interface DecorPlacement {
  key: DecorKey;
  /** Projected iso pixel position (unshifted worldLayer space — same convention as toIso(pos) everywhere else in src/render/map, e.g. ObjectiveView/SquadView). */
  x: number;
  y: number;
  flip: boolean;
  heightPx: number;
}

/** Pure function of map.id + tile grid — same map always scatters identically (no Math.random; see hash.ts). Exported for testing. */
export function computeDecorPlacements(map: MapDef): DecorPlacement[] {
  const mapSeed = stringHash(map.id);
  const placements: DecorPlacement[] = [];

  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const terrain = map.tiles[ty]?.[tx];
      if (!terrain) continue;
      const config = TERRAIN_DECOR[terrain];
      if (!config) continue;
      if (isExcluded(map, tx, ty)) continue;

      const presenceRoll = hash01(mapSeed + tx * 131, ty, 501);
      if (presenceRoll > config.density) continue;
      let count = 1;
      if (config.maxCount >= 2 && hash01(mapSeed + tx * 131, ty, 502) < config.density * 0.3) count = 2;

      for (let i = 0; i < count; i++) {
        const salt = 510 + i * 10;
        const keyRoll = hash01(mapSeed + tx * 131, ty, salt + 1);
        const key = pickWeighted(config.pool, keyRoll);
        const ox = (hash01(mapSeed + tx * 131, ty, salt + 2) - 0.5) * 0.6;
        const oy = (hash01(mapSeed + tx * 131, ty, salt + 3) - 0.5) * 0.6;
        const flip = hash01(mapSeed + tx * 131, ty, salt + 4) < 0.5;
        const heightPx = MIN_HEIGHT_PX + hash01(mapSeed + tx * 131, ty, salt + 5) * (MAX_HEIGHT_PX - MIN_HEIGHT_PX);
        const iso = toIso({ x: tx + 0.5 + ox, y: ty + 0.5 + oy });
        placements.push({ key, x: iso.x, y: iso.y, flip, heightPx });
      }
    }
  }
  return placements;
}

const decorTextureCache = new Map<DecorKey, Promise<Texture | null>>();
function loadDecorTexture(key: DecorKey): Promise<Texture | null> {
  let cached = decorTextureCache.get(key);
  if (cached) return cached;
  cached = loadChromaKeyedTexture(`/sprites/map/deco_${key}`, DECOR_REFERENCE_HEIGHT);
  decorTextureCache.set(key, cached);
  return cached;
}

function makeDecorSprite(p: DecorPlacement, tex: Texture): Sprite {
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5, 1); // bottom-center on the ground point, same convention as ObjectiveView/DeployZoneView art.
  const scale = p.heightPx / DECOR_REFERENCE_HEIGHT;
  sprite.scale.set(p.flip ? -scale : scale, scale);
  return sprite;
}

export interface DecorLayerResult {
  /** Individual sprites for MapScene to add straight into entitiesLayer, zIndex already set to projected y so squads draw in front of/behind them. Empty when `baked` is set instead. */
  sprites: Sprite[];
  /** Set only when placement count exceeded BAKE_THRESHOLD: one static baked Sprite (owns a fresh RenderTexture — caller must destroy it like the tile layer's) meant for tilesLayer, i.e. always behind entities. */
  baked: Sprite | null;
}

const EMPTY_RESULT: DecorLayerResult = { sprites: [], baked: null };

/**
 * Computes this map's decor scatter, loads whatever decor art is published,
 * and returns either per-sprite placements (normal case — lets squads
 * depth-sort against individual decorations) or one baked layer (perf
 * fallback for very dense scatter, at the cost of decorations always
 * rendering behind entities instead of depth-sorting against them).
 */
export async function buildDecorLayer(app: Application, map: MapDef): Promise<DecorLayerResult> {
  const placements = computeDecorPlacements(map);
  if (placements.length === 0) return EMPTY_RESULT;

  const uniqueKeys = [...new Set(placements.map((p) => p.key))];
  const textures = new Map<DecorKey, Texture | null>();
  await Promise.all(
    uniqueKeys.map(async (k) => {
      textures.set(k, await loadDecorTexture(k));
    })
  );
  const usable = placements.filter((p) => textures.get(p.key));
  if (usable.length === 0) return EMPTY_RESULT;

  if (usable.length > BAKE_THRESHOLD) {
    const bounds = mapIsoBounds(map);
    const container = new Container();
    container.sortableChildren = true;
    for (const p of usable) {
      const sprite = makeDecorSprite(p, textures.get(p.key)!);
      sprite.x = p.x - bounds.minX;
      sprite.y = p.y - bounds.minY;
      sprite.zIndex = sprite.y;
      container.addChild(sprite);
    }
    container.sortChildren();
    const texture = app.renderer.generateTexture(container);
    container.destroy({ children: true, texture: false }); // shared/cached decor textures — not ours to destroy
    const baked = new Sprite(texture);
    baked.label = 'decor-layer';
    baked.x = bounds.minX;
    baked.y = bounds.minY;
    return { sprites: [], baked };
  }

  const sprites = usable.map((p) => {
    const sprite = makeDecorSprite(p, textures.get(p.key)!);
    sprite.x = p.x;
    sprite.y = p.y;
    sprite.zIndex = p.y;
    return sprite;
  });
  return { sprites, baked: null };
}
