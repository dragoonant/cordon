/**
 * Temporary local stand-in for `src/render/sprites` (owned by a concurrent
 * agent; see src/sim/API.md § `src/render/sprites/index.ts`). Draws a plain
 * colored triangle + squad-size pips so MapScene has *something* to show a
 * squad with. `spriteSource.ts` prefers the real module and only falls back
 * to this file when that module is missing or errors.
 *
 * FACTION_ACCENT values are hardcoded to match the documented contract
 * exactly (relay amber / compact steel-blue / neutral violet), so this file
 * never needs to know whether the real sprites module has loaded.
 */
import { Graphics, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Faction } from '@sim/types';

export const FACTION_ACCENT: Record<Faction, number> = {
  relay: 0xffa53c,
  compact: 0x6fb7ff,
  neutral: 0xb08cff,
};

const ICON_SIZE = 32;

/** Synchronous placeholder: a triangle silhouette in the faction accent color, with pips for squad size. */
export function drawFallbackSquadIcon(app: Application, faction: Faction, count: number): Texture {
  const accent = FACTION_ACCENT[faction] ?? FACTION_ACCENT.neutral;
  const g = new Graphics();
  const top: [number, number] = [ICON_SIZE / 2, 2];
  const right: [number, number] = [ICON_SIZE - 4, ICON_SIZE - 6];
  const left: [number, number] = [4, ICON_SIZE - 6];
  g.poly([...top, ...right, ...left], true)
    .fill({ color: accent })
    .stroke({ width: 1.5, color: 0x111318, alpha: 0.85 });

  const pips = Math.max(0, Math.min(6, count));
  for (let i = 0; i < pips; i++) {
    const px = pips === 1 ? ICON_SIZE / 2 : 6 + (i * (ICON_SIZE - 12)) / (pips - 1);
    g.circle(px, ICON_SIZE - 3, 1.6).fill({ color: 0xffffff, alpha: 0.9 });
  }

  const texture = app.renderer.generateTexture(g);
  g.destroy();
  return texture;
}
