import React, { useEffect, useState } from 'react';
import type { BattleEvent, GameData } from '@sim/types';
import { Portrait } from '@ui/components';

export interface SpeechEntry {
  id: number;
  pilotDefId: string;
  callsign: string;
  faction: 'relay' | 'compact' | 'neutral';
  line: string;
  kind: 'attack' | 'callout' | 'cutin' | 'finisher' | 'last';
  until: number; // performance.now() ms
}

/** Reading time: long enough to actually read, capped so the stack keeps moving. */
export function speechDuration(line: string, kind: SpeechEntry['kind']): number {
  const base = kind === 'last' ? 4500 : kind === 'finisher' || kind === 'callout' ? 3200 : 2400;
  return Math.min(7000, base + line.length * 45);
}

let nextId = 1;

/** Turn a battle event into a speech entry, or null if the event has no spoken line. */
export function speechFromEvent(e: BattleEvent, data: GameData): SpeechEntry | null {
  let pilotId: string | null = null;
  let line: string | null = null;
  let kind: SpeechEntry['kind'] = 'attack';
  switch (e.t) {
    case 'attack':
      if (!e.line) return null;
      pilotId = e.attackerPilotId;
      line = e.line;
      break;
    case 'callout':
      pilotId = e.pilotId;
      line = e.line;
      kind = 'callout';
      break;
    case 'cutin':
      // The stage shows callout/finisher/last cut-ins already; only crit/kill quips go to the stack.
      if (e.kind !== 'crit' && e.kind !== 'kill') return null;
      if (!e.line) return null;
      pilotId = e.pilotId;
      line = e.line;
      kind = 'cutin';
      break;
    case 'finisher':
      pilotId = e.pilotId;
      line = `${e.name.toUpperCase()} — ${e.line}`;
      kind = 'finisher';
      break;
    case 'last_transmission':
      pilotId = e.pilotId;
      line = e.line;
      kind = 'last';
      break;
    case 'destroyed':
      if (!e.line) return null;
      pilotId = e.pilotId;
      line = e.line;
      break;
    default:
      return null;
  }
  if (!pilotId || !line) return null;
  const defId = pilotId.split('#')[0];
  const def = data.pilots[defId];
  return {
    id: nextId++,
    pilotDefId: defId,
    callsign: def?.callsign ?? defId,
    faction: def?.faction ?? 'neutral',
    line,
    kind,
    until: performance.now() + speechDuration(line, kind),
  };
}

/**
 * Lingering comms feed for battle chatter. New lines stack beneath the ones
 * still on screen instead of replacing them; each expires on its own timer.
 */
export function SpeechStack({ entries, onExpire }: { entries: SpeechEntry[]; onExpire: (ids: number[]) => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      const dead = entries.filter((e) => e.until <= now).map((e) => e.id);
      if (dead.length) onExpire(dead);
      else force((n) => n + 1);
    }, 200);
    return () => clearInterval(t);
  }, [entries, onExpire]);

  if (entries.length === 0) return null;
  return (
    <div className="speech-stack">
      {entries.map((e) => {
        const remaining = e.until - performance.now();
        const fading = remaining < 400;
        return (
          <div key={e.id} className={`speech-entry speech-${e.faction} speech-${e.kind}${fading ? ' speech-fading' : ''}`}>
            <Portrait pilotDefId={e.pilotDefId} expression={e.kind === 'last' ? 'strained' : e.kind === 'attack' ? 'neutral' : 'shout'} size={44} faction={e.faction} />
            <div className="speech-body">
              <div className="speech-callsign">{e.callsign}</div>
              <div className="speech-line">{e.line}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
