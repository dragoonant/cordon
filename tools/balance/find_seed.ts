/**
 * Search run seeds for a desired opening. Usage:
 *   npx tsx tools/balance/find_seed.ts territory   -> shortest path to a territory node
 */
import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { newRun } from '../../src/sim/run';

const data = loadGameData();
const unlocks = defaultSave(data).unlocks;
const want = process.argv[2] ?? 'territory';

type Hit = { seed: number; via: string; viaKind: string; node: string; col: number; threat: number; mapKind: string };
const hits: Hit[] = [];

for (let seed = 1; seed <= 4000 && hits.length < 12; seed++) {
  const run = newRun(data, unlocks, seed, 0);
  const nodes = run.sectors.flatMap((s) => s.nodes);
  const start = nodes.find((n) => n.col === 0)!;
  const targets = nodes.filter((n) => n.kind === want);
  for (const t of targets) {
    // One intermediate hop from start; prefer a hop that costs no map to play.
    const via = nodes.find((n) => start.edges.includes(n.id) && n.edges.includes(t.id));
    if (!via) continue;
    if (via.kind !== 'depot' && via.kind !== 'distress') continue;
    hits.push({ seed, via: via.id, viaKind: via.kind, node: t.id, col: t.col, threat: t.threat, mapKind: t.mapKind });
    break;
  }
}

for (const h of hits) {
  console.log(
    `seed ${String(h.seed).padStart(5)}  ${h.viaKind.padEnd(8)} (${h.via}) -> ${h.node} col${h.col} threat${h.threat} ${h.mapKind}`
  );
}
if (!hits.length) console.log('no seed found with a no-map first hop');
