import React from 'react';
import type { MapDef, ObjectiveDef, ObjectiveState, SiteOwner, Vec2, WorldState } from '@sim/types';
import { Bar, Panel } from '@ui/components';

const OWNER_LABEL: Record<SiteOwner, string> = { player: 'HELD', enemy: 'COMPACT', neutral: 'UNCLAIMED' };
const OWNER_COLOR: Record<SiteOwner, string> = { player: 'var(--ok)', enemy: 'var(--danger)', neutral: 'var(--muted)' };

/**
 * One capture_site. Unlike an ordinary objective a site is never "done", so
 * this shows the holder rather than a status, plus the capture meter of
 * whichever side is currently taking it.
 */
export function SiteRow({
  def,
  state,
  onCenter,
}: {
  def: ObjectiveDef;
  state: ObjectiveState;
  onCenter: (pos: Vec2) => void;
}) {
  const owner: SiteOwner = state.owner ?? 'neutral';
  const capturing = state.capturingFor;
  // The meter fills for whoever is taking it, so its colour has to follow them
  // rather than the current holder.
  const meterColor = state.contested ? 'var(--amber)' : capturing ? OWNER_COLOR[capturing] : OWNER_COLOR[owner];

  return (
    <div className="objective-row" onClick={() => onCenter(state.pos)} style={{ cursor: 'pointer' }}>
      <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
        <span>⚑ {def.name}</span>
        <span className="chip mono" style={{ borderColor: OWNER_COLOR[owner], color: OWNER_COLOR[owner] }}>
          {OWNER_LABEL[owner]}
        </span>
      </div>
      <div className="row gap-s" style={{ alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 10, minWidth: 52 }}>
          {state.contested ? 'CONTESTED' : capturing ? `TAKING ${Math.round((state.capture ?? 0) * 100)}%` : ''}
        </span>
        <div className="grow">
          <Bar value={state.contested ? 1 : state.capture ?? 0} max={1} height={5} color={meterColor} />
        </div>
      </div>
      {(def.incomePerMin || def.gateSquadIds) && (
        <div className="muted mono" style={{ fontSize: 10 }}>
          {def.incomePerMin ? `+${def.incomePerMin} scrap/min` : ''}
          {def.incomePerMin && def.gateSquadIds ? ' · ' : ''}
          {def.gateSquadIds ? 'REINFORCEMENT GATE' : ''}
        </div>
      )}
    </div>
  );
}

/**
 * The control-victory readout: how many sites you hold against how many you
 * need, and how long the clock has been running. Losing a site resets it, so
 * this is the thing to watch on a territory map.
 */
export function ControlBanner({ world, map }: { world: WorldState; map: MapDef }) {
  const win = map.controlWin;
  if (!win) return null;
  const sites = map.objectives.filter((o) => o.kind === 'capture_site');
  const held = sites.filter((o) => world.objectives[o.id]?.owner === 'player').length;
  const holding = held >= win.sites;
  const remaining = Math.max(0, win.holdSeconds - world.controlHeldFor);

  return (
    <Panel title="CONTROL" accent="compact" padded style={{ pointerEvents: 'auto' }}>
      <div className="row gap-s" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: holding ? 'var(--ok)' : 'var(--amber)' }}>
          {held}/{win.sites}
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {holding ? `${Math.ceil(remaining)}s TO WIN` : `HOLD ${win.sites} SITES`}
        </span>
      </div>
      <Bar value={holding ? world.controlHeldFor : 0} max={win.holdSeconds} height={6} color="var(--ok)" />
      <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
        {holding ? 'Hold them. Losing one resets the clock.' : `Take ${win.sites - held} more and hold.`}
      </div>
    </Panel>
  );
}
