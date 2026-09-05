/**
 * Bridge to `src/render/sprites` (owned by a concurrent agent — see
 * src/sim/API.md § `src/render/sprites/index.ts`). That module did not exist
 * yet when this file was written, so:
 *
 *  - The expected shape is declared *locally* (`SpritesModule`) instead of
 *    `import type { ... } from '../sprites'`, so this file typechecks whether
 *    or not that module exists on disk.
 *  - The module is loaded via a dynamic `import()` whose specifier is a
 *    runtime string, not a literal — TypeScript only tries to resolve
 *    literal import specifiers, so a computed one never fails typecheck even
 *    when the target file is missing. The actual load is wrapped in
 *    try/catch for the real (missing-at-runtime) failure mode.
 *
 * Once `src/render/sprites/index.ts` lands with the documented exports, this
 * file starts using it automatically — nothing here needs to change.
 */
import type { Application, Texture } from 'pixi.js';
import type { Faction, GameData, Id } from '@sim/types';
import { drawFallbackSquadIcon, FACTION_ACCENT } from './spriteFallback';

interface SpritesModule {
  getSquadIconTexture(app: Application, data: GameData, leaderFrameId: Id, faction: Faction, count: number): Promise<Texture>;
  FACTION_ACCENT: Record<Faction, number>;
}

function isSpritesModule(m: unknown): m is SpritesModule {
  return !!m && typeof (m as { getSquadIconTexture?: unknown }).getSquadIconTexture === 'function';
}

let spritesModulePromise: Promise<SpritesModule | null> | null = null;

function loadSpritesModule(): Promise<SpritesModule | null> {
  if (!spritesModulePromise) {
    const specifier = '../sprites';
    spritesModulePromise = import(/* @vite-ignore */ specifier)
      .then((mod: unknown) => (isSpritesModule(mod) ? mod : null))
      .catch(() => null);
  }
  return spritesModulePromise;
}

const textureCache = new Map<string, Promise<Texture>>();

/**
 * Squad map icon: leader frame + faction tint + a size-4/8 pip count. Prefers
 * the real sprite module; falls back to a colored-triangle placeholder if
 * that module isn't available yet or throws (e.g. missing art on disk).
 * Results are cached per (frame, faction, count) key.
 */
export function getSquadIconTexture(
  app: Application,
  data: GameData,
  leaderFrameId: Id,
  faction: Faction,
  count: number
): Promise<Texture> {
  const key = `${leaderFrameId}|${faction}|${count}`;
  let cached = textureCache.get(key);
  if (cached) return cached;
  cached = loadSpritesModule()
    .then(async (mod) => {
      if (mod) {
        try {
          return await mod.getSquadIconTexture(app, data, leaderFrameId, faction, count);
        } catch {
          // fall through to the local placeholder below
        }
      }
      return drawFallbackSquadIcon(app, faction, count);
    })
    .catch(() => drawFallbackSquadIcon(app, faction, count));
  textureCache.set(key, cached);
  return cached;
}

/**
 * relay amber / compact steel-blue / neutral violet, per the documented
 * contract. Kept as a local constant (not fetched from the real module) so
 * callers can use it synchronously in per-frame drawing code.
 */
export function factionAccent(faction: Faction): number {
  return FACTION_ACCENT[faction] ?? FACTION_ACCENT.neutral;
}
