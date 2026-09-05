import React from 'react';
import { useStore } from '@ui/store';
import { Button, Panel, useData, useHud } from '@ui/components';
import { repairAll } from '@sim/hangar';
import type { FrameDef, SystemDef, WeaponDef } from '@sim/types';

function weaponSummary(w: WeaponDef): string {
  return `${w.kind} · dmg ${w.damage}x${w.hits} · acc ${w.accuracy} · wt ${w.weight}`;
}
function systemSummary(s: SystemDef): string {
  return `${s.effect} · val ${s.value} · wt ${s.weight}`;
}
function frameSummary(f: FrameDef): string {
  return `${f.weightClass}/${f.mobility} · hp ${f.hp} · gen ${f.generator}`;
}

export function DepotScreen() {
  useHud(); // repairAll() mutates `run` in place; hudTick forces the re-render.
  const data = useData();
  const run = useStore((s) => s.run);
  const depot = useStore((s) => s.depot);
  const buy = useStore((s) => s.buy);
  const leaveNode = useStore((s) => s.leaveNode);
  const openHangar = useStore((s) => s.openHangar);
  const bump = useStore((s) => s.bump);
  const go = useStore((s) => s.go);

  if (!data || !run || !depot) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="Depot Closed">
          <div className="col gap-m">
            <div className="muted mono">Nothing to trade here.</div>
            <Button variant="ghost" onClick={() => go('title')}>
              Title
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  let repairCost = 0;
  for (const mech of Object.values(run.mechs)) {
    if (mech.destroyed) continue;
    const frame = data.frames[mech.frameId];
    if (!frame) continue;
    const maxHp = Math.max(1, frame.hp - mech.maxHpPenalty);
    const missing = Math.max(0, maxHp - mech.hp);
    repairCost += Math.ceil(missing * 0.5);
  }

  return (
    <div className="col" style={{ height: '100%', width: '100%', padding: 20, boxSizing: 'border-box', gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="mono" style={{ margin: 0, color: 'var(--amber)', letterSpacing: '0.1em' }}>
          DEPOT
        </h2>
        <div className="mono" style={{ fontSize: 14 }}>
          SCRAP <span style={{ color: 'var(--amber)' }}>{run.scrap}</span>
        </div>
      </div>

      <div className="row grow gap-m" style={{ minHeight: 0 }}>
        <Column title="Weapons" accent="relay">
          {depot.weapons.map((o) => {
            const def = data.weapons[o.id];
            if (!def) return null;
            return (
              <OfferRow key={o.id} name={def.name} summary={weaponSummary(def)} cost={o.cost} disabled={run.scrap < o.cost} onBuy={() => buy('weapon', o.id, o.cost)} />
            );
          })}
          {depot.weapons.length === 0 && <Empty />}
        </Column>
        <Column title="Systems" accent="neutral">
          {depot.systems.map((o) => {
            const def = data.systems[o.id];
            if (!def) return null;
            return (
              <OfferRow key={o.id} name={def.name} summary={systemSummary(def)} cost={o.cost} disabled={run.scrap < o.cost} onBuy={() => buy('system', o.id, o.cost)} />
            );
          })}
          {depot.systems.length === 0 && <Empty />}
        </Column>
        <Column title="Frames" accent="compact">
          {depot.frames.map((o) => {
            const def = data.frames[o.id];
            if (!def) return null;
            return (
              <OfferRow key={o.id} name={def.name} summary={frameSummary(def)} cost={o.cost} disabled={run.scrap < o.cost} onBuy={() => buy('frame', o.id, o.cost)} />
            );
          })}
          {depot.frames.length === 0 && <Empty />}
        </Column>
      </div>

      <div className="row gap-s" style={{ justifyContent: 'space-between' }}>
        <Button
          variant="ghost"
          disabled={repairCost === 0 || run.scrap < repairCost}
          onClick={() => {
            repairAll(run, data);
            bump();
          }}
        >
          Repair All ({repairCost} scrap)
        </Button>
        <div className="row gap-s">
          <Button variant="ghost" onClick={openHangar}>
            Hangar
          </Button>
          <Button variant="primary" onClick={() => void leaveNode()}>
            Leave
          </Button>
        </div>
      </div>
    </div>
  );
}

function Column({ title, accent, children }: { title: string; accent: 'relay' | 'neutral' | 'compact'; children: React.ReactNode }) {
  return (
    <div className="col grow" style={{ minWidth: 0 }}>
      <Panel title={title} accent={accent} style={{ height: '100%' }}>
        <div className="col gap-s" style={{ overflow: 'auto', maxHeight: '100%' }}>
          {children}
        </div>
      </Panel>
    </div>
  );
}

function OfferRow({
  name,
  summary,
  cost,
  disabled,
  onBuy,
}: {
  name: string;
  summary: string;
  cost: number;
  disabled: boolean;
  onBuy: () => void;
}) {
  return (
    <div className="col gap-s" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 8 }}>
      <div className="mono" style={{ fontSize: 12 }}>
        {name}
      </div>
      <div className="muted mono" style={{ fontSize: 10 }}>
        {summary}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>
          {cost} scrap
        </span>
        <Button small variant="primary" disabled={disabled} onClick={onBuy}>
          Buy
        </Button>
      </div>
    </div>
  );
}

function Empty() {
  return <div className="muted mono" style={{ fontSize: 11 }}>Nothing in stock.</div>;
}
