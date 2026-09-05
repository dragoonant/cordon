#!/usr/bin/env node
/**
 * tools/voice/generate.ts — ElevenLabs text-to-speech pipeline for CORDON.
 *
 * Reads src/data/{pilots,callouts,certs}.json from DISK at runtime (not via
 * import — those files are owned by a different pipeline and may not exist
 * yet, or may change shape without a rebuild of this tool). Builds a voice
 * line plan (see plan.ts for the pure logic), then either prints the plan
 * (--dry-run) or actually calls the ElevenLabs API and writes
 * public/audio/voice/<pilotDefId>/<lineKey>.mp3 plus a manifest.
 *
 * Usage:
 *   npx tsx tools/voice/generate.ts --dry-run
 *   npx tsx tools/voice/generate.ts [--force] [--max-chars 12000] [--only id,id] [--lines key,key]
 *
 * Never run this against the real API without a reviewed --dry-run first —
 * it costs money per character generated.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AuthError, fetchRetry } from '../shared/fetchRetry';
import { describeSecretPresence, readSecret } from '../shared/secrets';
import { ensureDir, writeFileAtomic } from '../shared/fsx';
import { error, info, logCounts, warn } from '../shared/log';
import { runPool } from '../shared/pool';
import { normalizeById } from '../shared/data';
import { buildManifest, buildVoicePlan, DEFAULT_MAX_CHARS, type VoiceData, type VoiceLine, type VoicePlan } from './plan';
import type { CalloutDef, CertificationDef, PilotDef } from '../../src/sim/types';

const TAG = 'voice';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const AUDIO_DIR = path.join(ROOT, 'public/audio/voice');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');
const VOICES_CONFIG_PATH = path.join(HERE, 'voices.json');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  maxChars: number;
  only?: string[];
  lines?: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, force: false, maxChars: DEFAULT_MAX_CHARS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--max-chars':
        args.maxChars = Number(argv[++i]);
        if (!Number.isFinite(args.maxChars) || args.maxChars <= 0) {
          error(TAG, `--max-chars must be a positive number`);
          process.exit(1);
        }
        break;
      case '--only':
        args.only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--lines':
        args.lines = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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

function loadData(): VoiceData | null {
  const files = {
    pilots: path.join(ROOT, 'src/data/pilots.json'),
    callouts: path.join(ROOT, 'src/data/callouts.json'),
    certs: path.join(ROOT, 'src/data/certs.json'),
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
    pilots: normalizeById<PilotDef>(JSON.parse(readFileSync(files.pilots, 'utf8'))),
    callouts: normalizeById<CalloutDef>(JSON.parse(readFileSync(files.callouts, 'utf8'))),
    certs: normalizeById<CertificationDef>(JSON.parse(readFileSync(files.certs, 'utf8'))),
  };
}

// ---------------------------------------------------------------------------
// Voice mapping
// ---------------------------------------------------------------------------

interface VoicesConfig {
  voices: Record<string, { voiceName?: string; voiceId: string }>;
}

function loadVoicesConfig(): VoicesConfig {
  return JSON.parse(readFileSync(VOICES_CONFIG_PATH, 'utf8'));
}

const FEMALE_IDS = ['21m00Tcm4TlvDq8ikWAM', 'AZnzlk1XvdvUeBnXmlld', 'EXAVITQu4vr4xnSDxMaL', 'MF3mGyEYCl7XYWbV9V6O']; // Rachel, Domi, Bella, Elli
const MALE_IDS = ['ErXwobaYiN019PkySvjV', 'TxGEqnHWrfWFTfGW9XjX', 'VR6AewLTigWG4xSOukaG', 'pNInz6obpgDQGcFmaJgB', 'yoZ06aMxZJJ28mfd3POQ']; // Antoni, Josh, Arnold, Adam, Sam
const ARNOLD_ID = 'VR6AewLTigWG4xSOukaG';
const ADAM_ID = 'pNInz6obpgDQGcFmaJgB';
const ELLI_ID = 'MF3mGyEYCl7XYWbV9V6O';
const JOSH_ID = 'TxGEqnHWrfWFTfGW9XjX';
const DEFAULT_VOICE_ID = ADAM_ID;

/** Fetches GET /v1/voices and builds a name -> id map. Returns an empty map on any failure. */
async function fetchVoiceNameMap(apiKey: string): Promise<Map<string, string>> {
  try {
    const res = await fetchRetry(
      'https://api.elevenlabs.io/v1/voices',
      { headers: { 'xi-api-key': apiKey } },
      { retries: 1, timeoutMs: 15000 }
    );
    if (!res.ok) {
      warn(TAG, `GET /v1/voices returned ${res.status}; using hardcoded voice ids`);
      return new Map();
    }
    const body = (await res.json()) as { voices?: { name?: string; voice_id?: string }[] };
    const map = new Map<string, string>();
    for (const v of body.voices ?? []) {
      if (v.name && v.voice_id) map.set(v.name, v.voice_id);
    }
    return map;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    warn(TAG, `GET /v1/voices failed (${(err as Error).message}); using hardcoded voice ids`);
    return new Map();
  }
}

/**
 * Resolves a PilotDef.voiceKey label to a concrete ElevenLabs voice id.
 * 1. voices.json entry, preferring a live lookup by voiceName, else its
 *    hardcoded voiceId.
 * 2. Unknown label: heuristic on keywords in the label itself, rotating
 *    through a fixed id list so distinct unknown pilots don't collide.
 * 3. Total fallback: DEFAULT_VOICE_ID, with a warning.
 */
function resolveVoiceId(
  voiceKey: string,
  voicesConfig: VoicesConfig,
  nameMap: Map<string, string>,
  unknownIndex: number
): string {
  const entry = voicesConfig.voices[voiceKey];
  if (entry) {
    if (entry.voiceName && nameMap.has(entry.voiceName)) return nameMap.get(entry.voiceName)!;
    if (entry.voiceId) return entry.voiceId;
  }

  const key = voiceKey.toLowerCase();
  const isFemale = key.includes('female');
  if (key.includes('low') || key.includes('gravel')) {
    warn(TAG, `voiceKey "${voiceKey}" not in voices.json; heuristically mapped via 'low/gravel' keyword`);
    return unknownIndex % 2 === 0 ? ARNOLD_ID : ADAM_ID;
  }
  if (key.includes('young')) {
    warn(TAG, `voiceKey "${voiceKey}" not in voices.json; heuristically mapped via 'young' keyword`);
    return isFemale ? ELLI_ID : JOSH_ID;
  }
  if (isFemale) {
    warn(TAG, `voiceKey "${voiceKey}" not in voices.json; heuristically mapped as female`);
    return FEMALE_IDS[unknownIndex % FEMALE_IDS.length];
  }
  if (voicesConfig.voices.default) {
    warn(TAG, `voiceKey "${voiceKey}" not in voices.json and no keyword matched; using configured default voice`);
    return voicesConfig.voices.default.voiceId;
  }
  warn(TAG, `voiceKey "${voiceKey}" not in voices.json and no keyword matched; using hardcoded default voice`);
  return MALE_IDS[unknownIndex % MALE_IDS.length] ?? DEFAULT_VOICE_ID;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface GenerationJob {
  pilotId: string;
  voiceId: string;
  line: VoiceLine;
  outPath: string;
}

function buildJobs(plan: VoicePlan, voicesConfig: VoicesConfig, nameMap: Map<string, string>): GenerationJob[] {
  const jobs: GenerationJob[] = [];
  let unknownIndex = 0;
  for (const pilotPlan of plan.pilots) {
    const voiceId = resolveVoiceId(pilotPlan.voiceKey, voicesConfig, nameMap, unknownIndex);
    if (!voicesConfig.voices[pilotPlan.voiceKey]) unknownIndex++;
    for (const line of pilotPlan.lines) {
      jobs.push({
        pilotId: pilotPlan.pilotId,
        voiceId,
        line,
        outPath: path.join(AUDIO_DIR, pilotPlan.pilotId, `${line.lineKey}.mp3`),
      });
    }
  }
  return jobs;
}

async function generateOne(apiKey: string, job: GenerationJob, force: boolean): Promise<'generated' | 'skipped'> {
  if (!force && existsSync(job.outPath)) {
    return 'skipped';
  }
  const res = await fetchRetry(
    `https://api.elevenlabs.io/v1/text-to-speech/${job.voiceId}?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: job.line.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
    },
    { retries: 3, timeoutMs: 60000 }
  );
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`TTS request failed (HTTP ${res.status}) for ${job.pilotId}/${job.line.lineKey}: ${bodyText.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileAtomic(job.outPath, buf);
  return 'generated';
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printPlanSummary(plan: VoicePlan): void {
  info(TAG, `plan: ${plan.pilots.length} pilot(s), ${plan.totalLines} line(s), ${plan.totalChars} chars (cap ${plan.maxChars})`);
  logCounts(
    TAG,
    Object.fromEntries(plan.pilots.map((p) => [p.pilotId, p.lines.length]))
  );
  if (plan.dropped.length > 0) {
    warn(TAG, `${plan.dropped.length} line(s) dropped to stay under --max-chars ${plan.maxChars}:`);
    for (const d of plan.dropped) {
      warn(TAG, `  dropped ${d.pilotId}/${d.lineKey} (${d.chars} chars)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const data = loadData();
  if (!data) {
    process.exit(0);
  }

  const plan = buildVoicePlan(data, { maxChars: args.maxChars, only: args.only, lines: args.lines });
  printPlanSummary(plan);

  if (args.dryRun) {
    const manifestPreview = buildManifest(plan, AUDIO_DIR);
    info(TAG, 'manifest preview (files that already exist on disk; none are written in --dry-run):');
    console.log(JSON.stringify(manifestPreview, null, 2));
    info(TAG, 'dry run complete — no API calls made, no files written.');
    process.exit(0);
  }

  info(TAG, describeSecretPresence('elevenlabs'));
  const apiKey = readSecret('elevenlabs');
  if (!apiKey) {
    error(TAG, 'no ElevenLabs API key found (.elevenlabs_key or ELEVENLABS_API_KEY). Aborting.');
    process.exit(1);
  }

  const voicesConfig = loadVoicesConfig();
  const nameMap = await fetchVoiceNameMap(apiKey);
  const jobs = buildJobs(plan, voicesConfig, nameMap);

  ensureDir(AUDIO_DIR);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    await runPool(jobs, 2, async (job) => {
      try {
        const result = await generateOne(apiKey, job, args.force);
        if (result === 'generated') {
          generated++;
          info(TAG, `generated ${job.pilotId}/${job.line.lineKey}.mp3`);
        } else {
          skipped++;
          info(TAG, `skipped ${job.pilotId}/${job.line.lineKey}.mp3 (exists; use --force to regenerate)`);
        }
      } catch (err) {
        if (err instanceof AuthError) throw err;
        failed++;
        error(TAG, `failed ${job.pilotId}/${job.line.lineKey}: ${(err as Error).message}`);
      }
    });
  } catch (err) {
    if (err instanceof AuthError) {
      error(TAG, `ElevenLabs authentication failed — check .elevenlabs_key / ELEVENLABS_API_KEY. Stopping immediately.`);
      process.exit(1);
    }
    throw err;
  }

  const manifest = buildManifest(plan, AUDIO_DIR);
  writeFileAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  info(TAG, `done: ${generated} generated, ${skipped} skipped, ${failed} failed. Manifest written to ${MANIFEST_PATH}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  error(TAG, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
