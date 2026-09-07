import React, { useState } from 'react';
import type { GameData, Id, WorldState } from '@sim/types';
import { Button, ItemTooltip } from '@ui/components';
import { useStore } from '@ui/store';
import { getPilotDef } from './mapHelpers';

interface Props {
  world: WorldState;
  data: GameData;
  squadId: Id;
}

/**
 * "CALLOUTS" list for the selected squad's detail panel — overworld callouts
 * only. Collapsed by default (remembered per squad-detail mount) so a
 * first-time player isn't greeted with a wall of ability buttons; the toggle
 * label itself hints there's more here. Hover text is a single line —
 * description and trade-off in one sentence — rather than the 3-line
 * multi-field tooltip used elsewhere.
 */
export function SquadCallouts({ world, data, squadId }: Props) {
  const callout = useStore((s) => s.callout);
  const [open, setOpen] = useState(false);
  const squad = world.squads[squadId];
  if (!squad) return null;
  const docked = squad.state === 'docked';
  const pilotIds = squad.slots.filter((s): s is NonNullable<typeof s> => !!s).map((s) => s.pilotId);

  return (
    <div style={{ marginTop: 10 }}>
      <button className="callouts-toggle" onClick={() => setOpen((v) => !v)}>
        CALLOUTS {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="col gap-s" style={{ marginTop: 6 }}>
          {pilotIds.map((pilotId) => {
            const pilot = world.pilots[pilotId];
            const def = getPilotDef(data, pilotId);
            if (!pilot || !def) return null;
            const known = pilot.callouts.filter((cid) => data.callouts[cid]?.kind === 'overworld');
            if (known.length === 0) return null;
            return (
              <div key={pilotId} className="row gap-s" style={{ flexWrap: 'wrap' }}>
                <span className="mono muted" style={{ fontSize: 10, minWidth: 60 }}>
                  {def.callsign} · NERVE {Math.round(pilot.nerve)}/{pilot.maxNerve}
                </span>
                {known.map((cid) => {
                  const cdef = data.callouts[cid];
                  const affordable = pilot.nerve >= cdef.nerveCost;
                  return (
                    <ItemTooltip key={cid} kind="callout" id={cid} data={data}>
                      <div className="col gap-s" style={{ alignItems: 'flex-start' }}>
                        <Button small variant="ghost" disabled={docked || !affordable} onClick={() => callout(squadId, pilotId, cid)}>
                          {cdef.label} ({cdef.nerveCost})
                        </Button>
                        {!affordable && (
                          <span className="mono" style={{ fontSize: 9, color: 'var(--danger)' }}>
                            need {Math.ceil(cdef.nerveCost - pilot.nerve)} more
                          </span>
                        )}
                      </div>
                    </ItemTooltip>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
