import React from 'react';
import type { GameData, Id, WorldState } from '@sim/types';
import { playerSquads, squadHpSummary } from '@sim/world';
import { Bar, Button, Panel, Portrait } from '@ui/components';
import { livingCount, squadStateLabel } from './mapHelpers';
import { SquadDetail } from './SquadDetail';

interface Props {
  world: WorldState;
  data: GameData;
  selectedSquadId: Id | null;
  onSelect: (id: Id) => void;
  onDeploy: (id: Id) => void;
}

/** Left HUD panel: one row per player squad, plus the selected squad's detail below the list. */
export function SquadronsPanel({ world, data, selectedSquadId, onSelect, onDeploy }: Props) {
  const squads = playerSquads(world);

  return (
    <div style={panelWrapStyle}>
      <Panel title="SQUADRONS" accent="relay" padded style={{ pointerEvents: 'auto' }}>
        <div className="col gap-s">
          {squads.length === 0 && <div className="muted mono">No squadrons.</div>}
          {squads.map((squad) => {
            const summary = squadHpSummary(squad, world, data);
            const alive = livingCount(squad, world);
            const selected = selectedSquadId === squad.id;
            return (
              <div
                key={squad.id}
                className="squad-row"
                onClick={() => onSelect(squad.id)}
                style={{
                  border: selected ? '1px solid var(--amber)' : '1px solid var(--border)',
                  background: selected ? 'rgba(255,165,60,0.08)' : 'transparent',
                }}
              >
                <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
                  <strong>{squad.name}</strong>
                  <span className="chip mono">{squadStateLabel(squad)}</span>
                </div>
                <div className="row gap-s" style={{ margin: '4px 0' }}>
                  {squad.slots.map((slot, i) => {
                    if (!slot) return <div key={i} className="portrait-slot empty" />;
                    const mech = world.mechs[slot.mechId];
                    const pilot = world.pilots[slot.pilotId];
                    const dimmed = !pilot?.alive || !!mech?.destroyed;
                    return (
                      <div key={i} className="portrait-slot">
                        <Portrait pilotDefId={slot.pilotId.split('#')[0]} size={24} faction={squad.faction} dimmed={dimmed} />
                      </div>
                    );
                  })}
                </div>
                <Bar value={summary.hp} max={Math.max(1, summary.maxHp)} height={6} color="var(--ok)" />
                <div className="row gap-s" style={{ marginTop: 4 }}>
                  <div className="grow">
                    <Bar value={squad.fuel} max={Math.max(1, squad.maxFuel)} height={4} color="var(--steel)" />
                  </div>
                  <span className="mono muted" style={{ fontSize: 10 }}>
                    MRL {Math.round(squad.morale)}
                  </span>
                </div>
                {squad.state === 'docked' && (
                  <Button
                    small
                    variant="primary"
                    disabled={alive === 0}
                    onClick={() => onDeploy(squad.id)}
                    style={{ marginTop: 4, width: '100%' }}
                  >
                    DEPLOY
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
      {selectedSquadId && squads.some((s) => s.id === selectedSquadId) && (
        <SquadDetail world={world} data={data} squadId={selectedSquadId} />
      )}
    </div>
  );
}

const panelWrapStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  top: 60,
  bottom: 120,
  width: 300,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  overflowY: 'auto',
  pointerEvents: 'none',
};
