import React from 'react';
import type { GameData, Id, SlotIndex, WorldState } from '@sim/types';
import { rowOf } from '@sim/types';
import { Button, ItemTooltip, NerveBar, Panel } from '@ui/components';
import { useStore } from '@ui/store';
import { getPilotDef } from './mapHelpers';
import { SquadCallouts } from './SquadCallouts';

interface Props {
  world: WorldState;
  data: GameData;
  squadId: Id;
}

/** Formation grid + recall + callouts for the currently-selected player squad. */
export function SquadDetail({ world, data, squadId }: Props) {
  const recall = useStore((s) => s.recall);
  const squad = world.squads[squadId];
  if (!squad) return null;

  return (
    <Panel accent="neutral" padded style={{ pointerEvents: 'auto' }}>
      <div className="formation-grid">
        {squad.slots.map((slot, i) => {
          const row = rowOf(i as SlotIndex);
          if (!slot) {
            return (
              <div key={i} className="formation-cell empty">
                <span className="mono muted" style={{ fontSize: 10 }}>
                  {row.toUpperCase()}
                </span>
              </div>
            );
          }
          const mech = world.mechs[slot.mechId];
          const pilot = world.pilots[slot.pilotId];
          const pilotDef = getPilotDef(data, slot.pilotId);
          const frame = mech ? data.frames[mech.frameId] : undefined;
          return (
            <div key={i} className="formation-cell">
              <strong style={{ fontSize: 11 }}>{pilotDef?.callsign ?? slot.pilotId}</strong>
              <ItemTooltip kind="frame" id={mech?.frameId} data={data}>
                <span className="muted" style={{ fontSize: 9 }}>
                  {frame?.name ?? '—'}
                </span>
              </ItemTooltip>
              {mech && frame && (
                <div className="mini-bar">
                  <div
                    className="mini-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, (mech.hp / frame.hp) * 100))}%` }}
                  />
                </div>
              )}
              {pilot && <NerveBar nerve={pilot.nerve} maxNerve={pilot.maxNerve} height={4} showText={false} />}
            </div>
          );
        })}
      </div>
      <div className="row gap-s" style={{ marginTop: 8 }}>
        <Button small variant="ghost" onClick={() => recall(squadId)} disabled={squad.state === 'docked'} title="Recall (R)">
          RECALL
        </Button>
      </div>
      <SquadCallouts world={world} data={data} squadId={squadId} />
    </Panel>
  );
}
