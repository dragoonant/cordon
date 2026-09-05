/**
 * CORDON — deterministic battle resolver.
 *
 * resolveBattle() is the only export used outside this module. Everything
 * else is an internal helper. The whole file is pure: sideA/sideB/ctx/data
 * are never mutated; resolveBattle deep-copies its side inputs up front and
 * returns those copies (mutated) as result.sideA/sideB.
 *
 * Design notes / interpretation calls (GDD and API.md leave a few specifics
 * open — documented here rather than silently guessed):
 *  - Targeting weights: melee attackers weight the opponent's front row 3:1
 *    over back row; ranged/support weight evenly. "Sell it." inverts this to
 *    3:1 toward the back row for round 1, for any attacker kind, on the
 *    casting side (the "wrong row" bait).
 *  - "Redline it." grants a flat 60% attack damage bonus to the caster's
 *    mech (RULES.REDLINE_DAMAGE_MULT) and immediately adds 15% of the
 *    frame's max HP to mech.maxHpPenalty in the returned copy (permanent
 *    for the run; run.ts/hangar.ts persist it).
 *  - "I've got your six." intercepts at the whole-attack level (not
 *    per sub-hit): if the attack's total damage would be lethal to the
 *    protected pilot, the whole attack is redirected to the partner at half
 *    total damage, once per battle.
 *  - lt_got_the_shot's bonus attack ignores defender evasion (guaranteed
 *    hit chance-wise) but still rolls crit and still applies row/armor
 *    math, since "full power" reads as "not gimped by evasion", not as a
 *    guaranteed max hit.
 */
import type {
  ActiveCallout,
  Aptitude,
  BattleContext,
  BattleEvent,
  BattleResult,
  BattleSide,
  CalloutEffect,
  FrameDef,
  GameData,
  Id,
  Mech,
  Pilot,
  PilotDef,
  Row,
  SalvageDrop,
  SlotAssignment,
  SlotIndex,
  Squad,
  WeaponDef,
} from './types';
import { rowOf, FRONT_SLOTS, BACK_SLOTS } from './types';
import { Rng } from './rng';
import { RULES, effectiveStats, mechLoad, weatherModifiers } from './rules';

/**
 * Enemy pilots are instances of a PilotDef with ids of the form
 * `defId#spawn#slot` (see run.ts); resolve the def by stripping the suffix.
 */
function pilotDefFor(data: GameData, pilotId: Id): PilotDef | undefined {
  return data.pilots[pilotId] ?? data.pilots[pilotId.split('#')[0]];
}

/** rng.pick that tolerates an empty line pool. */
function pickLine(rng: Rng, lines: readonly string[] | undefined): string | undefined {
  return lines && lines.length ? rng.pick(lines) : undefined;
}

// ---------------------------------------------------------------------------
// Internal runtime state
// ---------------------------------------------------------------------------

interface TdGotYourSix {
  aPilotId: Id;
  bPilotId: Id;
  calloutId: Id;
  used: boolean;
}
interface TdSwitch {
  aPilotId: Id;
  bPilotId: Id;
  calloutId: Id;
  done: boolean;
}
interface TdCrossFire {
  aPilotId: Id;
  bPilotId: Id;
  calloutId: Id;
}
interface OnMeRedirect {
  casterMechId: Id;
  casterPilotId: Id;
  calloutId: Id;
}

interface SideRuntime {
  key: 'A' | 'B';
  squad: Squad;
  pilots: Record<Id, Pilot>;
  mechs: Record<Id, Mech>;
  marked: boolean;
  breakFormation: boolean;
  sellItRound1: boolean;
  weHold: boolean;
  onMeRedirect: Map<Id, OnMeRedirect>;
  chainIt: { active: boolean; triggered: boolean };
  firstOnesMineMechId: Id | null;
  redlineMechIds: Set<Id>;
  punchOutMechIds: Set<Id>;
  shieldPool: Map<Id, number>;
  supportOrSystemUsed: Set<Id>;
  finisherFired: Set<Id>;
  tdGotYourSix: TdGotYourSix[];
  tdSwitch: TdSwitch[];
  tdDoubleTimeMechIds: Set<Id>;
  tdCrossFire: TdCrossFire[];
  growth: Record<Id, Partial<Record<Aptitude, number>>>;
  killsByPilot: Record<Id, number>;
  pilotDeaths: { side: 'A' | 'B'; pilotId: Id }[];
  mechsLost: { side: 'A' | 'B'; mechId: Id; recoverable: boolean }[];
}

interface FireOpts {
  guaranteedHit?: boolean;
  ignoreEvasion?: boolean;
  forcedTarget?: { mechId: Id; pilotId: Id };
  skipRedirect?: boolean;
  extraDamageFlat?: number;
  tandemCalloutId?: Id;
  followUp?: boolean;
  rowMultOverride?: number;
}

type AceSnapshot = Record<'A' | 'B', Record<Id, boolean>>;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

// ---------------------------------------------------------------------------
// Small lookups over SideRuntime
// ---------------------------------------------------------------------------

function isAlive(side: SideRuntime, mechId: Id | null | undefined): boolean {
  if (!mechId) return false;
  const m = side.mechs[mechId];
  return !!m && !m.destroyed && m.hp > 0;
}

function mechIdForPilot(side: SideRuntime, pilotId: Id): Id | null {
  const a = side.squad.slots.find((s) => s && s.pilotId === pilotId);
  return a ? a.mechId : null;
}

function pilotIdForMech(side: SideRuntime, mechId: Id): Id | null {
  const a = side.squad.slots.find((s) => s && s.mechId === mechId);
  return a ? a.pilotId : null;
}

function slotIndexForPilot(side: SideRuntime, pilotId: Id): number {
  return side.squad.slots.findIndex((s) => s && s.pilotId === pilotId);
}

function currentRow(side: SideRuntime, mechId: Id): Row {
  const idx = side.squad.slots.findIndex((s) => s && s.mechId === mechId);
  return idx >= 0 ? rowOf(idx as SlotIndex) : 'front';
}

function frontRowAllyAlive(side: SideRuntime): boolean {
  return FRONT_SLOTS.some((idx) => {
    const a = side.squad.slots[idx];
    return a && isAlive(side, a.mechId);
  });
}

function livingMechIds(side: SideRuntime): Id[] {
  const out: Id[] = [];
  for (const s of side.squad.slots) {
    if (s && isAlive(side, s.mechId)) out.push(s.mechId);
  }
  return out;
}

function sideAllDead(side: SideRuntime): boolean {
  return livingMechIds(side).length === 0;
}

function effectiveRowMult(weapon: WeaponDef, row: Row, breakFormation: boolean): number {
  if (breakFormation) return 1;
  return row === 'front' ? weapon.frontMult : weapon.backMult;
}

function sumSystemValue(mech: Mech, effect: string, data: GameData): number {
  let total = 0;
  for (const sid of [mech.system, mech.system2]) {
    if (!sid) continue;
    const sys = data.systems[sid];
    if (sys && sys.effect === effect) total += sys.value;
  }
  return total;
}

function pickUsableWeapon(side: SideRuntime, mechId: Id, data: GameData): WeaponDef | null {
  const mech = side.mechs[mechId];
  const row = currentRow(side, mechId);
  const a = mech.weaponA ? data.weapons[mech.weaponA] : null;
  const b = mech.weaponB ? data.weapons[mech.weaponB] : null;
  if (a && effectiveRowMult(a, row, side.breakFormation) !== 0) return a;
  if (b && effectiveRowMult(b, row, side.breakFormation) !== 0) return b;
  return null;
}

/** Any non-support weapon fitted, ignoring row usability (for lt_got_the_shot / cross-fire). */
function pickAnyOffensiveWeapon(mech: Mech, data: GameData): WeaponDef | null {
  const a = mech.weaponA ? data.weapons[mech.weaponA] : null;
  const b = mech.weaponB ? data.weapons[mech.weaponB] : null;
  if (a && a.kind !== 'support') return a;
  if (b && b.kind !== 'support') return b;
  return null;
}

function addGrowth(side: SideRuntime, pilotId: Id, apt: Aptitude, amount: number): void {
  if (side.key !== 'A' || amount <= 0) return;
  const bucket = side.growth[pilotId] ?? (side.growth[pilotId] = {});
  bucket[apt] = (bucket[apt] ?? 0) + amount;
}

// ---------------------------------------------------------------------------
// Side setup
// ---------------------------------------------------------------------------

function initShieldPools(mechs: Record<Id, Mech>, data: GameData): Map<Id, number> {
  const pool = new Map<Id, number>();
  for (const mech of Object.values(mechs)) {
    const value = sumSystemValue(mech, 'shield', data);
    if (value > 0) pool.set(mech.id, value);
  }
  return pool;
}

function buildSideRuntime(key: 'A' | 'B', input: BattleSide, ctx: BattleContext, data: GameData): SideRuntime {
  const squad = clone(input.squad);
  const pilots = clone(input.pilots);
  const mechs = clone(input.mechs);
  return {
    key,
    squad,
    pilots,
    mechs,
    marked: !!ctx.markedSquadIds?.includes(squad.id),
    breakFormation: false,
    sellItRound1: false,
    weHold: false,
    onMeRedirect: new Map(),
    chainIt: { active: false, triggered: false },
    firstOnesMineMechId: null,
    redlineMechIds: new Set(),
    punchOutMechIds: new Set(),
    shieldPool: initShieldPools(mechs, data),
    supportOrSystemUsed: new Set(),
    finisherFired: new Set(),
    tdGotYourSix: [],
    tdSwitch: [],
    tdDoubleTimeMechIds: new Set(),
    tdCrossFire: [],
    growth: {},
    killsByPilot: {},
    pilotDeaths: [],
    mechsLost: [],
  };
}

function processPrebattleCallouts(side: SideRuntime, callouts: ActiveCallout[], data: GameData, events: BattleEvent[]): void {
  for (const ac of callouts) {
    const def = data.callouts[ac.calloutId];
    if (!def || def.kind !== 'prebattle') continue;
    events.push({ t: 'callout', side: side.key, pilotId: ac.pilotId, calloutId: ac.calloutId, line: def.line, partnerPilotId: ac.partnerPilotId });
    events.push({ t: 'cutin', side: side.key, pilotId: ac.pilotId, kind: 'callout', line: def.line });
    const casterMechId = mechIdForPilot(side, ac.pilotId);
    const effect: CalloutEffect = def.effect;
    switch (effect) {
      case 'eyes_on':
        // Forecast-only; no in-battle effect.
        break;
      case 'break_formation':
        side.breakFormation = true;
        break;
      case 'redline': {
        if (casterMechId) {
          side.redlineMechIds.add(casterMechId);
          const mech = side.mechs[casterMechId];
          const frame = data.frames[mech.frameId];
          if (frame) mech.maxHpPenalty += frame.hp * RULES.REDLINE_MAXHP_PENALTY_FRACTION;
        }
        break;
      }
      case 'on_me': {
        if (casterMechId && ac.targetPilotId) {
          const targetMechId = mechIdForPilot(side, ac.targetPilotId);
          if (targetMechId) side.onMeRedirect.set(targetMechId, { casterMechId, casterPilotId: ac.pilotId, calloutId: ac.calloutId });
        }
        break;
      }
      case 'punch_out':
        if (casterMechId) side.punchOutMechIds.add(casterMechId);
        break;
      case 'first_ones_mine':
        if (casterMechId) side.firstOnesMineMechId = casterMechId;
        break;
      case 'chain_it':
        side.chainIt.active = true;
        break;
      case 'sell_it':
        side.sellItRound1 = true;
        break;
      case 'we_hold':
        side.weHold = true;
        break;
      default:
        // overworld / last / tandem effects are not valid in calloutsA/B prebattle lists.
        break;
    }
  }
}

function processTandemCallouts(side: SideRuntime, callouts: ActiveCallout[], data: GameData, events: BattleEvent[]): void {
  for (const ac of callouts) {
    const def = data.callouts[ac.calloutId];
    if (!def || def.kind !== 'tandem' || !ac.partnerPilotId) continue;
    events.push({ t: 'callout', side: side.key, pilotId: ac.pilotId, calloutId: ac.calloutId, line: def.line, partnerPilotId: ac.partnerPilotId });
    events.push({ t: 'cutin', side: side.key, pilotId: ac.pilotId, kind: 'callout', line: def.line });
    events.push({ t: 'cutin', side: side.key, pilotId: ac.partnerPilotId, kind: 'callout', line: def.line });
    switch (def.effect as CalloutEffect) {
      case 'td_cross_fire':
        side.tdCrossFire.push({ aPilotId: ac.pilotId, bPilotId: ac.partnerPilotId, calloutId: ac.calloutId });
        break;
      case 'td_switch':
        side.tdSwitch.push({ aPilotId: ac.pilotId, bPilotId: ac.partnerPilotId, calloutId: ac.calloutId, done: false });
        break;
      case 'td_got_your_six':
        side.tdGotYourSix.push({ aPilotId: ac.pilotId, bPilotId: ac.partnerPilotId, calloutId: ac.calloutId, used: false });
        break;
      case 'td_double_time': {
        const mA = mechIdForPilot(side, ac.pilotId);
        const mB = mechIdForPilot(side, ac.partnerPilotId);
        if (mA) side.tdDoubleTimeMechIds.add(mA);
        if (mB) side.tdDoubleTimeMechIds.add(mB);
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

function selectTarget(defenderSide: SideRuntime, attackerKind: WeaponDef['kind'], round: number, rng: Rng): { mechId: Id; pilotId: Id } | null {
  const living: { mechId: Id; pilotId: Id; row: Row }[] = [];
  for (let idx = 0; idx < defenderSide.squad.slots.length; idx++) {
    const a = defenderSide.squad.slots[idx];
    if (!a || !isAlive(defenderSide, a.mechId)) continue;
    living.push({ mechId: a.mechId, pilotId: a.pilotId, row: rowOf(idx as SlotIndex) });
  }
  if (living.length === 0) return null;
  let frontWeight = attackerKind === 'melee' ? 3 : 1;
  let backWeight = 1;
  if (defenderSide.sellItRound1 && round === 1) {
    frontWeight = 1;
    backWeight = 3;
  }
  const weights = living.map((l) => (l.row === 'front' ? frontWeight : backWeight));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < living.length; i++) {
    r -= weights[i];
    if (r <= 0) return { mechId: living[i].mechId, pilotId: living[i].pilotId };
  }
  const last = living[living.length - 1];
  return { mechId: last.mechId, pilotId: last.pilotId };
}

// ---------------------------------------------------------------------------
// Core attack resolution (shared by normal turns, follow-ups, cross-fire,
// and lt_got_the_shot's bonus shot).
// ---------------------------------------------------------------------------

function fireWeapon(
  attackerSide: SideRuntime,
  defenderSide: SideRuntime,
  attackerMechId: Id,
  attackerPilotId: Id,
  weapon: WeaponDef,
  ctx: BattleContext,
  data: GameData,
  rng: Rng,
  events: BattleEvent[],
  round: number,
  opts: FireOpts,
  aceAtStart: AceSnapshot
): void {
  const attackerMech = attackerSide.mechs[attackerMechId];
  const attackerPilot = attackerSide.pilots[attackerPilotId];
  const attackerDef = pilotDefFor(data, attackerPilotId);
  if (!attackerMech || !attackerPilot || !attackerDef) return;

  const row = currentRow(attackerSide, attackerMechId);
  const rowMult = opts.rowMultOverride ?? effectiveRowMult(weapon, row, attackerSide.breakFormation);

  let target = opts.forcedTarget ?? selectTarget(defenderSide, weapon.kind, round, rng);
  if (!target) return;

  if (!opts.skipRedirect) {
    const redirect = defenderSide.onMeRedirect.get(target.mechId);
    if (redirect && redirect.casterMechId !== target.mechId && isAlive(defenderSide, redirect.casterMechId)) {
      events.push({ t: 'intercept', side: defenderSide.key, protectorPilotId: redirect.casterPilotId, protectedPilotId: target.pilotId, calloutId: redirect.calloutId });
      target = { mechId: redirect.casterMechId, pilotId: redirect.casterPilotId };
    }
  }

  const attackerStats = effectiveStats(attackerPilot, attackerMech, data, { terrain: ctx.terrain, mapKind: ctx.mapKind, weather: ctx.weather });
  const weather = weatherModifiers(ctx.weather, weapon.kind);
  const redlineBonus = attackerSide.redlineMechIds.has(attackerMechId) ? RULES.REDLINE_DAMAGE_MULT : 1;
  const damageMultTotal = attackerStats.damageMult * (1 + weather.damage / 100) * redlineBonus;
  const aptScore = weapon.kind === 'melee' ? attackerPilot.aptitudes.melee : attackerPilot.aptitudes.gunnery;
  const critBonus = sumSystemValue(attackerMech, 'targeting', data);

  const defenderMechInitial = defenderSide.mechs[target.mechId];
  const defenderPilotInitial = defenderSide.pilots[target.pilotId];
  const defenderStatsInitial = effectiveStats(defenderPilotInitial, defenderMechInitial, data, { terrain: ctx.terrain, mapKind: ctx.mapKind, weather: ctx.weather });
  const defenderArmor = defenderStatsInitial.armor;
  const defenderRow = currentRow(defenderSide, target.mechId);
  const ecm = sumSystemValue(defenderMechInitial, 'ecm', data);

  const hitsCount = opts.guaranteedHit ? 1 : Math.max(1, weapon.hits || 1);
  const hitRecords: { hit: boolean; damage: number; crit: boolean }[] = [];
  let totalDamage = 0;
  let anyCrit = false;
  let anyLanded = false;

  for (let i = 0; i < hitsCount; i++) {
    let defenderEvasion = defenderStatsInitial.evasion;
    if (opts.ignoreEvasion) defenderEvasion = 0;
    if (defenderSide.firstOnesMineMechId === target.mechId && round === 1) defenderEvasion = 0;

    const hitChance = opts.guaranteedHit
      ? 100
      : clamp(
          weapon.accuracy + aptScore * RULES.APTITUDE_ACCURACY_FACTOR + attackerStats.accuracyBonus - defenderEvasion * RULES.EVASION_DEFENSE_FACTOR - ecm,
          RULES.HIT_CHANCE_MIN,
          RULES.HIT_CHANCE_MAX
        );
    const hit = opts.guaranteedHit ? true : rng.chance(hitChance / 100);
    if (!hit) {
      hitRecords.push({ hit: false, damage: 0, crit: false });
      continue;
    }
    anyLanded = true;
    const crit = rng.chance(clamp(weapon.crit + critBonus, 0, 100) / 100);
    if (crit) anyCrit = true;
    let raw = weapon.damage * rowMult * damageMultTotal;
    if (i === 0 && opts.extraDamageFlat) raw += opts.extraDamageFlat;
    let dmg = crit ? raw * RULES.CRIT_MULT : Math.max(1, raw - defenderArmor);
    if (defenderRow === 'back' && frontRowAllyAlive(defenderSide) && !defenderSide.breakFormation) dmg *= RULES.ROW_DEFENSE_BONUS;
    if (defenderSide.marked) dmg *= RULES.MARKED_DAMAGE_MULT;
    dmg = Math.round(dmg);
    // Shield: absorbs the first N damage per battle, per mech.
    const pool = defenderSide.shieldPool.get(target.mechId);
    if (pool && pool > 0) {
      const absorbed = Math.min(pool, dmg);
      defenderSide.shieldPool.set(target.mechId, pool - absorbed);
      if (absorbed > 0) events.push({ t: 'shield', side: defenderSide.key, mechId: target.mechId, absorbed });
      dmg -= absorbed;
    }
    hitRecords.push({ hit: true, damage: dmg, crit });
    totalDamage += dmg;
  }

  // "I've got your six." — redirect a lethal attack to the bonded partner at half damage, once.
  const wouldBeLethal = defenderMechInitial.hp - totalDamage <= 0;
  if (wouldBeLethal && totalDamage > 0) {
    const pair = defenderSide.tdGotYourSix.find((p) => !p.used && (p.aPilotId === target!.pilotId || p.bPilotId === target!.pilotId));
    if (pair) {
      const partnerPilotId = pair.aPilotId === target.pilotId ? pair.bPilotId : pair.aPilotId;
      const partnerMechId = mechIdForPilot(defenderSide, partnerPilotId);
      if (partnerMechId && partnerMechId !== target.mechId && isAlive(defenderSide, partnerMechId)) {
        pair.used = true;
        const halved = Math.round(totalDamage / 2);
        events.push({ t: 'intercept', side: defenderSide.key, protectorPilotId: partnerPilotId, protectedPilotId: target.pilotId, calloutId: pair.calloutId });
        const scale = totalDamage > 0 ? halved / totalDamage : 0;
        for (const h of hitRecords) if (h.hit) h.damage = Math.round(h.damage * scale);
        totalDamage = halved;
        target = { mechId: partnerMechId, pilotId: partnerPilotId };
      }
    }
  }

  const finalDefMech = defenderSide.mechs[target.mechId];
  const hpBefore = finalDefMech.hp;
  finalDefMech.hp = hpBefore - totalDamage;
  const killed = finalDefMech.hp <= 0 && !finalDefMech.destroyed;
  finalDefMech.hp = Math.max(0, finalDefMech.hp);

  const line = killed ? pickLine(rng, attackerDef.lines.attack) : rng.chance(0.3) ? pickLine(rng, attackerDef.lines.attack) : undefined;

  events.push({
    t: 'attack',
    side: attackerSide.key,
    attackerPilotId,
    attackerMechId,
    defenderPilotId: target.pilotId,
    defenderMechId: target.mechId,
    weaponId: weapon.id,
    hits: hitRecords,
    totalDamage,
    defenderHpAfter: finalDefMech.hp,
    killed,
    followUp: opts.followUp,
    tandemCalloutId: opts.tandemCalloutId,
    line,
  });

  if (anyCrit) {
    events.push({ t: 'cutin', side: attackerSide.key, pilotId: attackerPilotId, kind: 'crit', line: pickLine(rng, attackerDef.lines.crit) ?? '' });
  }

  if (anyLanded && attackerSide.key === 'A') {
    addGrowth(attackerSide, attackerPilotId, weapon.kind === 'melee' ? 'melee' : 'gunnery', rng.int(1, 2));
  }
  if (!anyLanded && defenderSide.key === 'A') {
    addGrowth(defenderSide, target.pilotId, 'evasion', 1);
  }

  if (killed) {
    handleDestruction(defenderSide, attackerSide, target.mechId, target.pilotId, attackerMechId, attackerPilotId, ctx, data, rng, events, round, aceAtStart);
  }
}

function handleDestruction(
  defenderSide: SideRuntime,
  attackerSide: SideRuntime,
  defenderMechId: Id,
  defenderPilotId: Id,
  attackerMechId: Id,
  attackerPilotId: Id,
  ctx: BattleContext,
  data: GameData,
  rng: Rng,
  events: BattleEvent[],
  round: number,
  aceAtStart: AceSnapshot
): void {
  const mech = defenderSide.mechs[defenderMechId];
  mech.destroyed = true;
  mech.hp = 0;

  defenderSide.squad.morale = Math.max(0, defenderSide.squad.morale - 10);
  events.push({ t: 'morale', side: defenderSide.key, delta: -10, reason: 'mech_lost' });

  const pilot = defenderSide.pilots[defenderPilotId];
  const punchOut = defenderSide.punchOutMechIds.has(defenderMechId);
  const ejectSys = sumSystemValue(mech, 'eject', data);
  const ejectChance = RULES.BASE_EJECT_CHANCE + ejectSys + pilot.aptitudes.evasion * RULES.EJECT_EVASION_APTITUDE_FACTOR;
  const ejected = punchOut ? true : rng.chance(clamp(ejectChance, 0, 1));
  let recoverable = false;
  let pilotDied = false;

  if (!ejected) {
    pilotDied = true;
    pilot.alive = false;
    defenderSide.pilotDeaths.push({ side: defenderSide.key, pilotId: defenderPilotId });
    defenderSide.squad.morale = Math.max(0, defenderSide.squad.morale - 20);
    events.push({ t: 'morale', side: defenderSide.key, delta: -20, reason: 'pilot_death' });

    const def = pilotDefFor(data, defenderPilotId);
    const ltDef = def ? data.callouts[def.lastTransmissionId] : null;
    // Last Transmissions belong to the named cast (and the rival). Grunts die quietly.
    const hasVoice = !!def && (def.faction === 'relay' || def.archetype === 'rival');
    if (def && ltDef && hasVoice) {
      events.push({ t: 'last_transmission', side: defenderSide.key, pilotId: defenderPilotId, calloutId: ltDef.id, line: ltDef.line, effect: ltDef.effect });
      events.push({ t: 'cutin', side: defenderSide.key, pilotId: defenderPilotId, kind: 'last', line: ltDef.line });
      if (ltDef.effect === 'lt_take_the_frame') recoverable = true;
      if (ltDef.effect === 'lt_got_the_shot') {
        const weapon = pickAnyOffensiveWeapon(mech, data);
        if (weapon) {
          fireWeapon(defenderSide, attackerSide, defenderMechId, defenderPilotId, weapon, ctx, data, rng, events, round, { ignoreEvasion: true, followUp: true, rowMultOverride: 1 }, aceAtStart);
        }
      }
    }
  }

  events.push({ t: 'destroyed', side: defenderSide.key, mechId: defenderMechId, pilotId: defenderPilotId, pilotDied, ejected });
  defenderSide.mechsLost.push({ side: defenderSide.key, mechId: defenderMechId, recoverable });

  const killerPilot = attackerSide.pilots[attackerPilotId];
  const killerDef = pilotDefFor(data, attackerPilotId);
  if (killerPilot && killerDef) {
    killerPilot.kills += 1;
    attackerSide.killsByPilot[attackerPilotId] = (attackerSide.killsByPilot[attackerPilotId] ?? 0) + 1;
    attackerSide.squad.morale = Math.min(100, attackerSide.squad.morale + 5);
    events.push({ t: 'morale', side: attackerSide.key, delta: 5, reason: 'kill' });
    if (killerPilot.kills >= RULES.ACE_KILLS) killerPilot.ace = true;

    events.push({ t: 'cutin', side: attackerSide.key, pilotId: attackerPilotId, kind: 'kill', line: pickLine(rng, killerDef.lines.kill) ?? '' });

    if (aceAtStart[attackerSide.key][attackerPilotId] && !attackerSide.finisherFired.has(attackerPilotId)) {
      attackerSide.finisherFired.add(attackerPilotId);
      events.push({ t: 'finisher', side: attackerSide.key, pilotId: attackerPilotId, name: killerDef.lines.finisherName, line: killerDef.lines.finisher });
      events.push({ t: 'cutin', side: attackerSide.key, pilotId: attackerPilotId, kind: 'finisher', line: killerDef.lines.finisher });
    }

    if (attackerSide.chainIt.active && !attackerSide.chainIt.triggered) {
      attackerSide.chainIt.triggered = true;
      const others = livingMechIds(attackerSide).filter((id) => id !== attackerMechId);
      for (const mid of others) {
        const pid = pilotIdForMech(attackerSide, mid);
        if (!pid) continue;
        const weapon = pickUsableWeapon(attackerSide, mid, data);
        if (weapon && weapon.kind !== 'support') {
          fireWeapon(attackerSide, defenderSide, mid, pid, weapon, ctx, data, rng, events, round, { followUp: true }, aceAtStart);
        }
      }
    }
  }
}

function performRepair(side: SideRuntime, mechId: Id, pilotId: Id, weapon: WeaponDef, data: GameData, events: BattleEvent[]): void {
  const living = livingMechIds(side);
  if (living.length === 0) return;
  let bestId = living[0];
  let bestFrac = Infinity;
  for (const id of living) {
    const m = side.mechs[id];
    const frame = data.frames[m.frameId];
    const maxHp = frame ? Math.max(1, frame.hp - m.maxHpPenalty) : m.hp;
    const frac = m.hp / maxHp;
    if (frac < bestFrac) {
      bestFrac = frac;
      bestId = id;
    }
  }
  const targetMech = side.mechs[bestId];
  const frame = data.frames[targetMech.frameId];
  const maxHp = frame ? Math.max(1, Math.round(frame.hp - targetMech.maxHpPenalty)) : targetMech.hp;
  const amount = Math.max(0, Math.min(weapon.repair ?? 0, maxHp - targetMech.hp));
  targetMech.hp += amount;
  events.push({ t: 'repair', side: side.key, pilotId, mechId, targetMechId: bestId, amount });
  side.supportOrSystemUsed.add(pilotId);
}

function applyRepairDrones(side: SideRuntime, data: GameData, events: BattleEvent[]): void {
  for (const mechId of livingMechIds(side)) {
    const mech = side.mechs[mechId];
    const value = sumSystemValue(mech, 'repair_drone', data);
    if (value <= 0) continue;
    const frame = data.frames[mech.frameId];
    const maxHp = frame ? Math.max(1, Math.round(frame.hp - mech.maxHpPenalty)) : mech.hp;
    const amount = Math.max(0, Math.min(value, maxHp - mech.hp));
    if (amount <= 0) continue;
    mech.hp += amount;
    const pilotId = pilotIdForMech(side, mechId);
    if (pilotId) events.push({ t: 'repair', side: side.key, pilotId, mechId, targetMechId: mechId, amount });
  }
}

function applyTdSwitch(side: SideRuntime): void {
  for (const pair of side.tdSwitch) {
    if (pair.done) continue;
    const ia = slotIndexForPilot(side, pair.aPilotId);
    const ib = slotIndexForPilot(side, pair.bPilotId);
    if (ia >= 0 && ib >= 0) {
      const tmp = side.squad.slots[ia];
      side.squad.slots[ia] = side.squad.slots[ib];
      side.squad.slots[ib] = tmp;
    }
    pair.done = true;
  }
}

// ---------------------------------------------------------------------------
// Turn order & round processing
// ---------------------------------------------------------------------------

interface Action {
  side: 'A' | 'B';
  mechId: Id;
  pilotId: Id;
}

function buildInitiativeOrder(sideA: SideRuntime, sideB: SideRuntime, round: number, data: GameData, rng: Rng): Action[] {
  const scored: (Action & { score: number })[] = [];
  for (const side of [sideA, sideB]) {
    for (const mechId of livingMechIds(side)) {
      const pilotId = pilotIdForMech(side, mechId);
      if (!pilotId) continue;
      const mech = side.mechs[mechId];
      const frame = data.frames[mech.frameId];
      const pilot = side.pilots[pilotId];
      const score = (frame?.speed ?? 0) + pilot.aptitudes.evasion / 10;
      scored.push({ side: side.key, mechId, pilotId, score });
    }
  }
  rng.shuffle(scored);
  scored.sort((a, b) => b.score - a.score);
  const order: Action[] = scored.map(({ side, mechId, pilotId }) => ({ side, mechId, pilotId }));

  if (round === 1) {
    for (const side of [sideA, sideB]) {
      for (const mechId of side.tdDoubleTimeMechIds) {
        if (!isAlive(side, mechId)) continue;
        const pilotId = pilotIdForMech(side, mechId);
        if (pilotId) order.push({ side: side.key, mechId, pilotId });
      }
    }
    for (const side of [sideA, sideB]) {
      if (side.firstOnesMineMechId && isAlive(side, side.firstOnesMineMechId)) {
        const idx = order.findIndex((o) => o.side === side.key && o.mechId === side.firstOnesMineMechId);
        if (idx > 0) {
          const [item] = order.splice(idx, 1);
          order.unshift(item);
        }
      }
    }
  }
  return order;
}

function resolveCrossFire(side: SideRuntime, opp: SideRuntime, ctx: BattleContext, data: GameData, rng: Rng, events: BattleEvent[], aceAtStart: AceSnapshot): void {
  for (const pair of side.tdCrossFire) {
    const mechA = mechIdForPilot(side, pair.aPilotId);
    const mechB = mechIdForPilot(side, pair.bPilotId);
    if (!mechA || !mechB || !isAlive(side, mechA) || !isAlive(side, mechB)) continue;
    const wA = pickAnyOffensiveWeapon(side.mechs[mechA], data);
    const wB = pickAnyOffensiveWeapon(side.mechs[mechB], data);
    const primary = wA ?? wB;
    if (!primary) continue;
    const extra = wA && wB ? (primary === wA ? wB.damage : wA.damage) : 0;
    fireWeapon(
      side,
      opp,
      primary === wA ? mechA : mechB,
      primary === wA ? pair.aPilotId : pair.bPilotId,
      primary,
      ctx,
      data,
      rng,
      events,
      1,
      { guaranteedHit: true, extraDamageFlat: extra, tandemCalloutId: pair.calloutId, followUp: true, rowMultOverride: 1 },
      aceAtStart
    );
  }
}

function checkAnnihilation(sideA: SideRuntime, sideB: SideRuntime): { winner: 'A' | 'B' | 'draw'; reason: 'annihilation' } | null {
  const aDead = sideAllDead(sideA);
  const bDead = sideAllDead(sideB);
  if (aDead && bDead) return { winner: 'draw', reason: 'annihilation' };
  if (aDead) return { winner: 'B', reason: 'annihilation' };
  if (bDead) return { winner: 'A', reason: 'annihilation' };
  return null;
}

function checkRout(side: SideRuntime, other: SideRuntime, events: BattleEvent[]): { winner: 'A' | 'B' | 'draw'; reason: 'rout' } | null {
  if (side.weHold) return null;
  if (sideAllDead(side)) return null; // annihilation already covers this
  if (side.squad.morale < RULES.MORALE_ROUT_THRESHOLD) {
    events.push({ t: 'rout', side: side.key, reason: 'morale' });
    return { winner: other.key, reason: 'rout' };
  }
  return null;
}

function decideByRounds(sideA: SideRuntime, sideB: SideRuntime, data: GameData): { winner: 'A' | 'B' | 'draw'; reason: 'rounds' } {
  const fracOf = (side: SideRuntime): number => {
    let hp = 0;
    let maxHp = 0;
    for (const mech of Object.values(side.mechs)) {
      const frame = data.frames[mech.frameId];
      const mMax = frame ? Math.max(1, frame.hp - mech.maxHpPenalty) : Math.max(1, mech.hp);
      hp += Math.max(0, mech.hp);
      maxHp += mMax;
    }
    return maxHp > 0 ? hp / maxHp : 0;
  };
  const fracA = fracOf(sideA);
  const fracB = fracOf(sideB);
  if (Math.abs(fracA - fracB) <= 0.05) return { winner: 'draw', reason: 'rounds' };
  return { winner: fracA > fracB ? 'A' : 'B', reason: 'rounds' };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolves one battle deterministically from ctx.seed. Pure: sideA/sideB are
 * deep-copied before any mutation, and the copies (post-battle) are returned
 * as result.sideA/sideB. Never call with the same object twice expecting
 * shared state — nothing here reads outside its parameters.
 */
export function resolveBattle(sideA: BattleSide, sideB: BattleSide, ctx: BattleContext, data: GameData): BattleResult {
  const rng = new Rng(ctx.seed);
  const rounds = ctx.rounds ?? RULES.ROUNDS;

  const runA = buildSideRuntime('A', sideA, ctx, data);
  const runB = buildSideRuntime('B', sideB, ctx, data);

  const events: BattleEvent[] = [];
  events.push({ t: 'start', sideA: runA.squad.id, sideB: runB.squad.id, terrain: ctx.terrain, weather: ctx.weather, mapKind: ctx.mapKind });

  processPrebattleCallouts(runA, ctx.calloutsA, data, events);
  processPrebattleCallouts(runB, ctx.calloutsB, data, events);
  processTandemCallouts(runA, ctx.calloutsA, data, events);
  processTandemCallouts(runB, ctx.calloutsB, data, events);

  const aceAtStart: AceSnapshot = {
    A: Object.fromEntries(Object.values(runA.pilots).map((p) => [p.id, p.ace])),
    B: Object.fromEntries(Object.values(runB.pilots).map((p) => [p.id, p.ace])),
  };

  let ended: { winner: 'A' | 'B' | 'draw'; reason: 'annihilation' | 'rout' | 'rounds' } | null = null;
  let lastRound = 0;

  roundLoop: for (let round = 1; round <= rounds; round++) {
    lastRound = round;
    events.push({ t: 'round', n: round });

    if (round === 1) {
      resolveCrossFire(runA, runB, ctx, data, rng, events, aceAtStart);
      ended = checkAnnihilation(runA, runB);
      if (ended) break roundLoop;
      resolveCrossFire(runB, runA, ctx, data, rng, events, aceAtStart);
      ended = checkAnnihilation(runA, runB);
      if (ended) break roundLoop;
    }

    const order = buildInitiativeOrder(runA, runB, round, data, rng);
    for (const action of order) {
      const side = action.side === 'A' ? runA : runB;
      const opp = action.side === 'A' ? runB : runA;
      if (!isAlive(side, action.mechId)) continue;
      const weapon = pickUsableWeapon(side, action.mechId, data);
      if (!weapon) continue;
      if (weapon.kind === 'support') {
        performRepair(side, action.mechId, action.pilotId, weapon, data, events);
      } else {
        fireWeapon(side, opp, action.mechId, action.pilotId, weapon, ctx, data, rng, events, round, {}, aceAtStart);
      }
      ended = checkAnnihilation(runA, runB);
      if (ended) break;
    }
    if (ended) break roundLoop;

    applyRepairDrones(runA, data, events);
    applyRepairDrones(runB, data, events);

    if (round === 1) {
      applyTdSwitch(runA);
      applyTdSwitch(runB);
    }

    ended = checkRout(runA, runB, events) ?? checkRout(runB, runA, events);
    if (ended) break roundLoop;
  }

  if (!ended) ended = decideByRounds(runA, runB, data);

  // "We hold." survivors: permanent personal morale bump.
  for (const side of [runA, runB]) {
    if (!side.weHold) continue;
    for (const mechId of livingMechIds(side)) {
      const pilotId = pilotIdForMech(side, mechId);
      if (!pilotId) continue;
      const pilot = side.pilots[pilotId];
      pilot.morale = Math.min(100, pilot.morale + 10);
    }
  }

  // Systems growth (side A only): once per battle, for pilots who used a
  // support weapon or whose mech carries a system.
  for (const mechId of Object.keys(runA.mechs)) {
    const pilotId = pilotIdForMech(runA, mechId);
    if (!pilotId) continue;
    const mech = runA.mechs[mechId];
    if (runA.supportOrSystemUsed.has(pilotId) || mech.system || mech.system2) {
      addGrowth(runA, pilotId, 'systems', 1);
    }
  }
  if (runA.squad.leaderPilotId) addGrowth(runA, runA.squad.leaderPilotId, 'command', 2);

  for (const pilot of Object.values(runA.pilots)) pilot.battles += 1;
  for (const pilot of Object.values(runB.pilots)) pilot.battles += 1;

  events.push({ t: 'end', winner: ended.winner, reason: ended.reason });

  const salvage = computeSalvage(ended.winner, runA, runB, lastRound, rng);

  const result: BattleResult = {
    seed: ctx.seed,
    winner: ended.winner,
    events,
    sideA: { squad: runA.squad, pilots: runA.pilots, mechs: runA.mechs },
    sideB: { squad: runB.squad, pilots: runB.pilots, mechs: runB.mechs },
    pilotDeaths: [...runA.pilotDeaths, ...runB.pilotDeaths],
    mechsLost: [...runA.mechsLost, ...runB.mechsLost],
    salvage,
    growth: runA.growth as Record<Id, Partial<Record<Aptitude, number>>>,
    killsByPilot: { ...runA.killsByPilot, ...runB.killsByPilot },
  };
  return result;
}

function computeSalvage(winner: 'A' | 'B' | 'draw', runA: SideRuntime, runB: SideRuntime, roundsElapsed: number, rng: Rng): SalvageDrop {
  const empty: SalvageDrop = { weapons: [], systems: [], frames: [], scrap: 0 };
  if (winner === 'draw') return empty;
  const loser = winner === 'A' ? runB : runA;
  const destroyed = loser.mechsLost.map((m) => loser.mechs[m.mechId]).filter((m): m is Mech => !!m);
  const weapons: Id[] = [];
  const systems: Id[] = [];
  const frames: Id[] = [];
  for (const mech of destroyed) {
    if (mech.weaponA && rng.chance(0.5)) weapons.push(mech.weaponA);
    if (mech.weaponB && rng.chance(0.5)) weapons.push(mech.weaponB);
    if (mech.system && rng.chance(0.35)) systems.push(mech.system);
    if (mech.system2 && rng.chance(0.35)) systems.push(mech.system2);
    if (rng.chance(0.08)) frames.push(mech.frameId);
  }
  const scrap = 20 * destroyed.length + 5 * roundsElapsed;
  return { weapons, systems, frames, scrap };
}
