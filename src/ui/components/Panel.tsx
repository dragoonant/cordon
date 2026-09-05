import React from 'react';

export type PanelAccent = 'relay' | 'compact' | 'neutral';

export interface PanelProps {
  children: React.ReactNode;
  title?: string;
  accent?: PanelAccent;
  style?: React.CSSProperties;
  className?: string;
  padded?: boolean;
}

const ACCENT_COLOR: Record<PanelAccent, string> = {
  relay: 'var(--amber)',
  compact: 'var(--steel)',
  neutral: 'var(--violet)',
};

export function Panel({ children, title, accent = 'neutral', style, className, padded = true }: PanelProps) {
  const color = ACCENT_COLOR[accent];
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        background: 'var(--panel)',
        border: `1px solid ${withAlpha(color, 0.6)}`,
        borderRadius: 4,
        backdropFilter: 'blur(2px)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.85 }} />
      {title && (
        <div
          className="mono"
          style={{
            padding: '8px 14px 6px',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color,
            borderBottom: `1px solid ${withAlpha(color, 0.25)}`,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ padding: padded ? 14 : 0 }}>{children}</div>
    </div>
  );
}

/** Accent colors are CSS var() references; resolve a fixed alpha overlay via color-mix
 *  so both light literal hexes and var() tokens work without a runtime color parser. */
function withAlpha(cssColor: string, alpha: number): string {
  return `color-mix(in srgb, ${cssColor} ${Math.round(alpha * 100)}%, transparent)`;
}
