/**
 * The deploy/landing zone marker: a dashed amber radius ellipse, plus a
 * hand-authored `/sprites/map/obj_carrier.png` (space maps, ~110px tall) or
 * `/sprites/map/obj_landing_zone.png` (surface maps, ~80px tall) sprite,
 * falling back to a procedural silhouette when that asset isn't published.
 * The carrier's HP bar (space maps only — it's the attackable Lantern; a
 * surface LZ has no HP) tracks `WorldState.carrierHp`.
 */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { MapDef } from '@sim/types';
import { loadChromaKeyedTexture } from '@render/sprites/chromaKey';
import { isoRadii, toIso } from './iso';
import { dashedEllipse, drawBar } from './shapes';

const CARRIER_HEIGHT = 110;
const LANDING_ZONE_HEIGHT = 80;

export class DeployZoneView {
  readonly container = new Container();
  private readonly hasCarrier: boolean;
  private readonly fallbackGfx = new Graphics();
  private readonly hpBarGfx = new Graphics();
  private readonly label: Text;
  private iconHeight: number;
  private lastHpRatio = -1;
  private destroyed = false;

  constructor(map: MapDef) {
    this.hasCarrier = map.carrierOnMap;
    const iso = toIso(map.deployZone.pos);
    this.container.x = iso.x;
    this.container.y = iso.y;

    const radii = isoRadii(map.deployZone.radius);
    const ring = new Graphics();
    dashedEllipse(ring, 0, 0, radii.rx, radii.ry, { color: 0xffa53c, alpha: 0.55, dash: 8, gap: 5, width: 2 });
    this.container.addChild(ring);

    const isSpace = map.kind === 'space';
    this.iconHeight = isSpace ? CARRIER_HEIGHT : LANDING_ZONE_HEIGHT;
    drawFallbackDeployIcon(this.fallbackGfx, isSpace, this.iconHeight);
    this.container.addChild(this.fallbackGfx);

    this.label = new Text({
      text: isSpace ? 'LANTERN' : 'LZ',
      style: { fontSize: 10, fontWeight: 'bold', fill: 0xffa53c, fontFamily: 'sans-serif' },
    });
    this.label.anchor.set(0.5, 1);
    this.label.y = -this.iconHeight - 6;
    this.container.addChild(this.hpBarGfx, this.label);

    const spriteKey = isSpace ? 'carrier' : 'landing_zone';
    void loadChromaKeyedTexture(`/sprites/map/obj_${spriteKey}`, this.iconHeight).then((tex) => {
      if (this.destroyed || !tex) return;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 1);
      this.container.addChildAt(sprite, this.container.getChildIndex(this.fallbackGfx));
      this.fallbackGfx.visible = false;
      this.iconHeight = sprite.height;
      this.label.y = -this.iconHeight - 6;
      if (this.hasCarrier) this.lastHpRatio = -1; // force the HP bar to redraw at the sprite's real height
    });
  }

  update(carrierHp: number, carrierMaxHp: number): void {
    if (!this.hasCarrier) return;
    const ratio = carrierMaxHp > 0 ? carrierHp / carrierMaxHp : 1;
    if (ratio === this.lastHpRatio) return;
    this.lastHpRatio = ratio;
    this.hpBarGfx.clear();
    const w = 60;
    drawBar(this.hpBarGfx, -w / 2, -this.iconHeight - 16, w, 5, ratio, {
      fg: ratio > 0.5 ? 0x4caf6d : ratio > 0.2 ? 0xffa53c : 0xd9534f,
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.container.destroy({ children: true });
  }
}

/** Procedural stand-in when `obj_carrier`/`obj_landing_zone` art isn't published yet. Bottom-anchored at (0,0), like the real sprite would be. */
function drawFallbackDeployIcon(g: Graphics, isSpace: boolean, height: number): void {
  if (isSpace) {
    const w = height * 2.4;
    const h = height;
    // long hull, drawn so its belly sits on y=0 (the ground point) and it rises upward (negative y).
    g.poly(
      [-w / 2, -h * 0.55, -w * 0.35, -h * 0.85, w * 0.35, -h * 0.85, w / 2, -h * 0.7, w / 2, -h * 0.3, -w * 0.4, -h * 0.05, -w / 2, -h * 0.3],
      true
    )
      .fill({ color: 0x5c6270 })
      .stroke({ width: 2, color: 0x30343d });
    g.roundRect(-w * 0.05, -h * 1.1, w * 0.22, h * 0.5, 2).fill({ color: 0x6c7280 }).stroke({ width: 1.5, color: 0x30343d });
    g.rect(-w * 0.32, -h * 0.4, w * 0.35, h * 0.2).fill({ color: 0x24262c });
    for (let i = -2; i <= 2; i++) {
      g.circle(i * w * 0.15, -h * 0.5, 2).fill({ color: 0xffa53c, alpha: 0.9 });
    }
  } else {
    // A simple landing pad: a ground ellipse with a cross marker and a low beacon mast.
    const w = height * 1.3;
    const h = height * 0.35;
    g.ellipse(0, -h * 0.15, w / 2, h / 2).fill({ color: 0x2a2d33, alpha: 0.85 }).stroke({ width: 2, color: 0xffa53c, alpha: 0.7 });
    g.moveTo(-w * 0.22, -h * 0.15).lineTo(w * 0.22, -h * 0.15).stroke({ width: 2, color: 0xffa53c, alpha: 0.6 });
    g.moveTo(0, -h * 0.35).lineTo(0, h * 0.05).stroke({ width: 2, color: 0xffa53c, alpha: 0.6 });
    g.rect(-1.5, -height, 3, height * 0.65).fill({ color: 0x6c7280 });
    g.circle(0, -height, 3).fill({ color: 0xffa53c, alpha: 0.9 });
  }
}
