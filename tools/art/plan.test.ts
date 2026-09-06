import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FrameDef, PilotDef } from '../../src/sim/types';
import {
  BACKDROP_TERRAINS,
  buildArtManifest,
  buildArtPlan,
  buildBackdropJobs,
  buildBackdropPrompt,
  buildDecorPrompt,
  buildFramePrompt,
  buildObjectPrompt,
  buildPlatePrompt,
  buildPortraitPrompt,
  buildPosePrompt,
  buildTerrainPrompt,
  buildTerrainVariantPrompt,
  DECOR_KEYS,
  eligiblePortraitPilots,
  OBJECT_KEYS,
  PLATE_KEYS,
  TERRAIN_KINDS,
  TERRAIN_VARIANT_COUNTS,
} from './plan';

// ---------------------------------------------------------------------------
// Fixtures: 12 frames (mixed silhouette/faction), 9 eligible pilots (8 relay
// non-captain + 1 rival), plus a captain and a compact grunt that must be
// excluded — matching the spec's expected fixture counts (12 / 36 / 6 = 54).
// ---------------------------------------------------------------------------

function frame(id: string, silhouette: FrameDef['silhouette'], faction: FrameDef['faction']): FrameDef {
  return {
    id,
    name: id,
    faction,
    weightClass: 'medium',
    mobility: 'ground',
    hp: 100,
    armor: 5,
    evasion: 10,
    speed: 3,
    generator: 10,
    weight: 5,
    spriteKey: id,
    description: 'fixture frame',
    silhouette,
    unlockedByDefault: true,
  };
}

const frames: Record<string, FrameDef> = Object.fromEntries(
  [
    frame('frame_skirmish_a', 'skirmish', 'relay'),
    frame('frame_skirmish_b', 'skirmish', 'relay'),
    frame('frame_line_a', 'line', 'relay'),
    frame('frame_line_b', 'line', 'relay'),
    frame('frame_bastion_a', 'bastion', 'relay'),
    frame('frame_bastion_b', 'bastion', 'relay'),
    frame('frame_recon_a', 'recon', 'relay'),
    frame('frame_siege_a', 'siege', 'relay'),
    frame('frame_siege_b', 'siege', 'relay'),
    frame('frame_compact_ace_a', 'compact_ace', 'compact'),
    frame('frame_compact_line_a', 'compact_line', 'compact'),
    frame('frame_compact_line_b', 'compact_line', 'compact'),
  ].map((f) => [f.id, f])
);

const baseAptitudes = { gunnery: 40, melee: 40, evasion: 40, systems: 40, command: 40 };
const baseGrowth = { gunnery: 1, melee: 1, evasion: 1, systems: 1, command: 1 };

function pilot(id: string, archetype: PilotDef['archetype'], faction: PilotDef['faction'], bio: string): PilotDef {
  return {
    id,
    name: id,
    callsign: id,
    archetype,
    faction,
    baseAptitudes,
    growth: baseGrowth,
    startingCerts: [],
    startingCallouts: [],
    lastTransmissionId: 'lt_default',
    maxNerve: 100,
    portraitKey: id,
    voiceKey: id,
    bio,
    lines: {
      deploy: ['go'],
      attack: ['fire'],
      crit: ['crit'],
      kill: ['down'],
      hit: ['ow'],
      allyDown: ['no'],
      victory: ['won'],
      retreat: ['back'],
      finisher: 'Finisher line.',
      finisherName: 'Finisher',
    },
    unlockedByDefault: true,
    bondPartners: [],
  };
}

const pilots: Record<string, PilotDef> = Object.fromEntries(
  [
    pilot('pilot_veteran', 'veteran', 'relay', 'Was Compact once.'),
    pilot('pilot_hotshot', 'hotshot', 'relay', 'Redlines everything.'),
    pilot('pilot_marksman', 'marksman', 'relay', 'Quiet. Highest Systems.'),
    pilot('pilot_rookie', 'rookie', 'relay', 'Lowest stats, fastest growth.'),
    pilot('pilot_engineer', 'engineer', 'relay', 'Talks to the frames.'),
    pilot('pilot_scout', 'scout', 'relay', 'Sees the map others don’t.'),
    pilot('pilot_salvager', 'salvager', 'relay', 'Fights for what’s left.'),
    pilot('pilot_wildcard', 'wildcard', 'relay', 'Tied to the rival’s story.'),
    pilot('pilot_rival', 'rival', 'compact', 'A named Compact ace.'),
    // Must be excluded from portraits:
    pilot('pilot_captain', 'captain', 'relay', 'Runs the Lantern.'),
    pilot('pilot_grunt', 'compact_grunt', 'compact', 'Enemy mook.'),
  ].map((p) => [p.id, p])
);

const data = { frames, pilots };

describe('buildFramePrompt', () => {
  it('produces a stable string per silhouette/faction combination', () => {
    const relaySkirmish = buildFramePrompt(frames.frame_skirmish_a);
    expect(relaySkirmish.prompt).toBe(
      'SD chibi mecha, super-deformed proportions, 2.5 heads tall, oversized head and torso, ' +
        'stubby limbs, huge shoulder pauldrons, lightweight scout mech silhouette, slim limbs, angular thruster fins, ' +
        'gunmetal and bone white with amber-orange accents, full body, facing right, ' +
        'clean cel-shaded anime style, flat colors, thick outlines, plain solid #00ff00 green background, ' +
        'centered, no text'
    );
    expect(relaySkirmish.negativePrompt).toBe('realistic, photo, blurry, text, watermark, multiple robots, cropped');
    expect(relaySkirmish.width).toBe(512);
    expect(relaySkirmish.height).toBe(512);
  });

  it('swaps in the compact palette for compact-faction frames, same silhouette otherwise', () => {
    const compactLine = buildFramePrompt(frames.frame_compact_line_a);
    expect(compactLine.prompt).toContain('steel grey and white with steel-blue accents');
    expect(compactLine.prompt).not.toContain('amber-orange');
  });

  it('is a pure function of the frame (calling twice gives identical output)', () => {
    const a = buildFramePrompt(frames.frame_bastion_a);
    const b = buildFramePrompt(frames.frame_bastion_a);
    expect(a).toEqual(b);
  });
});

describe('buildPortraitPrompt', () => {
  it('includes archetype and bio as descriptors, and the requested expression', () => {
    const job = buildPortraitPrompt(pilots.pilot_veteran, 'shout');
    expect(job.key).toBe('pilot_veteran_shout');
    expect(job.prompt).toContain('veteran pilot');
    expect(job.prompt).toContain('Was Compact once.');
    expect(job.prompt).toContain('expression: shouting');
    expect(job.width).toBe(512);
    expect(job.height).toBe(512);
  });
});

describe('buildBackdropPrompt', () => {
  it('builds a fixed-size painted background prompt for a terrain variant', () => {
    const job = buildBackdropPrompt('forest', 1, 'dense conifer forest edge');
    expect(job.key).toBe('bg_forest_1');
    expect(job.kind).toBe('backdrop');
    expect(job.prompt).toBe(
      'painted anime background, wide cinematic shot, dense conifer forest edge, horizon around the lower third, ' +
        'empty foreground ground plane for characters to stand on, no characters, no mechs, no text, ' +
        'cel-shaded, muted desaturated palette with one warm accent, dramatic sky/lighting'
    );
    expect(job.width).toBe(1024);
    expect(job.height).toBe(576);
  });

  it('is a pure function of its args (calling twice gives identical output)', () => {
    expect(buildBackdropPrompt('urban', 2, 'rooftop skyline at dusk with smoke')).toEqual(
      buildBackdropPrompt('urban', 2, 'rooftop skyline at dusk with smoke')
    );
  });
});

describe('buildBackdropJobs', () => {
  it('has exactly the 10 battle-eligible terrain families from src/sim/types.ts (all Terrain kinds except blocked)', () => {
    expect(BACKDROP_TERRAINS).toEqual([
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
    ]);
  });

  it('builds 2 variants per terrain, keyed bg_<terrain>_<n>, 20 jobs total', () => {
    const jobs = buildBackdropJobs();
    expect(jobs).toHaveLength(20);
    expect(jobs.every((j) => j.kind === 'backdrop')).toBe(true);
    for (const terrain of BACKDROP_TERRAINS) {
      expect(jobs.map((j) => j.key)).toContain(`bg_${terrain}_1`);
      expect(jobs.map((j) => j.key)).toContain(`bg_${terrain}_2`);
    }
  });
});

describe('eligiblePortraitPilots', () => {
  it('includes relay non-captain pilots and the rival, excludes captain and other compact pilots', () => {
    const ids = eligiblePortraitPilots(pilots).map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        'pilot_engineer',
        'pilot_hotshot',
        'pilot_marksman',
        'pilot_rival',
        'pilot_rookie',
        'pilot_salvager',
        'pilot_scout',
        'pilot_veteran',
        'pilot_wildcard',
      ].sort()
    );
    expect(ids).toHaveLength(9);
  });
});

describe('buildArtPlan', () => {
  it('counts 12 frames, 9 pilots x 4 expressions = 36 portraits, 20 backdrops = 68 total (poses/terrain/objects/decor excluded by default)', () => {
    const plan = buildArtPlan(data);
    expect(plan.counts).toEqual({ frames: 12, portraits: 36, backdrops: 20, poses: 0, terrain: 0, terrainVariants: 0, objects: 0, decor: 0, plates: 0, total: 68 });
    expect(plan.jobs).toHaveLength(68);
  });

  it('--only frames restricts to just frame jobs', () => {
    const plan = buildArtPlan(data, { only: ['frames'] });
    expect(plan.counts).toEqual({ frames: 12, portraits: 0, backdrops: 0, poses: 0, terrain: 0, terrainVariants: 0, objects: 0, decor: 0, plates: 0, total: 12 });
  });

  it('--only portraits restricts to just portrait jobs', () => {
    const plan = buildArtPlan(data, { only: ['portraits'] });
    expect(plan.counts).toEqual({ frames: 0, portraits: 36, backdrops: 0, poses: 0, terrain: 0, terrainVariants: 0, objects: 0, decor: 0, plates: 0, total: 36 });
  });

  it('--only poses restricts to just the 12 combat-pose jobs, one per frame', () => {
    const plan = buildArtPlan(data, { only: ['poses'] });
    expect(plan.counts).toEqual({ frames: 0, portraits: 0, backdrops: 0, poses: 12, terrain: 0, terrainVariants: 0, objects: 0, decor: 0, plates: 0, total: 12 });
    expect(plan.jobs.map((j) => j.key).sort()).toEqual(
      Object.keys(frames)
        .map((id) => `${frames[id].spriteKey}_attack`)
        .sort()
    );
  });

  it('--only terrain restricts to just the 11 terrain jobs, one per Terrain kind', () => {
    const plan = buildArtPlan(data, { only: ['terrain'] });
    expect(plan.counts).toEqual({ frames: 0, portraits: 0, backdrops: 0, poses: 0, terrain: 11, terrainVariants: 0, objects: 0, decor: 0, plates: 0, total: 11 });
    expect(plan.jobs.map((j) => j.key).sort()).toEqual(TERRAIN_KINDS.map((k) => `terrain_${k}`).sort());
  });

  it('--only terrain-variants restricts to just the 22 terrain variant jobs', () => {
    const plan = buildArtPlan(data, { only: ['terrain-variants'] });
    expect(plan.counts).toEqual({
      frames: 0,
      portraits: 0,
      backdrops: 0,
      poses: 0,
      terrain: 0,
      terrainVariants: 22,
      objects: 0,
      decor: 0,
      plates: 0,
      total: 22,
    });
    expect(plan.jobs.every((j) => j.kind === 'terrainVariant')).toBe(true);
  });

  it('--only objects restricts to just the 8 map object jobs', () => {
    const plan = buildArtPlan(data, { only: ['objects'] });
    expect(plan.counts).toEqual({ frames: 0, portraits: 0, backdrops: 0, poses: 0, terrain: 0, terrainVariants: 0, objects: 8, decor: 0, plates: 0, total: 8 });
    expect(plan.jobs.map((j) => j.key).sort()).toEqual(OBJECT_KEYS.map((k) => `obj_${k}`).sort());
  });

  it('--only decor restricts to just the 10 decoration/scenery jobs', () => {
    const plan = buildArtPlan(data, { only: ['decor'] });
    expect(plan.counts).toEqual({ frames: 0, portraits: 0, backdrops: 0, poses: 0, terrain: 0, terrainVariants: 0, objects: 0, decor: 10, plates: 0, total: 10 });
    expect(plan.jobs.map((j) => j.key).sort()).toEqual(DECOR_KEYS.map((k) => `deco_${k}`).sort());
  });

  it('--only plates restricts to just the 8 ground-plate jobs', () => {
    const plan = buildArtPlan(data, { only: ['plates'] });
    expect(plan.counts).toEqual({ frames: 0, portraits: 0, backdrops: 0, poses: 0, terrain: 0, terrainVariants: 0, objects: 0, decor: 0, plates: 8, total: 8 });
    expect(plan.jobs.map((j) => j.key).sort()).toEqual([...PLATE_KEYS].sort());
    expect(plan.jobs.every((j) => j.kind === 'plate')).toBe(true);
  });

  it('--limit caps the total job count', () => {
    const plan = buildArtPlan(data, { limit: 5 });
    expect(plan.jobs).toHaveLength(5);
    expect(plan.counts.total).toBe(5);
    // Frames are built first, so a limit of 5 should be all frame jobs.
    expect(plan.jobs.every((j) => j.kind === 'frame')).toBe(true);
  });

  it('--limit of 0 produces an empty plan', () => {
    const plan = buildArtPlan(data, { limit: 0 });
    expect(plan.jobs).toHaveLength(0);
    expect(plan.counts.total).toBe(0);
  });
});

describe('buildTerrainPrompt', () => {
  it('has exactly the 11 Terrain kinds, matching the sim Terrain union', () => {
    expect(TERRAIN_KINDS).toEqual([
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
    ]);
  });

  it('keys the job "terrain_<kind>" and describes a seamless top-down texture', () => {
    const job = buildTerrainPrompt('forest');
    expect(job.key).toBe('terrain_forest');
    expect(job.kind).toBe('terrain');
    expect(job.prompt).toContain('seamless tileable texture, top-down');
    expect(job.prompt).toContain('dense treetops');
    expect(job.prompt).not.toContain('#00ff00');
    expect(job.width).toBe(512);
    expect(job.height).toBe(512);
  });

  it('is a pure function of the kind (calling twice gives identical output)', () => {
    expect(buildTerrainPrompt('gravity')).toEqual(buildTerrainPrompt('gravity'));
  });
});

describe('buildTerrainVariantPrompt', () => {
  it('sums to 22 variants across urban(6)/open(4)/forest(3)/mountain(2)/debris(2)/void(2)/structure(2)/radiation(1)', () => {
    expect(TERRAIN_VARIANT_COUNTS).toEqual({
      urban: 6,
      open: 4,
      forest: 3,
      mountain: 2,
      debris: 2,
      void: 2,
      structure: 2,
      radiation: 1,
    });
    const total = Object.values(TERRAIN_VARIANT_COUNTS).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBe(22);
  });

  it('keys the job "terrain_<kind>_<n>" and reuses the buildTerrainPrompt scaffold with the given description', () => {
    const job = buildTerrainVariantPrompt('urban', 2, 'a wide central boulevard');
    expect(job.key).toBe('terrain_urban_2');
    expect(job.kind).toBe('terrainVariant');
    expect(job.prompt).toContain('seamless tileable texture, top-down');
    expect(job.prompt).toContain('a wide central boulevard');
    expect(job.prompt).not.toContain('#00ff00');
    expect(job.width).toBe(512);
    expect(job.height).toBe(512);
  });

  it('carries the debris-specific negative-prompt extra (avoid a single hero wreck) same as buildTerrainPrompt', () => {
    const job = buildTerrainVariantPrompt('debris', 1, 'fine scattered wreckage');
    expect(job.negativePrompt).toContain('single large vehicle');
  });

  it('is a pure function of its args (calling twice gives identical output)', () => {
    expect(buildTerrainVariantPrompt('forest', 1, 'dense canopy')).toEqual(
      buildTerrainVariantPrompt('forest', 1, 'dense canopy')
    );
  });
});

describe('buildObjectPrompt', () => {
  it('has exactly the 8 documented map object keys', () => {
    expect(OBJECT_KEYS).toEqual([
      'station',
      'colony',
      'convoy',
      'derelict',
      'relay',
      'exit',
      'carrier',
      'landing_zone',
    ]);
  });

  it('keys the job "obj_<key>", uses an isometric 3/4 view on a green-key background', () => {
    const job = buildObjectPrompt('carrier');
    expect(job.key).toBe('obj_carrier');
    expect(job.kind).toBe('object');
    expect(job.prompt).toContain('isometric 3/4 view');
    expect(job.prompt).toContain('rescue carrier spaceship');
    expect(job.prompt).toContain('plain solid #00ff00 green background');
    expect(job.width).toBe(512);
    expect(job.height).toBe(512);
  });

  it('is a pure function of the key (calling twice gives identical output)', () => {
    expect(buildObjectPrompt('station')).toEqual(buildObjectPrompt('station'));
  });
});

describe('buildDecorPrompt', () => {
  it('has exactly the 10 documented decor/scenery keys', () => {
    expect(DECOR_KEYS).toEqual([
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
    ]);
  });

  it('keys the job "deco_<key>", uses an isometric 3/4 view on a green-key background', () => {
    const job = buildDecorPrompt('crystal_shard');
    expect(job.key).toBe('deco_crystal_shard');
    expect(job.kind).toBe('decor');
    expect(job.prompt).toContain('isometric 3/4 view');
    expect(job.prompt).toContain('glowing violet crystal shards');
    expect(job.prompt).toContain('#00ff00 chroma-key green screen background');
    expect(job.width).toBe(512);
    expect(job.height).toBe(512);
  });

  it('is a pure function of the key (calling twice gives identical output)', () => {
    expect(buildDecorPrompt('rock_a')).toEqual(buildDecorPrompt('rock_a'));
  });
});

describe('buildPlatePrompt', () => {
  it('has exactly the 8 documented ground-plate keys', () => {
    expect(PLATE_KEYS).toEqual([
      'plate_space_a',
      'plate_space_b',
      'plate_ocean',
      'plate_shore',
      'plate_plains',
      'plate_forest',
      'plate_city',
      'plate_ice',
    ]);
  });

  it('keys the job by the plate key itself and describes a large painted top-down scene, no green key', () => {
    const job = buildPlatePrompt('plate_forest');
    expect(job.key).toBe('plate_forest');
    expect(job.kind).toBe('plate');
    expect(job.prompt).toContain('top-down painted background, seen straight from above');
    expect(job.prompt).toContain('dark green forest canopy');
    expect(job.prompt).not.toContain('#00ff00');
    expect(job.prompt).not.toContain('seamless tileable');
    expect(job.width).toBe(1024);
    expect(job.height).toBe(1024);
  });

  it('is a pure function of the key (calling twice gives identical output)', () => {
    expect(buildPlatePrompt('plate_ice')).toEqual(buildPlatePrompt('plate_ice'));
  });
});

describe('buildPosePrompt', () => {
  it('keys the job "<spriteKey>_attack" and describes a ranged aiming pose for non-melee silhouettes', () => {
    const job = buildPosePrompt(frames.frame_line_a);
    expect(job.key).toBe('frame_line_a_attack');
    expect(job.kind).toBe('pose');
    expect(job.prompt).toContain('aiming its weapon straight to the RIGHT edge of the image');
    expect(job.prompt).toContain('gunmetal and bone white with amber-orange accents');
    expect(job.width).toBe(512);
    expect(job.height).toBe(512);
  });

  it('describes a melee lunge for skirmish and compact_ace silhouettes', () => {
    expect(buildPosePrompt(frames.frame_skirmish_a).prompt).toContain('lunging to the right thrusting a lance/blade');
    expect(buildPosePrompt(frames.frame_compact_ace_a).prompt).toContain('lunging to the right thrusting a lance/blade');
  });

  it('is a pure function of the frame (calling twice gives identical output)', () => {
    expect(buildPosePrompt(frames.frame_bastion_a)).toEqual(buildPosePrompt(frames.frame_bastion_a));
  });
});

describe('buildArtManifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cordon-art-manifest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('only includes jobs whose raw file exists, with prompt and timestamp', () => {
    const plan = buildArtPlan(data, { only: ['backdrops'] });
    writeFileSync(path.join(dir, 'bg_forest_1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const manifest = buildArtManifest(plan, {
      rawDir: dir,
      fileExtension: (job) => (job.key === 'bg_forest_1' ? 'png' : null),
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(manifest.version).toBe(1);
    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0]).toMatchObject({
      key: 'bg_forest_1',
      kind: 'backdrop',
      rawPath: `${dir}/bg_forest_1.png`,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
