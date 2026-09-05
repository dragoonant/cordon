/**
 * Procedural SD/chibi mech body — GDD §3: 2-3 head-tall proportions, big head
 * (~35% of height), chunky torso, stubby limbs, oversized pauldrons, backpack
 * thrusters. Silhouette-specific traits per FrameDef.silhouette keep frames
 * readable at a glance even before a weapon overlay is added.
 *
 * Everything is drawn in a local space where (0, 0) sits at the mech's waist
 * and +y is down (Pixi convention); the whole figure spans roughly
 * [-0.6H, 0.6H] vertically. Callers bake this to a texture with a bottom-
 * center default anchor so mechs plant their feet on a ground line.
 */
import { Container, Graphics } from 'pixi.js';
import type { Faction, FrameDef } from '@sim/types';
import { BASE_PALETTE, FACTION_ACCENT } from './palette';

export interface AttachPoints {
  /** Where a hand-held weapon overlay roots, in the same local space as the body. */
  rightHand: { x: number; y: number; angle: number };
  /** Where a shoulder-mounted weapon overlay roots. */
  rightShoulder: { x: number; y: number };
}

export interface BuiltFrame {
  container: Container;
  attach: AttachPoints;
  /** Half-height above the waist / half-height below it, for texture framing. */
  topY: number;
  bottomY: number;
  halfWidth: number;
}

type HeadShape = 'angular' | 'round' | 'boxy' | 'tall' | 'monoeye';
type Extra = 'wings' | 'antenna' | 'cannon_shoulder' | 'crest' | 'cape' | 'shield_torso';

interface SilhouetteSpec {
  headShape: HeadShape;
  headScale: number;
  torsoWidthScale: number;
  torsoHeightScale: number;
  pauldronScale: number;
  legScale: number;
  armScale: number;
  extras: Extra[];
}

const SPECS: Record<FrameDef['silhouette'], SilhouetteSpec> = {
  // lean, angular head, wing thrusters
  skirmish: {
    headShape: 'angular',
    headScale: 0.95,
    torsoWidthScale: 0.86,
    torsoHeightScale: 0.98,
    pauldronScale: 0.85,
    legScale: 1.08,
    armScale: 0.95,
    extras: ['wings'],
  },
  // boxy balanced
  line: {
    headShape: 'boxy',
    headScale: 1.0,
    torsoWidthScale: 1.0,
    torsoHeightScale: 1.0,
    pauldronScale: 1.0,
    legScale: 1.0,
    armScale: 1.0,
    extras: [],
  },
  // wide, squat, huge pauldrons, shield-like torso
  bastion: {
    headShape: 'boxy',
    headScale: 1.05,
    torsoWidthScale: 1.4,
    torsoHeightScale: 1.02,
    pauldronScale: 1.6,
    legScale: 0.8,
    armScale: 0.95,
    extras: ['shield_torso'],
  },
  // tall antenna/sensor head, slim
  recon: {
    headShape: 'tall',
    headScale: 0.85,
    torsoWidthScale: 0.78,
    torsoHeightScale: 1.0,
    pauldronScale: 0.72,
    legScale: 1.12,
    armScale: 0.92,
    extras: ['antenna'],
  },
  // low, cannon-shaped shoulder
  siege: {
    headShape: 'angular',
    headScale: 0.92,
    torsoWidthScale: 1.12,
    torsoHeightScale: 0.9,
    pauldronScale: 1.05,
    legScale: 0.78,
    armScale: 1.0,
    extras: ['cannon_shoulder'],
  },
  // smooth rounded mono-eye head, sleeker
  compact_line: {
    headShape: 'monoeye',
    headScale: 0.9,
    torsoWidthScale: 0.85,
    torsoHeightScale: 0.98,
    pauldronScale: 0.85,
    legScale: 1.05,
    armScale: 0.95,
    extras: [],
  },
  // compact_line but taller, crest + cape-like thruster fan
  compact_ace: {
    headShape: 'monoeye',
    headScale: 0.94,
    torsoWidthScale: 0.9,
    torsoHeightScale: 1.1,
    pauldronScale: 0.95,
    legScale: 1.12,
    armScale: 1.0,
    extras: ['crest', 'cape'],
  },
};

function drawHead(g: Graphics, shape: HeadShape, cx: number, cy: number, r: number, accent: number): void {
  switch (shape) {
    case 'angular':
      g.poly([cx, cy - r, cx + r * 0.95, cy - r * 0.1, cx + r * 0.6, cy + r, cx - r * 0.6, cy + r, cx - r * 0.95, cy - r * 0.1]).fill(
        BASE_PALETTE.bone,
      );
      g.poly([cx - r * 0.55, cy - r * 0.05, cx + r * 0.55, cy - r * 0.05, cx + r * 0.3, cy + r * 0.35, cx - r * 0.3, cy + r * 0.35]).fill(
        BASE_PALETTE.visor,
      );
      g.rect(cx - r * 0.35, cy - r * 0.02, r * 0.7, r * 0.18).fill(accent);
      break;
    case 'boxy':
      g.roundRect(cx - r, cy - r * 0.9, r * 2, r * 1.8, r * 0.25).fill(BASE_PALETTE.bone);
      g.rect(cx - r * 0.6, cy - r * 0.15, r * 1.2, r * 0.4).fill(BASE_PALETTE.visor);
      g.rect(cx - r * 0.45, cy - r * 0.05, r * 0.9, r * 0.16).fill(accent);
      break;
    case 'tall':
      g.roundRect(cx - r * 0.85, cy - r * 1.15, r * 1.7, r * 2.1, r * 0.5).fill(BASE_PALETTE.bone);
      g.circle(cx, cy, r * 0.32).fill(accent);
      g.rect(cx - r * 0.05, cy - r * 1.6, r * 0.1, r * 0.55).fill(BASE_PALETTE.gunmetalDark);
      g.circle(cx, cy - r * 1.6, r * 0.14).fill(accent);
      break;
    case 'monoeye':
      g.circle(cx, cy, r).fill(BASE_PALETTE.bone);
      g.ellipse(cx + r * 0.05, cy - r * 0.05, r * 0.62, r * 0.24).fill(BASE_PALETTE.visor);
      g.circle(cx + r * 0.05, cy - r * 0.05, r * 0.14).fill(accent);
      break;
  }
}

function drawExtras(g: Graphics, extras: Extra[], H: number, torsoW: number, torsoTop: number, torsoBottom: number, accent: number): void {
  for (const extra of extras) {
    switch (extra) {
      case 'wings': {
        const y = torsoTop + (torsoBottom - torsoTop) * 0.3;
        g.poly([torsoW / 2, y, torsoW / 2 + H * 0.22, y - H * 0.05, torsoW / 2 + H * 0.16, y + H * 0.16]).fill(BASE_PALETTE.gunmetalDark);
        g.poly([-torsoW / 2, y, -torsoW / 2 - H * 0.22, y - H * 0.05, -torsoW / 2 - H * 0.16, y + H * 0.16]).fill(BASE_PALETTE.gunmetalDark);
        break;
      }
      case 'antenna': {
        g.rect(-H * 0.015, torsoTop - H * 0.28, H * 0.03, H * 0.3).fill(BASE_PALETTE.gunmetalDark);
        g.circle(0, torsoTop - H * 0.28, H * 0.025).fill(accent);
        break;
      }
      case 'cannon_shoulder': {
        const w = H * 0.2;
        const h = H * 0.14;
        g.roundRect(torsoW / 2 - w * 0.2, torsoTop - h * 0.4, w, h, h * 0.3).fill(BASE_PALETTE.gunmetalDark);
        g.circle(torsoW / 2 - w * 0.2 + w, torsoTop - h * 0.4 + h / 2, h * 0.42).fill(BASE_PALETTE.shadow);
        break;
      }
      case 'crest': {
        g.poly([0, torsoTop - H * 0.32, H * 0.05, torsoTop - H * 0.12, -H * 0.05, torsoTop - H * 0.12]).fill(accent);
        break;
      }
      case 'cape': {
        g.poly([
          -torsoW * 0.4,
          torsoTop,
          torsoW * 0.4,
          torsoTop,
          torsoW * 0.55,
          torsoBottom + H * 0.22,
          -torsoW * 0.55,
          torsoBottom + H * 0.22,
        ]).fill({ color: BASE_PALETTE.gunmetalDark, alpha: 0.9 });
        break;
      }
      case 'shield_torso':
        // handled inline by the torso shape itself (see buildFrameContainer)
        break;
    }
  }
}

interface Geometry {
  headR: number;
  headCy: number;
  torsoW: number;
  torsoH: number;
  torsoTop: number;
  torsoBottom: number;
  torsoCy: number;
  legW: number;
  legH: number;
  legGap: number;
  armW: number;
  armH: number;
  shoulderY: number;
  paulR: number;
}

function computeGeometry(spec: SilhouetteSpec, H: number): Geometry {
  const headR = H * 0.175 * spec.headScale;
  const headCy = -H * 0.315;
  const torsoW = H * 0.44 * spec.torsoWidthScale;
  const torsoH = H * 0.36 * spec.torsoHeightScale;
  const torsoTop = headCy + headR * 0.75;
  const torsoBottom = torsoTop + torsoH;
  const torsoCy = torsoTop + torsoH / 2;
  const legW = H * 0.15 * spec.legScale;
  const legH = H * 0.28 * spec.legScale;
  const legGap = torsoW * 0.16;
  const armW = H * 0.12 * spec.armScale;
  const armH = H * 0.26 * spec.armScale;
  const shoulderY = torsoTop + armH * 0.1;
  const paulR = H * 0.14 * spec.pauldronScale;
  return { headR, headCy, torsoW, torsoH, torsoTop, torsoBottom, torsoCy, legW, legH, legGap, armW, armH, shoulderY, paulR };
}

function attachPointsFromGeometry(geo: Geometry): AttachPoints {
  return {
    rightHand: { x: geo.torsoW / 2 + geo.armW * 1.1, y: geo.shoulderY + geo.armH * 0.95, angle: 0 },
    rightShoulder: { x: geo.torsoW / 2 + geo.armW * 0.2, y: geo.shoulderY - geo.paulR * 0.4 },
  };
}

/**
 * Attach points for a silhouette at a given height, computed independently of
 * drawing so `getMechTexture` can mount a weapon overlay on a frame texture
 * whether that texture came from a baked PNG or the procedural fallback.
 */
export function attachPointsFor(silhouette: FrameDef['silhouette'], H: number): AttachPoints {
  return attachPointsFromGeometry(computeGeometry(SPECS[silhouette], H));
}

export interface FrameBounds {
  topY: number;
  bottomY: number;
  halfWidth: number;
}

/** Bounding-box facts for a silhouette at a given height, without drawing anything. */
export function boundsFor(silhouette: FrameDef['silhouette'], H: number): FrameBounds {
  const geo = computeGeometry(SPECS[silhouette], H);
  return {
    topY: geo.headCy - geo.headR * 1.3,
    bottomY: geo.torsoBottom + geo.legH + H * 0.05,
    halfWidth: Math.max(geo.torsoW / 2 + geo.armW + geo.paulR, H * 0.35),
  };
}

/**
 * Builds the mech body as a Pixi Container ready to be baked into a texture.
 * `detailed` trims fine detail at map scale per GDD §3 ("simplified: head +
 * torso + accent").
 */
export function buildFrameContainer(silhouette: FrameDef['silhouette'], faction: Faction, H: number, detailed: boolean): BuiltFrame {
  const spec = SPECS[silhouette];
  const accent = FACTION_ACCENT[faction];
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);

  const geo = computeGeometry(spec, H);
  const { headR, headCy, torsoW, torsoH, torsoTop, torsoBottom, torsoCy, legW, legH, legGap, armW, armH, shoulderY, paulR } = geo;

  const bodyColor = faction === 'compact' ? BASE_PALETTE.gunmetalLight : BASE_PALETTE.gunmetal;
  const trimColor = faction === 'compact' ? BASE_PALETTE.gunmetalDark : BASE_PALETTE.rust;

  if (detailed) {
    // Backpack thrusters, drawn first so the torso occludes their roots.
    const thrusterY = torsoCy;
    g.roundRect(-torsoW * 0.42, thrusterY - torsoH * 0.32, H * 0.09, torsoH * 0.64, H * 0.02).fill(BASE_PALETTE.gunmetalDark);
    g.roundRect(torsoW * 0.42 - H * 0.09, thrusterY - torsoH * 0.32, H * 0.09, torsoH * 0.64, H * 0.02).fill(BASE_PALETTE.gunmetalDark);
    g.circle(-torsoW * 0.375, thrusterY + torsoH * 0.22, H * 0.03).fill(accent);
    g.circle(torsoW * 0.375, thrusterY + torsoH * 0.22, H * 0.03).fill(accent);
  }

  // Legs (stubby, chunky per GDD).
  g.roundRect(-legGap - legW, torsoBottom - H * 0.02, legW, legH, legW * 0.3).fill(bodyColor);
  g.roundRect(legGap, torsoBottom - H * 0.02, legW, legH, legW * 0.3).fill(bodyColor);
  g.roundRect(-legGap - legW, torsoBottom + legH - H * 0.05, legW * 1.15, H * 0.07, H * 0.02).fill(trimColor);
  g.roundRect(legGap - legW * 0.15, torsoBottom + legH - H * 0.05, legW * 1.15, H * 0.07, H * 0.02).fill(trimColor);

  // Arms (stubby).
  g.roundRect(-torsoW / 2 - armW, shoulderY, armW, armH, armW * 0.3).fill(bodyColor);
  g.roundRect(torsoW / 2, shoulderY, armW, armH, armW * 0.3).fill(bodyColor);

  // Torso — bastion gets a flat shield-like slab instead of a rounded block.
  if (spec.extras.includes('shield_torso')) {
    g.roundRect(-torsoW / 2, torsoTop, torsoW, torsoH, torsoW * 0.08).fill(bodyColor);
    g.roundRect(-torsoW * 0.36, torsoTop + torsoH * 0.12, torsoW * 0.72, torsoH * 0.5, torsoW * 0.06).fill(trimColor);
  } else {
    g.roundRect(-torsoW / 2, torsoTop, torsoW, torsoH, torsoW * 0.22).fill(bodyColor);
  }
  // Chest core — the one saturated accent, per GDD §3.
  g.circle(0, torsoCy - torsoH * 0.05, torsoW * 0.16).fill(accent);
  if (detailed) {
    g.roundRect(-torsoW * 0.3, torsoTop + torsoH * 0.65, torsoW * 0.6, torsoH * 0.14, torsoH * 0.05).fill(trimColor);
  }

  // Pauldrons — always oversized vs the arm beneath them.
  g.circle(-torsoW / 2 - armW * 0.2, shoulderY, paulR).fill(bodyColor);
  g.circle(torsoW / 2 + armW * 0.2, shoulderY, paulR).fill(bodyColor);
  if (detailed) {
    g.rect(-torsoW / 2 - armW * 0.2 - paulR * 0.15, shoulderY - paulR * 0.22, paulR * 1.1, paulR * 0.3).fill(accent);
    g.rect(torsoW / 2 + armW * 0.2 - paulR * 0.95, shoulderY - paulR * 0.22, paulR * 1.1, paulR * 0.3).fill(accent);
  }

  // Head — big, per GDD ~35% of total height.
  drawHead(g, spec.headShape, 0, headCy, headR, accent);

  if (detailed) {
    drawExtras(g, spec.extras, H, torsoW, torsoTop, torsoBottom, accent);
  }

  const bounds = boundsFor(silhouette, H);

  return {
    container,
    attach: attachPointsFromGeometry(geo),
    topY: bounds.topY,
    bottomY: bounds.bottomY,
    halfWidth: bounds.halfWidth,
  };
}
