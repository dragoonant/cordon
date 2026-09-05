import { describe, expect, it } from 'vitest';
import { RULES, effectiveStats, mechLoad, mobilityPenalty, overweightEvasionPenalty, terrainModifiers, weatherModifiers } from './rules';
import { FIXTURE_DATA, makeMechInstance, makePilotInstance } from './__fixtures__/battleFixtures';

describe('RULES constants', () => {
  it('matches the API contract values', () => {
    expect(RULES.ROUNDS).toBe(6);
    expect(RULES.SQUAD_SLOTS).toBe(6);
    expect(RULES.ROW_DEFENSE_BONUS).toBe(0.6);
    expect(RULES.CRIT_MULT).toBe(1.5);
    expect(RULES.ACE_KILLS).toBe(8);
    expect(RULES.MORALE_ROUT_THRESHOLD).toBe(20);
    expect(RULES.BASE_EJECT_CHANCE).toBe(0.55);
    expect(RULES.OVERWEIGHT_EVASION_PENALTY).toBeGreaterThan(0);
  });
});

describe('mobilityPenalty', () => {
  it('penalizes a space frame on a surface map', () => {
    expect(mobilityPenalty('space', 'surface')).toEqual({ evasion: -15, speedMult: 0.7, accuracy: -10 });
  });
  it('penalizes a ground frame on a space map', () => {
    expect(mobilityPenalty('ground', 'space')).toEqual({ evasion: -20, speedMult: 0.6, accuracy: -5 });
  });
  it('leaves a well-fit frame alone', () => {
    expect(mobilityPenalty('space', 'space')).toEqual({ evasion: 0, speedMult: 1, accuracy: 0 });
    expect(mobilityPenalty('ground', 'surface')).toEqual({ evasion: 0, speedMult: 1, accuracy: 0 });
  });
  it('never penalizes aerospace', () => {
    expect(mobilityPenalty('aerospace', 'surface')).toEqual({ evasion: 0, speedMult: 1, accuracy: 0 });
    expect(mobilityPenalty('aerospace', 'space')).toEqual({ evasion: 0, speedMult: 1, accuracy: 0 });
  });
});

describe('terrainModifiers', () => {
  it('covers every branch of the closed Terrain union without throwing', () => {
    const terrains: Parameters<typeof terrainModifiers>[0][] = [
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
    for (const terrain of terrains) {
      for (const mapKind of ['space', 'surface'] as const) {
        for (const mobility of ['space', 'ground', 'aerospace'] as const) {
          const mod = terrainModifiers(terrain, mapKind, mobility);
          expect(typeof mod.accuracy).toBe('number');
          expect(typeof mod.evasion).toBe('number');
          expect(typeof mod.damage).toBe('number');
          expect(typeof mod.speedMult).toBe('number');
        }
      }
    }
  });
});

describe('weatherModifiers', () => {
  it('covers every branch of the closed Weather union without throwing', () => {
    const weathers: Parameters<typeof weatherModifiers>[0][] = ['clear', 'rain', 'storm', 'dust', 'solar_flare', 'none'];
    for (const w of weathers) {
      for (const kind of ['melee', 'ranged', 'support'] as const) {
        const mod = weatherModifiers(w, kind);
        expect(typeof mod.accuracy).toBe('number');
        expect(typeof mod.damage).toBe('number');
      }
    }
  });
  it('hurts ranged accuracy more than melee in a storm', () => {
    const ranged = weatherModifiers('storm', 'ranged');
    const melee = weatherModifiers('storm', 'melee');
    expect(ranged.accuracy).toBeLessThan(melee.accuracy);
  });
  it('is a no-op in clear weather', () => {
    expect(weatherModifiers('clear', 'ranged')).toEqual({ accuracy: 0, damage: 0 });
  });
});

describe('mechLoad', () => {
  it('sums weight and power across fitted slots', () => {
    const mech = makeMechInstance('m1', { pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', weaponB: 'weapon_vulcans', system: 'system_shield', slot: 0 }, FIXTURE_DATA);
    const load = mechLoad(mech, FIXTURE_DATA);
    // frame 20 + rifle 8 + vulcans 6 + shield 10 = 44
    expect(load.weight).toBe(44);
    // rifle 6 + vulcans 5 + shield 8 = 19, generator 40 -> not overpowered
    expect(load.power).toBe(19);
    expect(load.overPower).toBe(false);
  });

  it('does not flag a normally-fitted mech as overPower', () => {
    const mech = makeMechInstance(
      'm2',
      { pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: 'weapon_railgun', weaponB: 'weapon_lance', system: 'system_targeting', slot: 0 },
      FIXTURE_DATA
    );
    const load = mechLoad(mech, FIXTURE_DATA);
    // 12 + 8 + 5 = 25, under the frame's 40 generator budget.
    expect(load.overPower).toBe(false);
  });

  it('scales the evasion penalty per 10% over generator budget', () => {
    const penalty = overweightEvasionPenalty({ power: 60, generator: 40 });
    // 50% over -> 5 steps of 10% -> 5x penalty
    expect(penalty).toBe(5 * RULES.OVERWEIGHT_EVASION_PENALTY);
    expect(overweightEvasionPenalty({ power: 40, generator: 40 })).toBe(0);
    expect(overweightEvasionPenalty({ power: 44, generator: 40 })).toBe(RULES.OVERWEIGHT_EVASION_PENALTY); // 10% over -> 1 step
  });
});

describe('effectiveStats', () => {
  it('reduces max HP by maxHpPenalty and reflects terrain/mobility mismatch', () => {
    const pilot = makePilotInstance(FIXTURE_DATA.pilots.pilot_ace);
    const mech = makeMechInstance('m3', { pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0, maxHpPenalty: 8 }, FIXTURE_DATA);
    const stats = effectiveStats(pilot, mech, FIXTURE_DATA, { terrain: 'open', mapKind: 'surface', weather: 'clear' });
    // frame_skirmish is space-mobility; surface map -> mobilityPenalty applies.
    expect(stats.maxHp).toBe(80 - 8);
    expect(stats.evasion).toBeLessThan(25 + 40 * 0.2); // penalized vs the "fits" baseline
  });

  it('handles a degenerate mech with no frame gracefully', () => {
    const pilot = makePilotInstance(FIXTURE_DATA.pilots.pilot_ace);
    const badMech = { id: 'bad', frameId: 'not_a_real_frame', weaponA: null, weaponB: null, system: null, hp: 10, maxHpPenalty: 0, destroyed: false };
    const stats = effectiveStats(pilot, badMech as any, FIXTURE_DATA, { terrain: 'open', mapKind: 'surface', weather: 'clear' });
    expect(stats.maxHp).toBe(10);
    expect(Number.isFinite(stats.evasion)).toBe(true);
  });
});
