/**
 * Maps BattleEvent -> a short subtitle line for the battle overlay's SRW-style
 * event log. Returns null for events that don't need their own line.
 */
import type { BattleEvent, GameData } from '@sim/types';
import { getPilotDef } from './mapHelpers';

export function battleEventText(e: BattleEvent, data: GameData): string | null {
  const callsign = (id: string) => getPilotDef(data, id)?.callsign ?? id;
  switch (e.t) {
    case 'start':
      return null;
    case 'round':
      return null;
    case 'callout':
      return `${callsign(e.pilotId)}: "${e.line}"`;
    case 'attack': {
      const flavor = e.line ? ` — "${e.line}"` : '';
      return `${callsign(e.attackerPilotId)} → ${callsign(e.defenderPilotId)}: ${e.totalDamage} dmg${
        e.killed ? ' (KILL)' : ''
      }${flavor}`;
    }
    case 'repair':
      return `${callsign(e.pilotId)} repairs ${e.amount} HP.`;
    case 'shield':
      return `Shield absorbs ${e.absorbed} damage.`;
    case 'intercept':
      return `${callsign(e.protectorPilotId)} intercepts for ${callsign(e.protectedPilotId)}!`;
    case 'destroyed':
      return `${callsign(e.pilotId)}'s mech is destroyed${
        e.ejected ? ' — pilot ejects!' : e.pilotDied ? ' — pilot killed.' : '.'
      }`;
    case 'last_transmission':
      return `${callsign(e.pilotId)} (LAST TRANSMISSION): "${e.line}"`;
    case 'cutin':
      return null;
    case 'finisher':
      return `${callsign(e.pilotId)} — ${e.name}! "${e.line}"`;
    case 'morale':
      return null;
    case 'rout':
      return `Side ${e.side} routs: ${e.reason}`;
    case 'end':
      return `Battle over — ${e.winner === 'A' ? 'VICTORY' : e.winner === 'B' ? 'DEFEAT' : 'DRAW'}.`;
    default:
      return null;
  }
}
