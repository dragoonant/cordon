/**
 * CORDON — shared read-only helpers for HangarScreen and its subcomponents.
 */
import type { Aptitude, GameData, Id, Pilot, RunState, SlotAssignment, SlotIndex } from '@sim/types';
import { rowOf } from '@sim/types';
import { unassignedMechs, unassignedPilots } from '@sim/hangar';
import { canPilotFly } from '@sim/pilots';

export const APTITUDES: Aptitude[] = ['gunnery', 'melee', 'evasion', 'systems', 'command'];

/** A squad seat, identified by squad + slot index. */
export interface CellRef {
  squadId: Id;
  slot: SlotIndex;
}

/** Pilots free to be seated right now: alive, uninjured, not already in a slot. */
export function seatablePilots(run: RunState): Id[] {
  return unassignedPilots(run).filter((id) => {
    const p = run.pilots[id];
    return !!p && p.alive && p.injuredFor === 0;
  });
}

/** Unassigned, non-destroyed mechs this pilot is certified to fly. */
export function flyableMechsFor(pilotId: Id, run: RunState, data: GameData): Id[] {
  const pilot = run.pilots[pilotId];
  if (!pilot) return [];
  return unassignedMechs(run).filter((mechId) => {
    const mech = run.mechs[mechId];
    const frame = mech && data.frames[mech.frameId];
    return !!frame && canPilotFly(pilot, frame);
  });
}

/** The mech to preselect for a pilot: their remembered last mech if still free and
 *  flyable, else the first flyable free mech, else null. */
export function defaultMechFor(pilotId: Id, run: RunState, data: GameData, lastMech: Record<Id, Id>): Id | null {
  const flyable = flyableMechsFor(pilotId, run, data);
  const remembered = lastMech[pilotId];
  if (remembered && flyable.includes(remembered)) return remembered;
  return flyable[0] ?? null;
}

export interface SeatInfo {
  squadId: Id;
  squadName: string;
  slot: SlotIndex;
  row: 'front' | 'back';
  occupant: SlotAssignment | null;
}

/** Every seat across every squad, in squad/slot order. */
export function allSeats(run: RunState): SeatInfo[] {
  const out: SeatInfo[] = [];
  for (const squad of run.squads) {
    squad.slots.forEach((s, i) => {
      const slot = i as SlotIndex;
      out.push({ squadId: squad.id, squadName: squad.name, slot, row: rowOf(slot), occupant: s });
    });
  }
  return out;
}

/**
 * "Next cert" hint: the first cert this pilot doesn't hold yet, with its
 * aptitude thresholds shown as current/needed.
 */
export function nextCertHint(pilot: Pilot, data: GameData): string | null {
  for (const certDef of Object.values(data.certs)) {
    if (pilot.certs.includes(certDef.id)) continue;
    const reqs = Object.entries(certDef.requires) as [Aptitude, number][];
    const parts = reqs.map(([apt, threshold]) => `${apt} ${Math.round(pilot.aptitudes[apt])}/${threshold}`);
    return `Next: ${certDef.name}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  }
  return null;
}

export function pilotStatusLabel(pilot: Pilot): string {
  if (!pilot.alive) return 'DEAD';
  if (pilot.injuredFor > 0) return `INJURED (${pilot.injuredFor})`;
  return 'READY';
}
