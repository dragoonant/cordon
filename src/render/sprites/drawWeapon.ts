/**
 * Weapon overlays, drawn once per animKey family and mounted on a frame's
 * attachment points (GDD §3: "a mech sprite is a frame body plus weapon
 * overlays drawn on shared attachment points"). Keeps the sprite budget at
 * frames × weapon-families instead of frames × weapons.
 */
import { Container, Graphics } from 'pixi.js';
import { BASE_PALETTE } from './palette';
import type { AttachPoints } from './drawFrame';

type WeaponFamily = 'pole' | 'blade' | 'rifle' | 'shoulder_box' | 'repair_tool';

function familyFor(animKey: string): WeaponFamily {
  switch (animKey) {
    case 'lance':
    case 'maul':
      return 'pole';
    case 'slash':
      return 'blade';
    case 'burst':
    case 'beam':
    case 'rail':
      return 'rifle';
    case 'missiles':
    case 'flak':
      return 'shoulder_box';
    case 'repair':
      return 'repair_tool';
    default:
      return 'rifle';
  }
}

/** Builds the overlay container in the same local space as the frame body. */
export function buildWeaponOverlay(animKey: string, accent: number, H: number, attach: AttachPoints): Container {
  const family = familyFor(animKey);
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);
  const hx = attach.rightHand.x;
  const hy = attach.rightHand.y;
  const sx = attach.rightShoulder.x;
  const sy = attach.rightShoulder.y;

  switch (family) {
    case 'pole': {
      const len = H * 0.62;
      const w = H * 0.055;
      g.roundRect(hx - w / 2, hy - len, w, len, w * 0.3).fill(BASE_PALETTE.gunmetalDark);
      g.rect(hx - w * 1.15, hy - len - H * 0.015, w * 2.3, H * 0.05).fill(accent);
      g.circle(hx, hy - len, w * 0.6).fill(BASE_PALETTE.shadow);
      break;
    }
    case 'blade': {
      const len = H * 0.42;
      g.poly([hx, hy - len, hx + H * 0.06, hy - len * 0.32, hx + H * 0.02, hy, hx - H * 0.03, hy - len * 0.28]).fill(BASE_PALETTE.bone);
      g.poly([hx - H * 0.01, hy - len * 0.85, hx + H * 0.025, hy - len * 0.4, hx, hy - len * 0.4, hx - H * 0.02, hy - len * 0.8]).fill(
        accent,
      );
      g.roundRect(hx - H * 0.025, hy - H * 0.05, H * 0.05, H * 0.09, H * 0.015).fill(BASE_PALETTE.gunmetalDark);
      break;
    }
    case 'rifle': {
      const len = H * 0.52;
      const w = H * 0.085;
      g.roundRect(hx, hy - w / 2, len, w, w * 0.25).fill(BASE_PALETTE.gunmetalDark);
      g.rect(hx + len * 0.08, hy - w * 0.15, len * 0.7, w * 0.3).fill(accent);
      g.roundRect(hx - H * 0.05, hy - w * 0.7, H * 0.09, w * 1.4, w * 0.2).fill(BASE_PALETTE.shadow);
      break;
    }
    case 'shoulder_box': {
      const w = H * 0.24;
      const h = H * 0.22;
      const bx = sx - w * 0.25;
      const by = sy - h - H * 0.03;
      g.roundRect(bx, by, w, h, h * 0.15).fill(BASE_PALETTE.olive);
      g.rect(bx + w * 0.12, by + h * 0.18, w * 0.28, h * 0.22).fill(accent);
      g.rect(bx + w * 0.56, by + h * 0.18, w * 0.28, h * 0.22).fill(accent);
      g.rect(bx + w * 0.12, by + h * 0.56, w * 0.28, h * 0.22).fill(BASE_PALETTE.oliveDark);
      g.rect(bx + w * 0.56, by + h * 0.56, w * 0.28, h * 0.22).fill(BASE_PALETTE.oliveDark);
      break;
    }
    case 'repair_tool': {
      const len = H * 0.3;
      g.roundRect(hx - H * 0.02, hy - len, H * 0.04, len, H * 0.015).fill(BASE_PALETTE.gunmetal);
      g.circle(hx, hy - len, H * 0.045).fill(accent);
      g.rect(hx - H * 0.03, hy - len - H * 0.03, H * 0.02, H * 0.05).fill(BASE_PALETTE.gunmetalDark);
      g.rect(hx + H * 0.01, hy - len - H * 0.03, H * 0.02, H * 0.05).fill(BASE_PALETTE.gunmetalDark);
      break;
    }
  }
  return container;
}
