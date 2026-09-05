/**
 * Procedural SFX kit: oscillators, noise buffers, filter sweeps, and
 * envelopes standing in for a sample library. No assets, no samples --
 * everything here is synthesized on a lazily-created, shared AudioContext.
 *
 * Design notes (why, not what):
 *
 * - `playSfx(name)` is the low-level "make this one sound" entry point;
 *   `playBattleSfx(event, data)` / `playMapSfx(event)` are the high-level
 *   entry points the UI actually wires up -- they translate a sim event
 *   (`BattleEvent` / `WorldEvent`, both closed unions in @sim/types) into
 *   zero or more `playSfx`-style calls, staggered in time where a single
 *   event implies multiple sounds (e.g. one attack with three hits).
 * - All three gate on the same module-level `sfxVolume` (set via
 *   `setSfxVolume`, called from index.ts's initAudio/updateAudioSettings)
 *   so volume is respected regardless of which entry point the UI calls --
 *   the UI is free to call playBattleSfx directly without going through
 *   index.ts's `state`.
 * - The AudioContext is shared and lazy: created on first use, resumed if
 *   suspended (autoplay policies suspend contexts created before a user
 *   gesture). index.ts's playMusic() procedural fallback reuses this same
 *   context via `getSfxAudioContext()` so music and SFX mix through one
 *   real output rather than two competing AudioContexts.
 * - Every builder function is a `dispatch`-able unit keyed by `SfxName` so
 *   `playSfx`, `playBattleSfx`, and `playMapSfx` can all schedule the same
 *   underlying sound at an explicit `startTime` (not always "now"), which
 *   is what lets playBattleSfx stagger a multi-hit attack's hit/crit/miss
 *   sounds ~60ms apart on one AudioContext clock instead of firing them
 *   all at once.
 * - Never throws: every public function wraps its body in try/catch and
 *   no-ops when there's no DOM/AudioContext (Node, tests) or SFX is muted.
 */

import type { BattleEvent, GameData, WorldEvent } from '@sim/types';

// ─────────────────────────────────────────────────────────────────────────────
// Environment + shared AudioContext
// ─────────────────────────────────────────────────────────────────────────────

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

function isOperating(): boolean {
  return isBrowser && typeof (window as any).AudioContext !== 'undefined';
}

let sharedCtx: AudioContext | null = null;

/** Lazily create (or return) the shared AudioContext used by all SFX, and
 *  by index.ts's procedural music fallback. Resumes it if a browser
 *  autoplay policy left it suspended. Never throws; returns null if
 *  unavailable (Node, or construction failed). */
function getAudioCtx(): AudioContext | null {
  if (!isOperating()) return null;
  try {
    let ctx = sharedCtx;
    if (!ctx) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx() as AudioContext;
      sharedCtx = ctx;
    }
    if (ctx.state === 'suspended') {
      // Fire-and-forget; some browsers reject this outside a user gesture,
      // which is fine -- the next call after a gesture will succeed.
      ctx.resume().catch(() => {});
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Exposed so index.ts's playMusic() procedural fallback can share this
 *  context instead of maintaining its own. */
export function getSfxAudioContext(): AudioContext | null {
  return getAudioCtx();
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume
// ─────────────────────────────────────────────────────────────────────────────

let sfxVolume = 0;

/** Mirror of the audio settings' `sfx` value (0..1). Called from index.ts
 *  whenever settings change, so every entry point in this module -- even
 *  ones the UI calls directly -- respects the current volume/mute state. */
export function setSfxVolume(v: number): void {
  sfxVolume = Math.max(0, v);
}

// ─────────────────────────────────────────────────────────────────────────────
// SFX name union
// ─────────────────────────────────────────────────────────────────────────────

export type SfxName =
  // weapon fire, keyed by WeaponDef.animKey
  | 'burst'
  | 'beam'
  | 'rail'
  | 'missiles'
  | 'flak'
  | 'lunge'
  | 'slash'
  | 'maul'
  | 'repair'
  // impacts
  | 'hit'
  | 'crit'
  | 'miss'
  | 'shield'
  | 'explosion'
  | 'eject'
  | 'pilot_lost'
  // presentation / UI
  | 'ui_click'
  | 'ui_confirm'
  | 'ui_back'
  | 'callout'
  | 'cutin'
  | 'round'
  | 'finisher'
  | 'rout'
  | 'victory'
  | 'defeat'
  | 'alert'
  | 'deploy'
  | 'objective';

// ─────────────────────────────────────────────────────────────────────────────
// Low-level voice primitives
// ─────────────────────────────────────────────────────────────────────────────

let noiseBufferCache: AudioBuffer | null = null;
let noiseBufferCtx: AudioContext | null = null;

/** One shared 2-second white-noise buffer, regenerated only if the context
 *  changes. Every noise-based SFX loops a slice of this rather than
 *  allocating its own buffer. */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBufferCache && noiseBufferCtx === ctx) return noiseBufferCache;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBufferCache = buf;
  noiseBufferCtx = ctx;
  return buf;
}

interface ToneOpts {
  type: OscillatorType;
  freq: number;
  freqEnd?: number; // if set, glide from freq to freqEnd (exponential)
  detune?: number;
  startTime: number;
  attack: number;
  sustainDur: number;
  release: number;
  peak: number;
  dest?: AudioNode;
}

function tone(ctx: AudioContext, vol: number, opts: ToneOpts): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  if (opts.detune) osc.detune.value = opts.detune;

  const g = ctx.createGain();
  g.gain.value = 0;
  osc.connect(g);
  g.connect(opts.dest ?? ctx.destination);

  const t0 = opts.startTime;
  const f0 = Math.max(1, opts.freq);
  osc.frequency.setValueAtTime(f0, t0);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + opts.attack + opts.sustainDur);
  }

  const peak = Math.max(0, opts.peak * vol);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + opts.attack);
  g.gain.setValueAtTime(peak, t0 + opts.attack + opts.sustainDur);
  g.gain.linearRampToValueAtTime(0, t0 + opts.attack + opts.sustainDur + opts.release);

  const stopAt = t0 + opts.attack + opts.sustainDur + opts.release + 0.03;
  osc.start(t0);
  osc.stop(stopAt);
  osc.onended = () => {
    try {
      g.disconnect();
      osc.disconnect();
    } catch {
      // already disconnected; ignore
    }
  };
}

interface NoiseOpts {
  startTime: number;
  attack: number;
  sustainDur: number;
  release: number;
  peak: number;
  filterType: BiquadFilterType;
  filterFreq: number;
  filterFreqEnd?: number; // if set, sweep the filter cutoff over attack+sustain
  q?: number;
  dest?: AudioNode;
}

function noise(ctx: AudioContext, vol: number, opts: NoiseOpts): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;

  const filt = ctx.createBiquadFilter();
  filt.type = opts.filterType;
  filt.frequency.value = opts.filterFreq;
  if (opts.q !== undefined) filt.Q.value = opts.q;

  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(filt);
  filt.connect(g);
  g.connect(opts.dest ?? ctx.destination);

  const t0 = opts.startTime;
  if (opts.filterFreqEnd !== undefined) {
    filt.frequency.setValueAtTime(opts.filterFreq, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, opts.filterFreqEnd), t0 + opts.attack + opts.sustainDur);
  }

  const peak = Math.max(0, opts.peak * vol);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + opts.attack);
  g.gain.setValueAtTime(peak, t0 + opts.attack + opts.sustainDur);
  g.gain.linearRampToValueAtTime(0, t0 + opts.attack + opts.sustainDur + opts.release);

  const stopAt = t0 + opts.attack + opts.sustainDur + opts.release + 0.03;
  src.start(t0);
  src.stop(stopAt);
  src.onended = () => {
    try {
      g.disconnect();
      filt.disconnect();
      src.disconnect();
    } catch {
      // already disconnected; ignore
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SFX builders, one per name
// ─────────────────────────────────────────────────────────────────────────────

// ── Weapon fire (by animKey) ────────────────────────────────────────────

function sfxBurst(ctx: AudioContext, t: number, vol: number): void {
  // Three rapid gunshots: noise + a fast downward sweep, ~55ms apart.
  for (let i = 0; i < 3; i++) {
    const t0 = t + i * 0.055;
    noise(ctx, vol, { startTime: t0, attack: 0.001, sustainDur: 0.03, release: 0.05, peak: 0.5, filterType: 'bandpass', filterFreq: 900, filterFreqEnd: 200, q: 0.7 });
  }
}

function sfxBeam(ctx: AudioContext, t: number, vol: number): void {
  // Bright saw sweep down with a hum tail.
  tone(ctx, vol, { type: 'sawtooth', freq: 1200, freqEnd: 300, startTime: t, attack: 0.008, sustainDur: 0.18, release: 0.12, peak: 0.32 });
  tone(ctx, vol, { type: 'sine', freq: 300, startTime: t + 0.05, attack: 0.02, sustainDur: 0.15, release: 0.25, peak: 0.12 });
}

function sfxRail(ctx: AudioContext, t: number, vol: number): void {
  // Click, then a rising whine, then a thunder tail.
  noise(ctx, vol, { startTime: t, attack: 0.0005, sustainDur: 0.008, release: 0.02, peak: 0.4, filterType: 'highpass', filterFreq: 4000 });
  tone(ctx, vol, { type: 'sawtooth', freq: 2000, freqEnd: 8000, startTime: t + 0.01, attack: 0.005, sustainDur: 0.09, release: 0.04, peak: 0.22 });
  noise(ctx, vol, { startTime: t + 0.11, attack: 0.005, sustainDur: 0.25, release: 0.35, peak: 0.28, filterType: 'lowpass', filterFreq: 2500, filterFreqEnd: 150 });
}

function sfxMissiles(ctx: AudioContext, t: number, vol: number): void {
  // Whoosh sweeping up, then delayed booms.
  noise(ctx, vol, { startTime: t, attack: 0.02, sustainDur: 0.2, release: 0.1, peak: 0.24, filterType: 'bandpass', filterFreq: 400, filterFreqEnd: 2500, q: 0.6 });
  const boomTimes = [0.32, 0.42, 0.5];
  boomTimes.forEach((dt, i) => {
    const t0 = t + dt;
    noise(ctx, vol, { startTime: t0, attack: 0.003, sustainDur: 0.08, release: 0.22, peak: 0.4 - i * 0.05, filterType: 'lowpass', filterFreq: 1800, filterFreqEnd: 100 });
    tone(ctx, vol, { type: 'sine', freq: 70, startTime: t0, attack: 0.003, sustainDur: 0.08, release: 0.2, peak: 0.3 - i * 0.05 });
  });
}

function sfxFlak(ctx: AudioContext, t: number, vol: number): void {
  // Double thump plus a scattering of crackle clicks.
  tone(ctx, vol, { type: 'sine', freq: 130, freqEnd: 60, startTime: t, attack: 0.002, sustainDur: 0.03, release: 0.09, peak: 0.4 });
  tone(ctx, vol, { type: 'sine', freq: 130, freqEnd: 60, startTime: t + 0.08, attack: 0.002, sustainDur: 0.03, release: 0.09, peak: 0.36 });
  const crackleOffsets = [0.02, 0.06, 0.11, 0.15, 0.19, 0.23];
  crackleOffsets.forEach((dt) => {
    noise(ctx, vol, { startTime: t + dt, attack: 0.0005, sustainDur: 0.006, release: 0.02, peak: 0.18, filterType: 'highpass', filterFreq: 6000 });
  });
}

function sfxLungeSlash(ctx: AudioContext, t: number, vol: number): void {
  // Metallic clang: noise burst + two detuned high sines ringing out.
  noise(ctx, vol, { startTime: t, attack: 0.0005, sustainDur: 0.015, release: 0.05, peak: 0.32, filterType: 'bandpass', filterFreq: 3200, q: 1.2 });
  tone(ctx, vol, { type: 'triangle', freq: 2300, startTime: t, attack: 0.001, sustainDur: 0.04, release: 0.18, peak: 0.18 });
  tone(ctx, vol, { type: 'triangle', freq: 3100, startTime: t, attack: 0.001, sustainDur: 0.03, release: 0.14, peak: 0.14 });
}

function sfxMaul(ctx: AudioContext, t: number, vol: number): void {
  // Heavy 80Hz thud plus body noise, slow decay.
  tone(ctx, vol, { type: 'sine', freq: 80, startTime: t, attack: 0.003, sustainDur: 0.05, release: 0.3, peak: 0.5 });
  noise(ctx, vol, { startTime: t, attack: 0.002, sustainDur: 0.04, release: 0.22, peak: 0.22, filterType: 'lowpass', filterFreq: 500 });
}

function sfxRepair(ctx: AudioContext, t: number, vol: number): void {
  // Soft rising two-note chime.
  tone(ctx, vol, { type: 'triangle', freq: 660, startTime: t, attack: 0.03, sustainDur: 0.12, release: 0.2, peak: 0.2 });
  tone(ctx, vol, { type: 'triangle', freq: 880, startTime: t + 0.14, attack: 0.03, sustainDur: 0.14, release: 0.28, peak: 0.22 });
}

// ── Impacts ──────────────────────────────────────────────────────────────

function sfxHit(ctx: AudioContext, t: number, vol: number): void {
  noise(ctx, vol, { startTime: t, attack: 0.001, sustainDur: 0.02, release: 0.06, peak: 0.3, filterType: 'bandpass', filterFreq: 1100, q: 0.8 });
  tone(ctx, vol, { type: 'sine', freq: 220, startTime: t, attack: 0.001, sustainDur: 0.02, release: 0.05, peak: 0.18 });
}

function sfxCrit(ctx: AudioContext, t: number, vol: number): void {
  noise(ctx, vol, { startTime: t, attack: 0.001, sustainDur: 0.03, release: 0.09, peak: 0.42, filterType: 'bandpass', filterFreq: 1300, q: 0.8 });
  tone(ctx, vol, { type: 'sine', freq: 260, startTime: t, attack: 0.001, sustainDur: 0.03, release: 0.08, peak: 0.24 });
  tone(ctx, vol, { type: 'triangle', freq: 3000, startTime: t + 0.02, attack: 0.001, sustainDur: 0.02, release: 0.12, peak: 0.2 });
}

function sfxMiss(ctx: AudioContext, t: number, vol: number): void {
  noise(ctx, vol, { startTime: t, attack: 0.01, sustainDur: 0.06, release: 0.08, peak: 0.14, filterType: 'bandpass', filterFreq: 1200, filterFreqEnd: 400, q: 0.5 });
}

function sfxShield(ctx: AudioContext, t: number, vol: number): void {
  tone(ctx, vol, { type: 'sine', freq: 1800, startTime: t, attack: 0.002, sustainDur: 0.08, release: 0.28, peak: 0.22 });
  tone(ctx, vol, { type: 'triangle', freq: 1810, detune: 6, startTime: t, attack: 0.004, sustainDur: 0.08, release: 0.32, peak: 0.14 });
}

function sfxExplosion(ctx: AudioContext, t: number, vol: number): void {
  noise(ctx, vol, { startTime: t, attack: 0.005, sustainDur: 0.15, release: 0.45, peak: 0.5, filterType: 'lowpass', filterFreq: 4000, filterFreqEnd: 80 });
  tone(ctx, vol, { type: 'sine', freq: 55, startTime: t, attack: 0.01, sustainDur: 0.2, release: 0.4, peak: 0.4 });
}

function sfxEject(ctx: AudioContext, t: number, vol: number): void {
  noise(ctx, vol, { startTime: t, attack: 0.0005, sustainDur: 0.01, release: 0.03, peak: 0.3, filterType: 'highpass', filterFreq: 3000 });
  tone(ctx, vol, { type: 'sine', freq: 400, freqEnd: 1600, startTime: t + 0.02, attack: 0.02, sustainDur: 0.22, release: 0.14, peak: 0.22 });
}

function sfxPilotLost(ctx: AudioContext, t: number, vol: number): void {
  // Low dissonant sting: a minor-2nd clash held ~1s.
  tone(ctx, vol, { type: 'sawtooth', freq: 110, startTime: t, attack: 0.05, sustainDur: 0.6, release: 0.4, peak: 0.28 });
  tone(ctx, vol, { type: 'sawtooth', freq: 116.5, startTime: t, attack: 0.05, sustainDur: 0.6, release: 0.4, peak: 0.24 });
  tone(ctx, vol, { type: 'sine', freq: 55, startTime: t, attack: 0.08, sustainDur: 0.55, release: 0.4, peak: 0.2 });
}

// ── Presentation / UI ────────────────────────────────────────────────────

function sfxUiClick(ctx: AudioContext, t: number, vol: number): void {
  tone(ctx, vol, { type: 'square', freq: 900, startTime: t, attack: 0.001, sustainDur: 0.02, release: 0.03, peak: 0.14 });
}

function sfxUiConfirm(ctx: AudioContext, t: number, vol: number): void {
  tone(ctx, vol, { type: 'triangle', freq: 600, startTime: t, attack: 0.002, sustainDur: 0.05, release: 0.05, peak: 0.16 });
  tone(ctx, vol, { type: 'triangle', freq: 900, startTime: t + 0.06, attack: 0.002, sustainDur: 0.06, release: 0.08, peak: 0.18 });
}

function sfxUiBack(ctx: AudioContext, t: number, vol: number): void {
  tone(ctx, vol, { type: 'triangle', freq: 700, startTime: t, attack: 0.002, sustainDur: 0.05, release: 0.05, peak: 0.16 });
  tone(ctx, vol, { type: 'triangle', freq: 450, startTime: t + 0.06, attack: 0.002, sustainDur: 0.06, release: 0.08, peak: 0.14 });
}

function sfxCallout(ctx: AudioContext, t: number, vol: number): void {
  // Radio squelch open, then a short confirm chime -- SRW spirit-command feel.
  noise(ctx, vol, { startTime: t, attack: 0.002, sustainDur: 0.05, release: 0.06, peak: 0.16, filterType: 'bandpass', filterFreq: 1400, q: 3 });
  tone(ctx, vol, { type: 'triangle', freq: 1050, startTime: t + 0.09, attack: 0.004, sustainDur: 0.08, release: 0.12, peak: 0.2 });
}

function sfxCutin(ctx: AudioContext, t: number, vol: number): void {
  noise(ctx, vol, { startTime: t, attack: 0.005, sustainDur: 0.1, release: 0.06, peak: 0.28, filterType: 'bandpass', filterFreq: 300, filterFreqEnd: 4000, q: 0.6 });
}

function sfxRound(ctx: AudioContext, t: number, vol: number): void {
  tone(ctx, vol, { type: 'sawtooth', freq: 440, startTime: t, attack: 0.004, sustainDur: 0.08, release: 0.1, peak: 0.2 });
  tone(ctx, vol, { type: 'sawtooth', freq: 587, startTime: t, attack: 0.004, sustainDur: 0.08, release: 0.12, peak: 0.18 });
}

function sfxFinisher(ctx: AudioContext, t: number, vol: number): void {
  tone(ctx, vol, { type: 'sawtooth', freq: 300, freqEnd: 1200, startTime: t, attack: 0.02, sustainDur: 0.28, release: 0.05, peak: 0.26 });
  const impactT = t + 0.32;
  noise(ctx, vol, { startTime: impactT, attack: 0.003, sustainDur: 0.1, release: 0.35, peak: 0.5, filterType: 'lowpass', filterFreq: 3500, filterFreqEnd: 100 });
  tone(ctx, vol, { type: 'sine', freq: 65, startTime: impactT, attack: 0.005, sustainDur: 0.15, release: 0.3, peak: 0.35 });
}

function sfxRout(ctx: AudioContext, t: number, vol: number): void {
  const freqs = [440, 349.2, 293.7]; // descending minor-ish
  freqs.forEach((f, i) => {
    tone(ctx, vol, { type: 'triangle', freq: f, startTime: t + i * 0.14, attack: 0.005, sustainDur: 0.1, release: 0.14, peak: 0.2 });
  });
}

function sfxVictory(ctx: AudioContext, t: number, vol: number): void {
  // Major fanfare, ~1.2s: ascending triad stabs + a held final chord.
  const stabs = [523.3, 659.3, 784.0]; // C5 E5 G5
  stabs.forEach((f, i) => {
    const t0 = t + i * 0.16;
    tone(ctx, vol, { type: 'sawtooth', freq: f, detune: -6, startTime: t0, attack: 0.006, sustainDur: 0.1, release: 0.08, peak: 0.22 });
    tone(ctx, vol, { type: 'sawtooth', freq: f, detune: 6, startTime: t0, attack: 0.006, sustainDur: 0.1, release: 0.08, peak: 0.2 });
  });
  const chordT = t + 0.5;
  [523.3, 659.3, 784.0, 1046.6].forEach((f) => {
    tone(ctx, vol, { type: 'sawtooth', freq: f, startTime: chordT, attack: 0.01, sustainDur: 0.4, release: 0.3, peak: 0.16 });
  });
}

function sfxDefeat(ctx: AudioContext, t: number, vol: number): void {
  // Minor, slower, lower, ~1.2s.
  const notes = [349.2, 293.7, 246.9]; // F4 D4 B3-ish descending
  notes.forEach((f, i) => {
    const t0 = t + i * 0.28;
    tone(ctx, vol, { type: 'sawtooth', freq: f, startTime: t0, attack: 0.02, sustainDur: 0.22, release: 0.25, peak: 0.22 });
  });
  tone(ctx, vol, { type: 'sine', freq: 110, startTime: t, attack: 0.05, sustainDur: 0.7, release: 0.4, peak: 0.2 });
}

function sfxAlert(ctx: AudioContext, t: number, vol: number): void {
  tone(ctx, vol, { type: 'square', freq: 880, startTime: t, attack: 0.003, sustainDur: 0.06, release: 0.04, peak: 0.16 });
  tone(ctx, vol, { type: 'square', freq: 660, startTime: t + 0.12, attack: 0.003, sustainDur: 0.06, release: 0.04, peak: 0.16 });
}

function sfxDeploy(ctx: AudioContext, t: number, vol: number): void {
  // Thruster ignition: rising filtered noise sweep.
  noise(ctx, vol, { startTime: t, attack: 0.05, sustainDur: 0.25, release: 0.2, peak: 0.26, filterType: 'bandpass', filterFreq: 150, filterFreqEnd: 1600, q: 0.5 });
  tone(ctx, vol, { type: 'sawtooth', freq: 80, freqEnd: 220, startTime: t, attack: 0.05, sustainDur: 0.25, release: 0.15, peak: 0.16 });
}

function sfxObjective(ctx: AudioContext, t: number, vol: number): void {
  // Bright confirm arpeggio.
  const freqs = [523.3, 659.3, 784.0, 1046.6];
  freqs.forEach((f, i) => {
    tone(ctx, vol, { type: 'square', freq: f, startTime: t + i * 0.05, attack: 0.003, sustainDur: 0.06, release: 0.08, peak: 0.16 });
  });
}

// ── Dispatch table ───────────────────────────────────────────────────────

function dispatch(name: SfxName, ctx: AudioContext, t: number, vol: number): void {
  switch (name) {
    case 'burst': return sfxBurst(ctx, t, vol);
    case 'beam': return sfxBeam(ctx, t, vol);
    case 'rail': return sfxRail(ctx, t, vol);
    case 'missiles': return sfxMissiles(ctx, t, vol);
    case 'flak': return sfxFlak(ctx, t, vol);
    case 'lunge': return sfxLungeSlash(ctx, t, vol);
    case 'slash': return sfxLungeSlash(ctx, t, vol);
    case 'maul': return sfxMaul(ctx, t, vol);
    case 'repair': return sfxRepair(ctx, t, vol);
    case 'hit': return sfxHit(ctx, t, vol);
    case 'crit': return sfxCrit(ctx, t, vol);
    case 'miss': return sfxMiss(ctx, t, vol);
    case 'shield': return sfxShield(ctx, t, vol);
    case 'explosion': return sfxExplosion(ctx, t, vol);
    case 'eject': return sfxEject(ctx, t, vol);
    case 'pilot_lost': return sfxPilotLost(ctx, t, vol);
    case 'ui_click': return sfxUiClick(ctx, t, vol);
    case 'ui_confirm': return sfxUiConfirm(ctx, t, vol);
    case 'ui_back': return sfxUiBack(ctx, t, vol);
    case 'callout': return sfxCallout(ctx, t, vol);
    case 'cutin': return sfxCutin(ctx, t, vol);
    case 'round': return sfxRound(ctx, t, vol);
    case 'finisher': return sfxFinisher(ctx, t, vol);
    case 'rout': return sfxRout(ctx, t, vol);
    case 'victory': return sfxVictory(ctx, t, vol);
    case 'defeat': return sfxDefeat(ctx, t, vol);
    case 'alert': return sfxAlert(ctx, t, vol);
    case 'deploy': return sfxDeploy(ctx, t, vol);
    case 'objective': return sfxObjective(ctx, t, vol);
  }
}

/** The animKey values WeaponDef actually uses (@sim/types) that map
 *  1:1 onto weapon-fire SfxNames. */
const WEAPON_ANIM_KEYS: ReadonlySet<string> = new Set(['lunge', 'slash', 'burst', 'beam', 'missiles', 'rail', 'flak', 'repair', 'maul']);

function isWeaponSfxName(key: string): key is SfxName {
  return WEAPON_ANIM_KEYS.has(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Synthesize and play a short SFX by name. Respects the sfx volume set via
 *  setSfxVolume(); no-op if muted, disabled, or no AudioContext (Node,
 *  or a browser that refuses to construct one). Never throws. */
export function playSfx(name: SfxName): void {
  if (!sfxVolume || sfxVolume <= 0 || !isOperating()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    dispatch(name, ctx, ctx.currentTime, sfxVolume);
  } catch {
    // AudioContext unavailable or node construction failed; silent no-op.
  }
}

/**
 * Translate one battle event into its SFX. Multiple sounds from a single
 * event (weapon fire + each hit's outcome) are staggered ~60ms apart on
 * the AudioContext clock so they read as a sequence, not a chord.
 * No-op in Node / when SFX is muted. Never throws.
 */
export function playBattleSfx(e: BattleEvent, data: GameData): void {
  if (!sfxVolume || sfxVolume <= 0 || !isOperating()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    switch (e.t) {
      case 'attack': {
        const animKey = data.weapons[e.weaponId]?.animKey;
        if (animKey && isWeaponSfxName(animKey)) {
          dispatch(animKey, ctx, t0, sfxVolume);
        }
        e.hits.forEach((h, i) => {
          const hitTime = t0 + 0.06 * (i + 1);
          const name: SfxName = h.crit ? 'crit' : h.hit ? 'hit' : 'miss';
          dispatch(name, ctx, hitTime, sfxVolume);
        });
        if (e.killed) {
          dispatch('explosion', ctx, t0 + 0.06 * (e.hits.length + 1) + 0.05, sfxVolume);
        }
        break;
      }
      case 'repair':
        dispatch('repair', ctx, t0, sfxVolume);
        break;
      case 'shield':
        dispatch('shield', ctx, t0, sfxVolume);
        break;
      case 'intercept':
        dispatch('hit', ctx, t0, sfxVolume);
        break;
      case 'destroyed':
        dispatch(e.pilotDied ? 'pilot_lost' : 'eject', ctx, t0, sfxVolume);
        break;
      case 'cutin':
        dispatch('cutin', ctx, t0, sfxVolume);
        break;
      case 'callout':
        dispatch('callout', ctx, t0, sfxVolume);
        break;
      case 'finisher':
        dispatch('finisher', ctx, t0, sfxVolume);
        break;
      case 'round':
        dispatch('round', ctx, t0, sfxVolume);
        break;
      case 'rout':
        dispatch('rout', ctx, t0, sfxVolume);
        break;
      case 'end':
        dispatch(e.winner === 'A' ? 'victory' : 'defeat', ctx, t0, sfxVolume);
        break;
      // 'start', 'last_transmission', 'morale': no sound.
      default:
        break;
    }
  } catch {
    // Silent no-op; never throw from a sim event handler.
  }
}

/**
 * Translate one world (overworld map) event into its SFX. No-op in Node /
 * when SFX is muted. Never throws.
 */
export function playMapSfx(e: WorldEvent): void {
  if (!sfxVolume || sfxVolume <= 0 || !isOperating()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    switch (e.t) {
      case 'deployed':
        dispatch('deploy', ctx, t0, sfxVolume);
        break;
      case 'contact':
        dispatch('alert', ctx, t0, sfxVolume);
        break;
      case 'objective':
        if (e.status === 'complete') dispatch('objective', ctx, t0, sfxVolume);
        else if (e.status === 'failed') dispatch('defeat', ctx, t0, sfxVolume);
        break;
      case 'callout':
        dispatch('callout', ctx, t0, sfxVolume);
        break;
      case 'squad_destroyed':
        dispatch('explosion', ctx, t0, sfxVolume);
        break;
      case 'carrier_hit':
        dispatch('hit', ctx, t0, sfxVolume);
        break;
      // 'battle_resolved', 'last_transmission', 'squad_docked', 'spawn',
      // 'captain', 'map_end': no sound.
      default:
        break;
    }
  } catch {
    // Silent no-op; never throw from a sim event handler.
  }
}
