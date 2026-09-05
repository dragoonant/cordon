/**
 * Standalone visual smoke test for BattleStage — not imported by the app.
 * Builds a small, self-contained GameData + BattleResult (every animKey
 * family, a crit, a kill, a callout, a last transmission, a finisher, and
 * an ending banner) and plays it through a real BattleStage instance so
 * the spectacle can be eyeballed without the rest of the game.
 *
 * Usage (e.g. from a throwaway HTML page or a scratch Vite entry):
 *   import { mountBattleHarness } from '@render/battle/devHarness';
 *   mountBattleHarness(document.getElementById('stage')!);
 */
import type {
  BattleEvent,
  BattleResult,
  BattleSide,
  Certification,
  CertificationDef,
  FrameDef,
  GameData,
  Mech,
  Pilot,
  PilotDef,
  PilotLines,
  Squad,
  WeaponDef,
} from '@sim/types';
import { BattleStage } from './BattleStage';

function linesFor(callsign: string, finisherName: string): PilotLines {
  return {
    deploy: [`${callsign}, deploying.`],
    attack: [`Taking the shot!`],
    crit: [`Right where it hurts!`],
    kill: [`Target down.`],
    hit: [`Feel that?`],
    allyDown: [`No—!`],
    victory: [`That's a wrap.`],
    retreat: [`Falling back!`],
    finisher: `${finisherName} — full burn!`,
    finisherName,
  };
}

function makeCert(id: Certification): CertificationDef {
  return { id, name: id, description: '', requires: {}, requiresCerts: [], grantsCallouts: [] };
}

function makePilotDef(id: string, name: string, callsign: string, faction: PilotDef['faction']): PilotDef {
  return {
    id,
    name,
    callsign,
    archetype: 'veteran',
    faction,
    baseAptitudes: { gunnery: 60, melee: 60, evasion: 50, systems: 50, command: 50 },
    growth: { gunnery: 1, melee: 1, evasion: 1, systems: 1, command: 1 },
    startingCerts: [],
    startingCallouts: [],
    lastTransmissionId: `lt_${id}`,
    maxNerve: 100,
    portraitKey: id,
    voiceKey: id,
    bio: '',
    lines: linesFor(callsign, `${callsign} Break`),
    unlockedByDefault: true,
    bondPartners: [],
  };
}

function makePilot(pilotDefId: string, instance: number): Pilot {
  return {
    id: `${pilotDefId}#${instance}`,
    aptitudes: { gunnery: 60, melee: 60, evasion: 50, systems: 50, command: 50 },
    certs: [],
    callouts: [],
    kills: 0,
    battles: 0,
    nerve: 100,
    maxNerve: 100,
    alive: true,
    injuredFor: 0,
    ace: false,
    bonds: {},
    morale: 80,
  };
}

function makeFrame(id: string, faction: FrameDef['faction'], silhouette: FrameDef['silhouette'], hp: number): FrameDef {
  return {
    id,
    name: id,
    faction,
    weightClass: 'medium',
    mobility: 'ground',
    hp,
    armor: 8,
    evasion: 30,
    speed: 4,
    generator: 100,
    weight: 50,
    spriteKey: id,
    description: '',
    silhouette,
    unlockedByDefault: true,
  };
}

function makeWeapon(id: string, faction: WeaponDef['faction'], animKey: string, kind: WeaponDef['kind'] = 'ranged'): WeaponDef {
  return {
    id,
    name: id,
    faction,
    kind,
    damage: 30,
    hits: 1,
    accuracy: 85,
    crit: 15,
    frontMult: 1,
    backMult: 0.7,
    weight: 10,
    power: 10,
    tags: [],
    animKey,
    unlockedByDefault: true,
  };
}

function makeMech(id: string, frameId: string, weaponA: string | null, hp: number): Mech {
  return { id, frameId, weaponA, weaponB: null, system: null, hp, maxHpPenalty: 0, destroyed: false };
}

interface Roster {
  data: GameData;
  sideA: BattleSide;
  sideB: BattleSide;
}

function buildRoster(): Roster {
  const certs = {} as Record<Certification, CertificationDef>;
  (
    [
      'cert_light',
      'cert_medium',
      'cert_heavy',
      'cert_vanguard',
      'cert_marksman',
      'cert_field_tech',
      'cert_recon',
      'cert_wing_lead',
    ] as Certification[]
  ).forEach((c) => {
    certs[c] = makeCert(c);
  });

  const frames: Record<string, FrameDef> = {
    frame_relay_line: makeFrame('frame_relay_line', 'relay', 'line', 320),
    frame_relay_bastion: makeFrame('frame_relay_bastion', 'relay', 'bastion', 420),
    frame_relay_skirmish: makeFrame('frame_relay_skirmish', 'relay', 'skirmish', 260),
    frame_compact_line: makeFrame('frame_compact_line', 'compact', 'compact_line', 300),
    frame_compact_ace: makeFrame('frame_compact_ace', 'compact', 'compact_ace', 340),
    frame_compact_siege: makeFrame('frame_compact_siege', 'compact', 'siege', 380),
  };

  const weapons: Record<string, WeaponDef> = {
    wpn_lance: makeWeapon('wpn_lance', 'relay', 'lance', 'melee'),
    wpn_maul: makeWeapon('wpn_maul', 'compact', 'maul', 'melee'),
    wpn_slash: makeWeapon('wpn_slash', 'relay', 'slash', 'melee'),
    wpn_burst: makeWeapon('wpn_burst', 'relay', 'burst'),
    wpn_beam: makeWeapon('wpn_beam', 'compact', 'beam'),
    wpn_rail: makeWeapon('wpn_rail', 'relay', 'rail'),
    wpn_missiles: makeWeapon('wpn_missiles', 'compact', 'missiles'),
    wpn_flak: makeWeapon('wpn_flak', 'relay', 'flak'),
    wpn_repair: { ...makeWeapon('wpn_repair', 'relay', 'repair', 'support'), repair: 40 },
  };

  const pilotDefs = {
    p_lead: makePilotDef('p_lead', 'Mara Ilves', 'Wraith', 'relay'),
    p_gun: makePilotDef('p_gun', 'Devon Cray', 'Slate', 'relay'),
    p_medic: makePilotDef('p_medic', 'Ida Voss', 'Splint', 'relay'),
    e_lead: makePilotDef('e_lead', 'Korrin Vale', 'Ashfall', 'compact'),
    e_gun: makePilotDef('e_gun', 'Tessa Bram', 'Nightbolt', 'compact'),
    e_heavy: makePilotDef('e_heavy', 'Orsan Kade', 'Millstone', 'compact'),
  };

  const pilots: Record<string, PilotDef> = pilotDefs;

  const relayPilots: Record<string, Pilot> = {
    'p_lead#1': makePilot('p_lead', 1),
    'p_gun#1': makePilot('p_gun', 1),
    'p_medic#1': makePilot('p_medic', 1),
  };
  const compactPilots: Record<string, Pilot> = {
    'e_lead#1': makePilot('e_lead', 1),
    'e_gun#1': makePilot('e_gun', 1),
    'e_heavy#1': makePilot('e_heavy', 1),
  };

  const relayMechs: Record<string, Mech> = {
    mech_p_lead: makeMech('mech_p_lead', 'frame_relay_line', 'wpn_lance', 320),
    mech_p_gun: makeMech('mech_p_gun', 'frame_relay_skirmish', 'wpn_burst', 260),
    mech_p_medic: makeMech('mech_p_medic', 'frame_relay_bastion', 'wpn_repair', 420),
  };
  const compactMechs: Record<string, Mech> = {
    mech_e_lead: makeMech('mech_e_lead', 'frame_compact_ace', 'wpn_beam', 340),
    mech_e_gun: makeMech('mech_e_gun', 'frame_compact_line', 'wpn_missiles', 300),
    mech_e_heavy: makeMech('mech_e_heavy', 'frame_compact_siege', 'wpn_maul', 380),
  };

  const squadA: Squad = {
    id: 'squad_a',
    name: 'Lantern Wing',
    faction: 'relay',
    leaderPilotId: 'p_lead#1',
    slots: [
      { pilotId: 'p_lead#1', mechId: 'mech_p_lead' },
      { pilotId: 'p_gun#1', mechId: 'mech_p_gun' },
      { pilotId: 'p_medic#1', mechId: 'mech_p_medic' },
      null,
      null,
      null,
    ],
    pos: { x: 0, y: 0 },
    path: [],
    targetPos: null,
    fuel: 100,
    maxFuel: 100,
    morale: 80,
    state: 'engaged',
    engageCooldown: 0,
    effects: [],
  };

  const squadB: Squad = {
    ...squadA,
    id: 'squad_b',
    name: 'Ashfall Cell',
    faction: 'compact',
    leaderPilotId: 'e_lead#1',
    slots: [
      { pilotId: 'e_lead#1', mechId: 'mech_e_lead' },
      { pilotId: 'e_gun#1', mechId: 'mech_e_gun' },
      { pilotId: 'e_heavy#1', mechId: 'mech_e_heavy' },
      null,
      null,
      null,
    ],
  };

  const data: GameData = {
    frames,
    weapons,
    systems: {},
    pilots,
    callouts: {},
    certs,
    maps: {},
    events: {},
    captainLines: {
      briefing: [],
      victory: [],
      defeat: [],
      pilotLost: [],
      objectiveFailed: [],
      objectiveComplete: [],
      rivalAppears: [],
      runStart: [],
      runWon: [],
      runLost: [],
    },
  };

  return {
    data,
    sideA: { squad: squadA, pilots: relayPilots, mechs: relayMechs },
    sideB: { squad: squadB, pilots: compactPilots, mechs: compactMechs },
  };
}

function buildEvents(): BattleEvent[] {
  const events: BattleEvent[] = [
    { t: 'start', sideA: 'squad_a', sideB: 'squad_b', terrain: 'debris', weather: 'clear', mapKind: 'space' },
    { t: 'callout', side: 'A', pilotId: 'p_lead#1', calloutId: 'co_eyes_on', line: 'Eyes on. Report anything that moves.' },
    { t: 'round', n: 1 },
    {
      t: 'attack',
      side: 'A',
      attackerPilotId: 'p_lead#1',
      attackerMechId: 'mech_p_lead',
      defenderPilotId: 'e_lead#1',
      defenderMechId: 'mech_e_lead',
      weaponId: 'wpn_lance',
      hits: [{ hit: true, damage: 42, crit: false }],
      totalDamage: 42,
      defenderHpAfter: 298,
      killed: false,
      line: 'Closing in!',
    },
    {
      t: 'attack',
      side: 'B',
      attackerPilotId: 'e_gun#1',
      attackerMechId: 'mech_e_gun',
      defenderPilotId: 'p_gun#1',
      defenderMechId: 'mech_p_gun',
      weaponId: 'wpn_missiles',
      hits: [
        { hit: true, damage: 18, crit: false },
        { hit: true, damage: 18, crit: false },
        { hit: false, damage: 0, crit: false },
      ],
      totalDamage: 36,
      defenderHpAfter: 224,
      killed: false,
      line: 'Lock and fire!',
    },
    {
      t: 'attack',
      side: 'A',
      attackerPilotId: 'p_gun#1',
      attackerMechId: 'mech_p_gun',
      defenderPilotId: 'e_gun#1',
      defenderMechId: 'mech_e_gun',
      weaponId: 'wpn_burst',
      hits: [
        { hit: true, damage: 14, crit: false },
        { hit: true, damage: 14, crit: false },
        { hit: true, damage: 14, crit: false },
      ],
      totalDamage: 42,
      defenderHpAfter: 258,
      killed: false,
    },
    {
      t: 'attack',
      side: 'B',
      attackerPilotId: 'e_lead#1',
      attackerMechId: 'mech_e_lead',
      defenderPilotId: 'p_medic#1',
      defenderMechId: 'mech_p_medic',
      weaponId: 'wpn_beam',
      hits: [{ hit: true, damage: 55, crit: true }],
      totalDamage: 55,
      defenderHpAfter: 365,
      killed: false,
      line: 'Hold still.',
    },
    { t: 'cutin', side: 'B', pilotId: 'e_lead#1', kind: 'crit', line: 'Found the gap!' },
    {
      t: 'attack',
      side: 'A',
      attackerPilotId: 'p_lead#1',
      attackerMechId: 'mech_p_lead',
      defenderPilotId: 'e_gun#1',
      defenderMechId: 'mech_e_gun',
      weaponId: 'wpn_slash',
      hits: [{ hit: true, damage: 60, crit: false }],
      totalDamage: 60,
      defenderHpAfter: 198,
      killed: false,
    },
    {
      t: 'repair',
      side: 'A',
      pilotId: 'p_medic#1',
      mechId: 'mech_p_medic',
      targetMechId: 'mech_p_gun',
      amount: 40,
    },
    {
      t: 'attack',
      side: 'A',
      attackerPilotId: 'p_gun#1',
      attackerMechId: 'mech_p_gun',
      defenderPilotId: 'e_heavy#1',
      defenderMechId: 'mech_e_heavy',
      weaponId: 'wpn_rail',
      hits: [{ hit: true, damage: 70, crit: false }],
      totalDamage: 70,
      defenderHpAfter: 310,
      killed: false,
    },
    {
      t: 'attack',
      side: 'B',
      attackerPilotId: 'e_heavy#1',
      attackerMechId: 'mech_e_heavy',
      defenderPilotId: 'p_gun#1',
      defenderMechId: 'mech_p_gun',
      weaponId: 'wpn_maul',
      hits: [{ hit: true, damage: 95, crit: true }],
      totalDamage: 95,
      defenderHpAfter: 0,
      killed: true,
      line: 'Get out of the way!',
    },
    { t: 'cutin', side: 'B', pilotId: 'e_heavy#1', kind: 'kill', line: 'One down.' },
    {
      t: 'destroyed',
      side: 'A',
      mechId: 'mech_p_gun',
      pilotId: 'p_gun#1',
      pilotDied: true,
      ejected: false,
      line: 'Slate—no!',
    },
    { t: 'last_transmission', side: 'A', pilotId: 'p_gun#1', calloutId: 'lt_p_gun', effect: 'lt_marking_them', line: 'Tag the one that got me. Make it count.' },
    { t: 'morale', side: 'A', delta: -10, reason: 'ally_lost' },
    { t: 'round', n: 2 },
    { t: 'cutin', side: 'A', pilotId: 'p_lead#1', kind: 'finisher', line: 'This ends now.' },
    { t: 'finisher', side: 'A', pilotId: 'p_lead#1', name: 'Wraith Break', line: 'Lantern Wing, finishing the job!' },
    {
      t: 'attack',
      side: 'A',
      attackerPilotId: 'p_lead#1',
      attackerMechId: 'mech_p_lead',
      defenderPilotId: 'e_heavy#1',
      defenderMechId: 'mech_e_heavy',
      weaponId: 'wpn_lance',
      hits: [{ hit: true, damage: 320, crit: true }],
      totalDamage: 320,
      defenderHpAfter: 0,
      killed: true,
    },
    { t: 'destroyed', side: 'B', mechId: 'mech_e_heavy', pilotId: 'e_heavy#1', pilotDied: false, ejected: true },
    { t: 'end', winner: 'A', reason: 'annihilation' },
  ];
  return events;
}

/**
 * Mounts a BattleStage into `el` and plays a fixed demo battle. Returns the
 * stage so the caller can `destroy()` it on teardown.
 */
export function mountBattleHarness(el: HTMLElement): BattleStage {
  const { data, sideA, sideB } = buildRoster();
  const events = buildEvents();

  const result: BattleResult = {
    seed: 1,
    winner: 'A',
    events,
    sideA: {
      squad: sideA.squad,
      pilots: sideA.pilots,
      mechs: {
        ...sideA.mechs,
        mech_p_gun: { ...sideA.mechs.mech_p_gun, hp: 0, destroyed: true },
      },
    },
    sideB: {
      squad: sideB.squad,
      pilots: sideB.pilots,
      mechs: {
        ...sideB.mechs,
        mech_e_heavy: { ...sideB.mechs.mech_e_heavy, hp: 0, destroyed: true },
      },
    },
    pilotDeaths: [{ side: 'A', pilotId: 'p_gun#1' }],
    mechsLost: [
      { side: 'A', mechId: 'mech_p_gun', recoverable: false },
      { side: 'B', mechId: 'mech_e_heavy', recoverable: true },
    ],
    salvage: { weapons: [], systems: [], frames: [], scrap: 0 },
    growth: {},
    killsByPilot: { 'p_lead#1': 1, 'e_heavy#1': 1 },
  };

  const stage = new BattleStage(el, data);
  stage.play(result, { sideA, sideB }, {
    speed: 'full',
    onEvent: (e, i) => console.log(`[battle ${i}]`, e.t, e),
    onComplete: () => console.log('[battle] complete'),
  });
  return stage;
}
