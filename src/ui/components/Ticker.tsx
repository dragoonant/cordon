import React from 'react';

export interface TickerProps {
  text: string | null;
}

const CHARS_PER_TICK = 2;
const TICK_MS = 16;

/** Captain radio line: amber left border, mono font, typewriter reveal on change. */
export function Ticker({ text }: TickerProps) {
  const [shown, setShown] = React.useState('');

  React.useEffect(() => {
    if (!text) {
      setShown('');
      return;
    }
    setShown('');
    let i = 0;
    const id = setInterval(() => {
      i += CHARS_PER_TICK;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [text]);

  if (!text) return null;

  return (
    <div
      className="mono"
      style={{
        borderLeft: '3px solid var(--amber)',
        background: 'rgba(255,165,60,0.06)',
        padding: '8px 12px',
        fontSize: 13,
        color: 'var(--fg)',
        lineHeight: 1.4,
        minHeight: '1.4em',
      }}
    >
      <span style={{ color: 'var(--amber)', marginRight: 8 }}>CAPT&gt;</span>
      {shown}
      {shown.length < text.length && <span className="cordon-pulse">▍</span>}
    </div>
  );
}
