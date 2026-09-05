import React from 'react';
import type { GameData, Id, RunState } from '@sim/types';
import { isAce } from '@sim/pilots';
import { Bar, Panel, Portrait } from '@ui/components';
import { APTITUDES, nextCertHint, pilotStatusLabel } from './hangarHelpers';

interface Props {
  run: RunState;
  data: GameData;
  selectedPilotId: Id | null;
  onSelect: (id: Id) => void;
}

/** Left column: every pilot in the run, their growth, certs, and next-cert hint. */
export function RosterPanel({ run, data, selectedPilotId, onSelect }: Props) {
  const pilots = Object.values(run.pilots);

  return (
    <Panel title="ROSTER" accent="relay" padded style={{ height: '100%', overflowY: 'auto' }}>
      <div className="col gap-s">
        {pilots.map((pilot) => {
          const def = data.pilots[pilot.id];
          if (!def) return null;
          const selected = selectedPilotId === pilot.id;
          return (
            <div
              key={pilot.id}
              className="roster-row"
              onClick={() => onSelect(pilot.id)}
              style={{ border: selected ? '1px solid var(--amber)' : '1px solid var(--border)' }}
            >
              <div className="row gap-s">
                <Portrait pilotDefId={def.id} size={36} faction={def.faction} dimmed={!pilot.alive} />
                <div className="col grow">
                  <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 12 }}>{def.callsign}</strong>
                    {isAce(pilot) && (
                      <span className="chip mono" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                        ACE
                      </span>
                    )}
                  </div>
                  <span className="muted mono" style={{ fontSize: 10 }}>
                    {def.name} — {def.archetype}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: !pilot.alive ? 'var(--danger)' : pilot.injuredFor > 0 ? 'var(--amber)' : 'var(--ok)',
                    }}
                  >
                    {pilotStatusLabel(pilot)}
                  </span>
                </div>
              </div>

              <div className="col gap-s" style={{ marginTop: 4 }}>
                {APTITUDES.map((apt) => (
                  <div key={apt} className="row gap-s">
                    <span className="mono muted" style={{ fontSize: 9, width: 52 }}>
                      {apt.slice(0, 3).toUpperCase()}
                    </span>
                    <Bar value={pilot.aptitudes[apt]} max={100} height={4} />
                  </div>
                ))}
              </div>

              <div className="row gap-s" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                {pilot.certs.map((c) => (
                  <span key={c} className="chip mono" style={{ fontSize: 9 }}>
                    {data.certs[c]?.name ?? c}
                  </span>
                ))}
              </div>

              <div className="row gap-s" style={{ marginTop: 4, justifyContent: 'space-between' }}>
                <Bar value={pilot.nerve} max={pilot.maxNerve} height={5} color="var(--violet)" label="NERVE" />
                <span className="mono muted" style={{ fontSize: 10 }}>
                  Kills: {pilot.kills}
                </span>
              </div>

              {pilot.alive && (
                <div className="muted mono" style={{ fontSize: 9, marginTop: 4 }}>
                  {nextCertHint(pilot, data) ?? 'All certs held.'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
