/**
 * Quick headless probe: new run → first battle-eligible node → one battle
 * between the player's first squad and the map's first enemy squad.
 * Usage: npx tsx tools/balance/probe.ts [seed]
 */
import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { newRun, prepareMap, travelTo, reachableNodes } from '../../src/sim/run';
import { resolveBattle } from '../../src/sim/battle';
import { forecast } from '../../src/sim/forecast';
import { effectiveStats } from '../../src/sim/rules';
import type { BattleSide } from '../../src/sim/types';

const data = loadGameData();
const save = defaultSave(data);
const seed = Number(process.argv[2] ?? 12345);
const run = newRun(data, save.unlocks, seed, 0);
const next = reachableNodes(run).find((n) => n.kind === 'battle' || n.kind === 'rescue') ?? reachableNodes(run)[0];
travelTo(run, next.id);
const prepared = prepareMap(run, data)!;
console.log('map', prepared.map.id, 'node', next.kind, next.mapKind);

const sideA: BattleSide = { squad: run.squads[0], pilots: run.pilots, mechs: run.mechs };
const enemySquad = prepared.enemies.squads[0];
const sideB: BattleSide = { squad: enemySquad, pilots: prepared.enemies.pilots, mechs: prepared.enemies.mechs };

const ctxBase = { seed: 7, mapKind: prepared.map.kind, terrain: prepared.map.kind === 'space' ? ('void' as const) : ('open' as const), weather: prepared.map.weather, calloutsA: [], calloutsB: [] };

function describe(side: BattleSide, label: string) {
  console.log(`--- ${label}: ${side.squad.name}`);
  side.squad.slots.forEach((s, i) => {
    if (!s) return;
    const p = side.pilots[s.pilotId];
    const m = side.mechs[s.mechId];
    const f = data.frames[m.frameId];
    const st = effectiveStats(p, m, data, ctxBase);
    console.log(
      `  slot${i} ${s.pilotId} apt=${JSON.stringify(p.aptitudes)} | ${f.name} hp=${m.hp} ev=${st.evasion} arm=${st.armor} A=${m.weaponA} B=${m.weaponB} sys=${m.system}`,
    );
  });
}
describe(sideA, 'A');
describe(sideB, 'B');

const fc = forecast(sideA, sideB, ctxBase, data, 100);
console.log('forecast win', fc.winProb, 'dealt', fc.expectedDamageDealt, 'taken', fc.expectedDamageTaken);

const res = resolveBattle(sideA, sideB, ctxBase, data);
const attacks = res.events.filter((e) => e.t === 'attack') as Extract<(typeof res.events)[number], { t: 'attack' }>[];
const bySide = { A: attacks.filter((a) => a.side === 'A'), B: attacks.filter((a) => a.side === 'B') };
for (const s of ['A', 'B'] as const) {
  const hits = bySide[s].flatMap((a) => a.hits);
  console.log(`${s}: attacks=${bySide[s].length} hits=${hits.filter((h) => h.hit).length}/${hits.length} dmg=${bySide[s].reduce((n, a) => n + a.totalDamage, 0)}`);
}
console.log('winner', res.winner, 'events', res.events.length);
console.log(res.events.filter((e) => e.t !== 'attack').map((e) => e.t + (('line' in e && e.line) ? `: ${e.line}` : '')).slice(0, 25).join('\n'));
