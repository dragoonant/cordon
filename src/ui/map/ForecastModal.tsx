import React from 'react';
import { Button, Modal, Stat } from '@ui/components';
import { useStore } from '@ui/store';
import { FALL_BACK_STANDING_COST } from '@sim/world';
import { ForecastCallouts } from './ForecastCallouts';
import { ForecastMechCard } from './ForecastMechCard';
import { squadMembers } from './mapHelpers';

/**
 * Opens when store.forecast is set and no battle is in progress. Contact is
 * normally contact — but below FALL_BACK_THRESHOLD the squad may break off
 * for Standing, so a hopeless contact is a decision rather than a forced loss.
 */
const FALL_BACK_THRESHOLD = 0.25;
export function ForecastModal() {
  const world = useStore((s) => s.world);
  const map = useStore((s) => s.map);
  const data = useStore((s) => s.data);
  const forecast = useStore((s) => s.forecast);
  const battle = useStore((s) => s.battle);
  const pendingCallouts = useStore((s) => s.pendingCallouts);
  const toggleCallout = useStore((s) => s.toggleCallout);
  const commitBattle = useStore((s) => s.commitBattle);
  const fallBackFromContact = useStore((s) => s.fallBackFromContact);

  const open = !!forecast && !battle;
  if (!open || !world || !map || !data || !world.pendingBattle) return null;

  const { squadBId, terrain } = world.pendingBattle;
  const squadA = world.squads[world.pendingBattle.squadAId];
  const squadB = world.squads[squadBId];
  if (!squadA || !squadB) return null;

  const membersA = squadMembers(squadA, world);
  const membersB = squadMembers(squadB, world);
  const riskFor = (pilotId: string, mechId: string) => forecast.perMech.find((r) => r.pilotId === pilotId && r.mechId === mechId);

  const RISK_THRESHOLD = 0.15;
  const pilotsAtRisk = forecast.perMech.filter((m) => m.pilotDeathRisk > RISK_THRESHOLD).length;
  const winPct = Math.round(forecast.winProb * 100);
  const headlineColor =
    pilotsAtRisk >= 2 || forecast.winProb < 0.4 ? 'var(--danger)' : pilotsAtRisk >= 1 || forecast.winProb < 0.65 ? 'var(--amber)' : 'var(--ok)';
  // "Why": the two modifiers least likely to be good news first — the ones worth reading before you commit.
  // Only offered when the fight is genuinely bad — otherwise every contact
  // becomes a retreat prompt and the map loses its teeth.
  const canFallBack = forecast.winProb < FALL_BACK_THRESHOLD;
  const whyMods = [...forecast.modifiers].sort((a, b) => Number(a.good === true) - Number(b.good === true)).slice(0, 2);

  return (
    <Modal open={open} title={`CONTACT — ${squadB.name}`} width={920}>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: headlineColor, marginBottom: 2 }}>
        WIN {winPct}% · {pilotsAtRisk} pilot{pilotsAtRisk === 1 ? '' : 's'} at risk
      </div>
      {whyMods.length > 0 && (
        <div className="muted mono" style={{ fontSize: 11, marginBottom: 10 }}>
          Why: {whyMods.map((m) => `${m.label}: ${m.value}`).join(' · ')}
        </div>
      )}
      <div className="row gap-s" style={{ marginBottom: 8 }}>
        <span className="chip mono">{map.kind.toUpperCase()}</span>
        <span className="chip mono">{terrain.toUpperCase()}</span>
        <span className="chip mono">{map.weather.toUpperCase()}</span>
      </div>

      <div className="forecast-columns">
        <div className="col gap-s">
          <div className="mono muted" style={{ fontSize: 11 }}>
            YOUR SQUAD — {squadA.name}
          </div>
          {membersA.map(({ pilot, mech }) => (
            <ForecastMechCard key={mech.id} pilot={pilot} mech={mech} data={data} risk={riskFor(pilot.id, mech.id)} />
          ))}
        </div>

        <div className="forecast-center col gap-s">
          <div className="row gap-s" style={{ justifyContent: 'center' }}>
            {forecast.exact ? (
              <span className="chip mono" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                EXACT
              </span>
            ) : (
              <span className="muted mono" style={{ fontSize: 10 }}>
                ±{Math.round(forecast.variance * 100)}%
              </span>
            )}
          </div>
          <ProbBar win={forecast.winProb} draw={forecast.drawProb} loss={forecast.lossProb} />
          <Stat label="Expected dmg dealt" value={forecast.expectedDamageDealt.toFixed(0)} />
          <Stat label="Expected dmg taken" value={forecast.expectedDamageTaken.toFixed(0)} />
          <div className="col gap-s">
            {forecast.modifiers.map((m, i) => (
              <Stat key={i} label={m.label} value={m.value} good={m.good} />
            ))}
          </div>
        </div>

        <div className="col gap-s">
          <div className="mono muted" style={{ fontSize: 11 }}>
            ENEMY — {squadB.name}
          </div>
          {membersB.map(({ pilot, mech }) => (
            <ForecastMechCard key={mech.id} pilot={pilot} mech={mech} data={data} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="mono muted" style={{ fontSize: 11, marginBottom: 4 }}>
          CALLOUTS
        </div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          Callouts spend Nerve for an edge this battle. Hover for the trade-off.
        </div>
        <ForecastCallouts squad={squadA} world={world} data={data} pendingCallouts={pendingCallouts} onToggle={toggleCallout} />
      </div>

      <div className="row gap-s" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {canFallBack
            ? `Long odds. Falling back costs ${FALL_BACK_STANDING_COST} Standing and hands them the ground.`
            : 'No retreat once engaged. Use Callouts wisely.'}
        </span>
        <div className="row gap-s">
          {canFallBack && (
            <Button onClick={fallBackFromContact} title={`Break off without fighting. -${FALL_BACK_STANDING_COST} Standing.`}>
              FALL BACK
            </Button>
          )}
          <Button variant="primary" onClick={commitBattle} data-tutorial="commit-button">
            COMMIT
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ProbBar({ win, draw, loss }: { win: number; draw: number; loss: number }) {
  return (
    <div>
      <div className="prob-bar">
        <div className="prob-seg" style={{ width: `${win * 100}%`, background: 'var(--ok)' }} title={`Win ${Math.round(win * 100)}%`} />
        <div className="prob-seg" style={{ width: `${draw * 100}%`, background: 'var(--muted)' }} title={`Draw ${Math.round(draw * 100)}%`} />
        <div className="prob-seg" style={{ width: `${loss * 100}%`, background: 'var(--danger)' }} title={`Loss ${Math.round(loss * 100)}%`} />
      </div>
      <div className="row gap-s mono" style={{ fontSize: 10, justifyContent: 'space-between', marginTop: 4 }}>
        <span>WIN {Math.round(win * 100)}%</span>
        <span>DRAW {Math.round(draw * 100)}%</span>
        <span>LOSS {Math.round(loss * 100)}%</span>
      </div>
    </div>
  );
}
