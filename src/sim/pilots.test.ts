import { describe, expect, it } from 'vitest';
import {
  addBond,
  applyGrowth,
  availableTandems,
  canPilotFly,
  checkNewCerts,
  createPilot,
  grantCert,
  isAce,
  regenNerve,
  tickInjuries,
} from './pilots';
import {
  FIXTURE_DATA,
  frameCompactAceHeavy,
  frameLightGround,
  frameMediumGround,
  pilotHotshot,
  pilotRookie,
  pilotVeteran,
} from './__fixtures__/runFixtures';
import type { Pilot } from './types';

describe('createPilot', () => {
  it('initializes from a PilotDef per the contract', () => {
    const pilot = createPilot(pilotVeteran);
    expect(pilot.id).toBe(pilotVeteran.id);
    expect(pilot.aptitudes).toEqual(pilotVeteran.baseAptitudes);
    expect(pilot.aptitudes).not.toBe(pilotVeteran.baseAptitudes); // copy, not the same object
    expect(pilot.certs).toEqual(pilotVeteran.startingCerts);
    expect(pilot.certs).not.toBe(pilotVeteran.startingCerts);
    expect(pilot.callouts).toEqual(pilotVeteran.startingCallouts);
    expect(pilot.nerve).toBe(pilotVeteran.maxNerve);
    expect(pilot.maxNerve).toBe(pilotVeteran.maxNerve);
    expect(pilot.alive).toBe(true);
    expect(pilot.injuredFor).toBe(0);
    expect(pilot.ace).toBe(false);
    expect(pilot.bonds).toEqual({});
    expect(pilot.morale).toBe(70);
    expect(pilot.kills).toBe(0);
    expect(pilot.battles).toBe(0);
  });
});

describe('checkNewCerts / grantCert', () => {
  it('reports no new certs when thresholds are unmet', () => {
    const pilot = createPilot(pilotRookie); // gunnery 25, melee 25 — below every threshold beyond cert_light
    expect(checkNewCerts(pilot, FIXTURE_DATA)).toEqual([]);
  });

  it('reports a cert once its aptitude threshold is met and it is not already held', () => {
    const pilot = createPilot(pilotRookie);
    pilot.aptitudes.gunnery = 30; // cert_medium requires gunnery >= 30
    expect(checkNewCerts(pilot, FIXTURE_DATA)).toContain('cert_medium');
  });

  it('requires prerequisite certs (cert_heavy needs cert_medium)', () => {
    const pilot = createPilot(pilotRookie);
    pilot.aptitudes.melee = 60; // meets cert_heavy's aptitude requirement...
    expect(checkNewCerts(pilot, FIXTURE_DATA)).not.toContain('cert_heavy'); // ...but not cert_medium yet
    grantCert(pilot, 'cert_medium', FIXTURE_DATA);
    expect(checkNewCerts(pilot, FIXTURE_DATA)).toContain('cert_heavy');
  });

  it('does not re-report an already-held cert', () => {
    const pilot = createPilot(pilotVeteran); // already holds cert_light/medium/heavy
    expect(checkNewCerts(pilot, FIXTURE_DATA)).not.toContain('cert_light');
    expect(checkNewCerts(pilot, FIXTURE_DATA)).not.toContain('cert_medium');
    expect(checkNewCerts(pilot, FIXTURE_DATA)).not.toContain('cert_heavy');
  });

  it('grantCert mutates certs and adds granted callouts, and is a no-op if already held', () => {
    const pilot = createPilot(pilotRookie);
    const before = pilot.callouts.length;
    grantCert(pilot, 'cert_medium', FIXTURE_DATA);
    expect(pilot.certs).toContain('cert_medium');
    expect(pilot.callouts).toContain('co_pre_break_formation'); // cert_medium.grantsCallouts
    expect(pilot.callouts.length).toBe(before + 1);
    grantCert(pilot, 'cert_medium', FIXTURE_DATA); // no-op
    expect(pilot.certs.filter((c) => c === 'cert_medium').length).toBe(1);
    expect(pilot.callouts.length).toBe(before + 1);
  });
});

describe('applyGrowth', () => {
  it('scales gains by def.growth and rounds to 1 decimal', () => {
    const pilot = createPilot(pilotRookie); // growth 1.6 on every aptitude
    applyGrowth(pilot, { gunnery: 1 }, pilotRookie);
    expect(pilot.aptitudes.gunnery).toBeCloseTo(pilotRookie.baseAptitudes.gunnery + 1.6, 5);
  });

  it('clamps to [0, 100]', () => {
    const pilot = createPilot(pilotRookie);
    applyGrowth(pilot, { gunnery: 1000 }, pilotRookie);
    expect(pilot.aptitudes.gunnery).toBe(100);
    applyGrowth(pilot, { melee: -1000 }, pilotRookie);
    expect(pilot.aptitudes.melee).toBe(0);
  });

  it('leaves aptitudes not present in gains untouched', () => {
    const pilot = createPilot(pilotRookie);
    const before = { ...pilot.aptitudes };
    applyGrowth(pilot, { gunnery: 5 }, pilotRookie);
    expect(pilot.aptitudes.melee).toBe(before.melee);
    expect(pilot.aptitudes.command).toBe(before.command);
  });
});

describe('regenNerve', () => {
  it('clamps to [0, maxNerve]', () => {
    const pilot = createPilot(pilotVeteran);
    pilot.nerve = 10;
    regenNerve(pilot, 5);
    expect(pilot.nerve).toBe(15);
    regenNerve(pilot, 1000);
    expect(pilot.nerve).toBe(pilot.maxNerve);
    regenNerve(pilot, -1000);
    expect(pilot.nerve).toBe(0);
  });
});

describe('addBond / availableTandems', () => {
  it('adds symmetric bond points', () => {
    const a = createPilot(pilotVeteran);
    const b = createPilot(pilotHotshot);
    addBond(a, b, 10);
    expect(a.bonds[b.id]).toBe(10);
    expect(b.bonds[a.id]).toBe(10);
    addBond(a, b, 5);
    expect(a.bonds[b.id]).toBe(15);
    expect(b.bonds[a.id]).toBe(15);
  });

  it('unlocks tandems only once the bond threshold is met', () => {
    const a = createPilot(pilotVeteran);
    const b = createPilot(pilotHotshot);
    expect(availableTandems(a, b, FIXTURE_DATA)).toEqual([]);
    addBond(a, b, 20); // pilotVeteran.bondPartners threshold is 20
    expect(availableTandems(a, b, FIXTURE_DATA)).toContain('co_td_cross_fire');
  });

  it('returns no tandems for an unrelated pair', () => {
    const a = createPilot(pilotVeteran);
    const c = createPilot(pilotRookie);
    addBond(a, c, 100);
    expect(availableTandems(a, c, FIXTURE_DATA)).toEqual([]);
  });
});

describe('canPilotFly', () => {
  it('gates by weight cert', () => {
    const rookie = createPilot(pilotRookie); // cert_light only
    expect(canPilotFly(rookie, frameLightGround)).toBe(true);
    expect(canPilotFly(rookie, frameMediumGround)).toBe(false);
    expect(canPilotFly(rookie, frameCompactAceHeavy)).toBe(false);
  });

  it('a fully certified pilot can fly every weight class', () => {
    const veteran = createPilot(pilotVeteran); // cert_light + cert_medium + cert_heavy
    expect(canPilotFly(veteran, frameLightGround)).toBe(true);
    expect(canPilotFly(veteran, frameMediumGround)).toBe(true);
    expect(canPilotFly(veteran, frameCompactAceHeavy)).toBe(true);
  });
});

describe('tickInjuries', () => {
  it('decrements injuredFor with a floor of 0', () => {
    const pilots: Record<string, Pilot> = {
      a: { ...createPilot(pilotRookie), injuredFor: 2 },
      b: { ...createPilot(pilotVeteran), injuredFor: 0 },
    };
    tickInjuries(pilots);
    expect(pilots.a.injuredFor).toBe(1);
    expect(pilots.b.injuredFor).toBe(0);
    tickInjuries(pilots);
    tickInjuries(pilots);
    expect(pilots.a.injuredFor).toBe(0);
  });

  it('handles an empty roster (degenerate input)', () => {
    expect(() => tickInjuries({})).not.toThrow();
  });
});

describe('isAce', () => {
  it('is true only at/above the kill threshold', () => {
    const pilot = createPilot(pilotVeteran);
    pilot.kills = 7;
    expect(isAce(pilot)).toBe(false);
    pilot.kills = 8;
    expect(isAce(pilot)).toBe(true);
  });
});
