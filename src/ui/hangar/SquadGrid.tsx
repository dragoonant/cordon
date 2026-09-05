import React from 'react';
import type { GameData, Id, RunState, SlotIndex, Squad } from '@sim/types';
import { rowOf } from '@sim/types';
import { Button } from '@ui/components';

interface Props {
  run: RunState;
  data: GameData;
  squad: Squad;
  selectedCell: { squadId: Id; slot: SlotIndex } | null;
  onSelectCell: (squadId: Id, slot: SlotIndex) => void;
  onClearCell: (squadId: Id, slot: SlotIndex) => void;
}

/** One squad's 2x3 formation grid, with a CLEAR button per filled cell. */
export function SquadGrid({ run, data, squad, selectedCell, onSelectCell, onClearCell }: Props) {
  return (
    <div className="formation-grid">
      {squad.slots.map((slot, i) => {
        const idx = i as SlotIndex;
        const row = rowOf(idx);
        const selected = selectedCell?.squadId === squad.id && selectedCell.slot === idx;
        const borderColor = selected ? 'var(--amber)' : undefined;

        if (!slot) {
          return (
            <div
              key={i}
              className="formation-cell empty"
              onClick={() => onSelectCell(squad.id, idx)}
              style={{ borderColor, cursor: 'pointer' }}
            >
              <span className="mono muted" style={{ fontSize: 9 }}>
                {row.toUpperCase()}
              </span>
              <span className="muted" style={{ fontSize: 10 }}>
                empty
              </span>
            </div>
          );
        }

        const pilotDef = data.pilots[slot.pilotId];
        const mech = run.mechs[slot.mechId];
        const frame = mech ? data.frames[mech.frameId] : undefined;
        return (
          <div key={i} className="formation-cell" onClick={() => onSelectCell(squad.id, idx)} style={{ borderColor, cursor: 'pointer' }}>
            <span className="mono muted" style={{ fontSize: 9 }}>
              {row.toUpperCase()}
            </span>
            <strong style={{ fontSize: 11 }}>{pilotDef?.callsign ?? slot.pilotId}</strong>
            <span className="muted" style={{ fontSize: 10 }}>
              {frame?.name ?? '—'}
            </span>
            {mech && frame && (
              <div className="mini-bar">
                <div className="mini-bar-fill" style={{ width: `${Math.max(0, Math.min(100, (mech.hp / frame.hp) * 100))}%` }} />
              </div>
            )}
            <div onClick={(e) => e.stopPropagation()}>
              <Button small variant="ghost" onClick={() => onClearCell(squad.id, idx)} style={{ marginTop: 2 }}>
                CLEAR
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
