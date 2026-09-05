/**
 * CORDON — battle constants & pure formulas.
 *
 * Every number a designer might want to tune during the M4 balance pass
 * lives here, not scattered through battle.ts. Nothing in this file touches
 * randomness or mutates its inputs.
 */
import type {
  GameData,
  Mech,
  MapKind,
  Mobility,
  Pilot,
  Terrain,
  WeaponKind,
  Weather,
} from './types';

export const RULES = {
  /** Fixed number of exchange rounds per battle. */
  ROUNDS: 6,
  /** Formation grid size (front 3 + back 3). */
  SQUAD_SLOTS: 6,
  /** Back row takes x0.6 damage while any front-row ally lives. */
  ROW_DEFENSE_BONUS: 0.6,
  /** Crits ignore armor and multiply raw damage by this. */
  CRIT_MULT: 1.5,
  /** Kill count at which a pilot becomes an Ace. */
  ACE_KILLS: 8,
  /** A squad routs at round-end once its morale falls below this. */
  MORALE_ROUT_THRESHOLD: 20,
  /** Base chance a pilot ejects safely when their mech is destroyed. */
  BASE_EJECT_CHANCE: 0.55,
  /** Evasion penalty applied per 10 percentage points a mech's power draw
   *  exceeds its frame's generator output. */
  OVERWEIGHT_EVASION_PENALTY: 5,
  /** Marked squads (lt_marking_them / map 'marked' effect) take +30% damage. */
  MARKED_DAMAGE_MULT: 1.3,
  /** "Redline it." damage bonus for the caster's mech this battle. */
  REDLINE_DAMAGE_MULT: 1.6,
  /** "Redline it." permanent max-HP cost, as a fraction of frame max HP. */
  REDLINE_MAXHP_PENALTY_FRACTION: 0.15,
  /** Eject-chance contribution per point of pilot Evasion aptitude. */
  EJECT_EVASION_APTITUDE_FACTOR: 0.002,
  /** Gunnery/melee aptitude contribution to hit chance, per point. */
  APTITUDE_ACCURACY_FACTOR: 0.3,
  /** Defender evasion's contribution to reducing hit chance, per point. */
  EVASION_DEFENSE_FACTOR: 0.5,
  /** Clamp bounds for final hit chance (percent, 0..100). */
  HIT_CHANCE_MIN: 5,
  HIT_CHANCE_MAX: 95,
} as const;

/**
 * Terrain effects on the mech occupying it. Deltas, not multipliers, except
 * `damage` which is a percent delta applied multiplicatively (5 == +5%).
 * Ground frames read terrain the way GDD §5 describes ("ground frames get
 * terrain bonuses"); space frames read space terrain the same way. A frame
 * fighting on its "wrong" map already eats `mobilityPenalty` below, so this
 * function only rewards the frame that fits the map, and only when the
 * terrain historically favors that mobility per GDD.
 */
export function terrainModifiers(
  terrain: Terrain,
  mapKind: MapKind,
  mobility: Mobility
): { accuracy: number; evasion: number; damage: number; speedMult: number } {
  const none = { accuracy: 0, evasion: 0, damage: 0, speedMult: 1 };
  if (mapKind === 'surface') {
    const groundOrAero = mobility === 'ground' || mobility === 'aerospace';
    switch (terrain) {
      case 'forest':
        return groundOrAero ? { accuracy: -5, evasion: 15, damage: 0, speedMult: 0.9 } : { ...none, accuracy: -5 };
      case 'urban':
        return groundOrAero ? { accuracy: 5, evasion: 10, damage: 0, speedMult: 0.9 } : none;
      case 'mountain':
        return groundOrAero
          ? { accuracy: 0, evasion: 10, damage: 0, speedMult: 0.7 }
          : { accuracy: -5, evasion: -5, damage: 0, speedMult: 0.7 };
      case 'water':
        return groundOrAero ? { accuracy: 0, evasion: -10, damage: 0, speedMult: 0.6 } : none;
      case 'open':
      case 'blocked':
      default:
        return none;
    }
  }
  // space map
  const spaceOrAero = mobility === 'space' || mobility === 'aerospace';
  switch (terrain) {
    case 'debris':
      return spaceOrAero ? { accuracy: -5, evasion: 15, damage: 0, speedMult: 0.9 } : { ...none, accuracy: -5 };
    case 'radiation':
      return { accuracy: 0, evasion: 0, damage: 5, speedMult: 1 };
    case 'gravity':
      return spaceOrAero
        ? { accuracy: 0, evasion: 0, damage: 0, speedMult: 0.8 }
        : { accuracy: -5, evasion: -10, damage: 0, speedMult: 0.6 };
    case 'structure':
      return spaceOrAero ? { accuracy: 5, evasion: 10, damage: 0, speedMult: 0.9 } : none;
    case 'void':
    case 'blocked':
    default:
      return none;
  }
}

/** Weather effects. Storms and rain hurt ranged accuracy more than melee. */
export function weatherModifiers(weather: Weather, kind: WeaponKind): { accuracy: number; damage: number } {
  const rangedHit = kind === 'ranged' || kind === 'support';
  switch (weather) {
    case 'rain':
      return { accuracy: rangedHit ? -10 : -2, damage: 0 };
    case 'storm':
      return { accuracy: rangedHit ? -20 : -5, damage: rangedHit ? -5 : 0 };
    case 'dust':
      return { accuracy: -10, damage: 0 };
    case 'solar_flare':
      return { accuracy: rangedHit ? -15 : 0, damage: 0 };
    case 'clear':
    case 'none':
    default:
      return { accuracy: 0, damage: 0 };
  }
}

/**
 * Mobility/map mismatch penalty, per GDD §5: space frames are sluggish on
 * the ground, ground frames are sluggish in orbit, aerospace does both.
 */
export function mobilityPenalty(mobility: Mobility, mapKind: MapKind): { evasion: number; speedMult: number; accuracy: number } {
  if (mobility === 'aerospace') return { evasion: 0, speedMult: 1, accuracy: 0 };
  if (mobility === 'space' && mapKind === 'surface') return { evasion: -15, speedMult: 0.7, accuracy: -10 };
  if (mobility === 'ground' && mapKind === 'space') return { evasion: -20, speedMult: 0.6, accuracy: -5 };
  return { evasion: 0, speedMult: 1, accuracy: 0 };
}

/** Total weight/power draw of a mech's fitted slots vs. its frame's budget. */
export function mechLoad(mech: Mech, data: GameData): { weight: number; power: number; generator: number; overPower: boolean; loadRatio: number } {
  const frame = data.frames[mech.frameId];
  if (!frame) return { weight: 0, power: 0, generator: 1, overPower: false, loadRatio: 0 };
  let weight = frame.weight;
  let power = 0;
  const weaponA = mech.weaponA ? data.weapons[mech.weaponA] : null;
  const weaponB = mech.weaponB ? data.weapons[mech.weaponB] : null;
  const system = mech.system ? data.systems[mech.system] : null;
  const system2 = mech.system2 ? data.systems[mech.system2] : null;
  for (const part of [weaponA, weaponB, system, system2]) {
    if (!part) continue;
    weight += part.weight;
    power += part.power;
  }
  const generator = frame.generator || 1;
  const loadRatio = power / generator;
  return { weight, power, generator, overPower: power > generator, loadRatio };
}

/** Evasion penalty for exceeding generator budget: OVERWEIGHT_EVASION_PENALTY per 10% over. */
export function overweightEvasionPenalty(load: { power: number; generator: number }): number {
  const overPct = Math.max(0, ((load.power - load.generator) / load.generator) * 100);
  const steps = Math.floor(overPct / 10);
  return steps * RULES.OVERWEIGHT_EVASION_PENALTY;
}

/**
 * Aggregate battle-relevant stats for one mech+pilot, before any per-attack
 * weapon-kind weather modifier (that's applied separately in battle.ts,
 * since a mech can carry two weapons of different kinds).
 */
export function effectiveStats(
  pilot: Pilot,
  mech: Mech,
  data: GameData,
  ctx: { terrain: Terrain; mapKind: MapKind; weather: Weather }
): { hp: number; maxHp: number; armor: number; evasion: number; accuracyBonus: number; damageMult: number } {
  const frame = data.frames[mech.frameId];
  if (!frame) {
    return { hp: mech.hp, maxHp: mech.hp, armor: 0, evasion: 0, accuracyBonus: 0, damageMult: 1 };
  }
  const load = mechLoad(mech, data);
  const terrainMod = terrainModifiers(ctx.terrain, ctx.mapKind, frame.mobility);
  const mobMod = mobilityPenalty(frame.mobility, ctx.mapKind);
  const overPenalty = overweightEvasionPenalty(load);

  let armor = frame.armor;
  let accuracyBonus = terrainMod.accuracy + mobMod.accuracy;
  let evasion = frame.evasion + terrainMod.evasion + mobMod.evasion - overPenalty;
  // Pilot Evasion aptitude contributes modestly to base dodge.
  evasion += pilot.aptitudes.evasion * 0.2;

  const systemIds = [mech.system, mech.system2].filter((s): s is string => !!s);
  for (const sid of systemIds) {
    const sys = data.systems[sid];
    if (!sys) continue;
    if (sys.effect === 'armor_plate') armor += sys.value;
    if (sys.effect === 'targeting') accuracyBonus += sys.value;
    if (sys.effect === 'booster') evasion += sys.value;
  }

  const maxHp = Math.max(1, Math.round(frame.hp - mech.maxHpPenalty));
  const damageMult = 1 + terrainMod.damage / 100;

  return { hp: mech.hp, maxHp, armor, evasion, accuracyBonus, damageMult };
}
