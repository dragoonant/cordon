import React from 'react';
import type { GameData, Id, Mech, RunState } from '@sim/types';
import { equip, repairMech, scrapItem } from '@sim/hangar';
import { mechLoad } from '@sim/rules';
import { Bar, Button } from '@ui/components';

interface Props {
  run: RunState;
  data: GameData;
  mech: Mech;
  selected: boolean;
  onSelect: () => void;
  onBump: () => void;
  onToast: (msg: string) => void;
}

/** One mech in the HANGAR column: HP, load, slot dropdowns, repair/scrap. */
export function MechCard({ run, data, mech, selected, onSelect, onBump, onToast }: Props) {
  const frame = data.frames[mech.frameId];
  if (!frame) return null;

  const load = mechLoad(mech, data);
  const maxHp = Math.max(1, frame.hp - mech.maxHpPenalty);
  const missing = Math.max(0, maxHp - mech.hp);
  const repairCost = Math.ceil(missing * 0.5);

  function doEquip(slot: 'weaponA' | 'weaponB' | 'system' | 'system2', itemId: Id | null) {
    const r = equip(run, mech.id, slot, itemId, data);
    if (!r.ok) onToast(r.reason ?? 'Cannot equip that item.');
    onBump();
  }

  function doRepair() {
    const r = repairMech(run, mech.id, data);
    if (!r.ok) onToast(r.reason ?? `Not enough scrap (needs ${r.cost}).`);
    onBump();
  }

  function doScrap() {
    if (!window.confirm(`Scrap ${frame.name}${mech.nickname ? ` "${mech.nickname}"` : ''}? This cannot be undone.`)) return;
    scrapItem(run, 'frame', mech.frameId, data);
    onBump();
  }

  const weaponOptions = uniqueWithCurrent(mech.weaponA, run.weapons);
  const weaponBOptions = uniqueWithCurrent(mech.weaponB, run.weapons);
  const systemOptions = uniqueWithCurrent(mech.system, run.systems);
  const system2Options = uniqueWithCurrent(mech.system2 ?? null, run.systems);

  return (
    <div className="mech-card" onClick={onSelect} style={{ borderColor: selected ? 'var(--amber)' : undefined }}>
      <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
        <strong>
          {frame.name}
          {mech.nickname ? ` "${mech.nickname}"` : ''}
        </strong>
        <span className="chip mono">{frame.mobility.toUpperCase()}</span>
      </div>
      <Bar value={mech.hp} max={maxHp} height={7} color="var(--ok)" showText />
      <div
        className="row gap-s mono"
        style={{ fontSize: 10, margin: '4px 0', color: load.overPower ? 'var(--danger)' : 'var(--muted)' }}
      >
        PWR {load.power}/{load.generator} {load.overPower ? '(OVER BUDGET)' : ''}
      </div>
      <div className="col gap-s" onClick={(e) => e.stopPropagation()}>
        <SlotSelect label="WPN A" value={mech.weaponA} options={weaponOptions} items={data.weapons} onChange={(v) => doEquip('weaponA', v)} />
        <SlotSelect label="WPN B" value={mech.weaponB} options={weaponBOptions} items={data.weapons} onChange={(v) => doEquip('weaponB', v)} />
        <SlotSelect label="SYS" value={mech.system} options={systemOptions} items={data.systems} onChange={(v) => doEquip('system', v)} />
        {frame.bonusSystemSlot && (
          <SlotSelect
            label="SYS 2"
            value={mech.system2 ?? null}
            options={system2Options}
            items={data.systems}
            onChange={(v) => doEquip('system2', v)}
          />
        )}
      </div>
      <div className="row gap-s" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
        <Button small variant="ghost" disabled={missing <= 0 || run.scrap < repairCost} onClick={doRepair} title={`Repair for ${repairCost} scrap`}>
          REPAIR ({repairCost})
        </Button>
        <Button small variant="danger" onClick={doScrap}>
          SCRAP
        </Button>
      </div>
    </div>
  );
}

function uniqueWithCurrent(current: Id | null, inventory: Id[]): (Id | null)[] {
  const out: (Id | null)[] = [];
  const seen = new Set<Id | null>();
  for (const id of [current, ...inventory]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function SlotSelect({
  label,
  value,
  options,
  items,
  onChange,
}: {
  label: string;
  value: Id | null;
  options: (Id | null)[];
  items: Record<string, { name: string }>;
  onChange: (v: Id | null) => void;
}) {
  return (
    <label className="row gap-s" style={{ fontSize: 10 }}>
      <span className="mono muted" style={{ width: 44 }}>
        {label}
      </span>
      <select className="mono grow" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— empty —</option>
        {options
          .filter((id): id is Id => !!id)
          .map((id) => (
            <option key={id} value={id}>
              {items[id]?.name ?? id}
            </option>
          ))}
      </select>
    </label>
  );
}
