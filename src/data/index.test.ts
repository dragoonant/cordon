import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadGameData, MAP_LEGEND } from './index';
import type { CalloutEffect } from '@sim/types';

// Every CalloutEffect in the closed union, hardcoded so this test catches a
// future addition to the union that content hasn't caught up with yet.
const ALL_CALLOUT_EFFECTS: CalloutEffect[] = [
  // prebattle
  'eyes_on',
  'break_formation',
  'redline',
  'on_me',
  'punch_out',
  'first_ones_mine',
  'chain_it',
  'sell_it',
  'we_hold',
  // overworld
  'burn_hard',
  'ping_sector',
  'rally_channel',
  'fall_back',
  'come_get_some',
  'stay_with_them',
  // last transmissions
  'lt_dont_stop',
  'lt_marking_them',
  'lt_take_the_frame',
  'lt_got_the_shot',
  'lt_hold_them_here',
  'lt_tell_them',
  'lt_light_it_up',
  'lt_go_home',
  // tandem
  'td_cross_fire',
  'td_switch',
  'td_got_your_six',
  'td_double_time',
];

describe('loadGameData', () => {
  it('loads without throwing', () => {
    expect(() => loadGameData()).not.toThrow();
  });

  const data = loadGameData();

  it('has the expected content counts', () => {
    expect(Object.keys(data.frames)).toHaveLength(12);
    expect(Object.keys(data.weapons)).toHaveLength(18);
    expect(Object.keys(data.systems)).toHaveLength(10);
    expect(Object.keys(data.pilots)).toHaveLength(13);
    expect(Object.keys(data.callouts)).toHaveLength(27);
    expect(Object.keys(data.certs)).toHaveLength(8);
    expect(Object.keys(data.maps)).toHaveLength(9);
    expect(Object.keys(data.events)).toHaveLength(6);
  });

  it('has exactly one CalloutDef per CalloutEffect', () => {
    const byEffect = new Map<string, number>();
    for (const callout of Object.values(data.callouts)) {
      byEffect.set(callout.effect, (byEffect.get(callout.effect) ?? 0) + 1);
    }
    for (const effect of ALL_CALLOUT_EFFECTS) {
      expect(byEffect.get(effect)).toBe(1);
    }
    // No extra callouts for effects outside the closed union.
    expect(byEffect.size).toBe(ALL_CALLOUT_EFFECTS.length);
  });

  it("gives every pilot a lastTransmissionId that resolves to a kind 'last' callout", () => {
    for (const pilot of Object.values(data.pilots)) {
      const callout = data.callouts[pilot.lastTransmissionId];
      expect(callout, `pilot ${pilot.id} lastTransmissionId "${pilot.lastTransmissionId}" should exist`).toBeDefined();
      expect(callout.kind, `pilot ${pilot.id} lastTransmissionId should be a 'last' callout`).toBe('last');
    }
  });

  it('parses every map into rectangular tiles', () => {
    for (const map of Object.values(data.maps)) {
      expect(map.tiles.length).toBe(map.height);
      for (const row of map.tiles) {
        expect(row.length).toBe(map.width);
      }
    }
  });

  it('keeps every map position in bounds and off blocked tiles', () => {
    const inBounds = (map: (typeof data.maps)[string], pos: { x: number; y: number }) => {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThan(map.width);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThan(map.height);
      const tile = map.tiles[Math.round(pos.y)][Math.round(pos.x)];
      expect(tile, `map ${map.id} position (${pos.x}, ${pos.y}) should not be blocked`).not.toBe('blocked');
    };

    for (const map of Object.values(data.maps)) {
      inBounds(map, map.deployZone.pos);
      for (const objective of map.objectives) {
        inBounds(map, objective.pos);
        for (const p of objective.path ?? []) inBounds(map, p);
      }
      for (const squad of map.enemySquads) {
        inBounds(map, squad.pos);
        inBounds(map, squad.ai.homePos);
        for (const p of squad.ai.patrolPoints ?? []) inBounds(map, p);
      }
    }
  });

  it('exposes a MAP_LEGEND covering every ASCII tile character used in maps.json', () => {
    expect(MAP_LEGEND['#']).toBe('blocked');
    expect(MAP_LEGEND['f']).toBe('forest');
    expect(MAP_LEGEND['u']).toBe('urban');
    expect(MAP_LEGEND['m']).toBe('mountain');
    expect(MAP_LEGEND['w']).toBe('water');
    expect(MAP_LEGEND['d']).toBe('debris');
    expect(MAP_LEGEND['r']).toBe('radiation');
    expect(MAP_LEGEND['g']).toBe('gravity');
    expect(MAP_LEGEND['s']).toBe('structure');
  });

  it('resolves "." to void on space maps and open on surface maps', () => {
    const spaceMap = data.maps['map_space_kessler'];
    const surfaceMap = data.maps['map_surface_ridgeline'];
    expect(spaceMap.tiles.flat()).toContain('void');
    expect(spaceMap.tiles.flat()).not.toContain('open');
    expect(surfaceMap.tiles.flat()).toContain('open');
    expect(surfaceMap.tiles.flat()).not.toContain('void');
  });

  describe('validation failure path', () => {
    beforeEach(() => {
      vi.resetModules();
    });
    afterEach(() => {
      vi.doUnmock('./pilots.json');
      vi.resetModules();
    });

    it('throws a descriptive error naming the missing id when pilots.json references an unknown callout', async () => {
      const realPilots = (await import('./pilots.json')).default as Array<Record<string, unknown>>;
      const broken = realPilots.map((p, i) => (i === 0 ? { ...p, lastTransmissionId: 'lt_does_not_exist' } : p));

      vi.doMock('./pilots.json', () => ({ default: broken }));
      const { loadGameData: loadBroken } = await import('./index');

      expect(() => loadBroken()).toThrow(/lt_does_not_exist/);
    });
  });
});
