import React from 'react';
import './theme.css';
import { useStore } from '@ui/store';
import { ErrorBoundary } from './ErrorBoundary';
import { BootScreen } from './screens/BootScreen';
import { TitleScreen } from './screens/TitleScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { NodeMapScreen } from './screens/NodeMapScreen';
import { BriefingScreen } from './screens/BriefingScreen';
import { DistressScreen } from './screens/DistressScreen';
import { DepotScreen } from './screens/DepotScreen';
import { SalvageScreen } from './screens/SalvageScreen';
import { MapResultScreen } from './screens/MapResultScreen';
import { RunEndScreen } from './screens/RunEndScreen';
// Owned by the map/hangar workstream; imported by path per the shared contract.
// These files may not exist yet during concurrent development.
import { HangarScreen } from './screens/HangarScreen';
import { MapScreen } from './screens/MapScreen';

/** Screens where Escape should trigger `back()`. Excludes 'map' (own key handling
 *  there — Escape shouldn't yank the player out of a live battle map) and 'boot'
 *  (nothing to go back to). */
// Only overlay-style screens go "back". Node screens (depot/distress/salvage/
// results) must exit through their own CONTINUE so run state is finalized.
const MENU_SCREENS = new Set(['settings', 'hangar']);

export function App() {
  const screen = useStore((s) => s.screen);
  const error = useStore((s) => s.error);
  const boot = useStore((s) => s.boot);
  const back = useStore((s) => s.back);

  React.useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && MENU_SCREENS.has(useStore.getState().screen)) {
        back();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [back]);

  return (
    <div className="cordon-root">
      <ErrorBoundary key={screen}>{renderScreen(screen)}</ErrorBoundary>
      <div className="cordon-vignette" />
      <div className="cordon-scanlines" />
      {error && (
        <div className="cordon-toast mono" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function renderScreen(screen: ReturnType<typeof useStore.getState>['screen']) {
  switch (screen) {
    case 'boot':
      return <BootScreen />;
    case 'title':
      return <TitleScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'node_map':
      return <NodeMapScreen />;
    case 'briefing':
      return <BriefingScreen />;
    case 'distress':
      return <DistressScreen />;
    case 'depot':
      return <DepotScreen />;
    case 'salvage':
      return <SalvageScreen />;
    case 'map_result':
      return <MapResultScreen />;
    case 'run_end':
      return <RunEndScreen />;
    case 'hangar':
      return <HangarScreen />;
    case 'map':
      return <MapScreen />;
    default:
      return null;
  }
}
