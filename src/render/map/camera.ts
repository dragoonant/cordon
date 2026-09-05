import type { Vec2 } from '@sim/types';
import { CAMERA_MARGIN, ZOOM_MAX, ZOOM_MIN } from './constants';

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Screen<->world transform for MapScene's `worldLayer`. `x`/`y` are the
 * world-space (px) point currently centered in the viewport; `zoom` scales
 * world px to screen px. World px = tiles * TILE_SIZE (see constants.ts).
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  readonly minZoom = ZOOM_MIN;
  readonly maxZoom = ZOOM_MAX;

  private worldWidth: number;
  private worldHeight: number;
  viewWidth = 0;
  viewHeight = 0;

  constructor(worldWidth: number, worldHeight: number) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.x = worldWidth / 2;
    this.y = worldHeight / 2;
  }

  setViewport(w: number, h: number): void {
    this.viewWidth = w;
    this.viewHeight = h;
    this.clamp();
  }

  /** Fits the whole map in the viewport (used as the initial view, and by the `fitToMap()` extra). */
  fit(): void {
    if (this.viewWidth <= 0 || this.viewHeight <= 0 || this.worldWidth <= 0 || this.worldHeight <= 0) return;
    const margin = 32;
    const zx = (this.viewWidth - margin * 2) / this.worldWidth;
    const zy = (this.viewHeight - margin * 2) / this.worldHeight;
    this.zoom = clampNum(Math.min(zx, zy), this.minZoom, this.maxZoom);
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
    this.clamp();
  }

  centerOn(worldPos: Vec2): void {
    this.x = worldPos.x;
    this.y = worldPos.y;
    this.clamp();
  }

  /** Pan by a screen-space delta (e.g. pointer movementX/Y). */
  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoom to `newZoom`, keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, newZoom: number): void {
    const clamped = clampNum(newZoom, this.minZoom, this.maxZoom);
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamped;
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: this.x + (sx - this.viewWidth / 2) / this.zoom,
      y: this.y + (sy - this.viewHeight / 2) / this.zoom,
    };
  }

  private clamp(): void {
    const halfW = this.viewWidth / 2 / this.zoom;
    const halfH = this.viewHeight / 2 / this.zoom;
    const minX = -CAMERA_MARGIN + halfW;
    const maxX = this.worldWidth + CAMERA_MARGIN - halfW;
    const minY = -CAMERA_MARGIN + halfH;
    const maxY = this.worldHeight + CAMERA_MARGIN - halfH;
    this.x = minX > maxX ? (minX + maxX) / 2 : clampNum(this.x, minX, maxX);
    this.y = minY > maxY ? (minY + maxY) / 2 : clampNum(this.y, minY, maxY);
  }
}
