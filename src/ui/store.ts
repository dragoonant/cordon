/**
 * Game controller + UI store.
 *
 * The sim objects (RunState, WorldState) are mutable and live on the store as
 * plain references; the real-time loop mutates `world` in place 30x/sec and
 * bumps `hudTick` ~10x/sec so React re-renders HUD text without churning on
 * every sim step. Renderers (MapScene/BattleStage) read `world` directly each
 * frame. Screens never touch sim modules — they call actions here.
 */
import { create } from 'zustand';
import type {
  ActiveCallout,
  BattleContext,
  BattleResult,
  BattleSide,
  Forecast,
  GameData,
  Id,
  MapDef,
  RunNode,
  RunState,
  SaveData,
  Settings,
  Vec2,
  WorldState,
} from '@sim/types';
import { loadGameData } from '@data/index';
import { defaultSave, loadSave, persist } from '@save/index';
import {
  applyRunEnd,
  currentNode,
  depotBuy,
  depotStock,
  finishMap,
  newRun,
  prepareMap,
  reachableNodes,
  recordBattle,
  resolveDistress,
  salvageNode,
  travelTo,
} from '@sim/run';
import {
  applyBattleResult,
  beginBattle,
  buildBattleSides,
  createWorld,
  deploySquad,
  orderMove,
  orderReturn,
  setPendingCallouts,
  setSpeed,
  stepWorld,
  useOverworldCallout,
  withdraw,
} from '@sim/world';
import { resolveBattle } from '@sim/battle';
import { forecast as computeForecast } from '@sim/forecast';
import { hashString } from '@sim/rng';
import { initAudio, playMusic, playSfx, updateAudioSettings } from '@audio/index';

export type Screen =
  | 'boot'
  | 'title'
  | 'node_map'
  | 'hangar'
  | 'briefing'
  | 'map'
  | 'map_result'
  | 'distress'
  | 'depot'
  | 'salvage'
  | 'run_end'
  | 'settings';

export interface DepotOffer {
  weapons: { id: Id; cost: number }[];
  systems: { id: Id; cost: number }[];
  frames: { id: Id; cost: number }[];
}

export interface BattleSession {
  result: BattleResult;
  sides: { sideA: BattleSide; sideB: BattleSide };
  ctx: BattleContext;
}

interface State {
  screen: Screen;
  prevScreen: Screen | null;
  data: GameData | null;
  save: SaveData | null;
  run: RunState | null;
  map: MapDef | null;
  world: WorldState | null;
  hudTick: number;
  selectedSquadId: Id | null;
  /** Forecast for the pending battle; recomputed when callouts change. */
  forecast: Forecast | null;
  pendingCallouts: ActiveCallout[];
  battle: BattleSession | null;
  /** Text shown after a distress/salvage resolution. */
  resultText: string | null;
  salvageText: string | null;
  depot: DepotOffer | null;
  mapHistoryEntryOutcome: string | null;
  /** Captain's most recent line for the HUD ticker. */
  captainLine: string | null;
  error: string | null;
  runEndUnlocked: string[];
}

interface Actions {
  boot(): Promise<void>;
  go(screen: Screen): void;
  back(): void;
  // title
  startNewRun(ascension?: number): Promise<void>;
  continueRun(): void;
  abandonRun(): Promise<void>;
  updateSettings(partial: Partial<Settings>): Promise<void>;
  // node map
  travel(nodeId: Id): Promise<void>;
  // briefing / hangar
  openHangar(): void;
  closeHangar(): void;
  launchMap(): void;
  // map
  tick(dtReal: number): void;
  selectSquad(id: Id | null): void;
  deploy(squadId: Id): void;
  move(squadId: Id, target: Vec2): void;
  recall(squadId: Id): void;
  speed(s: 0 | 1 | 2 | 4): void;
  togglePause(): void;
  callout(squadId: Id, pilotId: Id, calloutId: Id): void;
  withdrawFromMap(): void;
  // forecast / battle
  toggleCallout(c: ActiveCallout): void;
  commitBattle(): void;
  battleFinished(): void;
  // after map
  finishCurrentMap(): Promise<void>;
  // events
  chooseDistress(choiceId: Id): Promise<void>;
  buy(kind: 'weapon' | 'system' | 'frame', id: Id, cost: number): void;
  leaveNode(): Promise<void>;
  // run end
  concludeRun(): Promise<void>;
  bump(): void;
}

export type Store = State & Actions;

const HUD_HZ = 10;
let hudAccumulator = 0;

async function saveNow(get: () => Store) {
  const { save, run } = get();
  if (!save) return;
  const next: SaveData = { ...save, activeRun: run && run.status === 'active' ? run : null, activeWorld: null };
  await persist(next);
  useStore.setState({ save: next });
}

export const useStore = create<Store>((set, get) => ({
  screen: 'boot',
  prevScreen: null,
  data: null,
  save: null,
  run: null,
  map: null,
  world: null,
  hudTick: 0,
  selectedSquadId: null,
  forecast: null,
  pendingCallouts: [],
  battle: null,
  resultText: null,
  salvageText: null,
  depot: null,
  mapHistoryEntryOutcome: null,
  captainLine: null,
  error: null,
  runEndUnlocked: [],

  async boot() {
    try {
      const data = loadGameData();
      let save = await loadSave();
      if (!save || !save.unlocks) save = defaultSave(data);
      initAudio(save.settings);
      set({ data, save, run: save.activeRun ?? null, screen: 'title' });
      playMusic('title');
    } catch (e) {
      set({ error: String((e as Error)?.message ?? e), screen: 'title' });
    }
  },

  go(screen) {
    set((s) => ({ prevScreen: s.screen, screen }));
  },
  back() {
    const p = get().prevScreen;
    if (p) set({ screen: p, prevScreen: null });
  },

  async startNewRun(ascension = 0) {
    const { data, save } = get();
    if (!data || !save) return;
    const seed = hashString(`${Date.now()}:${Math.random()}`);
    const run = newRun(data, save.unlocks, seed, ascension);
    set({ run, world: null, map: null, screen: 'node_map', captainLine: pickLine(data.captainLines.runStart, seed) });
    playSfx('ui_confirm');
    await saveNow(get);
  },

  continueRun() {
    const { run } = get();
    if (!run) return;
    set({ screen: 'node_map', world: null, map: null });
  },

  async abandonRun() {
    const { data, save, run } = get();
    if (!data || !save) return;
    if (run) {
      run.status = 'lost';
      const unlocks = applyRunEnd(save.unlocks, run, data);
      set({ save: { ...save, unlocks, activeRun: null } });
    }
    set({ run: null, screen: 'title' });
    await saveNow(get);
  },

  async updateSettings(partial) {
    const { save } = get();
    if (!save) return;
    const settings = { ...save.settings, ...partial };
    updateAudioSettings(settings);
    set({ save: { ...save, settings } });
    await persist({ ...save, settings });
  },

  async travel(nodeId) {
    const { run, data } = get();
    if (!run || !data) return;
    const ok = reachableNodes(run).some((n) => n.id === nodeId);
    if (!ok) return;
    travelTo(run, nodeId);
    const node = currentNode(run);
    playSfx('ui_confirm');
    routeNode(node, set, get);
    await saveNow(get);
  },

  openHangar() {
    set((s) => ({ prevScreen: s.screen, screen: 'hangar' }));
  },
  closeHangar() {
    const p = get().prevScreen;
    set({ screen: p && p !== 'hangar' ? p : 'node_map', prevScreen: null });
  },

  launchMap() {
    const { run, data, map } = get();
    if (!run || !data || !map) return;
    const prepared = prepareMap(run, data);
    if (!prepared) return;
    const seed = hashString(`${run.seed}:${run.currentNodeId}:${run.turn}`);
    const player = {
      squads: run.squads.map((s) => ({ ...s, slots: [...s.slots] })),
      pilots: run.pilots,
      mechs: run.mechs,
    };
    const world = createWorld(prepared.map, seed, data, player, prepared.enemies);
    set({
      world,
      map: prepared.map,
      screen: 'map',
      selectedSquadId: null,
      forecast: null,
      pendingCallouts: [],
      battle: null,
      captainLine: prepared.map.briefing,
    });
    playMusic(prepared.map.kind === 'space' ? 'map_space' : 'map_surface');
  },

  tick(dtReal) {
    const { world, map, data, screen } = get();
    if (!world || !map || !data || screen !== 'map') return;
    if (world.phase === 'running' || world.phase === 'deploy') {
      stepWorld(world, map, Math.min(dtReal, 0.1), data);
    }
    // Consume new world events for HUD side effects.
    drainEvents(world, set, data);
    if (world.phase === 'battle_pending' && !get().forecast && !get().battle) {
      const sides = buildBattleSides(world, map, data);
      const fc = computeForecast(sides.sideA, sides.sideB, { ...sides.ctx, calloutsA: [] }, data, 150);
      set({ forecast: fc, pendingCallouts: [] });
      playSfx('alert');
    }
    hudAccumulator += dtReal;
    if (hudAccumulator >= 1 / HUD_HZ) {
      hudAccumulator = 0;
      set((s) => ({ hudTick: s.hudTick + 1 }));
    }
  },

  selectSquad(id) {
    set({ selectedSquadId: id });
  },
  deploy(squadId) {
    const { world, map, data } = get();
    if (!world || !map || !data) return;
    const r = deploySquad(world, map, squadId, data);
    if (r.ok) {
      playSfx('ui_confirm');
      set({ selectedSquadId: squadId });
    } else playSfx('ui_back');
    get().bump();
  },
  move(squadId, target) {
    const { world, map, data } = get();
    if (!world || !map || !data) return;
    if (orderMove(world, map, squadId, target, data).ok) playSfx('ui_click');
  },
  recall(squadId) {
    const { world, map, data } = get();
    if (!world || !map || !data) return;
    orderReturn(world, map, squadId, data);
    get().bump();
  },
  speed(s) {
    const { world } = get();
    if (!world) return;
    setSpeed(world, s);
    get().bump();
  },
  togglePause() {
    const { world } = get();
    if (!world) return;
    setSpeed(world, world.speed === 0 ? 1 : 0);
    get().bump();
  },
  callout(squadId, pilotId, calloutId) {
    const { world, map, data } = get();
    if (!world || !map || !data) return;
    const r = useOverworldCallout(world, map, squadId, pilotId, calloutId, data);
    if (r.ok) {
      playSfx('callout');
      void playVoiceFor(pilotId, calloutId);
    } else playSfx('ui_back');
    get().bump();
  },
  withdrawFromMap() {
    const { world } = get();
    if (!world) return;
    withdraw(world);
    set({ screen: 'map_result' });
  },

  toggleCallout(c) {
    const { world, map, data, pendingCallouts } = get();
    if (!world || !map || !data) return;
    const exists = pendingCallouts.some((p) => p.calloutId === c.calloutId && p.pilotId === c.pilotId);
    const next = exists
      ? pendingCallouts.filter((p) => !(p.calloutId === c.calloutId && p.pilotId === c.pilotId))
      : [...pendingCallouts, c];
    const sides = buildBattleSides(world, map, data);
    const fc = computeForecast(sides.sideA, sides.sideB, { ...sides.ctx, calloutsA: next }, data, 150);
    set({ pendingCallouts: next, forecast: fc });
    playSfx('ui_click');
  },

  commitBattle() {
    const { world, map, data, pendingCallouts, run } = get();
    if (!world || !map || !data || !run) return;
    setPendingCallouts(world, pendingCallouts);
    const sides = buildBattleSides(world, map, data);
    const ctx: BattleContext = { ...sides.ctx, calloutsA: pendingCallouts };
    beginBattle(world);
    const result = resolveBattle(sides.sideA, sides.sideB, ctx, data);
    // Deduct nerve for committed callouts on the world-side copies (battle returns copies).
    for (const c of pendingCallouts) {
      const p = result.sideA.pilots[c.pilotId];
      const def = data.callouts[c.calloutId];
      if (p && def) p.nerve = Math.max(0, p.nerve - def.nerveCost);
    }
    if (result.winner === 'A') recordBattle(run, result, data);
    set({ battle: { result, sides: { sideA: sides.sideA, sideB: sides.sideB }, ctx }, forecast: null });
    playMusic('battle');
    for (const c of pendingCallouts) void playVoiceFor(c.pilotId, c.calloutId);
  },

  battleFinished() {
    const { world, map, data, battle } = get();
    if (!world || !map || !data || !battle) return;
    applyBattleResult(world, map, battle.result, data);
    set({ battle: null, pendingCallouts: [], forecast: null });
    playMusic(map.kind === 'space' ? 'map_space' : 'map_surface');
    if (world.phase === 'ended') {
      set({ screen: 'map_result' });
      playSfx(world.outcome === 'victory' ? 'victory' : 'defeat');
    }
    get().bump();
  },

  async finishCurrentMap() {
    const { run, world, map, data } = get();
    if (!run || !world || !map || !data) return;
    const entry = finishMap(run, world, map, data);
    set({ mapHistoryEntryOutcome: entry.outcome, world: null, map: null, selectedSquadId: null });
    if (run.status !== 'active') {
      set({ screen: 'run_end' });
    } else {
      set({ screen: 'node_map' });
    }
    await saveNow(get);
  },

  async chooseDistress(choiceId) {
    const { run, data } = get();
    if (!run || !data) return;
    const text = resolveDistress(run, choiceId, data);
    set({ resultText: text });
    playSfx('ui_confirm');
    await saveNow(get);
  },

  buy(kind, id, cost) {
    const { run } = get();
    if (!run) return;
    const r = depotBuy(run, kind, id, cost);
    playSfx(r.ok ? 'ui_confirm' : 'ui_back');
    if (r.ok) {
      const depot = get().depot;
      if (depot) {
        const key = kind === 'weapon' ? 'weapons' : kind === 'system' ? 'systems' : 'frames';
        set({ depot: { ...depot, [key]: depot[key].filter((o) => o.id !== id) } });
      }
    }
    get().bump();
  },

  async leaveNode() {
    const { run } = get();
    if (!run) return;
    const node = currentNode(run);
    node.cleared = true;
    set({ screen: 'node_map', resultText: null, salvageText: null, depot: null });
    await saveNow(get);
  },

  async concludeRun() {
    const { run, data, save } = get();
    if (!run || !data || !save) return;
    const before = new Set([...save.unlocks.pilots, ...save.unlocks.frames, ...save.unlocks.weapons, ...save.unlocks.systems]);
    const unlocks = applyRunEnd(save.unlocks, run, data);
    const after = [...unlocks.pilots, ...unlocks.frames, ...unlocks.weapons, ...unlocks.systems].filter((id) => !before.has(id));
    const nextSave: SaveData = { ...save, unlocks, activeRun: null, activeWorld: null };
    set({ save: nextSave, run: null, runEndUnlocked: after, screen: 'title' });
    await persist(nextSave);
    playMusic('title');
  },

  bump() {
    set((s) => ({ hudTick: s.hudTick + 1 }));
  },
}));

// ---------------------------------------------------------------------------

function routeNode(node: RunNode, set: (p: Partial<State>) => void, get: () => Store) {
  const { run, data } = get();
  if (!run || !data) return;
  switch (node.kind) {
    case 'start':
      set({ screen: 'node_map' });
      break;
    case 'distress':
      set({ screen: 'distress', resultText: null });
      break;
    case 'depot': {
      const stock = depotStock(run, data);
      set({ screen: 'depot', depot: stock });
      break;
    }
    case 'salvage': {
      const drop = salvageNode(run, data);
      const names = [
        ...drop.weapons.map((w) => data.weapons[w]?.name ?? w),
        ...drop.systems.map((s) => data.systems[s]?.name ?? s),
        ...drop.frames.map((f) => data.frames[f]?.name ?? f),
      ];
      set({ screen: 'salvage', salvageText: `Recovered: ${names.join(', ') || 'nothing usable'}. +${drop.scrap} scrap.` });
      break;
    }
    default: {
      // battle / rescue / rival / boss → briefing
      const prepared = prepareMap(run, data);
      if (!prepared) {
        set({ screen: 'node_map', error: 'No map available for this node.' });
        return;
      }
      set({ screen: 'briefing', map: prepared.map, captainLine: prepared.map.briefing });
    }
  }
}

/** world.events is a capped ring buffer, so indices shift; track seen events by identity instead. */
const seenEvents = new WeakSet<object>();
function drainEvents(world: WorldState, set: (p: Partial<State>) => void, data: GameData) {
  for (const e of world.events) {
    if (seenEvents.has(e)) continue;
    seenEvents.add(e);
    if (e.t === 'captain') set({ captainLine: e.line });
    else if (e.t === 'objective' && e.status === 'complete') {
      set({ captainLine: pickLine(data.captainLines.objectiveComplete, world.tick) });
      playSfx('victory');
    } else if (e.t === 'objective' && e.status === 'failed') {
      set({ captainLine: pickLine(data.captainLines.objectiveFailed, world.tick) });
      playSfx('defeat');
    } else if (e.t === 'last_transmission') {
      void playVoiceFor(e.pilotId, 'last');
    } else if (e.t === 'contact') playSfx('alert');
    else if (e.t === 'map_end') {
      set({ screen: 'map_result' });
      playSfx(e.outcome === 'victory' ? 'victory' : 'defeat');
    }
  }
}

function pickLine(lines: string[] | undefined, seed: number): string | null {
  if (!lines || lines.length === 0) return null;
  return lines[Math.abs(seed) % lines.length];
}

async function playVoiceFor(pilotId: Id, lineKey: Id) {
  const { playVoice } = await import('@audio/index');
  const defId = pilotId.split('#')[0];
  await playVoice(defId, lineKey);
}
