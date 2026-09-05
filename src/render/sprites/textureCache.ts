/**
 * Process-lifetime texture cache keyed by string. Concurrent requests for the
 * same key share one in-flight build so preloadAll (which requests every
 * frame/pilot combo up front) never bakes the same texture twice.
 */
import type { Texture } from 'pixi.js';
import { clearAssetProbeCache } from './assetProbe';

const cache = new Map<string, Texture>();
const inflight = new Map<string, Promise<Texture>>();

export function getCachedTexture(key: string, build: () => Promise<Texture>): Promise<Texture> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = build()
    .then((tex) => {
      cache.set(key, tex);
      inflight.delete(key);
      return tex;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p);
  return p;
}

/** Drops every baked texture (destroying its GPU resources) and asset probe result. */
export function clearSpriteCache(): void {
  for (const tex of cache.values()) {
    tex.destroy(true);
  }
  cache.clear();
  inflight.clear();
  clearAssetProbeCache();
}
