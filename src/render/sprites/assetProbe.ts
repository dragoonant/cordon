/**
 * HEAD-request existence check for optional hand-authored PNGs under public/.
 * Results are cached per URL for the process lifetime; network errors and
 * non-OK responses are both treated as "asset absent" so callers can fall
 * back to the procedural placeholder without special-casing failures.
 *
 * No top-level DOM/fetch calls happen here — `probeAsset` only touches the
 * network when invoked, so importing this module is always safe.
 */

import { assetUrl } from '../../assetUrl';

const existsCache = new Map<string, Promise<boolean>>();

export function probeAsset(rawUrl: string): Promise<boolean> {
  // Rebased here so callers can keep writing root-absolute paths; the same
  // resolved URL is what probeFirstExisting hands back to the image loaders.
  const url = assetUrl(rawUrl);
  const cached = existsCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    try {
      if (typeof fetch !== 'function') return false;
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) return false;
      // Dev servers (Vite) answer unknown paths with index.html + 200 (SPA
      // fallback), so a 200 alone doesn't prove the asset exists.
      const type = res.headers.get('content-type') ?? '';
      return type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('application/octet-stream');
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

/**
 * Tries `${baseUrl}.${ext}` for each of `exts` in order, returning the first
 * URL that HEAD-checks OK, or null if none exist. Used where the art pipeline
 * (tools/art) may have published either a PNG or a JPEG for the same asset
 * key, depending on what the generator actually returned.
 */
export async function probeFirstExisting(baseUrl: string, exts: readonly string[]): Promise<string | null> {
  for (const ext of exts) {
    const url = assetUrl(`${baseUrl}.${ext}`);
    if (await probeAsset(url)) return url;
  }
  return null;
}
