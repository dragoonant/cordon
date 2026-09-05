import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalloutDef, CertificationDef, Certification, PilotDef } from '../../src/sim/types';
import { buildManifest, buildVoicePlan, eligiblePilots } from './plan';

// ---------------------------------------------------------------------------
// Small inline fixtures — deliberately not the real src/data content (which
// this tool must not depend on at compile time; it reads real JSON from disk
// at runtime instead). Just enough shape to exercise the planning rules.
// ---------------------------------------------------------------------------

function pilotLines(finisherText: string) {
  return {
    deploy: ['go'],
    attack: ['fire'],
    crit: ['crit'],
    kill: ['down'],
    hit: ['ow'],
    allyDown: ['no'],
    victory: ['won'],
    retreat: ['fall back'],
    finisher: finisherText,
    finisherName: 'Finisher',
  };
}

const baseAptitudes = { gunnery: 40, melee: 40, evasion: 40, systems: 40, command: 40 };

function pilot(overrides: Partial<PilotDef> & Pick<PilotDef, 'id' | 'archetype' | 'faction'>): PilotDef {
  const base = {
    name: overrides.id,
    callsign: overrides.id,
    baseAptitudes,
    growth: { gunnery: 1, melee: 1, evasion: 1, systems: 1, command: 1 },
    startingCerts: [],
    startingCallouts: [],
    lastTransmissionId: 'lt_default',
    maxNerve: 100,
    portraitKey: overrides.id,
    voiceKey: 'default',
    bio: 'Fixture pilot.',
    lines: pilotLines('Finisher line.'),
    unlockedByDefault: true,
    bondPartners: [],
  };
  return { ...base, ...overrides };
}

function callout(id: string, kind: CalloutDef['kind'], line: string): CalloutDef {
  return {
    id,
    effect: 'eyes_on',
    kind,
    line,
    label: id,
    description: 'desc',
    tradeoff: 'cost',
    nerveCost: 10,
  };
}

function cert(id: Certification, grants: string[]): CertificationDef {
  return { id, name: id, description: 'd', requires: {}, requiresCerts: [], grantsCallouts: grants };
}

const callouts: Record<string, CalloutDef> = {
  co_eyes_on: callout('co_eyes_on', 'prebattle', 'Eyes on.'),
  co_break_formation: callout('co_break_formation', 'prebattle', 'Break formation!'),
  co_burn_hard: callout('co_burn_hard', 'overworld', 'Burn hard.'),
  lt_default: callout('lt_default', 'last', 'Take the frame.'),
  lt_hotshot: callout('lt_hotshot', 'last', "Don't you dare stop for me."),
  co_tandem: callout('co_tandem', 'tandem', 'Cross-fire!'), // must never be pulled in as (a)
};

const certs: Record<string, CertificationDef> = {
  cert_marksman: cert('cert_marksman', ['co_break_formation']),
  cert_recon: cert('cert_recon', ['co_burn_hard', 'co_tandem']), // co_tandem must be excluded (wrong kind)
};

const pilots: Record<string, PilotDef> = {
  pilot_veteran: pilot({ id: 'pilot_veteran', archetype: 'veteran', faction: 'relay', startingCallouts: ['co_eyes_on'] }),
  pilot_captain: pilot({ id: 'pilot_captain', archetype: 'captain', faction: 'relay', startingCallouts: ['co_eyes_on'] }),
  pilot_rival: pilot({
    id: 'pilot_rival',
    archetype: 'rival',
    faction: 'compact',
    lastTransmissionId: 'lt_default',
  }),
  pilot_hotshot: pilot({
    id: 'pilot_hotshot',
    archetype: 'hotshot',
    faction: 'relay',
    lastTransmissionId: 'lt_hotshot',
  }),
};

const data = { pilots, callouts, certs };

describe('eligiblePilots', () => {
  it('includes relay non-captain pilots and any rival, excludes captain and other factions', () => {
    const ids = eligiblePilots(pilots).map((p) => p.id).sort();
    expect(ids).toEqual(['pilot_hotshot', 'pilot_rival', 'pilot_veteran']);
  });
});

describe('buildVoicePlan', () => {
  it('collects starting callouts, cert-granted prebattle/overworld callouts, last transmission, and finisher', () => {
    const plan = buildVoicePlan(data);
    const veteran = plan.pilots.find((p) => p.pilotId === 'pilot_veteran')!;
    const keys = veteran.lines.map((l) => l.lineKey).sort();
    // co_eyes_on (starting) + co_break_formation & co_burn_hard (cert-granted, any cert) + last + finisher
    expect(keys).toEqual(['co_break_formation', 'co_burn_hard', 'co_eyes_on', 'finisher', 'last']);
  });

  it('excludes tandem-kind callouts even if a cert grants them', () => {
    const plan = buildVoicePlan(data);
    for (const p of plan.pilots) {
      expect(p.lines.some((l) => l.lineKey === 'co_tandem')).toBe(false);
    }
  });

  it('gives each pilot their own last transmission and finisher text', () => {
    const plan = buildVoicePlan(data);
    const hotshot = plan.pilots.find((p) => p.pilotId === 'pilot_hotshot')!;
    const last = hotshot.lines.find((l) => l.lineKey === 'last')!;
    expect(last.text).toBe("Don't you dare stop for me.");
    const finisher = hotshot.lines.find((l) => l.lineKey === 'finisher')!;
    expect(finisher.category).toBe('finisher');
  });

  it('never includes the captain', () => {
    const plan = buildVoicePlan(data);
    expect(plan.pilots.some((p) => p.pilotId === 'pilot_captain')).toBe(false);
  });

  it('--only restricts to the given pilot ids', () => {
    const plan = buildVoicePlan(data, { only: ['pilot_veteran'] });
    expect(plan.pilots.map((p) => p.pilotId)).toEqual(['pilot_veteran']);
  });

  it('--lines restricts each pilot to the given line keys', () => {
    const plan = buildVoicePlan(data, { lines: ['last'] });
    for (const p of plan.pilots) {
      expect(p.lines.every((l) => l.lineKey === 'last')).toBe(true);
    }
  });

  it('trims (a)-category lines by pilot order of appearance once over max-chars, never dropping last/finisher', () => {
    // With an unreachable cap (5 chars), every pilot's callout lines get
    // dropped in order of appearance (veteran, rival, hotshot); last and
    // finisher lines are never touched, so a floor remains even after
    // trimming everything droppable.
    const plan = buildVoicePlan(data, { maxChars: 5 });

    // Uncapped total is 185 (63 + 55 + 67); after dropping every callout
    // line (34 + 26 + 26 = 86 chars across 7 lines) only last+finisher
    // remain: 99 chars.
    expect(plan.totalChars).toBe(99);
    expect(plan.dropped).toHaveLength(7);
    expect(plan.dropped.reduce((n, d) => n + d.chars, 0)).toBe(86);

    for (const d of plan.dropped) {
      expect(d.lineKey).not.toBe('last');
      expect(d.lineKey).not.toBe('finisher');
    }
    for (const p of plan.pilots) {
      expect(p.lines.some((l) => l.category === 'last')).toBe(true);
      expect(p.lines.some((l) => l.category === 'finisher')).toBe(true);
      expect(p.lines.every((l) => l.category !== 'callout')).toBe(true);
    }
  });

  it('stops trimming as soon as the total is back under the cap (keeps later pilots intact)', () => {
    // Dropping only pilot_veteran's callout lines (34 chars) brings 185 down
    // to 151, comfortably under a 160 cap — rival and hotshot should be untouched.
    const plan = buildVoicePlan(data, { maxChars: 160 });
    expect(plan.totalChars).toBe(151);
    expect(plan.dropped.map((d) => d.pilotId)).toEqual(['pilot_veteran', 'pilot_veteran', 'pilot_veteran']);
    const rival = plan.pilots.find((p) => p.pilotId === 'pilot_rival')!;
    const hotshot = plan.pilots.find((p) => p.pilotId === 'pilot_hotshot')!;
    expect(rival.lines.some((l) => l.category === 'callout')).toBe(true);
    expect(hotshot.lines.some((l) => l.category === 'callout')).toBe(true);
  });

  it('reports zero drops when comfortably under the cap', () => {
    const plan = buildVoicePlan(data, { maxChars: 100000 });
    expect(plan.dropped).toEqual([]);
    expect(plan.totalChars).toBeGreaterThan(0);
  });
});

describe('buildManifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cordon-voice-manifest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('only includes lines whose audio file actually exists on disk', () => {
    const plan = buildVoicePlan(data, { only: ['pilot_veteran'] });
    mkdirSync(path.join(dir, 'pilot_veteran'), { recursive: true });
    writeFileSync(path.join(dir, 'pilot_veteran', 'co_eyes_on.mp3'), 'fake-mp3');
    writeFileSync(path.join(dir, 'pilot_veteran', 'last.mp3'), 'fake-mp3');
    // Deliberately do NOT create finisher.mp3 or the cert-granted callout files.

    const manifest = buildManifest(plan, dir);

    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.pilots.pilot_veteran).sort()).toEqual(['co_eyes_on', 'last']);
    expect(manifest.pilots.pilot_veteran.co_eyes_on).toBe('/audio/voice/pilot_veteran/co_eyes_on.mp3');
  });

  it('omits a pilot entirely when none of their files exist', () => {
    const plan = buildVoicePlan(data, { only: ['pilot_rival'] });
    // dir exists but is empty — no pilot_rival subfolder at all.
    const manifest = buildManifest(plan, dir);
    expect(manifest.pilots.pilot_rival).toBeUndefined();
  });
});
