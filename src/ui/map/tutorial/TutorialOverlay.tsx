import React, { useEffect, useState } from 'react';
import { Button } from '@ui/components';
import type { TutorialController } from './useTutorial';

interface Props {
  tutorial: TutorialController;
}

const CARD_WIDTH = 300;

/** Coach-mark layer: an amber highlight ring around the real UI element the
 *  current step refers to, plus a small floating instruction card. Renders
 *  above every other map layer (including the Forecast modal) so it can
 *  point at COMMIT mid-modal. */
export function TutorialOverlay({ tutorial }: Props) {
  const { active, step, stepIndex, total, next, skip } = tutorial;
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active || !step?.anchor) {
      setRect(null);
      return;
    }
    let raf = 0;
    const selector = step.anchor;
    function poll() {
      const el = selector ? document.querySelector(selector) : null;
      setRect(el ? el.getBoundingClientRect() : null);
      raf = requestAnimationFrame(poll);
    }
    poll();
    return () => cancelAnimationFrame(raf);
  }, [active, step]);

  if (!active || !step) return null;
  // An anchored step whose target isn't on screen right now (e.g. the
  // Forecast modal closed mid-battle) stays silent rather than floating in
  // the wrong place.
  if (step.anchor && !rect) return null;

  const isLast = stepIndex === total - 1;

  return (
    <div style={layerStyle}>
      {rect && (
        <div
          style={{
            position: 'fixed',
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            border: '2px solid var(--amber)',
            borderRadius: 6,
            boxShadow: '0 0 0 4000px rgba(4,5,8,0.45), 0 0 14px rgba(255,165,60,0.7)',
            pointerEvents: 'none',
            animation: 'cordon-pulse 1.6s ease-in-out infinite',
          }}
        />
      )}
      <div className="mono" style={cardStyle(rect)}>
        <div className="muted" style={{ fontSize: 10, letterSpacing: '0.1em', marginBottom: 6 }}>
          TUTORIAL {stepIndex + 1}/{total}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--fg)' }}>{step.text}</div>
        <div className="row gap-s" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <Button small variant="ghost" onClick={skip}>
            SKIP TUTORIAL
          </Button>
          <Button small variant="primary" onClick={next}>
            {isLast ? 'DONE' : 'NEXT'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const layerStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 8500, // above ForecastModal (8000) so it can point into it
  pointerEvents: 'none',
};

function cardStyle(rect: DOMRect | null): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'fixed',
    width: CARD_WIDTH,
    padding: '12px 14px',
    background: 'var(--panel-solid)',
    border: '1px solid rgba(255,165,60,0.6)',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    pointerEvents: 'auto',
  };
  if (!rect) {
    return { ...base, left: '50%', bottom: 150, transform: 'translateX(-50%)' };
  }
  const preferBelow = rect.bottom + 200 < window.innerHeight;
  const top = preferBelow ? rect.bottom + 14 : Math.max(14, rect.top - 14 - 160);
  const left = Math.min(window.innerWidth - CARD_WIDTH - 14, Math.max(14, rect.left));
  return { ...base, left, top };
}
