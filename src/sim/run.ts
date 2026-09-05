/**
 * CORDON — the roguelite run layer (run-sim).
 *
 * Owns the sector node graph, hangar-adjacent run economy (scrap/salvage/
 * depot), and map-to-map bookkeeping. All randomness is drawn from
 * `run.rngState`, restored into a fresh `Rng` at the top of every mutating
 * function and written back before returning, so a run is fully
 * reproducible from `run.seed` plus the sequence of calls made against it.
 *
 * Extra exports beyond API.md's `run.ts` section (documented here since
 * API.md doesn't list them):
 *  - `applySalvage(run, salvage)` — adds a SalvageDrop to run inventory/scrap.
 *  - `recordBattle(run, result, data)` — the UI calls this after *every*
 *    individual battle resolved on the map (not just at `finishMap`), since
 *    `world.ts` only keeps `lastBattle` and has no reference to `RunState`.
 *    It syncs post-battle pilot/mech state back into the run and, on a
 *    player win, applies salvage, aptitude growth, kills, bonds (+2 between
 *    every pair of pilots in the winning squad) and +3 Nerve to winners.
 *    `finishMap` itself only handles objectives/deaths/status — it assumes
 *    per-battle rewards were already applied via `recordBattle`.
 *  - `pilotDefIdOf(pilotId)` — enemy Pilot instance ids are
 *    `${pilotDefId}#${spawnId}#${slot}` (so two grunts from the same
 *    PilotDef get distinct Pilot ids); this recovers the PilotDef id. Player
 *    pilot ids equal their PilotDef id verbatim, so this is a no-op for them.
 */
import { addBond, applyGrowth, canPilotFly, createPilot, isAce, regenNerve, tickInjuries } from './pilots';
import { Rng, hashString } from './rng';
import type {
  BattleResult,
  EnemySquadSpawn,
  FrameDef,
  GameData,
  Id,
  MapDef,
  Mech,
  NodeKind,
  Pilot,
  PilotDef,
  RunHistoryEntry,
  RunNode,
  RunSector,
  RunState,
  SalvageDrop,
  SlotAssignment,
  SlotIndex,
  Squad,
  Unlocks,
  Vec2,
  WeightClass,
  WorldState,
} from './types';

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Enemy Pilot instance ids are `${pilotDefId}#${spawnId}#${slot}`; this
 * recovers the PilotDef id. Player pilot ids have no '#' and pass through.
 */
export function pilotDefIdOf(pilotId: Id): Id {
  const idx = pilotId.indexOf('#');
  return idx === -1 ? pilotId : pilotId.slice(0, idx);
}

function rngFor(run: RunState): Rng {
  const rng = new Rng(run.seed);
  rng.setState(run.rngState);
  return rng;
}

function saveRng(run: RunState, rng: Rng): void {
  run.rngState = rng.getState();
}

const WEIGHT_RANK: Record<WeightClass, number> = { light: 0, medium: 1, heavy: 2 };

// ---------------------------------------------------------------------------
// Node/label/name content (not shipped data — small evocative pools so
// generated runs don't read like placeholder text).
// ---------------------------------------------------------------------------

const SECTOR_NAMES = [
  'The Outer Cordon',
  'The Blockade Line',
  'The Ashline Frontier',
  'The Long Approach',
  'The Reach',
  'The Quiet Belt',
];

const SPACE_LABELS = [
  'Kessler Field',
  'Voidwatch Anchorage',
  'Meridian Drift',
  'Cinder Belt',
  'Umbra Relay',
  'Solace Array',
  'Perigee Yard',
  'Long Dusk Platform',
  'Ashen Ring',
  'Static Verge',
  'Wraith Lane',
  'Halcyon Orbital',
];

const SURFACE_LABELS = [
  'Halcyon Station',
  'Ember Hollow',
  'Rustwater Crossing',
  'Ashfall Redoubt',
  'Greywind Basin',
  'Thornfield',
  'Lowmarch',
  'Cordillera Watch',
  'Dustbowl Terminus',
  'Salt Flats Landing',
  'Ironbark Hold',
  'Millrace Junction',
];

const NODE_KIND_WEIGHTS: [NodeKind, number][] = [
  ['battle', 35],
  ['rescue', 30],
  ['salvage', 10],
  ['distress', 10],
  ['depot', 10],
  ['rival', 5],
];

function pickWeightedKind(rng: Rng): NodeKind {
  const total = NODE_KIND_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [kind, w] of NODE_KIND_WEIGHTS) {
    if (roll < w) return kind;
    roll -= w;
  }
  return 'battle';
}

function baseThreatForCol(col: number): 1 | 2 | 3 {
  if (col <= 2) return 1;
  if (col <= 4) return 2;
  return 3;
}

/** Returns the modifiers active at (and below) this ascension level. See ascensionModifiers(). */
function ascensionFlags(level: number) {
  return {
    scrapCut: level >= 1,
    nerveHalved: level >= 2,
    extraThreat: level >= 3,
    noDepots: level >= 4,
    earlyRival: level >= 5,
  };
}

/** Human-readable list of the stackable post-clear modifiers active at `level` and below. */
export function ascensionModifiers(level: number): { label: string; description: string }[] {
  const all: { label: string; description: string }[] = [
    { label: 'Tight Margins', description: 'Starting scrap reduced by 20%.' },
    { label: 'Frayed Nerves', description: 'Starting Nerve halved for every pilot.' },
    { label: 'Hardened Resistance', description: 'Enemy threat rating +1 on every node (max 3).' },
    { label: 'No Safe Harbor', description: 'Depot nodes no longer appear.' },
    { label: 'Early Contact', description: 'The rival appears as early as sector column 1.' },
  ];
  return all.slice(0, clamp(level, 0, all.length));
}

// ---------------------------------------------------------------------------
// Sector graph generation
// ---------------------------------------------------------------------------

function pickMapKind(rng: Rng, col: number): 'space' | 'surface' {
  const base: 'space' | 'surface' = col % 2 === 1 ? 'space' : 'surface';
  if (rng.chance(0.35)) return base === 'space' ? 'surface' : 'space';
  return base;
}

function buildSector(rng: Rng, ascension: number, data: GameData, unlocks: Unlocks): RunSector {
  const flags = ascensionFlags(ascension);
  const eventPool = unlocks.events.length ? unlocks.events : Object.keys(data.events);

  const applyThreat = (base: 1 | 2 | 3): 1 | 2 | 3 => (flags.extraThreat ? (Math.min(3, base + 1) as 1 | 2 | 3) : base);

  // Draw labels without replacement so a sector never shows the same name twice.
  const spacePool = rng.shuffle([...SPACE_LABELS]);
  const surfacePool = rng.shuffle([...SURFACE_LABELS]);
  const makeNode = (kind: NodeKind, col: number, row: number): RunNode => {
    let mapKind = pickMapKind(rng, col);
    if (kind === 'boss') mapKind = 'space'; // only a space boss map ships in this slice
    const labelPool = mapKind === 'space' ? spacePool : surfacePool;
    const node: RunNode = {
      id: `node_c${col}_r${row}`,
      kind,
      mapKind,
      col,
      row,
      edges: [],
      visited: false,
      cleared: false,
      label: labelPool.pop() ?? rng.pick(mapKind === 'space' ? SPACE_LABELS : SURFACE_LABELS),
      threat: applyThreat(baseThreatForCol(col)),
    };
    if (kind === 'distress') node.eventId = rng.pick(eventPool);
    return node;
  };

  const cols: RunNode[][] = [];
  cols.push([{ ...makeNode('start', 0, 0), visited: true, cleared: true, threat: 1 }]);

  for (let col = 1; col <= 4; col++) {
    const count = rng.int(2, 3);
    const nodes: RunNode[] = [];
    for (let row = 0; row < count; row++) {
      let kind = pickWeightedKind(rng);
      if (kind === 'rival' && col < 2) kind = 'battle'; // rival restricted to cols 2-4 unless ascension forces col1
      nodes.push(makeNode(kind, col, row));
    }
    cols.push(nodes);
  }

  const bossNode = makeNode('boss', 5, 0);
  bossNode.threat = 3;
  cols.push([bossNode]);

  // --- constraint fixups over the interior (cols 1-4) ---
  const interior = cols.slice(1, 5).flat();

  if (flags.noDepots) {
    for (const n of interior) if (n.kind === 'depot') n.kind = 'battle';
  }

  if (flags.earlyRival) {
    const col1 = cols[1];
    if (!col1.some((n) => n.kind === 'rival')) {
      for (const n of interior) if (n.kind === 'rival') n.kind = 'battle';
      rng.pick(col1).kind = 'rival';
    }
  }

  const rivals = interior.filter((n) => n.kind === 'rival');
  if (rivals.length > 1) {
    for (const extra of rivals.slice(1)) extra.kind = 'battle';
  }

  if (!flags.noDepots && !interior.some((n) => n.kind === 'depot')) {
    const candidates = interior.filter((n) => n.kind !== 'rival');
    if (candidates.length) rng.pick(candidates).kind = 'depot';
  }

  if (!interior.some((n) => n.kind === 'rescue')) {
    const candidates = interior.filter((n) => n.kind !== 'rival' && n.kind !== 'depot');
    if (candidates.length) rng.pick(candidates).kind = 'rescue';
  }

  // --- edges: each node connects to 1-2 nodes in the next column; repair
  // pass guarantees every non-start node has >=1 incoming edge. ---
  for (let col = 0; col < cols.length - 1; col++) {
    const from = cols[col];
    const to = cols[col + 1];
    for (const node of from) {
      const edgeCount = to.length === 1 ? 1 : rng.int(1, 2);
      const targets = new Set<Id>();
      const shuffled = rng.shuffle([...to]);
      for (const t of shuffled) {
        if (targets.size >= edgeCount) break;
        targets.add(t.id);
      }
      node.edges = Array.from(targets);
    }
    const reached = new Set(from.flatMap((n) => n.edges));
    for (const t of to) {
      if (!reached.has(t.id)) {
        rng.pick(from).edges.push(t.id);
      }
    }
  }

  const nodes = cols.flat();
  return { index: 0, name: rng.pick(SECTOR_NAMES), nodes, bossNodeId: bossNode.id };
}

// ---------------------------------------------------------------------------
// Starting roster & hardware
// ---------------------------------------------------------------------------

function lightestFlyableFrame(pilot: Pilot, frameIds: Id[], data: GameData): FrameDef | null {
  const candidates = frameIds.map((id) => data.frames[id]).filter((f): f is FrameDef => !!f && canPilotFly(pilot, f));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const rankDiff = WEIGHT_RANK[a.weightClass] - WEIGHT_RANK[b.weightClass];
    if (rankDiff !== 0) return rankDiff;
    const relayA = a.faction === 'relay' ? 0 : 1;
    const relayB = b.faction === 'relay' ? 0 : 1;
    return relayA - relayB;
  });
  return candidates[0];
}

function firstUnlockedWeapon(weaponIds: Id[], data: GameData, kind: 'melee' | 'ranged'): Id | null {
  const matches = weaponIds
    .map((id) => data.weapons[id])
    .filter((w): w is NonNullable<typeof w> => !!w && w.kind === kind)
    .sort((a, b) => (a.faction === 'relay' ? 0 : 1) - (b.faction === 'relay' ? 0 : 1));
  return matches[0]?.id ?? null;
}

function firstUnlockedSystem(systemIds: Id[], data: GameData): Id | null {
  const matches = systemIds
    .map((id) => data.systems[id])
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => (a.faction === 'relay' ? 0 : 1) - (b.faction === 'relay' ? 0 : 1));
  return matches[0]?.id ?? null;
}

function powerOf(data: GameData, weaponId: Id | null, systemId: Id | null): number {
  return (weaponId ? data.weapons[weaponId]?.power ?? 0 : 0) + (systemId ? data.systems[systemId]?.power ?? 0 : 0);
}

/**
 * Preferred starter kit per archetype (ids by preference order; first unlocked
 * & flyable wins). Keeps the opening squads varied and row-sensible: fronts
 * carry a lance, backs carry a rifle/railgun, the engineer repairs.
 */
const STARTER_KIT: Partial<Record<PilotDef['archetype'], { frames: Id[]; weaponA: Id[]; weaponB: Id[]; systems: Id[] }>> = {
  veteran: { frames: ['frame_line', 'frame_trooper'], weaponA: ['wpn_lance'], weaponB: ['wpn_assault_rifle'], systems: ['sys_shield'] },
  hotshot: { frames: ['frame_skirmish', 'frame_interceptor'], weaponA: ['wpn_lance'], weaponB: ['wpn_vulcans'], systems: ['sys_booster'] },
  marksman: { frames: ['frame_interceptor', 'frame_skirmish'], weaponA: ['wpn_railgun', 'wpn_assault_rifle'], weaponB: ['wpn_assault_rifle'], systems: ['sys_targeting'] },
  rookie: { frames: ['frame_skirmish'], weaponA: ['wpn_shield_blade', 'wpn_lance'], weaponB: ['wpn_assault_rifle'], systems: ['sys_eject_assist'] },
  engineer: { frames: ['frame_line', 'frame_trooper'], weaponA: ['wpn_repair_arm'], weaponB: ['wpn_assault_rifle'], systems: ['sys_repair_drone'] },
  scout: { frames: ['frame_interceptor', 'frame_skirmish'], weaponA: ['wpn_missile_pod', 'wpn_assault_rifle'], weaponB: ['wpn_vulcans'], systems: ['sys_recon_array', 'sys_booster'] },
  salvager: { frames: ['frame_line', 'frame_skirmish'], weaponA: ['wpn_lance'], weaponB: ['wpn_missile_pod'], systems: ['sys_shield'] },
  wildcard: { frames: ['frame_interceptor', 'frame_line'], weaponA: ['wpn_lance'], weaponB: ['wpn_assault_rifle'], systems: ['sys_booster'] },
};

/** Builds one starting mech for `pilot`, pre-equipped, not drawn from run.frames inventory. */
function buildStartingMech(pilot: Pilot, index: number, unlocks: Unlocks, data: GameData): Mech {
  const kit = STARTER_KIT[data.pilots[pilot.id]?.archetype ?? 'rookie'];
  const pick = (prefs: Id[] | undefined, pool: Id[]): Id | null => prefs?.find((id) => pool.includes(id)) ?? null;

  const preferredFrame = pick(kit?.frames, unlocks.frames);
  const frame =
    (preferredFrame && canPilotFly(pilot, data.frames[preferredFrame]) ? data.frames[preferredFrame] : null) ??
    lightestFlyableFrame(pilot, unlocks.frames, data) ??
    Object.values(data.frames)[0];

  const weaponA = pick(kit?.weaponA, unlocks.weapons) ?? firstUnlockedWeapon(unlocks.weapons, data, 'melee');
  let weaponB: Id | null = pick(kit?.weaponB, unlocks.weapons) ?? firstUnlockedWeapon(unlocks.weapons, data, 'ranged');
  if (weaponB === weaponA) weaponB = null;

  let power = powerOf(data, weaponA, null);
  if (weaponB && power + (data.weapons[weaponB]?.power ?? 0) > frame.generator) weaponB = null;
  if (weaponB) power += data.weapons[weaponB]?.power ?? 0;

  let system: Id | null = pick(kit?.systems, unlocks.systems) ?? firstUnlockedSystem(unlocks.systems, data);
  if (system && power + (data.systems[system]?.power ?? 0) > frame.generator) system = null;

  return {
    id: `mech_${frame.id}_${index}`,
    frameId: frame.id,
    weaponA,
    weaponB,
    system,
    system2: null,
    hp: frame.hp,
    maxHpPenalty: 0,
    destroyed: false,
  };
}

function buildStartingSquad(id: Id, name: string, pilotIds: Id[], mechIdByPilot: Record<Id, Id>): Squad {
  const slots: (SlotAssignment | null)[] = [null, null, null, null, null, null];
  const slotOrder: SlotIndex[] = [0, 1, 3];
  pilotIds.forEach((pilotId, i) => {
    slots[slotOrder[i]] = { pilotId, mechId: mechIdByPilot[pilotId] };
  });
  return {
    id,
    name,
    faction: 'relay',
    leaderPilotId: pilotIds[0] ?? null,
    slots,
    pos: { x: 0, y: 0 },
    path: [],
    targetPos: null,
    fuel: 100,
    maxFuel: 100,
    morale: 70,
    state: 'docked',
    engageCooldown: 0,
    effects: [],
    escortingObjectiveId: null,
  };
}

// ---------------------------------------------------------------------------
// newRun
// ---------------------------------------------------------------------------

/**
 * Generates a fresh run: one sector (col 0 start .. col 5 boss), a starting
 * roster of 6 unlocked Relay pilots in 2 squads of 3, and pre-equipped
 * starter hardware. Deterministic from `seed`.
 */
export function newRun(data: GameData, unlocks: Unlocks, seed: number, ascension: number): RunState {
  const rng = new Rng(seed);
  const flags = ascensionFlags(ascension);

  const sector = buildSector(rng, ascension, data, unlocks);

  const rosterIds = unlocks.pilots
    .map((id) => data.pilots[id])
    .filter((def): def is PilotDef => !!def && def.faction === 'relay' && def.archetype !== 'captain' && def.archetype !== 'rival')
    .slice(0, 6)
    .map((def) => def.id);

  const pilots: Record<Id, Pilot> = {};
  const mechs: Record<Id, Mech> = {};
  const mechIdByPilot: Record<Id, Id> = {};

  rosterIds.forEach((pilotId, i) => {
    const def = data.pilots[pilotId];
    const pilot = createPilot(def);
    if (flags.nerveHalved) pilot.nerve = Math.floor(pilot.nerve / 2);
    pilots[pilotId] = pilot;
    const mech = buildStartingMech(pilot, i + 1, unlocks, data);
    mechs[mech.id] = mech;
    mechIdByPilot[pilotId] = mech.id;
  });

  const squads: Squad[] = [
    buildStartingSquad('squad_lantern_1', 'Lantern One', rosterIds.slice(0, 3), mechIdByPilot),
    buildStartingSquad('squad_lantern_2', 'Lantern Two', rosterIds.slice(3, 6), mechIdByPilot),
  ];

  const scrap = flags.scrapCut ? Math.round(60 * 0.8) : 60;

  return {
    seed,
    ascension,
    sectorIndex: 0,
    sectors: [sector],
    currentNodeId: sector.nodes[0].id,
    pilots,
    mechs,
    weapons: [],
    systems: [],
    frames: [],
    squads,
    scrap,
    standing: 50,
    turn: 0,
    history: [],
    status: 'active',
    markedEnemySquadIds: [],
    rngState: rng.getState(),
  };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export function currentNode(run: RunState): RunNode {
  const sector = run.sectors[run.sectorIndex];
  const node = sector.nodes.find((n) => n.id === run.currentNodeId);
  if (!node) throw new Error(`currentNode: node ${run.currentNodeId} not found in sector ${run.sectorIndex}`);
  return node;
}

export function reachableNodes(run: RunState): RunNode[] {
  const sector = run.sectors[run.sectorIndex];
  const node = currentNode(run);
  return node.edges.map((id) => sector.nodes.find((n) => n.id === id)).filter((n): n is RunNode => !!n);
}

/** Moves to `nodeId` if it's reachable from the current node. No-op otherwise. Mutates `run`. */
export function travelTo(run: RunState, nodeId: Id): void {
  if (!reachableNodes(run).some((n) => n.id === nodeId)) return;
  run.currentNodeId = nodeId;
  const node = currentNode(run);
  node.visited = true;
  run.turn += 1;
}

// ---------------------------------------------------------------------------
// prepareMap
// ---------------------------------------------------------------------------

const MAP_ELIGIBLE_KINDS: NodeKind[] = ['battle', 'rescue', 'salvage', 'rival', 'boss'];

function pickMapId(node: RunNode, data: GameData, rng: Rng): Id | undefined {
  const all = Object.values(data.maps);
  let candidates = all.filter((m) => m.kind === node.mapKind);
  // Boss maps are reserved for the boss node.
  if (node.kind !== 'boss') candidates = candidates.filter((m) => !m.id.includes('boss'));
  if (node.kind === 'boss') {
    // A boss map must exist for the run to be winnable; prefer any boss map
    // even if its kind differs from the node's rolled kind.
    const preferred = all.filter((m) => m.id.includes('boss'));
    if (preferred.length) candidates = preferred;
  } else if (node.kind === 'rescue') {
    const preferred = candidates.filter((m) => m.id.includes('rescue'));
    if (preferred.length) candidates = preferred;
  }
  if (!candidates.length) candidates = all;
  if (!candidates.length) return undefined;
  return rng.pick(candidates).id;
}

/** Reinforcement frame: a compact line frame if it exists, else the template's own. */
function extraFrameFor(templateFrameId: Id, data: GameData): Id {
  return data.frames['frame_compact_line'] ? 'frame_compact_line' : templateFrameId;
}

function buildEnemySquad(
  spawn: EnemySquadSpawn,
  threat: 1 | 2 | 3,
  data: GameData,
  pilotsOut: Record<Id, Pilot>,
  mechsOut: Record<Id, Mech>
): Squad {
  const slots: (SlotAssignment | null)[] = [null, null, null, null, null, null];
  let leaderPilotId: Id | null = null;
  // Bosses and rivals are hand-tuned; ordinary spawns scale with node threat by
  // gaining bodies (threat 2: +1 mech, threat 3: +2) plus a small aptitude bump.
  const handTuned = !!spawn.isBoss || !!spawn.isRival;
  const bonus = handTuned ? 0 : Math.max(0, threat - 1) * 6;
  const extra = handTuned ? 0 : Math.max(0, threat - 1);
  const composition = [...spawn.composition];
  if (extra > 0 && spawn.composition.length > 0) {
    const template = spawn.composition[spawn.composition.length - 1];
    const free = ([0, 1, 2, 3, 4, 5] as SlotIndex[]).filter((i) => !spawn.composition.some((c) => c.slot === i));
    for (let i = 0; i < extra && i < free.length; i++) {
      // Fill front row first so reinforcements screen the originals.
      const slot = free.sort((a, b) => a - b)[i];
      composition.push({ ...template, slot, frameId: extraFrameFor(template.frameId, data) });
    }
  }

  for (const part of composition) {
    const def = data.pilots[part.pilotDefId];
    if (!def) continue;
    const instanceId = `${part.pilotDefId}#${spawn.id}#${part.slot}`;
    const pilot = createPilot(def);
    pilot.id = instanceId;
    if (bonus > 0) {
      for (const aptKey of Object.keys(pilot.aptitudes) as (keyof typeof pilot.aptitudes)[]) {
        pilot.aptitudes[aptKey] = Math.min(100, pilot.aptitudes[aptKey] + bonus);
      }
    }
    pilotsOut[instanceId] = pilot;

    const frame = data.frames[part.frameId];
    const mechId = `mech_${part.frameId}_${spawn.id}_${part.slot}`;
    mechsOut[mechId] = {
      id: mechId,
      frameId: part.frameId,
      weaponA: part.weaponA,
      weaponB: part.weaponB,
      system: part.system,
      system2: null,
      hp: frame ? frame.hp : 1,
      maxHpPenalty: 0,
      destroyed: false,
    };
    slots[part.slot] = { pilotId: instanceId, mechId };
    if (leaderPilotId === null) leaderPilotId = instanceId;
  }

  return {
    id: spawn.id,
    name: spawn.name,
    faction: 'compact',
    leaderPilotId,
    slots,
    pos: spawn.pos,
    path: [],
    targetPos: null,
    fuel: 100,
    maxFuel: 100,
    morale: 70,
    state: 'idle',
    engageCooldown: 0,
    effects: [],
    ai: spawn.ai,
    escortingObjectiveId: null,
  };
}

/**
 * Builds the rival encounter squad: the rival PilotDef in a compact_ace
 * frame plus up to 2 compact_grunt pilots, all in one squad, 'hunt' AI, far
 * from the deploy zone. `types.ts`'s Squad has no `isRival` flag, so callers
 * should identify this squad by its fixed id `spawn_rival` (or simply by
 * `currentNode(run).kind === 'rival'`).
 */
function buildRivalSquad(
  map: MapDef,
  threat: 1 | 2 | 3,
  data: GameData,
  pilotsOut: Record<Id, Pilot>,
  mechsOut: Record<Id, Mech>
): Squad | null {
  const rivalDef = Object.values(data.pilots).find((p) => p.archetype === 'rival');
  if (!rivalDef) return null;
  const gruntDefs = Object.values(data.pilots).filter((p) => p.archetype === 'compact_grunt').slice(0, 2);
  const aceFrame =
    Object.values(data.frames).find((f) => f.silhouette === 'compact_ace' && f.faction === 'compact') ??
    Object.values(data.frames).find((f) => f.faction === 'compact');
  if (!aceFrame) return null;

  const spawnId = 'spawn_rival';
  const bonus = Math.max(0, threat - 1) * 10;
  const slots: (SlotAssignment | null)[] = [null, null, null, null, null, null];
  const members: { def: PilotDef; slot: SlotIndex }[] = [{ def: rivalDef, slot: 0 }];
  if (gruntDefs[0]) members.push({ def: gruntDefs[0], slot: 1 });
  if (gruntDefs[1]) members.push({ def: gruntDefs[1], slot: 3 });

  const compactMelee = Object.values(data.weapons).find((w) => w.faction === 'compact' && w.kind === 'melee')?.id ?? null;
  let leaderPilotId: Id | null = null;

  for (const member of members) {
    const instanceId = `${member.def.id}#${spawnId}#${member.slot}`;
    const pilot = createPilot(member.def);
    pilot.id = instanceId;
    if (bonus > 0) {
      for (const aptKey of Object.keys(pilot.aptitudes) as (keyof typeof pilot.aptitudes)[]) {
        pilot.aptitudes[aptKey] = Math.min(100, pilot.aptitudes[aptKey] + bonus);
      }
    }
    pilotsOut[instanceId] = pilot;

    const mechId = `mech_${aceFrame.id}_${spawnId}_${member.slot}`;
    mechsOut[mechId] = {
      id: mechId,
      frameId: aceFrame.id,
      weaponA: compactMelee,
      weaponB: null,
      system: null,
      system2: null,
      hp: aceFrame.hp,
      maxHpPenalty: 0,
      destroyed: false,
    };
    slots[member.slot] = { pilotId: instanceId, mechId };
    if (leaderPilotId === null) leaderPilotId = instanceId;
  }

  const farPos: Vec2 = { x: Math.max(0, map.width - 2), y: Math.max(0, map.height - 2) };
  return {
    id: spawnId,
    name: `${rivalDef.callsign} Wing`,
    faction: 'compact',
    leaderPilotId,
    slots,
    pos: farPos,
    path: [],
    targetPos: null,
    fuel: 100,
    maxFuel: 100,
    morale: 80,
    state: 'idle',
    engageCooldown: 0,
    effects: [],
    ai: { behavior: 'hunt', aggroRadius: 12, homePos: farPos },
    escortingObjectiveId: null,
  };
}

/**
 * Picks a MapDef for the current node and instantiates its enemy squads
 * (scaled by node.threat). Returns null for node kinds with no map
 * (start/distress/depot). The chosen mapId is cached on the node so a later
 * call (e.g. resuming a save) is stable. Mutates `run.rngState` and (via the
 * cache) `run`.
 */
export function prepareMap(
  run: RunState,
  data: GameData
): { map: MapDef; enemies: { squads: Squad[]; pilots: Record<Id, Pilot>; mechs: Record<Id, Mech> } } | null {
  const node = currentNode(run);
  if (!MAP_ELIGIBLE_KINDS.includes(node.kind)) return null;

  const rng = rngFor(run);
  let mapId = node.mapId;
  if (!mapId) {
    mapId = pickMapId(node, data, rng);
    node.mapId = mapId;
  }
  saveRng(run, rng);

  const map = mapId ? data.maps[mapId] : undefined;
  if (!map) return null;

  const pilots: Record<Id, Pilot> = {};
  const mechs: Record<Id, Mech> = {};
  const squads: Squad[] = map.enemySquads.map((spawn) => buildEnemySquad(spawn, node.threat, data, pilots, mechs));

  if (node.kind === 'rival') {
    const rivalSquad = buildRivalSquad(map, node.threat, data, pilots, mechs);
    if (rivalSquad) squads.push(rivalSquad);
  }

  return { map, enemies: { squads, pilots, mechs } };
}

// ---------------------------------------------------------------------------
// applySalvage / recordBattle (extra exports — see file header)
// ---------------------------------------------------------------------------

/** Adds a SalvageDrop's items and scrap to run inventory. Mutates `run`. */
export function applySalvage(run: RunState, salvage: SalvageDrop): void {
  run.weapons.push(...salvage.weapons);
  run.systems.push(...salvage.systems);
  run.frames.push(...salvage.frames);
  run.scrap += salvage.scrap;
}

/**
 * Called by the UI after each battle resolved during a map. Syncs
 * post-battle player pilot/mech state back into `run`, and — only if the
 * player won — applies salvage, aptitude growth, kill counts, +2 bonds
 * between every pair of pilots in the winning squad, and +3 Nerve to every
 * participant. Mutates `run`.
 */
export function recordBattle(run: RunState, result: BattleResult, data: GameData): void {
  for (const [pilotId, pilot] of Object.entries(result.sideA.pilots)) {
    if (run.pilots[pilotId]) run.pilots[pilotId] = { ...pilot };
  }
  for (const [mechId, mech] of Object.entries(result.sideA.mechs)) {
    if (run.mechs[mechId]) run.mechs[mechId] = { ...mech };
  }

  if (result.winner !== 'A') return;

  applySalvage(run, result.salvage);

  const participantIds = Object.keys(result.sideA.pilots).filter((id) => run.pilots[id]);
  for (const pilotId of participantIds) {
    const pilot = run.pilots[pilotId];
    const def = data.pilots[pilotId];
    if (!pilot || !def) continue;
    const gains = result.growth[pilotId];
    if (gains) applyGrowth(pilot, gains, def);
    pilot.kills += result.killsByPilot[pilotId] ?? 0;
    pilot.battles += 1;
    regenNerve(pilot, 3);
    pilot.ace = isAce(pilot);
  }

  for (let i = 0; i < participantIds.length; i++) {
    for (let j = i + 1; j < participantIds.length; j++) {
      const a = run.pilots[participantIds[i]];
      const b = run.pilots[participantIds[j]];
      if (a && b) addBond(a, b, 2);
    }
  }
}

// ---------------------------------------------------------------------------
// finishMap
// ---------------------------------------------------------------------------

/**
 * Ends the current map: copies player pilots/mechs back from `world`,
 * unassigns/removes destroyed mechs (keeping recoverable wrecks at 1 HP),
 * injures pilots ejected this map, marks dead pilots, applies objective
 * rewards/penalties, ticks prior injuries, and updates run status. Per-battle
 * salvage/growth/bonds are assumed already applied via `recordBattle` for
 * each battle fought on the map — this function only handles
 * objectives/deaths/status. Mutates `run`.
 */
export function finishMap(run: RunState, world: WorldState, map: MapDef, data: GameData): RunHistoryEntry {
  const node = currentNode(run);

  // Decrement injuries accrued from previous maps before this map's own
  // ejections are set below.
  tickInjuries(run.pilots);

  const aliveBefore = new Set(Object.keys(run.pilots).filter((id) => run.pilots[id].alive));

  for (const pilotId of Object.keys(run.pilots)) {
    const worldPilot = world.pilots[pilotId];
    if (worldPilot) run.pilots[pilotId] = { ...worldPilot };
  }
  for (const mechId of Object.keys(run.mechs)) {
    const worldMech = world.mechs[mechId];
    if (worldMech) run.mechs[mechId] = { ...worldMech };
  }

  const recoverableMechIds = new Set(
    (world.lastBattle?.mechsLost ?? []).filter((m) => m.side === 'A' && m.recoverable).map((m) => m.mechId)
  );

  const ejectedPilotIds = new Set<Id>();
  for (const [mechId, mech] of Object.entries(run.mechs)) {
    if (!mech.destroyed) continue;
    for (const squad of run.squads) {
      for (let i = 0; i < squad.slots.length; i++) {
        const slot = squad.slots[i];
        if (slot?.mechId === mechId) {
          ejectedPilotIds.add(slot.pilotId);
          squad.slots[i] = null;
        }
      }
    }
    if (recoverableMechIds.has(mechId)) {
      mech.destroyed = false;
      mech.hp = 1;
    } else {
      delete run.mechs[mechId];
    }
  }

  for (const pilotId of ejectedPilotIds) {
    const pilot = run.pilots[pilotId];
    if (pilot && pilot.alive) pilot.injuredFor = 1;
  }

  const pilotDeathsThisMap: Id[] = [];
  for (const [pilotId, pilot] of Object.entries(run.pilots)) {
    if (pilot.alive) continue;
    if (aliveBefore.has(pilotId)) pilotDeathsThisMap.push(pilotId);
    for (const squad of run.squads) {
      for (let i = 0; i < squad.slots.length; i++) {
        if (squad.slots[i]?.pilotId === pilotId) squad.slots[i] = null;
      }
    }
  }

  for (const squad of run.squads) {
    if (squad.leaderPilotId && !squad.slots.some((s) => s?.pilotId === squad.leaderPilotId)) {
      const next = squad.slots.find((s) => s !== null);
      squad.leaderPilotId = next ? next.pilotId : null;
    }
  }

  let scrapGained = 0;
  const objectiveDefs = new Map(map.objectives.map((o) => [o.id, o]));
  for (const state of Object.values(world.objectives)) {
    const def = objectiveDefs.get(state.id);
    if (!def) continue;
    if (state.status === 'complete') {
      scrapGained += def.reward.scrap;
      run.standing = clamp(run.standing + def.reward.standing, 0, 100);
      for (const pilot of Object.values(run.pilots)) {
        if (pilot.alive) regenNerve(pilot, def.reward.nerve);
      }
      if (def.reward.recruitPilotId && !run.pilots[def.reward.recruitPilotId] && data.pilots[def.reward.recruitPilotId]) {
        run.pilots[def.reward.recruitPilotId] = createPilot(data.pilots[def.reward.recruitPilotId]);
      }
    } else if (state.status === 'failed' && def.required) {
      run.standing = clamp(run.standing - 10, 0, 100);
    }
  }
  run.scrap += scrapGained;

  if (world.outcome === 'victory') node.cleared = true;

  const livingPilots = Object.values(run.pilots).filter((p) => p.alive);
  const flyableMechExists = livingPilots.some((p) =>
    Object.values(run.mechs).some((m) => {
      if (m.destroyed) return false;
      const frame = data.frames[m.frameId];
      return !!frame && canPilotFly(p, frame);
    })
  );

  if (node.kind === 'boss' && world.outcome === 'victory') {
    run.status = 'won';
  } else if (livingPilots.length === 0 || !flyableMechExists) {
    run.status = 'lost';
  } else {
    run.status = 'active';
  }

  const entry: RunHistoryEntry = {
    nodeId: run.currentNodeId,
    kind: node.kind,
    outcome: world.outcome ?? 'unknown',
    pilotDeaths: pilotDeathsThisMap,
    scrapGained,
  };
  run.history.push(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Distress / salvage / depot nodes
// ---------------------------------------------------------------------------

/** Applies a distress choice's outcome to the run. Returns the outcome's narration text. Mutates `run`. */
export function resolveDistress(run: RunState, choiceId: Id, data: GameData): string {
  const node = currentNode(run);
  const eventDef = node.eventId ? data.events[node.eventId] : undefined;
  const choice = eventDef?.choices.find((c) => c.id === choiceId);
  if (!choice) return '';
  const outcome = choice.outcome;

  const rng = rngFor(run);

  if (outcome.scrap) run.scrap = Math.max(0, run.scrap + outcome.scrap);
  if (outcome.standing) run.standing = clamp(run.standing + outcome.standing, 0, 100);
  if (outcome.nerve) {
    for (const pilot of Object.values(run.pilots)) {
      if (pilot.alive) regenNerve(pilot, outcome.nerve);
    }
  }
  if (outcome.weapon) run.weapons.push(outcome.weapon);
  if (outcome.system) run.systems.push(outcome.system);
  if (outcome.frame) run.frames.push(outcome.frame);
  if (outcome.recruitPilotId && !run.pilots[outcome.recruitPilotId] && data.pilots[outcome.recruitPilotId]) {
    run.pilots[outcome.recruitPilotId] = createPilot(data.pilots[outcome.recruitPilotId]);
  }
  if (outcome.injurePilot) {
    const living = Object.values(run.pilots).filter((p) => p.alive && p.injuredFor === 0);
    if (living.length) rng.pick(living).injuredFor = 1;
  }
  if (outcome.damageRandomMech) {
    const alive = Object.values(run.mechs).filter((m) => !m.destroyed);
    if (alive.length) {
      const mech = rng.pick(alive);
      mech.hp = Math.max(1, mech.hp - outcome.damageRandomMech);
    }
  }

  node.cleared = true;
  saveRng(run, rng);
  return choice.outcome.text;
}

/** Rolls salvage for a Salvage Field node and adds it to inventory. Mutates `run`. */
export function salvageNode(run: RunState, data: GameData): SalvageDrop {
  const rng = rngFor(run);

  const weaponPool = Object.values(data.weapons).filter((w) => w.unlockedByDefault).map((w) => w.id);
  const systemPool = Object.values(data.systems).filter((s) => s.unlockedByDefault).map((s) => s.id);
  const framePool = Object.values(data.frames).filter((f) => f.unlockedByDefault).map((f) => f.id);

  const drop: SalvageDrop = { weapons: [], systems: [], frames: [], scrap: 30 };
  for (let i = 0; i < 2 && weaponPool.length; i++) drop.weapons.push(rng.pick(weaponPool));
  if (systemPool.length) drop.systems.push(rng.pick(systemPool));
  if (framePool.length && rng.chance(0.15)) drop.frames.push(rng.pick(framePool));

  applySalvage(run, drop);
  currentNode(run).cleared = true;
  saveRng(run, rng);
  return drop;
}

const DEPOT_BASE_COST = { weapon: 40, system: 55, frame: 120 };

/** Depot stock and prices, seeded by node id + run seed so repeat visits (or reloads) see the same offer. Pure. */
export function depotStock(
  run: RunState,
  data: GameData
): { weapons: { id: Id; cost: number }[]; systems: { id: Id; cost: number }[]; frames: { id: Id; cost: number }[] } {
  const rng = new Rng(hashString(`${run.currentNodeId}:${run.seed}`));
  const discount = run.standing >= 70 ? 0.8 : 1;

  const weaponPool = Object.values(data.weapons).filter((w) => w.unlockedByDefault).map((w) => w.id);
  const systemPool = Object.values(data.systems).filter((s) => s.unlockedByDefault).map((s) => s.id);
  const framePool = Object.values(data.frames).filter((f) => f.unlockedByDefault).map((f) => f.id);

  const pickN = (pool: Id[], n: number): Id[] => rng.shuffle([...pool]).slice(0, n);

  return {
    weapons: pickN(weaponPool, 3).map((id) => ({ id, cost: Math.round(DEPOT_BASE_COST.weapon * discount) })),
    systems: pickN(systemPool, 2).map((id) => ({ id, cost: Math.round(DEPOT_BASE_COST.system * discount) })),
    frames: pickN(framePool, 1).map((id) => ({ id, cost: Math.round(DEPOT_BASE_COST.frame * discount) })),
  };
}

/** Buys one depot item at `cost` (from a prior `depotStock` call). Mutates `run`. */
export function depotBuy(run: RunState, kind: 'weapon' | 'system' | 'frame', itemId: Id, cost: number): { ok: boolean; reason?: string } {
  if (run.scrap < cost) return { ok: false, reason: 'Insufficient scrap' };
  run.scrap -= cost;
  if (kind === 'weapon') run.weapons.push(itemId);
  else if (kind === 'system') run.systems.push(itemId);
  else run.frames.push(itemId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// applyRunEnd
// ---------------------------------------------------------------------------

/** New meta-unlocks after a run ends. Pure — returns a new Unlocks, doesn't mutate the input. */
export function applyRunEnd(unlocks: Unlocks, run: RunState, data: GameData): Unlocks {
  const next: Unlocks = {
    pilots: [...unlocks.pilots],
    frames: [...unlocks.frames],
    weapons: [...unlocks.weapons],
    systems: [...unlocks.systems],
    events: [...unlocks.events],
    ascensionMax: unlocks.ascensionMax,
    runsAttempted: unlocks.runsAttempted + 1,
    runsWon: unlocks.runsWon,
    rivalEncounters: unlocks.rivalEncounters,
    rivalDefeats: unlocks.rivalDefeats,
    fragments: [...unlocks.fragments],
    totalPilotDeaths: unlocks.totalPilotDeaths,
  };

  if (run.status === 'won') {
    next.runsWon += 1;
    next.ascensionMax += 1;
  }

  next.totalPilotDeaths += run.history.reduce((sum, h) => sum + h.pilotDeaths.length, 0);

  const rivalEntries = run.history.filter((h) => h.kind === 'rival');
  if (rivalEntries.length) next.rivalEncounters += 1;
  const rivalWin = rivalEntries.some((h) => h.outcome === 'victory');
  if (rivalWin) next.rivalDefeats += 1;

  // Rotating unlock: weapon -> system -> frame -> weapon..., by attempt count.
  // Skips a category with nothing left to unlock and tries the next one.
  const rotation: ('weapon' | 'system' | 'frame')[] = ['weapon', 'system', 'frame'];
  const startIdx = (next.runsAttempted - 1) % 3;
  const order = [0, 1, 2].map((i) => rotation[(startIdx + i) % 3]);
  const pickRng = new Rng(hashString(`unlock:${run.seed}:${next.runsAttempted}`));
  for (const category of order) {
    const pool = category === 'weapon' ? data.weapons : category === 'system' ? data.systems : data.frames;
    const already = category === 'weapon' ? next.weapons : category === 'system' ? next.systems : next.frames;
    const locked = Object.values(pool).filter((item) => !item.unlockedByDefault && !already.includes(item.id));
    if (locked.length) {
      already.push(pickId(pickRng, locked));
      break;
    }
  }

  const bossReached = run.history.some((h) => h.kind === 'boss');
  const relayCandidates = Object.values(data.pilots)
    .filter((p) => p.faction === 'relay' && p.archetype !== 'captain' && p.archetype !== 'rival')
    .map((p) => p.id);

  if (bossReached) {
    const seventh = relayCandidates.find((id) => !next.pilots.includes(id));
    if (seventh) next.pilots.push(seventh);
  }
  if (rivalWin) {
    const eighth = relayCandidates.find((id) => !next.pilots.includes(id));
    if (eighth) next.pilots.push(eighth);
  }

  if (next.fragments.length < 10) {
    const fragId = `frag_run_${next.runsAttempted}`;
    if (!next.fragments.includes(fragId)) next.fragments.push(fragId);
  }

  return next;
}

function pickId(rng: Rng, items: { id: Id }[]): Id {
  return rng.pick(items).id;
}
