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
