import React, { useState } from 'react';
import type { NodeKind } from '@sim/types';
import { GLYPH } from '@ui/components/NodeGraph';

/** Node kinds worth explaining on the sector map; 'start' is self-evident and omitted. */
const LEGEND_KINDS: Exclude<NodeKind, 'start'>[] = ['battle', 'rescue', 'distress', 'salvage', 'depot', 'rival', 'boss'];

const MEANING: Record<Exclude<NodeKind, 'start'>, string> = {
  battle: 'Fight an enemy squad',
  rescue: 'Escort or hold to save colonists',
  distress: 'Pick a response, take the outcome',
  salvage: 'Recover scrap and spare parts',
  depot: 'Repair mechs, buy gear',
  rival: 'Optional grudge-match duel',
  boss: "Sector's final, hardest fight",
};

/** Small collapsible key for the node glyphs on the sector map, plus the
 *  space/ground mobility-fit reminder new players tend to miss. */
export function NodeMapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div style={wrapStyle}>
      <button style={toggleStyle} onClick={() => setOpen((v) => !v)}>
        LEGEND {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={bodyStyle}>
          {LEGEND_KINDS.map((k) => (
            <div key={k} className="row gap-s" style={{ alignItems: 'center' }}>
              <span className="mono" style={{ width: 16, textAlign: 'center' }}>
                {GLYPH[k]}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>
                {MEANING[k]}
              </span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.4, maxWidth: 230 }}>
            SPACE/SURFACE tags: bring frames that fit — space frames are slow in gravity, ground frames flounder in
            space.
          </div>
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  left: 10,
  bottom: 10,
  zIndex: 5,
};

const toggleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  color: 'var(--muted)',
  background: 'var(--panel-solid)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  padding: '3px 8px',
  cursor: 'pointer',
};

const bodyStyle: React.CSSProperties = {
  marginTop: 6,
  padding: '8px 10px',
  background: 'var(--panel-solid)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
