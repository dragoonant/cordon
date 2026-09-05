import React from 'react';

export interface BarProps {
  value: number;
  max: number;
  color?: string;
  height?: number;
  label?: string;
  showText?: boolean;
}

function ratioColor(ratio: number): string {
  if (ratio > 0.6) return 'var(--ok)';
  if (ratio > 0.3) return 'var(--amber)';
  return 'var(--danger)';
}

export function Bar({ value, max, color, height = 8, label, showText = true }: BarProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const barColor = color ?? ratioColor(ratio);
  return (
    <div className="col gap-s" style={{ width: '100%' }}>
      {(label || showText) && (
        <div className="row mono" style={{ fontSize: 10, color: 'var(--muted)', justifyContent: 'space-between' }}>
          <span>{label}</span>
          {showText && (
            <span>
              {Math.round(value)}/{Math.round(max)}
            </span>
          )}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: height / 2,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            background: barColor,
            transition: 'width 0.25s ease, background 0.25s ease',
          }}
        />
      </div>
    </div>
  );
}
