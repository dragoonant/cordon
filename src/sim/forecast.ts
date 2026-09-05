/**
 * CORDON — forecast: the battle resolver run N times with different seeds.
 *
 * Pure. Never mutates sideA/sideB/ctx. Uses Rng.fork() to derive independent
 * per-sample seeds from ctx.seed so the forecast's own randomness never
 * perturbs (or is perturbed by) anything else drawing from the same seed.
 */
import type { ActiveCallout, BattleContext, BattleSide, Forecast, ForecastPerMech, GameData, Id } from './types';
import { Rng } from './rng';
import { resolveBattle } from './battle';
import { mechLoad, mobilityPenalty } from './rules';

const DEFAULT_SAMPLES = 200;

function hasEyesOn(callouts: ActiveCallout[], data: GameData): boolean {
  return callouts.some((ac) => data.callouts[ac.calloutId]?.effect === 'eyes_on');
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface MechAgg {
  pilotId: Id;
  mechId: Id;
  damageTaken: number;
  damageDealt: number;
  destroyedCount: number;
  pilotDeathCount: number;
  kills: number;
}

/**
 * Runs resolveBattle `samples` times (default 200) with seeds forked from
 * ctx.seed and aggregates outcomes. If 'eyes_on' is active for side A, runs
 * exactly once with the true seed and reports zero variance.
 */
export function forecast(sideA: BattleSide, sideB: BattleSide, ctx: BattleContext, data: GameData, samples: number = DEFAULT_SAMPLES): Forecast {
  const eyesOn = hasEyesOn(ctx.calloutsA, data);
  const rng = new Rng(ctx.seed);

  const leaderPilotId = sideA.squad.leaderPilotId;
  const leaderSystems = leaderPilotId ? sideA.pilots[leaderPilotId]?.aptitudes.systems ?? 0 : 0;
  const reconCount = Object.values(sideA.mechs).filter((m) => {
    for (const sid of [m.system, m.system2]) {
      if (sid && data.systems[sid]?.effect === 'recon') return true;
    }
    return false;
  }).length;

  const variance = eyesOn ? 0 : clamp(0.35 - leaderSystems * 0.002 - reconCount * 0.03, 0.05, 0.35);
  const runCount = eyesOn ? 1 : Math.max(1, samples);

  // Pair each side-A pilot with their mech, from the input formation.
  const slotPairs = sideA.squad.slots.filter((s): s is NonNullable<typeof s> => !!s);
  const agg = new Map<Id, MechAgg>();
  for (const s of slotPairs) {
    agg.set(s.mechId, { pilotId: s.pilotId, mechId: s.mechId, damageTaken: 0, damageDealt: 0, destroyedCount: 0, pilotDeathCount: 0, kills: 0 });
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;

  for (let i = 0; i < runCount; i++) {
    const sampleSeed = eyesOn ? ctx.seed : rng.fork(`forecast:${i}`).getState();
    const sampleCtx: BattleContext = { ...ctx, seed: sampleSeed };
    const result = resolveBattle(sideA, sideB, sampleCtx, data);

    if (result.winner === 'A') wins++;
    else if (result.winner === 'B') losses++;
    else draws++;

    for (const s of slotPairs) {
      const entry = agg.get(s.mechId)!;
      const preMech = sideA.mechs[s.mechId];
      const postMech = result.sideA.mechs[s.mechId];
      if (!preMech || !postMech) continue;
      entry.damageTaken += Math.max(0, preMech.hp - postMech.hp);
      if (postMech.destroyed) entry.destroyedCount++;
      if (result.pilotDeaths.some((d) => d.side === 'A' && d.pilotId === s.pilotId)) entry.pilotDeathCount++;
      const prePilot = sideA.pilots[s.pilotId];
      const postPilot = result.sideA.pilots[s.pilotId];
      if (prePilot && postPilot) entry.kills += Math.max(0, postPilot.kills - prePilot.kills);
    }
    for (const ev of result.events) {
      if (ev.t === 'attack' && ev.side === 'A') {
        const entry = agg.get(ev.attackerMechId);
        if (entry) entry.damageDealt += ev.totalDamage;
      }
    }
  }

  const perMech: ForecastPerMech[] = slotPairs.map((s) => {
    const entry = agg.get(s.mechId)!;
    return {
      pilotId: entry.pilotId,
      mechId: entry.mechId,
      expectedDamageTaken: entry.damageTaken / runCount,
      destroyRisk: entry.destroyedCount / runCount,
      pilotDeathRisk: entry.pilotDeathCount / runCount,
      expectedDamageDealt: entry.damageDealt / runCount,
      expectedKills: entry.kills / runCount,
    };
  });

  const expectedDamageDealt = perMech.reduce((a, m) => a + m.expectedDamageDealt, 0);
  const expectedDamageTaken = perMech.reduce((a, m) => a + m.expectedDamageTaken, 0);

  const modifiers: Forecast['modifiers'] = [];
  modifiers.push({ label: 'Terrain', value: `${ctx.terrain} (${ctx.mapKind})`, good: null });
  modifiers.push({ label: 'Weather', value: ctx.weather, good: ctx.weather === 'clear' || ctx.weather === 'none' ? true : null });

  let mismatched = 0;
  for (const mech of Object.values(sideA.mechs)) {
    const frame = data.frames[mech.frameId];
    if (!frame) continue;
    const pen = mobilityPenalty(frame.mobility, ctx.mapKind);
    if (pen.evasion !== 0 || pen.accuracy !== 0) mismatched++;
  }
  modifiers.push({ label: 'Mobility Fit', value: mismatched === 0 ? 'all mechs suited to this map' : `${mismatched} mech(s) mismatched`, good: mismatched === 0 });

  let overweight = 0;
  for (const mech of Object.values(sideA.mechs)) {
    if (mechLoad(mech, data).overPower) overweight++;
  }
  modifiers.push({ label: 'Overweight', value: overweight === 0 ? 'none' : `${overweight} mech(s) over generator budget`, good: overweight === 0 });

  for (const ac of ctx.calloutsA) {
    const def = data.callouts[ac.calloutId];
    if (def) modifiers.push({ label: 'Your Callout', value: def.label, good: true });
  }
  for (const ac of ctx.calloutsB) {
    const def = data.callouts[ac.calloutId];
    if (def) modifiers.push({ label: 'Enemy Callout', value: def.label, good: false });
  }

  return {
    winProb: wins / runCount,
    drawProb: draws / runCount,
    lossProb: losses / runCount,
    expectedDamageDealt,
    expectedDamageTaken,
    perMech,
    variance,
    exact: eyesOn,
    samples: runCount,
    modifiers,
  };
}
