#!/usr/bin/env node
/**
 * tools/art/generate.ts — Hugging Face image pipeline for CORDON placeholder art.
 *
 * Reads src/data/{frames,pilots}.json from DISK at runtime (not via import —
 * that data is owned by a different pipeline). Builds an image job plan (see
 * plan.ts for the pure prompt/plan logic), then either prints the plan
 * (--dry-run) or actually calls the Hugging Face Inference API.
 *
 * Usage:
 *   npx tsx tools/art/generate.ts --dry-run
 *   npx tsx tools/art/generate.ts [--force] [--only frames|portraits|backdrops|poses|terrain|objects|decor] [--limit N] [--publish] [--model <id>] [--provider fal-ai|hf-inference]
 *
 *   "poses" is an opt-in fourth category (excluded from the plain no-`--only` run): one combat-pose
 *   image per frame, key "<spriteKey>_attack", published (with --publish) straight to
 *   public/sprites/frames/<spriteKey>_attack.<png|jpg> — see buildPosePrompt in plan.ts and
 *   getMechPoseTexture in src/render/sprites/index.ts.
 *
 *   "terrain", "objects", and "decor" are three more opt-in categories, for the overworld map (owned
 *   by this pipeline: tools/art/** and public/sprites/map/**, consumed by the isometric map
 *   renderer). None keys off frames.json/pilots.json:
 *     terrain  11 seamless top-down 512x512 textures, one per Terrain kind (src/sim/types.ts), NO green
 *              key (opaque) — published (with --publish) straight to public/sprites/map/terrain_<kind>.png.
 *     objects  8 isometric-3/4 512x512 sprites on a #00ff00 key background (same convention as frames) —
 *              published straight to public/sprites/map/obj_<key>.png. Loaded at runtime via
 *              loadChromaKeyedTexture('/sprites/map/obj_<key>', targetHeight) — src/render/sprites/chromaKey.ts.
 *     decor    10 small isometric-3/4 512x512 scenery/decoration sprites (rocks, tree clumps, wrecks,
 *              asteroids, ...), same green-key convention as objects — published to
 *              public/sprites/map/deco_<key>.png. Scattered across the map at runtime by
 *              src/render/map/decor.ts. See buildDecorPrompt / DECOR_KEYS in plan.ts.
 *   All three publish paths are fixed at .png (no .jpg fallback): a raw response that isn't a real PNG
 *   by magic bytes is skipped with a warning rather than published under a wrong extension. See
 *   buildTerrainPrompt / buildObjectPrompt / buildDecorPrompt in plan.ts. Running any of the three with
 *   --publish also (re)writes public/sprites/map/manifest.json, rebuilt from whatever
 *   public/sprites/map/terrain_*.png, obj_*.png, and deco_*.png files actually exist on disk (not just
 *   this run's jobs), so running them in separate invocations doesn't clobber each other's manifest
 *   entries.
 *
 * PROVIDERS:
 *   fal-ai (default)  POST https://router.huggingface.co/fal-ai/fal-ai/<model> (model defaults to
 *                      "flux/schnell") with a JSON body ({prompt, image_size, num_inference_steps, ...}),
 *                      using the same HF token. Response is JSON `{"images":[{"url": ...}], ...}`; the
 *                      actual image bytes are downloaded from `images[0].url`. This is the endpoint
 *                      confirmed working as of 2026-09 — plain hf-inference text-to-image models
 *                      (including the old default, black-forest-labs/FLUX.1-schnell) now return 410.
 *   hf-inference       POST https://router.huggingface.co/hf-inference/models/<model>, classic HF
 *                      Inference API shape (binary image body). Kept selectable in case HF restores a
 *                      working model on this route, but expect 410/400 for now. The even older
 *                      api-inference.huggingface.co host is dead and has been removed entirely — no
 *                      fallback to it remains.
 *
 * OUTPUT LAYOUT — read this before running for real:
 *   public/sprites/raw/<key>.<ext>        every generated image, as received (png or jpg), always written.
 *   public/sprites/frames/README.md       explains the plain-#00ff00-green-background chroma-key convention
 *                                         placeholder frame art uses; written once, real runs only.
 *   public/sprites/frames/<spriteKey>_battle.<png|jpg> } only written with --publish, and only when the raw
 *   public/sprites/frames/<spriteKey>_map.<png|jpg>    } response was verified (by magic bytes, not just the
 *   public/portraits/<portraitKey>_<expr>.<png|jpg>    } HTTP content-type) to actually be a PNG or JPEG —
 *                                         extension follows the real format. Until --publish is used, the
 *                                         game keeps using its procedural placeholders — nothing under
 *                                         public/sprites/frames/ or public/portraits/ is overwritten by an
 *                                         unreviewed batch. (Both frame files are literal copies of the same
 *                                         raw generated image; the sprite loader scales frame art for map vs.
 *                                         battle context and chroma-keys the green out at runtime, so no
 *                                         image processing happens here.)
 *
 * This tool does NOT depend on any image library (no sharp, no canvas) — it
 * only ever copies bytes it already has. If a provider ever returns anything
 * other than PNG/JPEG, the raw file is still saved (for inspection) but
 * publishing that job is skipped with a warning.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AuthError, fetchRetry, sleep } from '../shared/fetchRetry';
import { describeSecretPresence, readSecret } from '../shared/secrets';
import { ensureDir, writeFileAtomic } from '../shared/fsx';
import { error, info, logCounts, warn } from '../shared/log';
import { runPool } from '../shared/pool';
import { normalizeById } from '../shared/data';
import {
  buildArtManifest,
  buildArtPlan,
  PORTRAIT_EXPRESSIONS,
  type ArtData,
  type ArtPlan,
  type ImageJob,
} from './plan';
import type { FrameDef, PilotDef } from '../../src/sim/types';

const TAG = 'art';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RAW_DIR = path.join(ROOT, 'public/sprites/raw');
const SPRITES_DIR = path.join(ROOT, 'public/sprites');
const FRAMES_DIR = path.join(SPRITES_DIR, 'frames');
const PORTRAITS_DIR = path.join(ROOT, 'public/portraits');
const MAP_DIR = path.join(SPRITES_DIR, 'map');
const FRAMES_README_PATH = path.join(FRAMES_DIR, 'README.md');
const MANIFEST_PATH = path.join(ROOT, 'public/sprites/manifest.json');
const MAP_MANIFEST_PATH = path.join(MAP_DIR, 'manifest.json');

/** Model id for provider 'fal-ai' — a path segment under router.huggingface.co/fal-ai/fal-ai/. */
const DEFAULT_FAL_MODEL = 'flux/schnell';
/** Model id for provider 'hf-inference' — a model repo id under router.huggingface.co/hf-inference/models/. */
const DEFAULT_HF_MODEL = 'black-forest-labs/FLUX.1-schnell';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Category = 'frames' | 'portraits' | 'backdrops' | 'poses' | 'terrain' | 'objects' | 'decor';
type Provider = 'fal-ai' | 'hf-inference';

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  only?: Category[];
  limit?: number;
  publish: boolean;
  /** undefined means "use the provider's default model". */
  model?: string;
  provider: Provider;
}

const VALID_CATEGORIES: Category[] = ['frames', 'portraits', 'backdrops', 'poses', 'terrain', 'objects', 'decor'];

function defaultModelFor(provider: Provider): string {
  return provider === 'fal-ai' ? DEFAULT_FAL_MODEL : DEFAULT_HF_MODEL;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, force: false, publish: false, provider: 'fal-ai' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--publish':
        args.publish = true;
        break;
      case '--only': {
        const raw = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const invalid = raw.filter((c) => !VALID_CATEGORIES.includes(c as Category));
        if (invalid.length > 0) {
          error(TAG, `--only has unknown categor${invalid.length > 1 ? 'ies' : 'y'}: ${invalid.join(', ')} (expected ${VALID_CATEGORIES.join('|')})`);
          process.exit(1);
        }
        args.only = raw as Category[];
        break;
      }
      case '--limit':
        args.limit = Number(argv[++i]);
        if (!Number.isFinite(args.limit) || args.limit < 0) {
          error(TAG, '--limit must be a non-negative number');
          process.exit(1);
        }
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--provider':
        {
          const p = argv[++i];
          if (p !== 'fal-ai' && p !== 'hf-inference') {
            error(TAG, `--provider must be "fal-ai" or "hf-inference", got "${p}"`);
            process.exit(1);
          }
          args.provider = p;
        }
        break;
      default:
        warn(TAG, `unrecognized argument "${a}", ignoring`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadData(): ArtData | null {
  const files = {
    frames: path.join(ROOT, 'src/data/frames.json'),
    pilots: path.join(ROOT, 'src/data/pilots.json'),
  };
  const missing = Object.entries(files).filter(([, p]) => !existsSync(p));
  if (missing.length > 0) {
    info(
      TAG,
      `data not found — missing src/data/${missing.map(([k]) => `${k}.json`).join(', src/data/')}. ` +
        `This pipeline reads that JSON at runtime; nothing to generate yet. Exiting.`
    );
    return null;
  }
  // Normalize because src/data/*.json may be authored as an array of
  // definitions (each with its own `id`) rather than pre-keyed by id — see
  // tools/shared/data.ts.
  return {
    frames: normalizeById<FrameDef>(JSON.parse(readFileSync(files.frames, 'utf8'))),
    pilots: normalizeById<PilotDef>(JSON.parse(readFileSync(files.pilots, 'utf8'))),
  };
}

// ---------------------------------------------------------------------------
// Hugging Face request
// ---------------------------------------------------------------------------

function hfInferenceUrl(model: string): string {
  return `https://router.huggingface.co/hf-inference/models/${model}`;
}
/** fal's serverless models are exposed through the HF router at fal-ai/fal-ai/<model>. */
function falUrl(model: string): string {
  return `https://router.huggingface.co/fal-ai/fal-ai/${model}`;
}

interface HfImageResult {
  buffer: Buffer;
  contentType: string;
}

/** Deterministic 32-bit hash of a job key, used as fal's "seed" so reruns of the same job are reproducible. */
function stableSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * POSTs one image job to one classic HF Inference endpoint. Handles the two
 * HF-specific transient cases that a generic status-code retry can't: 503
 * "model is loading" (body carries an estimated_time in seconds to wait) and
 * 429 rate limiting (plain exponential backoff, HF doesn't reliably send
 * Retry-After on this route). Throws AuthError immediately on 401/403.
 *
 * As of 2026-09 every hf-inference text-to-image model we've probed
 * (including the historical default here) returns 400/410 — this path is
 * kept for when/if HF restores a working model on this route, not because
 * it currently succeeds. Use --provider fal-ai (the default) instead.
 */
async function requestHfInference(token: string, model: string, job: ImageJob): Promise<HfImageResult> {
  const endpoint = hfInferenceUrl(model);
  const maxAttempts = 5;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: job.prompt,
          parameters: { num_inference_steps: 4, width: job.width, height: job.height, guidance_scale: 0 },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    lastStatus = res.status;

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`Hugging Face authentication failed (HTTP ${res.status}) for ${endpoint}`, res.status);
    }
    if (res.status === 503) {
      const body = (await res.json().catch(() => ({}))) as { estimated_time?: number };
      const waitSeconds = typeof body.estimated_time === 'number' ? body.estimated_time : 5;
      warn(TAG, `${job.key}: model loading (503), waiting ${waitSeconds}s (attempt ${attempt + 1}/${maxAttempts})`);
      await sleep(Math.min(waitSeconds, 60) * 1000);
      continue;
    }
    if (res.status === 429) {
      const delayMs = 1000 * 2 ** attempt;
      warn(TAG, `${job.key}: rate limited (429), backing off ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
      await sleep(delayMs);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HF request failed (HTTP ${res.status}) for ${job.key} at ${endpoint}: ${text.slice(0, 300)}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  }
  throw new Error(`${job.key}: HF request exhausted ${maxAttempts} attempts (last status ${lastStatus}); model may still be loading`);
}

/**
 * POSTs one image job to fal's flux/schnell (or another fal model) via the HF
 * router. Uses the shared fetchRetry helper (handles 429/5xx backoff, throws
 * AuthError on 401/403) for both the generation request and the follow-up
 * download of the returned image URL — fal returns JSON with a hosted image
 * URL, not raw image bytes, per the response shape confirmed against the
 * live endpoint.
 */
async function requestFalAi(token: string, model: string, job: ImageJob): Promise<HfImageResult> {
  const endpoint = falUrl(model);
  const res = await fetchRetry(
    endpoint,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: job.prompt,
        image_size: { width: job.width, height: job.height },
        num_inference_steps: 4,
        output_format: 'png',
        seed: stableSeed(job.key),
      }),
    },
    { timeoutMs: 120000 }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fal-ai request failed (HTTP ${res.status}) for ${job.key} at ${endpoint}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { images?: { url?: string; content_type?: string }[] };
  const first = body.images?.[0];
  if (!first?.url) {
    throw new Error(`fal-ai response for ${job.key} had no images[0].url`);
  }
  const imgRes = await fetchRetry(first.url, {}, { timeoutMs: 60000 });
  if (!imgRes.ok) {
    throw new Error(`fal-ai image download failed (HTTP ${imgRes.status}) for ${job.key} at ${first.url}`);
  }
  const contentType = imgRes.headers.get('content-type') ?? first.content_type ?? '';
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { buffer, contentType };
}

/** Dispatches to the selected provider. Each provider is a single pinned endpoint — no cross-provider fallback. */
async function requestImage(token: string, model: string, provider: Provider, job: ImageJob): Promise<HfImageResult> {
  return provider === 'fal-ai' ? requestFalAi(token, model, job) : requestHfInference(token, model, job);
}

// ---------------------------------------------------------------------------
// Post-processing (no image libraries — raw bytes only)
// ---------------------------------------------------------------------------

function extFromContentType(contentType: string): string | null {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  return null;
}

/** True only if the buffer actually starts with the PNG magic bytes — never trust content-type alone. */
function isPng(buffer: Buffer): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < sig.length) return false;
  return sig.every((byte, i) => buffer[i] === byte);
}

/** True only if the buffer actually starts with the JPEG magic bytes — never trust content-type alone. */
function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

/** Classifies a raw image buffer by its real magic bytes, independent of whatever extension it was saved under. */
function classifyImage(buffer: Buffer): 'png' | 'jpg' | null {
  if (isPng(buffer)) return 'png';
  if (isJpeg(buffer)) return 'jpg';
  return null;
}

function findRawExtension(key: string): string | null {
  for (const ext of ['png', 'jpg', 'jpeg', 'bin']) {
    if (existsSync(path.join(RAW_DIR, `${key}.${ext}`))) return ext;
  }
  return null;
}

const FRAMES_README = `# Placeholder frame sprites — green-key convention

Every **frame** prompt generated by \`tools/art/generate.ts\` asks the model
for a **plain solid #00ff00 (pure green) background**. That's a chroma key:
the runtime sprite loader (\`src/render/sprites\`) treats pixels close to that
color as transparent when it loads a frame PNG/JPG, feathering the edge and
trimming the fully-transparent margins before scaling to the on-screen size.

**Portraits do not use this convention.** Portraits are displayed as square
cards, need no keying, and are prompted with an actual background (dark
gunmetal gradient, amber rim light) — see \`buildPortraitPrompt\` in
\`tools/art/plan.ts\`.

This tool ships with **no image-processing dependency** (no \`sharp\`, no
\`canvas\`) — it only saves the bytes the API returns; the chroma-keying
happens in the browser at load time, not here. Two consequences:

1. Files under \`public/sprites/raw/\` are the untouched model output —
   green background and all, for frames. They are the brief for a human to
   review before publishing.
2. Files under \`public/sprites/frames/<spriteKey>_battle.<png|jpg>\` /
   \`_map.<png|jpg>\` and \`public/portraits/<portraitKey>_<expression>.<png|jpg>\`
   are only written when \`--publish\` is passed, and only for jobs whose raw
   output was verified (by magic bytes, not just HTTP content-type) to
   actually be a PNG or JPEG — the extension follows the real format so the
   runtime loader (which probes both) picks the right one. Until a human
   reviews a batch and runs with \`--publish\`, the game keeps using its
   procedural placeholder shapes instead of these images.
`;

// ---------------------------------------------------------------------------
// Job orchestration
// ---------------------------------------------------------------------------

interface GenerationOutcome {
  job: ImageJob;
  status: 'generated' | 'skipped' | 'failed';
  message?: string;
}

async function processJob(
  token: string,
  model: string,
  provider: Provider,
  job: ImageJob,
  force: boolean
): Promise<GenerationOutcome> {
  const existingExt = findRawExtension(job.key);
  if (!force && existingExt) {
    return { job, status: 'skipped', message: `raw/${job.key}.${existingExt} already exists` };
  }

  const result = await requestImage(token, model, provider, job);
  let ext = extFromContentType(result.contentType);
  if (!ext) {
    warn(TAG, `${job.key}: unexpected content-type "${result.contentType}", saving as .bin for inspection (will not be published)`);
    ext = 'bin';
  }
  writeFileAtomic(path.join(RAW_DIR, `${job.key}.${ext}`), result.buffer);
  return { job, status: 'generated' };
}

/**
 * Publishes a frame job's raw image as the two loader-convention filenames
 * under public/sprites/frames/ (the runtime loader — src/render/sprites —
 * probes that path for both .png and .jpg). Skips (with a warning) if the
 * raw bytes aren't actually a PNG or JPEG, regardless of what extension the
 * raw file was saved under.
 */
function publishFrame(job: ImageJob, spriteKey: string): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  const kind = classifyImage(raw);
  if (!kind) {
    warn(TAG, `${job.key}: raw output is not a real PNG or JPEG (ext .${ext}); skipping publish`);
    return;
  }
  ensureDir(FRAMES_DIR);
  writeFileAtomic(path.join(FRAMES_DIR, `${spriteKey}_battle.${kind}`), raw);
  writeFileAtomic(path.join(FRAMES_DIR, `${spriteKey}_map.${kind}`), raw);
}

/**
 * Publishes a pose job's raw image as public/sprites/frames/<spriteKey>_attack.<png|jpg> (job.key is
 * already "<spriteKey>_attack" — see buildPosePrompt). Single file, unlike publishFrame's _battle/_map
 * pair: the runtime loader (getMechPoseTexture) probes this exact basename directly. Skips if not real
 * PNG/JPEG.
 */
function publishPose(job: ImageJob): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  const kind = classifyImage(raw);
  if (!kind) {
    warn(TAG, `${job.key}: raw output is not a real PNG or JPEG (ext .${ext}); skipping publish`);
    return;
  }
  ensureDir(FRAMES_DIR);
  writeFileAtomic(path.join(FRAMES_DIR, `${job.key}.${kind}`), raw);
}

/**
 * Publishes a terrain job's raw image as public/sprites/map/<key>.png (job.key is already
 * "terrain_<kind>" — see buildTerrainPrompt). Unlike frame/pose/portrait art, terrain has no .jpg
 * fallback in its publish contract (the map renderer loads it directly, no chroma-key extension
 * probing) — so this only publishes when the raw bytes are verified to be a real PNG, warning and
 * skipping otherwise (the fal-ai provider always requests output_format: "png", so this should be
 * the common case; hf-inference has no such parameter and may return something else).
 */
function publishTerrain(job: ImageJob): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  const kind = classifyImage(raw);
  if (kind !== 'png') {
    warn(TAG, `${job.key}: raw output is not a real PNG (ext .${ext}); terrain publish path is fixed at .png, skipping publish`);
    return;
  }
  ensureDir(MAP_DIR);
  writeFileAtomic(path.join(MAP_DIR, `${job.key}.png`), raw);
}

/**
 * Publishes a map-object job's raw image as public/sprites/map/<key>.png (job.key is already
 * "obj_<key>" — see buildObjectPrompt). Same green-key convention as frame/pose art, but — like
 * terrain — the publish path is fixed at .png; see publishTerrain for why.
 */
function publishObject(job: ImageJob): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  const kind = classifyImage(raw);
  if (kind !== 'png') {
    warn(TAG, `${job.key}: raw output is not a real PNG (ext .${ext}); object publish path is fixed at .png, skipping publish`);
    return;
  }
  ensureDir(MAP_DIR);
  writeFileAtomic(path.join(MAP_DIR, `${job.key}.png`), raw);
}

/**
 * Publishes a decor job's raw image as public/sprites/map/<key>.png (job.key is already
 * "deco_<key>" — see buildDecorPrompt). Same green-key convention and fixed-.png publish path as
 * publishObject/publishTerrain — see publishTerrain for why.
 */
function publishDecor(job: ImageJob): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  const kind = classifyImage(raw);
  if (kind !== 'png') {
    warn(TAG, `${job.key}: raw output is not a real PNG (ext .${ext}); decor publish path is fixed at .png, skipping publish`);
    return;
  }
  ensureDir(MAP_DIR);
  writeFileAtomic(path.join(MAP_DIR, `${job.key}.png`), raw);
}

/**
 * Rebuilds public/sprites/map/manifest.json from whatever terrain_*.png / obj_*.png / deco_*.png
 * files actually exist in public/sprites/map — not from this run's plan.jobs — so that generating
 * "terrain", "objects", and "decor" in separate invocations (as the budget-constrained workflow
 * does) never clobbers another category's manifest entries.
 */
function buildMapManifestFromDisk(): { version: 1; images: { key: string; kind: 'terrain' | 'object' | 'decor'; path: string }[] } {
  if (!existsSync(MAP_DIR)) return { version: 1, images: [] };
  const files = readdirSync(MAP_DIR).filter(
    (f) => f.endsWith('.png') && (f.startsWith('terrain_') || f.startsWith('obj_') || f.startsWith('deco_'))
  );
  const images = files
    .slice()
    .sort()
    .map((f) => {
      const key = f.slice(0, -'.png'.length);
      const kind: 'terrain' | 'object' | 'decor' = f.startsWith('terrain_') ? 'terrain' : f.startsWith('obj_') ? 'object' : 'decor';
      return { key, kind, path: `sprites/map/${f}` };
    });
  return { version: 1, images };
}

/** Publishes a portrait job's raw image as public/portraits/<portraitKey>_<expression>.<png|jpg>. Skips if not real PNG/JPEG. */
function publishPortrait(job: ImageJob, portraitKey: string, expression: string): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  const kind = classifyImage(raw);
  if (!kind) {
    warn(TAG, `${job.key}: raw output is not a real PNG or JPEG (ext .${ext}); skipping publish`);
    return;
  }
  writeFileAtomic(path.join(PORTRAITS_DIR, `${portraitKey}_${expression}.${kind}`), raw);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printPlanSummary(plan: ArtPlan): void {
  info(TAG, `plan: ${plan.counts.total} image(s)`);
  logCounts(TAG, plan.counts as unknown as Record<string, number>);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const data = loadData();
  if (!data) {
    process.exit(0);
  }

  const plan = buildArtPlan(data, { only: args.only, limit: args.limit });
  printPlanSummary(plan);
  const model = args.model ?? defaultModelFor(args.provider);
  info(TAG, `model: ${model}, provider: ${args.provider}${args.publish ? ' (publish enabled)' : ' (raw only — pass --publish to update public/sprites/frames, public/portraits)'}`);

  if (args.dryRun) {
    const estChars = plan.jobs.reduce((n, j) => n + j.prompt.length, 0);
    info(TAG, `dry run: would request ${plan.jobs.length} image(s), ~${estChars} prompt characters total.`);
    const manifestPreview = buildArtManifest(plan, { rawDir: RAW_DIR, fileExtension: (job) => findRawExtension(job.key) });
    info(TAG, 'manifest preview (raw files that already exist on disk; none are written in --dry-run):');
    console.log(JSON.stringify(manifestPreview, null, 2));
    info(TAG, 'dry run complete — no API calls made, no files written.');
    process.exit(0);
  }

  info(TAG, describeSecretPresence('hf'));
  const token = readSecret('hf');
  if (!token) {
    error(TAG, 'no Hugging Face token found (.hf_token or HF_TOKEN). Aborting.');
    process.exit(1);
  }

  ensureDir(RAW_DIR);
  if (!existsSync(FRAMES_README_PATH)) {
    ensureDir(path.dirname(FRAMES_README_PATH));
    writeFileAtomic(FRAMES_README_PATH, FRAMES_README);
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    await runPool(plan.jobs, 2, async (job) => {
      try {
        const outcome = await processJob(token, model, args.provider, job, args.force);
        if (outcome.status === 'generated') {
          generated++;
          info(TAG, `generated raw/${job.key}`);
        } else {
          skipped++;
          info(TAG, `skipped ${job.key} (${outcome.message})`);
        }
      } catch (err) {
        if (err instanceof AuthError) throw err;
        failed++;
        error(TAG, `failed ${job.key}: ${(err as Error).message}`);
      }
    });
  } catch (err) {
    if (err instanceof AuthError) {
      error(TAG, 'Hugging Face authentication failed — check .hf_token / HF_TOKEN. Stopping immediately.');
      process.exit(1);
    }
    throw err;
  }

  if (args.publish) {
    ensureDir(SPRITES_DIR);
    ensureDir(FRAMES_DIR);
    ensureDir(PORTRAITS_DIR);
    for (const job of plan.jobs) {
      if (job.kind === 'frame') {
        const frame = data.frames[job.key];
        if (frame) publishFrame(job, frame.spriteKey);
      } else if (job.kind === 'portrait') {
        const expression = PORTRAIT_EXPRESSIONS.find((e) => job.key.endsWith(`_${e}`));
        if (expression) {
          const pilotId = job.key.slice(0, -(expression.length + 1));
          const pilot = data.pilots[pilotId];
          if (pilot) publishPortrait(job, pilot.portraitKey, expression);
        }
      } else if (job.kind === 'pose') {
        publishPose(job);
      } else if (job.kind === 'terrain') {
        publishTerrain(job);
      } else if (job.kind === 'object') {
        publishObject(job);
      } else if (job.kind === 'decor') {
        publishDecor(job);
      }
      // Backdrops have no publish-copy convention specified — raw output only.
    }
  }

  const manifest = buildArtManifest(plan, { rawDir: RAW_DIR, fileExtension: (job) => findRawExtension(job.key) });
  writeFileAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  if (args.publish && plan.jobs.some((j) => j.kind === 'terrain' || j.kind === 'object' || j.kind === 'decor')) {
    const mapManifest = buildMapManifestFromDisk();
    writeFileAtomic(MAP_MANIFEST_PATH, JSON.stringify(mapManifest, null, 2));
    info(TAG, `map manifest written to ${MAP_MANIFEST_PATH} (${mapManifest.images.length} file(s))`);
  }

  info(TAG, `done: ${generated} generated, ${skipped} skipped, ${failed} failed. Manifest written to ${MANIFEST_PATH}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  error(TAG, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
