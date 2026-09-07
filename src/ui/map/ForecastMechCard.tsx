import React from 'react';
import type { ForecastPerMech, GameData, Mech, Pilot } from '@sim/types';
import { Bar, ItemTooltip, Portrait } from '@ui/components';
import { getPilotDef } from './mapHelpers';

interface Props {
  pilot: Pilot;
  mech: Mech;
  data: GameData;
  risk?: ForecastPerMech;
}

/** One mech card in the Forecast modal's your-squad / their-squad columns. */
export function ForecastMechCard({ pilot, mech, data, risk }: Props) {
  const def = getPilotDef(data, pilot.id);
  const frame = data.frames[mech.frameId];
  const weaponIds = [mech.weaponA, mech.weaponB].filter((id): id is string => !!id && !!data.weapons[id]);
  const deathRiskPct = risk ? Math.round(risk.pilotDeathRisk * 100) : null;
  const maxHp = Math.max(1, (frame?.hp ?? mech.hp) - mech.maxHpPenalty);

  return (
    <div className="forecast-card">
      <div className="row gap-s">
        <Portrait pilotDefId={pilot.id.split('#')[0]} size={40} faction={def?.faction} />
        <div className="col">
          <strong style={{ fontSize: 12 }}>{def?.callsign ?? pilot.id}</strong>
          <ItemTooltip kind="frame" id={mech.frameId} data={data}>
            <span className="muted mono" style={{ fontSize: 10 }}>
              {frame?.name ?? mech.frameId}
            </span>
          </ItemTooltip>
        </div>
      </div>
      <div className="muted mono" style={{ fontSize: 10, margin: '4px 0' }}>
        {weaponIds.length === 0 && 'unarmed'}
        {weaponIds.map((id, i) => (
          <React.Fragment key={id}>
            {i > 0 && ' / '}
            <ItemTooltip kind="weapon" id={id} data={data}>
              <span>{data.weapons[id]?.name}</span>
            </ItemTooltip>
          </React.Fragment>
        ))}
      </div>
      <Bar value={mech.hp} max={maxHp} height={6} color="var(--ok)" />
      {risk && (
        <div className="col gap-s mono" style={{ fontSize: 10, marginTop: 6 }}>
          <div>Dmg taken (exp): {risk.expectedDamageTaken.toFixed(1)}</div>
          <div>Destroy risk: {Math.round(risk.destroyRisk * 100)}%</div>
          <div style={{ color: deathRiskPct != null && deathRiskPct > 15 ? 'var(--danger)' : undefined }}>
            Pilot death risk: {deathRiskPct}%
          </div>
          <div>Expected kills: {risk.expectedKills.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}
