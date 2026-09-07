import React from 'react';
import type { GameData, Id, RunState } from '@sim/types';
import { Button, ItemTooltip, Portrait } from '@ui/components';
import { seatablePilots } from './hangarHelpers';

interface Props {
  run: RunState;
  data: GameData;
  lastMech: Record<Id, Id>;
  onSeat: (pilotId: Id) => void;
}

/**
 * Every pilot free to fly but not currently seated in any squad — so
 * unseating a unit never reads as "it's gone", just "it's here, waiting".
 */
export function BenchStrip({ run, data, lastMech, onSeat }: Props) {
  const pilots = seatablePilots(run);
  if (pilots.length === 0) return null;

  return (
    <div className="bench-strip">
      <div className="mono muted" style={{ fontSize: 10, marginBottom: 4 }}>
        BENCH — not seated
      </div>
      <div className="row gap-s" style={{ flexWrap: 'wrap' }}>
        {pilots.map((id) => {
          const def = data.pilots[id];
          if (!def) return null;
          const rememberedId = lastMech[id];
          const rememberedMech = rememberedId ? run.mechs[rememberedId] : undefined;
          const frame = rememberedMech ? data.frames[rememberedMech.frameId] : undefined;
          return (
            <div key={id} className="bench-item row gap-s">
              <Portrait pilotDefId={def.id} size={26} faction={def.faction} />
              <div className="col">
                <span className="mono" style={{ fontSize: 11 }}>
                  {def.callsign}
                </span>
                {frame ? (
                  <ItemTooltip kind="frame" id={rememberedMech?.frameId} data={data}>
                    <span className="muted mono" style={{ fontSize: 9 }}>
                      last: {frame.name}
                    </span>
                  </ItemTooltip>
                ) : (
                  <span className="muted mono" style={{ fontSize: 9 }}>
                    no mech yet
                  </span>
                )}
              </div>
              <Button small variant="ghost" onClick={() => onSeat(id)}>
                SEAT
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
