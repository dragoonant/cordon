import React from 'react';
import type { Id, NodeKind, RunSector } from '@sim/types';

export interface NodeGraphProps {
  sector: RunSector;
  currentNodeId: Id;
  reachableIds: Set<Id>;
  onSelect: (id: Id) => void;
}

const GLYPH: Record<NodeKind, string> = {
  battle: '⚔', // crossed swords
  rescue: '✚', // heavy greek cross
  distress: '⚠', // warning
  salvage: '⚙', // gear
  depot: '▣', // white square containing black square
  rival: '☠', // skull and crossbones
  boss: '★', // star
  start: '●', // circle
};

const DESCRIPTION: Record<NodeKind, string> = {
  battle: "Contact expected. Standard engagement, Command.",
  rescue: "Civilians on the line. Hold the timer, don't lose them.",
  distress: "Someone's calling on an open channel. Your call.",
  salvage: "Debris field reading hot. Might be scrap, might be a trap.",
  depot: 'Friendly dock ahead. Patch the frames, restock the racks.',
  rival: "Signature match, Command. It's them.",
  boss: "This is the chokepoint. Everything we've got.",
  start: "Origin point. The Lantern's shadow falls here.",
};

const W = 720;
const H = 480;
const MARGIN = 56;

export function NodeGraph({ sector, currentNodeId, reachableIds, onSelect }: NodeGraphProps) {
  const [hover, setHover] = React.useState<Id | null>(null);

  const maxCol = Math.max(1, ...sector.nodes.map((n) => n.col));
  const byCol = new Map<number, typeof sector.nodes>();
  for (const n of sector.nodes) {
    const arr = byCol.get(n.col) ?? [];
    arr.push(n);
    byCol.set(n.col, arr);
  }
  for (const arr of byCol.values()) arr.sort((a, b) => a.row - b.row);

  const pos = new Map<Id, { x: number; y: number }>();
  for (const [col, nodes] of byCol) {
    const x = MARGIN + (col / maxCol) * (W - 2 * MARGIN);
    nodes.forEach((n, i) => {
      const y = MARGIN + ((i + 1) / (nodes.length + 1)) * (H - 2 * MARGIN);
      pos.set(n.id, { x, y });
    });
  }

  const nodesById = new Map(sector.nodes.map((n) => [n.id, n]));
  const hoveredNode = hover ? nodesById.get(hover) : null;
  const hoveredPos = hover ? pos.get(hover) : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
        {/* edges */}
        {sector.nodes.map((n) =>
          n.edges.map((targetId) => {
            const a = pos.get(n.id);
            const b = pos.get(targetId);
            const target = nodesById.get(targetId);
            if (!a || !b || !target) return null;
            const isFromCurrent = n.id === currentNodeId && reachableIds.has(targetId);
            const dashed = !target.visited && !isFromCurrent;
            return (
              <line
                key={`${n.id}->${targetId}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isFromCurrent ? 'var(--amber)' : 'rgba(255,255,255,0.18)'}
                strokeWidth={isFromCurrent ? 2.5 : 1.5}
                strokeDasharray={dashed ? '4 4' : undefined}
                opacity={isFromCurrent ? 0.9 : 0.5}
              />
            );
          }),
        )}

        {/* nodes */}
        {sector.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const isCurrent = n.id === currentNodeId;
          const isReachable = reachableIds.has(n.id) && !isCurrent;
          const mapColor = n.mapKind === 'space' ? 'var(--violet)' : 'var(--olive)';
          const nodeColor = isCurrent ? 'var(--amber)' : n.cleared ? 'var(--ok)' : isReachable ? 'var(--fg)' : 'var(--muted)';
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: isReachable ? 'pointer' : 'default' }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
              onClick={() => isReachable && onSelect(n.id)}
            >
              {isCurrent && (
                <circle r={14} fill="none" stroke="var(--amber)" strokeWidth={2} opacity={0.7}>
                  <animate attributeName="r" values="14;24;14" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0;0.7" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                r={14}
                fill={isReachable ? 'rgba(255,165,60,0.15)' : 'rgba(255,255,255,0.04)'}
                stroke={nodeColor}
                strokeWidth={isReachable ? 2.5 : 1.5}
              />
              <text textAnchor="middle" dominantBaseline="central" fontSize={14} fill={nodeColor}>
                {GLYPH[n.kind]}
              </text>
              {n.cleared && (
                <text textAnchor="middle" x={11} y={-11} fontSize={11} fill="var(--ok)">
                  &#10003;
                </text>
              )}
              <text textAnchor="middle" y={28} fontSize={9} fill={nodeColor} fontFamily="var(--font-mono)">
                {n.label}
              </text>
              <text textAnchor="middle" y={39} fontSize={7} letterSpacing="0.1em" fill={mapColor} fontFamily="var(--font-mono)">
                {n.mapKind.toUpperCase()}
              </text>
              {Array.from({ length: n.threat }).map((_, i) => (
                <rect key={i} x={-9 + i * 6} y={-26} width={4} height={4} fill={nodeColor} opacity={0.85} />
              ))}
            </g>
          );
        })}
      </svg>

      {hoveredNode && hoveredPos && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            left: `${(hoveredPos.x / W) * 100}%`,
            top: `${(hoveredPos.y / H) * 100}%`,
            transform: 'translate(-50%, -140%)',
            background: 'var(--panel-solid)',
            border: '1px solid rgba(255,165,60,0.4)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 11,
            maxWidth: 220,
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 10,
          }}
        >
          <div style={{ color: 'var(--amber)', marginBottom: 2, textTransform: 'uppercase', fontSize: 10 }}>{hoveredNode.kind}</div>
          {DESCRIPTION[hoveredNode.kind]}
        </div>
      )}
    </div>
  );
}
