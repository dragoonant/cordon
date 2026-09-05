/**
 * Minimal, self-contained GameData + BattleSide builders for battle-sim tests.
 * Not shipped data — src/data/* is owned by another workstream. This fixture
 * exists purely so rules/battle/forecast tests don't depend on real content.
 */
import type {
  BattleSide,
  Certification,
  CertificationDef,
  Faction,
  FrameDef,
  GameData,
  Id,
  Mech,
  Pilot,
  PilotDef,
  PilotLines,
  Squad,
  SlotAssignment,
  SlotIndex,
  SystemDef,
  WeaponDef,
} from '../types';

// ---------------------------------------------------------------------------
// Frames — one per weight class, one per mobility.
// ---------------------------------------------------------------------------

const frameSkirmish: FrameDef = {
  id: 'frame_skirmish',
  name: 'Skirmish',
  faction: 'relay',
  weightClass: 'light',
  mobility: 'space',
  hp: 80,
  armor: 3,
  evasion: 25,
  speed: 6,
  generator: 40,
  weight: 20,
  spriteKey: 'skirmish',
  description: 'Light space-rated frame.',
  silhouette: 'skirmish',
  unlockedByDefault: true,
};

const frameLine: FrameDef = {
  id: 'frame_line',
  name: 'Line',
  faction: 'relay',
  weightClass: 'medium',
  mobility: 'ground',
  hp: 120,
  armor: 6,
  evasion: 15,
  speed: 4,
  generator: 55,
  weight: 35,
  spriteKey: 'line',
  description: 'Medium ground-rated backbone frame.',
  silhouette: 'line',
  unlockedByDefault: true,
};

const frameBastion: FrameDef = {
  id: 'frame_bastion',
  name: 'Bastion',
  faction: 'relay',
  weightClass: 'heavy',
  mobility: 'aerospace',
  hp: 180,
  armor: 10,
  evasion: 8,
  speed: 3,
  generator: 70,
  weight: 55,
  spriteKey: 'bastion',
  description: 'Heavy aerospace-rated frame.',
  silhouette: 'bastion',
  unlockedByDefault: true,
};

// ---------------------------------------------------------------------------
// Weapons — melee front-only, ranged either-row, ranged back-only, ranged
// multi-hit any-row, and one support (repair).
// ---------------------------------------------------------------------------

const weaponLance: WeaponDef = {
  id: 'weapon_lance',
  name: 'Lance',
  faction: 'relay',
  kind: 'melee',
  damage: 22,
  hits: 1,
  accuracy: 75,
  crit: 12,
  frontMult: 1.4,
  backMult: 0,
  weight: 10,
  power: 8,
  tags: [],
  animKey: 'lance_thrust',
  unlockedByDefault: true,
};

const weaponRifle: WeaponDef = {
  id: 'weapon_rifle',
  name: 'Assault Rifle',
  faction: 'relay',
  kind: 'ranged',
  damage: 14,
  hits: 1,
  accuracy: 80,
  crit: 10,
  frontMult: 1,
  backMult: 1,
  weight: 8,
  power: 6,
  tags: [],
  animKey: 'rifle_burst',
  unlockedByDefault: true,
};

const weaponRailgun: WeaponDef = {
  id: 'weapon_railgun',
  name: 'Railgun',
  faction: 'relay',
  kind: 'ranged',
  damage: 26,
  hits: 1,
  accuracy: 70,
  crit: 15,
  frontMult: 0,
  backMult: 1.3,
  weight: 14,
  power: 12,
  tags: ['precise'],
  animKey: 'railgun_charge',
  unlockedByDefault: true,
};

const weaponVulcans: WeaponDef = {
  id: 'weapon_vulcans',
  name: 'Vulcans',
  faction: 'relay',
  kind: 'ranged',
  damage: 6,
  hits: 3,
  accuracy: 85,
  crit: 5,
  frontMult: 0.9,
  backMult: 0.9,
  weight: 6,
  power: 5,
  tags: [],
  animKey: 'vulcan_spray',
  unlockedByDefault: true,
};

const weaponRepairKit: WeaponDef = {
  id: 'weapon_repair_kit',
  name: 'Field Repair Kit',
  faction: 'relay',
  kind: 'support',
  damage: 0,
  hits: 0,
  accuracy: 100,
  crit: 0,
  frontMult: 1,
  backMult: 1,
  weight: 8,
  power: 6,
  repair: 18,
  tags: [],
  animKey: 'repair_beam',
  unlockedByDefault: true,
};

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

const systemShield: SystemDef = {
  id: 'system_shield',
  name: 'Shield Generator',
  faction: 'relay',
  effect: 'shield',
  value: 30,
  weight: 10,
  power: 8,
  description: 'Absorbs the first 30 damage taken this battle.',
  unlockedByDefault: true,
};

const systemRepairDrone: SystemDef = {
  id: 'system_repair_drone',
  name: 'Repair Drone Bay',
  faction: 'relay',
  effect: 'repair_drone',
  value: 8,
  weight: 8,
  power: 6,
  description: 'Heals 8 HP to self each round.',
  unlockedByDefault: true,
};

const systemEject: SystemDef = {
  id: 'system_eject',
  name: 'Ejection Assist',
  faction: 'relay',
  effect: 'eject',
  value: 0.25,
  weight: 4,
  power: 3,
  description: '+25% pilot survival chance if the mech is destroyed.',
  unlockedByDefault: true,
};

const systemTargeting: SystemDef = {
  id: 'system_targeting',
  name: 'Targeting Computer',
  faction: 'relay',
  effect: 'targeting',
  value: 10,
  weight: 6,
  power: 5,
  description: '+10 accuracy, +10 crit.',
  unlockedByDefault: true,
};

// ---------------------------------------------------------------------------
// Callouts — every prebattle effect, every tandem effect, all 8 last
// transmissions.
// ---------------------------------------------------------------------------

function callout(id: Id, kind: 'prebattle' | 'tandem' | 'last', effect: any, extra: Partial<import('../types').CalloutDef> = {}): import('../types').CalloutDef {
  return {
    id,
    effect,
    kind,
    line: `[${id}]`,
    label: id,
    description: id,
    tradeoff: 'none',
    nerveCost: kind === 'last' ? 0 : 2,
    ...extra,
  };
}

const co_eyes_on = callout('co_eyes_on', 'prebattle', 'eyes_on');
const co_break_formation = callout('co_break_formation', 'prebattle', 'break_formation');
const co_redline = callout('co_redline', 'prebattle', 'redline');
const co_on_me = callout('co_on_me', 'prebattle', 'on_me', { needsAllyTarget: true });
const co_punch_out = callout('co_punch_out', 'prebattle', 'punch_out');
const co_first_ones_mine = callout('co_first_ones_mine', 'prebattle', 'first_ones_mine');
const co_chain_it = callout('co_chain_it', 'prebattle', 'chain_it');
const co_sell_it = callout('co_sell_it', 'prebattle', 'sell_it');
const co_we_hold = callout('co_we_hold', 'prebattle', 'we_hold');

const co_td_cross_fire = callout('co_td_cross_fire', 'tandem', 'td_cross_fire');
const co_td_switch = callout('co_td_switch', 'tandem', 'td_switch');
const co_td_got_your_six = callout('co_td_got_your_six', 'tandem', 'td_got_your_six');
const co_td_double_time = callout('co_td_double_time', 'tandem', 'td_double_time');

const lt_dont_stop = callout('lt_dont_stop', 'last', 'lt_dont_stop');
const lt_marking_them = callout('lt_marking_them', 'last', 'lt_marking_them');
const lt_take_the_frame = callout('lt_take_the_frame', 'last', 'lt_take_the_frame');
const lt_got_the_shot = callout('lt_got_the_shot', 'last', 'lt_got_the_shot');
const lt_hold_them_here = callout('lt_hold_them_here', 'last', 'lt_hold_them_here');
const lt_tell_them = callout('lt_tell_them', 'last', 'lt_tell_them');
const lt_light_it_up = callout('lt_light_it_up', 'last', 'lt_light_it_up');
const lt_go_home = callout('lt_go_home', 'last', 'lt_go_home');

// ---------------------------------------------------------------------------
// Pilots
// ---------------------------------------------------------------------------

function lines(name: string): PilotLines {
  return {
    deploy: [`${name}: deploying.`],
    attack: [`${name}: taking the shot!`],
    crit: [`${name}: right on target!`],
    kill: [`${name}: splashed!`],
    hit: [`${name}: took a hit.`],
    allyDown: [`${name}: no!`],
    victory: [`${name}: that's a win.`],
    retreat: [`${name}: falling back.`],
    finisher: `${name}: this ends it!`,
    finisherName: `${name} Special`,
  };
}

const baseAptitudes = { gunnery: 40, melee: 40, evasion: 40, systems: 40, command: 40 };
const baseGrowth = { gunnery: 1, melee: 1, evasion: 1, systems: 1, command: 1 };

const pilotAce: PilotDef = {
  id: 'pilot_ace',
  name: 'Vega Ashworth',
  callsign: 'Ace',
  archetype: 'veteran',
  faction: 'relay',
  baseAptitudes: { ...baseAptitudes, command: 60 },
  growth: baseGrowth,
  startingCerts: [],
  startingCallouts: ['co_eyes_on', 'co_first_ones_mine'],
  lastTransmissionId: 'lt_got_the_shot',
  maxNerve: 100,
  portraitKey: 'pilot_ace',
  voiceKey: 'pilot_ace',
  bio: 'Fixture veteran pilot.',
  lines: lines('Ace'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_hotshot', tandemCalloutId: 'co_td_cross_fire', threshold: 0 }, { pilotId: 'pilot_marksman', tandemCalloutId: 'co_td_double_time', threshold: 0 }],
};

const pilotHotshot: PilotDef = {
  id: 'pilot_hotshot',
  name: 'Ky Renner',
  callsign: 'Hotshot',
  archetype: 'hotshot',
  faction: 'relay',
  baseAptitudes: { ...baseAptitudes, melee: 55 },
  growth: baseGrowth,
  startingCerts: [],
  startingCallouts: ['co_redline', 'co_chain_it'],
  lastTransmissionId: 'lt_marking_them',
  maxNerve: 100,
  portraitKey: 'pilot_hotshot',
  voiceKey: 'pilot_hotshot',
  bio: 'Fixture hotshot pilot.',
  lines: lines('Hotshot'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_ace', tandemCalloutId: 'co_td_cross_fire', threshold: 0 }, { pilotId: 'pilot_rookie', tandemCalloutId: 'co_td_got_your_six', threshold: 0 }],
};

const pilotMarksman: PilotDef = {
  id: 'pilot_marksman',
  name: 'Iris Voss',
  callsign: 'Marksman',
  archetype: 'marksman',
  faction: 'relay',
  baseAptitudes: { ...baseAptitudes, gunnery: 55, systems: 60 },
  growth: baseGrowth,
  startingCerts: [],
  startingCallouts: ['co_on_me', 'co_sell_it', 'co_break_formation'],
  lastTransmissionId: 'lt_take_the_frame',
  maxNerve: 100,
  portraitKey: 'pilot_marksman',
  voiceKey: 'pilot_marksman',
  bio: 'Fixture marksman pilot.',
  lines: lines('Marksman'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_rookie', tandemCalloutId: 'co_td_switch', threshold: 0 }, { pilotId: 'pilot_ace', tandemCalloutId: 'co_td_double_time', threshold: 0 }],
};

const pilotRookie: PilotDef = {
  id: 'pilot_rookie',
  name: 'Dane Ochi',
  callsign: 'Rookie',
  archetype: 'rookie',
  faction: 'relay',
  baseAptitudes: { ...baseAptitudes, gunnery: 20, melee: 20, evasion: 25 },
  growth: { gunnery: 2, melee: 2, evasion: 2, systems: 1.5, command: 1 },
  startingCerts: [],
  startingCallouts: ['co_punch_out', 'co_we_hold'],
  lastTransmissionId: 'lt_go_home',
  maxNerve: 100,
  portraitKey: 'pilot_rookie',
  voiceKey: 'pilot_rookie',
  bio: 'Fixture rookie pilot.',
  lines: lines('Rookie'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_marksman', tandemCalloutId: 'co_td_switch', threshold: 0 }, { pilotId: 'pilot_hotshot', tandemCalloutId: 'co_td_got_your_six', threshold: 0 }],
};

// Compact-side pilot, for building an "enemy" side without reusing relay ids.
const pilotGrunt: PilotDef = {
  id: 'pilot_grunt',
  name: 'Compact Grunt',
  callsign: 'Grunt',
  archetype: 'compact_grunt',
  faction: 'compact',
  baseAptitudes: baseAptitudes,
  growth: baseGrowth,
  startingCerts: [],
  startingCallouts: [],
  lastTransmissionId: 'lt_go_home',
  maxNerve: 100,
  portraitKey: 'pilot_grunt',
  voiceKey: 'pilot_grunt',
  bio: 'Fixture compact grunt.',
  lines: lines('Grunt'),
  unlockedByDefault: true,
  bondPartners: [],
};

// ---------------------------------------------------------------------------
// Certs (stub — full Record<Certification, CertificationDef> required by type)
// ---------------------------------------------------------------------------

function certStub(id: Certification): CertificationDef {
  return { id, name: id, description: id, requires: {}, requiresCerts: [], grantsCallouts: [] };
}

const CERT_IDS: Certification[] = [
  'cert_light',
  'cert_medium',
  'cert_heavy',
  'cert_vanguard',
  'cert_marksman',
  'cert_field_tech',
  'cert_recon',
  'cert_wing_lead',
];

// ---------------------------------------------------------------------------
// Assembled GameData
// ---------------------------------------------------------------------------

export const FIXTURE_DATA: GameData = {
  frames: {
    [frameSkirmish.id]: frameSkirmish,
    [frameLine.id]: frameLine,
    [frameBastion.id]: frameBastion,
  },
  weapons: {
    [weaponLance.id]: weaponLance,
    [weaponRifle.id]: weaponRifle,
    [weaponRailgun.id]: weaponRailgun,
    [weaponVulcans.id]: weaponVulcans,
    [weaponRepairKit.id]: weaponRepairKit,
  },
  systems: {
    [systemShield.id]: systemShield,
    [systemRepairDrone.id]: systemRepairDrone,
    [systemEject.id]: systemEject,
    [systemTargeting.id]: systemTargeting,
  },
  pilots: {
    [pilotAce.id]: pilotAce,
    [pilotHotshot.id]: pilotHotshot,
    [pilotMarksman.id]: pilotMarksman,
    [pilotRookie.id]: pilotRookie,
    [pilotGrunt.id]: pilotGrunt,
  },
  callouts: {
    [co_eyes_on.id]: co_eyes_on,
    [co_break_formation.id]: co_break_formation,
    [co_redline.id]: co_redline,
    [co_on_me.id]: co_on_me,
    [co_punch_out.id]: co_punch_out,
    [co_first_ones_mine.id]: co_first_ones_mine,
    [co_chain_it.id]: co_chain_it,
    [co_sell_it.id]: co_sell_it,
    [co_we_hold.id]: co_we_hold,
    [co_td_cross_fire.id]: co_td_cross_fire,
    [co_td_switch.id]: co_td_switch,
    [co_td_got_your_six.id]: co_td_got_your_six,
    [co_td_double_time.id]: co_td_double_time,
    [lt_dont_stop.id]: lt_dont_stop,
    [lt_marking_them.id]: lt_marking_them,
    [lt_take_the_frame.id]: lt_take_the_frame,
    [lt_got_the_shot.id]: lt_got_the_shot,
    [lt_hold_them_here.id]: lt_hold_them_here,
    [lt_tell_them.id]: lt_tell_them,
    [lt_light_it_up.id]: lt_light_it_up,
    [lt_go_home.id]: lt_go_home,
  },
  certs: Object.fromEntries(CERT_IDS.map((id) => [id, certStub(id)])) as Record<Certification, CertificationDef>,
  maps: {},
  events: {},
  captainLines: {
    briefing: ['Captain: listen up.'],
    victory: ['Captain: good work out there.'],
    defeat: ['Captain: fall back, regroup.'],
    pilotLost: ['Captain: we lost one.'],
    objectiveFailed: ['Captain: objective failed.'],
    objectiveComplete: ['Captain: objective clear.'],
    rivalAppears: ['Captain: it is them again.'],
    runStart: ['Captain: Lantern, moving out.'],
    runWon: ['Captain: we made it through.'],
    runLost: ['Captain: the Lantern goes dark.'],
  },
};

// ---------------------------------------------------------------------------
// Side builder
// ---------------------------------------------------------------------------

export interface MechSpec {
  pilotId: Id;
  frameId: Id;
  weaponA?: Id | null;
  weaponB?: Id | null;
  system?: Id | null;
  system2?: Id | null;
  slot: SlotIndex;
  hp?: number;
  maxHpPenalty?: number;
  aptitudes?: Partial<Record<'gunnery' | 'melee' | 'evasion' | 'systems' | 'command', number>>;
}

export function makePilotInstance(def: PilotDef, overrides: Partial<Pilot> = {}): Pilot {
  return {
    id: def.id,
    aptitudes: { ...def.baseAptitudes },
    certs: [...def.startingCerts],
    callouts: [...def.startingCallouts],
    kills: 0,
    battles: 0,
    nerve: def.maxNerve,
    maxNerve: def.maxNerve,
    alive: true,
    injuredFor: 0,
    ace: false,
    bonds: {},
    morale: 70,
    ...overrides,
  };
}

export function makeMechInstance(id: Id, spec: MechSpec, data: GameData): Mech {
  const frame = data.frames[spec.frameId];
  const maxHpPenalty = spec.maxHpPenalty ?? 0;
  return {
    id,
    frameId: spec.frameId,
    weaponA: spec.weaponA ?? null,
    weaponB: spec.weaponB ?? null,
    system: spec.system ?? null,
    system2: spec.system2 ?? null,
    hp: spec.hp ?? Math.max(1, Math.round(frame.hp - maxHpPenalty)),
    maxHpPenalty,
    destroyed: false,
  };
}

/** Builds a full BattleSide from a list of mech/pilot specs. Pure. */
export function makeSide(
  data: GameData,
  squadId: Id,
  faction: Faction,
  specs: MechSpec[],
  opts: { morale?: number; leaderPilotId?: Id | null; name?: string } = {}
): BattleSide {
  const slots: (SlotAssignment | null)[] = [null, null, null, null, null, null];
  const pilots: Record<Id, Pilot> = {};
  const mechs: Record<Id, Mech> = {};
  for (const spec of specs) {
    const mechId = `mech_${spec.pilotId}`;
    const assignment: SlotAssignment = { pilotId: spec.pilotId, mechId };
    slots[spec.slot] = assignment;
    const def = data.pilots[spec.pilotId];
    const pilot = makePilotInstance(def);
    if (spec.aptitudes) Object.assign(pilot.aptitudes, spec.aptitudes);
    pilots[spec.pilotId] = pilot;
    mechs[mechId] = makeMechInstance(mechId, spec, data);
  }
  const squad: Squad = {
    id: squadId,
    name: opts.name ?? squadId,
    faction,
    leaderPilotId: opts.leaderPilotId ?? specs[0]?.pilotId ?? null,
    slots,
    pos: { x: 0, y: 0 },
    path: [],
    targetPos: null,
    fuel: 100,
    maxFuel: 100,
    morale: opts.morale ?? 70,
    state: 'engaged',
    engageCooldown: 0,
    effects: [],
  };
  return { squad, pilots, mechs };
}
