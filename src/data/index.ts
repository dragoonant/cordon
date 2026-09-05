/**
 * CORDON — static content loader.
 *
 * Reads the JSON content files in this directory, converts the array shape
 * on disk into the id-keyed `Record` shape `GameData` expects, parses the
 * ASCII `rows` maps use into `Terrain[][]`, and validates every cross
 * reference between content files. Throws a descriptive `Error` the moment
 * anything doesn't line up — better to fail loudly at boot than to let a
 * dangling id surface as a crash mid-battle.
 *
 * Pure and synchronous: no fetch, no DOM. Bundler resolves the JSON imports
 * at build time (see `resolveJsonModule` in tsconfig.json).
 */

import type {
  CalloutDef,
  Certification,
  CertificationDef,
  DistressEventDef,
  FrameDef,
  GameData,
  Id,
  MapDef,
  PilotDef,
  SystemDef,
  Terrain,
  WeaponDef,
} from '@sim/types';

import framesJson from './frames.json';
import weaponsJson from './weapons.json';
import systemsJson from './systems.json';
import certsJson from './certs.json';
import calloutsJson from './callouts.json';
import pilotsJson from './pilots.json';
import mapsJson from './maps.json';
import eventsJson from './events.json';
import captainLinesJson from './captain.json';

// ---------------------------------------------------------------------------
// Map legend & ASCII parsing
// ---------------------------------------------------------------------------

/**
 * Legend for the ASCII `rows` strings in maps.json. `.` is context-sensitive
 * (see `parseRows`): it means `void` on space maps and `open` on surface
 * maps. The entry here documents the surface-map meaning; the loader never
 * looks up `.` through this table directly.
 */
export const MAP_LEGEND: Record<string, Terrain> = {
  '.': 'open',
  '#': 'blocked',
  f: 'forest',
  u: 'urban',
  m: 'mountain',
  w: 'water',
  d: 'debris',
  r: 'radiation',
  g: 'gravity',
  s: 'structure',
};

/** Raw on-disk map shape: `rows: string[]` instead of `tiles`, no width/height (derived). */
interface RawMapDef extends Omit<MapDef, 'tiles' | 'width' | 'height'> {
  rows: string[];
}

function parseRows(rows: string[], mapKind: MapDef['kind'], mapId: Id): Terrain[][] {
  const width = rows[0]?.length ?? 0;
  for (const row of rows) {
    if (row.length !== width) {
      throw new Error(`Map "${mapId}": all rows must have the same length (expected ${width}, got ${row.length}).`);
    }
  }
  return rows.map((row, y) =>
    Array.from(row).map((ch, x) => {
      if (ch === '.') return mapKind === 'space' ? 'void' : 'open';
      const terrain = MAP_LEGEND[ch];
      if (!terrain) {
        throw new Error(`Map "${mapId}": unknown tile character "${ch}" at (${x}, ${y}).`);
      }
      return terrain;
    })
  );
}

function convertMap(raw: RawMapDef): MapDef {
  const { rows, ...rest } = raw;
  const tiles = parseRows(rows, raw.kind, raw.id);
  return {
    ...(rest as Omit<MapDef, 'tiles' | 'width' | 'height'>),
    width: rows[0]?.length ?? 0,
    height: rows.length,
    tiles,
  };
}

// ---------------------------------------------------------------------------
// Array -> Record helper
// ---------------------------------------------------------------------------

function toRecord<T extends { id: Id }>(items: T[]): Record<Id, T> {
  const record: Record<Id, T> = {};
  for (const item of items) {
    record[item.id] = item;
  }
  return record;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function missing(kind: string, id: string, referencedFrom: string): Error {
  return new Error(`Unknown ${kind} id "${id}" referenced from ${referencedFrom}.`);
}

function validate(data: GameData): void {
  const frameIds = new Set(Object.keys(data.frames));
  const weaponIds = new Set(Object.keys(data.weapons));
  const systemIds = new Set(Object.keys(data.systems));
  const pilotIds = new Set(Object.keys(data.pilots));
  const calloutIds = new Set(Object.keys(data.callouts));
  const certIds = new Set(Object.keys(data.certs));

  const checkWeapon = (id: Id | null | undefined, from: string) => {
    if (id != null && !weaponIds.has(id)) throw missing('weapon', id, from);
  };
  const checkSystem = (id: Id | null | undefined, from: string) => {
    if (id != null && !systemIds.has(id)) throw missing('system', id, from);
  };
  const checkFrame = (id: Id | null | undefined, from: string) => {
    if (id != null && !frameIds.has(id)) throw missing('frame', id, from);
  };
  const checkPilot = (id: Id | null | undefined, from: string) => {
    if (id != null && !pilotIds.has(id)) throw missing('pilot', id, from);
  };
  const checkCallout = (id: Id | null | undefined, from: string) => {
    if (id != null && !calloutIds.has(id)) throw missing('callout', id, from);
  };

  // Certifications: requiresCerts, grantsCallouts.
  for (const cert of Object.values(data.certs)) {
    for (const req of cert.requiresCerts) {
      if (!certIds.has(req)) throw missing('cert', req, `cert "${cert.id}".requiresCerts`);
    }
    for (const calloutId of cert.grantsCallouts) {
      checkCallout(calloutId, `cert "${cert.id}".grantsCallouts`);
    }
  }

  // Callouts: requiresCert.
  for (const callout of Object.values(data.callouts)) {
    if (callout.requiresCert && !certIds.has(callout.requiresCert)) {
      throw missing('cert', callout.requiresCert, `callout "${callout.id}".requiresCert`);
    }
  }

  // Pilots: startingCerts, startingCallouts, lastTransmissionId, bondPartners.
  for (const pilot of Object.values(data.pilots)) {
    for (const certId of pilot.startingCerts) {
      if (!certIds.has(certId)) throw missing('cert', certId, `pilot "${pilot.id}".startingCerts`);
    }
    for (const calloutId of pilot.startingCallouts) {
      checkCallout(calloutId, `pilot "${pilot.id}".startingCallouts`);
    }
    checkCallout(pilot.lastTransmissionId, `pilot "${pilot.id}".lastTransmissionId`);
    const lastDef = data.callouts[pilot.lastTransmissionId];
    if (lastDef && lastDef.kind !== 'last') {
      throw new Error(
        `Pilot "${pilot.id}".lastTransmissionId "${pilot.lastTransmissionId}" refers to a callout of kind "${lastDef.kind}", expected "last".`
      );
    }
    for (const bond of pilot.bondPartners) {
      checkPilot(bond.pilotId, `pilot "${pilot.id}".bondPartners`);
      checkCallout(bond.tandemCalloutId, `pilot "${pilot.id}".bondPartners`);
    }
  }

  // Maps: objectives (targetSquadId, ambushSquadIds, recruitPilotId) and enemySquads (composition).
  for (const map of Object.values(data.maps)) {
    const squadIds = new Set(map.enemySquads.map((s) => s.id));
    for (const objective of map.objectives) {
      if (objective.targetSquadId && !squadIds.has(objective.targetSquadId)) {
        throw missing('enemy squad', objective.targetSquadId, `map "${map.id}" objective "${objective.id}".targetSquadId`);
      }
      for (const ambushId of objective.ambushSquadIds ?? []) {
        if (!squadIds.has(ambushId)) {
          throw missing('enemy squad', ambushId, `map "${map.id}" objective "${objective.id}".ambushSquadIds`);
        }
      }
      if (objective.reward.recruitPilotId) {
        checkPilot(objective.reward.recruitPilotId, `map "${map.id}" objective "${objective.id}".reward.recruitPilotId`);
      }
    }
    for (const squad of map.enemySquads) {
      for (const member of squad.composition) {
        checkFrame(member.frameId, `map "${map.id}" squad "${squad.id}" composition`);
        checkWeapon(member.weaponA, `map "${map.id}" squad "${squad.id}" composition.weaponA`);
        checkWeapon(member.weaponB, `map "${map.id}" squad "${squad.id}" composition.weaponB`);
        checkSystem(member.system, `map "${map.id}" squad "${squad.id}" composition.system`);
        checkPilot(member.pilotDefId, `map "${map.id}" squad "${squad.id}" composition.pilotDefId`);
      }
    }
  }

  // Distress events: recruitPilotId, weapon/system/frame in choice outcomes.
  for (const event of Object.values(data.events)) {
    for (const choice of event.choices) {
      const outcome = choice.outcome;
      if (outcome.recruitPilotId) checkPilot(outcome.recruitPilotId, `event "${event.id}" choice "${choice.id}".outcome.recruitPilotId`);
      if (outcome.weapon) checkWeapon(outcome.weapon, `event "${event.id}" choice "${choice.id}".outcome.weapon`);
      if (outcome.system) checkSystem(outcome.system, `event "${event.id}" choice "${choice.id}".outcome.system`);
      if (outcome.frame) checkFrame(outcome.frame, `event "${event.id}" choice "${choice.id}".outcome.frame`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads and validates every static content file into a single `GameData`
 * bundle. Synchronous (JSON is bundled at build time). Throws an `Error`
 * naming the offending id if any cross-reference in the content doesn't
 * resolve.
 */
export function loadGameData(): GameData {
  const data: GameData = {
    frames: toRecord(framesJson as unknown as FrameDef[]),
    weapons: toRecord(weaponsJson as unknown as WeaponDef[]),
    systems: toRecord(systemsJson as unknown as SystemDef[]),
    pilots: toRecord(pilotsJson as unknown as PilotDef[]),
    callouts: toRecord(calloutsJson as unknown as CalloutDef[]),
    certs: toRecord(certsJson as unknown as CertificationDef[]) as Record<Certification, CertificationDef>,
    maps: toRecord((mapsJson as unknown as RawMapDef[]).map(convertMap)),
    events: toRecord(eventsJson as unknown as DistressEventDef[]),
    captainLines: captainLinesJson as GameData['captainLines'],
  };

  validate(data);

  return data;
}
