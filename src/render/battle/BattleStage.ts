/**
 * CORDON — SRW-style battle stage (render-battle).
 *
 * Owns its own Pixi Application and plays back a `BattleResult.events[]`
 * against the pre-battle `sides` snapshot. Never computes outcomes — every
 * number shown (damage, HP, crit/miss) comes straight from the event
 * stream (CONVENTIONS.md #7).
 *
 * No top-level DOM references: the Application and all Pixi objects are
 * created inside the constructor/methods, so importing this module is safe
 * even outside a browser (e.g. from a test runner).
 */
import { Application, Container, Graphics, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import type { BattleEvent, BattleResult, BattleSide, Faction, GameData, Id, MapKind, SlotIndex, Terrain } from '@sim/types';
import { rowOf } from '@sim/types';
import { getMechTexture, getPortraitTexture, FACTION_ACCENT } from '../sprites';
import type { Expression } from '../sprites';
import { buildBackdrop } from './backdrop';
import { Clock, easeInOutQuad, easeOutBack, easeOutCubic } from './clock';

const DESIGN_W = 1280;
const DESIGN_H = 720;
const GROUND_Y = 500;
const ROW_Y = [GROUND_Y - 130, GROUND_Y, GROUND_Y + 130];

const BODY_FONT = 'Arial, "Segoe UI", sans-serif';

const LABEL_STYLE: TextStyleOptions = {
  fontFamily: BODY_FONT,
  fontWeight: 'bold',
  fontSize: 13,
  fill: 0xf2efe6,
  stroke: { width: 3, color: 0x0a0a0c },
};

const BANNER_STYLE: TextStyleOptions = {
  fontFamily: BODY_FONT,
  fontWeight: '900',
  fontSize: 54,
  fill: 0xf2efe6,
  stroke: { width: 7, color: 0x0a0a0c },
  letterSpacing: 3,
};

const SUB_BANNER_STYLE: TextStyleOptions = {
  fontFamily: BODY_FONT,
  fontWeight: 'bold',
  fontSize: 22,
  fill: 0xd9d2c0,
  stroke: { width: 4, color: 0x0a0a0c },
};

const SPEECH_STYLE: TextStyleOptions = {
  fontFamily: BODY_FONT,
  fontWeight: 'bold',
  fontSize: 15,
  fill: 0x101012,
  wordWrap: true,
  wordWrapWidth: 240,
};

const NAME_STYLE: TextStyleOptions = {
  fontFamily: BODY_FONT,
  fontWeight: '900',
  fontStyle: 'italic',
  fontSize: 46,
  fill: 0xffe9b0,
  stroke: { width: 6, color: 0x0a0a0c },
  letterSpacing: 2,
};

function pilotDefIdOf(pilotId: Id): Id {
  return pilotId.split('#')[0];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

type AnimFamily = 'lunge' | 'slash' | 'burst' | 'beam' | 'rail' | 'missiles' | 'flak' | 'maul' | 'repair' | 'generic';

function animFamilyFor(animKey: string): AnimFamily {
  switch (animKey) {
    case 'lance':
      return 'lunge';
    case 'maul':
      return 'maul';
    case 'slash':
      return 'slash';
    case 'burst':
      return 'burst';
    case 'beam':
      return 'beam';
    case 'rail':
      return 'rail';
    case 'missiles':
      return 'missiles';
    case 'flak':
      return 'flak';
    case 'repair':
      return 'repair';
    default:
      return 'generic';
  }
}

interface MechView {
  side: 'A' | 'B';
  slot: SlotIndex;
  pilotId: Id;
  mechId: Id;
  faction: Faction;
  homeX: number;
  homeY: number;
  container: Container;
  sprite: Sprite;
  hpBg: Graphics;
  hpFill: Graphics;
  label: Text;
  maxHp: number;
  hp: number;
  alive: boolean;
  barWidth: number;
}

export interface BattleStagePlayOpts {
  speed: 'full' | 'fast' | 'results_only';
  onEvent?: (e: BattleEvent, index: number) => void;
  onComplete: () => void;
}

/**
 * Plays one resolved battle as an SRW-style cutscene. Construct once per
 * mount point; call `play()` per battle; `destroy()` on unmount.
 */
export class BattleStage {
  private readonly container: HTMLElement;
  private readonly data: GameData;
  private readonly app: Application;
  private readonly ready: Promise<void>;
  private resizeObserver: ResizeObserver | null = null;

  private root!: Container; // letterbox wrapper, repositioned on resize
  private world!: Container; // fixed DESIGN_W x DESIGN_H content
  private layers!: { backdrop: Container; mech: Container; effects: Container; ui: Container };
  private clock!: Clock;

  private mechViews = new Map<Id, MechView>();
  private result: BattleResult | null = null;
  private opts: BattleStagePlayOpts | null = null;
  private skipping = false;
  private completed = true; // no battle in flight until play() runs

  constructor(container: HTMLElement, data: GameData) {
    this.container = container;
    this.data = data;
    this.app = new Application();
    this.ready = this.initApp();
  }

  private async initApp(): Promise<void> {
    const w = Math.max(1, this.container.clientWidth || DESIGN_W);
    const h = Math.max(1, this.container.clientHeight || DESIGN_H);
    await this.app.init({
      width: w,
      height: h,
      backgroundColor: 0x05060a,
      antialias: true,
      autoDensity: true,
      resolution: typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1,
    });

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    this.container.innerHTML = '';
    this.container.appendChild(canvas);

    this.root = new Container();
    this.world = new Container();
    this.root.addChild(this.world);
    this.app.stage.addChild(this.root);

    this.layers = {
      backdrop: new Container(),
      mech: new Container(),
      effects: new Container(),
      ui: new Container(),
    };
    this.world.addChild(this.layers.backdrop, this.layers.mech, this.layers.effects, this.layers.ui);

    this.clock = new Clock(this.app);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }
    this.handleResize();
  }

  private handleResize(): void {
    const cw = Math.max(1, this.container.clientWidth || DESIGN_W);
    const ch = Math.max(1, this.container.clientHeight || DESIGN_H);
    this.app.renderer.resize(cw, ch);
    const scale = Math.min(cw / DESIGN_W, ch / DESIGN_H);
    this.root.scale.set(scale);
    this.root.x = (cw - DESIGN_W * scale) / 2;
    this.root.y = (ch - DESIGN_H * scale) / 2;
  }

  // -------------------------------------------------------------------
  // Public API (src/sim/API.md)
  // -------------------------------------------------------------------

  async play(result: BattleResult, sides: { sideA: BattleSide; sideB: BattleSide }, opts: BattleStagePlayOpts): Promise<void> {
    await this.ready;

    this.opts = opts;
    this.result = result;
    this.skipping = false;
    this.completed = false;
    this.clock.reset();
    this.clock.setSpeedDiv(opts.speed === 'fast' ? 3 : 1);

    this.clearScene();

    const startEvt = result.events.find((e): e is Extract<BattleEvent, { t: 'start' }> => e.t === 'start');
    const mapKind: MapKind = startEvt?.mapKind ?? 'surface';
    const terrain: Terrain = startEvt?.terrain ?? 'open';
    this.layers.backdrop.addChild(buildBackdrop(mapKind, terrain, DESIGN_W, DESIGN_H));

    await Promise.all([this.buildSquad('A', sides.sideA), this.buildSquad('B', sides.sideB)]);

    if (opts.speed === 'results_only') {
      await this.clock.wait(300);
      this.finish();
      return;
    }

    for (let i = 0; i < result.events.length; i++) {
      if (this.skipping) break;
      const e = result.events[i];
      opts.onEvent?.(e, i);
      await this.playEvent(e);
    }

    if (!this.skipping) this.finish();
  }

  skip(): void {
    if (this.completed) return;
    this.skipping = true;
    this.clock.cancelAll();
    this.finish();
  }

  setSpeed(speed: 'full' | 'fast'): void {
    this.clock?.setSpeedDiv(speed === 'fast' ? 3 : 1);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clock?.cancelAll();
    this.mechViews.clear();
    // texture: false — mech/portrait textures are cached and shared by src/render/sprites; only this app's own display tree is torn down.
    this.app.destroy(true, { children: true, texture: false, textureSource: false });
  }

  // -------------------------------------------------------------------
  // Scene setup
  // -------------------------------------------------------------------

  private clearScene(): void {
    this.layers.backdrop.removeChildren();
    this.layers.mech.removeChildren();
    this.layers.effects.removeChildren();
    this.layers.ui.removeChildren();
    this.mechViews.clear();
    this.world.x = 0;
    this.world.y = 0;
    this.world.filters = null;
  }

  private formationX(side: 'A' | 'B', row: 'front' | 'back'): number {
    if (side === 'A') return row === 'front' ? 540 : 320;
    return row === 'front' ? 740 : 960;
  }

  private async buildSquad(side: 'A' | 'B', battleSide: BattleSide): Promise<void> {
    const squad = battleSide.squad;
    const faction = squad.faction;
    for (let slot = 0; slot < squad.slots.length; slot++) {
      const assignment = squad.slots[slot];
      if (!assignment) continue;
      const pilot = battleSide.pilots[assignment.pilotId];
      const mech = battleSide.mechs[assignment.mechId];
      if (!pilot || !mech) continue;
      const frame = this.data.frames[mech.frameId];
      if (!frame) continue;

      const tex = await getMechTexture(this.app, this.data, mech, faction, 'battle');
      const sprite = new Sprite(tex); // inherits the texture's baked bottom-center defaultAnchor

      const row = rowOf(slot as SlotIndex);
      const posInRow = row === 'front' ? slot : slot - 3;
      const x = this.formationX(side, row);
      const y = ROW_Y[posInRow] ?? GROUND_Y;

      const container = new Container();
      container.x = x;
      container.y = y;
      container.addChild(sprite);

      const barWidth = 58;
      const hpBg = new Graphics().roundRect(-barWidth / 2, 44, barWidth, 6, 2).fill({ color: 0x000000, alpha: 0.55 });
      const hpFill = new Graphics();
      const pilotDef = this.data.pilots[pilotDefIdOf(assignment.pilotId)];
      const label = new Text({ text: pilotDef?.callsign ?? assignment.pilotId, style: LABEL_STYLE });
      label.anchor.set(0.5, 0);
      label.y = 52;
      container.addChild(hpBg, hpFill, label);

      this.layers.mech.addChild(container);

      const maxHp = Math.max(1, frame.hp - (mech.maxHpPenalty ?? 0));
      const view: MechView = {
        side,
        slot: slot as SlotIndex,
        pilotId: assignment.pilotId,
        mechId: assignment.mechId,
        faction,
        homeX: x,
        homeY: y,
        container,
        sprite,
        hpBg,
        hpFill,
        label,
        maxHp,
        hp: mech.hp,
        alive: !mech.destroyed,
        barWidth,
      };
      if (mech.destroyed) container.visible = false;
      this.mechViews.set(assignment.mechId, view);
      this.redrawHpBar(view);
    }
  }

  private findViewByPilot(pilotId: Id): MechView | undefined {
    for (const v of this.mechViews.values()) if (v.pilotId === pilotId) return v;
    return undefined;
  }

  private redrawHpBar(view: MechView): void {
    const frac = clamp01(view.hp / view.maxHp);
    const color = frac > 0.5 ? 0x4caf6b : frac > 0.2 ? 0xffb020 : 0xe0483e;
    view.hpFill.clear();
    view.hpFill.roundRect(-view.barWidth / 2, 44, view.barWidth * frac, 6, 2).fill(color);
  }

  private finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.snapFinalState();
    this.opts?.onComplete();
  }

  private snapFinalState(): void {
    if (this.result) {
      for (const view of this.mechViews.values()) {
        const finalSide = view.side === 'A' ? this.result.sideA : this.result.sideB;
        const finalMech = finalSide.mechs[view.mechId];
        if (!finalMech) continue;
        if (finalMech.destroyed) {
          view.alive = false;
          view.container.visible = false;
        } else {
          view.hp = Math.max(0, finalMech.hp);
          this.redrawHpBar(view);
        }
      }
    }
    this.world.x = 0;
    this.world.y = 0;
    this.world.filters = null;
    this.layers.ui.removeChildren();
    this.layers.effects.removeChildren();
  }

  // -------------------------------------------------------------------
  // Event dispatch
  // -------------------------------------------------------------------

  private async playEvent(e: BattleEvent): Promise<void> {
    if (this.skipping) return;
    switch (e.t) {
      case 'start':
        return this.playStart();
      case 'callout':
        return this.playCallout(e);
      case 'round':
        return this.playRound(e);
      case 'attack':
        return this.playAttack(e);
      case 'repair':
        return this.playRepair(e);
      case 'shield':
        return this.playShield(e);
      case 'intercept':
        return this.playIntercept(e);
      case 'destroyed':
        return this.playDestroyed(e);
      case 'last_transmission':
        return this.playLastTransmission(e);
      case 'cutin':
        return this.playCutin(e);
      case 'finisher':
        return this.playFinisher(e);
      case 'morale':
        return this.playMorale(e);
      case 'rout':
        return this.playRout(e);
      case 'end':
        return this.playEnd(e);
      default:
        return;
    }
  }

  private async playStart(): Promise<void> {
    await this.clock.wait(600);
  }

  private async playRound(e: Extract<BattleEvent, { t: 'round' }>): Promise<void> {
    const text = new Text({ text: `ROUND ${e.n}`, style: BANNER_STYLE });
    text.anchor.set(0.5);
    text.x = -400;
    text.y = 90;
    this.layers.ui.addChild(text);
    await this.clock.tween(150, (t) => {
      text.x = lerp(-400, DESIGN_W / 2, easeOutCubic(t));
    });
    await this.clock.wait(200);
    await this.clock.tween(150, (t) => {
      text.alpha = 1 - t;
    });
    this.layers.ui.removeChild(text);
    text.destroy();
  }

  private async playMorale(e: Extract<BattleEvent, { t: 'morale' }>): Promise<void> {
    const views = Array.from(this.mechViews.values()).filter((v) => v.side === e.side && v.alive);
    const cx = views.length ? views.reduce((s, v) => s + v.homeX, 0) / views.length : e.side === 'A' ? 430 : 850;
    const cy = views.length ? Math.min(...views.map((v) => v.homeY)) - 60 : GROUND_Y - 60;
    const sign = e.delta >= 0 ? '+' : '';
    const text = new Text({
      text: `MORALE ${sign}${e.delta}`,
      style: { ...SUB_BANNER_STYLE, fill: e.delta >= 0 ? 0x8fd98f : 0xd98f8f, fontSize: 18 },
    });
    text.anchor.set(0.5);
    text.x = cx;
    text.y = cy;
    this.layers.ui.addChild(text);
    await this.clock.tween(300, (t) => {
      text.y = cy - t * 24;
      text.alpha = 1 - t;
    });
    this.layers.ui.removeChild(text);
    text.destroy();
  }

  private async playCallout(e: Extract<BattleEvent, { t: 'callout' }>): Promise<void> {
    await this.showPortraitPanel({ pilotId: e.pilotId, side: e.side, expression: 'neutral', line: e.line, duration: 1400 });
  }

  private async playCutin(e: Extract<BattleEvent, { t: 'cutin' }>): Promise<void> {
    if (e.kind === 'last') return; // last_transmission carries its own full presentation
    const durations: Record<'crit' | 'kill' | 'callout' | 'finisher', number> = {
      crit: 900,
      kill: 900,
      callout: 1100,
      finisher: 1800,
    };
    const expressions: Record<'crit' | 'kill' | 'callout' | 'finisher', Expression> = {
      crit: 'strained',
      kill: 'grin',
      callout: 'neutral',
      finisher: 'shout',
    };
    await this.showPortraitPanel({
      pilotId: e.pilotId,
      side: e.side,
      expression: expressions[e.kind],
      line: e.line,
      duration: durations[e.kind],
      big: e.kind === 'finisher',
      flash: e.kind === 'finisher',
    });
  }

  private async playFinisher(e: Extract<BattleEvent, { t: 'finisher' }>): Promise<void> {
    const overlay = new Container();
    const flash = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0xffffff, alpha: 1 });
    overlay.addChild(flash);
    this.layers.ui.addChild(overlay);
    await this.clock.tween(100, (t) => {
      flash.alpha = 1 - t;
    });

    const name = new Text({ text: e.name.toUpperCase(), style: NAME_STYLE });
    name.anchor.set(0.5);
    name.x = DESIGN_W / 2;
    name.y = DESIGN_H / 2 - 20;
    name.alpha = 0;
    const line = new Text({ text: e.line, style: SUB_BANNER_STYLE });
    line.anchor.set(0.5);
    line.x = DESIGN_W / 2;
    line.y = DESIGN_H / 2 + 40;
    line.alpha = 0;
    overlay.addChild(name, line);

    await this.clock.tween(120, (t) => {
      name.alpha = t;
      line.alpha = t;
      name.scale.set(0.9 + 0.1 * t);
    });
    await this.clock.wait(80);
    await this.clock.tween(100, (t) => {
      name.alpha = 1 - t;
      line.alpha = 1 - t;
    });
    this.layers.ui.removeChild(overlay);
    overlay.destroy({ children: true });
  }

  private async playLastTransmission(e: Extract<BattleEvent, { t: 'last_transmission' }>): Promise<void> {
    const pilotDefId = pilotDefIdOf(e.pilotId);
    const overlay = new Container();
    const vignette = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x000000, alpha: 0 });
    overlay.addChild(vignette);

    let portrait: Sprite | null = null;
    try {
      const tex = await getPortraitTexture(this.app, this.data, pilotDefId, 'strained');
      portrait = new Sprite(tex);
      portrait.anchor.set(0.5);
      portrait.x = DESIGN_W * 0.3;
      portrait.y = DESIGN_H * 0.5;
      portrait.scale.set(2.4);
      portrait.alpha = 0;
      overlay.addChild(portrait);
    } catch {
      portrait = null;
    }

    const text = new Text({ text: '', style: { ...SPEECH_STYLE, fill: 0xf2efe6, fontSize: 22, wordWrapWidth: 560 } });
    text.x = DESIGN_W * 0.48;
    text.y = DESIGN_H * 0.42;
    text.alpha = 0;
    overlay.addChild(text);

    this.layers.ui.addChild(overlay);
    if (this.skipping) {
      overlay.destroy({ children: true });
      return;
    }

    await this.clock.tween(300, (t) => {
      vignette.alpha = 0.65 * t;
      if (portrait) portrait.alpha = t;
      text.alpha = t;
    });

    const full = e.line;
    const typeMs = Math.min(1400, Math.max(400, full.length * 28));
    await this.clock.tween(typeMs, (t) => {
      const n = Math.round(full.length * t);
      text.text = full.slice(0, n);
    });

    await this.clock.wait(500);

    await this.clock.tween(400, (t) => {
      overlay.alpha = 1 - t;
    });
    this.layers.ui.removeChild(overlay);
    overlay.destroy({ children: true });
  }

  private async playIntercept(e: Extract<BattleEvent, { t: 'intercept' }>): Promise<void> {
    const protector = this.findViewByPilot(e.protectorPilotId);
    const protectedView = this.findViewByPilot(e.protectedPilotId);
    if (!protector || !protectedView) {
      await this.clock.wait(800);
      return;
    }
    const targetX = lerp(protectedView.homeX, protector.side === 'A' ? protectedView.homeX + 60 : protectedView.homeX - 60, 1);
    const originX = protector.container.x;
    const originY = protector.container.y;
    const flash = new Graphics();
    drawHexFlash(flash, 0, 0, 26);
    flash.x = protectedView.homeX;
    flash.y = protectedView.homeY - 30;
    flash.alpha = 0;
    this.layers.effects.addChild(flash);

    await this.clock.tween(300, (t) => {
      const k = easeOutBack(t);
      protector.container.x = lerp(originX, targetX, k);
      protector.container.y = lerp(originY, protectedView.homeY, k);
    });
    await this.clock.tween(150, (t) => {
      flash.alpha = Math.sin(t * Math.PI);
    });
    await this.clock.wait(150);
    await this.clock.tween(200, (t) => {
      protector.container.x = lerp(targetX, originX, t);
      protector.container.y = lerp(protectedView.homeY, originY, t);
    });
    this.layers.effects.removeChild(flash);
    flash.destroy();
  }

  private async playShield(e: Extract<BattleEvent, { t: 'shield' }>): Promise<void> {
    const view = this.mechViews.get(e.mechId);
    if (view) {
      const hex = new Graphics();
      drawHexFlash(hex, 0, 0, 40, 0x6fb7ff);
      hex.x = view.homeX;
      hex.y = view.homeY - 40;
      hex.alpha = 0;
      this.layers.effects.addChild(hex);
      const absorbed = new Text({ text: `SHIELD -${e.absorbed}`, style: { ...LABEL_STYLE, fill: 0x9fd0ff, fontSize: 14 } });
      absorbed.anchor.set(0.5);
      absorbed.x = view.homeX;
      absorbed.y = view.homeY - 80;
      absorbed.alpha = 0;
      this.layers.effects.addChild(absorbed);

      await this.clock.tween(220, (t) => {
        hex.alpha = Math.sin(t * Math.PI);
        absorbed.alpha = t;
      });
      await this.clock.wait(150);
      await this.clock.tween(130, (t) => {
        hex.alpha = 1 - t;
        absorbed.alpha = 1 - t;
        absorbed.y -= 0.4;
      });
      this.layers.effects.removeChild(hex);
      this.layers.effects.removeChild(absorbed);
      hex.destroy();
      absorbed.destroy();
    } else {
      await this.clock.wait(500);
    }
  }

  private async playRepair(e: Extract<BattleEvent, { t: 'repair' }>): Promise<void> {
    const healer = this.mechViews.get(e.mechId);
    const target = this.mechViews.get(e.targetMechId);
    if (healer && target) {
      const sparkle = new Graphics();
      this.layers.effects.addChild(sparkle);
      const popup = new Text({ text: `+${e.amount}`, style: { ...LABEL_STYLE, fill: 0x8fe08f, fontSize: 18 } });
      popup.anchor.set(0.5);
      popup.x = target.homeX;
      popup.y = target.homeY - 60;
      popup.alpha = 0;
      this.layers.effects.addChild(popup);

      await this.clock.tween(400, (t) => {
        sparkle.clear();
        const x = lerp(healer.homeX, target.homeX, t);
        const y = lerp(healer.homeY - 60, target.homeY - 60, t) - Math.sin(t * Math.PI) * 40;
        sparkle.circle(x, y, 5).fill({ color: 0x8fe08f, alpha: 0.9 });
        sparkle.circle(x - 8, y + 4, 2.5).fill({ color: 0xd9f7d9, alpha: 0.7 });
      });
      target.hp = Math.min(target.maxHp, target.hp + e.amount);
      await this.clock.tween(200, (t) => {
        popup.alpha = t < 0.5 ? t * 2 : 1;
        popup.y -= 0.3;
        this.redrawHpBar(target);
      });
      await this.clock.wait(100);
      this.layers.effects.removeChild(sparkle);
      this.layers.effects.removeChild(popup);
      sparkle.destroy();
      popup.destroy();
    } else {
      await this.clock.wait(700);
    }
  }

  private async playDestroyed(e: Extract<BattleEvent, { t: 'destroyed' }>): Promise<void> {
    const view = this.mechViews.get(e.mechId);
    if (view && view.alive) await this.killMech(view);

    await this.clock.wait(900);

    if (e.pilotDied) {
      const filter = new (await import('pixi.js')).ColorMatrixFilter();
      this.world.filters = [filter];
      const text = new Text({ text: 'PILOT LOST', style: { ...BANNER_STYLE, fill: 0xe0483e, fontSize: 46 } });
      text.anchor.set(0.5);
      text.x = DESIGN_W / 2;
      text.y = DESIGN_H / 2;
      text.alpha = 0;
      this.layers.ui.addChild(text);

      await this.clock.tween(300, (t) => {
        filter.desaturate();
        filter.alpha = 0.7 * t;
        text.alpha = t;
      });
      await this.clock.wait(600);
      await this.clock.tween(300, (t) => {
        filter.alpha = 0.7 * (1 - t);
        text.alpha = 1 - t;
      });
      this.layers.ui.removeChild(text);
      text.destroy();
      this.world.filters = null;
    }
  }

  private async playEnd(e: Extract<BattleEvent, { t: 'end' }>): Promise<void> {
    const label = e.winner === 'A' ? 'VICTORY' : e.winner === 'B' ? 'DEFEAT' : 'STALEMATE';
    const color = e.winner === 'A' ? 0xffe9b0 : e.winner === 'B' ? 0xe0483e : 0xd9d2c0;
    const text = new Text({ text: label, style: { ...BANNER_STYLE, fill: color, fontSize: 68 } });
    text.anchor.set(0.5);
    text.x = DESIGN_W / 2;
    text.y = DESIGN_H / 2;
    text.alpha = 0;
    text.scale.set(0.7);
    this.layers.ui.addChild(text);

    await this.clock.tween(300, (t) => {
      text.alpha = t;
      text.scale.set(lerp(0.7, 1, easeOutBack(t)));
    });
    await this.clock.wait(900);
    await this.clock.tween(300, (t) => {
      text.alpha = 1 - t;
    });
    this.layers.ui.removeChild(text);
    text.destroy();
  }

  private async playRout(e: Extract<BattleEvent, { t: 'rout' }>): Promise<void> {
    const text = new Text({ text: 'ROUTED', style: { ...BANNER_STYLE, fill: 0xd98f4a, fontSize: 50 } });
    text.anchor.set(0.5);
    text.x = DESIGN_W / 2;
    text.y = 140;
    text.alpha = 0;
    this.layers.ui.addChild(text);

    const routed = Array.from(this.mechViews.values()).filter((v) => v.side === e.side && v.alive);
    const dir = e.side === 'A' ? -1 : 1;

    const fade = this.clock.tween(250, (t) => {
      text.alpha = Math.sin(clamp01(t) * Math.PI);
    });
    const slide = this.clock.tween(900, (t) => {
      for (const v of routed) {
        v.container.x = v.homeX + dir * 260 * easeInOutQuad(t);
        v.container.alpha = 1 - t;
      }
    });
    await Promise.all([fade, slide, this.clock.wait(1200)]);

    this.layers.ui.removeChild(text);
    text.destroy();
    for (const v of routed) v.alive = false;
  }

  // -------------------------------------------------------------------
  // Attacks
  // -------------------------------------------------------------------

  private async playAttack(e: Extract<BattleEvent, { t: 'attack' }>): Promise<void> {
    const attacker = this.mechViews.get(e.attackerMechId);
    const defender = this.mechViews.get(e.defenderMechId);
    const weapon = this.data.weapons[e.weaponId];
    const family = animFamilyFor(weapon?.animKey ?? '');

    await this.clock.tween(350, (t) => {
      if (attacker) attacker.sprite.scale.y = 1 - 0.05 * Math.sin(t * Math.PI);
    });

    const isDash = family === 'lunge' || family === 'slash' || family === 'maul';
    if (attacker && defender && isDash) {
      await this.dash(attacker, defender, family === 'maul' ? 0.5 : 0.68, family === 'maul' ? 240 : 150);
    }

    for (let hi = 0; hi < e.hits.length; hi++) {
      const hit = e.hits[hi];
      if (attacker && defender) this.fireWeaponEffect(attacker, defender, family);
      if (defender) void this.cameraPunch(defender);
      if (hit.hit && defender) {
        this.flashWhite(defender);
        this.popFloatingText(defender, hit.crit ? `${hit.damage}` : `${hit.damage}`, hit.crit ? 0xffc23c : 0xf2efe6, hit.crit);
        const isLastHit = hi === e.hits.length - 1;
        defender.hp = Math.max(0, isLastHit ? e.defenderHpAfter : defender.hp - hit.damage);
        this.redrawHpBar(defender);
      } else if (defender) {
        this.popFloatingText(defender, 'MISS', 0x9a9a9a, false);
      }
      await this.clock.wait(180);
    }

    if (isDash && attacker) {
      await this.dashBack(attacker, family === 'maul' ? 240 : 150);
    }
    if (family === 'maul') void this.screenShake(280, 11);

    await this.clock.wait(300);

    if (e.killed && defender) await this.killMech(defender);
    if (e.line && attacker) void this.showSpeechBubble(attacker, e.line, 900);
  }

  private async dash(attacker: MechView, defender: MechView, frac: number, ms: number): Promise<void> {
    const startX = attacker.container.x;
    const startY = attacker.container.y;
    const tx = lerp(attacker.homeX, defender.homeX, frac);
    const ty = lerp(attacker.homeY, defender.homeY, frac * 0.3);
    await this.clock.tween(ms, (t) => {
      const k = easeOutCubic(t);
      attacker.container.x = lerp(startX, tx, k);
      attacker.container.y = lerp(startY, ty, k);
    });
  }

  private async dashBack(attacker: MechView, ms: number): Promise<void> {
    const startX = attacker.container.x;
    const startY = attacker.container.y;
    await this.clock.tween(ms, (t) => {
      attacker.container.x = lerp(startX, attacker.homeX, t);
      attacker.container.y = lerp(startY, attacker.homeY, t);
    });
    attacker.container.x = attacker.homeX;
    attacker.container.y = attacker.homeY;
  }

  private async cameraPunch(defender: MechView): Promise<void> {
    const cx = DESIGN_W / 2;
    const cy = DESIGN_H / 2;
    const dx = defender.homeX - cx;
    const dy = defender.homeY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (dx / len) * 10;
    const oy = (dy / len) * 10;
    await this.clock.tween(140, (t) => {
      const k = Math.sin(clamp01(t) * Math.PI);
      this.world.x = ox * k * 0.35;
      this.world.y = oy * k * 0.35;
    });
    this.world.x = 0;
    this.world.y = 0;
  }

  private async screenShake(duration: number, amplitude: number): Promise<void> {
    await this.clock.tween(duration, (t) => {
      const decay = 1 - t;
      this.world.x = (Math.random() * 2 - 1) * amplitude * decay;
      this.world.y = (Math.random() * 2 - 1) * amplitude * decay;
    });
    this.world.x = 0;
    this.world.y = 0;
  }

  private fireWeaponEffect(attacker: MechView, defender: MechView, family: AnimFamily): void {
    const accent = FACTION_ACCENT[attacker.faction];
    const fx = new Graphics();
    this.layers.effects.addChild(fx);
    const ax = attacker.homeX;
    const ay = attacker.homeY - 55;
    const dx = defender.homeX;
    const dy = defender.homeY - 55;

    switch (family) {
      case 'burst': {
        fx.moveTo(ax, ay).lineTo(dx, dy).stroke({ width: 2, color: accent, alpha: 0.8 });
        fx.circle(ax, ay, 5).fill({ color: 0xffffff, alpha: 0.9 });
        break;
      }
      case 'beam': {
        fx.moveTo(ax, ay).lineTo(dx, dy).stroke({ width: 7, color: accent, alpha: 0.9 });
        fx.moveTo(ax, ay).lineTo(dx, dy).stroke({ width: 14, color: accent, alpha: 0.25 });
        break;
      }
      case 'rail': {
        fx.moveTo(ax, ay).lineTo(dx, dy).stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
        const flash = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0xffffff, alpha: 0.25 });
        this.layers.effects.addChild(flash);
        void this.clock.wait(60).then(() => {
          this.layers.effects.removeChild(flash);
          flash.destroy();
        });
        break;
      }
      case 'missiles': {
        for (let i = 0; i < 3; i++) {
          fx.circle(lerp(ax, dx, (i + 1) / 4), lerp(ay, dy - 30, (i + 1) / 4), 3).fill({ color: 0xd9d2c0, alpha: 0.8 });
        }
        fx.circle(ax, ay, 6).fill({ color: 0xbfbfbf, alpha: 0.5 });
        break;
      }
      case 'flak': {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          fx.circle(dx + Math.cos(a) * 14, dy + Math.sin(a) * 14, 2.5).fill({ color: accent, alpha: 0.8 });
        }
        break;
      }
      case 'slash': {
        fx.moveTo(dx - 22, dy - 14).lineTo(dx + 22, dy + 14).stroke({ width: 5, color: 0xffffff, alpha: 0.9 });
        break;
      }
      case 'lunge':
      case 'maul': {
        fx.circle(dx, dy, family === 'maul' ? 20 : 14).fill({ color: accent, alpha: 0.5 });
        break;
      }
      case 'repair': {
        fx.circle(dx, dy, 8).fill({ color: 0x8fe08f, alpha: 0.7 });
        break;
      }
      default: {
        fx.moveTo(ax, ay).lineTo(dx, dy).stroke({ width: 3, color: accent, alpha: 0.7 });
        break;
      }
    }

    void this.clock.wait(220).then(() => {
      this.layers.effects.removeChild(fx);
      fx.destroy();
    });
  }

  private flashWhite(view: MechView): void {
    const overlay = new Graphics();
    const b = view.sprite.getBounds();
    // getBounds() is in world space; convert the flash to the mech's own container space instead.
    overlay.rect(-b.width / 2, -b.height, b.width, b.height).fill({ color: 0xffffff, alpha: 0.75 });
    overlay.x = 0;
    overlay.y = 0;
    view.container.addChild(overlay);
    void this.clock.tween(160, (t) => {
      overlay.alpha = 0.75 * (1 - t);
    }).then(() => {
      view.container.removeChild(overlay);
      overlay.destroy();
    });
  }

  private popFloatingText(view: MechView, text: string, color: number, crit: boolean): void {
    const t = new Text({
      text: crit ? `${text} CRIT` : text,
      style: { ...LABEL_STYLE, fill: color, fontSize: crit ? 20 : 16 },
    });
    t.anchor.set(0.5);
    t.x = view.homeX + (Math.random() * 16 - 8);
    t.y = view.homeY - 70;
    this.layers.effects.addChild(t);
    void this.clock.tween(500, (tt) => {
      t.y -= 0.5;
      t.alpha = tt < 0.7 ? 1 : 1 - (tt - 0.7) / 0.3;
    }).then(() => {
      this.layers.effects.removeChild(t);
      t.destroy();
    });
  }

  private async showSpeechBubble(attacker: MechView, line: string, ms: number): Promise<void> {
    const bubble = new Container();
    const text = new Text({ text: line, style: SPEECH_STYLE });
    text.x = 10;
    text.y = 8;
    const w = Math.min(240, text.width) + 20;
    const h = text.height + 16;
    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 8).fill({ color: 0xf2efe6, alpha: 0.95 }).stroke({ width: 2, color: FACTION_ACCENT[attacker.faction] });
    bg.poly([w / 2 - 8, h, w / 2 + 8, h, w / 2, h + 10]).fill({ color: 0xf2efe6, alpha: 0.95 });
    bubble.addChild(bg, text);
    bubble.x = attacker.homeX - w / 2;
    bubble.y = attacker.homeY - 150;
    bubble.alpha = 0;
    this.layers.ui.addChild(bubble);

    await this.clock.tween(120, (t) => {
      bubble.alpha = t;
    });
    await this.clock.wait(Math.max(0, ms - 240));
    await this.clock.tween(120, (t) => {
      bubble.alpha = 1 - t;
    });
    this.layers.ui.removeChild(bubble);
    bubble.destroy({ children: true });
  }

  private async killMech(view: MechView): Promise<void> {
    if (!view.alive) return;
    view.alive = false;
    view.sprite.tint = 0xff6b57;
    void this.screenShake(220, 8);
    this.spawnShards(view);
    await this.clock.tween(280, (t) => {
      view.container.alpha = 1 - t;
      view.container.scale.set(1 + t * 0.2);
    });
    view.container.visible = false;
  }

  private spawnShards(view: MechView): void {
    const accent = FACTION_ACCENT[view.faction];
    const count = 12 + Math.floor(Math.random() * 9);
    const shards: { g: Graphics; vx: number; vy: number }[] = [];
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      const s = 3 + Math.random() * 6;
      g.rect(-s / 2, -s / 2, s, s).fill({ color: Math.random() > 0.5 ? accent : 0xd9d2c0, alpha: 0.9 });
      g.x = view.homeX;
      g.y = view.homeY - 40;
      this.layers.effects.addChild(g);
      const a = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 90;
      shards.push({ g, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 40 });
    }
    void this.clock.tween(420, (t) => {
      for (const s of shards) {
        s.g.x = view.homeX + s.vx * t;
        s.g.y = view.homeY - 40 + s.vy * t + 120 * t * t;
        s.g.alpha = 1 - t;
        s.g.rotation = t * 6 * (s.vx > 0 ? 1 : -1);
      }
    }).then(() => {
      for (const s of shards) {
        this.layers.effects.removeChild(s.g);
        s.g.destroy();
      }
    });
  }

  // -------------------------------------------------------------------
  // Cut-in / portrait panel (shared by callout, cutin, and used as a base
  // for last_transmission's larger hold)
  // -------------------------------------------------------------------

  private async showPortraitPanel(opts: {
    pilotId: Id;
    side: 'A' | 'B';
    expression: Expression;
    line: string;
    duration: number;
    big?: boolean;
    flash?: boolean;
  }): Promise<void> {
    const pilotDefId = pilotDefIdOf(opts.pilotId);
    const pilotDef = this.data.pilots[pilotDefId];
    const faction = pilotDef?.faction ?? (opts.side === 'A' ? 'relay' : 'compact');
    const accent = FACTION_ACCENT[faction];

    const panel = new Container();
    const w = opts.big ? 460 : 320;
    const h = opts.big ? 260 : 150;
    const skew = 22;

    const mask = new Graphics();
    mask.poly([skew, 0, w, 0, w - skew, h, 0, h]).fill(0xffffff);
    panel.addChild(mask);
    panel.mask = mask;

    const bg = new Graphics();
    bg.poly([skew, 0, w, 0, w - skew, h, 0, h]).fill({ color: 0x14161c, alpha: 0.92 });
    bg.poly([skew, 0, skew + 5, 0, w - skew + 5, h, w - skew, h]).fill({ color: accent, alpha: 0.9 });
    panel.addChildAt(bg, 0);

    let portrait: Sprite | null = null;
    try {
      const tex = await getPortraitTexture(this.app, this.data, pilotDefId, opts.expression);
      portrait = new Sprite(tex);
      portrait.x = 16;
      portrait.y = h / 2 - (opts.big ? 90 : 55);
      portrait.scale.set(opts.big ? 1.9 : 1.15);
      panel.addChild(portrait);
    } catch {
      portrait = null;
    }

    const nameText = new Text({
      text: (pilotDef?.callsign ?? opts.pilotId).toUpperCase(),
      style: { ...LABEL_STYLE, fill: accent, fontSize: opts.big ? 20 : 15 },
    });
    nameText.x = (portrait ? portrait.x + portrait.width * (opts.big ? 1.9 : 1.15) + 12 : 20) - (opts.big ? 90 : 40);
    nameText.y = 12;
    const lineText = new Text({
      text: opts.line,
      style: { ...SPEECH_STYLE, fill: 0xf2efe6, fontSize: opts.big ? 18 : 14, wordWrapWidth: w - 130 },
    });
    lineText.x = nameText.x;
    lineText.y = nameText.y + nameText.height + 8;
    panel.addChild(nameText, lineText);

    const fromLeft = opts.side === 'A';
    const restX = opts.side === 'A' ? 40 : DESIGN_W - w - 40;
    const startX = fromLeft ? -w - 20 : DESIGN_W + 20;
    panel.x = startX;
    panel.y = opts.big ? DESIGN_H / 2 - h / 2 : 60;
    this.layers.ui.addChild(panel);

    if (opts.flash) {
      const flash = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0xffffff, alpha: 1 });
      this.layers.ui.addChild(flash);
      await this.clock.tween(100, (t) => {
        flash.alpha = 1 - t;
      });
      this.layers.ui.removeChild(flash);
      flash.destroy();
    }

    const slideMs = 160;
    const holdMs = Math.max(0, opts.duration - slideMs * 2);
    await this.clock.tween(slideMs, (t) => {
      panel.x = lerp(startX, restX, easeOutCubic(t));
    });
    await this.clock.wait(holdMs);
    await this.clock.tween(slideMs, (t) => {
      panel.x = lerp(restX, startX, t);
      panel.alpha = 1 - t;
    });

    this.layers.ui.removeChild(panel);
    panel.destroy({ children: true });
  }
}

function drawHexFlash(g: Graphics, cx: number, cy: number, r: number, color = 0x6fb7ff): void {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.poly(pts).stroke({ width: 4, color, alpha: 0.9 });
  g.poly(pts).fill({ color, alpha: 0.18 });
}
