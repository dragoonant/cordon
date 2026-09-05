import React from 'react';
import { useStore } from '@ui/store';
import { Bar, Button, Panel, Portrait, Ticker, useData, useHud } from '@ui/components';
import { NodeGraph } from '@ui/components/NodeGraph';
import { reachableNodes } from '@sim/run';

export function NodeMapScreen() {
  useHud();
  const data = useData();
  const run = useStore((s) => s.run);
  const captainLine = useStore((s) => s.captainLine);
  const travel = useStore((s) => s.travel);
  const openHangar = useStore((s) => s.openHangar);
  const go = useStore((s) => s.go);

  React.useEffect(() => {
    if (!run) {
      const id = setTimeout(() => useStore.getState().go('title'), 0);
      return () => clearTimeout(id);
    }
  }, [run]);

  if (!data || !run) {
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

  const sector = run.sectors[run.sectorIndex];
  const reachable = new Set(reachableNodes(run).map((n) => n.id));

  return (
    <div className="col" style={{ height: '100%', width: '100%', padding: 20, boxSizing: 'border-box', gap: 14 }}>
      <div className="row grow" style={{ gap: 14, minHeight: 0 }}>
        <div className="col grow" style={{ flexBasis: '70%', minWidth: 0 }}>
          <Panel title={sector?.name ?? 'Sector'} style={{ height: '100%' }} padded={false}>
            {sector ? (
              <NodeGraph
                sector={sector}
                currentNodeId={run.currentNodeId}
                reachableIds={reachable}
                onSelect={(id) => void travel(id)}
              />
            ) : (
              <div className="muted mono" style={{ padding: 14 }}>
                No sector data.
              </div>
            )}
          </Panel>
        </div>

        <div className="col gap-m" style={{ flexBasis: '30%', minWidth: 280, overflow: 'auto' }}>
          <Panel title="Lantern" accent="relay">
            <div className="col gap-s">
              <Row label="Sector" value={sector?.name ?? '—'} />
              <Row label="Turn" value={String(run.turn)} />
              <Row label="Scrap" value={String(run.scrap)} />
              <Row label="Ascension" value={String(run.ascension)} />
              <Bar value={run.standing} max={100} label="Standing" color="var(--steel)" />
            </div>
          </Panel>

          <Panel title="Roster">
            <div className="col gap-s" style={{ maxHeight: 260, overflow: 'auto' }}>
              {Object.values(run.pilots).map((pilot) => {
                const def = data.pilots[pilot.id];
                if (!def) return null;
                const state = !pilot.alive ? 'KIA' : pilot.injuredFor > 0 ? `Injured (${pilot.injuredFor})` : 'Ready';
                return (
                  <div key={pilot.id} className="row gap-s" style={{ alignItems: 'center' }}>
                    <Portrait pilotDefId={def.id} size={32} faction={def.faction} dimmed={!pilot.alive} />
                    <div className="col grow" style={{ minWidth: 0 }}>
                      <div className="row mono" style={{ justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ opacity: pilot.alive ? 1 : 0.5 }}>{def.callsign}</span>
                        <span className={!pilot.alive ? '' : undefined} style={{ color: !pilot.alive ? 'var(--danger)' : pilot.injuredFor > 0 ? 'var(--amber)' : 'var(--ok)' }}>
                          {state}
                        </span>
                      </div>
                      <Bar value={pilot.nerve} max={pilot.maxNerve} height={5} showText={false} color="var(--violet)" />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Squads">
            <div className="col gap-s">
              {run.squads.map((sq) => {
                const memberCount = sq.slots.filter(Boolean).length;
                const leader = sq.leaderPilotId ? data.pilots[sq.leaderPilotId]?.callsign : null;
                return (
                  <div key={sq.id} className="row mono" style={{ justifyContent: 'space-between', fontSize: 11 }}>
                    <span>{sq.name}</span>
                    <span className="muted">
                      {memberCount}/6 {leader ? `· ${leader}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <div className="row gap-s">
            <Button variant="ghost" onClick={openHangar} style={{ flex: 1 }}>
              Hangar
            </Button>
            <Button variant="ghost" onClick={() => go('settings')} style={{ flex: 1 }}>
              Settings
            </Button>
          </div>
        </div>
      </div>

      <Ticker text={captainLine} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row mono" style={{ justifyContent: 'space-between', fontSize: 12 }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
