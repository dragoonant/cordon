/**
 * Display object for one objective marker: radius ring (static), progress
 * arc + status icon (redrawn on change), HP bar (if the def has HP), and a
 * name label. Position interpolates toward `ObjectiveState.pos` each frame
 * (convoys move; a `destroy_target` crosshair tracks its target squad if the
 * sim keeps `pos` in sync for it too).
 */
import { Circle, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import type { Id, ObjectiveDef, ObjectiveState, ObjectiveStatus, Vec2 } from '@sim/types';
import { STATUS_COLOR, TILE_SIZE } from './constants';
import { lerpTowards } from './interpolate';
import { DESTROY_TARGET_COLOR, drawObjectiveIcon } from './objectiveIcons';
import { dashedCircle, drawBar, progressArc } from './shapes';

export class ObjectiveView {
  readonly container = new Container();
  readonly id: Id;
  /** Set by MapScene; forwards the raw tap event so MapScene can resolve world coords + selection state. */
  onTap: ((e: FederatedPointerEvent) => void) | null = null;

  private readonly def: ObjectiveDef;
  private readonly radiusPx: number;
  private readonly iconColor: number;

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

  constructor(def: ObjectiveDef, initial: ObjectiveState) {
    this.def = def;
    this.pos = { ...initial.pos };
    this.radiusPx = def.radius * TILE_SIZE;
    this.iconColor = def.kind === 'destroy_target' ? DESTROY_TARGET_COLOR : STATUS_COLOR.pending;

    const radiusRing = new Graphics();
    dashedCircle(radiusRing, 0, 0, this.radiusPx, { color: 0xffffff, alpha: 0.25, dash: 6, gap: 5, width: 1 });

    this.label = new Text({
      text: def.name,
      style: { fontSize: 11, fill: 0xe8e8ec, align: 'center', fontFamily: 'sans-serif' },
    });
    this.label.anchor.set(0.5, 0);
    this.label.y = this.radiusPx + 10;

    this.container.addChild(radiusRing, this.progressRing, this.iconGfx, this.statusMarkGfx, this.hpBarGfx, this.label);
    this.container.x = this.pos.x * TILE_SIZE;
    this.container.y = this.pos.y * TILE_SIZE;

    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = new Circle(0, 0, Math.max(TILE_SIZE * 0.4, this.radiusPx));
    this.container.on('pointertap', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.onTap?.(e);
    });

    this.id = def.id;
    this.redrawIcon('pending');
  }

  update(state: ObjectiveState, dt: number): void {
    this.pos = lerpTowards(this.pos, state.pos, dt);
    this.container.x = this.pos.x * TILE_SIZE;
    this.container.y = this.pos.y * TILE_SIZE;

    const statusChanged = state.status !== this.lastStatus;
    if (statusChanged) {
      this.redrawIcon(state.status);
      this.lastStatus = state.status;
    }
    if (statusChanged || state.progress !== this.lastProgress) {
      this.progressRing.clear();
      progressArc(this.progressRing, 0, 0, this.radiusPx, state.progress, { color: STATUS_COLOR[state.status], width: 3, alpha: 0.9 });
      this.lastProgress = state.progress;
    }

    const hpRatio = state.hp !== undefined && this.def.hp ? state.hp / this.def.hp : -1;
    if (hpRatio !== this.lastHpRatio) {
      this.hpBarGfx.clear();
      if (hpRatio >= 0) {
        const w = 36;
        drawBar(this.hpBarGfx, -w / 2, -this.radiusPx - 14, w, 4, hpRatio, {
          fg: hpRatio > 0.5 ? 0x4caf6d : hpRatio > 0.2 ? 0xffa53c : 0xd9534f,
        });
      }
      this.lastHpRatio = hpRatio;
    }
  }

  private redrawIcon(status: ObjectiveStatus): void {
    this.iconGfx.clear();
    const color = this.def.kind === 'destroy_target' ? DESTROY_TARGET_COLOR : STATUS_COLOR[status];
    drawObjectiveIcon(this.iconGfx, this.def.kind, 0, 0, TILE_SIZE * 0.7, color);

    if (this.def.kind === 'derelict' && !this.questionMark) {
      this.questionMark = new Text({ text: '?', style: { fontSize: 15, fontWeight: 'bold', fill: color, fontFamily: 'sans-serif' } });
      this.questionMark.anchor.set(0.5);
      this.container.addChildAt(this.questionMark, this.container.getChildIndex(this.iconGfx) + 1);
    }
    if (this.questionMark) this.questionMark.style.fill = color;

    this.statusMarkGfx.clear();
    const bx = TILE_SIZE * 0.38;
    const by = -TILE_SIZE * 0.38;
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
    this.container.destroy({ children: true });
  }
}
