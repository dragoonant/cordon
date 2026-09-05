import { describe, expect, it } from 'vitest';
import type { ActiveCallout, BattleContext } from './types';
import { forecast } from './forecast';
import { FIXTURE_DATA, makeSide } from './__fixtures__/battleFixtures';

const data = FIXTURE_DATA;

function baseCtx(overrides: Partial<BattleContext> = {}): BattleContext {
  return {
    seed: 42,
    mapKind: 'surface',
    terrain: 'open',
    weather: 'clear',
    calloutsA: [],
    calloutsB: [],
    ...overrides,
  };
}

function sideA() {
  return makeSide(
    data,
    'squad_a',
    'relay',
    [
      { pilotId: 'pilot_ace', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', system: 'system_shield', slot: 0 },
      { pilotId: 'pilot_hotshot', frameId: 'frame_line', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', slot: 1 },
      { pilotId: 'pilot_marksman', frameId: 'frame_line', weaponA: 'weapon_railgun', weaponB: 'weapon_rifle', system: 'system_targeting', slot: 4 },
    ],
    { leaderPilotId: 'pilot_ace' }
  );
}

function sideB() {
  return makeSide(data, 'squad_b', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0 }]);
}

describe('forecast', () => {
  it('is deterministic for the same seed', () => {
    const f1 = forecast(sideA(), sideB(), baseCtx(), data, 50);
    const f2 = forecast(sideA(), sideB(), baseCtx(), data, 50);
    expect(f1).toEqual(f2);
  });

  it('does not mutate its inputs', () => {
    const a = sideA();
    const b = sideB();
    const before = JSON.stringify([a, b]);
    forecast(a, b, baseCtx(), data, 30);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it('keeps winProb/drawProb/lossProb within [0,1] and summing to ~1', () => {
    const f = forecast(sideA(), sideB(), baseCtx(), data, 60);
    for (const p of [f.winProb, f.drawProb, f.lossProb]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(f.winProb + f.drawProb + f.lossProb).toBeCloseTo(1, 5);
  });

  it('perMech has one entry per side-A mech, matching pilot/mech ids', () => {
    const a = sideA();
    const f = forecast(a, sideB(), baseCtx(), data, 30);
    expect(f.perMech.length).toBe(3);
    const ids = new Set(f.perMech.map((m) => m.mechId));
    expect(ids).toEqual(new Set(['mech_pilot_ace', 'mech_pilot_hotshot', 'mech_pilot_marksman']));
    for (const m of f.perMech) {
      expect(m.destroyRisk).toBeGreaterThanOrEqual(0);
      expect(m.destroyRisk).toBeLessThanOrEqual(1);
      expect(m.pilotDeathRisk).toBeGreaterThanOrEqual(0);
      expect(m.pilotDeathRisk).toBeLessThanOrEqual(1);
    }
  });

  it('a heavily favored side has a high winProb', () => {
    const f = forecast(sideA(), sideB(), baseCtx(), data, 80);
    expect(f.winProb).toBeGreaterThan(0.8);
  });

  it('eyes_on makes the forecast exact: variance 0, a single true-seed sample', () => {
    const callout: ActiveCallout = { calloutId: 'co_eyes_on', pilotId: 'pilot_ace' };
    const f = forecast(sideA(), sideB(), baseCtx({ calloutsA: [callout] }), data, 200);
    expect(f.exact).toBe(true);
    expect(f.variance).toBe(0);
    expect(f.samples).toBe(1);
  });

  it('without eyes_on, variance sits within the documented [0.05, 0.35] band', () => {
    const f = forecast(sideA(), sideB(), baseCtx(), data, 20);
    expect(f.exact).toBe(false);
    expect(f.variance).toBeGreaterThanOrEqual(0.05);
    expect(f.variance).toBeLessThanOrEqual(0.35);
  });

  it('a higher-systems leader (and recon systems) narrow the variance band', () => {
    const lowSystemsSide = sideA();
    lowSystemsSide.pilots['pilot_ace'].aptitudes.systems = 0;
    const highSystemsSide = sideA();
    highSystemsSide.pilots['pilot_ace'].aptitudes.systems = 100;
    const fLow = forecast(lowSystemsSide, sideB(), baseCtx(), data, 10);
    const fHigh = forecast(highSystemsSide, sideB(), baseCtx(), data, 10);
    expect(fHigh.variance).toBeLessThan(fLow.variance);
  });

  it('reports default sample count of 200 when not specified', () => {
    const f = forecast(sideA(), sideB(), baseCtx(), data);
    expect(f.samples).toBe(200);
  });

  it('modifiers include terrain, weather, mobility fit, overweight, and callout rows', () => {
    const callout: ActiveCallout = { calloutId: 'co_redline', pilotId: 'pilot_hotshot' };
    const f = forecast(sideA(), sideB(), baseCtx({ calloutsA: [callout] }), data, 10);
    const labels = f.modifiers.map((m) => m.label);
    expect(labels).toContain('Terrain');
    expect(labels).toContain('Weather');
    expect(labels).toContain('Mobility Fit');
    expect(labels).toContain('Overweight');
    expect(labels).toContain('Your Callout');
  });

  it('flags mobility mismatch when a space frame is forced onto a surface map', () => {
    const mismatchedSide = makeSide(data, 'squad_mismatch', 'relay', [{ pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0 }]);
    const f = forecast(mismatchedSide, sideB(), baseCtx({ mapKind: 'surface' }), data, 10);
    const mobilityRow = f.modifiers.find((m) => m.label === 'Mobility Fit')!;
    expect(mobilityRow.good).toBe(false);
  });

  it('handles a degenerate empty side-A squad without throwing', () => {
    const empty = makeSide(data, 'squad_empty', 'relay', []);
    const f = forecast(empty, sideB(), baseCtx(), data, 5);
    expect(f.perMech).toEqual([]);
    expect(f.lossProb).toBe(1);
  });
});
