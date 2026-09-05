import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FrameDef, PilotDef } from '../../src/sim/types';
import {
  BACKDROP_SCENES,
  buildArtManifest,
  buildArtPlan,
  buildBackdropPrompt,
  buildFramePrompt,
  buildPortraitPrompt,
  eligiblePortraitPilots,
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
  it('builds a fixed-size painted background prompt for a scene', () => {
    const job = buildBackdropPrompt({ key: 'forest', scene: 'forest' });
    expect(job.prompt).toBe('painted anime background, forest, wide shot, no characters, dramatic lighting');
    expect(job.width).toBe(1024);
    expect(job.height).toBe(576);
  });

  it('has exactly the six terrain families from GDD §3/§10', () => {
    expect(BACKDROP_SCENES.map((s) => s.key)).toEqual([
      'space_debris_field',
      'space_station_interior',
      'forest',
      'urban_ruins',
      'mountain_ridge',
      'salt_flats_dust',
    ]);
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
  it('counts 12 frames, 9 pilots x 4 expressions = 36 portraits, 6 backdrops = 54 total', () => {
    const plan = buildArtPlan(data);
    expect(plan.counts).toEqual({ frames: 12, portraits: 36, backdrops: 6, total: 54 });
    expect(plan.jobs).toHaveLength(54);
  });

  it('--only frames restricts to just frame jobs', () => {
    const plan = buildArtPlan(data, { only: ['frames'] });
    expect(plan.counts).toEqual({ frames: 12, portraits: 0, backdrops: 0, total: 12 });
  });

  it('--only portraits restricts to just portrait jobs', () => {
    const plan = buildArtPlan(data, { only: ['portraits'] });
    expect(plan.counts).toEqual({ frames: 0, portraits: 36, backdrops: 0, total: 36 });
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
    writeFileSync(path.join(dir, 'forest.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const manifest = buildArtManifest(plan, {
      rawDir: dir,
      fileExtension: (job) => (job.key === 'forest' ? 'png' : null),
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(manifest.version).toBe(1);
    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0]).toMatchObject({
      key: 'forest',
      kind: 'backdrop',
      rawPath: `${dir}/forest.png`,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
