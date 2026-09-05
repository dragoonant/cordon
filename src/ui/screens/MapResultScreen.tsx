import React from 'react';
import { useStore } from '@ui/store';
import { Button, Panel, useData } from '@ui/components';
import type { ObjectiveStatus } from '@sim/types';

const BANNER: Record<string, string> = {
  victory: 'VICTORY',
  defeat: 'DEFEAT',
  withdraw: 'WITHDRAWN',
};

const BANNER_COLOR: Record<string, string> = {
  victory: 'var(--ok)',
  defeat: 'var(--danger)',
  withdraw: 'var(--muted)',
};

const STATUS_COLOR: Record<ObjectiveStatus, string> = {
  pending: 'var(--muted)',
  active: 'var(--amber)',
  complete: 'var(--ok)',
  failed: 'var(--danger)',
};

export function MapResultScreen() {
  const data = useData();
  const run = useStore((s) => s.run);
  const world = useStore((s) => s.world);
  const map = useStore((s) => s.map);
  const finishCurrentMap = useStore((s) => s.finishCurrentMap);
  const go = useStore((s) => s.go);

  if (!data || !run || !world || !map) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="No Result">
          <div className="col gap-m">
            <div className="muted mono">No map result to show.</div>
            <Button variant="ghost" onClick={() => go('title')}>
              Title
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const outcome = world.outcome ?? 'withdraw';

  const pilotsLost = Object.values(world.pilots).filter(
    (p) => !p.id.includes('#') && !p.alive && run.pilots[p.id]?.alive === true,
  );

  const mechIdsLost = Object.keys(run.mechs).filter((id) => world.mechs[id]?.destroyed);

  return (
    <div className="col" style={{ height: '100%', width: '100%', padding: 24, boxSizing: 'border-box', overflow: 'auto' }}>
      <div className="col gap-m" style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 className="mono title-glow" style={{ fontSize: 40, letterSpacing: '0.2em', color: BANNER_COLOR[outcome], margin: 0 }}>
            {BANNER[outcome] ?? outcome.toUpperCase()}
          </h1>
          <div className="muted mono" style={{ fontSize: 12 }}>
            {map.name}
          </div>
        </div>

        <Panel title="Objectives">
          <div className="col gap-s">
            {map.objectives.map((o) => {
              const state = world.objectives[o.id];
              const status: ObjectiveStatus = state?.status ?? 'pending';
              return (
                <div key={o.id} className="row mono" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                  <span>
                    {o.name} {o.required ? <span className="muted">(required)</span> : null}
                  </span>
                  <span style={{ color: STATUS_COLOR[status], textTransform: 'uppercase', fontSize: 10 }}>{status}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Losses">
          <div className="col gap-s">
            <div className="mono" style={{ fontSize: 12 }}>
              Pilots lost: {pilotsLost.length === 0 ? 'none' : pilotsLost.map((p) => data.pilots[p.id]?.callsign ?? p.id).join(', ')}
            </div>
            <div className="mono" style={{ fontSize: 12 }}>
              Mechs lost: {mechIdsLost.length}
            </div>
          </div>
        </Panel>

        <Button variant="primary" onClick={() => void finishCurrentMap()} style={{ alignSelf: 'center' }}>
          Continue
        </Button>
      </div>
    </div>
  );
}
