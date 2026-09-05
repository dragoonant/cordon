/**
 * CORDON — shared read-only helpers for HangarScreen and its subcomponents.
 */
import type { Aptitude, GameData, Pilot } from '@sim/types';

export const APTITUDES: Aptitude[] = ['gunnery', 'melee', 'evasion', 'systems', 'command'];

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
