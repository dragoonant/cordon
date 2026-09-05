/**
 * HEAD-request existence check for optional hand-authored PNGs under public/.
 * Results are cached per URL for the process lifetime; network errors and
 * non-OK responses are both treated as "asset absent" so callers can fall
 * back to the procedural placeholder without special-casing failures.
 *
 * No top-level DOM/fetch calls happen here — `probeAsset` only touches the
 * network when invoked, so importing this module is always safe.
 */

const existsCache = new Map<string, Promise<boolean>>();

export function probeAsset(url: string): Promise<boolean> {
  const cached = existsCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    try {
      if (typeof fetch !== 'function') return false;
      const res = await fetch(url, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  })();
  existsCache.set(url, p);
  return p;
}

/** Exposed for tests / the sprite cache reset. */
export function clearAssetProbeCache(): void {
  existsCache.clear();
}
