/**
 * Resolves a `public/` asset path against the base path the app is served from.
 *
 * Runtime asset URLs throughout the game are written root-absolute
 * (`/sprites/frames/x.png`, `/audio/music/title.mp3`), which only resolves
 * when the app is served from the domain root. On GitHub Pages it is served
 * from a project subpath (`https://<user>.github.io/cordon/`), where
 * `/sprites/...` points outside the site entirely and 404s.
 *
 * Vite's `base` is relative (see vite.config.ts) so the bundle's own assets
 * resolve against the document without any help. URLs *built at runtime* —
 * every path in this codebase that's assembled from a sprite/pilot/track key —
 * have to go through here instead.
 *
 * Safe to call twice on the same path, and safe to import from a Node test
 * runner (no DOM access at module scope, and none at all when `document` is
 * absent).
 */

const BASE: string = import.meta.env?.BASE_URL ?? '/';

export function assetUrl(path: string): string {
  // Already fully resolved — http(s):, data:, blob:, or protocol-relative.
  if (path.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return path;

  const rel = path.replace(/^\/+/, '');

  // An absolute base ('/' under `vite dev`, or an explicit '/cordon/') is a
  // plain prefix.
  if (BASE.startsWith('/')) return BASE.endsWith('/') ? `${BASE}${rel}` : `${BASE}/${rel}`;

  // A relative base ('./') means nothing on its own: resolve it against the
  // document, which is exactly what the browser does for the bundle's own
  // asset URLs.
  if (typeof document !== 'undefined') return new URL(rel, document.baseURI).href;

  return `/${rel}`;
}
