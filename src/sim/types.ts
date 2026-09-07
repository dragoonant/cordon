/**
 * CORDON — shared simulation types.
 *
 * This file is the contract between every module. The `sim/` package is pure
 * TypeScript: no DOM, no Pixi, no React, no Math.random. Renderers and UI read
 * from these structures; they never mutate them directly.
 *
 * Naming: *Def = static data loaded from src/data (immutable, id-keyed).
 *         Plain nouns (Mech, Pilot, Squad) = live instances with mutable state.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Id = string;
export type Faction = 'relay' | 'compact' | 'neutral';
export type Row = 'front' | 'back';
export type Mobility = 'space' | 'ground' | 'aerospace';
export type WeightClass = 'light' | 'medium' | 'heavy';
export type MapKind = 'space' | 'surface';

/** Surface terrain and space "terrain" share one enum so tile maps are uniform. */
export type Terrain =
  // surface
  | 'open'
  | 'forest'
  | 'urban'
  | 'mountain'
  | 'water'
  // space
  | 'void'
  | 'debris'
  | 'radiation'
  | 'gravity'
  | 'structure'
  // both
  | 'blocked';

export type Weather = 'clear' | 'rain' | 'storm' | 'dust' | 'solar_flare' | 'none';

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Hardware definitions (src/data/frames.json, weapons.json, systems.json)
// ---------------------------------------------------------------------------

export interface FrameDef {
  id: Id;
  name: string;
  faction: Faction; // who manufactures it; compact frames are salvage-only
  weightClass: WeightClass;
  mobility: Mobility;
  hp: number;
  armor: number; // flat damage reduction per hit
  evasion: number; // 0..100 base dodge
  speed: number; // map tiles per second at 1x
  generator: number; // total power budget for slots
  weight: number; // frame's own weight (informational; balance vs. speed handled in rules)
  /** Extra slot capacity beyond the standard A/B/System. Rare. */
  bonusSystemSlot?: boolean;
  spriteKey: string; // render lookup; placeholder compositor uses this
  description: string;
  /** Silhouette hint for the placeholder compositor. */
  silhouette: 'skirmish' | 'line' | 'bastion' | 'recon' | 'siege' | 'compact_ace' | 'compact_line';
  unlockedByDefault: boolean;
}

export type WeaponKind = 'melee' | 'ranged' | 'support';

export interface WeaponDef {
  id: Id;
  name: string;
  faction: Faction;
  kind: WeaponKind;
  damage: number; // per hit before armor
  hits: number; // hits per attack round
  accuracy: number; // 0..100 base
  crit: number; // 0..100 chance; crits ignore armor and x1.5
  /** Damage multiplier by row the wielder stands in. 0 = cannot attack from that row. */
  frontMult: number;
  backMult: number;
  weight: number;
  power: number; // generator draw
  /** Support weapons: heal amount per round to lowest-HP ally, instead of attacking. */
  repair?: number;
  /** Optional tags consumed by rules (e.g. 'anti_armor', 'splash', 'precise'). */
  tags: string[];
  animKey: string; // battle stage attack animation script id
  callLine?: string; // optional attack callout text ("Lance — full burn!")
  unlockedByDefault: boolean;
}

export type SystemEffectType =
  | 'shield' // absorbs first N damage per battle
  | 'booster' // +evasion, +map speed
  | 'ecm' // enemy accuracy -N
  | 'repair_drone' // heal N to self each round
  | 'recon' // forecast variance -N%, map vision +N tiles
  | 'eject' // pilot survival chance +N
  | 'armor_plate' // +armor, +weight
  | 'targeting' // +accuracy, +crit
  | 'fuel_cell'; // +fuel capacity on the map

export interface SystemDef {
  id: Id;
  name: string;
  faction: Faction;
  effect: SystemEffectType;
  value: number;
  weight: number;
  power: number;
  description: string;
  unlockedByDefault: boolean;
}

// ---------------------------------------------------------------------------
// Mech instance
// ---------------------------------------------------------------------------

export interface Mech {
  id: Id;
  frameId: Id;
  weaponA: Id | null;
  weaponB: Id | null;
  system: Id | null;
  system2?: Id | null; // only if frame.bonusSystemSlot
  hp: number;
  /** Permanent max-HP reduction for this run (e.g. "Redline it."). */
  maxHpPenalty: number;
  destroyed: boolean;
  /** Custom name the player gives it; defaults to frame name. */
  nickname?: string;
}

// ---------------------------------------------------------------------------
// Pilots
// ---------------------------------------------------------------------------

export type Aptitude = 'gunnery' | 'melee' | 'evasion' | 'systems' | 'command';
export type Aptitudes = Record<Aptitude, number>; // each 0..100

/** Certifications gate frames and callouts. Weight certs: light < medium < heavy. */
export type Certification =
  | 'cert_light'
  | 'cert_medium'
  | 'cert_heavy'
  | 'cert_vanguard'
  | 'cert_marksman'
  | 'cert_field_tech'
  | 'cert_recon'
  | 'cert_wing_lead';

export interface CertificationDef {
  id: Certification;
  name: string;
  description: string;
  /** All thresholds must be met. */
  requires: Partial<Aptitudes>;
  requiresCerts: Certification[];
  grantsCallouts: Id[];
}

export type PilotArchetype =
  | 'veteran'
  | 'hotshot'
  | 'marksman'
  | 'rookie'
  | 'engineer'
  | 'scout'
  | 'salvager'
  | 'wildcard'
  | 'rival'
  | 'captain'
  | 'compact_grunt';

/** Battle/story line pools keyed by event. Text only unless the id appears in voice manifest. */
export interface PilotLines {
  deploy: string[];
  attack: string[];
  crit: string[];
  kill: string[];
  hit: string[];
  allyDown: string[];
  victory: string[];
  retreat: string[];
  rivalContact?: string[];
  finisher: string; // the named finisher callout
  finisherName: string;
}

export interface PilotDef {
  id: Id;
  name: string;
  callsign: string;
  archetype: PilotArchetype;
  faction: Faction;
  baseAptitudes: Aptitudes;
  /** Growth multiplier per aptitude; rookie grows fast, veteran slow. */
  growth: Aptitudes;
  startingCerts: Certification[];
  /** Callouts known at start, beyond those granted by certs. */
  startingCallouts: Id[];
  lastTransmissionId: Id; // a CalloutDef with kind 'last'
  maxNerve: number;
  portraitKey: string;
  voiceKey: string; // ElevenLabs voice id/name mapping in tools/voice
  bio: string;
  lines: PilotLines;
  unlockedByDefault: boolean;
  /** Bond partners that unlock tandem callouts at bond >= threshold. */
  bondPartners: { pilotId: Id; tandemCalloutId: Id; threshold: number }[];
}

export interface Pilot {
  id: Id; // === PilotDef.id
  aptitudes: Aptitudes;
  certs: Certification[];
  callouts: Id[]; // known callout ids (excluding last transmission)
  kills: number;
  battles: number;
  nerve: number;
  maxNerve: number;
  alive: boolean;
  /** Maps remaining before an injured pilot can deploy again. 0 = ready. */
  injuredFor: number;
  ace: boolean;
  bonds: Record<Id, number>; // other pilot id -> bond points
  morale: number; // 0..100 personal morale; feeds squad morale
}

// ---------------------------------------------------------------------------
// Squads & formation
// ---------------------------------------------------------------------------

/** Formation grid: indices 0,1,2 = front row (left→right); 3,4,5 = back row. */
export const FRONT_SLOTS = [0, 1, 2] as const;
export const BACK_SLOTS = [3, 4, 5] as const;
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5;
export function rowOf(slot: SlotIndex): Row {
  return slot < 3 ? 'front' : 'back';
}

export interface SlotAssignment {
  pilotId: Id;
  mechId: Id;
}

export type SquadState = 'idle' | 'moving' | 'engaged' | 'returning' | 'routed' | 'destroyed' | 'docked';

export interface Squad {
  id: Id;
  name: string;
  faction: Faction;
  leaderPilotId: Id | null;
  slots: (SlotAssignment | null)[]; // length 6
  pos: Vec2; // tile coordinates, fractional
  path: Vec2[]; // remaining waypoints (tile centers)
  targetPos: Vec2 | null;
  fuel: number;
  maxFuel: number;
  morale: number; // 0..100
  state: SquadState;
  /** Per-map cooldown after a battle before it can re-engage (seconds). */
  engageCooldown: number;
  /** Active overworld callout effects with remaining seconds. */
  effects: SquadEffect[];
  /** AI hint for enemy squads. */
  ai?: EnemyAi;
  /** Set when this squad is attached to an objective (convoy escort). */
  escortingObjectiveId?: Id | null;
}

export interface SquadEffect {
  type: 'burn' | 'rest' | 'bait' | 'rallied' | 'revealed' | 'pinged' | 'escort' | 'marked';
  remaining: number; // seconds
  magnitude?: number;
  sourcePilotId?: Id;
}

export interface EnemyAi {
  behavior: 'patrol' | 'guard' | 'hunt' | 'intercept_objective' | 'boss';
  patrolPoints?: Vec2[];
  patrolIndex?: number;
  aggroRadius: number; // tiles
  homePos: Vec2;
}

// ---------------------------------------------------------------------------
// Callouts (the command system)
// ---------------------------------------------------------------------------

export type CalloutKind = 'prebattle' | 'overworld' | 'last' | 'tandem';

/**
 * Effect ids are interpreted by sim/callouts/*. Keep this a closed union so
 * battle.ts and world.ts can switch exhaustively.
 */
export type CalloutEffect =
  // prebattle
  | 'eyes_on' // exact forecast, reveal enemy loadout
  | 'break_formation' // ignore row multipliers (use 1.0), lose row defense bonus
  | 'redline' // +60% damage, permanent maxHpPenalty
  | 'on_me' // redirect attacks aimed at target ally to caster
  | 'punch_out' // guaranteed eject if destroyed
  | 'first_ones_mine' // caster acts first round 1, evasion 0 round 1
  | 'chain_it' // first kill grants squad follow-up attacks
  | 'sell_it' // enemy targets wrong row round 1
  | 'we_hold' // no rout; survivors +morale
  // overworld
  | 'burn_hard' // 2x speed 30s, 3x fuel, then rest 15s
  | 'ping_sector' // reveal enemies in radius 20s; they're alerted
  | 'rally_channel' // allies in range +morale, caster -morale
  | 'fall_back' // instant disengage to nearest friendly point, flat damage
  | 'come_get_some' // enemies in range drawn to caster 20s
  | 'stay_with_them' // attach to convoy; target invulnerable while squad lives
  // last transmissions (unique per pilot)
  | 'lt_dont_stop' // all friendly squads 2x speed 30s + full nerve
  | 'lt_marking_them' // killer squad revealed + marked (+30% dmg taken) for run
  | 'lt_take_the_frame' // mech becomes recoverable wreck, all slots salvageable
  | 'lt_got_the_shot' // final attack fires at full power, ignores evasion
  | 'lt_hold_them_here' // enemy squad is frozen 20s on the map
  | 'lt_tell_them' // every pilot's bonds with the deceased convert to permanent +aptitude
  | 'lt_light_it_up' // all enemy squads on the map revealed for the rest of the map
  | 'lt_go_home' // every friendly squad's fuel refilled
  // tandem
  | 'td_cross_fire' // two back-row pilots: combined guaranteed hit
  | 'td_switch' // front/back pair swap rows after round 1
  | 'td_got_your_six' // A's lethal hit intercepted by B at half damage once
  | 'td_double_time'; // pair's mechs both act twice in round 1

export interface CalloutDef {
  id: Id;
  effect: CalloutEffect;
  kind: CalloutKind;
  /** The spoken line, in pilot voice. e.g. "Eyes on." */
  line: string;
  /** Short UI label, e.g. "Eyes On". */
  label: string;
  description: string;
  tradeoff: string; // the cost, in plain words, shown in UI
  nerveCost: number;
  requiresCert?: Certification;
  /** Prebattle: does it need a target ally slot? */
  needsAllyTarget?: boolean;
  /** Overworld: radius in tiles, duration in seconds where relevant. */
  radius?: number;
  duration?: number;
}

/** A callout the player has committed to for the upcoming battle. */
export interface ActiveCallout {
  calloutId: Id;
  pilotId: Id;
  partnerPilotId?: Id; // tandem
  targetPilotId?: Id; // on_me
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

export interface BattleContext {
  seed: number;
  mapKind: MapKind;
  terrain: Terrain;
  weather: Weather;
  /** Prebattle callouts declared by each side. Enemy AI may declare its own. */
  calloutsA: ActiveCallout[];
  calloutsB: ActiveCallout[];
  /** Squad-level flags from the map (e.g. 'marked' effect). */
  markedSquadIds?: Id[];
  rounds?: number; // default from rules (6)
}

/** Everything the resolver needs, passed by value. Resolver must not mutate inputs. */
export interface BattleSide {
  squad: Squad;
  pilots: Record<Id, Pilot>;
  mechs: Record<Id, Mech>;
}

export type BattleEvent =
  | { t: 'start'; sideA: Id; sideB: Id; terrain: Terrain; weather: Weather; mapKind: MapKind }
  | { t: 'callout'; side: 'A' | 'B'; pilotId: Id; calloutId: Id; line: string; partnerPilotId?: Id }
  | { t: 'round'; n: number }
  | {
      t: 'attack';
      side: 'A' | 'B';
      attackerPilotId: Id;
      attackerMechId: Id;
      defenderPilotId: Id;
      defenderMechId: Id;
      weaponId: Id;
      hits: { hit: boolean; damage: number; crit: boolean }[];
      totalDamage: number;
      defenderHpAfter: number;
      killed: boolean;
      /** True if this attack is a follow-up (chain_it) or support/tandem. */
      followUp?: boolean;
      tandemCalloutId?: Id;
      line?: string; // attacker banter chosen by resolver (text)
    }
  | { t: 'repair'; side: 'A' | 'B'; pilotId: Id; mechId: Id; targetMechId: Id; amount: number }
  | { t: 'shield'; side: 'A' | 'B'; mechId: Id; absorbed: number }
  | { t: 'intercept'; side: 'A' | 'B'; protectorPilotId: Id; protectedPilotId: Id; calloutId: Id }
  | {
      t: 'destroyed';
      side: 'A' | 'B';
      mechId: Id;
      pilotId: Id;
      pilotDied: boolean;
      ejected: boolean;
      line?: string; // ally reaction (text)
    }
  | { t: 'last_transmission'; side: 'A' | 'B'; pilotId: Id; calloutId: Id; line: string; effect: CalloutEffect }
  | { t: 'cutin'; side: 'A' | 'B'; pilotId: Id; kind: 'crit' | 'kill' | 'callout' | 'finisher' | 'last'; line: string }
  | { t: 'finisher'; side: 'A' | 'B'; pilotId: Id; name: string; line: string }
  | { t: 'morale'; side: 'A' | 'B'; delta: number; reason: string }
  | { t: 'rout'; side: 'A' | 'B'; reason: string }
  | { t: 'end'; winner: 'A' | 'B' | 'draw'; reason: 'annihilation' | 'rout' | 'rounds' };

export interface SalvageDrop {
  weapons: Id[];
  systems: Id[];
  frames: Id[];
  scrap: number; // currency
}

export interface BattleResult {
  seed: number;
  winner: 'A' | 'B' | 'draw';
  events: BattleEvent[];
  /** Post-battle state, deep-copied. */
  sideA: BattleSide;
  sideB: BattleSide;
  pilotDeaths: { side: 'A' | 'B'; pilotId: Id }[];
  mechsLost: { side: 'A' | 'B'; mechId: Id; recoverable: boolean }[];
  /** Salvage the winner receives. Empty if draw. */
  salvage: SalvageDrop;
  /** Aptitude gains for side A pilots (player). */
  growth: Record<Id, Partial<Aptitudes>>;
  killsByPilot: Record<Id, number>;
}

export interface ForecastPerMech {
  pilotId: Id;
  mechId: Id;
  expectedDamageTaken: number;
  destroyRisk: number; // 0..1
  pilotDeathRisk: number; // 0..1
  expectedDamageDealt: number;
  expectedKills: number;
}

export interface Forecast {
  winProb: number;
  drawProb: number;
  lossProb: number;
  expectedDamageDealt: number;
  expectedDamageTaken: number;
  perMech: ForecastPerMech[];
  /** 0..1 width of the uncertainty band; 0 when 'eyes_on' is active. */
  variance: number;
  exact: boolean;
  samples: number;
  modifiers: { label: string; value: string; good: boolean | null }[];
}

// ---------------------------------------------------------------------------
// Maps & objectives (the real-time layer)
// ---------------------------------------------------------------------------

export type ObjectiveKind =
  | 'evac_station' // hold within radius for holdSeconds
  | 'evac_colony' // same, bigger, more reward
  | 'convoy' // escort moving target along path to exit
  | 'derelict' // reach & hold briefly; salvage; may spawn ambush
  | 'relay' // capture: reveals enemies map-wide
  | 'destroy_target' // kill a specific enemy squad (boss)
  | 'reach_exit' // get any squad to a point
  | 'capture_site'; // territory: flips owner, pays income, can gate reinforcements

/** Who currently holds a capture_site. */
export type SiteOwner = 'player' | 'enemy' | 'neutral';

export type ObjectiveStatus = 'pending' | 'active' | 'complete' | 'failed';

export interface ObjectiveDef {
  id: Id;
  kind: ObjectiveKind;
  name: string;
  pos: Vec2;
  radius: number; // tiles
  holdSeconds?: number;
  path?: Vec2[]; // convoy route
  convoySpeed?: number;
  hp?: number; // for convoy / station being attacked
  targetSquadId?: Id; // destroy_target
  required: boolean; // failing a required objective fails the map
  ambushSquadIds?: Id[]; // derelict
  reward: { scrap: number; nerve: number; standing: number; recruitPilotId?: Id; salvageRolls: number };

  // --- capture_site (territory) ---------------------------------------
  /** Seconds of uncontested presence to flip ownership. Default RULES value. */
  captureSeconds?: number;
  /** Who holds it when the map starts. Default 'neutral'. */
  startOwner?: SiteOwner;
  /** Scrap per minute paid out while the player holds it. */
  incomePerMin?: number;
  /** Extra vision radius granted to the player while held. */
  siteVision?: number;
  /**
   * Reinforcement gate: while an *enemy* holds this site, these enemy spawns
   * keep respawning. Capturing it shuts the flow off.
   */
  gateSquadIds?: Id[];
  /** Seconds between gate respawns. Default RULES value. */
  gateIntervalSeconds?: number;
}

export interface ObjectiveState {
  id: Id;
  status: ObjectiveStatus;
  progress: number; // 0..1
  hp?: number;
  pos: Vec2; // current (convoys move)
  pathIndex?: number;
  // --- capture_site ---
  /** Current holder. Undefined for non-site objectives. */
  owner?: SiteOwner;
  /**
   * Capture meter, 0..1, always measured *toward whoever is standing on it*.
   * Both sides present = contested, meter frozen.
   */
  capture?: number;
  /** Side the capture meter is currently filling for. */
  capturingFor?: SiteOwner;
  /** Both sides present right now — surfaced so the HUD can say "CONTESTED". */
  contested?: boolean;
  /** Seconds until this gate spawns its next wave (gate sites only). */
  gateTimer?: number;
}

export interface MapDef {
  id: Id;
  name: string;
  kind: MapKind;
  width: number; // tiles
  height: number;
  tiles: Terrain[][]; // [y][x]
  weather: Weather;
  deployZone: { pos: Vec2; radius: number }; // carrier or landing zone
  carrierOnMap: boolean; // space maps: Lantern is present & attackable
  objectives: ObjectiveDef[];
  enemySquads: EnemySquadSpawn[];
  timeLimit: number; // seconds; 0 = none
  /**
   * Territory maps: an alternative win condition — hold `sites` capture_sites
   * simultaneously for `holdSeconds`. Satisfying this wins the map outright,
   * in parallel with the ordinary required-objective route.
   */
  controlWin?: { sites: number; holdSeconds: number };
  /** Minimum seconds the map must last before exit is allowed (0 = none). */
  description: string;
  briefing: string; // Captain's line
}

export interface EnemySquadSpawn {
  id: Id;
  name: string;
  /** Composition; instantiated by run.ts using difficulty. */
  composition: { frameId: Id; weaponA: Id | null; weaponB: Id | null; system: Id | null; pilotDefId: Id; slot: SlotIndex }[];
  pos: Vec2;
  ai: EnemyAi;
  /** Spawn after N seconds (reinforcements). 0 = at start. */
  spawnAt: number;
  isBoss?: boolean;
  isRival?: boolean;
}

export type WorldEvent =
  | { t: 'deployed'; squadId: Id }
  | { t: 'contact'; squadAId: Id; squadBId: Id }
  | { t: 'battle_resolved'; squadAId: Id; squadBId: Id; winner: 'A' | 'B' | 'draw' }
  | { t: 'objective'; objectiveId: Id; status: ObjectiveStatus }
  | { t: 'callout'; squadId: Id; pilotId: Id; calloutId: Id; line: string }
  | { t: 'last_transmission'; pilotId: Id; calloutId: Id; line: string }
  | { t: 'squad_destroyed'; squadId: Id }
  | { t: 'fell_back'; squadId: Id; fromSquadId: Id; standingCost: number }
  | { t: 'rival_contact'; pilotId: Id; line: string }
  | { t: 'site_captured'; objectiveId: Id; owner: SiteOwner }
  | { t: 'gate_reinforcement'; objectiveId: Id; squadId: Id }
  | { t: 'squad_docked'; squadId: Id }
  | { t: 'spawn'; squadId: Id }
  | { t: 'carrier_hit'; damage: number; hpAfter: number }
  | { t: 'captain'; line: string } // narrative interjection
  | { t: 'map_end'; outcome: 'victory' | 'defeat' | 'withdraw' };

export type WorldPhase = 'deploy' | 'running' | 'battle_pending' | 'battle' | 'ended';

export interface PendingBattle {
  squadAId: Id; // player
  squadBId: Id; // enemy
  terrain: Terrain;
  /** Player's committed prebattle callouts (set by UI before resolve). */
  callouts: ActiveCallout[];
}

export interface WorldState {
  mapId: Id;
  tick: number;
  time: number; // seconds elapsed
  speed: 0 | 1 | 2 | 4;
  phase: WorldPhase;
  squads: Record<Id, Squad>;
  /** Both factions' pilots and mechs for the duration of the map. run.ts copies
   *  the player's back into RunState on map end. */
  pilots: Record<Id, Pilot>;
  mechs: Record<Id, Mech>;
  objectives: Record<Id, ObjectiveState>;
  /** Enemy squad ids currently visible to the player. */
  visibleEnemyIds: Id[];
  pendingBattle: PendingBattle | null;
  lastBattle: BattleResult | null;
  carrierHp: number;
  carrierMaxHp: number;
  outcome: 'victory' | 'defeat' | 'withdraw' | null;
  /** Ring buffer of recent events for the renderer/UI to consume. */
  events: WorldEvent[];
  rngState: number;
  /** Spawns that haven't happened yet. */
  pendingSpawns: Id[];
  /** Scrap accrued from held capture_sites; finishMap folds it into the run. */
  siteScrap: number;
  /** Seconds the control-win threshold has been satisfied continuously. */
  controlHeldFor: number;
}

// ---------------------------------------------------------------------------
// Run (roguelite layer)
// ---------------------------------------------------------------------------

export type NodeKind = 'battle' | 'rescue' | 'distress' | 'salvage' | 'depot' | 'rival' | 'boss' | 'start';

export interface RunNode {
  id: Id;
  kind: NodeKind;
  mapKind: MapKind;
  col: number; // 0 = start, increasing toward boss
  row: number;
  edges: Id[]; // ids of reachable next-column nodes
  mapId?: Id; // for battle-type nodes
  eventId?: Id; // for distress
  visited: boolean;
  cleared: boolean;
  label: string;
  threat: 1 | 2 | 3; // shown to player
}

export interface RunSector {
  index: number;
  name: string;
  nodes: RunNode[];
  bossNodeId: Id;
}

export interface DistressChoice {
  id: Id;
  text: string;
  /** Resolved by run.ts; keep data-driven. */
  outcome: {
    scrap?: number;
    nerve?: number;
    standing?: number;
    weapon?: Id;
    system?: Id;
    frame?: Id;
    recruitPilotId?: Id;
    injurePilot?: boolean;
    damageRandomMech?: number;
    text: string;
  };
}

export interface DistressEventDef {
  id: Id;
  title: string;
  text: string; // Captain relays it
  choices: DistressChoice[];
}

export interface RunState {
  seed: number;
  ascension: number;
  sectorIndex: number;
  sectors: RunSector[]; // generated lazily or up-front; length 1 for M2 slice
  currentNodeId: Id;
  pilots: Record<Id, Pilot>;
  mechs: Record<Id, Mech>;
  /** Unequipped inventory. */
  weapons: Id[];
  systems: Id[];
  frames: Id[]; // spare frames not yet built into mechs
  squads: Squad[]; // player squads (formation persists between maps)
  scrap: number;
  standing: number; // 0..100 reputation
  turn: number; // nodes visited
  history: RunHistoryEntry[];
  status: 'active' | 'won' | 'lost';
  /** Squad ids marked by 'lt_marking_them' for the run. */
  markedEnemySquadIds: Id[];
  /** Deployment squads used in the current map (set when entering). */
  rngState: number;
}

export interface RunHistoryEntry {
  nodeId: Id;
  kind: NodeKind;
  outcome: string;
  pilotDeaths: Id[];
  scrapGained: number;
}

// ---------------------------------------------------------------------------
// Meta progression (persists across runs)
// ---------------------------------------------------------------------------

export interface Unlocks {
  pilots: Id[];
  frames: Id[];
  weapons: Id[];
  systems: Id[];
  events: Id[];
  ascensionMax: number;
  runsAttempted: number;
  runsWon: number;
  rivalEncounters: number;
  rivalDefeats: number;
  /** Story fragments seen. */
  fragments: Id[];
  totalPilotDeaths: number;
}

export interface SaveData {
  version: number;
  unlocks: Unlocks;
  activeRun: RunState | null;
  /** If a map was in progress when saved. */
  activeWorld: WorldState | null;
  settings: Settings;
}

export interface Settings {
  battleSpeed: 'full' | 'fast' | 'results_only';
  voice: boolean;
  music: number; // 0..1
  sfx: number;
  autoPauseOnContact: boolean;
  /** Whether the player has completed or skipped the first-map coach-mark tutorial. */
  tutorialSeen?: boolean;
}

// ---------------------------------------------------------------------------
// Static data bundle (what src/data/index.ts exports)
// ---------------------------------------------------------------------------

export interface GameData {
  frames: Record<Id, FrameDef>;
  weapons: Record<Id, WeaponDef>;
  systems: Record<Id, SystemDef>;
  pilots: Record<Id, PilotDef>;
  callouts: Record<Id, CalloutDef>;
  certs: Record<Certification, CertificationDef>;
  maps: Record<Id, MapDef>;
  events: Record<Id, DistressEventDef>;
  captainLines: {
    briefing: string[];
    victory: string[];
    defeat: string[];
    pilotLost: string[];
    objectiveFailed: string[];
    objectiveComplete: string[];
    rivalAppears: string[];
    runStart: string[];
    runWon: string[];
    runLost: string[];
  };
}
