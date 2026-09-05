import React from 'react';
import type { GameData, Id, MapDef, WorldState } from '@sim/types';
import { Button, Panel } from '@ui/components';
import { OBJECTIVE_ICON, getPilotDef, objectiveDefFor, squadThreatGuess, statusColor } from './mapHelpers';

export type Inspect = { kind: 'enemy'; squadId: Id } | { kind: 'objective'; objectiveId: Id } | null;

interface Props {
  inspect: Inspect;
  world: WorldState;
  map: MapDef;
  data: GameData;
  onClose: () => void;
}

/** Floating info card for `inspect_enemy` / `inspect_objective` map intents. */
export function InspectPopover({ inspect, world, map, data, onClose }: Props) {
  if (!inspect) return null;

  if (inspect.kind === 'enemy') {
    const squad = world.squads[inspect.squadId];
    if (!squad) return null;
    const leaderDef = squad.leaderPilotId ? getPilotDef(data, squad.leaderPilotId) : undefined;
    const frameNames: string[] = [];
    let visibleCount = 0;
    for (const slot of squad.slots) {
      if (!slot) continue;
      const mech = world.mechs[slot.mechId];
      if (!mech || mech.destroyed) continue;
      visibleCount += 1;
      const frame = data.frames[mech.frameId];
      if (frame) frameNames.push(frame.name);
    }
    const threat = squadThreatGuess(squad, world, data);
    return (
      <div style={wrapStyle}>
        <Panel title={squad.name} accent="compact" padded style={{ pointerEvents: 'auto', width: 260 }}>
          <div className="col gap-s mono" style={{ fontSize: 12 }}>
            <div>Leader: {leaderDef?.callsign ?? 'Unknown'}</div>
            <div>Visible mechs: {visibleCount}</div>
            <div>Frames: {frameNames.join(', ') || 'unknown'}</div>
            <div>Threat guess: {threat}</div>
          </div>
          <Button small variant="ghost" onClick={onClose} style={{ marginTop: 8 }}>
            CLOSE
          </Button>
        </Panel>
      </div>
    );
  }

  const objDef = objectiveDefFor(map, inspect.objectiveId);
  const state = world.objectives[inspect.objectiveId];
  if (!objDef || !state) return null;
  return (
    <div style={wrapStyle}>
      <Panel title={`${OBJECTIVE_ICON[objDef.kind]} ${objDef.name}`} accent="neutral" padded style={{ pointerEvents: 'auto', width: 260 }}>
        <div className="col gap-s mono" style={{ fontSize: 12 }}>
          <div>Kind: {objDef.kind.replace(/_/g, ' ')}</div>
          <div style={{ color: statusColor(state.status) }}>Status: {state.status.toUpperCase()}</div>
          <div>Progress: {Math.round(state.progress * 100)}%</div>
          <div>
            Reward: {objDef.reward.scrap} scrap, {objDef.reward.nerve} nerve, {objDef.reward.standing} standing
          </div>
        </div>
        <Button small variant="ghost" onClick={onClose} style={{ marginTop: 8 }}>
          CLOSE
        </Button>
      </Panel>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: 70,
  transform: 'translateX(-50%)',
  zIndex: 20,
  pointerEvents: 'none',
};
