/**
 * CORDON — first-map coach-mark tutorial state machine.
 *
 * Eligible only on the first map of a player's first run (no finished map
 * history yet) while `settings.tutorialSeen` is false. Advances mostly by
 * polling world/store state (deploy → move → hold), but a battle can
 * interrupt at any point, so `battle_pending`/victory checks are allowed to
 * jump the pointer forward out of order (never backward). NEXT always lets
 * an impatient player skip ahead manually; SKIP TUTORIAL exits immediately.
 * Finishing (by any route) marks `tutorialSeen` via `updateSettings` — the
 * only store mutation this hook performs.
 */
import { useEffect, useRef, useState } from 'react';
import { playerSquads } from '@sim/world';
import { useStore } from '@ui/store';
import { TUTORIAL_STEPS, type TutorialStep } from './steps';

export interface TutorialController {
  active: boolean;
  step: TutorialStep | null;
  stepIndex: number;
  total: number;
  next: () => void;
  skip: () => void;
}

export function useTutorial(): TutorialController {
  const save = useStore((s) => s.save);
  const run = useStore((s) => s.run);
  const world = useStore((s) => s.world);
  const screen = useStore((s) => s.screen);
  const updateSettings = useStore((s) => s.updateSettings);
  // world is a mutable reference the store bumps in place (see store.ts), so
  // hudTick — not the world reference — is what tells this effect to re-run.
  const hudTick = useStore((s) => s.hudTick);

  const eligible = !!save && save.settings.tutorialSeen !== true && !!run && run.history.length === 0 && screen === 'map';

  const [stepIndex, setStepIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!eligible || dismissed || !world) return;
    setStepIndex((idx) => {
      let next = idx;
      const squads = playerSquads(world);
      if (idx <= 0 && squads.some((sq) => sq.state !== 'docked')) next = Math.max(next, 1);
      if (idx <= 1 && squads.some((sq) => sq.state === 'moving')) next = Math.max(next, 2);
      if (idx <= 2 && Object.values(world.objectives).some((o) => o.progress > 0)) next = Math.max(next, 3);
      if (idx <= 3 && world.phase === 'battle_pending') next = Math.max(next, 3);
      if (idx === 3 && world.phase !== 'battle_pending' && world.phase !== 'battle' && world.lastBattle) {
        next = Math.max(next, 4);
      }
      if (idx <= 4 && world.phase === 'ended' && world.outcome === 'victory') next = Math.max(next, 5);
      return next;
    });
  }, [eligible, dismissed, world, hudTick]);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setDismissed(true);
    void updateSettings({ tutorialSeen: true });
  }

  function next() {
    if (stepIndex >= TUTORIAL_STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function skip() {
    finish();
  }

  const active = eligible && !dismissed;
  return {
    active,
    step: active ? TUTORIAL_STEPS[stepIndex] : null,
    stepIndex,
    total: TUTORIAL_STEPS.length,
    next,
    skip,
  };
}
