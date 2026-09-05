/**
 * CORDON — hangar operations (run-sim): building mechs, equipping slots,
 * assigning pilots/mechs to squads, repairs and scrapping.
 *
 * All exported functions mutate `run` in place except `unassignedPilots` /
 * `unassignedMechs`, which are pure queries. None of these draw randomness.
 */
import { canPilotFly } from './pilots';
import { mechLoad } from './rules';
import type { FrameDef, GameData, Id, Mech, RunState, SlotAssignment, SlotIndex, Squad } from './types';

type EquipSlot = 'weaponA' | 'weaponB' | 'system' | 'system2';

const SCRAP_VALUE: Record<'weapon' | 'system' | 'frame', number> = {
  weapon: 15,
  system: 20,
  frame: 40,
};

/** Removes the first matching value from an array, in place. Returns whether it was found. */
function removeOne<T>(arr: T[], value: T): boolean {
  const idx = arr.indexOf(value);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  return true;
}

/** Every mech id in `run` currently sitting in a squad slot. */
function assignedMechIds(run: RunState): Set<Id> {
  const out = new Set<Id>();
  for (const squad of run.squads) {
    for (const slot of squad.slots) {
      if (slot) out.add(slot.mechId);
    }
  }
  return out;
}

/** Every pilot id in `run` currently sitting in a squad slot. */
function assignedPilotIds(run: RunState): Set<Id> {
  const out = new Set<Id>();
  for (const squad of run.squads) {
    for (const slot of squad.slots) {
      if (slot) out.add(slot.pilotId);
    }
  }
  return out;
}

/**
 * Builds a Mech from a spare frame in `run.frames`, consuming that inventory
 * entry. Returns null if the frame isn't in inventory. Mutates `run`.
 */
export function buildMech(run: RunState, frameId: Id, data: GameData): Mech | null {
  const frame = data.frames[frameId];
  if (!frame) return null;
  if (!removeOne(run.frames, frameId)) return null;
  const existing = Object.values(run.mechs).filter((m) => m.frameId === frameId).length;
  const id = `mech_${frameId}_${existing + 1}`;
  const mech: Mech = {
    id,
    frameId,
    weaponA: null,
    weaponB: null,
    system: null,
    system2: null,
    hp: frame.hp,
    maxHpPenalty: 0,
    destroyed: false,
  };
  run.mechs[id] = mech;
  return mech;
}

/** Power draw of a mech's slots if `itemId` were substituted into `slot`. Uses rules.ts's `mechLoad`. */
function prospectivePower(mech: Mech, slot: EquipSlot, itemId: Id | null, data: GameData): number {
  const candidate: Mech = { ...mech, [slot]: itemId };
  return mechLoad(candidate, data).power;
}

/**
 * Equips (or, with `itemId: null`, unequips) a weapon/system slot on a mech.
 * Validates the item is in run inventory, the slot kind matches the item
 * kind, `system2` requires `frame.bonusSystemSlot`, and the resulting power
 * draw doesn't exceed the frame's generator. Swaps the previous occupant
 * back into inventory. Mutates `run`.
 */
export function equip(
  run: RunState,
  mechId: Id,
  slot: EquipSlot,
  itemId: Id | null,
  data: GameData
): { ok: boolean; reason?: string } {
  const mech = run.mechs[mechId];
  if (!mech) return { ok: false, reason: 'Mech not found' };
  const frame = data.frames[mech.frameId];
  if (!frame) return { ok: false, reason: 'Frame not found' };
  if (slot === 'system2' && !frame.bonusSystemSlot) {
    return { ok: false, reason: 'This frame has no bonus system slot' };
  }
  const isWeaponSlot = slot === 'weaponA' || slot === 'weaponB';
  const inventory = isWeaponSlot ? run.weapons : run.systems;
  const pool = isWeaponSlot ? data.weapons : data.systems;

  if (itemId !== null) {
    if (!pool[itemId]) return { ok: false, reason: 'Unknown item' };
    if (!inventory.includes(itemId)) return { ok: false, reason: 'Item not in inventory' };
    const power = prospectivePower(mech, slot, itemId, data);
    if (power > frame.generator) return { ok: false, reason: 'Exceeds generator output' };
  }

  const old = mech[slot] ?? null;
  if (itemId !== null) removeOne(inventory, itemId);
  if (old) inventory.push(old);
  (mech as Record<EquipSlot, Id | null>)[slot] = itemId;
  return { ok: true };
}

/**
 * Assigns (or, with `assignment: null`, clears) one squad slot. Enforces:
 * pilot alive/uninjured/not assigned elsewhere, mech not destroyed/not
 * assigned elsewhere, and `canPilotFly`. Promotes a new leader if the leader
 * is cleared, or sets the first-ever assignment as leader. Mutates `run`.
 */
export function assignSlot(
  run: RunState,
  squadId: Id,
  slotIndex: SlotIndex,
  assignment: SlotAssignment | null,
  data: GameData
): { ok: boolean; reason?: string } {
  const squad = run.squads.find((s) => s.id === squadId);
  if (!squad) return { ok: false, reason: 'Squad not found' };

  if (assignment === null) {
    const old = squad.slots[slotIndex];
    squad.slots[slotIndex] = null;
    if (old && squad.leaderPilotId === old.pilotId) {
      promoteLeader(squad);
    }
    return { ok: true };
  }

  const pilot = run.pilots[assignment.pilotId];
  if (!pilot) return { ok: false, reason: 'Pilot not found' };
  if (!pilot.alive) return { ok: false, reason: 'Pilot is dead' };
  if (pilot.injuredFor > 0) return { ok: false, reason: 'Pilot is injured' };

  const mech = run.mechs[assignment.mechId];
  if (!mech) return { ok: false, reason: 'Mech not found' };
  if (mech.destroyed) return { ok: false, reason: 'Mech is destroyed' };

  const frame = data.frames[mech.frameId];
  if (!frame) return { ok: false, reason: 'Frame not found' };
  if (!canPilotFly(pilot, frame)) return { ok: false, reason: 'Pilot is not certified for this frame' };

  // A pilot or mech already seated somewhere else is *moved*, not refused —
  // that's what dragging into a new slot means. Vacate the old seat first.
  for (const sq of run.squads) {
    sq.slots.forEach((s, i) => {
      if (!s) return;
      if (sq.id === squadId && i === slotIndex) return;
      if (s.pilotId === assignment.pilotId || s.mechId === assignment.mechId) {
        sq.slots[i] = null;
        if (sq.leaderPilotId === s.pilotId) promoteLeader(sq);
      }
    });
  }

  squad.slots[slotIndex] = assignment;
  if (squad.leaderPilotId === null) squad.leaderPilotId = assignment.pilotId;
  return { ok: true };
}

function promoteLeader(squad: Squad): void {
  const next = squad.slots.find((s) => s !== null) as SlotAssignment | undefined;
  squad.leaderPilotId = next ? next.pilotId : null;
}

/** Sets (or clears) a squad's leader. The pilot must already be assigned to the squad. Mutates `run`. */
export function setLeader(run: RunState, squadId: Id, pilotId: Id | null): { ok: boolean; reason?: string } {
  const squad = run.squads.find((s) => s.id === squadId);
  if (!squad) return { ok: false, reason: 'Squad not found' };
  if (pilotId === null) {
    squad.leaderPilotId = null;
    return { ok: true };
  }
  const inSquad = squad.slots.some((s) => s?.pilotId === pilotId);
  if (!inSquad) return { ok: false, reason: 'Pilot is not in this squad' };
  squad.leaderPilotId = pilotId;
  return { ok: true };
}

function maxHp(mech: Mech, frame: FrameDef): number {
  return Math.max(1, Math.round(frame.hp - mech.maxHpPenalty));
}

/** Repairs one mech to full HP for scrap (ceil(missing * 0.5)). Mutates `run`. */
export function repairMech(run: RunState, mechId: Id, data: GameData): { ok: boolean; cost: number; reason?: string } {
  const mech = run.mechs[mechId];
  if (!mech) return { ok: false, cost: 0, reason: 'Mech not found' };
  const frame = data.frames[mech.frameId];
  if (!frame) return { ok: false, cost: 0, reason: 'Frame not found' };
  const missing = maxHp(mech, frame) - mech.hp;
  if (missing <= 0) return { ok: true, cost: 0 };
  const cost = Math.ceil(missing * 0.5);
  if (run.scrap < cost) return { ok: false, cost, reason: 'Insufficient scrap' };
  run.scrap -= cost;
  mech.hp = maxHp(mech, frame);
  return { ok: true, cost };
}

/** Repairs every damaged, affordable mech. Returns total scrap spent. Mutates `run`. */
export function repairAll(run: RunState, data: GameData): number {
  let spent = 0;
  for (const mechId of Object.keys(run.mechs)) {
    const result = repairMech(run, mechId, data);
    if (result.ok) spent += result.cost;
  }
  return spent;
}

/** Scraps one inventory item for scrap. Returns scrap gained (0 if not found). Mutates `run`. */
export function scrapItem(run: RunState, kind: 'weapon' | 'system' | 'frame', itemId: Id, data: GameData): number {
  const inventory = kind === 'weapon' ? run.weapons : kind === 'system' ? run.systems : run.frames;
  if (!removeOne(inventory, itemId)) return 0;
  const value = SCRAP_VALUE[kind];
  run.scrap += value;
  return value;
}

/** Pilot ids not currently occupying any squad slot. */
export function unassignedPilots(run: RunState): Id[] {
  const assigned = assignedPilotIds(run);
  return Object.keys(run.pilots).filter((id) => !assigned.has(id));
}

/** Non-destroyed mech ids not currently occupying any squad slot. */
export function unassignedMechs(run: RunState): Id[] {
  const assigned = assignedMechIds(run);
  return Object.values(run.mechs)
    .filter((m) => !m.destroyed && !assigned.has(m.id))
    .map((m) => m.id);
}
