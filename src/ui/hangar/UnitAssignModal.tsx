import React from 'react';
import type { GameData, Id, RunState, SlotIndex } from '@sim/types';
import { Button, Dropdown, ItemTooltip, Modal, Portrait } from '@ui/components';
import type { DropdownOption } from '@ui/components';
import { allSeats, defaultMechFor, flyableMechsFor, seatablePilots } from './hangarHelpers';

interface Props {
  run: RunState;
  data: GameData;
  lastMech: Record<Id, Id>;
  /** Set when an empty grid cell was clicked: pick a pilot (+ mech) for it. */
  fixedCell: { squadId: Id; slot: SlotIndex } | null;
  /** Set when a bench pilot was clicked: pick a seat (+ mech) for them. */
  fixedPilotId: Id | null;
  onClose: () => void;
  /** Returns an error string to show inline, or null on success. */
  onConfirm: (squadId: Id, slot: SlotIndex, pilotId: Id, mechId: Id) => string | null;
}

/**
 * Seats a pilot+mech Unit into a squad slot. Handles both directions of the
 * pick — a fixed empty cell (choose who sits there) and a fixed bench pilot
 * (choose where they sit) — since the two flows share every other control.
 */
export function UnitAssignModal({ run, data, lastMech, fixedCell, fixedPilotId, onClose, onConfirm }: Props) {
  const open = !!fixedCell || !!fixedPilotId;
  const [pilotId, setPilotId] = React.useState<Id | null>(fixedPilotId);
  const [cell, setCell] = React.useState<{ squadId: Id; slot: SlotIndex } | null>(fixedCell);
  const [mechId, setMechId] = React.useState<Id | null>(fixedPilotId ? defaultMechFor(fixedPilotId, run, data, lastMech) : null);
  const [error, setError] = React.useState<string | null>(null);

  const openKey = `${fixedCell?.squadId ?? ''}:${fixedCell?.slot ?? ''}:${fixedPilotId ?? ''}`;
  React.useEffect(() => {
    if (!open) return;
    setPilotId(fixedPilotId);
    setCell(fixedCell);
    setMechId(fixedPilotId ? defaultMechFor(fixedPilotId, run, data, lastMech) : null);
    setError(null);
    // Re-run only when the modal targets a different cell/pilot, not on every store bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, open]);

  if (!open) return null;

  function pickPilot(id: Id) {
    setPilotId(id);
    setMechId(defaultMechFor(id, run, data, lastMech));
    setError(null);
  }
  function pickCell(squadId: Id, slot: SlotIndex) {
    setCell({ squadId, slot });
    setError(null);
  }
  function confirm() {
    if (!pilotId || !cell || !mechId) return;
    const reason = onConfirm(cell.squadId, cell.slot, pilotId, mechId);
    if (reason) setError(reason);
  }

  const pilots = fixedPilotId ? [fixedPilotId] : seatablePilots(run);
  const seats = fixedCell ? null : allSeats(run).filter((s) => !s.occupant);
  const mechOptions: DropdownOption[] = pilotId
    ? flyableMechsFor(pilotId, run, data).map((id) => {
        const mech = run.mechs[id];
        const frame = mech ? data.frames[mech.frameId] : undefined;
        return {
          value: id,
          label: (
            <ItemTooltip kind="frame" id={mech?.frameId} data={data}>
              <span>
                {frame?.name ?? id}
                {mech?.nickname ? ` "${mech.nickname}"` : ''} · {frame?.mobility.toUpperCase()} · {mech?.hp}/{frame?.hp} HP
              </span>
            </ItemTooltip>
          ),
        };
      })
    : [];

  return (
    <Modal open={open} onClose={onClose} title={fixedPilotId ? `SEAT ${data.pilots[fixedPilotId]?.callsign ?? ''}` : 'SEAT A UNIT'} width={460}>
      <div className="col gap-m">
        {!fixedPilotId && (
          <div className="col gap-s">
            <div className="mono muted" style={{ fontSize: 10 }}>
              PILOT
            </div>
            <div className="col gap-s" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {pilots.length === 0 && (
                <div className="muted mono" style={{ fontSize: 11 }}>
                  No pilot is available to seat.
                </div>
              )}
              {pilots.map((id) => {
                const def = data.pilots[id];
                if (!def) return null;
                return (
                  <div
                    key={id}
                    className="roster-row row gap-s"
                    onClick={() => pickPilot(id)}
                    style={{ border: pilotId === id ? '1px solid var(--amber)' : '1px solid var(--border)' }}
                  >
                    <Portrait pilotDefId={def.id} size={28} faction={def.faction} />
                    <span>{def.callsign}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!fixedCell && (
          <div className="col gap-s">
            <div className="mono muted" style={{ fontSize: 10 }}>
              SEAT
            </div>
            <div className="col gap-s" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {seats && seats.length === 0 && (
                <div className="muted mono" style={{ fontSize: 11 }}>
                  No empty seat in any squad.
                </div>
              )}
              {seats?.map((s) => (
                <div
                  key={`${s.squadId}-${s.slot}`}
                  className="roster-row row gap-s"
                  onClick={() => pickCell(s.squadId, s.slot)}
                  style={{
                    justifyContent: 'space-between',
                    border: cell?.squadId === s.squadId && cell.slot === s.slot ? '1px solid var(--amber)' : '1px solid var(--border)',
                  }}
                >
                  <span>{s.squadName}</span>
                  <span className="muted mono" style={{ fontSize: 10 }}>
                    {s.row.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {pilotId && (
          <div className="col gap-s">
            <div className="mono muted" style={{ fontSize: 10 }}>
              MECH
            </div>
            {mechOptions.length === 0 ? (
              <div className="muted mono" style={{ fontSize: 11 }}>
                No flyable, unassigned mech for this pilot.
              </div>
            ) : (
              <Dropdown value={mechId ?? ''} options={mechOptions} onChange={(v) => setMechId(v || null)} />
            )}
          </div>
        )}

        {error && (
          <div className="mono" style={{ color: 'var(--danger)', fontSize: 11 }}>
            {error}
          </div>
        )}

        <div className="row gap-s" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>
            CANCEL
          </Button>
          <Button variant="primary" disabled={!pilotId || !cell || !mechId} onClick={confirm}>
            SEAT
          </Button>
        </div>
      </div>
    </Modal>
  );
}
