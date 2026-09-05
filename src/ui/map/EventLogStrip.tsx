import React from 'react';
import type { GameData, WorldState } from '@sim/types';
import { worldEventText } from './mapHelpers';

interface Props {
  world: WorldState;
  data: GameData;
}

/** Last 4 WorldEvents as short text lines, below the Ticker. */
export function EventLogStrip({ world, data }: Props) {
  const lines = world.events
    .slice(-4)
    .map((e) => worldEventText(e, world, data))
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null;

  return (
    <div className="event-log-strip">
      {lines.map((l, i) => (
        <div key={i} className="mono">
          {l}
        </div>
      ))}
    </div>
  );
}
