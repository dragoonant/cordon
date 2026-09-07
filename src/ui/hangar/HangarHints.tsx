import React from 'react';
import type { GameData, RunState } from '@sim/types';
import { canPilotFly } from '@sim/pilots';

/**
 * Call-to-action strip above the hangar columns.
 *
 * "How do I get more mechs?" was answerable but unsignposted: a bought or
 * salvaged frame lands in the inventory as an *unbuilt* spare, and nothing
 * told you it needed building before anyone could fly it. Same for a pilot
 * sitting on the bench with no machine. These say so, only when they apply.
 */
export function HangarHints({ run, data }: { run: RunState; data: GameData }) {
  const spareFrames = run.frames.length;

  const seatedPilotIds = new Set(
    run.squads.flatMap((sq) => sq.slots.filter((s) => s !== null).map((s) => s!.pilotId))
  );
  const benched = Object.values(run.pilots).filter((p) => p.alive && !p.injuredFor && !seatedPilotIds.has(p.id));

  // A benched pilot only matters if there's actually a machine free for them.
  const usedMechIds = new Set(
    run.squads.flatMap((sq) => sq.slots.filter((s) => s !== null).map((s) => s!.mechId))
  );
  const freeMechs = Object.values(run.mechs).filter((m) => !m.destroyed && !usedMechIds.has(m.id));
  const benchedWithRide = benched.filter((p) =>
    freeMechs.some((m) => {
      const frame = data.frames[m.frameId];
      return !!frame && canPilotFly(p, frame);
    })
  );

  const hints: { text: string; tone: 'amber' | 'ok' }[] = [];
  if (spareFrames > 0) {
    hints.push({
      tone: 'amber',
      text: `${spareFrames} unbuilt frame${spareFrames === 1 ? '' : 's'} in inventory — hit BUILD on one to turn it into a mech someone can fly.`,
    });
  }
  if (benchedWithRide.length > 0) {
    hints.push({
      tone: 'ok',
      text: `${benchedWithRide.length} pilot${benchedWithRide.length === 1 ? '' : 's'} on the bench with a spare machine — SEAT them into an empty squad slot.`,
    });
  } else if (benched.length > 0 && freeMechs.length === 0) {
    hints.push({
      tone: 'amber',
      text: `${benched.length} pilot${benched.length === 1 ? '' : 's'} benched with nothing to fly — build or buy a frame.`,
    });
  }

  if (hints.length === 0) return null;

  return (
    <div className="col gap-s" style={{ padding: '0 10px 8px' }}>
      {hints.map((h, i) => (
        <div
          key={i}
          className="mono"
          style={{
            fontSize: 11,
            padding: '6px 10px',
            border: `1px solid var(--${h.tone === 'amber' ? 'amber' : 'ok'})`,
            borderRadius: 3,
            color: `var(--${h.tone === 'amber' ? 'amber' : 'ok'})`,
            background: 'rgba(0,0,0,0.25)',
          }}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}
