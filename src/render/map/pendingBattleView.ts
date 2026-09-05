/**
 * The `battle_pending` marker: a pulsing red ring + crossed-swords glyph at
 * the midpoint between the two contacting squads.
 */
import { Container, Graphics } from 'pixi.js';
import type { Vec2 } from '@sim/types';
import { TILE_SIZE } from './constants';

export class PendingBattleView {
  readonly container = new Container();
  private readonly gfx = new Graphics();
  private clock = 0;

  constructor() {
    this.container.addChild(this.gfx);
    this.container.visible = false;
  }

  show(posA: Vec2, posB: Vec2, dt: number): void {
    this.clock += dt;
    this.container.visible = true;
    this.container.x = ((posA.x + posB.x) / 2) * TILE_SIZE;
    this.container.y = ((posA.y + posB.y) / 2) * TILE_SIZE;

    const pulse = (Math.sin(this.clock * 5) + 1) / 2;
    this.gfx.clear();
    this.gfx.circle(0, 0, TILE_SIZE * 0.5 + pulse * 6).stroke({ width: 2, color: 0xd9534f, alpha: 0.35 + 0.35 * pulse });

    const s = TILE_SIZE * 0.28;
    this.gfx.moveTo(-s, -s).lineTo(s, s).stroke({ width: 2.5, color: 0xe8e8ec });
    this.gfx.moveTo(-s, s).lineTo(s, -s).stroke({ width: 2.5, color: 0xe8e8ec });
    this.gfx.circle(0, 0, 2.5).fill({ color: 0xffa53c });
  }

  hide(): void {
    this.container.visible = false;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
