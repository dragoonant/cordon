import type { Vec2 } from '@sim/types';
import { CAMERA_MARGIN, ZOOM_MAX, ZOOM_MIN } from './constants';
import type { IsoBounds } from './iso';

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Screen<->world transform for MapScene's `worldLayer`. `x`/`y` are the
 * projected iso pixel point (see `iso.ts#toIso`) currently centered in the
 * viewport; `zoom` scales world px to screen px. The world bounds are the
 * map's projected diamond (`iso.ts#mapIsoBounds`), not a plain rectangle —
 * an iso map's diamond isn't centered on the origin unless width === height.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  readonly minZoom = ZOOM_MIN;
  readonly maxZoom = ZOOM_MAX;

  private bounds: IsoBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  viewWidth = 0;
  viewHeight = 0;

  constructor(bounds: IsoBounds) {
    this.setBounds(bounds);
  }

  /** Re-centers on the new bounds' midpoint (called once per `load()`, so a mid-pan reset here is fine). */
  setBounds(bounds: IsoBounds): void {
    this.bounds = bounds;
    this.x = (bounds.minX + bounds.maxX) / 2;
    this.y = (bounds.minY + bounds.maxY) / 2;
    this.clamp();
  }

  setViewport(w: number, h: number): void {
    this.viewWidth = w;
    this.viewHeight = h;
    this.clamp();
  }

  /** Fits the whole map's projected diamond in the viewport (used as the initial view, and by the `fitToMap()` extra). */
  fit(): void {
    const { minX, maxX, minY, maxY } = this.bounds;
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    if (this.viewWidth <= 0 || this.viewHeight <= 0 || worldW <= 0 || worldH <= 0) return;
    const margin = 32;
    const zx = (this.viewWidth - margin * 2) / worldW;
    const zy = (this.viewHeight - margin * 2) / worldH;
    this.zoom = clampNum(Math.min(zx, zy), this.minZoom, this.maxZoom);
    this.x = (minX + maxX) / 2;
    this.y = (minY + maxY) / 2;
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
    const minX = this.bounds.minX - CAMERA_MARGIN + halfW;
    const maxX = this.bounds.maxX + CAMERA_MARGIN - halfW;
    const minY = this.bounds.minY - CAMERA_MARGIN + halfH;
    const maxY = this.bounds.maxY + CAMERA_MARGIN - halfH;
    this.x = minX > maxX ? (minX + maxX) / 2 : clampNum(this.x, minX, maxX);
    this.y = minY > maxY ? (minY + maxY) / 2 : clampNum(this.y, minY, maxY);
  }
}
