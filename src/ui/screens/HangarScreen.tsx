import React, { useState } from 'react';
import type { Id, SlotIndex } from '@sim/types';
import { assignSlot, repairAll, setLeader } from '@sim/hangar';
import { Button, useHud } from '@ui/components';
import '@ui/map/map.css'; // shared chip/formation-grid/mini-bar classes
import '@ui/hangar/hangar.css';
import { BenchStrip } from '@ui/hangar/BenchStrip';
import { HangarColumn } from '@ui/hangar/HangarColumn';
import { RosterPanel } from '@ui/hangar/RosterPanel';
import { SquadronsColumn } from '@ui/hangar/SquadronsColumn';
import { UnitActionsModal } from '@ui/hangar/UnitActionsModal';
import { UnitAssignModal } from '@ui/hangar/UnitAssignModal';
import { useStore } from '@ui/store';
import { HangarHints } from '@ui/hangar/HangarHints';

type CellRef = { squadId: Id; slot: SlotIndex };

/**
 * Three-column build screen: ROSTER (pilots) | SQUADRONS (formation) | HANGAR
 * (mechs+inventory), plus a BENCH strip of unseated pilots. A pilot+mech pair
 * is a "Unit": clicking an empty squad cell opens a picker to seat one there;
 * clicking a seated cell opens actions (move/swap, make leader, unseat).
 * `lastMechForPilot` is local UI memory (not persisted) so unseating a pilot
 * and re-seating them later defaults back to the mech they last flew.
 */
export function HangarScreen() {
  // Every hangar action (equip, assign, repair...) mutates `run` in place rather
  // than replacing it, so subscribing to `run` alone never re-renders this tree.
  // hudTick is the store's dedicated "something changed" signal — see useHud().
  useHud();
  const data = useStore((s) => s.data);
  const run = useStore((s) => s.run);
  const closeHangar = useStore((s) => s.closeHangar);
  const bump = useStore((s) => s.bump);

  const [lastMechForPilot, setLastMechForPilot] = useState<Record<Id, Id>>({});
  const [seatCell, setSeatCell] = useState<CellRef | null>(null);
  const [seatPilotId, setSeatPilotId] = useState<Id | null>(null);
  const [actionsCell, setActionsCell] = useState<CellRef | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3000);
  }

  function remember(pilotId: Id, mechId: Id) {
    setLastMechForPilot((m) => ({ ...m, [pilotId]: mechId }));
  }

  function confirmSeat(squadId: Id, slot: SlotIndex, pilotId: Id, mechId: Id): string | null {
    if (!run || !data) return 'No active run.';
    const r = assignSlot(run, squadId, slot, { pilotId, mechId }, data);
    if (!r.ok) {
      const reason = r.reason ?? 'Cannot seat that unit.';
      showToast(reason);
      return reason;
    }
    remember(pilotId, mechId);
    setSeatCell(null);
    setSeatPilotId(null);
    bump();
    return null;
  }

  function makeLeader(): string | null {
    if (!run || !actionsCell) return null;
    const squad = run.squads.find((s) => s.id === actionsCell.squadId);
    const assignment = squad?.slots[actionsCell.slot];
    if (!squad || !assignment) return null;
    const r = setLeader(run, squad.id, assignment.pilotId);
    if (!r.ok) {
      const reason = r.reason ?? 'Cannot set leader.';
      showToast(reason);
      return reason;
    }
    bump();
    return null;
  }

  function unseat() {
    if (!run || !data || !actionsCell) return;
    assignSlot(run, actionsCell.squadId, actionsCell.slot, null, data);
    setActionsCell(null);
    bump();
  }

  function moveTo(targetSquadId: Id, targetSlot: SlotIndex): string | null {
    if (!run || !data || !actionsCell) return null;
    const sourceSquad = run.squads.find((s) => s.id === actionsCell.squadId);
    const source = sourceSquad?.slots[actionsCell.slot];
    if (!sourceSquad || !source) return 'Nothing seated there.';
    const targetSquad = run.squads.find((s) => s.id === targetSquadId);
    const targetOccupant = targetSquad?.slots[targetSlot] ?? null;

    if (targetOccupant) {
      // Swap: seat the target's occupant into the now-vacated source cell first...
      const r1 = assignSlot(run, actionsCell.squadId, actionsCell.slot, targetOccupant, data);
      if (!r1.ok) {
        const reason = r1.reason ?? 'Cannot swap.';
        showToast(reason);
        return reason;
      }
    }
    // ...then seat the original unit at the target (its old seat is free either way).
    const r2 = assignSlot(run, targetSquadId, targetSlot, source, data);
    if (!r2.ok) {
      const reason = r2.reason ?? 'Cannot move there.';
      showToast(reason);
      if (targetOccupant) assignSlot(run, actionsCell.squadId, actionsCell.slot, source, data); // best-effort undo
      return reason;
    }
    remember(source.pilotId, source.mechId);
    setActionsCell(null);
    bump();
    return null;
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
      <HangarHints run={run} data={data} />
      <div className="hangar-columns">
        <RosterPanel run={run} data={data} />
        <div className="col gap-m" style={{ minHeight: 0, height: '100%' }}>
          <div className="grow" style={{ minHeight: 0, overflow: 'hidden' }}>
            <SquadronsColumn
              run={run}
              data={data}
              onEmptyCellClick={(squadId, slot) => setSeatCell({ squadId, slot })}
              onSeatedCellClick={(squadId, slot) => setActionsCell({ squadId, slot })}
              onBump={bump}
            />
          </div>
          <BenchStrip run={run} data={data} lastMech={lastMechForPilot} onSeat={(pilotId) => setSeatPilotId(pilotId)} />
        </div>
        <HangarColumn run={run} data={data} onBump={bump} onToast={showToast} />
      </div>
      {toast && <div className="hangar-toast mono">{toast}</div>}

      <UnitAssignModal
        run={run}
        data={data}
        lastMech={lastMechForPilot}
        fixedCell={seatCell}
        fixedPilotId={seatPilotId}
        onClose={() => {
          setSeatCell(null);
          setSeatPilotId(null);
        }}
        onConfirm={confirmSeat}
      />
      <UnitActionsModal
        run={run}
        data={data}
        cell={actionsCell}
        onClose={() => setActionsCell(null)}
        onMakeLeader={makeLeader}
        onUnseat={unseat}
        onMoveTo={moveTo}
      />
    </div>
  );
}
