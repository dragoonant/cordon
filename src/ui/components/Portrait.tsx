import React from 'react';
import { useStore } from '@ui/store';
import type { Faction } from '@sim/types';
import { assetUrl } from '../../assetUrl';

export interface PortraitProps {
  pilotDefId: string;
  expression?: 'neutral' | 'shout' | 'strained' | 'grin';
  size?: number;
  faction?: Faction;
  dimmed?: boolean;
}

const ACCENT: Record<Faction, string> = {
  relay: '#ffa53c',
  compact: '#6fb7ff',
  neutral: '#b08cff',
};

function initialsOf(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Portrait({ pilotDefId, expression = 'neutral', size = 64, faction, dimmed }: PortraitProps) {
  const [failed, setFailed] = React.useState(false);
  const def = useStore((s) => s.data?.pilots[pilotDefId]);
  const resolvedFaction: Faction = faction ?? def?.faction ?? 'neutral';
  const accent = ACCENT[resolvedFaction];
  const label = initialsOf(def?.callsign ?? def?.name ?? pilotDefId);
  const src = assetUrl(`/portraits/${pilotDefId}_${expression}.png`);

  const dimStyle: React.CSSProperties = dimmed ? { filter: 'grayscale(1) brightness(0.6)', opacity: 0.4 } : {};

  if (!failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          overflow: 'hidden',
          border: `1px solid ${accent}99`,
          flex: '0 0 auto',
          ...dimStyle,
        }}
      >
        <img
          src={src}
          alt={def?.callsign ?? pilotDefId}
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className="mono"
      title={def?.callsign ?? pilotDefId}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flex: '0 0 auto',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size * 0.32,
        color: accent,
        background: `linear-gradient(155deg, ${accent}33 0%, #12141c 70%)`,
        border: `1px solid ${accent}99`,
        letterSpacing: '0.02em',
        ...dimStyle,
      }}
    >
      {label}
    </div>
  );
}
