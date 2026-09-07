import React from 'react';
import type { GameData, MapDef, Vec2, WorldState } from '@sim/types';
import { enemySquads, playerSquads, squadHpSummary } from '@sim/world';
import { Bar, Panel } from '@ui/components';
import { OBJECTIVE_ICON, statusColor } from './mapHelpers';
import { ControlBanner, SiteRow } from './SiteRow';

interface Props {
  world: WorldState;
  data: GameData;
  map: MapDef;
  onCenter: (pos: Vec2) => void;
}

/**
 * A convoy only advances while a squad is within 2 tiles of it (see
 * isConvoyEscorted in world.ts). The briefing says so, but nothing said it
 * mid-map — a convoy that has quietly stopped looks identical to one that is
 * moving, which is an easy way to lose a rescue without ever knowing why.
 */
function convoyEscorted(world: WorldState, pos: Vec2): boolean {
  return playerSquads(world).some(
    (s) => s.state !== 'docked' && s.state !== 'destroyed' && Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) <= 2
  );
}

/** Right HUD panel: objectives + visible-enemy contacts. */
export function ObjectivesPanel({ world, data, map, onCenter }: Props) {
  const visible = enemySquads(world).filter((sq) => world.visibleEnemyIds.includes(sq.id));

  return (
    <div style={wrapStyle} data-tutorial="objectives-panel">
      {map.controlWin && <ControlBanner world={world} map={map} />}
      <Panel title="OBJECTIVES" accent="compact" padded style={{ pointerEvents: 'auto' }}>
        <div className="col gap-s">
          {map.objectives.map((objDef) => {
            const state = world.objectives[objDef.id];
            if (!state) return null;
            // Sites own their row: who holds it, the capture meter, contested.
            if (objDef.kind === 'capture_site') {
              return <SiteRow key={objDef.id} def={objDef} state={state} onCenter={onCenter} />;
            }
            return (
              <div key={objDef.id} className="objective-row">
                <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
                  <span>
                    {OBJECTIVE_ICON[objDef.kind]} {objDef.name}
                  </span>
                  {objDef.required && (
                    <span className="chip mono" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                      REQUIRED
                    </span>
                  )}
                </div>
                <div className="row gap-s">
                  <span className="mono" style={{ fontSize: 10, color: statusColor(state.status) }}>
                    {state.status.toUpperCase()}
                  </span>
                  <div className="grow">
                    <Bar value={state.progress} max={1} height={5} color="var(--amber)" />
                  </div>
                </div>
                {typeof state.hp === 'number' && objDef.hp ? (
                  <Bar value={state.hp} max={objDef.hp} height={4} color="var(--ok)" />
                ) : null}
                {objDef.kind === 'convoy' && state.status === 'active' && !convoyEscorted(world, state.pos) && (
                  <div className="mono" style={{ fontSize: 10, color: 'var(--amber)' }}>
                    NOT ESCORTED — bring a squad within 2 tiles
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel title="CONTACTS" accent="compact" padded style={{ pointerEvents: 'auto' }}>
        <div className="col gap-s">
          {visible.length === 0 && (
            <div className="muted mono" style={{ fontSize: 11 }}>
              No contacts.
            </div>
          )}
          {visible.map((sq) => {
            const summary = squadHpSummary(sq, world, data);
            return (
              <div key={sq.id} className="contact-row" onClick={() => onCenter(sq.pos)}>
                <span>{sq.name}</span>
                <span className="mono muted" style={{ fontSize: 10 }}>
                  {summary.alive}/{summary.total}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 60,
  bottom: 120,
  width: 260,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  overflowY: 'auto',
  pointerEvents: 'none',
};
