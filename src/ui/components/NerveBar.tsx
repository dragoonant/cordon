import React from 'react';
import { Bar } from './Bar';
import { Tooltip } from './Tooltip';

export interface NerveBarProps {
  nerve: number;
  maxNerve: number;
  height?: number;
  showText?: boolean;
  label?: string;
}

const NERVE_EXPLANATION = (
  <div className="col gap-s">
    <strong style={{ color: 'var(--violet)' }}>Nerve</strong>
    <div>Pays for Callouts — pre-battle on the Forecast, and on the real-time map.</div>
    <div>
      Regenerates: +1 every 20s deployed &middot; +5 when an objective completes &middot; +8 to survivors when a
      squadmate dies &middot; +3 to winners.
    </div>
    <div className="muted">Capped at this pilot&rsquo;s max.</div>
  </div>
);

/**
 * A pilot's Nerve bar, everywhere it appears: hover/focus explains what
 * Nerve is and how it regenerates; a drop in value (a Callout being spent)
 * flashes the bar and floats a "-N NERVE" readout for a moment.
 */
export function NerveBar({ nerve, maxNerve, height = 5, showText = true, label = 'NERVE' }: NerveBarProps) {
  const prevRef = React.useRef(nerve);
  const [flash, setFlash] = React.useState<number | null>(null);

  React.useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = nerve;
    if (nerve < prev) {
      const drop = prev - nerve;
      setFlash(drop);
      const t = window.setTimeout(() => setFlash(null), 900);
      return () => window.clearTimeout(t);
    }
  }, [nerve]);

  return (
    <Tooltip content={NERVE_EXPLANATION}>
      <div className={flash ? 'nerve-bar-wrap nerve-flash' : 'nerve-bar-wrap'}>
        <Bar value={nerve} max={maxNerve} height={height} color="var(--violet)" label={label} showText={showText} />
        {flash != null && <span className="nerve-float">-{flash} NERVE</span>}
      </div>
    </Tooltip>
  );
}
