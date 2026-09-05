import React from 'react';

export function BootScreen() {
  return (
    <div className="col" style={{ height: '100%', width: '100%', display: 'grid', placeItems: 'center' }}>
      <div className="col gap-m" style={{ alignItems: 'center' }}>
        <h1
          className="mono title-glow"
          style={{
            fontSize: 56,
            letterSpacing: '0.4em',
            fontWeight: 300,
            margin: 0,
            color: 'var(--amber)',
          }}
        >
          CORDON
        </h1>
        <div className="mono cordon-pulse muted" style={{ fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          establishing uplink&hellip;
        </div>
      </div>
    </div>
  );
}
