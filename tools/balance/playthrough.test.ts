import { describe, expect, it, vi } from 'vitest';
import type { RunLog, SweepResult } from './playthrough';

/**
 * Strips fields that are allowed (expected) to vary between two otherwise
 * identical invocations — currently just wall-clock timing, which is
 * reported for diagnostics but never feeds into the sim itself.
 */
function canonicalize(result: SweepResult) {
  const stripLog = (l: RunLog) => {
    const { wallTimeMs, ...rest } = l;
    return rest;
  };
  return {
    logs: result.logs.map(stripLog),
    summary: result.summary,
  };
}

/**
 * Runs a sweep in a *fresh* module graph via vi.resetModules() + a dynamic
 * re-import, rather than just calling the already-imported `runSweep`.
 *
 * This isn't cosmetic: src/data/index.ts's `loadGameData()` only shallow-
 * copies on top of the JSON files' single process-lifetime module instances
 * (`import mapsJson from './maps.json'` etc. is evaluated once and cached),
 * and src/sim/run.ts's `buildEnemySquad` hands a `Squad.ai` reference
 * straight from the static `EnemySquadSpawn.ai` object instead of cloning it
 * (`ai: spawn.ai`). src/sim/world.ts's `updateEnemyAI` then mutates that
 * object in place for 'boss' behavior (`ai.behavior = 'hunt'`) and 'patrol'
 * behavior (`ai.patrolIndex = ...`). Net effect: playing a map with a boss
 * or patrol squad permanently corrupts what every *later* `loadGameData()`
 * call in the same process returns for that map, even though `loadGameData`
 * looks like it returns something fresh. Confirmed directly: after one
 * simulated boss encounter, `data.maps['map_space_gate_boss'].enemySquads
 * .find(s => s.isBoss).ai` is `===` the mutated object even from a
 * brand-new `loadGameData()` call in the same process, and its `.behavior`
 * has flipped from `'boss'` to `'hunt'`.
 *
 * That makes two bare `runSweep()` calls in one process an unreliable way to
 * test determinism — whether they agree depends on incidental history (how
 * many prior calls already "settled" the shared mutation), not on the sim
 * itself. `vi.resetModules()` + a dynamic re-import forces Vitest to
 * re-evaluate the whole module graph (JSON imports included), which we
 * verified does hand back a genuinely fresh, unmutated object graph. The
 * real CLI entry point only ever calls `runSweep` once per OS process, so
 * this per-call isolation also matches how the tool is actually used.
 */
async function freshSweep(runs: number, seedBase: number): Promise<SweepResult> {
  vi.resetModules();
  const mod = await import('./playthrough');
  return mod.runSweep(runs, seedBase);
}

describe('playthrough headless harness', () => {
  it('plays complete runs without throwing, producing valid results', async () => {
    const { logs } = await freshSweep(2, 12345);
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.error, `run seed ${log.seed} threw: ${log.error?.message}\n${log.error?.stack}`).toBeUndefined();
      expect(['won', 'lost', 'stuck']).toContain(log.result);
    }
  });

  it('is deterministic: identical seeds produce an identical summary/log JSON', async () => {
    const a = await freshSweep(2, 12345);
    const b = await freshSweep(2, 12345);
    expect(JSON.stringify(canonicalize(a))).toBe(JSON.stringify(canonicalize(b)));
  });
});
