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
    case 'capture_site': {
      const bits = [`Stand on ${o.name} uncontested to take it — and hold it, they will take it back`];
      if (o.incomePerMin) bits.push(`pays ${o.incomePerMin} scrap/min while held`);
      if (o.gateSquadIds?.length) bits.push('shuts off their reinforcements when captured');
      return `${bits.join('; ')}.`;
    }
    default:
      return o.name;
  }
}

/** The control-victory line for territory maps, or null if the map has none. */
export function controlWinText(map: MapDef): string | null {
  if (!map.controlWin) return null;
  const total = map.objectives.filter((o) => o.kind === 'capture_site').length;
  return `Or take the ground: hold ${map.controlWin.sites} of ${total} sites at once for ${map.controlWin.holdSeconds}s. Losing one resets the clock.`;
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
