# CORDON — Simulation API Contract

Every module below exports exactly these signatures (additional helpers are fine). UI and renderers code against this file. If you must change a signature, say so loudly in your report.

All functions take `data: GameData` explicitly — no module-level singletons. Functions marked **mutates** modify their first argument in place; all others return new values and leave inputs untouched.

---

## `src/sim/rules.ts` — constants & formulas (owned by battle-sim)

```ts
export const RULES: {
  ROUNDS: number;                 // 6
  SQUAD_SLOTS: number;            // 6
  ROW_DEFENSE_BONUS: number;      // back row takes x0.6 damage while any front-row mech lives
  CRIT_MULT: number;              // 1.5
  ACE_KILLS: number;              // 8 — pilot becomes ace
  MORALE_ROUT_THRESHOLD: number;  // 20 — squad routs below this at round end
  BASE_EJECT_CHANCE: number;      // 0.55
  OVERWEIGHT_EVASION_PENALTY: number; // per 10% over generator
  // ...
};
export function terrainModifiers(terrain: Terrain, mapKind: MapKind, mobility: Mobility): { accuracy: number; evasion: number; damage: number; speedMult: number };
export function weatherModifiers(weather: Weather, kind: WeaponKind): { accuracy: number; damage: number };
export function mobilityPenalty(mobility: Mobility, mapKind: MapKind): { evasion: number; speedMult: number; accuracy: number };
export function mechLoad(mech: Mech, data: GameData): { weight: number; power: number; generator: number; overPower: boolean; loadRatio: number };
export function effectiveStats(pilot: Pilot, mech: Mech, data: GameData, ctx: { terrain: Terrain; mapKind: MapKind; weather: Weather }): { hp: number; maxHp: number; armor: number; evasion: number; accuracyBonus: number; damageMult: number };
```

Damage formula (per hit): `raw = weapon.damage * rowMult * damageMult(terrain, callouts, aptitude)`; if crit: `raw * CRIT_MULT`, ignore armor; else `max(1, raw - armor)`. Hit chance: `clamp(weapon.accuracy + gunnery_or_melee*0.3 + accuracyBonus - defenderEvasion*0.5 - ecm, 5, 95)`. Back-row defenders take `ROW_DEFENSE_BONUS` while a front-row ally lives. Targeting: attacker picks a random living enemy weighted 3:1 toward the opposite front row (melee) or evenly (ranged); `sell_it` inverts for round 1; `on_me` redirects.

## `src/sim/battle.ts` (battle-sim)

```ts
export function resolveBattle(sideA: BattleSide, sideB: BattleSide, ctx: BattleContext, data: GameData): BattleResult;
```
Deterministic from `ctx.seed`. Does not mutate inputs. Emits the full `BattleEvent[]` including `cutin` events for crits/kills/callouts/finishers/last transmissions, `line` text on attacks (from `PilotDef.lines`, chosen via rng), and `end`. Applies aptitude growth (`result.growth`) for side A only. Rolls salvage for the winner. Handles every `CalloutEffect` of kind `prebattle`, `tandem`, and the `last` effects that act in-battle (`lt_got_the_shot`, `lt_take_the_frame`); overworld-affecting last transmissions are reported in events and applied by world.ts via `applyBattleResult`.

## `src/sim/forecast.ts` (battle-sim)

```ts
export function forecast(sideA: BattleSide, sideB: BattleSide, ctx: BattleContext, data: GameData, samples?: number): Forecast;
```
Runs `resolveBattle` `samples` times (default 200) with seeds derived from `ctx.seed`. If `eyes_on` is among `ctx.calloutsA`, returns `exact: true`, `variance: 0`, and uses the true seed once. Otherwise `variance` shrinks with leader's `systems` aptitude and `recon` systems. Populates `modifiers` with human-readable rows (terrain, weather, mobility fit, overweight, callouts).

## `src/sim/pathfind.ts` (world-sim)

```ts
export function findPath(map: MapDef, from: Vec2, to: Vec2, mobility: Mobility): Vec2[]; // tile centers, [] if unreachable
export function terrainAt(map: MapDef, pos: Vec2): Terrain;
export function isPassable(terrain: Terrain, mobility: Mobility, mapKind: MapKind): boolean;
export function moveCost(terrain: Terrain, mobility: Mobility, mapKind: MapKind): number; // multiplier, 1 = normal
```

## `src/sim/world.ts` (world-sim)

```ts
export interface SideBundle { squads: Squad[]; pilots: Record<Id, Pilot>; mechs: Record<Id, Mech>; }
export function createWorld(map: MapDef, seed: number, data: GameData, player: SideBundle, enemies: SideBundle): WorldState;
// Player squads start 'docked' (not on map). Enemy squads with spawnAt 0 are placed; others go to pendingSpawns.

export function stepWorld(world: WorldState, map: MapDef, dtReal: number, data: GameData): void;   // mutates
// Advances world.time by dtReal * world.speed. Only acts when phase === 'running'. Handles movement along paths,
// fuel drain, squad effects, enemy AI, objectives (all kinds), spawns, visibility, carrier attacks, contact
// detection (→ phase 'battle_pending', sets pendingBattle), win/lose → phase 'ended', outcome set.
// Pushes WorldEvents. Caps world.events at 200 (drop oldest).

export function deploySquad(world: WorldState, map: MapDef, squadId: Id, data: GameData): { ok: boolean; reason?: string }; // mutates
export function orderMove(world: WorldState, map: MapDef, squadId: Id, target: Vec2, data: GameData): { ok: boolean; reason?: string }; // mutates
export function orderReturn(world: WorldState, map: MapDef, squadId: Id, data: GameData): { ok: boolean; reason?: string }; // mutates; path to deploy zone; docks & refuels on arrival
export function setSpeed(world: WorldState, speed: 0 | 1 | 2 | 4): void; // mutates
export function useOverworldCallout(world: WorldState, map: MapDef, squadId: Id, pilotId: Id, calloutId: Id, data: GameData): { ok: boolean; reason?: string }; // mutates
export function setPendingCallouts(world: WorldState, callouts: ActiveCallout[]): void; // mutates
export function buildBattleSides(world: WorldState, map: MapDef, data: GameData): { sideA: BattleSide; sideB: BattleSide; ctx: BattleContext }; // requires pendingBattle; pure
export function beginBattle(world: WorldState): void; // mutates: phase 'battle_pending' → 'battle'
export function applyBattleResult(world: WorldState, map: MapDef, result: BattleResult, data: GameData): void; // mutates
// Copies post-battle pilots/mechs back, removes destroyed squads (or routs them: loser retreats toward home with cooldown),
// applies last-transmission map effects, morale, marked squads, WorldEvents; phase → 'running' (or 'ended').
export function withdraw(world: WorldState): void; // mutates: outcome 'withdraw', phase 'ended'
export function playerSquads(world: WorldState): Squad[];
export function enemySquads(world: WorldState): Squad[];
export function squadAlive(squad: Squad, world: WorldState): boolean;
export function squadHpSummary(squad: Squad, world: WorldState, data: GameData): { hp: number; maxHp: number; alive: number; total: number };
```

Rules of the map: contact radius 0.75 tiles between a player and enemy squad both not on cooldown → battle. Fuel drains 1/sec while moving (frames with `fuel_cell` add capacity); at 0 fuel speed halves. A squad at 0 living mechs is `destroyed`. Objectives: `evac_*` progress while ≥1 player squad in radius and no enemy in radius; `convoy` moves along path when a player squad is within 2 tiles (or `escort` effect) and takes damage from enemies in radius; `derelict` completes after 5s in radius and may spawn ambush; `relay` completes on 3s hold and sets all enemies visible for the map; `destroy_target` completes when target squad destroyed; `reach_exit` when any player squad in radius. Victory: all required objectives complete (and boss dead if present). Defeat: carrier HP 0, or all player squads destroyed, or time limit hit with required objectives incomplete. Enemy `intercept_objective` AI heads to the nearest active objective; `hunt` chases nearest visible player squad within aggro radius; `patrol` cycles points; `guard` holds; `boss` guards then hunts once any objective completes.

## `src/sim/pilots.ts` (run-sim)

```ts
export function createPilot(def: PilotDef): Pilot;
export function checkNewCerts(pilot: Pilot, data: GameData): Certification[];
export function grantCert(pilot: Pilot, cert: Certification, data: GameData): void; // mutates; adds granted callouts
export function applyGrowth(pilot: Pilot, gains: Partial<Aptitudes>, def: PilotDef): void; // mutates; uses def.growth; clamps 0..100
export function regenNerve(pilot: Pilot, amount: number): void; // mutates
export function addBond(a: Pilot, b: Pilot, points: number): void; // mutates both
export function availableTandems(a: Pilot, b: Pilot, data: GameData): Id[];
export function canPilotFly(pilot: Pilot, frame: FrameDef): boolean; // weight certs
export function tickInjuries(pilots: Record<Id, Pilot>): void; // mutates; decrements injuredFor
export function isAce(pilot: Pilot): boolean;
```

## `src/sim/hangar.ts` (run-sim)

```ts
export function buildMech(run: RunState, frameId: Id, data: GameData): Mech | null; // mutates run (consumes spare frame, adds mech)
export function equip(run: RunState, mechId: Id, slot: 'weaponA' | 'weaponB' | 'system' | 'system2', itemId: Id | null, data: GameData): { ok: boolean; reason?: string }; // mutates; swaps item to/from inventory
export function assignSlot(run: RunState, squadId: Id, slotIndex: SlotIndex, assignment: SlotAssignment | null, data: GameData): { ok: boolean; reason?: string }; // mutates; enforces cert, one pilot per squad, one mech per pilot
export function setLeader(run: RunState, squadId: Id, pilotId: Id | null): { ok: boolean; reason?: string }; // mutates
export function repairMech(run: RunState, mechId: Id, data: GameData): { ok: boolean; cost: number; reason?: string }; // mutates; costs scrap
export function repairAll(run: RunState, data: GameData): number; // mutates; returns scrap spent
export function scrapItem(run: RunState, kind: 'weapon' | 'system' | 'frame', itemId: Id, data: GameData): number; // mutates; returns scrap gained
export function unassignedPilots(run: RunState): Id[];
export function unassignedMechs(run: RunState): Id[];
```

## `src/sim/run.ts` (run-sim)

```ts
export function newRun(data: GameData, unlocks: Unlocks, seed: number, ascension: number): RunState;
// Generates 1 sector (M2 slice): col 0 start, cols 1-4 with 2-3 nodes each, col 5 boss. Node kinds weighted:
// battle 35%, rescue 30%, salvage 10%, distress 10%, depot 10%, rival 5% (max one rival, cols 2-4). Alternate mapKind by column
// with some randomness so both space and surface appear. Starting roster: 6 unlocked pilots, 2 squads of 3, starter frames/weapons.
export function currentNode(run: RunState): RunNode;
export function reachableNodes(run: RunState): RunNode[];
export function travelTo(run: RunState, nodeId: Id): void; // mutates; sets currentNodeId, visited, turn++
export function prepareMap(run: RunState, data: GameData): { map: MapDef; enemies: SideBundle } | null;
// For battle/rescue/salvage/rival/boss nodes: picks a MapDef matching node.mapKind from data.maps (by tags in id: 'space'/'surface', 'boss'),
// instantiates enemy squads from map.enemySquads scaled by node.threat and run.ascension. Rival node injects the rival squad.
export function finishMap(run: RunState, world: WorldState, map: MapDef, data: GameData): RunHistoryEntry; // mutates
// Copies player pilots/mechs back; clears destroyed mechs (keeps recoverable ones); marks node cleared on victory;
// applies objective rewards (scrap/nerve/standing/recruit), tickInjuries, nerve regen, bonds for pilots who fought together,
// standing penalties for failed objectives; if boss cleared → status 'won'; if no living pilots or no flyable mechs → 'lost'.
export function resolveDistress(run: RunState, choiceId: Id, data: GameData): string; // mutates; returns outcome text
export function salvageNode(run: RunState, data: GameData): SalvageDrop; // mutates; adds items
export function depotStock(run: RunState, data: GameData): { weapons: { id: Id; cost: number }[]; systems: { id: Id; cost: number }[]; frames: { id: Id; cost: number }[] }; // seeded by node id
export function depotBuy(run: RunState, kind: 'weapon' | 'system' | 'frame', itemId: Id, cost: number): { ok: boolean; reason?: string }; // mutates
export function applyRunEnd(unlocks: Unlocks, run: RunState, data: GameData): Unlocks; // pure; new unlocks based on progress (see below)
export function ascensionModifiers(level: number): { label: string; description: string }[];
```

Unlock rules for `applyRunEnd`: runsAttempted++, runsWon++ on win, ascensionMax++ on win. Every run unlocks one new item from the locked pool (weapon → system → frame rotating). Reaching the boss unlocks the 7th pilot; beating the rival once unlocks the 8th. Fragments: one per run milestone.

## `src/save/index.ts` (run-sim)

```ts
export function loadSave(): Promise<SaveData>;    // idb-keyval; returns defaults if none
export function persist(save: SaveData): Promise<void>;
export function defaultSave(data: GameData): SaveData;  // unlocks = everything unlockedByDefault
export function exportSave(save: SaveData): string;
export function importSave(json: string): SaveData; // validates version
```

## `src/data/index.ts` (data-content)

```ts
export function loadGameData(): GameData;  // synchronous; imports JSON; parses ASCII maps into Terrain[][]; validates ids cross-reference; throws on error
export const MAP_LEGEND: Record<string, Terrain>; // '.' open/void, '#' blocked, 'f' forest, 'u' urban, 'm' mountain, 'w' water, 'd' debris, 'r' radiation, 'g' gravity, 's' structure
```

## `src/render/sprites/index.ts` (render-battle)

```ts
export type SpriteScale = 'map' | 'battle';
export function getMechTexture(app: Application, data: GameData, mech: Mech, faction: Faction, scale: SpriteScale): Promise<Texture>;
export function getFrameTexture(app: Application, data: GameData, frameId: Id, faction: Faction, scale: SpriteScale): Promise<Texture>;
export function getPortraitTexture(app: Application, data: GameData, pilotDefId: Id, expression: 'neutral' | 'shout' | 'strained' | 'grin'): Promise<Texture>;
export function getSquadIconTexture(app: Application, data: GameData, leaderFrameId: Id, faction: Faction, count: number): Promise<Texture>;
export function preloadAll(app: Application, data: GameData): Promise<void>;
export const FACTION_ACCENT: Record<Faction, number>; // relay 0xffa53c amber, compact 0x6fb7ff steel blue, neutral 0xb08cff violet
```
Prefers `/sprites/frames/<spriteKey>_<scale>.png` and `/portraits/<portraitKey>_<expression>.png` from `public/` if they exist (HEAD check, cached); otherwise draws SD chibi placeholders procedurally.

## `src/render/battle/BattleStage.ts` (render-battle)

```ts
export class BattleStage {
  constructor(container: HTMLElement, data: GameData);
  play(result: BattleResult, sides: { sideA: BattleSide; sideB: BattleSide }, opts: { speed: 'full' | 'fast' | 'results_only'; onEvent?: (e: BattleEvent, index: number) => void; onComplete: () => void }): void;
  skip(): void;       // jump to end, call onComplete
  setSpeed(speed: 'full' | 'fast'): void;
  destroy(): void;
}
```

## `src/render/map/MapScene.ts` (render-map)

```ts
export type MapIntent =
  | { t: 'select'; squadId: Id | null }
  | { t: 'move'; squadId: Id; target: Vec2 }
  | { t: 'inspect_enemy'; squadId: Id }
  | { t: 'inspect_objective'; objectiveId: Id };
export class MapScene {
  constructor(container: HTMLElement, data: GameData);
  load(map: MapDef): Promise<void>;
  setState(world: WorldState): void;      // called every frame; scene interpolates positions
  setSelected(squadId: Id | null): void;
  onIntent(cb: (i: MapIntent) => void): void;
  resize(): void;
  destroy(): void;
}
```
