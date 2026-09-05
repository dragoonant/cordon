import { describe, expect, it } from 'vitest';
import {
  assignSlot,
  buildMech,
  equip,
  repairAll,
  repairMech,
  scrapItem,
  setLeader,
  unassignedMechs,
  unassignedPilots,
} from './hangar';
import { newRun } from './run';
import { FIXTURE_DATA, fixtureUnlocks } from './__fixtures__/runFixtures';
import type { RunState } from './types';

function freshRun(seed = 42): RunState {
  return newRun(FIXTURE_DATA, fixtureUnlocks(), seed, 0);
}

describe('buildMech', () => {
  it('consumes a spare frame and assigns a deterministic id', () => {
    const run = freshRun();
    run.frames.push('frame_medium_ground_relay', 'frame_medium_ground_relay');
    const m1 = buildMech(run, 'frame_medium_ground_relay', FIXTURE_DATA);
    expect(m1).not.toBeNull();
    expect(m1!.id).toBe('mech_frame_medium_ground_relay_1');
    expect(m1!.hp).toBe(FIXTURE_DATA.frames.frame_medium_ground_relay.hp);
    expect(run.frames.filter((f) => f === 'frame_medium_ground_relay').length).toBe(1); // one instance left, not zero

    const m2 = buildMech(run, 'frame_medium_ground_relay', FIXTURE_DATA);
    expect(m2!.id).toBe('mech_frame_medium_ground_relay_2');

    const m3 = buildMech(run, 'frame_medium_ground_relay', FIXTURE_DATA); // inventory now empty
    expect(m3).toBeNull();
  });

  it('returns null for an unknown frame id', () => {
    const run = freshRun();
    expect(buildMech(run, 'frame_nope', FIXTURE_DATA)).toBeNull();
  });
});

describe('equip', () => {
  it('equips into an empty slot from inventory', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId;
    run.mechs[mechId].weaponB = null; // ensure the slot starts empty for this test
    run.weapons.push('weapon_vulcan');
    const result = equip(run, mechId, 'weaponB', 'weapon_vulcan', FIXTURE_DATA);
    expect(result.ok).toBe(true);
    expect(run.mechs[mechId].weaponB).toBe('weapon_vulcan');
    expect(run.weapons).not.toContain('weapon_vulcan');
  });

  it('swaps the old item back into inventory', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId;
    const original = run.mechs[mechId].weaponA;
    expect(original).not.toBeNull();
    run.weapons.push('weapon_vulcan');
    equip(run, mechId, 'weaponA', 'weapon_vulcan', FIXTURE_DATA);
    expect(run.mechs[mechId].weaponA).toBe('weapon_vulcan');
    expect(run.weapons).toContain(original);
  });

  it('unequips with itemId null, returning the item to inventory', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId;
    const original = run.mechs[mechId].weaponA;
    const result = equip(run, mechId, 'weaponA', null, FIXTURE_DATA);
    expect(result.ok).toBe(true);
    expect(run.mechs[mechId].weaponA).toBeNull();
    expect(run.weapons).toContain(original);
  });

  it('rejects an item not present in inventory', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId;
    const result = equip(run, mechId, 'weaponB', 'weapon_railgun', FIXTURE_DATA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/inventory/i);
  });

  it('rejects system2 on a frame without a bonus system slot', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId;
    run.systems.push('system_booster');
    const result = equip(run, mechId, 'system2', 'system_booster', FIXTURE_DATA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bonus system slot/i);
  });

  it('rejects when the new item would exceed the generator, and leaves state unchanged', () => {
    const run = freshRun();
    // frame_light_ground_relay has generator 20; starting loadout is lance(8) + rifle(6) = 14.
    const mechId = run.squads[0].slots[0]!.mechId;
    expect(run.mechs[mechId].system).toBeNull();
    run.systems.push('system_shield'); // power 10 -> 14 + 10 = 24 > 20
    const before = { ...run.mechs[mechId] };
    const result = equip(run, mechId, 'system', 'system_shield', FIXTURE_DATA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Exceeds generator output');
    expect(run.mechs[mechId]).toEqual(before); // rejected equip must not mutate the mech
    expect(run.systems).toContain('system_shield'); // and must not consume the inventory item
  });

  it('allows an equip that fits exactly at the generator cap', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId; // 14 used of 20
    run.weapons.push('weapon_vulcan'); // power 5 -> replacing rifle(6) with vulcan(5): 8 + 5 = 13 <= 20
    const result = equip(run, mechId, 'weaponB', 'weapon_vulcan', FIXTURE_DATA);
    expect(result.ok).toBe(true);
    expect(run.mechs[mechId].weaponB).toBe('weapon_vulcan');
  });
});

describe('assignSlot', () => {
  it('moves a pilot already seated elsewhere instead of refusing (vacates the old slot)', () => {
    const run = freshRun();
    const veteranSlot = run.squads[0].slots[0]!;
    run.frames.push('frame_light_ground_relay');
    const spare = buildMech(run, 'frame_light_ground_relay', FIXTURE_DATA)!;
    const result = assignSlot(run, run.squads[1].id, 2, { pilotId: veteranSlot.pilotId, mechId: spare.id }, FIXTURE_DATA);
    expect(result.ok).toBe(true);
    expect(run.squads[0].slots[0]).toBeNull();
    expect(run.squads[1].slots[2]).toEqual({ pilotId: veteranSlot.pilotId, mechId: spare.id });
    // old squad promoted a new leader if the veteran led it
    expect(run.squads[0].leaderPilotId).not.toBe(veteranSlot.pilotId);
    // the vacated mech is now unassigned
    expect(unassignedMechs(run)).toContain(veteranSlot.mechId);
  });

  it('rejects a destroyed mech', () => {
    const run = freshRun();
    assignSlot(run, run.squads[1].id, 1, null, FIXTURE_DATA); // free up pilot_engineer first
    run.frames.push('frame_light_ground_relay');
    const spare = buildMech(run, 'frame_light_ground_relay', FIXTURE_DATA)!;
    spare.destroyed = true;
    const result = assignSlot(run, run.squads[0].id, 2, { pilotId: 'pilot_engineer', mechId: spare.id }, FIXTURE_DATA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/destroyed/i);
  });

  it('rejects a pilot uncertified for the mech frame', () => {
    const run = freshRun();
    // Free up the rookie first (they start assigned in squad 2 slot 0).
    assignSlot(run, run.squads[1].id, 0, null, FIXTURE_DATA);
    run.frames.push('frame_compact_ace_heavy');
    const heavyMech = buildMech(run, 'frame_compact_ace_heavy', FIXTURE_DATA)!;
    const result = assignSlot(run, run.squads[0].id, 2, { pilotId: 'pilot_rookie', mechId: heavyMech.id }, FIXTURE_DATA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/certified/i);
  });

  it('sets the first-ever assignment as leader, and promotes on removal', () => {
    const run = freshRun();
    const squad = run.squads[0];
    const currentLeader = squad.leaderPilotId;
    expect(currentLeader).not.toBeNull();
    // Clear the leader's slot; a remaining assigned pilot should be promoted.
    const leaderSlotIndex = squad.slots.findIndex((s) => s?.pilotId === currentLeader);
    assignSlot(run, squad.id, leaderSlotIndex as any, null, FIXTURE_DATA);
    expect(squad.leaderPilotId).not.toBe(currentLeader);
    expect(squad.slots.some((s) => s?.pilotId === squad.leaderPilotId)).toBe(true);
  });

  it('clearing every slot sets leaderPilotId to null', () => {
    const run = freshRun();
    const squad = run.squads[0];
    for (let i = 0; i < squad.slots.length; i++) {
      assignSlot(run, squad.id, i as any, null, FIXTURE_DATA);
    }
    expect(squad.leaderPilotId).toBeNull();
  });
});

describe('setLeader', () => {
  it('sets a leader already in the squad and rejects one who is not', () => {
    const run = freshRun();
    const squad = run.squads[0];
    const memberId = squad.slots.find((s) => s !== null)!.pilotId;
    expect(setLeader(run, squad.id, memberId).ok).toBe(true);
    expect(squad.leaderPilotId).toBe(memberId);
    const outsider = run.squads[1].slots.find((s) => s !== null)!.pilotId;
    const rejected = setLeader(run, squad.id, outsider);
    expect(rejected.ok).toBe(false);
    expect(setLeader(run, squad.id, null).ok).toBe(true);
    expect(squad.leaderPilotId).toBeNull();
  });
});

describe('repairMech / repairAll', () => {
  it('costs ceil(missing * 0.5) scrap and refuses when unaffordable', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId;
    const frame = FIXTURE_DATA.frames[run.mechs[mechId].frameId];
    run.mechs[mechId].hp = frame.hp - 11; // missing 11 -> cost ceil(5.5) = 6
    run.scrap = 100;
    const result = repairMech(run, mechId, FIXTURE_DATA);
    expect(result.ok).toBe(true);
    expect(result.cost).toBe(6);
    expect(run.mechs[mechId].hp).toBe(frame.hp);
    expect(run.scrap).toBe(94);

    run.mechs[mechId].hp = frame.hp - 20;
    run.scrap = 0;
    const refused = repairMech(run, mechId, FIXTURE_DATA);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/insufficient/i);
  });

  it('is a no-op (cost 0) on a mech already at full HP', () => {
    const run = freshRun();
    const mechId = run.squads[0].slots[0]!.mechId;
    const result = repairMech(run, mechId, FIXTURE_DATA);
    expect(result).toEqual({ ok: true, cost: 0 });
  });

  it('repairAll spends across every affordable damaged mech', () => {
    const run = freshRun();
    const ids = Object.keys(run.mechs);
    run.mechs[ids[0]].hp = 1; // heavily damaged
    run.mechs[ids[1]].hp = Math.max(1, run.mechs[ids[1]].hp - 4);
    run.scrap = 1000;
    const spent = repairAll(run, FIXTURE_DATA);
    expect(spent).toBeGreaterThan(0);
    expect(Object.values(run.mechs).every((m) => m.hp === FIXTURE_DATA.frames[m.frameId].hp)).toBe(true);
  });
});

describe('scrapItem', () => {
  it('removes one instance and pays the fixed scrap value per kind', () => {
    const run = freshRun();
    run.weapons.push('weapon_vulcan');
    run.systems.push('system_booster');
    run.frames.push('frame_medium_ground_relay');
    const startScrap = run.scrap;
    expect(scrapItem(run, 'weapon', 'weapon_vulcan', FIXTURE_DATA)).toBe(15);
    expect(scrapItem(run, 'system', 'system_booster', FIXTURE_DATA)).toBe(20);
    expect(scrapItem(run, 'frame', 'frame_medium_ground_relay', FIXTURE_DATA)).toBe(40);
    expect(run.scrap).toBe(startScrap + 75);
    expect(run.weapons).not.toContain('weapon_vulcan');
  });

  it('returns 0 for an item not in inventory (degenerate input)', () => {
    const run = freshRun();
    expect(scrapItem(run, 'weapon', 'weapon_not_owned', FIXTURE_DATA)).toBe(0);
  });
});

describe('unassignedPilots / unassignedMechs', () => {
  it('lists pilots and mechs not occupying a squad slot', () => {
    const run = freshRun();
    // All 6 starting pilots are assigned at the start.
    expect(unassignedPilots(run)).toEqual([]);
    run.frames.push('frame_light_ground_relay');
    const spare = buildMech(run, 'frame_light_ground_relay', FIXTURE_DATA)!;
    expect(unassignedMechs(run)).toContain(spare.id);

    assignSlot(run, run.squads[0].id, 2, null, FIXTURE_DATA); // already empty, no-op
    const squad = run.squads[0];
    const filledIndex = squad.slots.findIndex((s) => s !== null);
    const pilotId = squad.slots[filledIndex]!.pilotId;
    assignSlot(run, squad.id, filledIndex as any, null, FIXTURE_DATA);
    expect(unassignedPilots(run)).toContain(pilotId);
  });
});
