import React from 'react';
import type { GameData, Id, RunState, SlotIndex, Squad } from '@sim/types';
import { rowOf } from '@sim/types';
import { ItemTooltip } from '@ui/components';

interface Props {
  run: RunState;
  data: GameData;
  squad: Squad;
  onEmptyCellClick: (squadId: Id, slot: SlotIndex) => void;
  onSeatedCellClick: (squadId: Id, slot: SlotIndex) => void;
}

/**
 * One squad's 2x3 formation grid. An empty cell opens the seat picker; a
 * seated cell opens its unit's actions (move/swap, make leader, unseat).
 */
export function SquadGrid({ run, data, squad, onEmptyCellClick, onSeatedCellClick }: Props) {
  return (
    <div className="formation-grid">
      {squad.slots.map((slot, i) => {
        const idx = i as SlotIndex;
        const row = rowOf(idx);

        if (!slot) {
          return (
            <div key={i} className="formation-cell empty" onClick={() => onEmptyCellClick(squad.id, idx)} style={{ cursor: 'pointer' }}>
              <span className="mono muted" style={{ fontSize: 9 }}>
                {row.toUpperCase()}
              </span>
              <span className="muted" style={{ fontSize: 10 }}>
                + seat a unit
              </span>
            </div>
          );
        }

        const pilotDef = data.pilots[slot.pilotId];
        const mech = run.mechs[slot.mechId];
        const frame = mech ? data.frames[mech.frameId] : undefined;
        return (
          <div key={i} className="formation-cell" onClick={() => onSeatedCellClick(squad.id, idx)} style={{ cursor: 'pointer' }}>
            <span className="mono muted" style={{ fontSize: 9 }}>
              {row.toUpperCase()}
            </span>
            <strong style={{ fontSize: 11 }}>{pilotDef?.callsign ?? slot.pilotId}</strong>
            <ItemTooltip kind="frame" id={mech?.frameId} data={data}>
              <span className="muted" style={{ fontSize: 10 }}>
                {frame?.name ?? '—'}
              </span>
            </ItemTooltip>
            {mech && frame && (
              <div className="mini-bar">
                <div className="mini-bar-fill" style={{ width: `${Math.max(0, Math.min(100, (mech.hp / frame.hp) * 100))}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
