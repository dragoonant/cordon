/**
 * Procedural pilot portrait cards (96x96) used for cut-ins, squad rosters,
 * and last-transmission holds. Deterministic per pilotDefId: the same pilot
 * always renders with the same hair/skin/face so repeat calls look stable
 * even though nothing here is cached by the caller alone.
 */
import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import type { Faction } from '@sim/types';
import { BASE_PALETTE, FACTION_ACCENT, SKIN_TONES } from './palette';

export type Expression = 'neutral' | 'shout' | 'strained' | 'grin';

const HAIR_COLORS = [0x2b2320, 0x151515, 0x6b5c3d, 0x4a2f22, 0x8a8a8a, 0x1a2233];

/** Tiny FNV-1a style hash — kept local since sprites/ may only import types.ts + pixi.js. */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function drawHair(g: Graphics, variant: number, color: number, cx: number, cy: number, r: number): void {
  switch (variant) {
    case 0: // short cap
      g.ellipse(cx, cy - r * 0.55, r * 1.02, r * 0.62).fill(color);
      break;
    case 1: // spiky
      for (let i = -2; i <= 2; i++) {
        const x = cx + i * r * 0.35;
        g.poly([x - r * 0.16, cy - r * 0.4, x, cy - r * 1.15, x + r * 0.16, cy - r * 0.4]).fill(color);
      }
      break;
    case 2: // side-swept
      g.ellipse(cx - r * 0.1, cy - r * 0.5, r * 1.05, r * 0.65).fill(color);
      g.poly([cx + r * 0.5, cy - r * 0.3, cx + r * 1.1, cy + r * 0.15, cx + r * 0.6, cy + r * 0.1]).fill(color);
      break;
    case 3: // long back + fringe
      g.ellipse(cx, cy - r * 0.5, r * 1.05, r * 0.6).fill(color);
      g.roundRect(cx - r * 0.95, cy - r * 0.3, r * 0.35, r * 1.3, r * 0.15).fill(color);
      g.roundRect(cx + r * 0.6, cy - r * 0.3, r * 0.35, r * 1.3, r * 0.15).fill(color);
      break;
    case 4: // mohawk
      g.ellipse(cx, cy - r * 0.4, r * 0.98, r * 0.45).fill(HAIR_COLORS[(variant + 2) % HAIR_COLORS.length]);
      g.roundRect(cx - r * 0.14, cy - r * 1.2, r * 0.28, r * 0.9, r * 0.1).fill(color);
      break;
    default: // buzz
      g.ellipse(cx, cy - r * 0.62, r * 1.0, r * 0.42).fill(color);
      break;
  }
}

function drawFace(g: Graphics, expression: Expression, cx: number, cy: number, r: number, accent: number): void {
  // Eyes: two dashes.
  const eyeY = cy - r * 0.05;
  const browY = eyeY - r * 0.32;
  g.roundRect(cx - r * 0.42, eyeY, r * 0.24, r * 0.07, r * 0.03).fill(BASE_PALETTE.black);
  g.roundRect(cx + r * 0.18, eyeY, r * 0.24, r * 0.07, r * 0.03).fill(BASE_PALETTE.black);

  switch (expression) {
    case 'neutral':
      g.roundRect(cx - r * 0.16, cy + r * 0.42, r * 0.32, r * 0.05, r * 0.02).fill(BASE_PALETTE.black);
      break;
    case 'shout':
      g.roundRect(cx - r * 0.5, browY - r * 0.05, r * 0.24, r * 0.06, r * 0.02).fill(BASE_PALETTE.black);
      g.roundRect(cx + r * 0.26, browY - r * 0.05, r * 0.24, r * 0.06, r * 0.02).fill(BASE_PALETTE.black);
      g.ellipse(cx, cy + r * 0.48, r * 0.22, r * 0.16).fill(BASE_PALETTE.black);
      break;
    case 'strained':
      g.roundRect(cx - r * 0.18, cy + r * 0.4, r * 0.36, r * 0.05, r * 0.02).fill(BASE_PALETTE.black);
      g.roundRect(cx - r * 0.06, cy + r * 0.36, r * 0.05, r * 0.05, r * 0.02).fill(BASE_PALETTE.black);
      g.roundRect(cx + r * 0.06, cy + r * 0.36, r * 0.05, r * 0.05, r * 0.02).fill(BASE_PALETTE.black);
      // sweat drop
      g.poly([cx + r * 0.62, cy - r * 0.35, cx + r * 0.72, cy - r * 0.1, cx + r * 0.52, cy - r * 0.1]).fill({
        color: accent,
        alpha: 0.85,
      });
      break;
    case 'grin':
      g.moveTo(cx - r * 0.28, cy + r * 0.34);
      g.lineTo(cx, cy + r * 0.5);
      g.lineTo(cx + r * 0.28, cy + r * 0.34);
      g.stroke({ width: r * 0.06, color: BASE_PALETTE.black, cap: 'round', join: 'round' });
      break;
  }
}

export function buildPortraitContainer(
  pilotDefId: string,
  faction: Faction,
  expression: Expression,
  callsign: string,
  size = 96,
): Container {
  const accent = FACTION_ACCENT[faction];
  const h = hashStr(pilotDefId);
  const skin = SKIN_TONES[h % SKIN_TONES.length];
  const hairVariant = (h >>> 3) % 6;
  const hairColor = HAIR_COLORS[(h >>> 7) % HAIR_COLORS.length];

  const container = new Container();
  const g = new Graphics();
  container.addChild(g);

  // Background: dark panel tinted with the faction accent (single saturated hint only).
  const grad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: BASE_PALETTE.shadow },
      { offset: 1, color: mixColor(BASE_PALETTE.shadow, accent, 0.28) },
    ],
  });
  g.rect(0, 0, size, size).fill(grad);
  g.rect(1, 1, size - 2, size - 2).stroke({ width: 2, color: accent });

  const cx = size * 0.5;
  const cy = size * 0.46;
  const r = size * 0.3;

  // Head + neck + shoulders hint.
  g.roundRect(cx - r * 0.55, cy + r * 0.85, r * 1.1, r * 0.6, r * 0.15).fill(skin);
  g.roundRect(cx - r * 0.9, cy + r * 1.15, r * 1.8, size * 0.22, r * 0.2).fill(BASE_PALETTE.gunmetalDark);
  g.circle(cx, cy, r).fill(skin);

  drawFace(g, expression, cx, cy, r, accent);
  drawHair(g, hairVariant, hairColor, cx, cy, r);

  const initials = callsign
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '??';
  const label = new Text({
    text: initials,
    style: {
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold',
      fontSize: size * 0.16,
      fill: BASE_PALETTE.white,
      stroke: { width: 3, color: BASE_PALETTE.black },
    },
  });
  label.anchor.set(1, 1);
  label.x = size - size * 0.06;
  label.y = size - size * 0.04;
  container.addChild(label);

  return container;
}

/** Linear-blend two 0xRRGGBB colors; t=0 -> a, t=1 -> b. */
function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const gC = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gC << 8) | bl;
}
