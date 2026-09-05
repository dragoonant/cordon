/**
 * The real-time map's render/sim loop and keyboard shortcuts.
 *
 * Owns the requestAnimationFrame loop: clamps dt to 0.1s, skips stepping while
 * the tab is hidden (store.tick is a no-op off the 'map' screen so this is
 * belt-and-suspenders), and pushes the latest WorldState into the Pixi scene
 * every frame. Keyboard shortcuts operate on store state directly via
 * `useStore.getState()` so this hook doesn't need to re-run on every store
 * change.
 */
import { useEffect, useRef } from 'react';
import type { MapScene } from '@render/map/MapScene';
import { playerSquads } from '@sim/world';
import { useStore } from '@ui/store';

interface Options {
  sceneRef: React.RefObject<MapScene | null>;
  onToggleHelp: () => void;
}

export function useMapLoop({ sceneRef, onToggleHelp }: Options) {
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame);
      const last = lastRef.current;
      lastRef.current = now;
      if (last == null) return;
      let dt = (now - last) / 1000;
      if (dt > 0.1) dt = 0.1;

      const s = useStore.getState();
      if (!s.world || s.screen !== 'map') return;
      if (!document.hidden) s.tick(dt);

      const scene = sceneRef.current;
      const world = useStore.getState().world;
      if (scene && world) scene.setState(world);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const s = useStore.getState();
      if (!s.world || s.screen !== 'map') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          s.togglePause();
          break;
        case 'Digit1':
          s.speed(1);
          break;
        case 'Digit2':
          s.speed(2);
          break;
        case 'Digit3':
          s.speed(4);
          break;
        case 'Tab': {
          e.preventDefault();
          const squads = playerSquads(s.world).filter((sq) => sq.state !== 'destroyed');
          if (squads.length === 0) break;
          const idx = squads.findIndex((sq) => sq.id === s.selectedSquadId);
          const next = squads[(idx + 1) % squads.length];
          s.selectSquad(next.id);
          sceneRef.current?.setSelected(next.id);
          break;
        }
        case 'KeyR':
          if (s.selectedSquadId) s.recall(s.selectedSquadId);
          break;
        case 'Escape':
          s.selectSquad(null);
          sceneRef.current?.setSelected(null);
          break;
        case 'KeyH':
          onToggleHelp();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sceneRef, onToggleHelp]);
}
