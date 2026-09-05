/**
 * CORDON build tools — normalizes on-disk src/data/*.json into Record<Id, T>.
 *
 * src/sim/types.ts's GameData declares every content collection as
 * `Record<Id, T>`, but the JSON files on disk are written and read by a
 * different pipeline and may be plain arrays of definitions (each carrying
 * its own `id` field) rather than an object keyed by id — src/data/index.ts
 * is free to do that conversion itself at load time. Since these tools read
 * the raw files directly (never importing src/data), they normalize either
 * shape into the Record shape the planning logic expects.
 */
export function normalizeById<T extends { id: string }>(raw: unknown): Record<string, T> {
  if (Array.isArray(raw)) {
    const record: Record<string, T> = {};
    for (const item of raw as T[]) {
      if (item && typeof item === 'object' && typeof (item as T).id === 'string') {
        record[(item as T).id] = item as T;
      }
    }
    return record;
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, T>;
  }
  return {};
}
