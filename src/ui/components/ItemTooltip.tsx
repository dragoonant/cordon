import React from 'react';
import type { CalloutDef, FrameDef, GameData, Id, SystemDef, WeaponDef } from '@sim/types';
import { Tooltip } from './Tooltip';

export type TooltipKind = 'weapon' | 'system' | 'frame' | 'callout';

function fmtMult(n: number): string {
  return n.toFixed(1);
}

/** Plain-English sentence for a system's effect, with its tuned value baked in. */
function systemEffectSentence(sys: SystemDef): string {
  switch (sys.effect) {
    case 'shield':
      return `Shield: absorbs the first ${sys.value} damage each battle.`;
    case 'booster':
      return `Booster: +${sys.value} evasion and map speed.`;
    case 'ecm':
      return `ECM: enemy accuracy -${sys.value}.`;
    case 'repair_drone':
      return `Repair Drone: heals ${sys.value} HP to this mech each round.`;
    case 'recon':
      return `Recon: forecast variance -${sys.value}%, map vision +${sys.value} tiles.`;
    case 'eject':
      return `Eject Assist: +${sys.value}% pilot survival chance if the mech is destroyed.`;
    case 'armor_plate':
      return `Armor Plate: +${sys.value} armor.`;
    case 'targeting':
      return `Targeting: +${sys.value} accuracy and crit chance.`;
    case 'fuel_cell':
      return `Fuel Cell: +${sys.value} fuel capacity on the map.`;
    default:
      return sys.description;
  }
}

function Row({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function WeaponContent({ w }: { w: WeaponDef }) {
  return (
    <div className="col gap-s">
      <strong style={{ color: 'var(--amber)' }}>{w.name}</strong>
      <Row>
        {w.kind.toUpperCase()} · {w.damage} dmg &times; {w.hits} hit{w.hits === 1 ? '' : 's'}
      </Row>
      <Row>
        Accuracy {w.accuracy} · Crit {w.crit}%
      </Row>
      <Row>
        Front &times;{fmtMult(w.frontMult)}
        {w.frontMult === 0 ? " (can't fire from front)" : ''} · Back &times;{fmtMult(w.backMult)}
        {w.backMult === 0 ? " (can't fire from back)" : ''}
      </Row>
      <Row>
        Power {w.power} · Weight {w.weight}
      </Row>
      {typeof w.repair === 'number' && <Row>Repairs {w.repair} HP/round to the lowest-HP ally.</Row>}
      {w.tags.length > 0 && (
        <div className="muted" style={{ fontSize: 10 }}>
          Tags: {w.tags.join(', ')}
        </div>
      )}
      {w.callLine && <div style={{ fontStyle: 'italic' }}>&ldquo;{w.callLine}&rdquo;</div>}
    </div>
  );
}

function SystemContent({ s }: { s: SystemDef }) {
  return (
    <div className="col gap-s">
      <strong style={{ color: 'var(--amber)' }}>{s.name}</strong>
      <Row>{systemEffectSentence(s)}</Row>
      <Row>
        Power {s.power} · Weight {s.weight}
      </Row>
    </div>
  );
}

function FrameContent({ f }: { f: FrameDef }) {
  return (
    <div className="col gap-s">
      <strong style={{ color: 'var(--amber)' }}>{f.name}</strong>
      <Row>
        {f.weightClass.toUpperCase()} · {f.mobility.toUpperCase()}
      </Row>
      <Row>
        HP {f.hp} · Armor {f.armor} · Evasion {f.evasion}
      </Row>
      <Row>
        Speed {f.speed} · Generator {f.generator} · Weight {f.weight}
      </Row>
    </div>
  );
}

function CalloutContent({ c }: { c: CalloutDef }) {
  return (
    <div className="col gap-s">
      <strong style={{ color: 'var(--amber)' }}>{c.label}</strong>
      <div style={{ fontStyle: 'italic' }}>&ldquo;{c.line}&rdquo;</div>
      <Row>{c.description}</Row>
      <Row>Tradeoff: {c.tradeoff}</Row>
      <Row>Cost: {c.nerveCost} Nerve</Row>
    </div>
  );
}

export interface ItemTooltipProps {
  kind: TooltipKind;
  id: Id | null | undefined;
  data: GameData;
  children: React.ReactNode;
}

/**
 * Drop-in hover tooltip for any item name in the UI. Looks the def up by
 * `kind`/`id` in `data` and wraps `children` in a `Tooltip`; renders children
 * bare if the id is empty or unknown so callers never need to guard.
 */
export function ItemTooltip({ kind, id, data, children }: ItemTooltipProps) {
  if (!id) return <>{children}</>;
  let content: React.ReactNode = null;
  if (kind === 'weapon') {
    const w = data.weapons[id];
    if (w) content = <WeaponContent w={w} />;
  } else if (kind === 'system') {
    const s = data.systems[id];
    if (s) content = <SystemContent s={s} />;
  } else if (kind === 'frame') {
    const f = data.frames[id];
    if (f) content = <FrameContent f={f} />;
  } else if (kind === 'callout') {
    const c = data.callouts[id];
    if (c) content = <CalloutContent c={c} />;
  }
  if (!content) return <>{children}</>;
  return <Tooltip content={content}>{children}</Tooltip>;
}
