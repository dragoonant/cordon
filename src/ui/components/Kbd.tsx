import React from 'react';

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        fontSize: 10,
        borderRadius: 3,
        border: '1px solid rgba(255,255,255,0.25)',
        background: 'rgba(255,255,255,0.06)',
        color: 'var(--fg)',
        lineHeight: '16px',
      }}
    >
      {children}
    </span>
  );
}
