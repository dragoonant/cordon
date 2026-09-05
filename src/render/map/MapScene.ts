/**
 * Real-time overworld renderer. See src/sim/API.md § `src/render/map/MapScene.ts`
 * for the contract this class implements.
 *
 * Ownership split: `setState(world)` is called every animation frame by the
 * caller (store/UI) with the latest sim snapshot; this class never mutates
 * `WorldState` — it only reads positions/status and turns taps into
 * `MapIntent`s for the caller to dispatch through the sim. Pixi's own ticker
 * (not `setState`'s cadence) drives interpolation and per-frame animation
 * (pulses, fades, path lines), so the map stays smooth even if `setState` is
 * only called once per sim tick at 30Hz while the display runs at 60+fps.
 */
import { Application, Container, Graphics, Rectangle, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { GameData, Id, MapDef, ObjectiveDef, Squad, Vec2, WorldState } from '@sim/types';
import { TILE_SIZE } from './constants';
import { Camera } from './camera';
import { bakeTiles } from './tiles';
import { DeployZoneView } from './deployZone';
import { ObjectiveView } from './objectiveView';
import { PendingBattleView } from './pendingBattleView';
import { SquadView } from './squadView';
import { factionAccent, getSquadIconTexture } from './spriteSource';

export type MapIntent =
  | { t: 'select'; squadId: Id | null }
  | { t: 'move'; squadId: Id; target: Vec2 }
  | { t: 'inspect_enemy'; squadId: Id }
  | { t: 'inspect_objective'; objectiveId: Id };

const DRAG_THRESHOLD = 6;

function tileCenter(tile: Vec2): Vec2 {
  return { x: Math.floor(tile.x) + 0.5, y: Math.floor(tile.y) + 0.5 };
}

interface SquadHpInfo {
  hp: number;
  maxHp: number;
  livingCount: number;
  leaderFrameId: Id | null;
}

export class MapScene {
  private readonly app = new Application();
  private readonly hostEl: HTMLElement;
  private readonly data: GameData;

  private map: MapDef | null = null;
  private objectiveDefs = new Map<Id, ObjectiveDef>();
  private camera = new Camera(1, 1);
  private ready = false;

  private readonly worldLayer = new Container();
  private readonly tilesLayer = new Container();
  private readonly groundLayer = new Container();
  private readonly squadsLayer = new Container();
  private readonly topLayer = new Container();
  private readonly dimOverlay = new Graphics();

  private deployZoneView: DeployZoneView | null = null;
  private readonly objectiveViews = new Map<Id, ObjectiveView>();
  private readonly squadViews = new Map<Id, SquadView>();
  private readonly squadTextureKeys = new Map<Id, string>();
  private readonly pendingBattleView = new PendingBattleView();

  private resizeObserver: ResizeObserver | null = null;
  private intentCb: ((i: MapIntent) => void) | null = null;
  private selectedSquadId: Id | null = null;
  private latestWorld: WorldState | null = null;

  // --- left-button (Pixi federated events): drag-to-pan-with-threshold on empty ground, else tap.
  private leftDown = false;
  private leftDragging = false;
  private leftDownPoint: Vec2 = { x: 0, y: 0 };

  // --- middle/right button (native DOM events, so they work regardless of what's under the cursor).
  private otherButtonDown = false;
  private otherButtonIsRight = false;
  private otherButtonDragging = false;
  private otherDownPoint: Vec2 = { x: 0, y: 0 };

  private readonly onCanvasPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1 && e.button !== 2) return;
    this.otherButtonDown = true;
    this.otherButtonIsRight = e.button === 2;
    this.otherButtonDragging = e.button === 1; // middle button pans immediately, no click semantic
    this.otherDownPoint = { x: e.clientX, y: e.clientY };
  };
  private readonly onWindowPointerMove = (e: PointerEvent): void => {
    if (!this.otherButtonDown) return;
    const dx = e.clientX - this.otherDownPoint.x;
    const dy = e.clientY - this.otherDownPoint.y;
    if (!this.otherButtonDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.otherButtonDragging = true;
    if (this.otherButtonDragging) {
      this.camera.pan(e.movementX, e.movementY);
      this.applyCameraTransform();
    }
  };
  private readonly onWindowPointerUp = (e: PointerEvent): void => {
    if (!this.otherButtonDown) return;
    const wasRightClick = this.otherButtonIsRight && !this.otherButtonDragging;
    this.otherButtonDown = false;
    this.otherButtonDragging = false;
    if (wasRightClick && this.selectedSquadId) {
      const rect = this.app.canvas.getBoundingClientRect();
      const world = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.emitIntent({ t: 'move', squadId: this.selectedSquadId, target: tileCenter({ x: world.x / TILE_SIZE, y: world.y / TILE_SIZE }) });
    }
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.camera.zoomAt(sx, sy, this.camera.zoom * factor);
    this.applyCameraTransform();
  };
  private readonly onContextMenu = (e: Event): void => e.preventDefault();

  constructor(container: HTMLElement, data: GameData) {
    this.hostEl = container;
    this.data = data;
  }

  /** Set by destroy(); React StrictMode can unmount while init() is still pending. */
  private destroyed = false;
  private initPromise: Promise<void> | null = null;

  async load(map: MapDef): Promise<void> {
    if (this.destroyed) return;
    if (!this.ready) {
      this.initPromise ??= this.app.init({
        background: 0x08090c,
        antialias: true,
        width: Math.max(1, this.hostEl.clientWidth),
        height: Math.max(1, this.hostEl.clientHeight),
      });
      await this.initPromise;
      if (this.destroyed) {
        // destroy() ran mid-init; finish the teardown it deferred.
        this.app.destroy(true, { children: true, texture: false });
        return;
      }
      this.hostEl.appendChild(this.app.canvas);
      this.app.canvas.style.width = '100%';
      this.app.canvas.style.height = '100%';
      this.app.canvas.style.display = 'block';
      this.app.canvas.style.touchAction = 'none';

      this.worldLayer.addChild(this.tilesLayer, this.groundLayer, this.squadsLayer, this.topLayer);
      this.topLayer.addChild(this.pendingBattleView.container);
      this.app.stage.addChild(this.worldLayer, this.dimOverlay);
      this.dimOverlay.eventMode = 'none';

      this.setupInput();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.hostEl);
      this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000));
      this.ready = true;
    }
    this.resetSceneForMap(map);
    this.resize();
  }

  private resetSceneForMap(map: MapDef): void {
    this.map = map;
    this.objectiveDefs = new Map(map.objectives.map((d) => [d.id, d]));

    this.tilesLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.deployZoneView?.destroy();
    for (const v of this.objectiveViews.values()) v.destroy();
    this.objectiveViews.clear();
    for (const v of this.squadViews.values()) v.destroy();
    this.squadViews.clear();
    this.squadTextureKeys.clear();
    this.groundLayer.removeChildren();
    this.squadsLayer.removeChildren();
    this.selectedSquadId = null;
    this.latestWorld = null;

    this.tilesLayer.addChild(bakeTiles(this.app, map));
    this.deployZoneView = new DeployZoneView(map);
    this.groundLayer.addChild(this.deployZoneView.container);

    this.camera = new Camera(map.width * TILE_SIZE, map.height * TILE_SIZE);
    this.camera.setViewport(this.app.renderer.width, this.app.renderer.height);
    this.camera.fit();
    this.applyCameraTransform();
  }

  setState(world: WorldState): void {
    this.latestWorld = world;

    const seenObjIds = new Set<Id>();
    for (const [id, state] of Object.entries(world.objectives)) {
      seenObjIds.add(id);
      if (this.objectiveViews.has(id)) continue;
      const def = this.objectiveDefs.get(id);
      if (!def) continue;
      const view = new ObjectiveView(def, state);
      view.onTap = (e) => this.handleObjectiveTap(id, e);
      this.objectiveViews.set(id, view);
      this.groundLayer.addChild(view.container);
    }
    for (const [id, view] of [...this.objectiveViews]) {
      if (!seenObjIds.has(id)) {
        view.destroy();
        this.objectiveViews.delete(id);
      }
    }

    const seenSquadIds = new Set<Id>();
    for (const squad of Object.values(world.squads)) {
      if (squad.state === 'docked') continue; // not deployed onto the map
      seenSquadIds.add(squad.id);
      if (this.squadViews.has(squad.id)) continue;
      const view = new SquadView(squad, Texture.EMPTY);
      const isPlayer = squad.faction === 'relay';
      view.onTap = () => this.handleSquadTap(squad.id, isPlayer);
      this.squadViews.set(squad.id, view);
      this.squadsLayer.addChild(view.container);
      void this.refreshSquadTexture(squad);
    }
    for (const [id, view] of [...this.squadViews]) {
      if (!seenSquadIds.has(id)) {
        view.destroy();
        this.squadViews.delete(id);
        this.squadTextureKeys.delete(id);
      }
    }
    if (this.selectedSquadId && !seenSquadIds.has(this.selectedSquadId)) {
      this.selectedSquadId = null;
    }
  }

  setSelected(squadId: Id | null): void {
    this.selectedSquadId = squadId;
  }

  onIntent(cb: (i: MapIntent) => void): void {
    this.intentCb = cb;
  }

  resize(): void {
    if (!this.ready) return;
    const w = Math.max(1, this.hostEl.clientWidth);
    const h = Math.max(1, this.hostEl.clientHeight);
    this.app.renderer.resize(w, h);
    this.app.stage.hitArea = new Rectangle(0, 0, w, h);
    this.camera.setViewport(w, h);
    this.dimOverlay.clear().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.4 });
    this.applyCameraTransform();
  }

  /** Extra: recenter the camera on a world position (tiles) without changing zoom. */
  centerOn(pos: Vec2): void {
    this.camera.centerOn({ x: pos.x * TILE_SIZE, y: pos.y * TILE_SIZE });
    this.applyCameraTransform();
  }

  /** Extra: fit the whole map back into the viewport. */
  fitToMap(): void {
    this.camera.fit();
    this.applyCameraTransform();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    // Init still in flight: load() will destroy the app once init resolves.
    if (!this.ready) return;
    if (this.ready) {
      const canvas = this.app.canvas;
      canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
      canvas.removeEventListener('wheel', this.onWheel);
      canvas.removeEventListener('contextmenu', this.onContextMenu);
      window.removeEventListener('pointermove', this.onWindowPointerMove);
      window.removeEventListener('pointerup', this.onWindowPointerUp);
    }
    // Stop rendering first so no frame runs against half-destroyed children,
    // then let app.destroy({children:true}) tear the display tree down once.
    // Destroying views individually and then again via the app double-destroys
    // Pixi containers and throws inside React's cleanup.
    this.app.ticker.stop();
    this.objectiveViews.clear();
    this.squadViews.clear();
    this.deployZoneView = null;
    try {
      this.app.destroy(true, { children: true, texture: false });
    } catch (e) {
      // Never let a teardown error escape into React's unmount path.
      console.warn('MapScene teardown', e);
    }
    this.ready = false;
  }

  // -------------------------------------------------------------------
  // Per-frame tick (interpolation + animation), independent of setState's cadence.
  // -------------------------------------------------------------------

  private tick(dt: number): void {
    const world = this.latestWorld;
    if (!world) return;

    for (const [id, view] of this.objectiveViews) {
      const state = world.objectives[id];
      if (state) view.update(state, dt);
    }

    for (const squad of Object.values(world.squads)) {
      const view = this.squadViews.get(squad.id);
      if (!view) continue;
      const isPlayer = squad.faction === 'relay';
      const visible = isPlayer || world.visibleEnemyIds.includes(squad.id);
      const info = this.computeSquadHp(squad, world);
      if (info.leaderFrameId) {
        const key = `${info.leaderFrameId}|${squad.faction}|${info.livingCount}`;
        if (this.squadTextureKeys.get(squad.id) !== key) {
          void this.refreshSquadTexture(squad);
        }
      }
      view.update(dt, squad, {
        hp: info.hp,
        maxHp: info.maxHp,
        isPlayer,
        accent: factionAccent(squad.faction),
        visible,
        selected: squad.id === this.selectedSquadId,
      });
    }

    this.deployZoneView?.update(world.carrierHp, world.carrierMaxHp);

    if (world.phase === 'battle_pending' && world.pendingBattle) {
      const a = world.squads[world.pendingBattle.squadAId];
      const b = world.squads[world.pendingBattle.squadBId];
      if (a && b) this.pendingBattleView.show(a.pos, b.pos, dt);
      else this.pendingBattleView.hide();
    } else {
      this.pendingBattleView.hide();
    }

    this.dimOverlay.visible = world.phase === 'ended';
  }

  private computeSquadHp(squad: Squad, world: WorldState): SquadHpInfo {
    let hp = 0;
    let maxHp = 0;
    let livingCount = 0;
    let leaderFrameId: Id | null = null;
    let fallbackFrameId: Id | null = null;

    for (const slot of squad.slots) {
      if (!slot) continue;
      const mech = world.mechs[slot.mechId];
      if (!mech) continue;
      const frame = this.data.frames[mech.frameId];
      if (!frame) continue;
      if (!fallbackFrameId) fallbackFrameId = mech.frameId;
      if (squad.leaderPilotId && slot.pilotId === squad.leaderPilotId) leaderFrameId = mech.frameId;
      if (!mech.destroyed) {
        livingCount++;
        hp += Math.max(0, mech.hp);
        maxHp += Math.max(1, frame.hp - mech.maxHpPenalty);
      }
    }
    return { hp, maxHp, livingCount, leaderFrameId: leaderFrameId ?? fallbackFrameId };
  }

  private async refreshSquadTexture(squad: Squad): Promise<void> {
    const world = this.latestWorld;
    if (!world) return;
    const info = this.computeSquadHp(squad, world);
    if (!info.leaderFrameId) return;
    const key = `${info.leaderFrameId}|${squad.faction}|${info.livingCount}`;
    if (this.squadTextureKeys.get(squad.id) === key) return;
    this.squadTextureKeys.set(squad.id, key);
    try {
      const tex = await getSquadIconTexture(this.app, this.data, info.leaderFrameId, squad.faction, info.livingCount);
      this.squadViews.get(squad.id)?.setTexture(tex);
    } catch {
      // keep whatever texture the view already has
    }
  }

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------

  private setupInput(): void {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = new Rectangle(0, 0, this.app.renderer.width, this.app.renderer.height);

    stage.on('pointerdown', (e: FederatedPointerEvent) => {
      if (e.button !== 0) return;
      this.leftDown = true;
      this.leftDragging = false;
      this.leftDownPoint = { x: e.global.x, y: e.global.y };
    });
    stage.on('pointermove', (e: FederatedPointerEvent) => {
      if (!this.leftDown) return;
      const dx = e.global.x - this.leftDownPoint.x;
      const dy = e.global.y - this.leftDownPoint.y;
      if (!this.leftDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.leftDragging = true;
      if (this.leftDragging) {
        this.camera.pan(e.movement.x, e.movement.y);
        this.applyCameraTransform();
      }
    });
    const endLeft = (e: FederatedPointerEvent): void => {
      if (!this.leftDown) return;
      const wasDragging = this.leftDragging;
      this.leftDown = false;
      this.leftDragging = false;
      if (!wasDragging) this.handleBackgroundTap(e);
    };
    stage.on('pointerup', endLeft);
    stage.on('pointerupoutside', endLeft);

    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
  }

  private handleBackgroundTap(e: FederatedPointerEvent): void {
    const local = e.getLocalPosition(this.worldLayer);
    const tile = { x: local.x / TILE_SIZE, y: local.y / TILE_SIZE };
    if (this.selectedSquadId) {
      this.emitIntent({ t: 'move', squadId: this.selectedSquadId, target: tileCenter(tile) });
    } else {
      this.emitIntent({ t: 'select', squadId: null });
    }
  }

  private handleSquadTap(squadId: Id, isPlayer: boolean): void {
    if (isPlayer) {
      this.selectedSquadId = squadId;
      this.emitIntent({ t: 'select', squadId });
    } else {
      this.emitIntent({ t: 'inspect_enemy', squadId });
    }
  }

  private handleObjectiveTap(objectiveId: Id, e: FederatedPointerEvent): void {
    if (this.selectedSquadId) {
      const local = e.getLocalPosition(this.worldLayer);
      const tile = { x: local.x / TILE_SIZE, y: local.y / TILE_SIZE };
      this.emitIntent({ t: 'move', squadId: this.selectedSquadId, target: tileCenter(tile) });
    } else {
      this.emitIntent({ t: 'inspect_objective', objectiveId });
    }
  }

  private emitIntent(intent: MapIntent): void {
    this.intentCb?.(intent);
  }

  private applyCameraTransform(): void {
    this.worldLayer.scale.set(this.camera.zoom);
    this.worldLayer.x = this.camera.viewWidth / 2 - this.camera.x * this.camera.zoom;
    this.worldLayer.y = this.camera.viewHeight / 2 - this.camera.y * this.camera.zoom;
  }
}
