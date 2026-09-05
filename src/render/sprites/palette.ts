/**
 * Shared color language for the procedural placeholder sprites (GDD §3).
 * Desaturated industrial base + exactly one saturated accent per faction.
 */
import type { Faction } from '@sim/types';

/** The one saturated color allowed per faction; everything else stays desaturated. */
export const FACTION_ACCENT: Record<Faction, number> = {
  relay: 0xffa53c,
  compact: 0x6fb7ff,
  neutral: 0xb08cff,
};

export const BASE_PALETTE = {
  gunmetal: 0x4a4f57,
  gunmetalDark: 0x33373d,
  gunmetalLight: 0x6a7079,
  rust: 0x6b4a3a,
  rustDark: 0x4c342a,
  olive: 0x5a6042,
  oliveDark: 0x40452f,
  bone: 0xd9d2c0,
  boneDark: 0xb0a890,
  shadow: 0x1c1e22,
  visor: 0x14161a,
  white: 0xffffff,
  black: 0x0a0a0c,
};

/** Skin tones used by the portrait generator (hashed, not player-chosen). */
export const SKIN_TONES = [0xf2c9a1, 0xd9a878, 0xb87f56, 0x8a5a38];

/** Panel chrome shared by every UI-ish overlay the battle stage draws. */
export const PANEL_BG = 0x14161c;
export const PANEL_BG_LIGHT = 0x22252c;
