import React from 'react';

export interface StatProps {
  label: string;
  value: React.ReactNode;
  good?: boolean | null;
}

export function Stat({ label, value, good }: StatProps) {
  const color = good === true ? 'var(--ok)' : good === false ? 'var(--danger)' : 'var(--fg)';
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
      <span className="muted mono">{label}</span>
      <span className="mono" style={{ color, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
