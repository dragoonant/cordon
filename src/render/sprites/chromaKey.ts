/**
 * Runtime chroma-key loader for hand-authored placeholder frame art.
 *
 * tools/art generates frame sprites on a plain solid #00ff00 background (see
 * tools/art/plan.ts and public/sprites/frames/README.md) and publishes them
 * to public/sprites/frames/<spriteKey>_<battle|map>.<png|jpg>. This module
 * loads that image at runtime, keys the green out (feathered near the
 * threshold, not a hard cutout), trims the fully-transparent margins, and
 * scales the result to the sprite's target on-screen height — producing a
 * Pixi Texture the same way a pre-cut asset would.
 *
 * All DOM usage (Image, canvas, document) is confined inside the functions
 * below, never at module scope, so importing this file is always safe (e.g.
 * from a Node test runner) — `loadChromaKeyedFrameTexture` simply resolves to
 * null wherever there's no DOM, and callers fall back to the procedural
 * placeholder exactly as they do when the asset is missing.
 */
import { Texture } from 'pixi.js';
import { probeFirstExisting } from './assetProbe';

/** Extensions tried in order — tools/art publishes .png when the source was really PNG, .jpg when it was JPEG. */
const FRAME_ART_EXTENSIONS = ['png', 'jpg'] as const;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`chromaKey: failed to load image ${url}`));
    img.src = url;
  });
}

/**
 * How opaque a pixel should stay, given it's a candidate green-key pixel.
 *
 * The green-dominance test (g significantly above both r and b) is the same
 * shape as the "g > 150 && g > r*1.6 && g > b*1.6" tolerance this was
 * originally speced with, but the multiplier and floor below (1.3 / 130) are
 * loosened from that starting point after measuring actual tools/art output:
 * fal's flux/schnell does not render the requested "plain solid #00ff00"
 * background as a pure, saturated green — real samples average ~(100,165,78)
 * with a min r/g/b ratio around 1.40, comfortably under a 1.6 cutoff. At the
 * letter of the original tolerance, ~40% of true background pixels never
 * clear the gate at all (not just "under-feathered" — excluded outright),
 * which would leave a visible green haze/speckle instead of a clean cutout.
 * 1.3/130 was checked against this game's actual palette (desaturated
 * gunmetal/rust/olive/bone bodies with one saturated amber/steel-blue/violet
 * accent, per GDD §3) to confirm it doesn't clip into character colors —
 * only genuinely green-ish anti-aliased edge pixels land in the feather zone.
 */
function greenKeyAlpha(r: number, g: number, b: number): number {
  if (!(g > 130 && g > r * 1.3 && g > b * 1.3)) return 1;
  const rRatio = r > 0 ? g / r : 4;
  const bRatio = b > 0 ? g / b : 4;
  const excess = Math.min(rRatio, bRatio) - 1.3; // >= 0, since the gate above already requires both ratios > 1.3
  const feather = Math.min(1, excess / 0.3);
  return 1 - feather;
}

/**
 * Per-image key color, sampled from the border. The generator's "green" varies
 * a lot between images — measured corners range from (24,184,17) to
 * (148,220,103) — so a fixed ratio gate leaves a half-alpha haze on the
 * desaturated ones. Distance to the sampled color is robust to that.
 */
function sampleKeyColor(data: Uint8ClampedArray, w: number, h: number): [number, number, number] | null {
  const pts: [number, number][] = [];
  const inset = Math.max(2, Math.floor(Math.min(w, h) * 0.02));
  for (let i = 0; i < 12; i++) {
    const t = (i + 0.5) / 12;
    pts.push([Math.floor(t * (w - 1)), inset], [Math.floor(t * (w - 1)), h - 1 - inset], [inset, Math.floor(t * (h - 1))], [w - 1 - inset, Math.floor(t * (h - 1))]);
  }
  const greens = pts
    .map(([x, y]) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
    })
    .filter(([r, g, b]) => g > 55 && g > r * 1.25 && g > b * 1.25); // dark greens too (obj_* art keys on ~(25,90,50))
  // Need a clear majority of the border to be green, else this isn't a keyed image.
  if (greens.length < pts.length * 0.6) return null;
  greens.sort((a, b) => a[1] - b[1]);
  return greens[Math.floor(greens.length / 2)];
}

/** Alpha from distance to the sampled key color: fully clear inside `lo`, fully opaque past `hi`. */
function distanceKeyAlpha(r: number, g: number, b: number, key: [number, number, number]): number {
  const d = Math.hypot(r - key[0], g - key[1], b - key[2]);
  const lo = 38;
  const hi = 95;
  if (d <= lo) return 0;
  if (d >= hi) return 1;
  // Only feather pixels that are still green-leaning; keeps light body colors crisp.
  const greenish = g > r * 1.05 && g > b * 1.05;
  return greenish ? (d - lo) / (hi - lo) : 1;
}

/**
 * Alpha for a pixel that's a same-hue, darker multiple of the sampled key color — a shadow cast
 * onto the green screen (seen in practice as a dim green smudge under a mech's feet), rather than
 * a lighter/darker *body* color that happens to be somewhat green. `distanceKeyAlpha` alone misses
 * these: Euclidean distance to the key grows fast as a color darkens even though the hue hasn't
 * moved at all, so a strongly-shadowed key pixel can land past `hi` and get treated as opaque body
 * paint — exactly the leftover green patch this fixes.
 *
 * Gate: r/g and b/g ratios within +-0.12 of the key's (same hue), and luminance >= 25% of the
 * key's (still "a shadow", not just an unrelated dark color). Returns null when the pixel doesn't
 * clear that gate at all, so the caller falls through to the normal distance-based alpha. Within
 * the gate, alpha feathers from 0 (comfortably inside both tolerances -> fully keyed) up toward 1
 * only in the outer slice of either tolerance (hue ratio near +-0.12, or luminance near the 25%
 * floor) so real anti-aliased edge pixels that just barely clear the gate don't get clipped fully
 * transparent.
 */
function shadowKeyAlpha(r: number, g: number, b: number, key: [number, number, number]): number | null {
  const [kr, kg, kb] = key;
  if (g <= 0 || kg <= 0) return null;
  const rRatio = r / g;
  const bRatio = b / g;
  const keyRRatio = kr / kg;
  const keyBRatio = kb / kg;
  const rDiff = Math.abs(rRatio - keyRRatio);
  const bDiff = Math.abs(bRatio - keyBRatio);
  const hueTolerance = 0.12;
  if (rDiff > hueTolerance || bDiff > hueTolerance) return null;

  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const keyLum = 0.299 * kr + 0.587 * kg + 0.114 * kb;
  if (keyLum <= 0) return null;
  const lumRatio = lum / keyLum;
  if (lumRatio < 0.25) return null;

  // Feather only the outer quarter of the hue tolerance...
  const hueDist = Math.max(rDiff, bDiff) / hueTolerance; // 0 = exact hue match, 1 = at the gate edge
  const hueAlpha = hueDist <= 0.75 ? 0 : (hueDist - 0.75) / 0.25;
  // ...and the band right above the 25% luminance floor (fully accepted by 40% brightness).
  const lumAlpha = lumRatio >= 0.4 ? 0 : 1 - (lumRatio - 0.25) / 0.15;
  return Math.max(hueAlpha, lumAlpha);
}

/**
 * Draws `img` to a scratch canvas, zeroes alpha on green-keyed pixels
 * (feathered), trims to the bounding box of any non-fully-transparent pixel,
 * then scales (preserving aspect ratio) so the result is `targetHeight` tall.
 * Returns null if the whole image keyed out to nothing.
 */
function chromaKeyTrimAndScale(img: HTMLImageElement, targetHeight: number): HTMLCanvasElement | null {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (srcW <= 0 || srcH <= 0) return null;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const ctx = srcCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, srcW, srcH);

  const imageData = ctx.getImageData(0, 0, srcW, srcH);
  const data = imageData.data;
  const keyColor = sampleKeyColor(data, srcW, srcH);

  let minX = srcW;
  let minY = srcH;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const i = (y * srcW + x) * 4;
      let alpha: number;
      if (keyColor) {
        alpha = distanceKeyAlpha(data[i], data[i + 1], data[i + 2], keyColor);
        // Catches shadowed key pixels the plain distance test misses (see shadowKeyAlpha) —
        // never makes a pixel *more* opaque, only ever more transparent.
        const shadow = shadowKeyAlpha(data[i], data[i + 1], data[i + 2], keyColor);
        if (shadow !== null) alpha = Math.min(alpha, shadow);
      } else {
        alpha = greenKeyAlpha(data[i], data[i + 1], data[i + 2]);
      }
      const outAlpha = Math.round(data[i + 3] * alpha);
      data[i + 3] = outAlpha;
      if (outAlpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  if (maxX < minX || maxY < minY) return null; // nothing left after keying

  const trimmedW = maxX - minX + 1;
  const trimmedH = maxY - minY + 1;
  const scale = trimmedH > 0 ? targetHeight / trimmedH : 1;
  const outW = Math.max(1, Math.round(trimmedW * scale));
  const outH = Math.max(1, Math.round(trimmedH * scale));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return null;
  outCtx.imageSmoothingEnabled = true;
  outCtx.drawImage(srcCanvas, minX, minY, trimmedW, trimmedH, 0, 0, outW, outH);
  return outCanvas;
}

/**
 * Resolves, loads, chroma-keys, trims and scales the published frame art for
 * `spriteKey` at `scale` (battle=128px, map=32px tall — callers pass the
 * exact target height), returning a Pixi Texture ready to drop into a
 * Sprite. Returns null if there's no DOM, no published asset, or the image
 * failed to load/decode — callers should fall back to the procedural
 * placeholder in every such case, same as a missing asset today.
 */
export async function loadChromaKeyedFrameTexture(
  spriteKey: string,
  scale: 'map' | 'battle',
  targetHeight: number
): Promise<Texture | null> {
  return loadChromaKeyedTexture(`/sprites/frames/${spriteKey}_${scale}`, targetHeight);
}

/**
 * Same chroma-key/trim/scale pipeline as `loadChromaKeyedFrameTexture`, but
 * takes the full asset base path directly instead of assembling it from a
 * spriteKey + scale — used for one-off published assets that don't follow
 * the `<spriteKey>_<map|battle>` naming convention, e.g. combat-pose art at
 * `/sprites/frames/<spriteKey>_attack.png` (see getMechPoseTexture).
 */
export async function loadChromaKeyedTexture(baseUrl: string, targetHeight: number): Promise<Texture | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const url = await probeFirstExisting(baseUrl, FRAME_ART_EXTENSIONS);
  if (!url) return null;
  try {
    const img = await loadImage(url);
    const canvas = chromaKeyTrimAndScale(img, targetHeight);
    if (!canvas) return null;
    return Texture.from(canvas);
  } catch {
    return null;
  }
}
