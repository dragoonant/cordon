/**
 * CORDON — sprite compositor (render-battle).
 *
 * Procedural SD/chibi mecha placeholders (GDD §3) drawn with Pixi Graphics
 * and baked to Textures via `app.renderer.generateTexture`, cached by a
 * string key so repeat lookups (every battle, every map redraw) are free.
 * Hand-authored PNGs under `public/` are preferred when present (checked
 * once via HEAD request, then cached) — see `assetProbe.ts`.
 *
 * A mech texture is always "frame body + weapon overlay" per GDD §3's
 * production rule: frames are bespoke, weapons mount on shared attachment
 * points so N frames × M weapons stays N+M assets, not N×M.
 *
 * No top-level DOM/fetch/Pixi-application side effects: every exported
 * function only touches the network or the renderer when called.
 */
import { Application, Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Faction, GameData, Id, Mech } from '@sim/types';
import { FACTION_ACCENT } from './palette';
import { probeFirstExisting } from './assetProbe';
import { loadChromaKeyedFrameTexture } from './chromaKey';
import { getCachedTexture, clearSpriteCache as clearCache } from './textureCache';
import { attachPointsFor, boundsFor, buildFrameContainer } from './drawFrame';
import { buildWeaponOverlay } from './drawWeapon';
import { buildPortraitContainer, type Expression } from './drawPortrait';

export { FACTION_ACCENT };
export type { Expression };

export type SpriteScale = 'map' | 'battle';

const SCALE_HEIGHT: Record<SpriteScale, number> = { map: 32, battle: 128 };

function heightFor(scale: SpriteScale): number {
  return SCALE_HEIGHT[scale];
}

/**
 * Bakes facing into the texture: relay faces right (unflipped — our bodies
 * are drawn with the weapon hand on the +x/right side by convention),
 * compact faces left (mirrored via scale.x, per GDD/task spec). Neutral
 * stays unflipped.
 */
function wrapFacing(art: Container, faction: Faction): Container {
  const root = new Container();
  root.addChild(art);
  if (faction === 'compact') art.scale.x = -1;
  return root;
}

function bake(app: Application, root: Container, anchor: { x: number; y: number }): Texture {
  const tex = app.renderer.generateTexture({ target: root, antialias: true, defaultAnchor: anchor });
  root.destroy({ children: true });
  return tex;
}

/** Loads a hand-authored PNG/JPG at `baseUrl` (no extension) if either exists — used for portraits, which need no chroma-keying. */
async function loadPortraitIfPresent(baseUrl: string): Promise<Texture | null> {
  const url = await probeFirstExisting(baseUrl, ['png', 'jpg']);
  if (!url) return null;
  try {
    return await Assets.load<Texture>(url);
  } catch {
    return null;
  }
}

export async function getFrameTexture(
  app: Application,
  data: GameData,
  frameId: Id,
  faction: Faction,
  scale: SpriteScale,
): Promise<Texture> {
  const key = `frame:${frameId}:${faction}:${scale}`;
  return getCachedTexture(key, async () => {
    const frame = data.frames[frameId];
    if (!frame) throw new Error(`getFrameTexture: unknown frame id "${frameId}"`);
    const H = heightFor(scale);
    const png = await loadChromaKeyedFrameTexture(frame.spriteKey, scale, H);
    if (png) {
      const sprite = new Sprite(png);
      sprite.anchor.set(0.5, 1);
      const root = wrapFacing(sprite, faction);
      return bake(app, root, { x: 0.5, y: 1 });
    }
    const built = buildFrameContainer(frame.silhouette, faction, H, scale === 'battle');
    const root = wrapFacing(built.container, faction);
    return bake(app, root, { x: 0.5, y: 1 });
  });
}

export async function getMechTexture(
  app: Application,
  data: GameData,
  mech: Mech,
  faction: Faction,
  scale: SpriteScale,
): Promise<Texture> {
  const frame = data.frames[mech.frameId];
  if (!frame) throw new Error(`getMechTexture: unknown frame id "${mech.frameId}" on mech "${mech.id}"`);
  const weapon = mech.weaponA ? data.weapons[mech.weaponA] : null;
  const key = `mech:${mech.frameId}:${faction}:${scale}:${weapon?.id ?? 'none'}`;
  return getCachedTexture(key, async () => {
    const H = heightFor(scale);
    const detailed = scale === 'battle';
    const art = new Container();

    const png = await loadChromaKeyedFrameTexture(frame.spriteKey, scale, H);
    if (png) {
      const sprite = new Sprite(png);
      sprite.anchor.set(0.5, 1);
      const bounds = boundsFor(frame.silhouette, H);
      sprite.y = bounds.bottomY;
      const targetH = bounds.bottomY - bounds.topY;
      const s = sprite.texture.height > 0 ? targetH / sprite.texture.height : 1;
      sprite.scale.set(s, s);
      art.addChild(sprite);
    } else {
      const built = buildFrameContainer(frame.silhouette, faction, H, detailed);
      art.addChild(built.container);
    }

    // Weapon overlays only carry detail at battle scale — map scale stays the
    // simplified "head + torso + accent" silhouette per GDD §3.
    if (weapon && detailed) {
      const attach = attachPointsFor(frame.silhouette, H);
      const overlay = buildWeaponOverlay(weapon.animKey, FACTION_ACCENT[faction], H, attach);
      art.addChild(overlay);
    }

    const root = wrapFacing(art, faction);
    return bake(app, root, { x: 0.5, y: 1 });
  });
}

export async function getPortraitTexture(
  app: Application,
  data: GameData,
  pilotDefId: Id,
  expression: 'neutral' | 'shout' | 'strained' | 'grin',
): Promise<Texture> {
  const key = `portrait:${pilotDefId}:${expression}`;
  return getCachedTexture(key, async () => {
    const pilot = data.pilots[pilotDefId];
    if (!pilot) throw new Error(`getPortraitTexture: unknown pilot id "${pilotDefId}"`);
    const png = await loadPortraitIfPresent(`/portraits/${pilot.portraitKey}_${expression}`);
    if (png) return png;
    const container = buildPortraitContainer(pilotDefId, pilot.faction, expression, pilot.callsign, 96);
    return bake(app, container, { x: 0.5, y: 0.5 });
  });
}

export async function getSquadIconTexture(
  app: Application,
  data: GameData,
  leaderFrameId: Id,
  faction: Faction,
  count: number,
): Promise<Texture> {
  const clamped = Math.max(0, Math.min(6, Math.round(count)));
  const key = `squadicon:${leaderFrameId}:${faction}:${clamped}`;
  return getCachedTexture(key, async () => {
    const frame = data.frames[leaderFrameId];
    if (!frame) throw new Error(`getSquadIconTexture: unknown frame id "${leaderFrameId}"`);
    const H = 26; // leave room below the ~32px map icon for the size pips
    const built = buildFrameContainer(frame.silhouette, faction, H, false);
    const art = new Container();
    art.addChild(built.container);
    const root = wrapFacing(art, faction);

    // Pips row, centered under the icon — one per living squad slot.
    const pipR = 2;
    const gap = pipR * 2.4;
    const totalW = clamped > 0 ? (clamped - 1) * gap : 0;
    const pipsY = built.bottomY + 6;
    for (let i = 0; i < clamped; i++) {
      const dot = new Graphics();
      dot.circle(-totalW / 2 + i * gap, pipsY, pipR).fill(FACTION_ACCENT[faction]);
      root.addChild(dot);
    }

    return bake(app, root, { x: 0.5, y: 1 });
  });
}

/**
 * Generates every map/battle mech frame texture for both factions plus
 * neutral, and every portrait expression for every pilot, so the first
 * battle/map draw never stalls on a cold cache. Safe to call repeatedly —
 * cache hits no-op after the first pass.
 */
export async function preloadAll(app: Application, data: GameData): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  const factions: Faction[] = ['relay', 'compact', 'neutral'];
  const scales: SpriteScale[] = ['map', 'battle'];

  for (const frameId of Object.keys(data.frames)) {
    for (const faction of factions) {
      for (const scale of scales) {
        jobs.push(getFrameTexture(app, data, frameId, faction, scale));
      }
    }
  }

  const expressions: Expression[] = ['neutral', 'shout', 'strained', 'grin'];
  for (const pilotDefId of Object.keys(data.pilots)) {
    for (const expression of expressions) {
      jobs.push(getPortraitTexture(app, data, pilotDefId, expression));
    }
  }

  await Promise.all(jobs);
}

/** Drops every baked texture and asset-probe result. Mainly for tests / dev-harness reloads. */
export function clearSpriteCache(): void {
  clearCache();
}
