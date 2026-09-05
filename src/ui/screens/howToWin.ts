/**
 * CORDON — plain-language "HOW TO WIN" text for the Briefing screen.
 * Pure projection of MapDef/ObjectiveDef — no mutation, no sim logic.
 */
import type { MapDef, ObjectiveDef } from '@sim/types';
import { fmtTime } from '@ui/map/mapHelpers';

/** One plain-English sentence describing how to clear a single objective. */
export function objectiveWinText(o: ObjectiveDef, map: MapDef): string {
  switch (o.kind) {
    case 'evac_station':
    case 'evac_colony':
      return `Hold the ring at ${o.name} for ${o.holdSeconds ?? 0}s with no enemies inside.`;
    case 'convoy':
      return `Escort ${o.name} to the far edge — stay within 2 tiles.`;
    case 'derelict':
      return `Reach and hold ${o.name} to salvage it — watch for an ambush.`;
    case 'relay':
      return `Capture ${o.name} and hold it to reveal enemies map-wide.`;
    case 'destroy_target': {
      const target = map.enemySquads.find((e) => e.id === o.targetSquadId);
      return `Destroy ${target?.name ?? o.name}.`;
    }
    case 'reach_exit':
      return `Get a surviving squad to ${o.name}.`;
    default:
      return o.name;
  }
}

/** One line enumerating how this map can be lost, derived from its rules. */
export function failStateText(map: MapDef): string {
  const parts: string[] = [];
  if (map.timeLimit > 0) parts.push(`the ${fmtTime(map.timeLimit)} time limit expires with objectives incomplete`);
  if (map.carrierOnMap) parts.push('the Lantern is destroyed');
  parts.push('a required objective fails');
  parts.push('all your squads are lost');
  return `Fail state: ${parts.join(' / ')}.`;
}
