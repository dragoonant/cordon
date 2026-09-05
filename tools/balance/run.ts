/**
 * Headless balance sweep. For each map's enemy squads, pits a fresh starting
 * squad against them N times and reports win/draw/loss, kills each way, and
 * pilot deaths. Also sweeps every unlocked frame+weapon combo 1v1 against a
 * compact line grunt so outliers stand out.
 *
 * Usage: npx tsx tools/balance/run.ts [samples=200]
 */
import { loadGameData } from '../../src/data/index';
import { defaultSave } from '../../src/save/index';
import { newRun, prepareMap, travelTo, reachableNodes, currentNode } from '../../src/sim/run';
import { resolveBattle } from '../../src/sim/battle';
import { createPilot } from '../../src/sim/pilots';
import type { BattleContext, BattleSide, Id, Mech, Squad, Terrain } from '../../src/sim/types';

const data = loadGameData();
const samples = Number(process.argv[2] ?? 200);

function pct(n: number, d: number): string {
  return d ? `${Math.round((100 * n) / d)}%`.padStart(4) : '  --';
}

function summarize(label: string, sideA: BattleSide, sideB: BattleSide, ctxBase: Omit<BattleContext, 'seed'>) {
  let win = 0,
    draw = 0,
    loss = 0,
    killsA = 0,
    killsB = 0,
    deathsA = 0,
    dmgA = 0,
    dmgB = 0,
    rounds = 0;
  for (let i = 0; i < samples; i++) {
    const r = resolveBattle(sideA, sideB, { ...ctxBase, seed: 1000 + i }, data);
    if (r.winner === 'A') win++;
    else if (r.winner === 'B') loss++;
    else draw++;
    killsA += r.mechsLost.filter((m) => m.side === 'B').length;
    killsB += r.mechsLost.filter((m) => m.side === 'A').length;
    deathsA += r.pilotDeaths.filter((d) => d.side === 'A').length;
    for (const e of r.events) {
      if (e.t === 'attack') {
        if (e.side === 'A') dmgA += e.totalDamage;
        else dmgB += e.totalDamage;
      }
      if (e.t === 'round') rounds++;
    }
  }
  const aN = sideA.squad.slots.filter(Boolean).length;
  const bN = sideB.squad.slots.filter(Boolean).length;
  console.log(
    `${label.padEnd(46)} ${aN}v${bN}  W${pct(win, samples)} D${pct(draw, samples)} L${pct(loss, samples)}  killsA ${(killsA / samples).toFixed(2)} killsB ${(killsB / samples).toFixed(2)} deathsA ${(deathsA / samples).toFixed(2)}  dmg ${Math.round(dmgA / samples)}/${Math.round(dmgB / samples)}  rounds ${(rounds / samples).toFixed(1)}`,
  );
}

// --- 1. Starting squads vs every map's enemy squads -----------------------
const save = defaultSave(data);
const run = newRun(data, save.unlocks, 4242, 0);
console.log(`\n== Starting squads (seed 4242), ${samples} samples each ==`);
for (const sq of run.squads) {
  const members = sq.slots
    .filter(Boolean)
    .map((s) => `${s!.pilotId.replace('pilot_', '')}:${data.frames[run.mechs[s!.mechId].frameId].name}`)
    .join(', ');
  console.log(`${sq.name}: ${members}`);
}

for (const map of Object.values(data.maps)) {
  const terrain: Terrain = map.kind === 'space' ? 'void' : 'open';
  // Instantiate enemies through run.ts so threat scaling matches the game.
  const r2 = newRun(data, save.unlocks, 99, 0);
  const node = reachableNodes(r2)[0];
  travelTo(r2, node.id);
  currentNode(r2).mapKind = map.kind;
  currentNode(r2).mapId = map.id;
  const prepared = prepareMap(r2, data);
  if (!prepared) continue;
  for (const enemy of prepared.enemies.squads) {
    const sideA: BattleSide = { squad: run.squads[0], pilots: run.pilots, mechs: run.mechs };
    const sideB: BattleSide = { squad: enemy, pilots: prepared.enemies.pilots, mechs: prepared.enemies.mechs };
    summarize(`${map.id} / ${enemy.name}`, sideA, sideB, { mapKind: map.kind, terrain, weather: map.weather, calloutsA: [], calloutsB: [] });
  }
}

// --- 2. 1v1 frame+weapon sweep vs a compact line grunt --------------------
console.log(`\n== 1v1: relay frame + weapon (front row) vs Vantage/glaive grunt, surface/open ==`);
function soloSide(id: Id, pilotDefId: Id, frameId: Id, weaponA: Id, weaponB: Id | null, faction: 'relay' | 'compact', slot: 0 | 3): BattleSide {
  const pilot = createPilot(data.pilots[pilotDefId]);
  pilot.id = faction === 'relay' ? pilotDefId : `${pilotDefId}#${id}#0`;
  const frame = data.frames[frameId];
  const mech: Mech = { id: `m_${id}`, frameId, weaponA, weaponB, system: null, hp: frame.hp, maxHpPenalty: 0, destroyed: false };
  const slots: (Squad['slots'][number])[] = [null, null, null, null, null, null];
  slots[slot] = { pilotId: pilot.id, mechId: mech.id };
  const squad: Squad = {
    id: `sq_${id}`,
    name: id,
    faction,
    leaderPilotId: pilot.id,
    slots,
    pos: { x: 0, y: 0 },
    path: [],
    targetPos: null,
    fuel: 90,
    maxFuel: 90,
    morale: 70,
    state: 'idle',
    engageCooldown: 0,
    effects: [],
  };
  return { squad, pilots: { [pilot.id]: pilot }, mechs: { [mech.id]: mech } };
}
const grunt = soloSide('grunt', 'pilot_cmp_grunt_a', 'frame_compact_line', 'wpn_cmp_glaive', null, 'compact', 0);
for (const frame of Object.values(data.frames).filter((f) => f.faction === 'relay')) {
  for (const w of Object.values(data.weapons).filter((w) => w.faction === 'relay' && w.kind !== 'support')) {
    const slot = w.frontMult > 0 ? 0 : 3;
    const a = soloSide('a', 'pilot_hotshot', frame.id, w.id, null, 'relay', slot);
    summarize(`${frame.name} + ${w.name}`, a, grunt, { mapKind: 'surface', terrain: 'open', weather: 'clear', calloutsA: [], calloutsB: [] });
  }
}
