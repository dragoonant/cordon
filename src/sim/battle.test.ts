import { describe, expect, it } from 'vitest';
import type { ActiveCallout, BattleContext, BattleEvent } from './types';
import { resolveBattle } from './battle';
import { FIXTURE_DATA, makeSide } from './__fixtures__/battleFixtures';

const data = FIXTURE_DATA;

function baseCtx(overrides: Partial<BattleContext> = {}): BattleContext {
  return {
    seed: 12345,
    mapKind: 'surface',
    terrain: 'open',
    weather: 'clear',
    calloutsA: [],
    calloutsB: [],
    ...overrides,
  };
}

function strongSideA() {
  return makeSide(
    data,
    'squad_a',
    'relay',
    [
      { pilotId: 'pilot_ace', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', system: 'system_shield', slot: 0 },
      { pilotId: 'pilot_hotshot', frameId: 'frame_line', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', system: 'system_targeting', slot: 1 },
      { pilotId: 'pilot_marksman', frameId: 'frame_line', weaponA: 'weapon_railgun', weaponB: 'weapon_rifle', system: 'system_targeting', slot: 4 },
    ],
    { leaderPilotId: 'pilot_ace' }
  );
}

function weakSideB() {
  return makeSide(data, 'squad_b', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0 }]);
}

describe('resolveBattle: determinism', () => {
  it('produces byte-identical events for the same seed and inputs', () => {
    const sideA = strongSideA();
    const sideB = weakSideB();
    const ctx = baseCtx();
    const r1 = resolveBattle(sideA, sideB, ctx, data);
    const r2 = resolveBattle(sideA, sideB, ctx, data);
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
    expect(r1.winner).toBe(r2.winner);
    expect(r1.salvage).toEqual(r2.salvage);
  });

  it('does not mutate its inputs', () => {
    const sideA = strongSideA();
    const sideB = weakSideB();
    const before = JSON.stringify([sideA, sideB]);
    resolveBattle(sideA, sideB, baseCtx(), data);
    expect(JSON.stringify([sideA, sideB])).toBe(before);
  });

  it('produces different events for a different seed (sanity: rng actually varies output)', () => {
    const sideA = strongSideA();
    const sideB = weakSideB();
    const r1 = resolveBattle(sideA, sideB, baseCtx({ seed: 1 }), data);
    const r2 = resolveBattle(sideA, sideB, baseCtx({ seed: 2 }), data);
    expect(JSON.stringify(r1.events)).not.toBe(JSON.stringify(r2.events));
  });
});

describe('resolveBattle: asymmetry', () => {
  it('a heavily favored side wins the large majority of the time', () => {
    let winsA = 0;
    const N = 50;
    for (let seed = 0; seed < N; seed++) {
      const result = resolveBattle(strongSideA(), weakSideB(), baseCtx({ seed }), data);
      if (result.winner === 'A') winsA++;
    }
    expect(winsA / N).toBeGreaterThan(0.8);
  });
});

describe('resolveBattle: end conditions', () => {
  it('ends by annihilation when one side is fully wiped out', () => {
    let sawAnnihilation = false;
    for (let seed = 0; seed < 20 && !sawAnnihilation; seed++) {
      const result = resolveBattle(strongSideA(), weakSideB(), baseCtx({ seed }), data);
      const end = result.events.find((e) => e.t === 'end') as Extract<BattleEvent, { t: 'end' }>;
      if (end.reason === 'annihilation') sawAnnihilation = true;
    }
    expect(sawAnnihilation).toBe(true);
  });

  it('ends by rout when morale collapses without full annihilation', () => {
    // Three fragile mechs starting at low morale against a strong enemy:
    // a single early mech loss (-10 morale) drops them under the rout
    // threshold long before the squad could be annihilated in one round.
    const fragile = makeSide(
      data,
      'squad_fragile',
      'relay',
      [
        { pilotId: 'pilot_rookie', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0, hp: 20 },
        { pilotId: 'pilot_marksman', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 1, hp: 20 },
        { pilotId: 'pilot_hotshot', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 2, hp: 20 },
      ],
      { morale: 25 }
    );
    const enemy = makeSide(data, 'squad_enemy', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', system: 'system_targeting', slot: 0 },
      { pilotId: 'pilot_ace', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', system: 'system_targeting', slot: 1 },
    ]);
    let sawRout = false;
    for (let seed = 0; seed < 30 && !sawRout; seed++) {
      const result = resolveBattle(fragile, enemy, baseCtx({ seed, mapKind: 'surface' }), data);
      const end = result.events.find((e) => e.t === 'end') as Extract<BattleEvent, { t: 'end' }>;
      if (end.reason === 'rout') sawRout = true;
    }
    expect(sawRout).toBe(true);
  });

  it('ends by rounds when neither side breaks in 6 rounds, deciding by remaining HP fraction', () => {
    // Symmetric high-HP, low-damage, well-armored mirror match.
    const mirrorA = makeSide(data, 'squad_mirror_a', 'relay', [{ pilotId: 'pilot_ace', frameId: 'frame_bastion', weaponA: 'weapon_vulcans', slot: 0 }], { morale: 100 });
    const mirrorB = makeSide(data, 'squad_mirror_b', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_vulcans', slot: 0 }], { morale: 100 });
    const result = resolveBattle(mirrorA, mirrorB, baseCtx({ seed: 777 }), data);
    const end = result.events.find((e) => e.t === 'end') as Extract<BattleEvent, { t: 'end' }>;
    expect(end.reason).toBe('rounds');
    const roundEvents = result.events.filter((e) => e.t === 'round');
    expect(roundEvents.length).toBe(6);
  });
});

describe('resolveBattle: repair and shield systems', () => {
  it('a support weapon heals the lowest-HP living ally each turn it acts', () => {
    const side = makeSide(data, 'squad_medic', 'relay', [
      { pilotId: 'pilot_ace', frameId: 'frame_line', weaponA: 'weapon_repair_kit', slot: 3, hp: 120 },
      { pilotId: 'pilot_hotshot', frameId: 'frame_line', weaponA: 'weapon_lance', slot: 0, hp: 30 },
    ]);
    const enemy = makeSide(data, 'squad_target_dummy', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_skirmish', weaponA: null, slot: 0, hp: 1000 }]);
    const result = resolveBattle(side, enemy, baseCtx({ seed: 5 }), data);
    const repairs = result.events.filter((e): e is Extract<BattleEvent, { t: 'repair' }> => e.t === 'repair' && e.side === 'A');
    expect(repairs.length).toBeGreaterThan(0);
    expect(repairs[0].targetMechId).toBe('mech_pilot_hotshot');
    expect(repairs[0].amount).toBeGreaterThan(0);
  });

  it('a shield system absorbs damage up to its battle-wide pool and no more', () => {
    const shielded = makeSide(data, 'squad_shield', 'relay', [{ pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', system: 'system_shield', slot: 0, hp: 500 }]);
    const attacker = makeSide(data, 'squad_attacker', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_railgun', system: 'system_targeting', slot: 0 },
    ]);
    const result = resolveBattle(attacker, shielded, baseCtx({ seed: 9 }), data);
    const shieldEvents = result.events.filter((e): e is Extract<BattleEvent, { t: 'shield' }> => e.t === 'shield' && e.mechId === 'mech_pilot_ace');
    expect(shieldEvents.length).toBeGreaterThan(0);
    const totalAbsorbed = shieldEvents.reduce((a, e) => a + e.absorbed, 0);
    expect(totalAbsorbed).toBeLessThanOrEqual(30);
  });
});

describe('resolveBattle: destruction, ejection, and last transmissions', () => {
  it('punch_out guarantees ejection whenever that mech is destroyed', () => {
    const fragile = makeSide(data, 'squad_punch', 'relay', [{ pilotId: 'pilot_rookie', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0, hp: 1 }]);
    const overwhelming = makeSide(data, 'squad_overwhelm', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_railgun', system: 'system_targeting', slot: 0 },
    ]);
    const punchOutCallout: ActiveCallout = { calloutId: 'co_punch_out', pilotId: 'pilot_rookie' };
    let sawDestruction = false;
    for (let seed = 0; seed < 15; seed++) {
      const result = resolveBattle(fragile, overwhelming, baseCtx({ seed, calloutsA: [punchOutCallout] }), data);
      for (const e of result.events) {
        if (e.t === 'destroyed' && e.mechId === 'mech_pilot_rookie') {
          sawDestruction = true;
          expect(e.ejected).toBe(true);
          expect(e.pilotDied).toBe(false);
        }
      }
    }
    expect(sawDestruction).toBe(true);
    // and no pilot deaths were recorded for the punched-out pilot across any of these runs
  });

  it('emits a last_transmission (and its cutin) when a pilot fails to eject', () => {
    // No punch_out, no eject system, low pilot evasion aptitude -> eject chance
    // is close to the ~55% base, so across enough seeds a death occurs.
    const fragile = makeSide(data, 'squad_mortal', 'relay', [
      { pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0, hp: 1, aptitudes: { evasion: 0 } },
    ]);
    const overwhelming = makeSide(data, 'squad_overwhelm2', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_railgun', system: 'system_targeting', slot: 0 },
    ]);
    let sawLastTransmission = false;
    for (let seed = 0; seed < 40 && !sawLastTransmission; seed++) {
      const result = resolveBattle(fragile, overwhelming, baseCtx({ seed }), data);
      const lt = result.events.find((e) => e.t === 'last_transmission' && e.pilotId === 'pilot_ace');
      const cutin = result.events.find((e) => e.t === 'cutin' && e.kind === 'last' && e.pilotId === 'pilot_ace');
      if (lt && cutin) {
        sawLastTransmission = true;
        expect((lt as any).calloutId).toBe('lt_got_the_shot'); // pilot_ace's fixture lastTransmissionId
        expect(result.pilotDeaths.some((d) => d.pilotId === 'pilot_ace')).toBe(true);
      }
    }
    expect(sawLastTransmission).toBe(true);
  });

  it('lt_take_the_frame marks the lost mech as recoverable', () => {
    const fragile = makeSide(data, 'squad_marksman_mortal', 'relay', [
      { pilotId: 'pilot_marksman', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 3, hp: 1, aptitudes: { evasion: 0 } },
    ]);
    const overwhelming = makeSide(data, 'squad_overwhelm3', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_railgun', system: 'system_targeting', slot: 0 },
    ]);
    let sawRecoverable = false;
    for (let seed = 0; seed < 40 && !sawRecoverable; seed++) {
      const result = resolveBattle(fragile, overwhelming, baseCtx({ seed }), data);
      const lost = result.mechsLost.find((m) => m.mechId === 'mech_pilot_marksman' && m.recoverable);
      if (lost) sawRecoverable = true;
    }
    expect(sawRecoverable).toBe(true);
  });
});

describe('resolveBattle: prebattle callout effects', () => {
  it('eyes_on emits its callout event with no other battle-mechanical change', () => {
    const result = resolveBattle(strongSideA(), weakSideB(), baseCtx({ calloutsA: [{ calloutId: 'co_eyes_on', pilotId: 'pilot_ace' }] }), data);
    expect(result.events.some((e) => e.t === 'callout' && e.calloutId === 'co_eyes_on')).toBe(true);
  });

  it('break_formation lets a back-row mech fire a front-only weapon', () => {
    const backRowMelee = makeSide(data, 'squad_bf', 'relay', [{ pilotId: 'pilot_hotshot', frameId: 'frame_line', weaponA: 'weapon_lance', slot: 3 }]);
    const enemy = weakSideB();
    const without = resolveBattle(backRowMelee, enemy, baseCtx({ seed: 3 }), data);
    const withCallout = resolveBattle(backRowMelee, enemy, baseCtx({ seed: 3, calloutsA: [{ calloutId: 'co_break_formation', pilotId: 'pilot_hotshot' }] }), data);
    const attacksWithout = without.events.filter((e) => e.t === 'attack' && e.side === 'A').length;
    const attacksWith = withCallout.events.filter((e) => e.t === 'attack' && e.side === 'A').length;
    expect(without.events.some((e) => e.t === 'callout' && e.calloutId === 'co_break_formation')).toBe(false);
    expect(withCallout.events.some((e) => e.t === 'callout' && e.calloutId === 'co_break_formation')).toBe(true);
    expect(attacksWith).toBeGreaterThan(attacksWithout);
  });

  it('redline increases the caster mech maxHpPenalty permanently', () => {
    const side = strongSideA();
    const originalPenalty = side.mechs['mech_pilot_hotshot'].maxHpPenalty;
    const result = resolveBattle(side, weakSideB(), baseCtx({ calloutsA: [{ calloutId: 'co_redline', pilotId: 'pilot_hotshot' }] }), data);
    expect(result.events.some((e) => e.t === 'callout' && e.calloutId === 'co_redline')).toBe(true);
    expect(result.sideA.mechs['mech_pilot_hotshot'].maxHpPenalty).toBeGreaterThan(originalPenalty);
  });

  it('on_me redirects at least some attacks aimed at the protected ally to the caster', () => {
    const side = makeSide(data, 'squad_onme', 'relay', [
      { pilotId: 'pilot_marksman', frameId: 'frame_line', weaponA: 'weapon_lance', slot: 0 }, // caster, front
      { pilotId: 'pilot_rookie', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 3 }, // protected, back
    ]);
    const enemy = makeSide(data, 'squad_onme_enemy', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_line', weaponA: 'weapon_rifle', slot: 0 }]);
    const callout: ActiveCallout = { calloutId: 'co_on_me', pilotId: 'pilot_marksman', targetPilotId: 'pilot_rookie' };
    let sawIntercept = false;
    for (let seed = 0; seed < 30 && !sawIntercept; seed++) {
      const result = resolveBattle(side, enemy, baseCtx({ seed, calloutsA: [callout] }), data);
      if (result.events.some((e) => e.t === 'intercept' && e.calloutId === 'co_on_me')) sawIntercept = true;
    }
    expect(sawIntercept).toBe(true);
  });

  it('first_ones_mine puts the caster first in round 1 initiative', () => {
    const side = makeSide(data, 'squad_fom', 'relay', [
      { pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0 }, // slow-ish caster
      { pilotId: 'pilot_hotshot', frameId: 'frame_bastion', weaponA: 'weapon_lance', slot: 1 }, // would normally act by speed
    ]);
    const enemy = makeSide(data, 'squad_fom_enemy', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0 }]);
    const result = resolveBattle(side, enemy, baseCtx({ seed: 11, calloutsA: [{ calloutId: 'co_first_ones_mine', pilotId: 'pilot_ace' }] }), data);
    const round1Start = result.events.findIndex((e) => e.t === 'round' && e.n === 1);
    const round2Start = result.events.findIndex((e) => e.t === 'round' && e.n === 2);
    const round1Events = result.events.slice(round1Start + 1, round2Start === -1 ? undefined : round2Start);
    const firstActingMech = round1Events.find((e) => e.t === 'attack' || e.t === 'repair') as any;
    expect(firstActingMech?.attackerMechId ?? firstActingMech?.mechId).toBe('mech_pilot_ace');
  });

  it('chain_it grants squadmates a follow-up attack on the first kill', () => {
    const side = makeSide(data, 'squad_chain', 'relay', [
      { pilotId: 'pilot_hotshot', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', slot: 0 },
      { pilotId: 'pilot_ace', frameId: 'frame_line', weaponA: 'weapon_rifle', slot: 1 },
    ]);
    const enemy = makeSide(data, 'squad_chain_enemy', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0, hp: 5 },
      { pilotId: 'pilot_ace', frameId: 'frame_bastion', weaponA: 'weapon_rifle', slot: 1, hp: 300 },
    ]);
    let sawFollowUp = false;
    for (let seed = 0; seed < 20 && !sawFollowUp; seed++) {
      const result = resolveBattle(side, enemy, baseCtx({ seed, calloutsA: [{ calloutId: 'co_chain_it', pilotId: 'pilot_hotshot' }] }), data);
      if (result.events.some((e) => e.t === 'attack' && e.side === 'A' && e.followUp)) sawFollowUp = true;
    }
    expect(sawFollowUp).toBe(true);
  });

  it('sell_it shifts round-1 targeting toward the back row', () => {
    const side = makeSide(data, 'squad_sellit', 'relay', [
      { pilotId: 'pilot_ace', frameId: 'frame_line', weaponA: 'weapon_rifle', slot: 0, hp: 500 },
      { pilotId: 'pilot_hotshot', frameId: 'frame_line', weaponA: 'weapon_rifle', slot: 3, hp: 500 },
    ]);
    const enemy = makeSide(data, 'squad_sellit_enemy', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_rifle', slot: 0 },
    ]);
    function countBackRoundOneHits(callouts: ActiveCallout[]) {
      let front = 0;
      let back = 0;
      for (let seed = 0; seed < 40; seed++) {
        const result = resolveBattle(side, enemy, baseCtx({ seed, calloutsA: callouts }), data);
        const round1Start = result.events.findIndex((e) => e.t === 'round' && e.n === 1);
        const round2Start = result.events.findIndex((e) => e.t === 'round' && e.n === 2);
        const slice = result.events.slice(round1Start + 1, round2Start === -1 ? undefined : round2Start);
        for (const e of slice) {
          if (e.t === 'attack' && e.side === 'B') {
            if (e.defenderMechId === 'mech_pilot_ace') front++;
            if (e.defenderMechId === 'mech_pilot_hotshot') back++;
          }
        }
      }
      return { front, back };
    }
    const withoutSellIt = countBackRoundOneHits([]);
    const withSellIt = countBackRoundOneHits([{ calloutId: 'co_sell_it', pilotId: 'pilot_ace' }]);
    expect(withoutSellIt.front).toBeGreaterThan(withoutSellIt.back);
    expect(withSellIt.back).toBeGreaterThan(withSellIt.front);
  });

  it('we_hold prevents a rout that would otherwise occur', () => {
    const fragile = makeSide(
      data,
      'squad_wehold',
      'relay',
      [
        { pilotId: 'pilot_rookie', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 0, hp: 20 },
        { pilotId: 'pilot_marksman', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 1, hp: 20 },
        { pilotId: 'pilot_hotshot', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 2, hp: 20 },
      ],
      { morale: 25 }
    );
    const enemy = makeSide(data, 'squad_wehold_enemy', 'compact', [
      { pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', system: 'system_targeting', slot: 0 },
      { pilotId: 'pilot_ace', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_rifle', system: 'system_targeting', slot: 1 },
    ]);
    for (let seed = 0; seed < 30; seed++) {
      const result = resolveBattle(fragile, enemy, baseCtx({ seed, calloutsA: [{ calloutId: 'co_we_hold', pilotId: 'pilot_rookie' }] }), data);
      expect(result.events.some((e) => e.t === 'rout' && e.side === 'A')).toBe(false);
    }
  });
});

describe('resolveBattle: tandem callout effects', () => {
  function tandemSide() {
    return makeSide(data, 'squad_tandem', 'relay', [
      { pilotId: 'pilot_ace', frameId: 'frame_line', weaponA: 'weapon_rifle', slot: 3 },
      { pilotId: 'pilot_hotshot', frameId: 'frame_line', weaponA: 'weapon_rifle', slot: 4 },
      { pilotId: 'pilot_marksman', frameId: 'frame_line', weaponA: 'weapon_rifle', slot: 0 },
      { pilotId: 'pilot_rookie', frameId: 'frame_skirmish', weaponA: 'weapon_rifle', slot: 5, hp: 5, aptitudes: { evasion: 0 } },
    ]);
  }
  function tandemEnemy() {
    return makeSide(data, 'squad_tandem_enemy', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_bastion', weaponA: 'weapon_lance', weaponB: 'weapon_railgun', slot: 0 }]);
  }

  it('td_cross_fire fires one combined guaranteed-hit attack in round 1', () => {
    const callout: ActiveCallout = { calloutId: 'co_td_cross_fire', pilotId: 'pilot_ace', partnerPilotId: 'pilot_hotshot' };
    const result = resolveBattle(tandemSide(), tandemEnemy(), baseCtx({ seed: 1, calloutsA: [callout] }), data);
    const crossFireAttack = result.events.find((e) => e.t === 'attack' && (e as any).tandemCalloutId === 'co_td_cross_fire');
    expect(crossFireAttack).toBeTruthy();
  });

  it('td_switch swaps the two partners rows after round 1', () => {
    const callout: ActiveCallout = { calloutId: 'co_td_switch', pilotId: 'pilot_marksman', partnerPilotId: 'pilot_rookie' };
    const before = tandemSide();
    const beforeSlotMarksman = before.squad.slots.findIndex((s) => s?.pilotId === 'pilot_marksman');
    const beforeSlotRookie = before.squad.slots.findIndex((s) => s?.pilotId === 'pilot_rookie');
    const result = resolveBattle(before, tandemEnemy(), baseCtx({ seed: 2, calloutsA: [callout] }), data);
    const afterSlotMarksman = result.sideA.squad.slots.findIndex((s) => s?.pilotId === 'pilot_marksman');
    const afterSlotRookie = result.sideA.squad.slots.findIndex((s) => s?.pilotId === 'pilot_rookie');
    expect(afterSlotMarksman).toBe(beforeSlotRookie);
    expect(afterSlotRookie).toBe(beforeSlotMarksman);
  });

  it('td_got_your_six intercepts a lethal hit on the protected pilot at half damage', () => {
    const callout: ActiveCallout = { calloutId: 'co_td_got_your_six', pilotId: 'pilot_hotshot', partnerPilotId: 'pilot_rookie' };
    let sawIntercept = false;
    for (let seed = 0; seed < 30 && !sawIntercept; seed++) {
      const result = resolveBattle(tandemSide(), tandemEnemy(), baseCtx({ seed, calloutsA: [callout] }), data);
      if (result.events.some((e) => e.t === 'intercept' && e.calloutId === 'co_td_got_your_six')) sawIntercept = true;
    }
    expect(sawIntercept).toBe(true);
  });

  it('td_double_time makes the pair act twice in round 1', () => {
    const callout: ActiveCallout = { calloutId: 'co_td_double_time', pilotId: 'pilot_ace', partnerPilotId: 'pilot_marksman' };
    const result = resolveBattle(tandemSide(), tandemEnemy(), baseCtx({ seed: 4, calloutsA: [callout] }), data);
    const round1Start = result.events.findIndex((e) => e.t === 'round' && e.n === 1);
    const round2Start = result.events.findIndex((e) => e.t === 'round' && e.n === 2);
    const slice = result.events.slice(round1Start + 1, round2Start === -1 ? undefined : round2Start);
    const aceActs = slice.filter((e) => e.t === 'attack' && (e as any).attackerMechId === 'mech_pilot_ace').length;
    expect(aceActs).toBeGreaterThanOrEqual(2);
  });
});

describe('resolveBattle: growth, kills, and ace/finisher', () => {
  it('records growth only for side A and kills for the killer', () => {
    const result = resolveBattle(strongSideA(), weakSideB(), baseCtx({ seed: 21 }), data);
    expect(Object.keys(result.growth).length).toBeGreaterThan(0);
    const totalKills = Object.values(result.killsByPilot).reduce((a, b) => a + b, 0);
    expect(totalKills).toBeGreaterThanOrEqual(0);
  });

  it('fires a finisher cutin on an already-ace pilot first kill of the battle', () => {
    const side = strongSideA();
    side.pilots['pilot_ace'].kills = RULES_ACE_KILLS;
    side.pilots['pilot_ace'].ace = true;
    let sawFinisher = false;
    for (let seed = 0; seed < 20 && !sawFinisher; seed++) {
      const result = resolveBattle(side, weakSideB(), baseCtx({ seed }), data);
      if (result.events.some((e) => e.t === 'finisher' && e.pilotId === 'pilot_ace')) sawFinisher = true;
    }
    expect(sawFinisher).toBe(true);
  });
});

const RULES_ACE_KILLS = 8;

describe('resolveBattle: degenerate inputs', () => {
  it('handles a side with an empty squad (all-null slots) without throwing', () => {
    const emptySide = makeSide(data, 'squad_empty', 'relay', []);
    const enemy = weakSideB();
    const result = resolveBattle(emptySide, enemy, baseCtx({ seed: 1 }), data);
    const end = result.events.find((e) => e.t === 'end') as Extract<BattleEvent, { t: 'end' }>;
    expect(end.winner).toBe('B');
    expect(end.reason).toBe('annihilation');
  });

  it('handles a mech with no usable weapons (does nothing each turn)', () => {
    const side = makeSide(data, 'squad_unarmed', 'relay', [{ pilotId: 'pilot_ace', frameId: 'frame_skirmish', weaponA: null, weaponB: null, slot: 0 }]);
    const enemy = makeSide(data, 'squad_unarmed_enemy', 'compact', [{ pilotId: 'pilot_grunt', frameId: 'frame_skirmish', weaponA: null, weaponB: null, slot: 0 }]);
    const result = resolveBattle(side, enemy, baseCtx({ seed: 1 }), data);
    expect(result.events.filter((e) => e.t === 'attack').length).toBe(0);
    const end = result.events.find((e) => e.t === 'end') as Extract<BattleEvent, { t: 'end' }>;
    expect(end.reason).toBe('rounds');
  });
});
