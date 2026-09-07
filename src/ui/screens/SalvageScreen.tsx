import React from 'react';
import { useStore } from '@ui/store';
import { Button, ItemTooltip, Panel, useData } from '@ui/components';

const FLAVOR = "Cold metal, cold circuits. Whatever's left of them, we make it ours.";

export function SalvageScreen() {
  const salvageText = useStore((s) => s.salvageText);
  const salvageDrop = useStore((s) => s.salvageDrop);
  const leaveNode = useStore((s) => s.leaveNode);
  const go = useStore((s) => s.go);
  const run = useStore((s) => s.run);
  const data = useData();

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
            {data && salvageDrop ? (
              <div className="col gap-s">
                <div className="row gap-s" style={{ flexWrap: 'wrap' }}>
                  {salvageDrop.weapons.map((id, i) => (
                    <ItemTooltip key={`w${i}`} kind="weapon" id={id} data={data}>
                      <span className="chip mono">{data.weapons[id]?.name ?? id}</span>
                    </ItemTooltip>
                  ))}
                  {salvageDrop.systems.map((id, i) => (
                    <ItemTooltip key={`s${i}`} kind="system" id={id} data={data}>
                      <span className="chip mono">{data.systems[id]?.name ?? id}</span>
                    </ItemTooltip>
                  ))}
                  {salvageDrop.frames.map((id, i) => (
                    <ItemTooltip key={`f${i}`} kind="frame" id={id} data={data}>
                      <span className="chip mono">{data.frames[id]?.name ?? id}</span>
                    </ItemTooltip>
                  ))}
                  {salvageDrop.weapons.length + salvageDrop.systems.length + salvageDrop.frames.length === 0 && (
                    <span className="muted mono">nothing usable</span>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 13 }}>
                  +{salvageDrop.scrap} scrap.
                </div>
              </div>
            ) : (
              <div className="mono" style={{ fontSize: 13 }}>
                {salvageText ?? 'Sweeping the field…'}
              </div>
            )}
            <Button variant="primary" onClick={() => void leaveNode()}>
              Continue
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
