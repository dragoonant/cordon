import React, { useState } from 'react';
import type { MapDef, WorldState } from '@sim/types';
import { Bar, Button, Modal } from '@ui/components';
import { useStore } from '@ui/store';
import { fmtTime } from './mapHelpers';

interface Props {
  map: MapDef;
  world: WorldState;
  onHelp: () => void;
}

const KEY_FOR_SPEED: Record<number, string> = { 1: '1', 2: '2', 4: '3' };

export function TopBar({ map, world, onHelp }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const speed = useStore((s) => s.speed);
  const togglePause = useStore((s) => s.togglePause);
  const withdrawFromMap = useStore((s) => s.withdrawFromMap);

  return (
    <>
      <div className="hud-topbar row gap-m" style={barStyle}>
        <div className="row gap-s">
          <strong>{map.name}</strong>
          <span className="chip mono">{map.kind.toUpperCase()}</span>
        </div>
        <div className="mono">
          {fmtTime(world.time)}
          {map.timeLimit > 0 ? ` / ${fmtTime(map.timeLimit)}` : ''}
        </div>
        <div className="row gap-s">
          <Button small variant={world.speed === 0 ? 'primary' : 'ghost'} onClick={togglePause} title="Pause (Space)">
            {'⏸'}
          </Button>
          {[1, 2, 4].map((sp) => (
            <Button
              key={sp}
              small
              variant={world.speed === sp ? 'primary' : 'ghost'}
              onClick={() => speed(sp as 1 | 2 | 4)}
              title={`${sp}x speed (${KEY_FOR_SPEED[sp]})`}
            >
              {sp}x
            </Button>
          ))}
        </div>
        {map.carrierOnMap && (
          <div className="row gap-s grow" style={{ minWidth: 160, maxWidth: 220 }}>
            <span className="mono muted" style={{ fontSize: 10 }}>
              LANTERN
            </span>
            <Bar value={world.carrierHp} max={Math.max(1, world.carrierMaxHp)} color="var(--amber)" height={10} />
          </div>
        )}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" small onClick={onHelp} title="How to play (H)">
          ?
        </Button>
        <Button variant="ghost" small onClick={() => setConfirmOpen(true)} title="Withdraw from the map">
          WITHDRAW
        </Button>
      </div>
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="WITHDRAW?" width={380}>
        <p>Pull every squad out and end this map now. Incomplete objectives are recorded as failed.</p>
        <div className="row gap-s" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            CANCEL
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(false);
              withdrawFromMap();
            }}
          >
            WITHDRAW
          </Button>
        </div>
      </Modal>
    </>
  );
}

const barStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  padding: '8px 16px',
  background: 'var(--panel)',
  borderBottom: '1px solid var(--border)',
  pointerEvents: 'auto',
  zIndex: 10,
};
