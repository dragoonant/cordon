/**
 * Per-kind glyph drawing for objective markers. Draws only the icon shape
 * (centered at 0,0 in the caller's local space) — the radius ring, progress
 * arc, HP bar and label are handled by `ObjectiveView`. The 'derelict' kind's
 * '?' glyph is a `Text` node owned by `ObjectiveView` (not drawable via
 * Graphics alone), so it isn't drawn here.
 */
import type { Graphics } from 'pixi.js';
import type { ObjectiveKind } from '@sim/types';
import { diamondPoints, regularPolygonPoints } from './shapes';

/** destroy_target's crosshair is always red, regardless of objective status — it marks a kill target, not progress. */
export const DESTROY_TARGET_COLOR = 0xdd3344;

export function drawObjectiveIcon(g: Graphics, kind: ObjectiveKind, cx: number, cy: number, size: number, color: number): void {
  switch (kind) {
    case 'evac_station': {
      g.poly(regularPolygonPoints(cx, cy, size * 0.5, 6, Math.PI / 6), true)
        .fill({ color, alpha: 0.22 })
        .stroke({ width: 2, color });
      g.circle(cx, cy, size * 0.12).fill({ color });
      break;
    }
    case 'evac_colony': {
      const w = size * 0.62;
      const h = size * 0.7;
      g.roundRect(cx - w / 2, cy - h / 2, w, h, 3).fill({ color, alpha: 0.22 }).stroke({ width: 2, color });
      g.ellipse(cx, cy - h / 2, w / 2, 3).fill({ color, alpha: 0.6 });
      g.ellipse(cx, cy + h / 2, w / 2, 3).fill({ color, alpha: 0.6 });
      break;
    }
    case 'convoy': {
      for (let i = 1; i <= 3; i++) {
        g.rect(cx - size * 0.5 - i * 5, cy - 2, 6, 4).fill({ color, alpha: 0.16 * (4 - i) });
      }
      g.roundRect(cx - size * 0.35, cy - size * 0.2, size * 0.6, size * 0.3, 2)
        .fill({ color, alpha: 0.3 })
        .stroke({ width: 1.5, color });
      g.circle(cx - size * 0.2, cy + size * 0.13, 3).fill({ color });
      g.circle(cx + size * 0.15, cy + size * 0.13, 3).fill({ color });
      break;
    }
    case 'derelict': {
      const pts = [
        cx - size * 0.4, cy + size * 0.3,
        cx - size * 0.1, cy - size * 0.4,
        cx + size * 0.3, cy - size * 0.1,
        cx + size * 0.15, cy + size * 0.35,
      ];
      g.poly(pts, true).fill({ color, alpha: 0.2 }).stroke({ width: 2, color });
      g.moveTo(cx - size * 0.4, cy + size * 0.3)
        .lineTo(cx + size * 0.1, cy - size * 0.05)
        .stroke({ width: 1.5, color, alpha: 0.6 });
      break;
    }
    case 'relay': {
      g.rect(cx - 2, cy - size * 0.5, 4, size).fill({ color });
      g.moveTo(cx - size * 0.3, cy - size * 0.5).lineTo(cx, cy - size * 0.65).lineTo(cx + size * 0.3, cy - size * 0.5).stroke({ width: 1.5, color });
      g.circle(cx, cy - size * 0.65, 2.5).fill({ color });
      g.circle(cx, cy + size * 0.5, size * 0.15).stroke({ width: 1.5, color, alpha: 0.6 });
      break;
    }
    case 'destroy_target': {
      g.circle(cx, cy, size * 0.45).stroke({ width: 2, color: DESTROY_TARGET_COLOR });
      g.moveTo(cx - size * 0.62, cy).lineTo(cx + size * 0.62, cy).stroke({ width: 1.5, color: DESTROY_TARGET_COLOR });
      g.moveTo(cx, cy - size * 0.62).lineTo(cx, cy + size * 0.62).stroke({ width: 1.5, color: DESTROY_TARGET_COLOR });
      break;
    }
    case 'reach_exit': {
      g.rect(cx - size * 0.45, cy - size * 0.5, 4, size).fill({ color });
      g.rect(cx + size * 0.45 - 4, cy - size * 0.5, 4, size).fill({ color });
      g.moveTo(cx - size * 0.25, cy + size * 0.1).lineTo(cx, cy - size * 0.25).lineTo(cx + size * 0.25, cy + size * 0.1).stroke({ width: 2, color });
      break;
    }
    default: {
      g.poly(diamondPoints(cx, cy, size * 0.4), true).stroke({ width: 2, color });
      break;
    }
  }
}
