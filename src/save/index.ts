/**
 * CORDON — save/load via idb-keyval, with an in-memory fallback so this
 * module works under Vitest (node environment, no IndexedDB) and in any
 * browser context where IndexedDB is unavailable (private mode, etc.).
 *
 * Unlike `src/sim/*`, this module does real I/O and is not pure — that's
 * expected for `src/save/`. It still avoids Math.random/Date.now itself.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { GameData, SaveData, Unlocks } from '../sim/types';

const SAVE_KEY = 'cordon_save_v1';
const SAVE_VERSION = 1;

const memoryStore = new Map<string, unknown>();

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function storeGet<T>(key: string): Promise<T | undefined> {
  if (hasIndexedDB()) return idbGet<T>(key);
  return memoryStore.get(key) as T | undefined;
}

async function storeSet(key: string, value: unknown): Promise<void> {
  if (hasIndexedDB()) {
    await idbSet(key, value);
    return;
  }
  memoryStore.set(key, value);
}

function emptyUnlocks(): Unlocks {
  return {
    pilots: [],
    frames: [],
    weapons: [],
    systems: [],
    events: [],
    ascensionMax: 0,
    runsAttempted: 0,
    runsWon: 0,
    rivalEncounters: 0,
    rivalDefeats: 0,
    fragments: [],
    totalPilotDeaths: 0,
  };
}

const DEFAULT_SETTINGS: SaveData['settings'] = {
  battleSpeed: 'full',
  voice: true,
  music: 0.6,
  sfx: 0.8,
  autoPauseOnContact: true,
  tutorialSeen: false,
};

/**
 * A fresh SaveData with everything `data` marks `unlockedByDefault`
 * pre-unlocked, no run in progress, and default settings.
 */
export function defaultSave(data: GameData): SaveData {
  const unlocks: Unlocks = {
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
  return {
    version: SAVE_VERSION,
    unlocks,
    activeRun: null,
    activeWorld: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Loads the save from IndexedDB (or the in-memory fallback). If nothing has
 * been saved yet, returns a minimal default SaveData.
 *
 * Note: `loadSave()` takes no `data: GameData` per API.md's signature, so
 * unlike `defaultSave(data)` it cannot pre-populate unlocks from game
 * content when there's no save on disk — it falls back to an empty-unlocks
 * shell instead. Callers bootstrapping a brand-new install should prefer
 * `defaultSave(data)` directly, or detect an empty `unlocks.pilots` from
 * `loadSave()` and swap in `defaultSave(data)`.
 */
export async function loadSave(): Promise<SaveData> {
  const raw = await storeGet<SaveData>(SAVE_KEY);
  if (raw) return raw;
  return {
    version: SAVE_VERSION,
    unlocks: emptyUnlocks(),
    activeRun: null,
    activeWorld: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Persists `save` to IndexedDB (or the in-memory fallback). */
export async function persist(save: SaveData): Promise<void> {
  await storeSet(SAVE_KEY, save);
}

/** Serializes a SaveData to JSON. */
export function exportSave(save: SaveData): string {
  return JSON.stringify(save);
}

/** Parses and validates a JSON save. Throws if the JSON is malformed or the version doesn't match. */
export function importSave(json: string): SaveData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error('importSave: invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('importSave: not a save object');
  }
  const candidate = parsed as Partial<SaveData>;
  if (candidate.version !== SAVE_VERSION) {
    throw new Error(`importSave: unsupported save version ${String(candidate.version)}`);
  }
  if (!candidate.unlocks || !candidate.settings) {
    throw new Error('importSave: missing required fields');
  }
  return candidate as SaveData;
}
