/**
 * CORDON — shared test fixtures for pathfind.test.ts / world.test.ts.
 *
 * Minimal but structurally valid GameData plus two MapDefs (one surface, one
 * space) and small builder helpers. Builder *functions* (not exported
 * constants) so every test gets fresh, independently-mutable Pilot/Mech
 * objects — important for the determinism test, which builds two separate
 * worlds and must not have them share references.
 */
import type {
  Aptitudes,
  Certification,
  CertificationDef,
  GameData,
  Id,
  Mech,
  MapDef,
  Pilot,
  PilotDef,
  PilotLines,
  Squad,
  SlotAssignment,
  Terrain,
} from '../types';

// ---------------------------------------------------------------------------
// hardware
// ---------------------------------------------------------------------------

export const FRAME_LINE_ID = 'frame_line';
export const FRAME_SKIRMISH_ID = 'frame_skirmish';
export const WEAPON_RIFLE_ID = 'weapon_rifle';
export const WEAPON_LANCE_ID = 'weapon_lance';
export const SYSTEM_FUEL_CELL_ID = 'sys_fuel_cell';
export const SYSTEM_RECON_ID = 'sys_recon';

function baseAptitudes(v: number): Aptitudes {
  return { gunnery: v, melee: v, evasion: v, systems: v, command: v };
}

function baseLines(): PilotLines {
  return {
    deploy: ['Moving out.'],
    attack: ['Taking the shot.'],
    crit: ['Direct hit!'],
    kill: ['Splashed one.'],
    hit: ['Took a hit.'],
    allyDown: ['We lost someone!'],
    victory: ['That is the fight.'],
    retreat: ['Falling back!'],
    rivalContact: ['So it is you.'],
    finisher: 'Finish it!',
    finisherName: 'Overdrive',
  };
}

const ALL_OVERWORLD_CALLOUTS: Id[] = [
  'co_burn_hard',
  'co_ping_sector',
  'co_rally_channel',
  'co_fall_back',
  'co_come_get_some',
  'co_stay_with_them',
];

export const PILOT_ALPHA_DEF: PilotDef = {
  id: 'pilot_alpha',
  name: 'Alpha Test',
  callsign: 'Alpha',
  archetype: 'veteran',
  faction: 'relay',
  baseAptitudes: baseAptitudes(50),
  growth: baseAptitudes(1),
  startingCerts: [],
  startingCallouts: [...ALL_OVERWORLD_CALLOUTS],
  lastTransmissionId: 'lt_dont_stop_test',
  maxNerve: 100,
  portraitKey: 'alpha',
  voiceKey: 'alpha',
  bio: 'Test pilot.',
  lines: baseLines(),
  unlockedByDefault: true,
  bondPartners: [],
};

export const PILOT_BRAVO_DEF: PilotDef = {
  ...PILOT_ALPHA_DEF,
  id: 'pilot_bravo',
  name: 'Bravo Test',
  callsign: 'Bravo',
  lastTransmissionId: 'lt_dont_stop_test',
};

export const PILOT_CHARLIE_DEF: PilotDef = {
  ...PILOT_ALPHA_DEF,
  id: 'pilot_charlie',
  name: 'Charlie Test',
  callsign: 'Charlie',
  lastTransmissionId: 'lt_marking_test',
};

function blankCert(id: Certification): CertificationDef {
  return { id, name: id, description: '', requires: {}, requiresCerts: [], grantsCallouts: [] };
}

export function buildGameData(): GameData {
  return {
    frames: {
      [FRAME_LINE_ID]: {
        id: FRAME_LINE_ID,
        name: 'Line',
        faction: 'relay',
        weightClass: 'medium',
        mobility: 'ground',
        hp: 100,
        armor: 5,
        evasion: 20,
        speed: 3,
        generator: 40,
        weight: 20,
        spriteKey: 'line',
        description: 'Test ground frame.',
        silhouette: 'line',
        unlockedByDefault: true,
      },
      [FRAME_SKIRMISH_ID]: {
        id: FRAME_SKIRMISH_ID,
        name: 'Skirmish',
        faction: 'relay',
        weightClass: 'light',
        mobility: 'space',
        hp: 70,
        armor: 3,
        evasion: 30,
        speed: 4,
        generator: 30,
        weight: 12,
        spriteKey: 'skirmish',
        description: 'Test space frame.',
        silhouette: 'skirmish',
        unlockedByDefault: true,
      },
    },
    weapons: {
      [WEAPON_RIFLE_ID]: {
        id: WEAPON_RIFLE_ID,
        name: 'Rifle',
        faction: 'relay',
        kind: 'ranged',
        damage: 12,
        hits: 1,
        accuracy: 70,
        crit: 10,
        frontMult: 0.8,
        backMult: 1,
        weight: 5,
        power: 8,
        tags: [],
        animKey: 'rifle',
        unlockedByDefault: true,
      },
      [WEAPON_LANCE_ID]: {
        id: WEAPON_LANCE_ID,
        name: 'Lance',
        faction: 'relay',
        kind: 'melee',
        damage: 18,
        hits: 2,
        accuracy: 65,
        crit: 8,
        frontMult: 1,
        backMult: 0,
        weight: 6,
        power: 6,
        tags: [],
        animKey: 'lance',
        unlockedByDefault: true,
      },
    },
    systems: {
      [SYSTEM_FUEL_CELL_ID]: {
        id: SYSTEM_FUEL_CELL_ID,
        name: 'Fuel Cell',
        faction: 'relay',
        effect: 'fuel_cell',
        value: 30,
        weight: 3,
        power: 0,
        description: 'Test fuel cell.',
        unlockedByDefault: true,
      },
      [SYSTEM_RECON_ID]: {
        id: SYSTEM_RECON_ID,
        name: 'Recon Array',
        faction: 'relay',
        effect: 'recon',
        value: 2,
        weight: 2,
        power: 4,
        description: 'Test recon array.',
        unlockedByDefault: true,
      },
    },
    pilots: {
      [PILOT_ALPHA_DEF.id]: PILOT_ALPHA_DEF,
      [PILOT_BRAVO_DEF.id]: PILOT_BRAVO_DEF,
      [PILOT_CHARLIE_DEF.id]: PILOT_CHARLIE_DEF,
    },
    callouts: {
      co_burn_hard: {
        id: 'co_burn_hard',
        effect: 'burn_hard',
        kind: 'overworld',
        line: 'Burn hard!',
        label: 'Burn Hard',
        description: '2x speed for 30s.',
        tradeoff: '3x fuel drain, then forced rest.',
        nerveCost: 20,
        duration: 30,
      },
      co_ping_sector: {
        id: 'co_ping_sector',
        effect: 'ping_sector',
        kind: 'overworld',
        line: 'Ping the sector.',
        label: 'Ping Sector',
        description: 'Reveal enemies in radius.',
        tradeoff: 'They see you too.',
        nerveCost: 15,
        radius: 8,
        duration: 20,
      },
      co_rally_channel: {
        id: 'co_rally_channel',
        effect: 'rally_channel',
        kind: 'overworld',
        line: 'Rally on the channel.',
        label: 'Rally Channel',
        description: 'Allies in range recover morale.',
        tradeoff: 'Caster loses morale.',
        nerveCost: 15,
        radius: 8,
      },
      co_fall_back: {
        id: 'co_fall_back',
        effect: 'fall_back',
        kind: 'overworld',
        line: 'Fall back, fall back!',
        label: 'Fall Back',
        description: 'Instant disengage home.',
        tradeoff: 'Flat damage tick.',
        nerveCost: 10,
      },
      co_come_get_some: {
        id: 'co_come_get_some',
        effect: 'come_get_some',
        kind: 'overworld',
        line: 'Come get some!',
        label: 'Come Get Some',
        description: 'Draw enemies in range.',
        tradeoff: 'You better win.',
        nerveCost: 15,
        radius: 8,
        duration: 20,
      },
      co_stay_with_them: {
        id: 'co_stay_with_them',
        effect: 'stay_with_them',
        kind: 'overworld',
        line: 'Stay with them.',
        label: 'Stay With Them',
        description: 'Escort the convoy.',
        tradeoff: "Can't disengage.",
        nerveCost: 10,
      },
      lt_dont_stop_test: {
        id: 'lt_dont_stop_test',
        effect: 'lt_dont_stop',
        kind: 'last',
        line: "Don't you dare stop for me.",
        label: "Don't Stop",
        description: 'All friendly squads 2x speed 30s + full nerve.',
        tradeoff: 'None — it is free.',
        nerveCost: 0,
      },
      lt_marking_test: {
        id: 'lt_marking_test',
        effect: 'lt_marking_them',
        kind: 'last',
        line: 'Marking them. All of them.',
        label: 'Marking Them',
        description: 'Killer squad revealed + marked for the run.',
        tradeoff: 'None — it is free.',
        nerveCost: 0,
      },
    },
    certs: {
      cert_light: blankCert('cert_light'),
      cert_medium: blankCert('cert_medium'),
      cert_heavy: blankCert('cert_heavy'),
      cert_vanguard: blankCert('cert_vanguard'),
      cert_marksman: blankCert('cert_marksman'),
      cert_field_tech: blankCert('cert_field_tech'),
      cert_recon: blankCert('cert_recon'),
      cert_wing_lead: blankCert('cert_wing_lead'),
    },
    maps: {
      [SURFACE_MAP_ID]: buildSurfaceMap(),
      [SPACE_MAP_ID]: buildSpaceMap(),
    },
    events: {},
    captainLines: {
      briefing: ['Listen up.'],
      victory: ['Good work out there.'],
      defeat: ['We took losses today.'],
      pilotLost: ['We lost one. Note the name.'],
      objectiveFailed: ['That one is gone.'],
      objectiveComplete: ['Objective secure.'],
      rivalAppears: ['Contact — it is them.'],
      runStart: ['Cordon line, move out.'],
      runWon: ['The line holds.'],
      runLost: ['The line is broken.'],
    },
  };
}

// ---------------------------------------------------------------------------
// maps
// ---------------------------------------------------------------------------

export const SURFACE_MAP_ID = 'map_surface_test';
export const SPACE_MAP_ID = 'map_space_test';

export const SURFACE_DEPLOY_POS = { x: 2, y: 2 };
export const SURFACE_EVAC_ID = 'obj_evac_station';
export const SURFACE_CONVOY_ID = 'obj_convoy';
export const SURFACE_RELAY_ID = 'obj_relay';
export const SURFACE_ENEMY_SQUAD_ID = 'sq_enemy_surface';
export const SURFACE_ENEMY_PILOT_ID = 'pilot_enemy_surface';
export const SURFACE_ENEMY_MECH_ID = 'mech_enemy_surface';

function openTiles(width: number, height: number) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => 'open' as const));
}

function buildSurfaceMap(): MapDef {
  return {
    id: SURFACE_MAP_ID,
    name: 'Test Surface Map',
    kind: 'surface',
    width: 20,
    height: 12,
    tiles: openTiles(20, 12),
    weather: 'clear',
    deployZone: { pos: { ...SURFACE_DEPLOY_POS }, radius: 2 },
    carrierOnMap: false,
    objectives: [
      {
        id: SURFACE_EVAC_ID,
        kind: 'evac_station',
        name: 'Test Station',
        pos: { x: 10, y: 6 },
        radius: 2,
        holdSeconds: 5,
        hp: 40,
        required: true,
        reward: { scrap: 10, nerve: 5, standing: 1, salvageRolls: 0 },
      },
      {
        id: SURFACE_CONVOY_ID,
        kind: 'convoy',
        name: 'Test Convoy',
        pos: { x: 4, y: 9 },
        radius: 2,
        path: [
          { x: 4, y: 9 },
          { x: 9, y: 9 },
          { x: 14, y: 9 },
          { x: 18, y: 9 },
        ],
        convoySpeed: 2,
        hp: 30,
        required: false,
        reward: { scrap: 10, nerve: 5, standing: 1, salvageRolls: 0 },
      },
      {
        id: SURFACE_RELAY_ID,
        kind: 'relay',
        name: 'Test Relay',
        pos: { x: 17, y: 2 },
        radius: 2,
        holdSeconds: 3,
        required: false,
        reward: { scrap: 5, nerve: 5, standing: 1, salvageRolls: 0 },
      },
    ],
    enemySquads: [
      {
        id: SURFACE_ENEMY_SQUAD_ID,
        name: 'Surface Enemy',
        composition: [
          { frameId: FRAME_LINE_ID, weaponA: WEAPON_RIFLE_ID, weaponB: null, system: null, pilotDefId: SURFACE_ENEMY_PILOT_ID, slot: 0 },
        ],
        pos: { x: 18, y: 10 },
        ai: { behavior: 'guard', aggroRadius: 5, homePos: { x: 18, y: 10 } },
        spawnAt: 0,
      },
    ],
    timeLimit: 0,
    description: 'Flat open test surface map.',
    briefing: 'Test briefing.',
  };
}

export const SPACE_DEPLOY_POS = { x: 2, y: 5 };
export const SPACE_ENEMY_SQUAD_ID = 'sq_enemy_space';
export const SPACE_ENEMY_PILOT_ID = 'pilot_enemy_space';
export const SPACE_ENEMY_MECH_ID = 'mech_enemy_space';
export const SPACE_DESTROY_OBJECTIVE_ID = 'obj_destroy_space_enemy';
export const SPACE_ENEMY_POS = { x: 14, y: 5 };

function buildSpaceMap(): MapDef {
  const tiles: Terrain[][] = Array.from({ length: 10 }, () => Array.from({ length: 16 }, () => 'void' as Terrain));
  for (const x of [6, 7, 8]) tiles[4][x] = 'debris';
  for (const x of [10, 11, 12]) tiles[6][x] = 'radiation';

  return {
    id: SPACE_MAP_ID,
    name: 'Test Space Map',
    kind: 'space',
    width: 16,
    height: 10,
    tiles,
    weather: 'none',
    deployZone: { pos: { ...SPACE_DEPLOY_POS }, radius: 2 },
    carrierOnMap: true,
    objectives: [
      {
        id: SPACE_DESTROY_OBJECTIVE_ID,
        kind: 'destroy_target',
        name: 'Destroy Enemy Squad',
        pos: { ...SPACE_ENEMY_POS },
        radius: 2,
        targetSquadId: SPACE_ENEMY_SQUAD_ID,
        required: true,
        reward: { scrap: 20, nerve: 5, standing: 2, salvageRolls: 1 },
      },
    ],
    enemySquads: [
      {
        id: SPACE_ENEMY_SQUAD_ID,
        name: 'Space Enemy',
        composition: [
          { frameId: FRAME_LINE_ID, weaponA: WEAPON_RIFLE_ID, weaponB: null, system: null, pilotDefId: SPACE_ENEMY_PILOT_ID, slot: 0 },
        ],
        pos: { ...SPACE_ENEMY_POS },
        ai: { behavior: 'guard', aggroRadius: 5, homePos: { ...SPACE_ENEMY_POS } },
        spawnAt: 0,
      },
    ],
    timeLimit: 0,
    description: 'Debris & radiation test space map with a carrier.',
    briefing: 'Test briefing.',
  };
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

export function instantiatePilot(def: PilotDef): Pilot {
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
    morale: 100,
  };
}

export function makeRuntimePilot(id: Id, overrides: Partial<Pilot> = {}): Pilot {
  return {
    id,
    aptitudes: baseAptitudes(50),
    certs: [],
    callouts: [],
    kills: 0,
    battles: 0,
    nerve: 50,
    maxNerve: 50,
    alive: true,
    injuredFor: 0,
    ace: false,
    bonds: {},
    morale: 100,
    ...overrides,
  };
}

export function makeMech(id: Id, frameId: Id, opts: Partial<Mech> & { hp?: number } = {}): Mech {
  return {
    id,
    frameId,
    weaponA: opts.weaponA ?? WEAPON_RIFLE_ID,
    weaponB: opts.weaponB ?? null,
    system: opts.system ?? null,
    system2: opts.system2,
    hp: opts.hp ?? 100,
    maxHpPenalty: opts.maxHpPenalty ?? 0,
    destroyed: opts.destroyed ?? false,
  };
}

export function makeSquad(
  id: Id,
  faction: Squad['faction'],
  leaderPilotId: Id | null,
  slots: (SlotAssignment | null)[],
  extra: Partial<Squad> = {}
): Squad {
  return {
    id,
    name: id,
    faction,
    leaderPilotId,
    slots,
    pos: { x: 0, y: 0 },
    path: [],
    targetPos: null,
    fuel: 0,
    maxFuel: 0,
    morale: 100,
    state: 'docked',
    engageCooldown: 0,
    effects: [],
    ...extra,
  };
}

export const MECH_ALPHA_ID = 'mech_alpha';
export const MECH_BRAVO_ID = 'mech_bravo';
export const MECH_CHARLIE_ID = 'mech_charlie';
export const SQUAD_ALPHA_ID = 'sq_alpha';
export const SQUAD_BRAVO_ID = 'sq_bravo';

/** A fresh player-side bundle: sq_alpha (2 ground mechs) + sq_bravo (1 space mech). */
export function playerSideBundle(): { squads: Squad[]; pilots: Record<Id, Pilot>; mechs: Record<Id, Mech> } {
  const pilots: Record<Id, Pilot> = {
    [PILOT_ALPHA_DEF.id]: instantiatePilot(PILOT_ALPHA_DEF),
    [PILOT_BRAVO_DEF.id]: instantiatePilot(PILOT_BRAVO_DEF),
    [PILOT_CHARLIE_DEF.id]: instantiatePilot(PILOT_CHARLIE_DEF),
  };
  const mechs: Record<Id, Mech> = {
    [MECH_ALPHA_ID]: makeMech(MECH_ALPHA_ID, FRAME_LINE_ID, { system: SYSTEM_FUEL_CELL_ID }),
    [MECH_BRAVO_ID]: makeMech(MECH_BRAVO_ID, FRAME_LINE_ID, { system: SYSTEM_RECON_ID }),
    [MECH_CHARLIE_ID]: makeMech(MECH_CHARLIE_ID, FRAME_SKIRMISH_ID, { hp: 70 }),
  };
  const squads: Squad[] = [
    makeSquad(SQUAD_ALPHA_ID, 'relay', PILOT_ALPHA_DEF.id, [
      { pilotId: PILOT_ALPHA_DEF.id, mechId: MECH_ALPHA_ID },
      { pilotId: PILOT_BRAVO_DEF.id, mechId: MECH_BRAVO_ID },
      null,
      null,
      null,
      null,
    ]),
    makeSquad(SQUAD_BRAVO_ID, 'relay', PILOT_CHARLIE_DEF.id, [
      { pilotId: PILOT_CHARLIE_DEF.id, mechId: MECH_CHARLIE_ID },
      null,
      null,
      null,
      null,
      null,
    ]),
  ];
  return { squads, pilots, mechs };
}

/** A fresh enemy bundle matching SURFACE_MAP's enemySquads entry. */
export function enemySideBundleSurface(): { squads: Squad[]; pilots: Record<Id, Pilot>; mechs: Record<Id, Mech> } {
  const pilots: Record<Id, Pilot> = { [SURFACE_ENEMY_PILOT_ID]: makeRuntimePilot(SURFACE_ENEMY_PILOT_ID) };
  const mechs: Record<Id, Mech> = { [SURFACE_ENEMY_MECH_ID]: makeMech(SURFACE_ENEMY_MECH_ID, FRAME_LINE_ID) };
  const squads: Squad[] = [
    makeSquad(SURFACE_ENEMY_SQUAD_ID, 'compact', SURFACE_ENEMY_PILOT_ID, [
      { pilotId: SURFACE_ENEMY_PILOT_ID, mechId: SURFACE_ENEMY_MECH_ID },
      null,
      null,
      null,
      null,
      null,
    ]),
  ];
  return { squads, pilots, mechs };
}

/** A fresh enemy bundle matching SPACE_MAP's enemySquads entry. */
export function enemySideBundleSpace(): { squads: Squad[]; pilots: Record<Id, Pilot>; mechs: Record<Id, Mech> } {
  const pilots: Record<Id, Pilot> = { [SPACE_ENEMY_PILOT_ID]: makeRuntimePilot(SPACE_ENEMY_PILOT_ID) };
  const mechs: Record<Id, Mech> = { [SPACE_ENEMY_MECH_ID]: makeMech(SPACE_ENEMY_MECH_ID, FRAME_LINE_ID) };
  const squads: Squad[] = [
    makeSquad(SPACE_ENEMY_SQUAD_ID, 'compact', SPACE_ENEMY_PILOT_ID, [
      { pilotId: SPACE_ENEMY_PILOT_ID, mechId: SPACE_ENEMY_MECH_ID },
      null,
      null,
      null,
      null,
      null,
    ]),
  ];
  return { squads, pilots, mechs };
}
