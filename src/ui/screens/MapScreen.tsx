import React, { useEffect, useRef, useState } from 'react';
import type { Id, Vec2 } from '@sim/types';
import { MapScene } from '@render/map/MapScene';
import { Ticker } from '@ui/components';
import '@ui/map/map.css';
import { BattleOverlay } from '@ui/map/BattleOverlay';
import { DeployHint } from '@ui/map/DeployHint';
import { ForecastModal } from '@ui/map/ForecastModal';
import { guidanceLine } from '@ui/map/guidance';
import { HelpOverlay } from '@ui/map/HelpOverlay';
import type { Inspect } from '@ui/map/InspectPopover';
import { InspectPopover } from '@ui/map/InspectPopover';
import { EventLogStrip } from '@ui/map/EventLogStrip';
import { ObjectivesPanel } from '@ui/map/ObjectivesPanel';
import { SquadronsPanel } from '@ui/map/SquadronsPanel';
import { TopBar } from '@ui/map/TopBar';
import { TutorialOverlay } from '@ui/map/tutorial/TutorialOverlay';
import { useTutorial } from '@ui/map/tutorial/useTutorial';
import { useMapLoop } from '@ui/map/useMapLoop';
import { useStore } from '@ui/store';

const CAPTAIN_LINE_FRESH_MS = 8000;

/**
 * The real-time map screen: mounts MapScene into a full-viewport div, drives
 * the sim/render loop via useMapLoop, and layers the HUD (React) on top.
 * Screen routing (App.tsx) is expected to mount this only while
 * store.screen === 'map'.
 */
export function MapScreen() {
  const data = useStore((s) => s.data);
  const map = useStore((s) => s.map);
  const world = useStore((s) => s.world);
  // Subscribe to hudTick so the HUD re-renders on the store's ~10Hz cadence
  // without re-rendering on every 30Hz sim step.
  useStore((s) => s.hudTick);
  const selectedSquadId = useStore((s) => s.selectedSquadId);
  const selectSquad = useStore((s) => s.selectSquad);
  const deploy = useStore((s) => s.deploy);
  const captainLine = useStore((s) => s.captainLine);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const [inspect, setInspect] = useState<Inspect>(null);
  const [showHelp, setShowHelp] = useState(false);
  const tutorial = useTutorial();

  // Ticker falls back to the ambient guidance line once the captain's last
  // scripted line has been on screen for a while, rather than sitting blank.
  const lastCaptainAtRef = useRef(Date.now());
  const prevCaptainRef = useRef(captainLine);
  if (captainLine !== prevCaptainRef.current) {
    prevCaptainRef.current = captainLine;
    lastCaptainAtRef.current = Date.now();
  }
  const captainFresh = captainLine != null && Date.now() - lastCaptainAtRef.current < CAPTAIN_LINE_FRESH_MS;
  const guidance = world && map && data ? guidanceLine(world, map, data) : null;
  const tickerText = captainFresh ? captainLine : guidance ?? captainLine;

  useEffect(() => {
    if (!containerRef.current || !data || !map) return;
    let disposed = false;
    const scene = new MapScene(containerRef.current, data);
    sceneRef.current = scene;

    scene.load(map).then(() => {
      if (disposed) return;
      scene.onIntent((intent) => {
        switch (intent.t) {
          case 'select':
            useStore.getState().selectSquad(intent.squadId);
            break;
          case 'move':
            useStore.getState().move(intent.squadId, intent.target);
            break;
          case 'inspect_enemy':
            setInspect({ kind: 'enemy', squadId: intent.squadId });
            break;
          case 'inspect_objective':
            setInspect({ kind: 'objective', objectiveId: intent.objectiveId });
            break;
          default:
            break;
        }
      });
      const w = useStore.getState().world;
      if (w) scene.setState(w);
      scene.setSelected(useStore.getState().selectedSquadId);
    });

    return () => {
      disposed = true;
      scene.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, map]);

  useMapLoop({ sceneRef, onToggleHelp: () => setShowHelp((v) => !v) });

  function handleSelect(id: Id) {
    selectSquad(id);
    sceneRef.current?.setSelected(id);
  }
  function handleCenter(pos: Vec2) {
    sceneRef.current?.centerOn(pos);
  }

  if (!data || !map || !world) return null;

  return (
    <div className="map-screen" style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      <TopBar map={map} world={world} onHelp={() => setShowHelp(true)} />
      <SquadronsPanel world={world} data={data} map={map} selectedSquadId={selectedSquadId} onSelect={handleSelect} onDeploy={deploy} />
      <ObjectivesPanel world={world} data={data} map={map} onCenter={handleCenter} />
      <InspectPopover inspect={inspect} world={world} map={map} data={data} onClose={() => setInspect(null)} />

      {world.phase === 'deploy' && !(tutorial.active && tutorial.step?.id === 'deploy') && <DeployHint />}

      <div style={bottomStyle}>
        <Ticker text={tickerText} />
        <EventLogStrip world={world} data={data} />
      </div>

      <HelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />
      <ForecastModal />
      <BattleOverlay />
      <TutorialOverlay tutorial={tutorial} />
    </div>
  );
}

const bottomStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  pointerEvents: 'none',
  zIndex: 10,
};
