/**
 * tools/art/plan.ts — pure planning logic for the Hugging Face art pipeline.
 *
 * No fs, no network, no image decoding. Everything here is a deterministic
 * function over already-parsed data (frames.json / pilots.json) plus a fixed
 * backdrop list, so it can be unit tested against small inline fixtures (see
 * plan.test.ts). generate.ts is the I/O shell: it loads JSON, calls these
 * functions, then does the actual HTTP calls and file writes.
 */
import type { Faction, FrameDef, Id, PilotDef } from '../../src/sim/types';

export const NEGATIVE_PROMPT_SPRITE = 'realistic, photo, blurry, text, watermark, multiple robots, cropped';

/** Keys match the runtime sprite loader (`/portraits/<id>_<expression>.png`). */
export const PORTRAIT_EXPRESSIONS = ['neutral', 'shout', 'strained', 'grin'] as const;
export type PortraitExpression = (typeof PORTRAIT_EXPRESSIONS)[number];
/** Prompt wording per expression key. */
const EXPRESSION_PROMPT: Record<PortraitExpression, string> = {
  neutral: 'neutral, calm',
  shout: 'shouting, mouth open, brows down',
  strained: 'strained, gritted teeth, sweat',
  grin: 'grinning, confident',
};

/** Fixed per GDD §10 — one backdrop per terrain family, not derived from map data. */
export const BACKDROP_SCENES: { key: string; scene: string }[] = [
  { key: 'space_debris_field', scene: 'space debris field' },
  { key: 'space_station_interior', scene: 'space station interior' },
  { key: 'forest', scene: 'forest' },
  { key: 'urban_ruins', scene: 'urban ruins' },
  { key: 'mountain_ridge', scene: 'mountain ridge' },
  { key: 'salt_flats_dust', scene: 'salt flats/dust' },
];

const SILHOUETTE_DESCRIPTIONS: Record<FrameDef['silhouette'], string> = {
  skirmish: 'lightweight scout mech silhouette, slim limbs, angular thruster fins',
  line: 'balanced medium mech silhouette, standard-issue proportions, twin shoulder vents',
  bastion: 'heavy defensive mech silhouette, thick armor plating, wide planted stance',
  recon: 'agile light mech silhouette, sensor-array head, long whip antenna',
  siege: 'heavy siege mech silhouette, oversized shoulder cannon, reinforced stance',
  compact_ace: 'sleek enemy ace mech silhouette, sharp angular armor, distinctive head horn',
  compact_line: 'enemy line mech silhouette, blocky uniform plating, angular joints',
};

const FACTION_PALETTES: Record<Faction, string> = {
  relay: 'gunmetal and bone white with amber-orange accents',
  compact: 'steel grey and white with steel-blue accents',
  neutral: 'muted grey and rust with salvage-tech violet accents',
};

export type ImageKind = 'frame' | 'portrait' | 'backdrop' | 'pose';

export interface ImageJob {
  /** Unique per job: frame id, `${pilotId}_${expression}`, or a backdrop key. */
  key: string;
  kind: ImageKind;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
}

/** "SD chibi mecha ..." prompt for one battle-scale frame image, per GDD §3. */
export function buildFramePrompt(frame: FrameDef): ImageJob {
  const silhouette = SILHOUETTE_DESCRIPTIONS[frame.silhouette];
  const palette = FACTION_PALETTES[frame.faction];
  const prompt =
    `SD chibi mecha, super-deformed proportions, 2.5 heads tall, oversized head and torso, ` +
    `stubby limbs, huge shoulder pauldrons, ${silhouette}, ${palette}, full body, facing right, ` +
    `clean cel-shaded anime style, flat colors, thick outlines, plain solid #00ff00 green background, ` +
    `centered, no text`;
  return { key: frame.id, kind: 'frame', prompt, negativePrompt: NEGATIVE_PROMPT_SPRITE, width: 512, height: 512 };
}

/**
 * Melee silhouettes lunge with a lance/blade instead of aiming a ranged
 * weapon — their frame prompts already read as sword/lance-carrying scouts
 * or aces, so a "firing stance" pose would fight the silhouette description.
 */
const MELEE_POSE_SILHOUETTES: ReadonlySet<FrameDef['silhouette']> = new Set(['skirmish', 'compact_ace']);

function poseActionText(silhouette: FrameDef['silhouette']): string {
  return MELEE_POSE_SILHOUETTES.has(silhouette)
    ? 'dynamic combat pose, lunging to the right thrusting a lance/blade, arm fully extended to the right, leaning forward, side view facing right, full body'
    : 'dynamic combat pose, aiming its weapon straight to the RIGHT edge of the image, arm fully extended to the right, firing stance, leaning forward, side view facing right, full body';
}

/**
 * Combat-pose art for one frame, keyed `<spriteKey>_attack` (GDD §3 "every
 * weapon part carries its own attack animation" — this is the frame body's
 * half of that: a body clearly aiming/lunging at an off-screen enemy, so the
 * battle stage doesn't have to fake "fighting" out of a static idle pose).
 * Same style/palette as buildFramePrompt, swapping the neutral "full body,
 * facing right" clause for an aiming/lunging action clause.
 */
export function buildPosePrompt(frame: FrameDef): ImageJob {
  const silhouette = SILHOUETTE_DESCRIPTIONS[frame.silhouette];
  const palette = FACTION_PALETTES[frame.faction];
  const action = poseActionText(frame.silhouette);
  const prompt =
    `SD chibi mecha, super-deformed proportions, 2.5 heads tall, oversized head and torso, ` +
    `stubby limbs, huge shoulder pauldrons, ${silhouette}, ${palette}, ${action}, ` +
    `clean cel-shaded anime style, flat colors, thick outlines, plain solid #00ff00 green background, ` +
    `centered, no text`;
  return {
    key: `${frame.spriteKey}_attack`,
    kind: 'pose',
    prompt,
    negativePrompt: NEGATIVE_PROMPT_SPRITE,
    width: 512,
    height: 512,
  };
}

/** faction 'relay' and archetype not 'captain', plus any pilot with archetype 'rival'. Same rule as tools/voice. */
export function eligiblePortraitPilots(pilots: Record<Id, PilotDef>): PilotDef[] {
  return Object.values(pilots).filter(
    (p) => (p.faction === 'relay' && p.archetype !== 'captain') || p.archetype === 'rival'
  );
}

/**
 * One bust-shot portrait prompt for one pilot expression. Portraits are
 * displayed as square cards (no chroma-key compositing needed), so — unlike
 * frames — they get an actual background instead of the #00ff00 key color.
 */
export function buildPortraitPrompt(pilot: PilotDef, expression: PortraitExpression): ImageJob {
  const descriptors = `${pilot.archetype} pilot, ${pilot.bio}`;
  const prompt =
    `anime portrait, chibi style, mecha pilot in flight suit, ${descriptors}, ` +
    `expression: ${EXPRESSION_PROMPT[expression]}, bust shot, facing slightly left, cel shaded, flat colors, ` +
    `dark gunmetal gradient background, subtle amber rim light`;
  return { key: `${pilot.id}_${expression}`, kind: 'portrait', prompt, width: 512, height: 512 };
}

/** One 1280x720-target (generated at 1024x576) backdrop for a terrain family. */
export function buildBackdropPrompt(entry: { key: string; scene: string }): ImageJob {
  const prompt = `painted anime background, ${entry.scene}, wide shot, no characters, dramatic lighting`;
  return { key: entry.key, kind: 'backdrop', prompt, width: 1024, height: 576 };
}

export interface ArtData {
  frames: Record<Id, FrameDef>;
  pilots: Record<Id, PilotDef>;
}

export interface ArtPlanOptions {
  /** Restrict to these categories; default frames/portraits/backdrops (poses is opt-in only — see buildArtPlan). */
  only?: ImageKind[] | ('frames' | 'portraits' | 'backdrops' | 'poses')[];
  /** Cap the total job count after building the full list (in frames -> portraits -> backdrops -> poses order). */
  limit?: number;
}

export interface ArtPlanCounts {
  frames: number;
  portraits: number;
  backdrops: number;
  poses: number;
  total: number;
}

export interface ArtPlan {
  jobs: ImageJob[];
  counts: ArtPlanCounts;
}

const CATEGORY_TO_KIND: Record<string, ImageKind> = {
  frames: 'frame',
  portraits: 'portrait',
  backdrops: 'backdrop',
  poses: 'pose',
};

/**
 * Poses are deliberately excluded from the "no --only given" default: they're
 * an add-on combat-pose pass over the same frame set, not part of the base
 * three categories, so a plain `buildArtPlan(data)` stays exactly what it was
 * before poses existed. Ask for them explicitly with `--only poses`.
 */
export function buildArtPlan(data: ArtData, options: ArtPlanOptions = {}): ArtPlan {
  const wantedKinds = new Set<ImageKind>(
    options.only && options.only.length > 0
      ? options.only.map((c) => CATEGORY_TO_KIND[c] ?? (c as ImageKind))
      : ['frame', 'portrait', 'backdrop']
  );

  const jobs: ImageJob[] = [];

  if (wantedKinds.has('frame')) {
    for (const frame of Object.values(data.frames)) {
      jobs.push(buildFramePrompt(frame));
    }
  }
  if (wantedKinds.has('portrait')) {
    for (const pilot of eligiblePortraitPilots(data.pilots)) {
      for (const expression of PORTRAIT_EXPRESSIONS) {
        jobs.push(buildPortraitPrompt(pilot, expression));
      }
    }
  }
  if (wantedKinds.has('backdrop')) {
    for (const entry of BACKDROP_SCENES) {
      jobs.push(buildBackdropPrompt(entry));
    }
  }
  if (wantedKinds.has('pose')) {
    for (const frame of Object.values(data.frames)) {
      jobs.push(buildPosePrompt(frame));
    }
  }

  const limited = typeof options.limit === 'number' ? jobs.slice(0, Math.max(0, options.limit)) : jobs;

  const counts: ArtPlanCounts = {
    frames: limited.filter((j) => j.kind === 'frame').length,
    portraits: limited.filter((j) => j.kind === 'portrait').length,
    backdrops: limited.filter((j) => j.kind === 'backdrop').length,
    poses: limited.filter((j) => j.kind === 'pose').length,
    total: limited.length,
  };

  return { jobs: limited, counts };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  key: string;
  kind: ImageKind;
  prompt: string;
  rawPath: string;
  generatedAt: string;
}

export interface ArtManifest {
  version: 1;
  images: ManifestEntry[];
}

/**
 * Builds public/sprites/manifest.json content, including only jobs whose raw
 * output file actually exists under `rawDir` (normally public/sprites/raw).
 * `now` is injected for deterministic tests.
 */
export function buildArtManifest(
  plan: ArtPlan,
  opts: { rawDir: string; fileExtension: (job: ImageJob) => string | null; now?: () => string }
): ArtManifest {
  const now = opts.now ?? (() => new Date().toISOString());
  const images: ManifestEntry[] = [];
  for (const job of plan.jobs) {
    const ext = opts.fileExtension(job);
    if (!ext) continue; // no raw file on disk for this job
    images.push({
      key: job.key,
      kind: job.kind,
      prompt: job.prompt,
      rawPath: `${opts.rawDir}/${job.key}.${ext}`,
      generatedAt: now(),
    });
  }
  return { version: 1, images };
}
