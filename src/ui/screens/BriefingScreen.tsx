import React from 'react';
import { useStore } from '@ui/store';
import { Button, ItemTooltip, Panel, Portrait, Ticker, useData } from '@ui/components';
import type { Mobility, ObjectiveKind } from '@sim/types';
import { failStateText, objectiveWinText } from './howToWin';

const OBJ_ICON: Record<ObjectiveKind, string> = {
  evac_station: '✚',
  evac_colony: '⛨',
  convoy: '⇉',
  derelict: '⚙',
  relay: '◉',
  destroy_target: '☠',
  reach_exit: '➤',
  capture_site: '⚑',
};

function poorFit(mobility: Mobility, mapKind: 'space' | 'surface'): boolean {
  if (mobility === 'aerospace') return false;
  if (mobility === 'space' && mapKind === 'surface') return true;
  if (mobility === 'ground' && mapKind === 'space') return true;
  return false;
}

export function BriefingScreen() {
  const data = useData();
  const run = useStore((s) => s.run);
  const map = useStore((s) => s.map);
  const captainLine = useStore((s) => s.captainLine);
  const openHangar = useStore((s) => s.openHangar);
  const launchMap = useStore((s) => s.launchMap);
  const go = useStore((s) => s.go);

  if (!data || !run || !map) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="No Briefing">
          <div className="col gap-m">
            <div className="muted mono">No map to brief.</div>
            <Button variant="ghost" onClick={() => go('title')}>
              Title
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  let canLaunch = false;
  for (const sq of run.squads) {
    for (const slot of sq.slots) {
      if (!slot) continue;
      const pilot = run.pilots[slot.pilotId];
      const mech = run.mechs[slot.mechId];
      if (pilot?.alive && pilot.injuredFor === 0 && mech && !mech.destroyed) {
        canLaunch = true;
      }
    }
  }

  return (
    <div className="col" style={{ height: '100%', width: '100%', padding: 20, boxSizing: 'border-box', gap: 14 }}>
      <div className="row grow" style={{ gap: 14, minHeight: 0 }}>
        <div className="col gap-m grow" style={{ flexBasis: '62%', overflow: 'auto' }}>
          <Panel accent="relay">
            <div className="col gap-s">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 className="mono" style={{ margin: 0, color: 'var(--amber)', letterSpacing: '0.08em' }}>
                  {map.name}
                </h2>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    color: map.kind === 'space' ? 'var(--violet)' : 'var(--olive)',
                    border: '1px solid currentColor',
                    borderRadius: 3,
                    padding: '2px 6px',
                  }}
                >
                  {map.kind.toUpperCase()}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {map.description}
              </div>
              <div className="row gap-m mono" style={{ fontSize: 11 }}>
                <span className="muted">TIME LIMIT {map.timeLimit > 0 ? `${map.timeLimit}s` : 'NONE'}</span>
                <span className="muted">CONTACTS ~{map.enemySquads.length}</span>
                <span className="muted">WEATHER {map.weather.toUpperCase()}</span>
              </div>
            </div>
          </Panel>

          <Ticker text={captainLine} />

          <Panel title="How to Win" accent="compact">
            <div className="col gap-s">
              {map.objectives
                .filter((o) => o.required)
                .map((o) => (
                  <div key={o.id} className="row gap-s" style={{ fontSize: 12, alignItems: 'baseline' }}>
                    <span className="mono" style={{ color: 'var(--amber)' }}>
                      •
                    </span>
                    <span>{objectiveWinText(o, map)}</span>
                  </div>
                ))}
              {map.objectives.every((o) => !o.required) && (
                <div className="muted mono" style={{ fontSize: 11 }}>
                  No required objectives — everything here is optional.
                </div>
              )}
              <div className="muted mono" style={{ fontSize: 10, marginTop: 4 }}>
                {failStateText(map)}
              </div>
            </div>
          </Panel>

          <Panel title="Objectives">
            <div className="col gap-s">
              {map.objectives.map((o) => (
                <div key={o.id} className="row gap-s" style={{ alignItems: 'center', fontSize: 12 }}>
                  <span className="mono" style={{ width: 18, color: 'var(--amber)' }}>
                    {OBJ_ICON[o.kind]}
                  </span>
                  <span className="grow">{o.name}</span>
                  {o.required && (
                    <span
                      className="mono"
                      style={{ fontSize: 9, color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 3, padding: '1px 5px' }}
                    >
                      REQUIRED
                    </span>
                  )}
                  <span className="mono muted" style={{ fontSize: 10 }}>
                    +{o.reward.scrap} scrap
                    {o.reward.nerve ? ` · +${o.reward.nerve} nerve` : ''}
                    {o.reward.standing ? ` · +${o.reward.standing} standing` : ''}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="col gap-m" style={{ flexBasis: '38%', minWidth: 260, overflow: 'auto' }}>
          <Panel title="Squads">
            <div className="col gap-m">
              {run.squads.map((sq) => (
                <div key={sq.id} className="col gap-s">
                  <div className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>
                    {sq.name}
                  </div>
                  <div className="col gap-s">
                    {sq.slots.map((slot, i) => {
                      if (!slot) return null;
                      const pilot = run.pilots[slot.pilotId];
                      const def = pilot ? data.pilots[pilot.id] : undefined;
                      const mech = run.mechs[slot.mechId];
                      const frame = mech ? data.frames[mech.frameId] : undefined;
                      const warn = frame ? poorFit(frame.mobility, map.kind) : false;
                      return (
                        <div key={i} className="row gap-s" style={{ alignItems: 'center' }}>
                          {def && <Portrait pilotDefId={def.id} size={28} faction={def.faction} dimmed={!pilot?.alive} />}
                          <div className="col grow" style={{ minWidth: 0 }}>
                            <div className="mono" style={{ fontSize: 11 }}>
                              {def?.callsign ?? slot.pilotId}
                            </div>
                            <ItemTooltip kind="frame" id={mech?.frameId} data={data}>
                              <div className="muted mono" style={{ fontSize: 10 }}>
                                {frame?.name ?? slot.mechId}
                              </div>
                            </ItemTooltip>
                          </div>
                          {warn && (
                            <span className="mono" style={{ fontSize: 9, color: 'var(--amber)' }} title="Poor mobility fit for this map">
                              POOR FIT
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {sq.slots.every((s) => !s) && <div className="muted mono" style={{ fontSize: 11 }}>Empty squad.</div>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="row gap-s">
            <Button variant="ghost" onClick={openHangar} style={{ flex: 1 }}>
              Hangar
            </Button>
            <Button variant="primary" disabled={!canLaunch} onClick={launchMap} style={{ flex: 1 }}>
              Launch
            </Button>
          </div>
          <div className="muted mono" style={{ fontSize: 10, textAlign: 'center' }}>
            The Lantern is committed.
          </div>
        </div>
      </div>
    </div>
  );
}
