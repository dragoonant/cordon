/**
 * Display object for one squad: leader icon (from spriteSource, flipped by
 * facing), HP/fuel bars, a state chip, effect visuals (burn trail, ping
 * ring, bait beacon, marked brackets, a generic "has an effect" radio-wave
 * pulse), a selection ring + dotted path-to-target, and a hover ring.
 *
 * All drawing here is in the view's own local space, which tracks the
 * squad's *interpolated* position (`MapScene`/`interpolate.ts` own the
 * lerp/snap decision; this class just renders wherever it's told to be).
 */
import { Circle, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { Id, Squad, Vec2 } from '@sim/types';
import { TILE_SIZE, VISIBILITY_FADE_SECONDS } from './constants';
import { dashedLine, diamondPoints, drawBar, drawCornerBrackets } from './shapes';
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

function toLocalTile(p: Vec2, origin: Vec2): Vec2 {
  return { x: (p.x - origin.x) * TILE_SIZE, y: (p.y - origin.y) * TILE_SIZE };
}

export class SquadView {
  readonly container = new Container();
  readonly id: Id;
  /** Set by MapScene; forwards the raw tap event (select / inspect_enemy resolution happens in MapScene). */
  onTap: ((e: FederatedPointerEvent) => void) | null = null;

  private readonly iconSprite: Sprite;
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
    this.iconSprite.anchor.set(0.5);
    this.iconSprite.width = TILE_SIZE * 0.8;
    this.iconSprite.height = TILE_SIZE * 0.8;

    this.chip = new Text({ text: '', style: { fontSize: 9, fontWeight: 'bold', fill: 0xffffff, fontFamily: 'sans-serif' } });
    this.chip.anchor.set(0.5, 0);
    this.chip.y = TILE_SIZE * 0.42;

    this.container.addChild(this.pathGfx, this.selectionRing, this.effectsGfx, this.iconSprite, this.hoverRing, this.bars, this.chip);
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = new Circle(0, 0, TILE_SIZE * 0.55);
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

    this.container.x = this.pos.x * TILE_SIZE;
    this.container.y = this.pos.y * TILE_SIZE;
  }

  private hoveredInternal = false;
  get hovered(): boolean {
    return this.hoveredInternal;
  }

  setTexture(texture: Texture): void {
    const wasFlipped = this.facing < 0;
    this.iconSprite.texture = texture;
    this.iconSprite.width = TILE_SIZE * 0.8;
    this.iconSprite.height = TILE_SIZE * 0.8;
    if (wasFlipped) this.iconSprite.scale.x = -Math.abs(this.iconSprite.scale.x);
  }

  update(dt: number, squad: Squad, info: SquadVisualInfo): void {
    this.clock += dt;

    const dx = squad.pos.x - this.pos.x;
    if (Math.abs(dx) > 1e-3) this.facing = dx > 0 ? 1 : -1;

    this.pos = lerpTowards(this.pos, squad.pos, dt);
    this.container.x = this.pos.x * TILE_SIZE;
    this.container.y = this.pos.y * TILE_SIZE;
    this.iconSprite.scale.x = Math.abs(this.iconSprite.scale.x) * this.facing;

    const targetAlpha = info.visible ? 1 : 0;
    this.alpha = stepTowards(this.alpha, targetAlpha, dt / VISIBILITY_FADE_SECONDS);
    this.container.alpha = this.alpha;
    this.container.eventMode = this.alpha > 0.05 ? 'static' : 'none';

    this.chip.style.fill = info.accent;

    this.drawBars(squad, info);
    this.drawChip(squad);
    this.drawSelectionAndHover(info);
    this.drawEffects(squad);
    this.drawPath(squad, info.selected);
  }

  private drawBars(squad: Squad, info: SquadVisualInfo): void {
    this.bars.clear();
    if (info.maxHp <= 0) return;
    const barW = TILE_SIZE * 0.8;
    const hpRatio = info.hp / info.maxHp;
    const hpColor = hpRatio > 0.5 ? 0x4caf6d : hpRatio > 0.2 ? 0xffa53c : 0xd9534f;
    drawBar(this.bars, -barW / 2, TILE_SIZE * 0.3, barW, 3, hpRatio, { fg: hpColor });
    if (info.isPlayer) {
      drawBar(this.bars, -barW / 2, TILE_SIZE * 0.3 + 5, barW, 2, squad.fuel / Math.max(1, squad.maxFuel), { fg: 0xffc36a });
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

  private drawSelectionAndHover(info: SquadVisualInfo): void {
    this.selectionRing.clear();
    if (info.selected) {
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
      this.selectionRing.circle(0, 0, TILE_SIZE * 0.5 + pulse * 2).stroke({ width: 2, color: 0xffffff, alpha: 0.6 + 0.4 * pulse });
    }
    this.hoverRing.clear();
    if (this.hoveredInternal && !info.selected) {
      this.hoverRing.circle(0, 0, TILE_SIZE * 0.5).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
    }
  }

  private drawEffects(squad: Squad): void {
    this.effectsGfx.clear();
    if (squad.effects.length === 0) return;

    // Generic "has an active effect" radio-wave pulse.
    const pulse = (Math.sin(this.clock * 3) + 1) / 2;
    this.effectsGfx.circle(0, 0, TILE_SIZE * 0.45 + pulse * 4).stroke({ width: 1, color: 0xffffff, alpha: 0.12 + 0.15 * pulse });

    for (const effect of squad.effects) {
      switch (effect.type) {
        case 'burn': {
          const flicker = 0.7 + 0.3 * Math.sin(this.clock * 20);
          const bx = -this.facing * TILE_SIZE * 0.5;
          const tipX = bx - this.facing * 10 * flicker;
          this.effectsGfx.poly([bx, -4, tipX, 0, bx, 4], true).fill({ color: 0xff8a3c, alpha: 0.8 });
          break;
        }
        case 'pinged':
        case 'revealed': {
          const t = this.clock % 1;
          this.effectsGfx.circle(0, 0, TILE_SIZE * 0.3 + t * TILE_SIZE * 0.9).stroke({ width: 1.5, color: 0x6fd1ff, alpha: 1 - t });
          break;
        }
        case 'bait': {
          if (Math.sin(this.clock * 8) > 0) {
            this.effectsGfx.poly(diamondPoints(0, -TILE_SIZE * 0.6, 4), true).fill({ color: 0xff3344 });
          }
          break;
        }
        case 'marked': {
          drawCornerBrackets(this.effectsGfx, TILE_SIZE * 0.42, 7, 0xdd3344);
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
      dashedLine(this.pathGfx, toLocalTile(prev, this.pos), toLocalTile(wp, this.pos), {
        color: 0xffffff,
        alpha: 0.6,
        dash: 5,
        gap: 4,
        width: 1.5,
      });
      prev = wp;
    }
    const last = waypoints[waypoints.length - 1];
    const lp = toLocalTile(last, this.pos);
    this.pathGfx.poly(diamondPoints(lp.x, lp.y, 5), true).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
