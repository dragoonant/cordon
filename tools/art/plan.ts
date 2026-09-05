/**
 * tools/art/plan.ts — pure planning logic for the Hugging Face art pipeline.
 *
 * No fs, no network, no image decoding. Everything here is a deterministic
 * function over already-parsed data (frames.json / pilots.json) plus a fixed
 * backdrop list, so it can be unit tested against small inline fixtures (see
 * plan.test.ts). generate.ts is the I/O shell: it loads JSON, calls these
 * functions, then does the actual HTTP calls and file writes.
 */
import type { Faction, FrameDef, Id, PilotDef, Terrain } from '../../src/sim/types';

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

export type ImageKind = 'frame' | 'portrait' | 'backdrop' | 'pose' | 'terrain' | 'object' | 'decor';

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

// ---------------------------------------------------------------------------
// Overworld map art — terrain textures and objective/map objects.
//
// These publish straight to public/sprites/map/ (not public/sprites/frames/
// or public/portraits/), a directory owned solely by this pipeline and
// consumed by the (separately owned) isometric map renderer — see
// generate.ts publishTerrain/publishObject. Both categories are opt-in only
// (excluded from the plain no-`--only` run), same as `poses`.
// ---------------------------------------------------------------------------

/** No frame/haze mention — these are single flat textures/objects, not chibi mecha. */
const NEGATIVE_PROMPT_MAP_ART =
  'text, lettering, writing, signage, nameplate, gibberish text, watermark, blurry, photo, realistic, characters, people, logo';

/**
 * The 11 map terrain kinds, in the same order as the `Terrain` union in
 * src/sim/types.ts (5 surface + 5 space + shared `blocked`). Textures are
 * seamless-tileable, top-down, 512x512, opaque (no green key) — the map
 * renderer blends tile edges itself, so FLUX not being perfectly seamless is
 * fine (see generate.ts header).
 */
export const TERRAIN_KINDS: Terrain[] = [
  'open',
  'forest',
  'urban',
  'mountain',
  'water',
  'void',
  'debris',
  'radiation',
  'gravity',
  'structure',
  'blocked',
];

const TERRAIN_DESCRIPTIONS: Record<Terrain, string> = {
  open: 'dusty plains and grassland, scattered dry scrub, worn dirt trails',
  forest: 'dense treetops seen from directly above, a tight tangle of canopy',
  urban: 'rooftops and streets seen from directly above, blocky building tops, narrow alleys',
  mountain: 'rocky grey ridges and jagged stone outcrops, sparse snow patches',
  water: 'dark open sea, gentle wave ripples, deep blue-black water',
  void: 'deep space, near-black background with faint distant stars',
  debris: 'flat lay overhead photograph of dozens of small angular scrap metal panel fragments and bolts scattered evenly on a plain black background, tiny loose junk pieces only',
  radiation: 'deep space with a faint red-violet radioactive haze drifting through it',
  gravity: 'deep space with faint concentric distortion rings warping the starfield',
  structure: 'steel space station hull plating, riveted panels and exposed girders',
  blocked: 'near-black impassable rock and void, almost no light',
};

/** Only `debris` risks the model drawing one hero spaceship instead of a scattered-fragment texture. */
const TERRAIN_NEGATIVE_EXTRA: Partial<Record<Terrain, string>> = {
  debris: 'spaceship, rocket, spacecraft, starship, single large vehicle, hero object, side view, 3/4 view',
};

/** One seamless top-down terrain texture for one Terrain kind. Key doubles as the publish basename. */
export function buildTerrainPrompt(kind: Terrain): ImageJob {
  const prompt =
    `seamless tileable texture, top-down, ${TERRAIN_DESCRIPTIONS[kind]}, ` +
    `painted anime cel-shaded style, muted desaturated industrial palette, flat colors, ` +
    `no text, no characters, no logo`;
  const extra = TERRAIN_NEGATIVE_EXTRA[kind];
  return {
    key: `terrain_${kind}`,
    kind: 'terrain',
    prompt,
    negativePrompt: extra ? `${NEGATIVE_PROMPT_MAP_ART}, ${extra}` : NEGATIVE_PROMPT_MAP_ART,
    width: 512,
    height: 512,
  };
}

/**
 * The 8 map object keys — objective markers and set-piece props rendered on
 * the (future) isometric map, per GDD §5 rescue targets plus the carrier and
 * its landing zone. Isometric-3/4 view, single object, plain solid #00ff00
 * green background (keyed at runtime by loadChromaKeyedTexture), same
 * cel-shaded SD style as mech frames.
 */
export const OBJECT_KEYS = [
  'station',
  'colony',
  'convoy',
  'derelict',
  'relay',
  'exit',
  'carrier',
  'landing_zone',
] as const;
export type ObjectKey = (typeof OBJECT_KEYS)[number];

const OBJECT_DESCRIPTIONS: Record<ObjectKey, string> = {
  station: 'a small hexagonal orbital relief station module, docking struts, amber warning lights',
  colony: "an O'Neill cylinder colony habitat, domed cap, rotating ring hull, viewports glowing pale amber",
  convoy: 'a chunky armored refugee transport truck/hauler, boxy cargo container, thick tires, amber running lights',
  derelict:
    'a broken derelict spacecraft hull wreck missing a chunk of its hull, a jagged torn-open gash exposing broken skeletal girders inside, dark scorch burn marks and rust streaks all over the plating, one antenna snapped and dangling, listing at a broken angle, powered down, no crew',
  relay: 'a comm relay mast: a tall antenna on a squat equipment base, dish and a single blinking amber light',
  exit: 'a jump-gate beacon: a tall arch of glowing amber energy conduits framing an open gate',
  carrier: 'a long gunmetal rescue carrier spaceship with amber running lights, docking bays, and sensor masts, 3/4 elevated view',
  landing_zone: 'a landing pad platform marked with amber directional lighting stripes and a central beacon',
};

/** Only `derelict` needs pushing away from FLUX's default "clean, new" look. */
const OBJECT_NEGATIVE_EXTRA: Partial<Record<ObjectKey, string>> = {
  derelict: 'clean, pristine, intact, undamaged, new, shiny',
};

/** One isometric-3/4 object sprite on a #00ff00 key background. Key doubles as the publish basename. */
export function buildObjectPrompt(key: ObjectKey): ImageJob {
  const prompt =
    `SD anime isometric 3/4 view illustration of ${OBJECT_DESCRIPTIONS[key]}, single object, ` +
    `clean cel-shaded anime style, flat colors, thick outlines, gunmetal and bone white with amber-orange accents, ` +
    `plain solid #00ff00 green background, centered, no text`;
  const extra = OBJECT_NEGATIVE_EXTRA[key];
  const negativePrompt = extra
    ? `${NEGATIVE_PROMPT_MAP_ART}, multiple objects, cropped, ${extra}`
    : `${NEGATIVE_PROMPT_MAP_ART}, multiple objects, cropped`;
  return {
    key: `obj_${key}`,
    kind: 'object',
    prompt,
    negativePrompt,
    width: 512,
    height: 512,
  };
}

/**
 * The 10 small overworld decoration/scenery keys — scattered by
 * `src/render/map/decor.ts` across eligible terrain tiles for visual
 * variety, distinct from the 8 objective/set-piece `OBJECT_KEYS` above.
 * Same isometric-3/4, green-keyed convention, published to
 * `public/sprites/map/deco_<key>.png` (loaded at runtime via
 * `loadChromaKeyedTexture('/sprites/map/deco_<key>', targetHeight)`).
 */
export const DECOR_KEYS = [
  'rock_a',
  'rock_b',
  'tree_clump',
  'crater',
  'ruin_wall',
  'wreck_small',
  'asteroid_a',
  'asteroid_b',
  'crystal_shard',
  'antenna_small',
] as const;
export type DecorKey = (typeof DECOR_KEYS)[number];

const DECOR_DESCRIPTIONS: Record<DecorKey, string> = {
  rock_a: 'a single weathered grey boulder, jagged rock formation',
  rock_b: 'a small cluster of two to three jagged grey rocks',
  tree_clump: 'a dense clump of dark green alien scrub trees, tight tangled canopy',
  crater: 'a shallow round impact crater, scorched blackened rim, cracked bare ground inside',
  ruin_wall: 'a broken chunk of a collapsed concrete building wall, exposed rebar, rubble at its base',
  wreck_small: 'a small burnt-out wrecked vehicle husk, twisted scorched metal, no wheels',
  asteroid_a: 'a single small jagged grey asteroid chunk, cratered pitted surface',
  asteroid_b: 'a small cluster of two jagged grey asteroid fragments, cratered pitted surfaces',
  crystal_shard: 'a jagged cluster of glowing violet crystal shards jutting from the ground',
  antenna_small: 'a small standalone comm antenna mast on a narrow tripod base, one blinking amber light',
};

/**
 * One small isometric-3/4 decoration/scenery sprite on a #00ff00 key background. Key doubles as the
 * publish basename. The green-key clause is phrased more insistently than `buildObjectPrompt`'s
 * ("vivid, no olive or yellow tint") because at least one decor render (rock_a) came back with a
 * warm/olive-leaning green that measured too close to the runtime chroma-keyer's ratio threshold
 * (see src/render/sprites/chromaKey.ts) to key out cleanly — this wording change is what a
 * `--force`-free regenerate of that one job relies on to reroll a cleaner background.
 */
export function buildDecorPrompt(key: DecorKey): ImageJob {
  const prompt =
    `SD anime isometric 3/4 view illustration of ${DECOR_DESCRIPTIONS[key]}, small environment prop, single object, ` +
    `clean cel-shaded anime style, flat colors, thick outlines, muted desaturated industrial palette, ` +
    `plain solid pure saturated #00ff00 chroma-key green screen background, vivid green, no olive or yellow tint, centered, no text`;
  return {
    key: `deco_${key}`,
    kind: 'decor',
    prompt,
    negativePrompt: `${NEGATIVE_PROMPT_MAP_ART}, multiple objects, cropped, characters, mecha, robot`,
    width: 512,
    height: 512,
  };
}

export interface ArtData {
  frames: Record<Id, FrameDef>;
  pilots: Record<Id, PilotDef>;
}

export interface ArtPlanOptions {
  /** Restrict to these categories; default frames/portraits/backdrops (poses/terrain/objects/decor are opt-in only — see buildArtPlan). */
  only?: ImageKind[] | ('frames' | 'portraits' | 'backdrops' | 'poses' | 'terrain' | 'objects' | 'decor')[];
  /** Cap the total job count after building the full list (in frames -> portraits -> backdrops -> poses -> terrain -> objects -> decor order). */
  limit?: number;
}

export interface ArtPlanCounts {
  frames: number;
  portraits: number;
  backdrops: number;
  poses: number;
  terrain: number;
  objects: number;
  decor: number;
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
  terrain: 'terrain',
  objects: 'object',
  decor: 'decor',
};

/**
 * Poses, terrain, objects, and decor are deliberately excluded from the "no
 * --only given" default: each is an add-on pass unrelated to the base
 * frames/portraits/backdrops set (terrain, objects, and decor don't even key
 * off frames.json/pilots.json), so a plain `buildArtPlan(data)` stays exactly
 * what it was before they existed. Ask for them explicitly with
 * `--only poses` / `--only terrain` / `--only objects` / `--only decor`.
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
  if (wantedKinds.has('terrain')) {
    for (const kind of TERRAIN_KINDS) {
      jobs.push(buildTerrainPrompt(kind));
    }
  }
  if (wantedKinds.has('object')) {
    for (const key of OBJECT_KEYS) {
      jobs.push(buildObjectPrompt(key));
    }
  }
  if (wantedKinds.has('decor')) {
    for (const key of DECOR_KEYS) {
      jobs.push(buildDecorPrompt(key));
    }
  }

  const limited = typeof options.limit === 'number' ? jobs.slice(0, Math.max(0, options.limit)) : jobs;

  const counts: ArtPlanCounts = {
    frames: limited.filter((j) => j.kind === 'frame').length,
    portraits: limited.filter((j) => j.kind === 'portrait').length,
    backdrops: limited.filter((j) => j.kind === 'backdrop').length,
    poses: limited.filter((j) => j.kind === 'pose').length,
    terrain: limited.filter((j) => j.kind === 'terrain').length,
    objects: limited.filter((j) => j.kind === 'object').length,
    decor: limited.filter((j) => j.kind === 'decor').length,
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
