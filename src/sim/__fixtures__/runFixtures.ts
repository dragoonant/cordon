/**
 * CORDON — fixture GameData for run-sim tests (pilots.ts, hangar.ts, run.ts).
 *
 * Not shipped data. `src/data/*` is owned by a separate workstream; this
 * fixture exists so pilots/hangar/run tests don't depend on that content or
 * on its loader. Deliberately small but touches every shape run.ts consumes:
 * 4 frames (one of each requested silhouette/faction), 6 weapons, 4 systems,
 * a full 8-cert record, every CalloutEffect at least once, 8 relay pilots +
 * 1 rival + 2 compact grunts, 4 small maps, 3 distress events.
 */
import type {
  Aptitudes,
  CalloutDef,
  CalloutEffect,
  CalloutKind,
  Certification,
  CertificationDef,
  DistressEventDef,
  EnemyAi,
  EnemySquadSpawn,
  FrameDef,
  GameData,
  Id,
  MapDef,
  ObjectiveDef,
  PilotDef,
  PilotLines,
  SystemDef,
  Terrain,
  Unlocks,
  WeaponDef,
} from '../types';

// ---------------------------------------------------------------------------
// Frames (4): light ground relay, medium ground relay, light space relay,
// compact_ace heavy.
// ---------------------------------------------------------------------------

export const frameLightGround: FrameDef = {
  id: 'frame_light_ground_relay',
  name: 'Skirmish',
  faction: 'relay',
  weightClass: 'light',
  mobility: 'ground',
  hp: 80,
  armor: 4,
  evasion: 30,
  speed: 5,
  // Deliberately tight vs. the fixture's weapon/system power values (lance 8
  // + rifle 6 + shield 10 = 24 > 20) so hangar.test.ts has a real overload
  // case to exercise for `equip`'s generator-budget check.
  generator: 20,
  weight: 20,
  spriteKey: 'skirmish',
  description: 'Light ground-rated relay frame.',
  silhouette: 'skirmish',
  unlockedByDefault: true,
};

export const frameMediumGround: FrameDef = {
  id: 'frame_medium_ground_relay',
  name: 'Line',
  faction: 'relay',
  weightClass: 'medium',
  mobility: 'ground',
  hp: 120,
  armor: 8,
  evasion: 20,
  speed: 4,
  generator: 55,
  weight: 35,
  spriteKey: 'line',
  description: 'Medium ground-rated backbone frame.',
  silhouette: 'line',
  unlockedByDefault: true,
};

export const frameLightSpace: FrameDef = {
  id: 'frame_light_space_relay',
  name: 'Recon',
  faction: 'relay',
  weightClass: 'light',
  mobility: 'space',
  hp: 75,
  armor: 4,
  evasion: 32,
  speed: 6,
  generator: 42,
  weight: 18,
  spriteKey: 'recon',
  description: 'Light space-rated relay frame.',
  silhouette: 'recon',
  unlockedByDefault: true,
};

export const frameCompactAceHeavy: FrameDef = {
  id: 'frame_compact_ace_heavy',
  name: 'Dominant',
  faction: 'compact',
  weightClass: 'heavy',
  mobility: 'ground',
  hp: 160,
  armor: 12,
  evasion: 15,
  speed: 3,
  generator: 70,
  weight: 55,
  spriteKey: 'compact_ace',
  description: 'Salvage-only Compact ace frame.',
  silhouette: 'compact_ace',
  unlockedByDefault: false,
};

// ---------------------------------------------------------------------------
// Weapons (6)
// ---------------------------------------------------------------------------

export const weaponLance: WeaponDef = {
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

export const weaponRifle: WeaponDef = {
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

export const weaponRailgun: WeaponDef = {
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

export const weaponVulcan: WeaponDef = {
  id: 'weapon_vulcan',
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

export const weaponRepairPod: WeaponDef = {
  id: 'weapon_repair_pod',
  name: 'Repair Pod',
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
  unlockedByDefault: false,
};

export const weaponCompactBlade: WeaponDef = {
  id: 'weapon_compact_blade',
  name: 'Compact Blade',
  faction: 'compact',
  kind: 'melee',
  damage: 28,
  hits: 1,
  accuracy: 78,
  crit: 15,
  frontMult: 1.6,
  backMult: 0,
  weight: 12,
  power: 10,
  tags: [],
  animKey: 'blade_slash',
  unlockedByDefault: false,
};

// ---------------------------------------------------------------------------
// Systems (4)
// ---------------------------------------------------------------------------

export const systemShield: SystemDef = {
  id: 'system_shield',
  name: 'Shield Generator',
  faction: 'relay',
  effect: 'shield',
  value: 20,
  weight: 8,
  power: 10,
  description: 'Absorbs the first 20 damage taken this battle.',
  unlockedByDefault: true,
};

export const systemBooster: SystemDef = {
  id: 'system_booster',
  name: 'Booster',
  faction: 'relay',
  effect: 'booster',
  value: 15,
  weight: 6,
  power: 8,
  description: '+evasion, +map speed.',
  unlockedByDefault: true,
};

export const systemEcm: SystemDef = {
  id: 'system_ecm',
  name: 'ECM Jammer',
  faction: 'relay',
  effect: 'ecm',
  value: 10,
  weight: 7,
  power: 9,
  description: 'Enemy accuracy -10.',
  unlockedByDefault: false,
};

export const systemTargeting: SystemDef = {
  id: 'system_targeting',
  name: 'Targeting Computer',
  faction: 'relay',
  effect: 'targeting',
  value: 10,
  weight: 5,
  power: 6,
  description: '+accuracy, +crit.',
  unlockedByDefault: false,
};

// ---------------------------------------------------------------------------
// Certifications (8; full Record required by GameData)
// ---------------------------------------------------------------------------

function cert(
  id: Certification,
  requires: Partial<Aptitudes>,
  requiresCerts: Certification[],
  grantsCallouts: Id[]
): CertificationDef {
  return { id, name: id, description: `Certification: ${id}`, requires, requiresCerts, grantsCallouts };
}

export const certLight = cert('cert_light', {}, [], []);
export const certMedium = cert('cert_medium', { gunnery: 30 }, [], ['co_pre_break_formation']);
export const certHeavy = cert('cert_heavy', { melee: 55 }, ['cert_medium'], ['co_pre_redline']);
export const certVanguard = cert('cert_vanguard', { melee: 40 }, ['cert_light'], ['co_pre_on_me']);
export const certMarksman = cert('cert_marksman', { gunnery: 40 }, ['cert_light'], ['co_pre_first_ones_mine']);
export const certFieldTech = cert('cert_field_tech', { systems: 35 }, [], ['co_over_fall_back']);
export const certRecon = cert('cert_recon', { systems: 30 }, [], ['co_over_ping_sector']);
export const certWingLead = cert('cert_wing_lead', { command: 45 }, [], ['co_pre_we_hold']);

export const FIXTURE_CERTS: Record<Certification, CertificationDef> = {
  cert_light: certLight,
  cert_medium: certMedium,
  cert_heavy: certHeavy,
  cert_vanguard: certVanguard,
  cert_marksman: certMarksman,
  cert_field_tech: certFieldTech,
  cert_recon: certRecon,
  cert_wing_lead: certWingLead,
};

// ---------------------------------------------------------------------------
// Callouts — every CalloutEffect at least once (19 generic + 9 per-pilot
// last transmissions = 28 total).
// ---------------------------------------------------------------------------

function co(
  id: Id,
  kind: CalloutKind,
  effect: CalloutEffect,
  extra: Partial<CalloutDef> = {}
): CalloutDef {
  return {
    id,
    effect,
    kind,
    line: `[${id}]`,
    label: id,
    description: `Callout: ${id}`,
    tradeoff: 'A cost, in plain words.',
    nerveCost: kind === 'last' ? 0 : 2,
    ...extra,
  };
}

// prebattle (9)
export const coEyesOn = co('co_pre_eyes_on', 'prebattle', 'eyes_on');
export const coBreakFormation = co('co_pre_break_formation', 'prebattle', 'break_formation');
export const coRedline = co('co_pre_redline', 'prebattle', 'redline');
export const coOnMe = co('co_pre_on_me', 'prebattle', 'on_me', { needsAllyTarget: true });
export const coPunchOut = co('co_pre_punch_out', 'prebattle', 'punch_out');
export const coFirstOnesMine = co('co_pre_first_ones_mine', 'prebattle', 'first_ones_mine');
export const coChainIt = co('co_pre_chain_it', 'prebattle', 'chain_it');
export const coSellIt = co('co_pre_sell_it', 'prebattle', 'sell_it');
export const coWeHold = co('co_pre_we_hold', 'prebattle', 'we_hold');

// overworld (6)
export const coBurnHard = co('co_over_burn_hard', 'overworld', 'burn_hard', { duration: 30 });
export const coPingSector = co('co_over_ping_sector', 'overworld', 'ping_sector', { radius: 20, duration: 20 });
export const coRallyChannel = co('co_over_rally_channel', 'overworld', 'rally_channel', { radius: 10 });
export const coFallBack = co('co_over_fall_back', 'overworld', 'fall_back');
export const coComeGetSome = co('co_over_come_get_some', 'overworld', 'come_get_some', { radius: 12, duration: 20 });
export const coStayWithThem = co('co_over_stay_with_them', 'overworld', 'stay_with_them');

// tandem (4)
export const coTdCrossFire = co('co_td_cross_fire', 'tandem', 'td_cross_fire');
export const coTdSwitch = co('co_td_switch', 'tandem', 'td_switch');
export const coTdGotYourSix = co('co_td_got_your_six', 'tandem', 'td_got_your_six');
export const coTdDoubleTime = co('co_td_double_time', 'tandem', 'td_double_time');

// last transmissions (9 — one per relay pilot + rival; all 8 effects covered)
export const ltVeteran = co('co_last_veteran', 'last', 'lt_marking_them');
export const ltHotshot = co('co_last_hotshot', 'last', 'lt_dont_stop');
export const ltMarksman = co('co_last_marksman', 'last', 'lt_got_the_shot');
export const ltRookie = co('co_last_rookie', 'last', 'lt_tell_them');
export const ltEngineer = co('co_last_engineer', 'last', 'lt_take_the_frame');
export const ltScout = co('co_last_scout', 'last', 'lt_light_it_up');
export const ltSalvager = co('co_last_salvager', 'last', 'lt_go_home');
export const ltWildcard = co('co_last_wildcard', 'last', 'lt_hold_them_here');
export const ltRival = co('co_last_rival', 'last', 'lt_marking_them');

export const FIXTURE_CALLOUTS: Record<Id, CalloutDef> = Object.fromEntries(
  [
    coEyesOn,
    coBreakFormation,
    coRedline,
    coOnMe,
    coPunchOut,
    coFirstOnesMine,
    coChainIt,
    coSellIt,
    coWeHold,
    coBurnHard,
    coPingSector,
    coRallyChannel,
    coFallBack,
    coComeGetSome,
    coStayWithThem,
    coTdCrossFire,
    coTdSwitch,
    coTdGotYourSix,
    coTdDoubleTime,
    ltVeteran,
    ltHotshot,
    ltMarksman,
    ltRookie,
    ltEngineer,
    ltScout,
    ltSalvager,
    ltWildcard,
    ltRival,
  ].map((c) => [c.id, c])
);

// ---------------------------------------------------------------------------
// Pilots — 8 relay + 1 rival + 2 compact grunts
// ---------------------------------------------------------------------------

function pilotLines(name: string): PilotLines {
  return {
    deploy: [`${name}: deploying.`],
    attack: [`${name}: taking the shot!`],
    crit: [`${name}: right on target!`],
    kill: [`${name}: splashed!`],
    hit: [`${name}: took a hit.`],
    allyDown: [`${name}: no!`],
    victory: [`${name}: that's a win.`],
    retreat: [`${name}: falling back.`],
    rivalContact: [`${name}: it's them.`],
    finisher: `${name}: this ends it!`,
    finisherName: `${name} Special`,
  };
}

const apt = (gunnery: number, melee: number, evasion: number, systems: number, command: number): Aptitudes => ({
  gunnery,
  melee,
  evasion,
  systems,
  command,
});

const growthAll = (n: number): Aptitudes => apt(n, n, n, n, n);

export const pilotVeteran: PilotDef = {
  id: 'pilot_veteran',
  name: 'Sorin Kael',
  callsign: 'Veteran',
  archetype: 'veteran',
  faction: 'relay',
  baseAptitudes: apt(55, 60, 35, 40, 65),
  growth: growthAll(0.6),
  startingCerts: ['cert_light', 'cert_medium', 'cert_heavy'],
  startingCallouts: ['co_pre_we_hold'],
  lastTransmissionId: 'co_last_veteran',
  maxNerve: 100,
  portraitKey: 'pilot_veteran',
  voiceKey: 'pilot_veteran',
  bio: 'Was Compact once. Knows the rival.',
  lines: pilotLines('Veteran'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_hotshot', tandemCalloutId: 'co_td_cross_fire', threshold: 20 }],
};

export const pilotHotshot: PilotDef = {
  id: 'pilot_hotshot',
  name: 'Ky Renner',
  callsign: 'Hotshot',
  archetype: 'hotshot',
  faction: 'relay',
  baseAptitudes: apt(45, 65, 50, 20, 25),
  growth: growthAll(1.0),
  startingCerts: ['cert_light', 'cert_medium'],
  startingCallouts: ['co_pre_redline'],
  lastTransmissionId: 'co_last_hotshot',
  maxNerve: 100,
  portraitKey: 'pilot_hotshot',
  voiceKey: 'pilot_hotshot',
  bio: 'Redlines everything. Will die first if you let them.',
  lines: pilotLines('Hotshot'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_veteran', tandemCalloutId: 'co_td_cross_fire', threshold: 20 }],
};

export const pilotMarksman: PilotDef = {
  id: 'pilot_marksman',
  name: 'Iris Voss',
  callsign: 'Marksman',
  archetype: 'marksman',
  faction: 'relay',
  baseAptitudes: apt(70, 15, 40, 55, 30),
  growth: growthAll(0.9),
  startingCerts: ['cert_light', 'cert_medium', 'cert_marksman'],
  startingCallouts: ['co_pre_eyes_on'],
  lastTransmissionId: 'co_last_marksman',
  maxNerve: 100,
  portraitKey: 'pilot_marksman',
  voiceKey: 'pilot_marksman',
  bio: 'Quiet. Highest Systems. "Eyes On" specialist.',
  lines: pilotLines('Marksman'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_rookie', tandemCalloutId: 'co_td_switch', threshold: 20 }],
};

export const pilotRookie: PilotDef = {
  id: 'pilot_rookie',
  name: 'Dane Ochi',
  callsign: 'Rookie',
  archetype: 'rookie',
  faction: 'relay',
  baseAptitudes: apt(25, 25, 30, 20, 15),
  growth: growthAll(1.6),
  startingCerts: ['cert_light'],
  startingCallouts: ['co_pre_punch_out'],
  lastTransmissionId: 'co_last_rookie',
  maxNerve: 100,
  portraitKey: 'pilot_rookie',
  voiceKey: 'pilot_rookie',
  bio: 'Lowest stats, fastest growth. Everyone protects them.',
  lines: pilotLines('Rookie'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_marksman', tandemCalloutId: 'co_td_switch', threshold: 20 }],
};

export const pilotEngineer: PilotDef = {
  id: 'pilot_engineer',
  name: 'Priya Anand',
  callsign: 'Engineer',
  archetype: 'engineer',
  faction: 'relay',
  baseAptitudes: apt(30, 20, 25, 65, 35),
  growth: growthAll(0.9),
  startingCerts: ['cert_light', 'cert_field_tech'],
  startingCallouts: ['co_over_rally_channel'],
  lastTransmissionId: 'co_last_engineer',
  maxNerve: 100,
  portraitKey: 'pilot_engineer',
  voiceKey: 'pilot_engineer',
  bio: 'Repairs mid-battle. Talks to the frames like they are people.',
  lines: pilotLines('Engineer'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_salvager', tandemCalloutId: 'co_td_got_your_six', threshold: 20 }],
};

export const pilotScout: PilotDef = {
  id: 'pilot_scout',
  name: 'Wren Talis',
  callsign: 'Scout',
  archetype: 'scout',
  faction: 'relay',
  baseAptitudes: apt(35, 20, 55, 60, 30),
  growth: growthAll(0.9),
  startingCerts: ['cert_light', 'cert_recon'],
  startingCallouts: ['co_over_ping_sector'],
  lastTransmissionId: 'co_last_scout',
  maxNerve: 100,
  portraitKey: 'pilot_scout',
  voiceKey: 'pilot_scout',
  bio: 'Overworld Callouts. Sees the map others do not.',
  lines: pilotLines('Scout'),
  unlockedByDefault: true,
  bondPartners: [{ pilotId: 'pilot_wildcard', tandemCalloutId: 'co_td_double_time', threshold: 20 }],
};

export const pilotSalvager: PilotDef = {
  id: 'pilot_salvager',
  name: 'Osei Marlow',
  callsign: 'Salvager',
  archetype: 'salvager',
  faction: 'relay',
  baseAptitudes: apt(40, 35, 35, 45, 30),
  growth: growthAll(1.0),
  startingCerts: ['cert_light'],
  startingCallouts: ['co_pre_sell_it'],
  lastTransmissionId: 'co_last_salvager',
  maxNerve: 100,
  portraitKey: 'pilot_salvager',
  voiceKey: 'pilot_salvager',
  bio: 'Civilian pilot from a lost colony. Fights for what is left.',
  lines: pilotLines('Salvager'),
  unlockedByDefault: false,
  bondPartners: [{ pilotId: 'pilot_engineer', tandemCalloutId: 'co_td_got_your_six', threshold: 20 }],
};

export const pilotWildcard: PilotDef = {
  id: 'pilot_wildcard',
  name: 'Zeke Halloran',
  callsign: 'Wildcard',
  archetype: 'wildcard',
  faction: 'relay',
  baseAptitudes: apt(50, 50, 50, 50, 40),
  growth: growthAll(1.0),
  startingCerts: ['cert_light'],
  startingCallouts: ['co_pre_chain_it'],
  lastTransmissionId: 'co_last_wildcard',
  maxNerve: 100,
  portraitKey: 'pilot_wildcard',
  voiceKey: 'pilot_wildcard',
  bio: 'Unlockable. Tied to the rival story.',
  lines: pilotLines('Wildcard'),
  unlockedByDefault: false,
  bondPartners: [{ pilotId: 'pilot_scout', tandemCalloutId: 'co_td_double_time', threshold: 20 }],
};

export const pilotRival: PilotDef = {
  id: 'pilot_rival',
  name: 'Cassian Vey',
  callsign: 'Rival',
  archetype: 'rival',
  faction: 'compact',
  baseAptitudes: apt(60, 70, 45, 45, 55),
  growth: growthAll(0.5),
  startingCerts: ['cert_light', 'cert_medium', 'cert_heavy'],
  startingCallouts: ['co_pre_break_formation'],
  lastTransmissionId: 'co_last_rival',
  maxNerve: 100,
  portraitKey: 'pilot_rival',
  voiceKey: 'pilot_rival',
  bio: 'One Compact ace. Intercepts you in every run.',
  lines: pilotLines('Rival'),
  unlockedByDefault: false,
  bondPartners: [],
};

export const pilotGrunt1: PilotDef = {
  id: 'pilot_grunt_1',
  name: 'Compact Grunt A',
  callsign: 'Grunt A',
  archetype: 'compact_grunt',
  faction: 'compact',
  baseAptitudes: apt(35, 35, 25, 20, 15),
  growth: growthAll(1.0),
  startingCerts: ['cert_light'],
  startingCallouts: [],
  lastTransmissionId: 'co_last_rival',
  maxNerve: 100,
  portraitKey: 'pilot_grunt',
  voiceKey: 'pilot_grunt',
  bio: 'Compact rank and file.',
  lines: pilotLines('Grunt'),
  unlockedByDefault: false,
  bondPartners: [],
};

export const pilotGrunt2: PilotDef = {
  id: 'pilot_grunt_2',
  name: 'Compact Grunt B',
  callsign: 'Grunt B',
  archetype: 'compact_grunt',
  faction: 'compact',
  baseAptitudes: apt(35, 35, 25, 20, 15),
  growth: growthAll(1.0),
  startingCerts: ['cert_light'],
  startingCallouts: [],
  lastTransmissionId: 'co_last_rival',
  maxNerve: 100,
  portraitKey: 'pilot_grunt',
  voiceKey: 'pilot_grunt',
  bio: 'Compact rank and file.',
  lines: pilotLines('Grunt'),
  unlockedByDefault: false,
  bondPartners: [],
};

// ---------------------------------------------------------------------------
// Maps (4) — small 12x8 grids.
// ---------------------------------------------------------------------------

function grid(width: number, height: number, fill: Terrain, sprinkle?: { at: [number, number][]; terrain: Terrain }): Terrain[][] {
  const rows: Terrain[][] = [];
  for (let y = 0; y < height; y++) {
    rows.push(new Array(width).fill(fill));
  }
  if (sprinkle) {
    for (const [x, y] of sprinkle.at) {
      if (rows[y]) rows[y][x] = sprinkle.terrain;
    }
  }
  return rows;
}

function objective(partial: Partial<ObjectiveDef> & Pick<ObjectiveDef, 'id' | 'kind' | 'name' | 'pos'>): ObjectiveDef {
  return {
    radius: 2,
    required: true,
    reward: { scrap: 20, nerve: 10, standing: 5, salvageRolls: 1 },
    ...partial,
  };
}

const heavyAi: EnemyAi = { behavior: 'guard', aggroRadius: 6, homePos: { x: 9, y: 4 } };
const huntAi: EnemyAi = { behavior: 'hunt', aggroRadius: 5, homePos: { x: 8, y: 3 } };
const bossAi: EnemyAi = { behavior: 'boss', aggroRadius: 8, homePos: { x: 10, y: 4 } };

const gruntSquadSpace: EnemySquadSpawn = {
  id: 'spawn_grunts_space',
  name: 'Compact Patrol',
  composition: [
    { frameId: 'frame_compact_ace_heavy', weaponA: 'weapon_compact_blade', weaponB: null, system: null, pilotDefId: 'pilot_grunt_1', slot: 0 },
    { frameId: 'frame_compact_ace_heavy', weaponA: null, weaponB: 'weapon_compact_blade', system: null, pilotDefId: 'pilot_grunt_2', slot: 3 },
  ],
  pos: { x: 9, y: 4 },
  ai: heavyAi,
  spawnAt: 0,
};

const gruntSquadSurface: EnemySquadSpawn = {
  id: 'spawn_grunts_surface',
  name: 'Compact Sentry',
  composition: [
    { frameId: 'frame_compact_ace_heavy', weaponA: 'weapon_compact_blade', weaponB: null, system: null, pilotDefId: 'pilot_grunt_1', slot: 0 },
  ],
  pos: { x: 8, y: 5 },
  ai: heavyAi,
  spawnAt: 0,
};

const gruntSquadRescue: EnemySquadSpawn = {
  id: 'spawn_grunts_rescue',
  name: 'Compact Interdiction',
  composition: [
    { frameId: 'frame_compact_ace_heavy', weaponA: 'weapon_compact_blade', weaponB: null, system: null, pilotDefId: 'pilot_grunt_1', slot: 0 },
    { frameId: 'frame_compact_ace_heavy', weaponA: 'weapon_compact_blade', weaponB: null, system: null, pilotDefId: 'pilot_grunt_2', slot: 1 },
  ],
  pos: { x: 10, y: 3 },
  ai: huntAi,
  spawnAt: 0,
};

const bossSquad: EnemySquadSpawn = {
  id: 'spawn_boss',
  name: 'Cordon Line Command',
  composition: [
    { frameId: 'frame_compact_ace_heavy', weaponA: 'weapon_compact_blade', weaponB: null, system: null, pilotDefId: 'pilot_rival', slot: 0 },
    { frameId: 'frame_compact_ace_heavy', weaponA: 'weapon_compact_blade', weaponB: null, system: null, pilotDefId: 'pilot_grunt_1', slot: 1 },
  ],
  pos: { x: 10, y: 4 },
  ai: bossAi,
  spawnAt: 0,
  isBoss: true,
};

export const mapSpaceA: MapDef = {
  id: 'map_space_a',
  name: 'Kessler Field',
  kind: 'space',
  width: 12,
  height: 8,
  tiles: grid(12, 8, 'void', { at: [[4, 3], [5, 3], [6, 4]], terrain: 'debris' }),
  weather: 'none',
  deployZone: { pos: { x: 1, y: 4 }, radius: 2 },
  carrierOnMap: true,
  objectives: [objective({ id: 'obj_evac_station', kind: 'evac_station', name: 'Relay Beacon', pos: { x: 6, y: 4 }, holdSeconds: 10 })],
  enemySquads: [gruntSquadSpace],
  timeLimit: 300,
  description: 'A debris-strewn approach lane through the outer blockade.',
  briefing: 'Captain: eyes open out there, Lantern group.',
};

export const mapSurfaceA: MapDef = {
  id: 'map_surface_a',
  name: 'Halcyon Station',
  kind: 'surface',
  width: 12,
  height: 8,
  tiles: grid(12, 8, 'open', { at: [[3, 2], [3, 3], [7, 5]], terrain: 'forest' }),
  weather: 'clear',
  deployZone: { pos: { x: 1, y: 4 }, radius: 2 },
  carrierOnMap: false,
  objectives: [objective({ id: 'obj_reach_exit', kind: 'reach_exit', name: 'Extraction Point', pos: { x: 11, y: 4 } })],
  enemySquads: [gruntSquadSurface],
  timeLimit: 240,
  description: 'Open ground occupied by a light Compact garrison.',
  briefing: 'Captain: get in, get them out, get gone.',
};

export const mapSpaceRescueA: MapDef = {
  id: 'map_space_rescue_a',
  name: 'Meridian Anchorage (rescue)',
  kind: 'space',
  width: 12,
  height: 8,
  tiles: grid(12, 8, 'void', { at: [[5, 2], [5, 3], [8, 5]], terrain: 'structure' }),
  weather: 'none',
  deployZone: { pos: { x: 1, y: 4 }, radius: 2 },
  carrierOnMap: true,
  objectives: [
    objective({ id: 'obj_convoy', kind: 'convoy', name: 'Refugee Convoy', pos: { x: 2, y: 4 }, path: [{ x: 2, y: 4 }, { x: 11, y: 4 }], convoySpeed: 0.5, hp: 60 }),
  ],
  enemySquads: [gruntSquadRescue],
  timeLimit: 300,
  description: 'A stricken station evacuating under fire.',
  briefing: 'Captain: that convoy does not make it without us.',
};

export const mapSurfaceBossA: MapDef = {
  id: 'map_surface_boss_a',
  name: 'Ashfall Redoubt (boss)',
  kind: 'surface',
  width: 12,
  height: 8,
  tiles: grid(12, 8, 'open', { at: [[6, 2], [6, 3], [6, 4], [6, 5]], terrain: 'urban' }),
  weather: 'dust',
  deployZone: { pos: { x: 1, y: 4 }, radius: 2 },
  carrierOnMap: false,
  objectives: [
    objective({ id: 'obj_boss', kind: 'destroy_target', name: 'Line Command', pos: { x: 10, y: 4 }, targetSquadId: 'spawn_boss', radius: 3 }),
  ],
  enemySquads: [bossSquad],
  timeLimit: 0,
  description: 'The sector boss dug in behind the redoubt walls.',
  briefing: 'Captain: this is the one that matters.',
};

// ---------------------------------------------------------------------------
// Distress events (3)
// ---------------------------------------------------------------------------

export const eventAmbush: DistressEventDef = {
  id: 'event_ambush',
  title: 'Ambush Signal',
  text: 'Captain: that distress call has a Compact tag buried in it.',
  choices: [
    { id: 'choice_push_through', text: 'Push through anyway.', outcome: { scrap: 20, damageRandomMech: 10, text: 'You took the bait and paid for it, but came away with parts.' } },
    { id: 'choice_ignore', text: 'Ignore it.', outcome: { standing: -5, text: 'You leave them to it. The Captain says nothing.' } },
  ],
};

export const eventStranded: DistressEventDef = {
  id: 'event_stranded',
  title: 'Stranded Pilot',
  text: 'Captain: we have a pilot adrift, still broadcasting.',
  choices: [
    { id: 'choice_recover', text: 'Bring them aboard.', outcome: { recruitPilotId: 'pilot_salvager', nerve: 5, text: 'One more hand on deck.' } },
    { id: 'choice_leave', text: 'No room, no time.', outcome: { scrap: 15, standing: -10, text: 'You salvage their beacon and move on.' } },
  ],
};

export const eventBlackMarket: DistressEventDef = {
  id: 'event_black_market',
  title: 'Black Market Contact',
  text: 'Captain: a broker wants to trade, off the books.',
  choices: [
    { id: 'choice_buy_weapon', text: 'Trade scrap for hardware.', outcome: { scrap: -20, weapon: 'weapon_repair_pod', text: 'The broker delivers as promised, for once.' } },
    { id: 'choice_walk_away', text: 'Walk away.', outcome: { injurePilot: true, text: 'The deal turns sour on the way out.' } },
  ],
};

// ---------------------------------------------------------------------------
// Assembled GameData
// ---------------------------------------------------------------------------

export const FIXTURE_DATA: GameData = {
  frames: {
    [frameLightGround.id]: frameLightGround,
    [frameMediumGround.id]: frameMediumGround,
    [frameLightSpace.id]: frameLightSpace,
    [frameCompactAceHeavy.id]: frameCompactAceHeavy,
  },
  weapons: {
    [weaponLance.id]: weaponLance,
    [weaponRifle.id]: weaponRifle,
    [weaponRailgun.id]: weaponRailgun,
    [weaponVulcan.id]: weaponVulcan,
    [weaponRepairPod.id]: weaponRepairPod,
    [weaponCompactBlade.id]: weaponCompactBlade,
  },
  systems: {
    [systemShield.id]: systemShield,
    [systemBooster.id]: systemBooster,
    [systemEcm.id]: systemEcm,
    [systemTargeting.id]: systemTargeting,
  },
  pilots: {
    [pilotVeteran.id]: pilotVeteran,
    [pilotHotshot.id]: pilotHotshot,
    [pilotMarksman.id]: pilotMarksman,
    [pilotRookie.id]: pilotRookie,
    [pilotEngineer.id]: pilotEngineer,
    [pilotScout.id]: pilotScout,
    [pilotSalvager.id]: pilotSalvager,
    [pilotWildcard.id]: pilotWildcard,
    [pilotRival.id]: pilotRival,
    [pilotGrunt1.id]: pilotGrunt1,
    [pilotGrunt2.id]: pilotGrunt2,
  },
  callouts: FIXTURE_CALLOUTS,
  certs: FIXTURE_CERTS,
  maps: {
    [mapSpaceA.id]: mapSpaceA,
    [mapSurfaceA.id]: mapSurfaceA,
    [mapSpaceRescueA.id]: mapSpaceRescueA,
    [mapSurfaceBossA.id]: mapSurfaceBossA,
  },
  events: {
    [eventAmbush.id]: eventAmbush,
    [eventStranded.id]: eventStranded,
    [eventBlackMarket.id]: eventBlackMarket,
  },
  captainLines: {
    briefing: ['Captain: listen up, Lantern group.'],
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

/** Build a fresh Unlocks matching FIXTURE_DATA's unlockedByDefault flags. */
export function fixtureUnlocks(data: GameData = FIXTURE_DATA): Unlocks {
  return {
    pilots: Object.values(data.pilots).filter((p) => p.unlockedByDefault).map((p) => p.id),
    frames: Object.values(data.frames).filter((f) => f.unlockedByDefault).map((f) => f.id),
    weapons: Object.values(data.weapons).filter((w) => w.unlockedByDefault).map((w) => w.id),
    systems: Object.values(data.systems).filter((s) => s.unlockedByDefault).map((s) => s.id),
    events: Object.keys(data.events),
    ascensionMax: 0,
    runsAttempted: 0,
    runsWon: 0,
    rivalEncounters: 0,
    rivalDefeats: 0,
    fragments: [],
    totalPilotDeaths: 0,
  };
}
