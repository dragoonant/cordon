/**
 * Small stateless drawing helpers shared by the tile baker, deploy zone,
 * objective icons, and squad views. All coordinates are in the caller's
 * local space (usually world-container pixels, i.e. tiles * TILE_SIZE).
 */
import { Graphics } from 'pixi.js';
import type { Vec2 } from '@sim/types';

export interface DashOpts {
  dash?: number;
  gap?: number;
  color: number;
  width?: number;
  alpha?: number;
}

/** Dashed ring, built as a series of short arcs so it reads as a "radius" outline. */
export function dashedCircle(g: Graphics, cx: number, cy: number, r: number, opts: DashOpts): void {
  if (r <= 0) return;
  const dash = opts.dash ?? 6;
  const gap = opts.gap ?? 4;
  const circumference = 2 * Math.PI * r;
  const step = dash + gap;
  const count = Math.max(4, Math.round(circumference / step));
  const angleStep = (Math.PI * 2) / count;
  const dashAngle = angleStep * (dash / step);
  for (let i = 0; i < count; i++) {
    const a0 = i * angleStep;
    const a1 = a0 + dashAngle;
    g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    g.arc(cx, cy, r, a0, a1);
  }
  g.stroke({ width: opts.width ?? 1.5, color: opts.color, alpha: opts.alpha ?? 1 });
}

/** A clockwise progress ring starting at 12 o'clock, filling as `progress` (0..1) grows. */
export function progressArc(g: Graphics, cx: number, cy: number, r: number, progress: number, opts: DashOpts): void {
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0 || r <= 0) return;
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * p;
  g.moveTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
  g.arc(cx, cy, r, start, end);
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

/** Four corner-bracket strokes around a square of half-size `s` — the "marked" reticle. */
export function drawCornerBrackets(g: Graphics, s: number, len: number, color: number, width = 2, alpha = 0.9): void {
  const corners: Array<[number, number, number, number]> = [
    [-s, -s, 1, 1],
    [s, -s, -1, 1],
    [s, s, -1, -1],
    [-s, s, 1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    g.moveTo(cx, cy).lineTo(cx + len * dx, cy);
    g.moveTo(cx, cy).lineTo(cx, cy + len * dy);
  }
  g.stroke({ width, color, alpha });
}
