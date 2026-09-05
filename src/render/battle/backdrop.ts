/**
 * Battle stage backdrop — biome dressing driven by the 'start' event's
 * mapKind + terrain (GDD §8: "background matching the map biome").
 */
import { Container, FillGradient, Graphics } from 'pixi.js';
import type { MapKind, Terrain } from '@sim/types';

const SPACE_BASE = 0x05060c;
const SPACE_FAR = 0x11142a;

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildStarfield(w: number, h: number, count: number, seed: number, dim: boolean): Graphics {
  const rnd = seededRandom(seed);
  const g = new Graphics();
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h * 0.85;
    const r = rnd() * (dim ? 0.8 : 1.4) + 0.3;
    const alpha = dim ? 0.25 + rnd() * 0.25 : 0.4 + rnd() * 0.6;
    g.circle(x, y, r).fill({ color: 0xffffff, alpha });
  }
  return g;
}

function buildSpaceBackdrop(terrain: Terrain, w: number, h: number): Container {
  const root = new Container();
  const bg = new Graphics();
  const grad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: SPACE_BASE },
      { offset: 1, color: SPACE_FAR },
    ],
  });
  bg.rect(0, 0, w, h).fill(grad);
  root.addChild(bg);
  root.addChild(buildStarfield(w, h, 90, 1001, true));
  root.addChild(buildStarfield(w, h, 60, 2002, false));

  switch (terrain) {
    case 'debris': {
      const rnd = seededRandom(3003);
      const g = new Graphics();
      for (let i = 0; i < 14; i++) {
        const cx = rnd() * w;
        const cy = h * 0.15 + rnd() * h * 0.55;
        const s = 10 + rnd() * 26;
        const pts: number[] = [];
        const sides = 5 + Math.floor(rnd() * 3);
        for (let j = 0; j < sides; j++) {
          const a = (j / sides) * Math.PI * 2;
          const rr = s * (0.6 + rnd() * 0.5);
          pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.poly(pts).fill({ color: 0x53504a, alpha: 0.55 + rnd() * 0.2 });
      }
      root.addChild(g);
      break;
    }
    case 'radiation': {
      const g = new Graphics();
      const rgrad = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: [
          { offset: 0, color: 0x3a0f10 },
          { offset: 0.5, color: 0x220a0a },
          { offset: 1, color: 0x120608 },
        ],
      });
      g.rect(0, 0, w, h).fill({ fill: rgrad, alpha: 0.55 });
      root.addChild(g);
      break;
    }
    case 'gravity': {
      const g = new Graphics();
      g.ellipse(w * 0.78, h * 0.32, 170, 60).stroke({ width: 6, color: 0x8a7bd8, alpha: 0.55 });
      g.ellipse(w * 0.78, h * 0.32, 130, 44).stroke({ width: 3, color: 0xb08cff, alpha: 0.4 });
      g.circle(w * 0.78, h * 0.32, 34).fill({ color: 0x2a2140, alpha: 0.9 });
      root.addChild(g);
      break;
    }
    case 'structure': {
      const g = new Graphics();
      g.rect(0, 0, w, h * 0.06).fill({ color: 0x2b2f38, alpha: 0.8 });
      g.rect(0, h * 0.94, w, h * 0.06).fill({ color: 0x2b2f38, alpha: 0.8 });
      for (let x = -h; x < w + h; x += 90) {
        g.moveTo(x, 0);
        g.lineTo(x + h * 0.3, h * 0.3);
        g.stroke({ width: 3, color: 0x3a3f4a, alpha: 0.35 });
      }
      root.addChild(g);
      break;
    }
    default:
      break;
  }
  return root;
}

function buildSurfaceBackdrop(terrain: Terrain, w: number, h: number): Container {
  const root = new Container();
  const horizonY = h * 0.58;

  const sky = new Graphics();
  const skyGrad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: 0x2b3346 },
      { offset: 1, color: 0x6c6f66 },
    ],
  });
  sky.rect(0, 0, w, horizonY).fill(skyGrad);
  root.addChild(sky);

  const ground = new Graphics();
  const detail = new Graphics();

  switch (terrain) {
    case 'forest': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x39472f);
      const rnd = seededRandom(4004);
      for (let x = -20; x < w + 20; x += 34) {
        const th = 26 + rnd() * 30;
        detail.poly([x, horizonY, x + 17, horizonY - th, x + 34, horizonY]).fill({ color: 0x27341f, alpha: 0.9 });
      }
      break;
    }
    case 'urban': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x4a4d52);
      const rnd = seededRandom(5005);
      let x = -10;
      while (x < w + 10) {
        const bw = 30 + rnd() * 50;
        const bh = 40 + rnd() * 130;
        detail.rect(x, horizonY - bh, bw, bh).fill({ color: 0x2c2e33, alpha: 0.92 });
        x += bw + 6;
      }
      break;
    }
    case 'mountain': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x5c554a);
      const rnd = seededRandom(6006);
      const pts: number[] = [0, horizonY];
      for (let x = 0; x <= w; x += 60) pts.push(x, horizonY - (30 + rnd() * 90));
      pts.push(w, horizonY);
      detail.poly(pts).fill({ color: 0x413c34, alpha: 0.92 });
      break;
    }
    case 'water': {
      ground.rect(0, horizonY, w, h - horizonY).fill(0x2d4a5c);
      for (let i = 0; i < 8; i++) {
        detail
          .rect(0, horizonY + 14 + i * 22, w, 3)
          .fill({ color: 0x9fd0e0, alpha: 0.12 });
      }
      break;
    }
    case 'blocked':
      ground.rect(0, horizonY, w, h - horizonY).fill(0x4d463d);
      break;
    default:
      // 'open' and any other/space terrain paired unexpectedly with a surface map.
      ground.rect(0, horizonY, w, h - horizonY).fill(0x6b6a4a);
      break;
  }

  root.addChild(ground);
  root.addChild(detail);
  return root;
}

export function buildBackdrop(mapKind: MapKind, terrain: Terrain, w: number, h: number): Container {
  return mapKind === 'space' ? buildSpaceBackdrop(terrain, w, h) : buildSurfaceBackdrop(terrain, w, h);
}
