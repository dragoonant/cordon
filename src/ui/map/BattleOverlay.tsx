import React, { useEffect, useRef, useState } from 'react';
import type { BattleEvent } from '@sim/types';
import { BattleStage } from '@render/battle/BattleStage';
import { playVoice } from '@audio/index';
import { Button } from '@ui/components';
import { useStore } from '@ui/store';
import { battleEventText } from './battleText';

/** Full-viewport SRW-style battle playback. Renders only while store.battle is set. */
export function BattleOverlay() {
  const battle = useStore((s) => s.battle);
  const data = useStore((s) => s.data);
  const save = useStore((s) => s.save);
  const battleFinished = useStore((s) => s.battleFinished);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<BattleStage | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [fast, setFast] = useState(false);

  useEffect(() => {
    if (!battle || !data || !containerRef.current) return;
    const stage = new BattleStage(containerRef.current, data);
    stageRef.current = stage;
    setLog([]);
    setFast(false);

    const initialSpeed = save?.settings.battleSpeed ?? 'full';
    stage.play(battle.result, battle.sides, {
      speed: initialSpeed,
      onEvent: (e: BattleEvent) => {
        // Voice lines fire when the stage reaches the event, so they line up
        // with the cut-in rather than playing at commit time.
        try {
          if (e.t === 'last_transmission') void playVoice(e.pilotId.split('#')[0], 'last');
          else if (e.t === 'callout') void playVoice(e.pilotId.split('#')[0], e.calloutId);
          else if (e.t === 'finisher') void playVoice(e.pilotId.split('#')[0], 'finisher');
        } catch {
          // best-effort — a missing voice clip should never break playback
        }
        const text = battleEventText(e, data);
        if (text) setLog((prev) => [...prev, text].slice(-3));
      },
      onComplete: () => battleFinished(),
    });

    return () => {
      stage.destroy();
      stageRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle, data]);

  if (!battle || !data) return null;

  return (
    <div className="battle-overlay">
      <div ref={containerRef} className="battle-canvas" />
      <div className="battle-subtitle-strip">
        {log.map((l, i) => (
          <div key={i} className="mono">
            {l}
          </div>
        ))}
      </div>
      <div className="battle-controls">
        <Button
          small
          variant="ghost"
          onClick={() => {
            const next = !fast;
            setFast(next);
            stageRef.current?.setSpeed(next ? 'fast' : 'full');
          }}
        >
          {fast ? 'FAST' : 'FULL'}
        </Button>
        <Button small variant="primary" onClick={() => stageRef.current?.skip()}>
          SKIP
        </Button>
      </div>
    </div>
  );
}
