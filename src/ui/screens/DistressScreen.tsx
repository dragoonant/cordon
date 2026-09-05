import React from 'react';
import { useStore } from '@ui/store';
import { Button, Panel, Ticker, useData } from '@ui/components';
import { currentNode } from '@sim/run';

export function DistressScreen() {
  const data = useData();
  const run = useStore((s) => s.run);
  const resultText = useStore((s) => s.resultText);
  const chooseDistress = useStore((s) => s.chooseDistress);
  const leaveNode = useStore((s) => s.leaveNode);
  const go = useStore((s) => s.go);

  if (!data || !run) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="No Signal">
          <div className="col gap-m">
            <div className="muted mono">No active distress call.</div>
            <Button variant="ghost" onClick={() => go('title')}>
              Title
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const node = currentNode(run);
  const event = node.eventId ? data.events[node.eventId] : undefined;

  if (!event) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="No Signal">
          <div className="col gap-m">
            <div className="muted mono">Transmission lost.</div>
            <Button variant="ghost" onClick={() => void leaveNode()}>
              Continue
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', width: '100%', display: 'grid', placeItems: 'center', padding: 20, boxSizing: 'border-box' }}>
      <div className="col gap-m" style={{ width: 560, maxWidth: '92vw' }}>
        <Panel title="Distress Call" accent="relay">
          <div className="col gap-m">
            <h3 className="mono" style={{ margin: 0, color: 'var(--amber)' }}>
              {event.title}
            </h3>
            <Ticker text={event.text} />
          </div>
        </Panel>

        {resultText ? (
          <Panel title="Outcome">
            <div className="col gap-m">
              <div style={{ fontSize: 13 }}>{resultText}</div>
              <Button variant="primary" onClick={() => void leaveNode()}>
                Continue
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel title="Respond">
            <div className="col gap-s">
              {event.choices.map((c) => (
                <Button key={c.id} variant="ghost" onClick={() => void chooseDistress(c.id)} style={{ textAlign: 'left', width: '100%' }}>
                  {c.text}
                </Button>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
