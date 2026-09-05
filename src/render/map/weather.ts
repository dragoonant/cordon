/**
 * Overworld atmosphere: a full-map tint + subtle vignette per `MapDef.weather`
 * (rain/storm/dust/solar_flare each read differently; clear/none draw
 * nothing), plus — for space maps only — a parallax starfield + one faint
 * nebula blob behind the map diamond, so two `void`-heavy maps don't feel
 * identical.
 *
 * Everything here is screen-space (sized to the viewport, like `dimOverlay`
 * in MapScene), not world-space: weather is ambient lighting over the whole
 * view, not a thing that pans/zooms with the map. `MapScene` owns two
 * permanent stage-level containers — one inserted before `worldLayer`
 * (the starfield backdrop), one after it but before `dimOverlay` (the tint/
 * vignette/particle overlay) — and hands them to a fresh `WeatherLayer` on
 * every `resetSceneForMap`; `destroy()` empties them back out.
 *
 * All "randomness" (star positions, nebula placement/hue, particle drift,
 * storm flash timing) is seeded from `stringHash(map.id)` via `makeRng` —
 * no `Math.random` per CONVENTIONS.md — so a given map's weather always
 * animates identically from load to load, matching this module's other
 * deterministic-by-map-id siblings (`tiles.ts`, `decor.ts`).
 */
import { Container, Graphics } from 'pixi.js';
import type { MapDef, Weather } from '@sim/types';
import { makeRng, stringHash } from './hash';

interface WeatherStyle {
  tintColor: number;
  tintAlpha: number;
  /** Neutral dark vignette (rain/storm/dust) vs. a colored rim glow (solar_flare) vs. none. */
  vignette: 'dark' | 'rim' | 'none';
  particles: 'rain' | 'dust' | 'none';
  flash: boolean;
  pulse: boolean;
}

const WEATHER_STYLE: Record<Weather, WeatherStyle> = {
  clear: { tintColor: 0, tintAlpha: 0, vignette: 'none', particles: 'none', flash: false, pulse: false },
  none: { tintColor: 0, tintAlpha: 0, vignette: 'none', particles: 'none', flash: false, pulse: false },
  rain: { tintColor: 0x8fa9d9, tintAlpha: 0.18, vignette: 'dark', particles: 'rain', flash: false, pulse: false },
  storm: { tintColor: 0x141826, tintAlpha: 0.35, vignette: 'dark', particles: 'rain', flash: true, pulse: false },
  dust: { tintColor: 0xd9b27a, tintAlpha: 0.2, vignette: 'dark', particles: 'dust', flash: false, pulse: false },
  solar_flare: { tintColor: 0xff9a3c, tintAlpha: 0.16, vignette: 'rim', particles: 'none', flash: false, pulse: true },
};

interface Star {
  fx: number;
  fy: number;
  r: number;
  a: number;
  speed: number; // px/sec drift
}

function buildStars(rng: () => number, count: number, rRange: [number, number], aRange: [number, number], speed: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      fx: rng(),
      fy: rng(),
      r: rRange[0] + rng() * (rRange[1] - rRange[0]),
      a: aRange[0] + rng() * (aRange[1] - aRange[0]),
      speed,
    });
  }
  return stars;
}

function drawStars(g: Graphics, stars: Star[], w: number, h: number, t: number): void {
  g.clear();
  if (w <= 0 || h <= 0) return;
  for (const s of stars) {
    const x = ((s.fx * w + t * s.speed) % (w + 40)) - 20;
    g.circle(x, s.fy * h, s.r).fill({ color: 0xffffff, alpha: s.a });
  }
}

/** Standard HSL -> 0xRRGGBB, h in degrees, s/l in 0..1. */
function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

interface Particle {
  fx: number;
  fy: number;
  vx: number; // px/sec
  vy: number; // px/sec
  r: number;
  a: number;
}

function buildParticles(rng: () => number, count: number, vx: [number, number], vy: [number, number], rRange: [number, number], aRange: [number, number]): Particle[] {
  const list: Particle[] = [];
  for (let i = 0; i < count; i++) {
    list.push({
      fx: rng(),
      fy: rng(),
      vx: vx[0] + rng() * (vx[1] - vx[0]),
      vy: vy[0] + rng() * (vy[1] - vy[0]),
      r: rRange[0] + rng() * (rRange[1] - rRange[0]),
      a: aRange[0] + rng() * (aRange[1] - aRange[0]),
    });
  }
  return list;
}

const RAIN_COUNT = 50;
const DUST_COUNT = 40;
const STAR_FAR_COUNT = 90;
const STAR_NEAR_COUNT = 40;
const FLASH_DURATION = 0.12;

export class WeatherLayer {
  private readonly backdropParent: Container;
  private readonly overlayParent: Container;
  private readonly style: WeatherStyle;
  private readonly isSpace: boolean;
  private readonly rng: () => number;

  private readonly tintGfx = new Graphics();
  private readonly vignetteGfx = new Graphics();
  private readonly particleGfx = new Graphics();
  private readonly flashGfx = new Graphics();
  private readonly nebulaGfx = new Graphics();
  private readonly starsFarGfx = new Graphics();
  private readonly starsNearGfx = new Graphics();

  private readonly starsFar: Star[];
  private readonly starsNear: Star[];
  private readonly particles: Particle[];
  private readonly nebulaHue: number;
  private readonly nebulaFx: number;
  private readonly nebulaFy: number;

  private w = 0;
  private h = 0;
  private t = 0;
  private nextFlashAt = 0;
  private flashRemaining = 0;

  constructor(map: MapDef, backdropParent: Container, overlayParent: Container) {
    this.backdropParent = backdropParent;
    this.overlayParent = overlayParent;
    this.style = WEATHER_STYLE[map.weather] ?? WEATHER_STYLE.none;
    this.isSpace = map.kind === 'space';
    this.rng = makeRng(stringHash(map.id) || 1);

    this.starsFar = buildStars(this.rng, STAR_FAR_COUNT, [0.4, 1.1], [0.25, 0.55], 1.5);
    this.starsNear = buildStars(this.rng, STAR_NEAR_COUNT, [0.9, 1.8], [0.5, 0.9], 4);
    this.nebulaHue = this.rng() * 360;
    this.nebulaFx = 0.25 + this.rng() * 0.5;
    this.nebulaFy = 0.2 + this.rng() * 0.4;

    this.particles =
      this.style.particles === 'rain'
        ? buildParticles(this.rng, RAIN_COUNT, [-30, -10], [260, 420], [1, 1.8], [0.25, 0.5])
        : this.style.particles === 'dust'
          ? buildParticles(this.rng, DUST_COUNT, [12, 30], [4, 14], [1, 2.2], [0.12, 0.3])
          : [];

    if (this.isSpace) {
      this.backdropParent.addChild(this.nebulaGfx, this.starsFarGfx, this.starsNearGfx);
    }
    this.overlayParent.addChild(this.tintGfx, this.vignetteGfx, this.particleGfx, this.flashGfx);
    this.overlayParent.eventMode = 'none';
    this.backdropParent.eventMode = 'none';

    this.scheduleNextFlash();
  }

  private scheduleNextFlash(): void {
    this.nextFlashAt = this.t + 4 + this.rng() * 7;
  }

  /** Redraws every size-dependent (but not time-dependent) piece — call once up front and again on every MapScene#resize. */
  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;

    if (this.isSpace) {
      const color = hslToHex(this.nebulaHue, 0.55, 0.5);
      this.nebulaGfx.clear();
      if (w > 0 && h > 0) {
        const cx = this.nebulaFx * w;
        const cy = this.nebulaFy * h;
        const baseR = Math.max(w, h) * 0.35;
        const steps = 5;
        for (let i = steps; i >= 1; i--) {
          this.nebulaGfx.circle(cx, cy, (i / steps) * baseR).fill({ color, alpha: 0.03 * (steps - i + 1) });
        }
      }
      drawStars(this.starsFarGfx, this.starsFar, w, h, this.t);
      drawStars(this.starsNearGfx, this.starsNear, w, h, this.t);
    }

    this.tintGfx.clear();
    if (this.style.tintAlpha > 0 && w > 0 && h > 0) {
      this.tintGfx.rect(0, 0, w, h).fill({ color: this.style.tintColor, alpha: this.style.tintAlpha });
    }

    this.vignetteGfx.clear();
    if (this.style.vignette !== 'none' && w > 0 && h > 0) {
      const color = this.style.vignette === 'rim' ? 0xff8a2c : 0x000000;
      const steps = 5;
      const maxInset = Math.min(w, h) * 0.22;
      for (let i = steps; i >= 1; i--) {
        const inset = (i / steps) * maxInset;
        const alpha = (this.style.vignette === 'rim' ? 0.05 : 0.045) * (steps - i + 1);
        this.vignetteGfx.rect(inset, inset, w - inset * 2, h - inset * 2).stroke({ width: inset * 0.6, color, alpha });
      }
    }

    this.flashGfx.clear();
    if (this.style.flash && w > 0 && h > 0) {
      this.flashGfx.rect(0, 0, w, h).fill({ color: 0xffffff });
    }
    this.flashGfx.alpha = 0;
  }

  update(dt: number): void {
    this.t += dt;

    if (this.isSpace && this.w > 0) {
      drawStars(this.starsFarGfx, this.starsFar, this.w, this.h, this.t);
      drawStars(this.starsNearGfx, this.starsNear, this.w, this.h, this.t);
    }

    if (this.particles.length > 0 && this.w > 0 && this.h > 0) {
      this.particleGfx.clear();
      const color = this.style.particles === 'rain' ? 0xcfe0ff : 0xe8d2a0;
      for (const p of this.particles) {
        let x = (p.fx * this.w + p.vx * this.t) % (this.w + 60);
        if (x < -30) x += this.w + 60;
        let y = (p.fy * this.h + p.vy * this.t) % (this.h + 60);
        if (y < -30) y += this.h + 60;
        if (this.style.particles === 'rain') {
          // Streak length is proportional to fall speed (vy) so it reads as a motion-blurred line, not a dot.
          this.particleGfx.moveTo(x, y).lineTo(x + p.vx * 0.08, y + p.vy * 0.08).stroke({ width: p.r, color, alpha: p.a });
        } else {
          this.particleGfx.circle(x, y, p.r).fill({ color, alpha: p.a });
        }
      }
    }

    if (this.style.flash) {
      if (this.flashRemaining > 0) {
        this.flashRemaining -= dt;
        this.flashGfx.alpha = Math.max(0, (this.flashRemaining / FLASH_DURATION) * 0.75);
      } else if (this.t >= this.nextFlashAt) {
        this.flashRemaining = FLASH_DURATION;
        this.scheduleNextFlash();
      }
    }

    if (this.style.pulse) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 1.6);
      this.tintGfx.alpha = 0.7 + 0.3 * pulse; // modulates the base tintAlpha baked into the fill
    }
  }

  destroy(): void {
    this.backdropParent.removeChildren();
    this.overlayParent.removeChildren();
    for (const g of [this.tintGfx, this.vignetteGfx, this.particleGfx, this.flashGfx, this.nebulaGfx, this.starsFarGfx, this.starsNearGfx]) {
      g.destroy({ children: true, texture: false });
    }
  }
}
