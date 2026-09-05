/**
 * Tiny ticker-driven timing helper for BattleStage. No external tween lib —
 * every delay and property animation in the battle stage routes through one
 * `Clock` instance so `setSpeed()` and `skip()` can affect everything in
 * flight without hunting down individual `setTimeout`s.
 */
import type { Application } from 'pixi.js';

interface Handle {
  cancel: () => void;
}

export class Clock {
  private app: Application;
  /** Multiplies elapsed time per tick; 1 = full speed, 3 = 'fast' (durations effectively /3). */
  private speedDiv = 1;
  private skipped = false;
  private active = new Set<Handle>();

  constructor(app: Application) {
    this.app = app;
  }

  setSpeedDiv(div: number): void {
    this.speedDiv = div;
  }

  /** Resolves after `ms` of (speed-scaled) ticker time, or immediately once skip()/cancelAll() has fired. */
  wait(ms: number): Promise<void> {
    if (this.skipped || ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let elapsed = 0;
      const handle: Handle = { cancel: () => finish() };
      const tick = (): void => {
        elapsed += this.app.ticker.deltaMS * this.speedDiv;
        if (elapsed >= ms) finish();
      };
      const finish = (): void => {
        this.app.ticker.remove(tick);
        this.active.delete(handle);
        resolve();
      };
      this.app.ticker.add(tick);
      this.active.add(handle);
    });
  }

  /** Calls onUpdate(t) every tick with eased t climbing 0→1 over `duration` (speed-scaled) ms. */
  tween(duration: number, onUpdate: (t: number) => void, easing: (t: number) => number = linear): Promise<void> {
    if (this.skipped || duration <= 0) {
      onUpdate(1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let elapsed = 0;
      const handle: Handle = { cancel: () => finish() };
      const tick = (): void => {
        elapsed += this.app.ticker.deltaMS * this.speedDiv;
        const t = Math.min(1, elapsed / duration);
        onUpdate(easing(t));
        if (t >= 1) finish();
      };
      const finish = (): void => {
        this.app.ticker.remove(tick);
        this.active.delete(handle);
        resolve();
      };
      this.app.ticker.add(tick);
      this.active.add(handle);
    });
  }

  /** Cancels every in-flight wait/tween (resolving immediately) and makes future waits/tweens resolve instantly. */
  cancelAll(): void {
    this.skipped = true;
    for (const h of Array.from(this.active)) h.cancel();
    this.active.clear();
  }

  /** Re-arms the clock (e.g. before a fresh `play()` call). */
  reset(): void {
    this.skipped = false;
  }
}

export const linear = (t: number): number => t;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
