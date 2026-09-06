/**
 * Display object for one squad: leader icon (from spriteSource, flipped by
 * facing), HP/fuel bars, a state chip, effect visuals (burn trail, ping
 * ring, bait beacon, marked brackets, a generic "has an effect" radio-wave
 * pulse), a selection ring + dotted path-to-target, and a hover ring.
 *
 * All drawing here is in the view's own local space, which tracks the
 * squad's *interpolated* position (`MapScene`/`interpolate.ts` own the
 * lerp/snap decision; this class just renders wherever it's told to be) —
 * projected through `iso.ts#toIso`. The icon is anchored bottom-center at
 * that projected ground point (Ogre Battle 64 style: the unit "stands" on
 * its tile), with bars/label/effects arranged around that anchor instead of
 * around a center point.
 */
import { Circle, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { Id, Squad, Vec2 } from '@sim/types';
import { VISIBILITY_FADE_SECONDS } from './constants';
import { dashedLine, diamondPoints, drawBar, drawCornerBrackets, drawGroundShadow } from './shapes';
import { isoRadii, tileDiamondPoints, toIso } from './iso';
import { lerpTowards, stepTowards } from './interpolate';

export interface SquadVisualInfo {
  hp: number;
  maxHp: number;
  isPlayer: boolean;
  accent: number;
  /** Gated by `visibleEnemyIds` for non-player squads; player squads are always visible. */
  visible: boolean;
  selected: boolean;
}

/** Target on-screen height of the leader icon; width follows the texture's own aspect ratio. */
const ICON_HEIGHT = 40;
const BAR_WIDTH = 34;
const BAR_Y = 4;
const CHIP_Y = 14;
const HIT_RADIUS = 22;
/** Effects anchor near the icon's vertical middle rather than its (ground-level) origin. */
const EFFECT_Y = -ICON_HEIGHT * 0.5;

function toLocalIso(p: Vec2, origin: Vec2): { x: number; y: number } {
  return toIso({ x: p.x - origin.x, y: p.y - origin.y });
}

export class SquadView {
  readonly container = new Container();
  readonly id: Id;
  /** Set by MapScene; forwards the raw tap event (select / inspect_enemy resolution happens in MapScene). */
  onTap: ((e: FederatedPointerEvent) => void) | null = null;

  private readonly iconSprite: Sprite;
  private readonly shadowGfx = new Graphics();
  private readonly selectionRing = new Graphics();
  private readonly hoverRing = new Graphics();
  private readonly bars = new Graphics();
  private readonly chip: Text;
  private readonly effectsGfx = new Graphics();
  private readonly pathGfx = new Graphics();

  private pos: Vec2;
  private facing = 1;
  private alpha = 1;
  private clock = 0;
  private lastChipText = '';

  constructor(squad: Squad, texture: Texture) {
    this.id = squad.id;
    this.pos = { ...squad.pos };

    this.iconSprite = new Sprite(texture);
    this.iconSprite.anchor.set(0.5, 1);
    this.applyIconScale();

    this.chip = new Text({ text: '', style: { fontSize: 9, fontWeight: 'bold', fill: 0xffffff, fontFamily: 'sans-serif' } });
    this.chip.anchor.set(0.5, 0);
    this.chip.y = CHIP_Y;

    drawGroundShadow(this.shadowGfx);

    this.container.addChild(
      this.pathGfx,
      this.shadowGfx,
      this.selectionRing,
      this.effectsGfx,
      this.iconSprite,
      this.hoverRing,
      this.bars,
      this.chip
    );
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = new Circle(0, -ICON_HEIGHT * 0.5, HIT_RADIUS);
    this.container.on('pointerover', () => {
      this.hoveredInternal = true;
    });
    this.container.on('pointerout', () => {
      this.hoveredInternal = false;
    });
    this.container.on('pointertap', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.onTap?.(e);
    });

    const iso = toIso(this.pos);
    this.container.x = iso.x;
    this.container.y = iso.y;
  }

  private hoveredInternal = false;
  get hovered(): boolean {
    return this.hoveredInternal;
  }

  /** Scales the icon to `ICON_HEIGHT` tall, preserving the texture's aspect ratio and the current facing flip. */
  private applyIconScale(): void {
    const tex = this.iconSprite.texture;
    const s = tex.height > 0 ? ICON_HEIGHT / tex.height : 1;
    this.iconSprite.scale.set(s * this.facing, s);
  }

  setTexture(texture: Texture): void {
    this.iconSprite.texture = texture;
    this.applyIconScale();
  }

  update(dt: number, squad: Squad, info: SquadVisualInfo): void {
    this.clock += dt;

    // Facing flips on the *projected* (screen) x delta, not the raw tile
    // delta — e.g. moving purely "north" in tile-space (dx===dy) still
    // reads as moving left on screen, so it should flip.
    const rawDelta = { x: squad.pos.x - this.pos.x, y: squad.pos.y - this.pos.y };
    const projDelta = toIso(rawDelta);
    if (Math.abs(projDelta.x) > 1e-3) this.facing = projDelta.x > 0 ? 1 : -1;

    this.pos = lerpTowards(this.pos, squad.pos, dt);
    const iso = toIso(this.pos);
    this.container.x = iso.x;
    this.container.y = iso.y;
    this.applyIconScale();

    const targetAlpha = info.visible ? 1 : 0;
    this.alpha = stepTowards(this.alpha, targetAlpha, dt / VISIBILITY_FADE_SECONDS);
    this.container.alpha = this.alpha;
    this.container.eventMode = this.alpha > 0.05 ? 'static' : 'none';

    this.chip.style.fill = info.accent;

    this.drawBars(squad, info);
    this.drawChip(squad);
    this.drawSelectionAndHover(squad, info);
    this.drawEffects(squad);
    this.drawPath(squad, info.selected);
  }

  private drawBars(squad: Squad, info: SquadVisualInfo): void {
    this.bars.clear();
    if (info.maxHp <= 0) return;
    const hpRatio = info.hp / info.maxHp;
    const hpColor = hpRatio > 0.5 ? 0x4caf6d : hpRatio > 0.2 ? 0xffa53c : 0xd9534f;
    drawBar(this.bars, -BAR_WIDTH / 2, BAR_Y, BAR_WIDTH, 3, hpRatio, { fg: hpColor });
    if (info.isPlayer) {
      drawBar(this.bars, -BAR_WIDTH / 2, BAR_Y + 5, BAR_WIDTH, 2, squad.fuel / Math.max(1, squad.maxFuel), { fg: 0xffc36a });
    }
  }

  private drawChip(squad: Squad): void {
    let text = '';
    if (squad.state === 'routed') text = 'ROUTED';
    else if (squad.effects.some((e) => e.type === 'burn')) text = 'BURN';
    else if (squad.effects.some((e) => e.type === 'rest')) text = 'REST';
    if (text !== this.lastChipText) {
      this.chip.text = text;
      this.lastChipText = text;
    }
  }

  private drawSelectionAndHover(squad: Squad, info: SquadVisualInfo): void {
    this.selectionRing.clear();
    if (info.selected) {
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
      const r = isoRadii(0.45 + pulse * 0.04);
      this.selectionRing.ellipse(0, 0, r.rx, r.ry).stroke({ width: 2, color: 0xffffff, alpha: 0.6 + 0.4 * pulse });

      // SRW cursor feel: a crisp light diamond outline on the squad's actual tile, in addition to
      // the pulsing ellipse above. Snapped to the tile grid (not the interpolated sub-tile
      // position) and offset from `this.pos` (what the container is actually positioned at right
      // now) via toIso's linearity, so it reads correctly mid-move too.
      const tileCenter: Vec2 = { x: Math.floor(squad.pos.x) + 0.5, y: Math.floor(squad.pos.y) + 0.5 };
      const localOffset = toIso({ x: tileCenter.x - this.pos.x, y: tileCenter.y - this.pos.y });
      this.selectionRing
        .poly(tileDiamondPoints(localOffset.x, localOffset.y), true)
        .stroke({ width: 1.5, color: 0xd8f0ff, alpha: 0.9 });
    }
    this.hoverRing.clear();
    if (this.hoveredInternal && !info.selected) {
      const r = isoRadii(0.45);
      this.hoverRing.ellipse(0, 0, r.rx, r.ry).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
    }
  }

  private drawEffects(squad: Squad): void {
    this.effectsGfx.clear();
    if (squad.effects.length === 0) return;

    // Generic "has an active effect" radio-wave pulse on the ground beneath the squad.
    const pulse = (Math.sin(this.clock * 3) + 1) / 2;
    const genericRing = isoRadii(0.4 + pulse * 0.08);
    this.effectsGfx.ellipse(0, 0, genericRing.rx, genericRing.ry).stroke({ width: 1, color: 0xffffff, alpha: 0.12 + 0.15 * pulse });

    for (const effect of squad.effects) {
      switch (effect.type) {
        case 'burn': {
          const flicker = 0.7 + 0.3 * Math.sin(this.clock * 20);
          const bx = -this.facing * ICON_HEIGHT * 0.45;
          const tipX = bx - this.facing * 9 * flicker;
          this.effectsGfx.poly([bx, EFFECT_Y - 4, tipX, EFFECT_Y, bx, EFFECT_Y + 4], true).fill({ color: 0xff8a3c, alpha: 0.8 });
          break;
        }
        case 'pinged':
        case 'revealed': {
          const t = this.clock % 1;
          const r = isoRadii(0.25 + t * 0.75);
          this.effectsGfx.ellipse(0, 0, r.rx, r.ry).stroke({ width: 1.5, color: 0x6fd1ff, alpha: 1 - t });
          break;
        }
        case 'bait': {
          if (Math.sin(this.clock * 8) > 0) {
            this.effectsGfx.poly(diamondPoints(0, -ICON_HEIGHT - 10, 4), true).fill({ color: 0xff3344 });
          }
          break;
        }
        case 'marked': {
          drawCornerBrackets(this.effectsGfx, 0, EFFECT_Y, ICON_HEIGHT * 0.45, 7, 0xdd3344, 2, 0.9);
          break;
        }
        default:
          break;
      }
    }
  }

  private drawPath(squad: Squad, selected: boolean): void {
    this.pathGfx.clear();
    if (!selected) return;
    const waypoints: Vec2[] = squad.targetPos ? [...squad.path, squad.targetPos] : squad.path;
    if (waypoints.length === 0) return;

    let prev = this.pos;
    for (const wp of waypoints) {
      dashedLine(this.pathGfx, toLocalIso(prev, this.pos), toLocalIso(wp, this.pos), {
        color: 0xffffff,
        alpha: 0.6,
        dash: 5,
        gap: 4,
        width: 1.5,
      });
      prev = wp;
    }
    const last = waypoints[waypoints.length - 1];
    const lp = toLocalIso(last, this.pos);
    this.pathGfx.poly(diamondPoints(lp.x, lp.y, 5), true).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
