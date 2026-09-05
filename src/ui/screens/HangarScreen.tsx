import React, { useState } from 'react';
import type { Id, SlotIndex } from '@sim/types';
import { assignSlot, repairAll } from '@sim/hangar';
import { Button } from '@ui/components';
import '@ui/map/map.css'; // shared chip/formation-grid/mini-bar classes
import '@ui/hangar/hangar.css';
import { HangarColumn } from '@ui/hangar/HangarColumn';
import { RosterPanel } from '@ui/hangar/RosterPanel';
import { SquadronsColumn } from '@ui/hangar/SquadronsColumn';
import { useStore } from '@ui/store';

/**
 * Three-column build screen: ROSTER (pilots) | SQUADRONS (formation) | HANGAR (mechs+inventory).
 * Selection model: pick a pilot and/or a mech, pick a formation cell — once all
 * three (pilot, mech, cell) are chosen, auto-assign via assignSlot.
 */
export function HangarScreen() {
  const data = useStore((s) => s.data);
  const run = useStore((s) => s.run);
  const closeHangar = useStore((s) => s.closeHangar);
  const bump = useStore((s) => s.bump);

  const [selectedPilotId, setSelectedPilotId] = useState<Id | null>(null);
  const [selectedMechId, setSelectedMechId] = useState<Id | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ squadId: Id; slot: SlotIndex } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3000);
  }

  function tryAutoAssign(pilotId: Id | null, mechId: Id | null, cell: { squadId: Id; slot: SlotIndex } | null) {
    if (!run || !data || !pilotId || !mechId || !cell) return;
    const r = assignSlot(run, cell.squadId, cell.slot, { pilotId, mechId }, data);
    if (!r.ok) showToast(r.reason ?? 'Cannot assign that pilot/mech here.');
    setSelectedPilotId(null);
    setSelectedMechId(null);
    setSelectedCell(null);
    bump();
  }

  function onSelectPilot(id: Id) {
    const next = selectedPilotId === id ? null : id;
    setSelectedPilotId(next);
    tryAutoAssign(next, selectedMechId, selectedCell);
  }
  function onSelectMech(id: Id) {
    const next = selectedMechId === id ? null : id;
    setSelectedMechId(next);
    tryAutoAssign(selectedPilotId, next, selectedCell);
  }
  function onSelectCell(squadId: Id, slot: SlotIndex) {
    const next = selectedCell?.squadId === squadId && selectedCell.slot === slot ? null : { squadId, slot };
    setSelectedCell(next);
    tryAutoAssign(selectedPilotId, selectedMechId, next);
  }
  function onClearCell(squadId: Id, slot: SlotIndex) {
    if (!run || !data) return;
    assignSlot(run, squadId, slot, null, data);
    bump();
  }

  if (!data || !run) return null;

  return (
    <div className="hangar-screen">
      <div className="hangar-header row gap-m">
        <strong>HANGAR</strong>
        <div style={{ flex: 1 }} />
        <span className="mono">SCRAP: {run.scrap}</span>
        <Button
          small
          variant="ghost"
          onClick={() => {
            const spent = repairAll(run, data);
            showToast(spent > 0 ? `Repaired for ${spent} scrap.` : 'Nothing to repair.');
            bump();
          }}
        >
          REPAIR ALL
        </Button>
        <Button variant="primary" onClick={closeHangar}>
          DONE
        </Button>
      </div>
      <div className="hangar-columns">
        <RosterPanel run={run} data={data} selectedPilotId={selectedPilotId} onSelect={onSelectPilot} />
        <SquadronsColumn
          run={run}
          data={data}
          selectedCell={selectedCell}
          onSelectCell={onSelectCell}
          onClearCell={onClearCell}
          onBump={bump}
        />
        <HangarColumn
          run={run}
          data={data}
          selectedMechId={selectedMechId}
          onSelectMech={onSelectMech}
          onBump={bump}
          onToast={showToast}
        />
      </div>
      {toast && <div className="hangar-toast mono">{toast}</div>}
    </div>
  );
}
