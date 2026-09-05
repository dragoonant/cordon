import React from 'react';
import { useStore } from '@ui/store';
import { Button, Panel } from '@ui/components';

const FLAVOR = "Cold metal, cold circuits. Whatever's left of them, we make it ours.";

export function SalvageScreen() {
  const salvageText = useStore((s) => s.salvageText);
  const leaveNode = useStore((s) => s.leaveNode);
  const go = useStore((s) => s.go);
  const run = useStore((s) => s.run);

  if (!run) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="No Run">
          <div className="col gap-m">
            <div className="muted mono">No active run.</div>
            <Button variant="ghost" onClick={() => go('title')}>
              Title
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', width: '100%', display: 'grid', placeItems: 'center', padding: 20, boxSizing: 'border-box' }}>
      <div className="col gap-m" style={{ width: 480, maxWidth: '92vw' }}>
        <Panel title="Salvage Field" accent="neutral">
          <div className="col gap-m">
            <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>
              {FLAVOR}
            </div>
            <div className="mono" style={{ fontSize: 13 }}>
              {salvageText ?? 'Sweeping the field…'}
            </div>
            <Button variant="primary" onClick={() => void leaveNode()}>
              Continue
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
