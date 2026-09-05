import React from 'react';
import { useStore } from '@ui/store';
import { Button, Panel, Portrait, useData } from '@ui/components';

function pickLine(lines: string[] | undefined, seed: number): string | null {
  if (!lines || lines.length === 0) return null;
  return lines[Math.abs(seed) % lines.length];
}

export function RunEndScreen() {
  const data = useData();
  const run = useStore((s) => s.run);
  const concludeRun = useStore((s) => s.concludeRun);
  const go = useStore((s) => s.go);

  if (!data || !run) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="No Run">
          <div className="col gap-m">
            <div className="muted mono">Nothing to report.</div>
            <Button variant="ghost" onClick={() => go('title')}>
              Title
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const won = run.status === 'won';
  const headline = won ? 'THE CORDON IS BROKEN' : 'THE LANTERN GOES DARK';
  const line = pickLine(won ? data.captainLines.runWon : data.captainLines.runLost, run.seed);

  return (
    <div className="col" style={{ height: '100%', width: '100%', padding: 24, boxSizing: 'border-box', overflow: 'auto' }}>
      <div className="col gap-m" style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <h1
            className="mono title-glow"
            style={{ fontSize: 30, letterSpacing: '0.12em', color: won ? 'var(--amber)' : 'var(--danger)', margin: 0 }}
          >
            {headline}
          </h1>
          {line && (
            <div className="muted mono" style={{ fontSize: 13, marginTop: 10, fontStyle: 'italic' }}>
              &ldquo;{line}&rdquo;
            </div>
          )}
        </div>

        <Panel title="Run History">
          <div className="col gap-s" style={{ maxHeight: 220, overflow: 'auto' }}>
            {run.history.length === 0 && <div className="muted mono">No recorded engagements.</div>}
            {run.history.map((h, i) => (
              <div key={i} className="row mono" style={{ justifyContent: 'space-between', fontSize: 11 }}>
                <span className="muted">{h.kind}</span>
                <span>{h.outcome}</span>
                <span className="muted">+{h.scrapGained} scrap</span>
                <span style={{ color: h.pilotDeaths.length > 0 ? 'var(--danger)' : 'var(--muted)' }}>
                  {h.pilotDeaths.length > 0 ? `-${h.pilotDeaths.length} pilot(s)` : ''}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Roster">
          <div className="col gap-s" style={{ maxHeight: 220, overflow: 'auto' }}>
            {Object.values(run.pilots).map((pilot) => {
              const def = data.pilots[pilot.id];
              if (!def) return null;
              return (
                <div key={pilot.id} className="row gap-s" style={{ alignItems: 'center' }}>
                  <Portrait pilotDefId={def.id} size={28} faction={def.faction} dimmed={!pilot.alive} />
                  <span className="mono" style={{ fontSize: 11, opacity: pilot.alive ? 1 : 0.5 }}>
                    {def.callsign}
                  </span>
                  {!pilot.alive && (
                    <span className="mono" style={{ fontSize: 10, color: 'var(--danger)' }}>
                      KIA
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <Button variant="primary" onClick={() => void concludeRun()} style={{ alignSelf: 'center' }}>
          Continue
        </Button>
      </div>
    </div>
  );
}
