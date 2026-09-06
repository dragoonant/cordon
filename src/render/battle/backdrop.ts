/**
 * Battle stage backdrop — biome dressing driven by the 'start' event's
 * mapKind + terrain (GDD §8: "background matching the map biome").
 *
 * Two layers, tried in order:
 *  1. Painted art published by tools/art (public/sprites/backdrops/bg_<terrain>_<n>.png,
 *     see public/sprites/backdrops/manifest.json) — a cover-scaled photo-backdrop with a
 *     subtle bottom-third darkening gradient so mechs/labels read clearly on top of it.
 *  2. The original procedural biome dressing below, used whenever no painted art exists for
 *     a terrain (or the manifest/image fails to load) — this never regresses to a blank stage.
 */
import { Assets, Container, FillGradient, Graphics, Sprite, type Texture } from 'pixi.js';
import type { MapKind, Terrain } from '@sim/types';

const SPACE_BASE = 0x05060c;
const SPACE_FAR = 0x11142a;

// ---------------------------------------------------------------------------
// Painted backdrop art (tools/art `backdrops` category)
// ---------------------------------------------------------------------------

interface BackdropManifest {
  version: 1;
  /** terrain -> ordered list of "sprites/backdrops/bg_<terrain>_<n>.png" paths, n ascending. */
  terrains: Record<string, string[]>;
}

/** Fetched once per page load and cached; a missing/malformed manifest resolves to null (no painted art). */
let manifestPromise: Promise<BackdropManifest | null> | null = null;

function loadManifest(): Promise<BackdropManifest | null> {
  manifestPromise ??= (async () => {
    try {
      if (typeof fetch !== 'function') return null;
      const res = await fetch('/sprites/backdrops/manifest.json');
      if (!res.ok) return null;
      const data = (await res.json()) as Partial<BackdropManifest>;
      if (data?.version !== 1 || typeof data.terrains !== 'object' || data.terrains === null) return null;
      return data as BackdropManifest;
    } catch {
      return null;
    }
  })();
  return manifestPromise;
}

/** One Pixi Texture load per url, cached for the process lifetime (same convention as assetProbe's existsCache). */
const textureCache = new Map<string, Promise<Texture | null>>();

function loadBackdropTexture(url: string): Promise<Texture | null> {
  let p = textureCache.get(url);
  if (!p) {
    p = Assets.load<Texture>(url).catch(() => null);
    textureCache.set(url, p);
  }
  return p;
}

/** Deterministic (same seed -> same pick every time) variant index into an ordered path list. */
function pickVariant<T>(items: readonly T[], seed: number): T {
  const i = Math.abs(Math.trunc(seed)) % items.length;
  return items[i];
}

/**
 * A Graphics rect filled with a top-to-bottom alpha ramp (transparent -> `maxAlpha` black),
 * covering the bottom `1 - startFrac` of the given height — keeps mech sprites/HP bars/labels
 * readable against a busy painted sky/horizon without flattening the whole image.
 */
function buildBottomGradient(w: number, h: number, startFrac: number, maxAlpha: number): Graphics {
  const g = new Graphics();
  const grad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: h * startFrac },
    end: { x: 0, y: h },
    colorStops: [
      { offset: 0, color: `rgba(0,0,0,0)` },
      { offset: 1, color: `rgba(0,0,0,${maxAlpha})` },
    ],
  });
  g.rect(0, h * startFrac, w, h * (1 - startFrac)).fill(grad);
  return g;
}

/**
 * Loads the painted backdrop for `terrain` (if any exists in the manifest), cover-scaled and
 * centered to exactly `w`x`h` (aspect preserved, overflow cropped via a mask — the source art is
 * 1024x576 same aspect as the design canvas, so in practice this is a straight scale-to-fit, but
 * the mask keeps it correct if that ever changes), with a bottom-third darkening gradient layered
 * on top. Returns null if there's no manifest entry for this terrain or the image fails to load —
 * callers fall back to the procedural backdrop in that case.
 */
async function buildPaintedBackdrop(terrain: Terrain, seed: number, w: number, h: number): Promise<Container | null> {
  const manifest = await loadManifest();
  const paths = manifest?.terrains[terrain];
  if (!paths || paths.length === 0) return null;
  const path = pickVariant(paths, seed);
  const texture = await loadBackdropTexture(`/${path}`);
  if (!texture || texture.width <= 0 || texture.height <= 0) return null;

  const root = new Container();
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  const scale = Math.max(w / texture.width, h / texture.height);
  sprite.scale.set(scale);
  sprite.x = w / 2;
  sprite.y = h / 2;
  root.addChild(sprite);

  const mask = new Graphics().rect(0, 0, w, h).fill(0xffffff);
  root.addChild(mask);
  root.mask = mask;

  root.addChild(buildBottomGradient(w, h, 0.62, 0.6));
  return root;
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildStarfield(w: number, h: number, count: number, seed: number, dim: boolean): Graphics {
  const rnd = seededRandom(seed);
  const g = new Graphics();
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h * 0.85;
    const r = rnd() * (dim ? 0.8 : 1.4) + 0.3;
    const alpha = dim ? 0.25 + rnd() * 0.25 : 0.4 + rnd() * 0.6;
    g.circle(x, y, r).fill({ color: 0xffffff, alpha });
  }
  return g;
}

function buildSpaceBackdrop(terrain: Terrain, w: number, h: number): Container {
  const root = new Container();
  const bg = new Graphics();
  const grad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: SPACE_BASE },
      { offset: 1, color: SPACE_FAR },
    ],
  });
  bg.rect(0, 0, w, h).fill(grad);
  root.addChild(bg);
  root.addChild(buildStarfield(w, h, 90, 1001, true));
  root.addChild(buildStarfield(w, h, 60, 2002, false));

  switch (terrain) {
    case 'debris': {
      const rnd = seededRandom(3003);
      const g = new Graphics();
      for (let i = 0; i < 14; i++) {
        const cx = rnd() * w;
        const cy = h * 0.15 + rnd() * h * 0.55;
        const s = 10 + rnd() * 26;
        const pts: number[] = [];
        const sides = 5 + Math.floor(rnd() * 3);
        for (let j = 0; j < sides; j++) {
          const a = (j / sides) * Math.PI * 2;
          const rr = s * (0.6 + rnd() * 0.5);
          pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.poly(pts).fill({ color: 0x53504a, alpha: 0.55 + rnd() * 0.2 });
      }
      root.addChild(g);
      break;
    }
    case 'radiation': {
      const g = new Graphics();
      const rgrad = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: [
          { offset: 0, color: 0x3a0f10 },
          { offset: 0.5, color: 0x220a0a },
          { offset: 1, color: 0x120608 },
        ],
      });
      g.rect(0, 0, w, h).fill({ fill: rgrad, alpha: 0.55 });
      root.addChild(g);
      break;
    }
    case 'gravity': {
      const g = new Graphics();
      g.ellipse(w * 0.78, h * 0.32, 170, 60).stroke({ width: 6, color: 0x8a7bd8, alpha: 0.55 });
      g.ellipse(w * 0.78, h * 0.32, 130, 44).stroke({ width: 3, color: 0xb08cff, alpha: 0.4 });
      g.circle(w * 0.78, h * 0.32, 34).fill({ color: 0x2a2140, alpha: 0.9 });
      root.addChild(g);
      break;
    }
    case 'structure': {
      const g = new Graphics();
      g.rect(0, 0, w, h * 0.06).fill({ color: 0x2b2f38, alpha: 0.8 });
      g.rect(0, h * 0.94, w, h * 0.06).fill({ color: 0x2b2f38, alpha: 0.8 });
      for (let x = -h; x < w + h; x += 90) {
        g.moveTo(x, 0);
        g.lineTo(x + h * 0.3, h * 0.3);
        g.stroke({ width: 3, color: 0x3a3f4a, alpha: 0.35 });
      }
      root.addChild(g);
      break;
    }
    default:
      break;
  }
  return root;
}

function buildSurfaceBackdrop(terrain: Terrain, w: number, h: number): Container {
  const root = new Container();
  const horizonY = h * 0.58;

  const sky = new Graphics();
  const skyGrad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: 0x2b3346 },
      { offset: 1, color: 0x6c6f66 },
    ],
  });
  sky.rect(0, 0, w, horizonY).fill(skyGrad);
  root.addChild(sky);

  const ground = new Graphics();
  const detail = new Graphics();

  switch (terrain) {
    case 'forest': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x39472f);
      const rnd = seededRandom(4004);
      for (let x = -20; x < w + 20; x += 34) {
        const th = 26 + rnd() * 30;
        detail.poly([x, horizonY, x + 17, horizonY - th, x + 34, horizonY]).fill({ color: 0x27341f, alpha: 0.9 });
      }
      break;
    }
    case 'urban': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x4a4d52);
      const rnd = seededRandom(5005);
      let x = -10;
      while (x < w + 10) {
        const bw = 30 + rnd() * 50;
        const bh = 40 + rnd() * 130;
        detail.rect(x, horizonY - bh, bw, bh).fill({ color: 0x2c2e33, alpha: 0.92 });
        x += bw + 6;
      }
      break;
    }
    case 'mountain': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x5c554a);
      const rnd = seededRandom(6006);
      const pts: number[] = [0, horizonY];
      for (let x = 0; x <= w; x += 60) pts.push(x, horizonY - (30 + rnd() * 90));
      pts.push(w, horizonY);
      detail.poly(pts).fill({ color: 0x413c34, alpha: 0.92 });
      break;
    }
    case 'water': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x2d4a5c);
      for (let i = 0; i < 8; i++) {
        detail
          .rect(0, horizonY + 14 + i * 22, w, 3)
          .fill({ color: 0x9fd0e0, alpha: 0.12 });
      }
      break;
    }
    case 'blocked':
      ground.rect(0, horizonY, w, h - horizonY).fill(0x4d463d);
      break;
    default:
      // 'open' and any other/space terrain paired unexpectedly with a surface map.
      ground.rect(0, horizonY, w, h - horizonY).fill(0x6b6a4a);
      break;
  }

  root.addChild(ground);
  root.addChild(detail);
  return root;
}

/** The original procedural biome dressing — exported for tests and as the guaranteed fallback. */
export function buildProceduralBackdrop(mapKind: MapKind, terrain: Terrain, w: number, h: number): Container {
  return mapKind === 'space' ? buildSpaceBackdrop(terrain, w, h) : buildSurfaceBackdrop(terrain, w, h);
}

/**
 * Resolves the battle backdrop for (mapKind, terrain): painted art when tools/art has published a
 * variant for this terrain, otherwise the procedural biome dressing. `seed` picks which painted
 * variant deterministically (callers pass the battle's own seed — see BattleStage.play — so the
 * same battle always renders the same backdrop, and different battles vary). Never rejects: any
 * failure loading the manifest or the image resolves to the procedural fallback.
 */
export async function buildBackdrop(mapKind: MapKind, terrain: Terrain, seed: number, w: number, h: number): Promise<Container> {
  try {
    const painted = await buildPaintedBackdrop(terrain, seed, w, h);
    if (painted) return painted;
  } catch {
    // fall through to procedural
  }
  return buildProceduralBackdrop(mapKind, terrain, w, h);
}
