import React, { useState } from 'react';
import type { ActiveCallout, GameData, Id, Squad, WorldState } from '@sim/types';
import { availableTandems } from '@sim/pilots';
import { Button } from '@ui/components';
import { getPilotDef } from './mapHelpers';

interface Props {
  squad: Squad;
  world: WorldState;
  data: GameData;
  pendingCallouts: ActiveCallout[];
  onToggle: (c: ActiveCallout) => void;
}

/** Prebattle Callout chips (per-pilot + tandem) shown on the Forecast modal. */
export function ForecastCallouts({ squad, world, data, pendingCallouts, onToggle }: Props) {
  const [pickingFor, setPickingFor] = useState<{ pilotId: Id; calloutId: Id } | null>(null);
  const pilotIds = squad.slots.filter((s): s is NonNullable<typeof s> => !!s).map((s) => s.pilotId);
  const isActive = (calloutId: Id, pilotId: Id) => pendingCallouts.some((c) => c.calloutId === calloutId && c.pilotId === pilotId);

  return (
    <div className="col gap-s">
      {pilotIds.map((pilotId) => {
        const pilot = world.pilots[pilotId];
        const def = getPilotDef(data, pilotId);
        if (!pilot || !def) return null;
        const known = pilot.callouts.filter((cid) => data.callouts[cid]?.kind === 'prebattle');
        if (known.length === 0 && pickingFor?.pilotId !== pilotId) return null;
        return (
          <div key={pilotId}>
            <div className="mono muted" style={{ fontSize: 10 }}>
              {def.callsign}
            </div>
            <div className="row gap-s" style={{ flexWrap: 'wrap' }}>
              {known.map((cid) => {
                const cdef = data.callouts[cid];
                const active = isActive(cid, pilotId);
                const affordable = pilot.nerve >= cdef.nerveCost;
                return (
                  <Button
                    key={cid}
                    small
                    variant={active ? 'primary' : 'ghost'}
                    disabled={!active && !affordable}
                    title={`${cdef.description}\nTradeoff: ${cdef.tradeoff}\n"${cdef.line}"`}
                    onClick={() => {
                      if (active) {
                        onToggle({ calloutId: cid, pilotId });
                        return;
                      }
                      if (cdef.needsAllyTarget) {
                        setPickingFor({ pilotId, calloutId: cid });
                      } else {
                        onToggle({ calloutId: cid, pilotId });
                      }
                    }}
                  >
                    {cdef.label} ({cdef.nerveCost})
                  </Button>
                );
              })}
            </div>
            {pickingFor?.pilotId === pilotId && (
              <div className="row gap-s" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                <span className="muted mono" style={{ fontSize: 10 }}>
                  Protect:
                </span>
                {pilotIds
                  .filter((id) => id !== pilotId)
                  .map((allyId) => {
                    const allyDef = getPilotDef(data, allyId);
                    return (
                      <Button
                        key={allyId}
                        small
                        variant="ghost"
                        onClick={() => {
                          onToggle({ calloutId: pickingFor.calloutId, pilotId, targetPilotId: allyId });
                          setPickingFor(null);
                        }}
                      >
                        {allyDef?.callsign ?? allyId}
                      </Button>
                    );
                  })}
                <Button small variant="ghost" onClick={() => setPickingFor(null)}>
                  CANCEL
                </Button>
              </div>
            )}
          </div>
        );
      })}
      <TandemRow pilotIds={pilotIds} world={world} data={data} pendingCallouts={pendingCallouts} onToggle={onToggle} />
    </div>
  );
}

function TandemRow({
  pilotIds,
  world,
  data,
  pendingCallouts,
  onToggle,
}: {
  pilotIds: Id[];
  world: WorldState;
  data: GameData;
  pendingCallouts: ActiveCallout[];
  onToggle: (c: ActiveCallout) => void;
}) {
  const chips: React.ReactNode[] = [];
  for (let i = 0; i < pilotIds.length; i++) {
    for (let j = i + 1; j < pilotIds.length; j++) {
      const a = world.pilots[pilotIds[i]];
      const b = world.pilots[pilotIds[j]];
      if (!a || !b) continue;
      const tandemIds = availableTandems(a, b, data).filter((cid) => data.callouts[cid]?.kind === 'tandem');
      for (const cid of tandemIds) {
        const cdef = data.callouts[cid];
        const active = pendingCallouts.some((c) => c.calloutId === cid && c.pilotId === a.id && c.partnerPilotId === b.id);
        const affordable = a.nerve >= cdef.nerveCost && b.nerve >= cdef.nerveCost;
        chips.push(
          <Button
            key={cid + a.id + b.id}
            small
            variant={active ? 'primary' : 'ghost'}
            disabled={!active && !affordable}
            title={`${cdef.description}\nTradeoff: ${cdef.tradeoff}\n"${cdef.line}"`}
            onClick={() => onToggle({ calloutId: cid, pilotId: a.id, partnerPilotId: b.id })}
          >
            {cdef.label} ({getPilotDef(data, a.id)?.callsign}+{getPilotDef(data, b.id)?.callsign}, {cdef.nerveCost}x2)
          </Button>
        );
      }
    }
  }
  if (chips.length === 0) return null;
  return (
    <div>
      <div className="mono muted" style={{ fontSize: 10 }}>
        TANDEM
      </div>
      <div className="row gap-s" style={{ flexWrap: 'wrap' }}>
        {chips}
      </div>
    </div>
  );
}
