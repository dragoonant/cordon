/**
 * Standalone visual harness for MapScene — no store, no sim modules, no real
 * data files (those are owned by concurrent workstreams and may not exist
 * yet). Everything below is throwaway fake data that satisfies the
 * `GameData` / `MapDef` / `WorldState` contracts in src/sim/types.ts, purely
 * so MapScene can be eyeballed in isolation.
 *
 * Usage: `mountMapHarness(document.getElementById('app')!)`.
 */
import type {
  Aptitudes,
  Certification,
  CertificationDef,
  GameData,
  Mech,
  MapDef,
  ObjectiveDef,
  Pilot,
  Squad,
  Terrain,
  Vec2,
  WorldState,
} from '@sim/types';
import { MapScene, type MapIntent } from './MapScene';

function aptitudes(v: number): Aptitudes {
  return { gunnery: v, melee: v, evasion: v, systems: v, command: v };
}

const ALL_CERTS: Certification[] = [
  'cert_light',
  'cert_medium',
  'cert_heavy',
  'cert_vanguard',
  'cert_marksman',
  'cert_field_tech',
  'cert_recon',
  'cert_wing_lead',
];

function makeCert(id: Certification): CertificationDef {
  return { id, name: id, description: '', requires: {}, requiresCerts: [], grantsCallouts: [] };
}

function makeFakeGameData(): GameData {
  return {
    frames: {
      frame_dev_a: {
        id: 'frame_dev_a',
        name: 'Skirmisher',
        faction: 'relay',
        weightClass: 'medium',
        mobility: 'ground',
        hp: 100,
        armor: 10,
        evasion: 20,
        speed: 3,
        generator: 10,
        weight: 10,
        spriteKey: 'dev_a',
        description: 'Dev harness placeholder frame.',
        silhouette: 'skirmish',
        unlockedByDefault: true,
      },
      frame_dev_b: {
        id: 'frame_dev_b',
        name: 'Line Grunt',
        faction: 'compact',
        weightClass: 'medium',
        mobility: 'ground',
        hp: 90,
        armor: 8,
        evasion: 15,
        speed: 3,
        generator: 10,
        weight: 10,
        spriteKey: 'dev_b',
        description: 'Dev harness placeholder frame.',
        silhouette: 'compact_line',
        unlockedByDefault: true,
      },
    },
    weapons: {},
    systems: {},
    pilots: {},
    callouts: {},
    certs: Object.fromEntries(ALL_CERTS.map((c) => [c, makeCert(c)])) as Record<Certification, CertificationDef>,
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
}

function makePilot(id: string): Pilot {
  return {
    id,
    aptitudes: aptitudes(40),
    certs: [],
    callouts: [],
    kills: 0,
    battles: 0,
    nerve: 50,
    maxNerve: 100,
    alive: true,
    injuredFor: 0,
    ace: false,
    bonds: {},
    morale: 80,
  };
}

function makeMech(id: string, frameId: string, hp: number): Mech {
  return { id, frameId, weaponA: null, weaponB: null, system: null, hp, maxHpPenalty: 0, destroyed: false };
}

const LEGEND: Record<string, Terrain> = {
  '.': 'open',
  f: 'forest',
  u: 'urban',
  m: 'mountain',
  w: 'water',
  '#': 'blocked',
};

function makeTiles(): Terrain[][] {
  const rows = [
    '....................',
    '..fff........uuu....',
    '..fff........uuu....',
    '....................',
    '....mmm....wwww.....',
    '....mmm....wwww.....',
    '....................',
    '..............f.....',
    'uu............f.....',
    'uu..................',
    '....................',
    '....................',
  ];
  return rows.map((row) =>
    row
      .slice(0, 20)
      .padEnd(20, '.')
      .split('')
      .map((ch) => LEGEND[ch] ?? 'open')
  );
}

function makeObjectives(): ObjectiveDef[] {
  return [
    {
      id: 'obj_station',
      kind: 'evac_station',
      name: 'Rest Stop Colony',
      pos: { x: 4, y: 2 },
      radius: 1.5,
      holdSeconds: 20,
      required: true,
      reward: { scrap: 100, nerve: 10, standing: 5, salvageRolls: 1 },
    },
    {
      id: 'obj_relay',
      kind: 'relay',
      name: 'Comm Relay',
      pos: { x: 15, y: 3 },
      radius: 1,
      required: false,
      reward: { scrap: 50, nerve: 0, standing: 2, salvageRolls: 0 },
    },
    {
      id: 'obj_exit',
      kind: 'reach_exit',
      name: 'Extraction Point',
      pos: { x: 18, y: 10 },
      radius: 1.2,
      required: true,
      reward: { scrap: 20, nerve: 0, standing: 0, salvageRolls: 0 },
    },
  ];
}

function makeMapDef(): MapDef {
  return {
    id: 'map_dev_harness',
    name: 'Dev Harness Sector',
    kind: 'surface',
    width: 20,
    height: 12,
    tiles: makeTiles(),
    weather: 'clear',
    deployZone: { pos: { x: 1, y: 6 }, radius: 1.5 },
    // Set true on purpose (even on a surface map) so the harness exercises the
    // carrier-silhouette + HP-bar rendering path per GDD §5's space-map carrier.
    carrierOnMap: true,
    objectives: makeObjectives(),
    enemySquads: [],
    timeLimit: 0,
    description: 'A throwaway map for visually exercising MapScene.',
    briefing: 'Testing, testing.',
  };
}

function makeSquad(id: string, faction: Squad['faction'], pos: Vec2, leaderPilotId: string, mechId: string): Squad {
  return {
    id,
    name: id,
    faction,
    leaderPilotId,
    slots: [{ pilotId: leaderPilotId, mechId }, null, null, null, null, null],
    pos,
    path: [],
    targetPos: null,
    fuel: 80,
    maxFuel: 100,
    morale: 80,
    state: 'idle',
    engageCooldown: 0,
    effects: [],
    escortingObjectiveId: null,
  };
}

export interface MapHarnessHandle {
  scene: MapScene;
  destroy: () => void;
}

/** Mounts a MapScene against fake local data so the map can be eyeballed without the rest of the game. */
export function mountMapHarness(el: HTMLElement): MapHarnessHandle {
  const data = makeFakeGameData();
  const map = makeMapDef();
  const scene = new MapScene(el, data);

  const pilotP1 = makePilot('pilot_p1');
  const pilotP2 = makePilot('pilot_p2');
  const pilotE1 = makePilot('pilot_e1');
  const pilotE2 = makePilot('pilot_e2');
  const pilotE3 = makePilot('pilot_e3');

  const mechP1 = makeMech('mech_p1', 'frame_dev_a', 80);
  const mechP2 = makeMech('mech_p2', 'frame_dev_a', 100);
  const mechE1 = makeMech('mech_e1', 'frame_dev_b', 40);
  const mechE2 = makeMech('mech_e2', 'frame_dev_b', 90);
  const mechE3 = makeMech('mech_e3', 'frame_dev_b', 90);

  const squadP1 = makeSquad('squad_p1', 'relay', { x: 3, y: 6 }, pilotP1.id, mechP1.id);
  squadP1.effects = [{ type: 'burn', remaining: 10 }];
  const squadP2 = makeSquad('squad_p2', 'relay', { x: 2, y: 8 }, pilotP2.id, mechP2.id);
  squadP2.state = 'moving';

  const squadE1 = makeSquad('squad_e1', 'compact', { x: 14, y: 4 }, pilotE1.id, mechE1.id);
  squadE1.effects = [{ type: 'marked', remaining: 999 }];
  const squadE2 = makeSquad('squad_e2', 'compact', { x: 16, y: 8 }, pilotE2.id, mechE2.id);
  const squadE3 = makeSquad('squad_e3', 'compact', { x: 10, y: 10 }, pilotE3.id, mechE3.id); // stays hidden

  const world: WorldState = {
    mapId: map.id,
    tick: 0,
    time: 0,
    speed: 1,
    phase: 'running',
    squads: {
      [squadP1.id]: squadP1,
      [squadP2.id]: squadP2,
      [squadE1.id]: squadE1,
      [squadE2.id]: squadE2,
      [squadE3.id]: squadE3,
    },
    pilots: Object.fromEntries([pilotP1, pilotP2, pilotE1, pilotE2, pilotE3].map((p) => [p.id, p])),
    mechs: Object.fromEntries([mechP1, mechP2, mechE1, mechE2, mechE3].map((m) => [m.id, m])),
    objectives: {
      obj_station: { id: 'obj_station', status: 'active', progress: 0.4, pos: { x: 4, y: 2 } },
      obj_relay: { id: 'obj_relay', status: 'complete', progress: 1, pos: { x: 15, y: 3 } },
      obj_exit: { id: 'obj_exit', status: 'pending', progress: 0, pos: { x: 18, y: 10 } },
    },
    visibleEnemyIds: [squadE1.id, squadE2.id],
    pendingBattle: null,
    lastBattle: null,
    carrierHp: 70,
    carrierMaxHp: 100,
    outcome: null,
    events: [],
    rngState: 1,
    pendingSpawns: [],
  };

  let destroyed = false;
  const patrolPath: Vec2[] = [
    { x: 3, y: 6 },
    { x: 8, y: 6 },
    { x: 8, y: 9 },
    { x: 14, y: 9 },
    { x: 14, y: 4 },
  ];
  let pathT = 0;

  scene.onIntent((intent: MapIntent) => {
    // eslint-disable-next-line no-console
    console.log('[devHarness] intent', intent);
    if (intent.t === 'select') scene.setSelected(intent.squadId);
  });

  void scene.load(map).then(() => {
    scene.setSelected(squadP1.id);
    let last = performance.now();
    const step = (now: number): void => {
      if (destroyed) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      // Animate squadP1 back and forth along patrolPath so movement/interpolation is visible.
      pathT += dt * 0.5;
      const total = patrolPath.length - 1;
      const t = pathT % (total * 2);
      const segT = t < total ? t : total * 2 - t;
      const i = Math.min(total - 1, Math.floor(segT));
      const localT = segT - i;
      const a = patrolPath[i];
      const b = patrolPath[Math.min(total, i + 1)];
      squadP1.pos = { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
      squadP1.state = 'moving';
      squadP1.targetPos = b;
      squadP1.path = patrolPath.slice(i + 1);

      world.time += dt;
      world.tick += 1;
      scene.setState(world);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  return {
    scene,
    destroy: () => {
      destroyed = true;
      scene.destroy();
    },
  };
}
