/**
 * CORDON — shared read-only helpers for MapScreen and its subcomponents.
 * No mutation, no sim logic — just projections of WorldState/GameData for display.
 */
import type {
  GameData,
  Id,
  MapDef,
  Mech,
  ObjectiveDef,
  ObjectiveKind,
  Pilot,
  PilotDef,
  Squad,
  WeightClass,
  WorldEvent,
  WorldState,
} from '@sim/types';

/** Enemy pilot instance ids look like `defId#suffix`; strip the suffix to look up static data. */
export function pilotDefIdOf(id: Id): Id {
  return id.split('#')[0];
}

export function getPilotDef(data: GameData, pilotId: Id): PilotDef | undefined {
  return data.pilots[pilotDefIdOf(pilotId)];
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const WEIGHT_NUM: Record<WeightClass, number> = { light: 1, medium: 2, heavy: 3 };
export function weightNum(w: WeightClass): number {
  return WEIGHT_NUM[w];
}

const LOW_FUEL_RATIO = 0.2;

/** Straight-line tile distance between two positions. */
export function tileDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Plain-language squad status for the Squadrons list — replaces the raw
 * SquadState enum with a short phrase a first-time player can act on.
 * Falls back to `squadStateLabel` for states without a friendlier phrasing.
 */
export function squadPlainStatus(squad: Squad, world: WorldState, map: MapDef): string {
  if (squad.state === 'destroyed') return 'Destroyed';
  if (squad.state !== 'docked' && squad.maxFuel > 0 && squad.fuel / squad.maxFuel < LOW_FUEL_RATIO) {
    return 'Low fuel';
  }
  switch (squad.state) {
    case 'docked':
      return 'Docked — deploy';
    case 'moving':
      return 'Moving';
    case 'idle': {
      const holding = map.objectives.some((o) => {
        const st = world.objectives[o.id];
        return st && st.status !== 'complete' && st.status !== 'failed' && tileDist(squad.pos, st.pos) <= o.radius;
      });
      return holding ? 'Holding objective' : 'Idle';
    }
    case 'routed':
      return 'Routed — returning';
    case 'returning':
      return 'Returning to dock';
    case 'engaged':
      return 'In combat';
    default:
      return squadStateLabel(squad);
  }
}

/** DOCKED / IDLE / MOVING / ROUTED / DESTROYED / REST / BURN, per the HUD spec. */
export function squadStateLabel(squad: Squad): string {
  if (squad.effects.some((e) => e.type === 'burn')) return 'BURN';
  if (squad.effects.some((e) => e.type === 'rest')) return 'REST';
  switch (squad.state) {
    case 'docked':
      return 'DOCKED';
    case 'idle':
      return 'IDLE';
    case 'moving':
      return 'MOVING';
    case 'routed':
      return 'ROUTED';
    case 'destroyed':
      return 'DESTROYED';
    case 'returning':
      return 'RETURNING';
    case 'engaged':
      return 'ENGAGED';
    default:
      return String(squad.state).toUpperCase();
  }
}

/** Rough "how hard is this fight" number: sum of visible mechs' frame weight class. */
export function squadThreatGuess(squad: Squad, world: WorldState, data: GameData): number {
  let total = 0;
  for (const slot of squad.slots) {
    if (!slot) continue;
    const mech = world.mechs[slot.mechId];
    if (!mech || mech.destroyed) continue;
    const frame = data.frames[mech.frameId];
    if (frame) total += weightNum(frame.weightClass);
  }
  return total;
}

export function livingCount(squad: Squad, world: WorldState): number {
  let n = 0;
  for (const slot of squad.slots) {
    if (!slot) continue;
    const mech = world.mechs[slot.mechId];
    const pilot = world.pilots[slot.pilotId];
    if (mech && !mech.destroyed && pilot && pilot.alive) n += 1;
  }
  return n;
}

/** Living (pilot,mech) pairs in formation order. */
export function squadMembers(squad: Squad, world: WorldState): { pilot: Pilot; mech: Mech }[] {
  const out: { pilot: Pilot; mech: Mech }[] = [];
  for (const slot of squad.slots) {
    if (!slot) continue;
    const pilot = world.pilots[slot.pilotId];
    const mech = world.mechs[slot.mechId];
    if (pilot && mech) out.push({ pilot, mech });
  }
  return out;
}

export function objectiveDefFor(map: MapDef, objectiveId: Id): ObjectiveDef | undefined {
  return map.objectives.find((o) => o.id === objectiveId);
}

export const OBJECTIVE_ICON: Record<ObjectiveKind, string> = {
  evac_station: '\u{1F6F0}',
  evac_colony: '\u{1F3D9}',
  convoy: '\u{1F69B}',
  derelict: '☢',
  relay: '\u{1F4E1}',
  destroy_target: '⚔',
  reach_exit: '\u{1F6AA}',
};

export function statusColor(status: string): string {
  switch (status) {
    case 'complete':
      return 'var(--ok)';
    case 'failed':
      return 'var(--danger)';
    case 'active':
      return 'var(--amber)';
    default:
      return 'var(--muted)';
  }
}

/** Short text for the HUD event-log strip. Exhaustive over WorldEvent per CONVENTIONS. */
export function worldEventText(e: WorldEvent, world: WorldState, data: GameData): string {
  const squadName = (id: Id) => world.squads[id]?.name ?? id;
  const callsign = (id: Id) => getPilotDef(data, id)?.callsign ?? id;
  switch (e.t) {
    case 'deployed':
      return `${squadName(e.squadId)} deployed.`;
    case 'contact':
      return `Contact: ${squadName(e.squadAId)} vs ${squadName(e.squadBId)}.`;
    case 'battle_resolved':
      return `${squadName(e.squadAId)} vs ${squadName(e.squadBId)}: ${
        e.winner === 'A' ? 'won' : e.winner === 'B' ? 'lost' : 'draw'
      }.`;
    case 'objective':
      return `Objective ${e.status}.`;
    case 'callout':
      return `${callsign(e.pilotId)}: "${e.line}"`;
    case 'last_transmission':
      return `${callsign(e.pilotId)} (last transmission): "${e.line}"`;
    case 'squad_destroyed':
      return `${squadName(e.squadId)} destroyed.`;
    case 'fell_back':
      return `${squadName(e.squadId)} broke off from ${squadName(e.fromSquadId)}. -${e.standingCost} Standing.`;
    case 'rival_contact':
      return `${callsign(e.pilotId)}: "${e.line}"`;
    case 'squad_docked':
      return `${squadName(e.squadId)} docked.`;
    case 'spawn':
      return `Contact inbound: ${squadName(e.squadId)}.`;
    case 'carrier_hit':
      return `Lantern hit for ${e.damage} (${e.hpAfter} HP left).`;
    case 'captain':
      return e.line;
    case 'map_end':
      return `Map ${e.outcome}.`;
    default:
      return '';
  }
}
