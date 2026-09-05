import React, { useState } from 'react';
import type { GameData, Id, RunState, SlotIndex } from '@sim/types';
import { setLeader } from '@sim/hangar';
import { Panel } from '@ui/components';
import { SquadGrid } from './SquadGrid';

interface Props {
  run: RunState;
  data: GameData;
  selectedCell: { squadId: Id; slot: SlotIndex } | null;
  onSelectCell: (squadId: Id, slot: SlotIndex) => void;
  onClearCell: (squadId: Id, slot: SlotIndex) => void;
  onBump: () => void;
}

/** Middle column: squad name (editable), leader picker, and the formation grid. */
export function SquadronsColumn({ run, data, selectedCell, onSelectCell, onClearCell, onBump }: Props) {
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [draftName, setDraftName] = useState('');

  return (
    <Panel title="SQUADRONS" accent="neutral" padded style={{ height: '100%', overflowY: 'auto' }}>
      <div className="col gap-m">
        {run.squads.map((squad) => (
          <div key={squad.id} className="col gap-s squad-editor">
            <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
              {editingId === squad.id ? (
                <input
                  autoFocus
                  className="mono squad-name-input"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    if (draftName.trim()) squad.name = draftName.trim();
                    setEditingId(null);
                    onBump();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <strong
                  onClick={() => {
                    setEditingId(squad.id);
                    setDraftName(squad.name);
                  }}
                  style={{ cursor: 'text' }}
                  title="Click to rename"
                >
                  {squad.name}
                </strong>
              )}
              <select
                className="mono"
                value={squad.leaderPilotId ?? ''}
                onChange={(e) => {
                  setLeader(run, squad.id, e.target.value || null);
                  onBump();
                }}
              >
                <option value="">No leader</option>
                {squad.slots
                  .filter((s): s is NonNullable<typeof s> => !!s)
                  .map((s) => (
                    <option key={s.pilotId} value={s.pilotId}>
                      {data.pilots[s.pilotId]?.callsign ?? s.pilotId}
                    </option>
                  ))}
              </select>
            </div>
            <SquadGrid run={run} data={data} squad={squad} selectedCell={selectedCell} onSelectCell={onSelectCell} onClearCell={onClearCell} />
            <div className="muted mono" style={{ fontSize: 9 }}>
              FRONT: melee &amp; absorbs hits · BACK: ranged &amp; protected
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
