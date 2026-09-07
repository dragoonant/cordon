import React from 'react';
import type { GameData, Id, RunState, SlotIndex } from '@sim/types';
import { Button, ItemTooltip, Modal } from '@ui/components';
import { allSeats } from './hangarHelpers';

interface Props {
  run: RunState;
  data: GameData;
  cell: { squadId: Id; slot: SlotIndex } | null;
  onClose: () => void;
  /** Returns an error string to show inline, or null on success. */
  onMakeLeader: () => string | null;
  onUnseat: () => void;
  onMoveTo: (targetSquadId: Id, targetSlot: SlotIndex) => string | null;
}

/** Actions for a seated squad cell: move/swap it elsewhere, make it squad leader, or unseat it. */
export function UnitActionsModal({ run, data, cell, onClose, onMakeLeader, onUnseat, onMoveTo }: Props) {
  const [moving, setMoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cellKey = cell ? `${cell.squadId}:${cell.slot}` : null;

  React.useEffect(() => {
    setMoving(false);
    setError(null);
  }, [cellKey]);

  if (!cell) return null;
  const squad = run.squads.find((s) => s.id === cell.squadId);
  const assignment = squad?.slots[cell.slot] ?? null;
  if (!squad || !assignment) return null;
  const pilotDef = data.pilots[assignment.pilotId];
  const mech = run.mechs[assignment.mechId];
  const frame = mech ? data.frames[mech.frameId] : undefined;
  const isLeader = squad.leaderPilotId === assignment.pilotId;
  const targets = allSeats(run).filter((s) => !(s.squadId === cell.squadId && s.slot === cell.slot));

  return (
    <Modal open onClose={onClose} title={pilotDef?.callsign ?? 'UNIT'} width={420}>
      <div className="col gap-m">
        <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
          <ItemTooltip kind="frame" id={mech?.frameId} data={data}>
            <span className="mono">
              {frame?.name ?? '—'}
              {mech?.nickname ? ` "${mech.nickname}"` : ''}
            </span>
          </ItemTooltip>
          {isLeader && (
            <span className="chip mono" style={{ color: 'var(--amber)', borderColor: 'var(--amber)' }}>
              LEADER
            </span>
          )}
        </div>

        {!moving && (
          <div className="row gap-s" style={{ flexWrap: 'wrap' }}>
            <Button small variant="ghost" onClick={() => setMoving(true)}>
              MOVE TO…
            </Button>
            <Button
              small
              variant="ghost"
              disabled={isLeader}
              onClick={() => {
                const r = onMakeLeader();
                if (r) setError(r);
              }}
            >
              MAKE LEADER
            </Button>
            <Button small variant="danger" onClick={onUnseat}>
              UNSEAT
            </Button>
          </div>
        )}

        {moving && (
          <div className="col gap-s">
            <div className="mono muted" style={{ fontSize: 10 }}>
              MOVE OR SWAP TO
            </div>
            <div className="col gap-s" style={{ maxHeight: 220, overflowY: 'auto' }}>
              {targets.map((s) => {
                const occDef = s.occupant ? data.pilots[s.occupant.pilotId] : null;
                return (
                  <div
                    key={`${s.squadId}-${s.slot}`}
                    className="roster-row row gap-s"
                    style={{ justifyContent: 'space-between' }}
                    onClick={() => {
                      const r = onMoveTo(s.squadId, s.slot);
                      if (r) setError(r);
                      else setMoving(false);
                    }}
                  >
                    <span>
                      {s.squadName} — {s.row.toUpperCase()}
                    </span>
                    <span className="muted mono" style={{ fontSize: 10 }}>
                      {occDef ? `swap: ${occDef.callsign}` : 'empty'}
                    </span>
                  </div>
                );
              })}
            </div>
            <Button small variant="ghost" onClick={() => setMoving(false)}>
              BACK
            </Button>
          </div>
        )}

        {error && (
          <div className="mono" style={{ color: 'var(--danger)', fontSize: 11 }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
