import React from 'react';
import type { GameData, Id, WorldState } from '@sim/types';
import { Button } from '@ui/components';
import { useStore } from '@ui/store';
import { getPilotDef } from './mapHelpers';

interface Props {
  world: WorldState;
  data: GameData;
  squadId: Id;
}

/** "CALLOUTS" list for the selected squad's detail panel — overworld callouts only. */
export function SquadCallouts({ world, data, squadId }: Props) {
  const callout = useStore((s) => s.callout);
  const squad = world.squads[squadId];
  if (!squad) return null;
  const docked = squad.state === 'docked';
  const pilotIds = squad.slots.filter((s): s is NonNullable<typeof s> => !!s).map((s) => s.pilotId);

  return (
    <div style={{ marginTop: 10 }}>
      <div className="mono muted" style={{ fontSize: 11, marginBottom: 4 }}>
        CALLOUTS
      </div>
      <div className="col gap-s">
        {pilotIds.map((pilotId) => {
          const pilot = world.pilots[pilotId];
          const def = getPilotDef(data, pilotId);
          if (!pilot || !def) return null;
          const known = pilot.callouts.filter((cid) => data.callouts[cid]?.kind === 'overworld');
          if (known.length === 0) return null;
          return (
            <div key={pilotId} className="row gap-s" style={{ flexWrap: 'wrap' }}>
              <span className="mono muted" style={{ fontSize: 10, minWidth: 60 }}>
                {def.callsign}
              </span>
              {known.map((cid) => {
                const cdef = data.callouts[cid];
                const affordable = pilot.nerve >= cdef.nerveCost;
                return (
                  <Button
                    key={cid}
                    small
                    variant="ghost"
                    disabled={docked || !affordable}
                    title={`${cdef.description}\nTradeoff: ${cdef.tradeoff}\n"${cdef.line}"`}
                    onClick={() => callout(squadId, pilotId, cid)}
                  >
                    {cdef.label} ({cdef.nerveCost})
                  </Button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
