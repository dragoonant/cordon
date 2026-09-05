/**
 * The deploy/landing zone marker: a dashed amber radius circle, plus (on
 * space maps where the carrier is present) a chunky carrier silhouette with
 * an HP bar that tracks `WorldState.carrierHp`.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { MapDef } from '@sim/types';
import { TILE_SIZE } from './constants';
import { dashedCircle, drawBar } from './shapes';

export class DeployZoneView {
  readonly container = new Container();
  private readonly hasCarrier: boolean;
  private readonly hpBarGfx = new Graphics();
  private lastHpRatio = -1;

  constructor(map: MapDef) {
    this.hasCarrier = map.carrierOnMap;
    const cx = map.deployZone.pos.x * TILE_SIZE;
    const cy = map.deployZone.pos.y * TILE_SIZE;
    this.container.x = cx;
    this.container.y = cy;

    const ring = new Graphics();
    dashedCircle(ring, 0, 0, map.deployZone.radius * TILE_SIZE, { color: 0xffa53c, alpha: 0.55, dash: 8, gap: 5, width: 2 });
    this.container.addChild(ring);

    if (this.hasCarrier) {
      const carrier = new Graphics();
      drawCarrierSilhouette(carrier);
      const label = new Text({
        text: 'LANTERN',
        style: { fontSize: 10, fontWeight: 'bold', fill: 0xffa53c, fontFamily: 'sans-serif' },
      });
      label.anchor.set(0.5, 1);
      label.y = -TILE_SIZE * 0.75;
      this.container.addChild(carrier, this.hpBarGfx, label);
    }
  }

  update(carrierHp: number, carrierMaxHp: number): void {
    if (!this.hasCarrier) return;
    const ratio = carrierMaxHp > 0 ? carrierHp / carrierMaxHp : 1;
    if (ratio === this.lastHpRatio) return;
    this.lastHpRatio = ratio;
    this.hpBarGfx.clear();
    const w = 60;
    drawBar(this.hpBarGfx, -w / 2, -TILE_SIZE * 0.9, w, 5, ratio, {
      fg: ratio > 0.5 ? 0x4caf6d : ratio > 0.2 ? 0xffa53c : 0xd9534f,
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

function drawCarrierSilhouette(g: Graphics): void {
  const w = TILE_SIZE * 2.2;
  const h = TILE_SIZE * 0.9;
  // long hull
  g.poly(
    [-w / 2, -h * 0.2, -w * 0.35, -h / 2, w * 0.35, -h / 2, w / 2, -h * 0.15, w / 2, h * 0.2, -w * 0.4, h / 2, -w / 2, h * 0.2],
    true
  )
    .fill({ color: 0x5c6270 })
    .stroke({ width: 2, color: 0x30343d });
  // bridge
  g.roundRect(-w * 0.05, -h * 0.85, w * 0.22, h * 0.5, 2).fill({ color: 0x6c7280 }).stroke({ width: 1.5, color: 0x30343d });
  // hangar bay
  g.rect(-w * 0.32, -h * 0.05, w * 0.35, h * 0.2).fill({ color: 0x24262c });
  // amber running lights
  for (let i = -2; i <= 2; i++) {
    g.circle(i * w * 0.15, -h * 0.15, 2).fill({ color: 0xffa53c, alpha: 0.9 });
  }
}
