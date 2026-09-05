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
 *   npx tsx tools/art/generate.ts [--force] [--only frames|portraits|backdrops] [--limit N] [--publish] [--model <id>] [--provider router|api-inference]
 *
 * OUTPUT LAYOUT — read this before running for real:
 *   public/sprites/raw/<key>.<ext>        every generated image, as received (png or jpg), always written.
 *   public/sprites/frames/README.md       explains the plain-#00ff00-green-background chroma-key convention
 *                                         placeholder frame/portrait art uses; written once, real runs only.
 *   public/sprites/<spriteKey>_battle.png } only written with --publish, and only when the raw response was
 *   public/sprites/<spriteKey>_map.png    } verified to actually be a PNG (magic-byte check, not just the
 *   public/portraits/<portraitKey>_<expr>.png } HTTP content-type). Until --publish is used, the game keeps
 *                                         using its procedural placeholders — nothing under public/sprites/
 *   (both are literal copies of the same raw   or public/portraits/ is overwritten by an unreviewed batch.
 *    generated image; the sprite loader scales frame art for map vs. battle context, so no resizing here.)
 *
 * This tool does NOT depend on any image library (no sharp, no canvas) — it
 * only ever copies bytes it already has. If Hugging Face ever returns
 * anything other than PNG/JPEG, the raw file is still saved (for inspection)
 * but publishing that job is skipped with a warning.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AuthError, sleep } from '../shared/fetchRetry';
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
const PORTRAITS_DIR = path.join(ROOT, 'public/portraits');
const FRAMES_README_PATH = path.join(ROOT, 'public/sprites/frames/README.md');
const MANIFEST_PATH = path.join(ROOT, 'public/sprites/manifest.json');

const DEFAULT_MODEL = 'black-forest-labs/FLUX.1-schnell';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Category = 'frames' | 'portraits' | 'backdrops';
type Provider = 'auto' | 'router' | 'api-inference';

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  only?: Category[];
  limit?: number;
  publish: boolean;
  model: string;
  provider: Provider;
}

const VALID_CATEGORIES: Category[] = ['frames', 'portraits', 'backdrops'];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, force: false, publish: false, model: DEFAULT_MODEL, provider: 'auto' };
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
          error(TAG, `--only has unknown categor${invalid.length > 1 ? 'ies' : 'y'}: ${invalid.join(', ')} (expected frames|portraits|backdrops)`);
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
        args.model = argv[++i] ?? DEFAULT_MODEL;
        break;
      case '--provider':
        {
          const p = argv[++i];
          if (p !== 'router' && p !== 'api-inference') {
            error(TAG, `--provider must be "router" or "api-inference", got "${p}"`);
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

function routerUrl(model: string): string {
  return `https://router.huggingface.co/hf-inference/models/${model}`;
}
function apiInferenceUrl(model: string): string {
  return `https://api-inference.huggingface.co/models/${model}`;
}

interface HfImageResult {
  buffer: Buffer;
  contentType: string;
}

/**
 * POSTs one image job to one HF endpoint. Handles the two HF-specific
 * transient cases that a generic status-code retry can't: 503 "model is
 * loading" (body carries an estimated_time in seconds to wait) and 429
 * rate limiting (plain exponential backoff, HF doesn't reliably send
 * Retry-After on this route). Throws AuthError immediately on 401/403.
 */
async function requestImageOnce(token: string, endpoint: string, job: ImageJob): Promise<HfImageResult> {
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
 * Tries the requested provider(s) in order. With --provider unset ('auto')
 * this tries the newer router endpoint first and falls back to the classic
 * api-inference host on any non-auth failure, per HF's endpoint migration.
 * An explicit --provider pins to exactly that one endpoint, no fallback.
 */
async function requestImage(token: string, model: string, provider: Provider, job: ImageJob): Promise<HfImageResult> {
  const endpoints =
    provider === 'router' ? [routerUrl(model)] : provider === 'api-inference' ? [apiInferenceUrl(model)] : [routerUrl(model), apiInferenceUrl(model)];

  let lastError: unknown;
  for (let i = 0; i < endpoints.length; i++) {
    try {
      return await requestImageOnce(token, endpoints[i], job);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      lastError = err;
      if (i < endpoints.length - 1) {
        warn(TAG, `${job.key}: ${endpoints[i]} failed (${(err as Error).message}); trying fallback endpoint`);
      }
    }
  }
  throw lastError ?? new Error(`${job.key}: no HF endpoints configured`);
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

function findRawExtension(key: string): string | null {
  for (const ext of ['png', 'jpg', 'jpeg', 'bin']) {
    if (existsSync(path.join(RAW_DIR, `${key}.${ext}`))) return ext;
  }
  return null;
}

const FRAMES_README = `# Placeholder frame/portrait sprites — green-key convention

Every frame and portrait prompt generated by \`tools/art/generate.ts\` asks the
model for a **plain solid #00ff00 (pure green) background**. That's a chroma
key: the render pipeline (or a human doing cleanup) treats that exact color
as transparent.

This tool ships with **no image-processing dependency** (no \`sharp\`, no
\`canvas\`) — it only saves the bytes the API returns. It does **not** cut the
green out for you. Two consequences:

1. Files under \`public/sprites/raw/\` are the untouched model output —
   green background and all. They are the brief for a human (or a follow-up
   tool change) to key out and clean up, per GDD §10.
2. Files under \`public/sprites/<spriteKey>_battle.png\` /
   \`_map.png\` and \`public/portraits/<portraitKey>_<expression>.png\` are only
   written when \`--publish\` is passed, and only for jobs whose raw output was
   verified (by magic bytes, not just HTTP content-type) to actually be a
   PNG. Until a human reviews a batch and runs with \`--publish\`, the game
   keeps using its procedural placeholder shapes instead of these images.

If you introduce real chroma-keying later, do it as a separate build step
that reads \`public/sprites/raw/\` — don't reach for an image library from
inside this generation script without updating this note.
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

/** Publishes a frame job's raw PNG as the two loader-convention filenames. Skips (with a warning) if not a real PNG. */
function publishFrame(job: ImageJob, spriteKey: string): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  if (!isPng(raw)) {
    warn(TAG, `${job.key}: raw output is not a real PNG (ext .${ext}); skipping publish`);
    return;
  }
  writeFileAtomic(path.join(SPRITES_DIR, `${spriteKey}_battle.png`), raw);
  writeFileAtomic(path.join(SPRITES_DIR, `${spriteKey}_map.png`), raw);
}

/** Publishes a portrait job's raw PNG as public/portraits/<portraitKey>_<expression>.png. Skips if not a real PNG. */
function publishPortrait(job: ImageJob, portraitKey: string, expression: string): void {
  const ext = findRawExtension(job.key);
  if (!ext) return;
  const raw = readFileSync(path.join(RAW_DIR, `${job.key}.${ext}`));
  if (!isPng(raw)) {
    warn(TAG, `${job.key}: raw output is not a real PNG (ext .${ext}); skipping publish`);
    return;
  }
  writeFileAtomic(path.join(PORTRAITS_DIR, `${portraitKey}_${expression}.png`), raw);
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
  info(TAG, `model: ${args.model}, provider: ${args.provider}${args.publish ? ' (publish enabled)' : ' (raw only — pass --publish to update public/sprites, public/portraits)'}`);

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
        const outcome = await processJob(token, args.model, args.provider, job, args.force);
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
      }
      // Backdrops have no publish-copy convention specified — raw output only.
    }
  }

  const manifest = buildArtManifest(plan, { rawDir: RAW_DIR, fileExtension: (job) => findRawExtension(job.key) });
  writeFileAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  info(TAG, `done: ${generated} generated, ${skipped} skipped, ${failed} failed. Manifest written to ${MANIFEST_PATH}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  error(TAG, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
