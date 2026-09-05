/**
 * Deterministic pseudo-random helper for tile decoration placement.
 *
 * The tile layer is baked once per `load()`, so "random" speckle (stars,
 * tree dots, debris shards, ...) must be a pure function of the tile
 * coordinate — otherwise the map would look different if we ever re-bake it.
 * No `Math.random` per CONVENTIONS.md (that rule is scoped to `src/sim`, but
 * determinism is free performance/consistency here too, so we keep it).
 */
export function hash01(x: number, y: number, salt = 0): number {
  let h = (x * 374761393) ^ (y * 668265263) ^ (salt * 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Deterministic 32-bit hash of a string (map id, terrain key, ...), for seeding `hash01`/`makeRng` from non-numeric keys. */
export function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Seeded PRNG (mulberry32) for per-frame "random-looking" visual effects
 * (weather particle drift, storm flash timing, ...) that must not use
 * `Math.random` per CONVENTIONS.md, but also can't be a pure function of a
 * fixed key the way tile decoration is (they advance every tick). Seed once
 * per map load from `stringHash(map.id)` so a given map's weather always
 * animates identically from load to load.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
