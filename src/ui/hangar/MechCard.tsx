import React from 'react';
import type { GameData, Id, Mech, RunState } from '@sim/types';
import { equip, repairMech, scrapItem } from '@sim/hangar';
import { mechLoad } from '@sim/rules';
import { Bar, Button, Dropdown, ItemTooltip } from '@ui/components';
import type { DropdownOption } from '@ui/components';

interface Props {
  run: RunState;
  data: GameData;
  mech: Mech;
  onBump: () => void;
  onToast: (msg: string) => void;
}

type EquipSlot = 'weaponA' | 'weaponB' | 'system' | 'system2';

/** One mech in the HANGAR column: HP, load, slot dropdowns, repair/scrap. */
export function MechCard({ run, data, mech, onBump, onToast }: Props) {
  const frame = data.frames[mech.frameId];
  const [slotError, setSlotError] = React.useState<{ slot: EquipSlot; reason: string } | null>(null);
  if (!frame) return null;

  const load = mechLoad(mech, data);
  const maxHp = Math.max(1, frame.hp - mech.maxHpPenalty);
  const missing = Math.max(0, maxHp - mech.hp);
  const repairCost = Math.ceil(missing * 0.5);

  function doEquip(slot: EquipSlot, itemId: Id | null) {
    const r = equip(run, mech.id, slot, itemId, data);
    if (!r.ok) {
      const reason = r.reason ?? 'Cannot equip that item.';
      onToast(reason);
      setSlotError({ slot, reason });
      window.setTimeout(() => setSlotError((cur) => (cur?.slot === slot && cur.reason === reason ? null : cur)), 3000);
    } else {
      setSlotError((cur) => (cur?.slot === slot ? null : cur));
    }
    onBump();
  }

  function doRepair() {
    const r = repairMech(run, mech.id, data);
    if (!r.ok) onToast(r.reason ?? `Not enough scrap (needs ${r.cost}).`);
    onBump();
  }

  function doScrap() {
    if (!window.confirm(`Scrap ${frame!.name}${mech.nickname ? ` "${mech.nickname}"` : ''}? This cannot be undone.`)) return;
    scrapItem(run, 'frame', mech.frameId, data);
    onBump();
  }

  return (
    <div className="mech-card">
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
        <EquipRow
          label="WPN A"
          kind="weapon"
          slot="weaponA"
          mech={mech}
          run={run}
          data={data}
          onEquip={doEquip}
          error={slotError?.slot === 'weaponA' ? slotError.reason : null}
        />
        <EquipRow
          label="WPN B"
          kind="weapon"
          slot="weaponB"
          mech={mech}
          run={run}
          data={data}
          onEquip={doEquip}
          error={slotError?.slot === 'weaponB' ? slotError.reason : null}
        />
        <EquipRow
          label="SYS"
          kind="system"
          slot="system"
          mech={mech}
          run={run}
          data={data}
          onEquip={doEquip}
          error={slotError?.slot === 'system' ? slotError.reason : null}
        />
        {frame.bonusSystemSlot && (
          <EquipRow
            label="SYS 2"
            kind="system"
            slot="system2"
            mech={mech}
            run={run}
            data={data}
            onEquip={doEquip}
            error={slotError?.slot === 'system2' ? slotError.reason : null}
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

/** One slot's label + custom dropdown, with per-option power cost and a 3s inline rejection reason. */
function EquipRow({
  label,
  kind,
  slot,
  mech,
  run,
  data,
  onEquip,
  error,
}: {
  label: string;
  kind: 'weapon' | 'system';
  slot: EquipSlot;
  mech: Mech;
  run: RunState;
  data: GameData;
  onEquip: (slot: EquipSlot, itemId: Id | null) => void;
  error: string | null;
}) {
  const inventory = kind === 'weapon' ? run.weapons : run.systems;
  const pool = kind === 'weapon' ? data.weapons : data.systems;
  const current = mech[slot] ?? null;
  const frame = data.frames[mech.frameId];
  const generator = frame?.generator ?? 0;
  const candidates = uniqueWithCurrent(current, inventory).filter((id): id is Id => !!id);

  const options: DropdownOption[] = [{ value: '', label: '— empty —' }];
  for (const id of candidates) {
    const item = pool[id];
    if (!item) continue;
    const prospective = mechLoad({ ...mech, [slot]: id }, data).power;
    const overBudget = prospective > generator;
    options.push({
      value: id,
      warn: overBudget,
      label: (
        <ItemTooltip kind={kind} id={id} data={data}>
          <span>
            {item.name} · {item.power} PWR{overBudget ? ' (over budget)' : ''}
          </span>
        </ItemTooltip>
      ),
    });
  }

  return (
    <div className="col gap-s">
      <label className="row gap-s" style={{ fontSize: 10 }}>
        <span className="mono muted" style={{ width: 44 }}>
          {label}
        </span>
        <div className="grow">
          <Dropdown value={current ?? ''} options={options} onChange={(v) => onEquip(slot, v || null)} />
        </div>
      </label>
      {error && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--danger)', marginLeft: 50 }}>
          {error}
        </div>
      )}
    </div>
  );
}
