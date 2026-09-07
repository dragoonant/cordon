import React from 'react';
import type { GameData, RunState } from '@sim/types';
import { Panel } from '@ui/components';
import { InventoryPanel } from './InventoryPanel';
import { MechCard } from './MechCard';

interface Props {
  run: RunState;
  data: GameData;
  onBump: () => void;
  onToast: (msg: string) => void;
}

/** Right column: built mechs (HP/load/slots/repair/scrap) + spare inventory. */
export function HangarColumn({ run, data, onBump, onToast }: Props) {
  const mechs = Object.values(run.mechs);

  return (
    <Panel title="HANGAR" accent="compact" padded style={{ height: '100%', overflowY: 'auto' }}>
      <div className="col gap-m">
        {mechs.length === 0 && (
          <div className="muted mono" style={{ fontSize: 11 }}>
            No mechs built.
          </div>
        )}
        {mechs.map((mech) => (
          <MechCard key={mech.id} run={run} data={data} mech={mech} onBump={onBump} onToast={onToast} />
        ))}
      </div>
      <InventoryPanel run={run} data={data} onBump={onBump} onToast={onToast} />
    </Panel>
  );
}
