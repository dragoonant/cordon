import React from 'react';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Hover/focus delay before showing, ms. */
  delay?: number;
}

/**
 * Shared hover/focus tooltip primitive. Wraps `children` in an inline span;
 * on hover or keyboard focus (after `delay`), renders `content` in a small
 * fixed-position card anchored to the trigger, flipped above/below to stay
 * on screen. No external libs, no portal — `position: fixed` is enough since
 * every screen in CORDON is a single full-viewport root.
 */
export function Tooltip({ content, children, delay = 150 }: TooltipProps) {
  const [pos, setPos] = React.useState<{ x: number; y: number; above: boolean } | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const anchorRef = React.useRef<HTMLSpanElement>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function show() {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const above = rect.top > 180;
      setPos({
        x: Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140),
        y: above ? rect.top - 8 : rect.bottom + 8,
        above,
      });
    }, delay);
  }

  function hide() {
    clearTimer();
    setPos(null);
  }

  React.useEffect(() => clearTimer, []);

  if (!content) return <>{children}</>;

  return (
    <span
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}
    >
      {children}
      {pos && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`,
            zIndex: 9999,
            width: 260,
            maxWidth: '80vw',
            padding: '8px 10px',
            background: 'var(--panel-solid)',
            border: '1px solid rgba(255,165,60,0.5)',
            borderRadius: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--fg)',
            pointerEvents: 'none',
          }}
        >
          {content}
        </div>
      )}
    </span>
  );
}
