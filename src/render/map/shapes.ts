/**
 * Small stateless drawing helpers shared by the tile baker, deploy zone,
 * objective icons, and squad views. All coordinates are in the caller's
 * local space (usually world-container pixels, i.e. tiles * TILE_SIZE).
 */
import { Graphics } from 'pixi.js';
import type { Vec2 } from '@sim/types';
import { TILE_H, TILE_W } from './constants';

export interface DashOpts {
  dash?: number;
  gap?: number;
  color: number;
  width?: number;
  alpha?: number;
}

/**
 * Dashed ellipse ring — the iso ground-plane equivalent of a flat map's
 * "radius" circle (rx/ry are typically `isoRadii(tiles)` from `iso.ts`).
 * Graphics has no native elliptical arc, so each dash is a short polyline.
 */
export function dashedEllipse(g: Graphics, cx: number, cy: number, rx: number, ry: number, opts: DashOpts): void {
  if (rx <= 0 || ry <= 0) return;
  const dash = opts.dash ?? 6;
  const gap = opts.gap ?? 4;
  // Ramanujan's approximation — exact circumference isn't needed, just a
  // reasonable dash count for the ellipse's actual size.
  const h = (rx - ry) ** 2 / (rx + ry) ** 2;
  const circumference = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const step = dash + gap;
  const count = Math.max(4, Math.round(circumference / step));
  const angleStep = (Math.PI * 2) / count;
  const dashAngle = angleStep * (dash / step);
  const segs = 3; // short line segments approximating each dash's curve
  const pointAt = (a: number): Vec2 => ({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  for (let i = 0; i < count; i++) {
    const a0 = i * angleStep;
    const p0 = pointAt(a0);
    g.moveTo(p0.x, p0.y);
    for (let s = 1; s <= segs; s++) {
      const p = pointAt(a0 + (dashAngle * s) / segs);
      g.lineTo(p.x, p.y);
    }
  }
  g.stroke({ width: opts.width ?? 1.5, color: opts.color, alpha: opts.alpha ?? 1 });
}

/** A clockwise elliptical progress ring starting at 12 o'clock, filling as `progress` (0..1) grows. Approximated as a polyline (no native elliptical arc). */
export function progressEllipseArc(
  g: Graphics,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  progress: number,
  opts: DashOpts
): void {
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0 || rx <= 0 || ry <= 0) return;
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * p;
  const segs = Math.max(2, Math.round(32 * p));
  g.moveTo(cx + Math.cos(start) * rx, cy + Math.sin(start) * ry);
  for (let i = 1; i <= segs; i++) {
    const a = start + (end - start) * (i / segs);
    g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  g.stroke({ width: opts.width ?? 3, color: opts.color, alpha: opts.alpha ?? 1 });
}

/** Dashed straight segment from `from` to `to` (both local coordinates). */
export function dashedLine(g: Graphics, from: Vec2, to: Vec2, opts: DashOpts): void {
  const dash = opts.dash ?? 5;
  const gap = opts.gap ?? 4;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return;
  const ux = dx / dist;
  const uy = dy / dist;
  let travelled = 0;
  while (travelled < dist) {
    const segEnd = Math.min(dist, travelled + dash);
    g.moveTo(from.x + ux * travelled, from.y + uy * travelled);
    g.lineTo(from.x + ux * segEnd, from.y + uy * segEnd);
    travelled = segEnd + gap;
  }
  g.stroke({ width: opts.width ?? 1.5, color: opts.color, alpha: opts.alpha ?? 1 });
}

/** A background track + filled foreground bar, e.g. HP/fuel. `ratio` is clamped 0..1. */
export function drawBar(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  opts: { fg: number; bg?: number; bgAlpha?: number }
): void {
  const r = Math.max(0, Math.min(1, ratio));
  g.rect(x, y, w, h).fill({ color: opts.bg ?? 0x11131a, alpha: opts.bgAlpha ?? 0.75 });
  if (r > 0) g.rect(x, y, w * r, h).fill({ color: opts.fg });
  g.rect(x, y, w, h).stroke({ width: 1, color: 0x000000, alpha: 0.4 });
}

export function regularPolygonPoints(cx: number, cy: number, r: number, sides: number, rotation = 0): number[] {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (Math.PI * 2 * i) / sides;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

export function diamondPoints(cx: number, cy: number, r: number): number[] {
  return [cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy];
}

/** Radii for the soft ground shadow drawn under every squad icon / objective sprite — see `drawGroundShadow`. */
const SHADOW_RX = TILE_W * 0.22;
const SHADOW_RY = TILE_H * 0.22;

/**
 * Soft dark ellipse "under" a squad/objective sprite, at its ground point
 * (local (0,0) — this is drawn as the FIRST child of the caller's
 * container, so it sits beneath the icon/sprite). Faked blur via a few
 * concentric ellipses of falling alpha (same cheap trick `weather.ts` uses
 * for its nebula/vignette) rather than an actual BlurFilter, since this
 * runs once per entity and a real filter per squad would add up. Static —
 * callers draw it once at construction, it never needs to be redrawn.
 */
export function drawGroundShadow(g: Graphics, rx = SHADOW_RX, ry = SHADOW_RY): void {
  const steps = 3;
  for (let i = steps; i >= 1; i--) {
    const f = i / steps;
    g.ellipse(0, 0, rx * f, ry * f).fill({ color: 0x000000, alpha: 0.18 + 0.12 * (steps - i) });
  }
}

/** Four corner-bracket strokes around a square of half-size `s` centered at `(cx, cy)` — the "marked" reticle. */
export function drawCornerBrackets(g: Graphics, cx: number, cy: number, s: number, len: number, color: number, width = 2, alpha = 0.9): void {
  const corners: Array<[number, number, number, number]> = [
    [cx - s, cy - s, 1, 1],
    [cx + s, cy - s, -1, 1],
    [cx + s, cy + s, -1, -1],
    [cx - s, cy + s, 1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    g.moveTo(x, y).lineTo(x + len * dx, y);
    g.moveTo(x, y).lineTo(x, y + len * dy);
  }
  g.stroke({ width, color, alpha });
}
