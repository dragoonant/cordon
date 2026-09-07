import React from 'react';
import type { GameData, Id, RunState } from '@sim/types';
import { buildMech } from '@sim/hangar';
import { Button, ItemTooltip } from '@ui/components';

interface Props {
  run: RunState;
  data: GameData;
  onBump: () => void;
  onToast: (msg: string) => void;
}

/** Spare weapons/systems/frames inventory, with a BUILD button on each spare frame. */
export function InventoryPanel({ run, data, onBump, onToast }: Props) {
  function build(frameId: Id) {
    const mech = buildMech(run, frameId, data);
    if (!mech) onToast('Could not build that frame.');
    onBump();
  }

  return (
    <div className="col gap-s" style={{ marginTop: 12 }}>
      <div className="mono muted" style={{ fontSize: 11 }}>
        INVENTORY
      </div>
      <InventoryRow title="WEAPONS" ids={run.weapons} items={data.weapons} kind="weapon" data={data} />
      <InventoryRow title="SYSTEMS" ids={run.systems} items={data.systems} kind="system" data={data} />
      <div>
        <div className="mono muted" style={{ fontSize: 10 }}>
          FRAMES
        </div>
        <div className="col gap-s">
          {run.frames.length === 0 && (
            <span className="muted mono" style={{ fontSize: 10 }}>
              none
            </span>
          )}
          {run.frames.map((id, i) => (
            <div key={`${id}-${i}`} className="row gap-s" style={{ justifyContent: 'space-between' }}>
              <ItemTooltip kind="frame" id={id} data={data}>
                <span className="mono" style={{ fontSize: 11 }}>
                  {data.frames[id]?.name ?? id}
                </span>
              </ItemTooltip>
              <Button small variant="ghost" onClick={() => build(id)}>
                BUILD
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InventoryRow({
  title,
  ids,
  items,
  kind,
  data,
}: {
  title: string;
  ids: Id[];
  items: Record<string, { name: string }>;
  kind: 'weapon' | 'system';
  data: GameData;
}) {
  return (
    <div>
      <div className="mono muted" style={{ fontSize: 10 }}>
        {title}
      </div>
      <div className="row gap-s" style={{ flexWrap: 'wrap' }}>
        {ids.length === 0 && (
          <span className="muted mono" style={{ fontSize: 10 }}>
            none
          </span>
        )}
        {ids.map((id, i) => (
          <ItemTooltip key={`${id}-${i}`} kind={kind} id={id} data={data}>
            <span className="chip mono">{items[id]?.name ?? id}</span>
          </ItemTooltip>
        ))}
      </div>
    </div>
  );
}
