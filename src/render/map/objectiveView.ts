/**
 * Display object for one objective marker: radius ring (static ellipse),
 * progress arc + status icon (redrawn on change), HP bar (if the def has
 * HP), and a name label. Position interpolates toward `ObjectiveState.pos`
 * each frame (convoys move; a `destroy_target` crosshair tracks its target
 * squad if the sim keeps `pos` in sync for it too).
 *
 * Prefers a hand-authored `/sprites/map/obj_<key>.png` (chroma-keyed,
 * anchored bottom-center at the projected ground point) over the procedural
 * glyph from `objectiveIcons.ts`; falls back to the glyph when that asset
 * isn't published (`destroy_target` never has art — it's always the red
 * crosshair over the target).
 */
import { Circle, Container, Graphics, Sprite, Text, type FederatedPointerEvent } from 'pixi.js';
import type { Id, ObjectiveDef, ObjectiveKind, ObjectiveState, ObjectiveStatus, Vec2 } from '@sim/types';
import { loadChromaKeyedTexture } from '@render/sprites/chromaKey';
import { STATUS_COLOR } from './constants';
import { isoRadii, toIso } from './iso';
import { lerpTowards } from './interpolate';
import { DESTROY_TARGET_COLOR, drawObjectiveIcon } from './objectiveIcons';
import { dashedEllipse, drawBar, progressEllipseArc } from './shapes';

/** Hitbox / hit-test reference size for objectives with a very small radius. */
const MIN_HIT_RADIUS = 28;
/** Fallback procedural glyph size and the reference size used to place status badges, regardless of whether the real icon ends up bigger/smaller. */
const ICON_REF_SIZE = 64;
const ICON_TARGET_HEIGHT = 72;

const OBJ_SPRITE_KEY: Partial<Record<ObjectiveKind, string>> = {
  evac_station: 'station',
  evac_colony: 'colony',
  convoy: 'convoy',
  derelict: 'derelict',
  relay: 'relay',
  reach_exit: 'exit',
};

export class ObjectiveView {
  readonly container = new Container();
  readonly id: Id;
  /** Set by MapScene; forwards the raw tap event so MapScene can resolve world coords + selection state. */
  onTap: ((e: FederatedPointerEvent) => void) | null = null;

  private readonly def: ObjectiveDef;
  private readonly radii: { rx: number; ry: number };

  private readonly progressRing = new Graphics();
  private readonly iconGfx = new Graphics();
  private readonly statusMarkGfx = new Graphics();
  private readonly hpBarGfx = new Graphics();
  private readonly label: Text;
  private questionMark: Text | null = null;

  private pos: Vec2;
  private lastStatus: ObjectiveStatus | null = null;
  private lastProgress = -1;
  private lastHpRatio = -1;
  private destroyed = false;

  constructor(def: ObjectiveDef, initial: ObjectiveState) {
    this.def = def;
    this.pos = { ...initial.pos };
    this.radii = isoRadii(def.radius);

    const radiusRing = new Graphics();
    dashedEllipse(radiusRing, 0, 0, this.radii.rx, this.radii.ry, { color: 0xffffff, alpha: 0.25, dash: 6, gap: 5, width: 1 });

    this.label = new Text({
      text: def.name,
      style: { fontSize: 11, fill: 0xe8e8ec, align: 'center', fontFamily: 'sans-serif' },
    });
    this.label.anchor.set(0.5, 0);
    this.label.y = this.radii.ry + 10;

    this.container.addChild(radiusRing, this.progressRing, this.iconGfx, this.statusMarkGfx, this.hpBarGfx, this.label);
    const iso = toIso(this.pos);
    this.container.x = iso.x;
    this.container.y = iso.y;

    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    // Circle hit area sized to whichever is bigger: the radius ring or a sane minimum for tiny objectives.
    this.container.hitArea = new Circle(0, 0, Math.max(MIN_HIT_RADIUS, this.radii.rx, this.radii.ry));
    this.container.on('pointertap', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.onTap?.(e);
    });

    this.id = def.id;
    this.redrawIcon('pending');
    this.loadIconSprite();
  }

  private loadIconSprite(): void {
    const spriteKey = OBJ_SPRITE_KEY[this.def.kind];
    if (!spriteKey) return; // destroy_target: always the procedural crosshair
    void loadChromaKeyedTexture(`/sprites/map/obj_${spriteKey}`, ICON_TARGET_HEIGHT).then((tex) => {
      if (this.destroyed || !tex) return;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 1);
      sprite.y = 0;
      this.container.addChildAt(sprite, this.container.getChildIndex(this.iconGfx));
      this.iconGfx.visible = false;
      if (this.questionMark) this.questionMark.visible = false;
    });
  }

  update(state: ObjectiveState, dt: number): void {
    this.pos = lerpTowards(this.pos, state.pos, dt);
    const iso = toIso(this.pos);
    this.container.x = iso.x;
    this.container.y = iso.y;

    const statusChanged = state.status !== this.lastStatus;
    if (statusChanged) {
      this.redrawIcon(state.status);
      this.lastStatus = state.status;
    }
    if (statusChanged || state.progress !== this.lastProgress) {
      this.progressRing.clear();
      progressEllipseArc(this.progressRing, 0, 0, this.radii.rx, this.radii.ry, state.progress, {
        color: STATUS_COLOR[state.status],
        width: 3,
        alpha: 0.9,
      });
      this.lastProgress = state.progress;
    }

    const hpRatio = state.hp !== undefined && this.def.hp ? state.hp / this.def.hp : -1;
    if (hpRatio !== this.lastHpRatio) {
      this.hpBarGfx.clear();
      if (hpRatio >= 0) {
        const w = 36;
        drawBar(this.hpBarGfx, -w / 2, -this.radii.ry - 14, w, 4, hpRatio, {
          fg: hpRatio > 0.5 ? 0x4caf6d : hpRatio > 0.2 ? 0xffa53c : 0xd9534f,
        });
      }
      this.lastHpRatio = hpRatio;
    }
  }

  private redrawIcon(status: ObjectiveStatus): void {
    this.iconGfx.clear();
    const color = this.def.kind === 'destroy_target' ? DESTROY_TARGET_COLOR : STATUS_COLOR[status];
    // Fallback glyph draws centered at the ground point; hidden outright once
    // a real PNG loads (see loadIconSprite), so its own offset stays simple.
    drawObjectiveIcon(this.iconGfx, this.def.kind, 0, 0, ICON_REF_SIZE * 0.7, color);

    if (this.def.kind === 'derelict' && !this.questionMark) {
      this.questionMark = new Text({ text: '?', style: { fontSize: 15, fontWeight: 'bold', fill: color, fontFamily: 'sans-serif' } });
      this.questionMark.anchor.set(0.5);
      this.container.addChildAt(this.questionMark, this.container.getChildIndex(this.iconGfx) + 1);
    }
    if (this.questionMark) this.questionMark.style.fill = color;

    this.statusMarkGfx.clear();
    const bx = ICON_REF_SIZE * 0.38;
    const by = -ICON_REF_SIZE * 0.38;
    if (status === 'complete') {
      this.statusMarkGfx
        .moveTo(bx - 6, by)
        .lineTo(bx - 2, by + 4)
        .lineTo(bx + 6, by - 6)
        .stroke({ width: 2, color: STATUS_COLOR.complete });
    } else if (status === 'failed') {
      const s = 5;
      this.statusMarkGfx.moveTo(bx - s, by - s).lineTo(bx + s, by + s).stroke({ width: 2, color: STATUS_COLOR.failed });
      this.statusMarkGfx.moveTo(bx + s, by - s).lineTo(bx - s, by + s).stroke({ width: 2, color: STATUS_COLOR.failed });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.container.destroy({ children: true });
  }
}
