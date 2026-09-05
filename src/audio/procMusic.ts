/**
 * Procedural WebAudio music generator.
 *
 * Tonight there are no composed/licensed tracks under public/audio/music/,
 * so index.ts's playMusic() falls back to this: a small, deterministic,
 * loopable "orchestral-ish" synth built entirely from oscillators, noise,
 * and envelopes. No samples, no external libs. It's a tasteful stand-in
 * for the orchestral-heroic direction in GDD.md §8, not a final score.
 *
 * Design notes (why, not what):
 *
 * - `buildPatch()` is pure and has no AudioContext dependency, so it's
 *   unit-testable in Node. It composes each track's progression/motif with
 *   a tiny seeded LCG (keyed on the track name) rather than Math.random,
 *   so the same track always gets the same phrase -- "generative" doesn't
 *   have to mean "different every time," and determinism is what makes it
 *   testable at all. (Textural noise -- hi-hat ticks, drum bursts -- still
 *   uses Math.random for its waveform; that's timbre, not composition, and
 *   doesn't affect reproducibility of *what* plays *when*.)
 * - `ProceduralMusicPlayer` implements the same tiny play/fade/volume/stop
 *   surface Howler gives index.ts, so playMusic() can crossfade between a
 *   real Howl and a procedural generator without knowing which one it's
 *   holding -- the existing duckMusic()/updateAudioSettings() code in
 *   index.ts needs no changes at all.
 * - Scheduling uses a classic lookahead pattern (setInterval polls ~100ms,
 *   schedules audio events ~300ms ahead on the AudioContext clock) so
 *   timing survives tab throttling/GC pauses instead of drifting like a
 *   naive setTimeout-per-note approach would.
 * - Kept deliberately quiet: everything routes through one lowpass +
 *   compressor + final gain chain per generator instance, gain-staged so
 *   the ceiling sits comfortably at/under -18dBFS before the music volume
 *   slider even applies. This is ambience under SFX and voice.
 */

export type MusicTrack = 'title' | 'map_space' | 'map_surface' | 'battle' | 'boss' | 'result';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic patch composition (pure; no AudioContext; unit-testable)
// ─────────────────────────────────────────────────────────────────────────────

/** Diatonic modes used across tracks, as semitone offsets from the root. */
const SCALES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10], // natural minor
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11], // ionian
} as const;

type ScaleName = keyof typeof SCALES;

export interface MusicPatch {
  track: MusicTrack;
  tempoBpm: number;
  rootMidi: number; // MIDI note number for scale degree 0
  scale: readonly number[]; // semitone offsets, length 7
  scaleName: ScaleName;
  chordBars: number; // bars held per chord in the progression
  progression: number[]; // scale-degree indices (0-6), one per chord
  motif: number[]; // scale-degree indices (0-6), the fixed lead phrase
  motifEveryBars: number; // how often (in bars) the motif phrase fires
  leadWave: 'triangle' | 'brass';
  hasPulseDrum: boolean; // battle/boss: low thump + noise burst on beats 1 & 3
  hasHihat: boolean; // battle/boss: quiet filtered-noise tick on every 8th
  padDetuneCents: number;
}

interface BaseConfig {
  tempoBpm: number;
  rootMidi: number;
  scaleName: ScaleName;
  chordBars: number;
  progression: number[];
  motifEveryBars: number;
  motifLength: number;
  leadWave: 'triangle' | 'brass';
  hasPulseDrum: boolean;
  hasHihat: boolean;
  padDetuneCents: number;
}

// Roman-numeral progressions are written here as 0-based scale-degree
// indices into the mode above (e.g. minor i-VI-III-VII -> [0, 5, 2, 6]).
const BASE_CONFIG: Record<MusicTrack, BaseConfig> = {
  title: {
    tempoBpm: 72,
    rootMidi: 52, // E3 -- sparse pad, barely a theme yet
    scaleName: 'dorian',
    chordBars: 4,
    progression: [0, 5], // i - VI, slow two-chord sway
    motifEveryBars: 8,
    motifLength: 8,
    leadWave: 'triangle',
    hasPulseDrum: false,
    hasHihat: false,
    padDetuneCents: 6,
  },
  map_space: {
    tempoBpm: 84,
    rootMidi: 57, // A3
    scaleName: 'aeolian',
    chordBars: 4,
    progression: [0, 5, 2, 6], // i - VI - III - VII
    motifEveryBars: 8,
    motifLength: 10,
    leadWave: 'triangle',
    hasPulseDrum: false,
    hasHihat: false,
    padDetuneCents: 8,
  },
  map_surface: {
    tempoBpm: 96,
    rootMidi: 50, // D3
    scaleName: 'dorian',
    chordBars: 3,
    progression: [0, 3, 4, 3], // i - iv - v - iv; dorian's raised 6th warms it up
    motifEveryBars: 6,
    motifLength: 10,
    leadWave: 'triangle',
    hasPulseDrum: false,
    hasHihat: false,
    padDetuneCents: 7,
  },
  battle: {
    tempoBpm: 138,
    rootMidi: 45, // A2 -- driving, mid-low
    scaleName: 'aeolian',
    chordBars: 2,
    progression: [0, 6, 5, 6], // i - VII - VI - VII
    motifEveryBars: 4,
    motifLength: 12,
    leadWave: 'triangle',
    hasPulseDrum: true,
    hasHihat: true,
    padDetuneCents: 10,
  },
  boss: {
    tempoBpm: 118,
    rootMidi: 38, // D2 -- low and ominous
    scaleName: 'aeolian',
    chordBars: 4,
    progression: [0, 1, 0, 6], // droning i, tense ii-ish neighbor, i, VII
    motifEveryBars: 4,
    motifLength: 12,
    leadWave: 'brass',
    hasPulseDrum: true,
    hasHihat: true,
    padDetuneCents: 14,
  },
  result: {
    tempoBpm: 100,
    rootMidi: 60, // C4 -- warm, resolved
    scaleName: 'major',
    chordBars: 4,
    progression: [0, 4, 5, 3], // I - V - vi - IV
    motifEveryBars: 8,
    motifLength: 8,
    leadWave: 'triangle',
    hasPulseDrum: false,
    hasHihat: false,
    padDetuneCents: 5,
  },
};

/** Tiny deterministic PRNG (mulberry32-style), seeded from a string. Used
 *  only to *compose* a fixed patch once -- never called during playback,
 *  so it doesn't affect the lookahead scheduler's timing determinism. */
function makeLcg(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the fixed patch (progression + motif + instrumentation) for a
 * track. Pure and deterministic: same track in, same patch out, every
 * time, in any environment (including Node -- no AudioContext needed).
 */
export function buildPatch(track: MusicTrack): MusicPatch {
  const cfg = BASE_CONFIG[track];
  const scale = SCALES[cfg.scaleName];
  const rand = makeLcg(`cordon-music:${track}`);

  // Walk a small pitch contour so the motif reads as a phrase rather than
  // a random note list: mostly stepwise motion, occasional leap, always
  // wrapped back into the diatonic scale (0..6).
  const motif: number[] = [];
  let degree = 0;
  for (let i = 0; i < cfg.motifLength; i++) {
    const idx = ((degree % scale.length) + scale.length) % scale.length;
    motif.push(idx);
    const roll = rand();
    const sign = rand() < 0.5 ? 1 : -1;
    const size = roll < 0.55 ? 1 : roll < 0.85 ? 2 : 3;
    degree += sign * size;
  }

  return {
    track,
    tempoBpm: cfg.tempoBpm,
    rootMidi: cfg.rootMidi,
    scale,
    scaleName: cfg.scaleName,
    chordBars: cfg.chordBars,
    progression: cfg.progression,
    motif,
    motifEveryBars: cfg.motifEveryBars,
    leadWave: cfg.leadWave,
    hasPulseDrum: cfg.hasPulseDrum,
    hasHihat: cfg.hasHihat,
    padDetuneCents: cfg.padDetuneCents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pitch helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Scale degree (any integer, including >6 or negative) to a MIDI note,
 *  wrapping into octaves. `octaveOffset` shifts by whole octaves on top. */
function degreeToMidi(patch: MusicPatch, degree: number, octaveOffset: number): number {
  const len = patch.scale.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return patch.rootMidi + patch.scale[idx] + 12 * (oct + octaveOffset);
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// Playback
// ─────────────────────────────────────────────────────────────────────────────

/** Ceiling applied at each generator's final gain node: ~-17.7dBFS, so the
 *  synth stays well under -18dBFS even at full music-volume setting. The
 *  compressor upstream further evens out the pad/bass/drum/lead mix before
 *  this ceiling is applied. */
const PEAK_LINEAR = 0.13;

/** The slice of Howler's Howl API that index.ts actually uses. Implementing
 *  this lets playMusic() crossfade a real Howl and a ProceduralMusicPlayer
 *  through identical code. */
export interface MusicHandle {
  play(): void;
  fade(from: number, to: number, durationMs: number): void;
  volume(v?: number): number;
  stop(): void;
  readonly isProcedural: true;
}

/** Create (but do not start) a procedural generator for `track` on `ctx`. */
export function createProceduralMusic(ctx: AudioContext, track: MusicTrack): MusicHandle {
  return new ProceduralMusicPlayer(ctx, buildPatch(track));
}

interface ToneOpts {
  type: OscillatorType;
  freq: number;
  detuneCents?: number;
  startTime: number;
  attack: number;
  sustainDur: number;
  release: number;
  peak: number;
  /** If set, the oscillator starts at this frequency and glides to `freq`
   *  (a cheap portamento stand-in -- new oscillator per note, but the
   *  audible glide reads the same as a held one bending pitch). */
  glideFrom?: number;
}

interface NoiseOpts {
  startTime: number;
  attack: number;
  sustainDur: number;
  release: number;
  peak: number;
  filterType: BiquadFilterType;
  filterFreq: number;
}

class ProceduralMusicPlayer implements MusicHandle {
  readonly isProcedural = true as const;

  private ctx: AudioContext;
  private patch: MusicPatch;

  // Master chain for this instance: voices -> lowpass -> compressor -> gain.
  // Each generator owns its own chain (rather than sharing one across the
  // module) so two instances can crossfade independently without stepping
  // on each other's fade envelopes.
  private lowpass: BiquadFilterNode;
  private compressor: DynamicsCompressorNode;
  private gainNode: GainNode;

  // Slow filter LFO ("breathing" pad) -- see spec: "pad ... through a slow
  // filter LFO."
  private lfoOsc: OscillatorNode;
  private lfoGain: GainNode;

  private logicalVolume = 0;
  private activeNodes = new Set<AudioScheduledSourceNode>();
  private noiseBufferCache: AudioBuffer | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private stepIndex = 0;
  private nextStepTime = 0;
  private currentChordIdx = -1;
  private lastLeadFreq = 0;
  private stopped = false;
  private started = false;

  constructor(ctx: AudioContext, patch: MusicPatch) {
    this.ctx = ctx;
    this.patch = patch;

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 4200; // gentle, within the 3-6kHz brief
    this.lowpass.Q.value = 0.4;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.25;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0;

    this.lowpass.connect(this.compressor);
    this.compressor.connect(this.gainNode);
    this.gainNode.connect(ctx.destination);

    // ~0.13Hz sweep, +-700Hz around the 4200Hz center -- slow enough to
    // feel like breath, never fast enough to sound like a wah effect.
    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.type = 'sine';
    this.lfoOsc.frequency.value = 0.13;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 700;
    this.lfoOsc.connect(this.lfoGain);
    this.lfoGain.connect(this.lowpass.frequency);
  }

  // ── MusicHandle interface ────────────────────────────────────────────

  play(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    try {
      this.lfoOsc.start();
    } catch {
      // already started; ignore
    }

    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.stepIndex = 0;
    this.currentChordIdx = -1;

    const scheduleAheadTime = 0.3; // seconds of audio-clock lookahead
    this.timer = setInterval(() => {
      if (this.stopped) return;
      while (this.nextStepTime < this.ctx.currentTime + scheduleAheadTime) {
        this.scheduleStep(this.stepIndex, this.nextStepTime);
        const stepDur = 60 / this.patch.tempoBpm / 2; // one 8th note
        this.nextStepTime += stepDur;
        this.stepIndex++;
      }
    }, 100);
  }

  volume(v?: number): number {
    if (v === undefined) return this.logicalVolume;
    this.logicalVolume = Math.max(0, v);
    const now = this.ctx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.logicalVolume * PEAK_LINEAR, now);
    return this.logicalVolume;
  }

  fade(from: number, to: number, durationMs: number): void {
    const now = this.ctx.currentTime;
    const dur = Math.max(0.001, durationMs / 1000);
    this.logicalVolume = from;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(Math.max(0.0001, from * PEAK_LINEAR), now);
    this.gainNode.gain.linearRampToValueAtTime(Math.max(0, to * PEAK_LINEAR), now + dur);
    // Reflect the fade's destination once it lands, so a later .volume()
    // read (e.g. from duckMusic's next fade) sees the settled value.
    setTimeout(() => {
      this.logicalVolume = to;
    }, durationMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const now = this.ctx.currentTime;
    try {
      this.lfoOsc.stop(now);
    } catch {
      // already stopped; ignore
    }

    for (const node of this.activeNodes) {
      try {
        node.stop(now);
      } catch {
        // already stopped/ended; ignore
      }
      try {
        node.disconnect();
      } catch {
        // already disconnected; ignore
      }
    }
    this.activeNodes.clear();

    try {
      this.lfoGain.disconnect();
      this.lowpass.disconnect();
      this.compressor.disconnect();
      this.gainNode.disconnect();
    } catch {
      // ignore; best-effort teardown
    }
  }

  // ── Scheduling ────────────────────────────────────────────────────────

  private secondsPerBar(): number {
    return (60 / this.patch.tempoBpm) * 4;
  }

  /** Decide what (if anything) fires on 8th-note step `step`, at audio
   *  clock time `t`. 8 steps per bar (4 beats x two 8ths), 4/4 throughout. */
  private scheduleStep(step: number, t: number): void {
    const stepsPerBar = 8;
    const patch = this.patch;
    const bar = Math.floor(step / stepsPerBar);
    const eighth = step % stepsPerBar;

    // Pad: change chords at the top of every `chordBars` bars.
    if (eighth === 0 && bar % patch.chordBars === 0) {
      const chordIdx = Math.floor(bar / patch.chordBars) % patch.progression.length;
      if (chordIdx !== this.currentChordIdx) {
        this.currentChordIdx = chordIdx;
        this.scheduleChordSwell(patch.progression[chordIdx], t, patch.chordBars);
      }
    }

    // Bass/pulse: one sustained root note per bar, on beat 1.
    if (eighth === 0) {
      const rootDegree = patch.progression[this.currentChordIdx < 0 ? 0 : this.currentChordIdx];
      this.scheduleBass(rootDegree, t);
    }

    // Percussive low drum on beats 1 & 3 (battle/boss only).
    if (patch.hasPulseDrum && (eighth === 0 || eighth === 4)) {
      this.scheduleDrumHit(t);
    }

    // Quiet hi-hat-ish tick on every 8th (battle/boss only).
    if (patch.hasHihat) {
      this.scheduleHihat(t, eighth);
    }

    // Lead motif: fires every `motifEveryBars` bars, one note per 8th
    // step, starting on beat 1, until the fixed phrase runs out.
    const motifPeriodSteps = patch.motifEveryBars * stepsPerBar;
    const posInPeriod = step % motifPeriodSteps;
    if (posInPeriod < patch.motif.length) {
      this.scheduleLeadNote(patch.motif[posInPeriod], t, posInPeriod === 0);
    }
  }

  private scheduleChordSwell(rootDegree: number, t: number, bars: number): void {
    const dur = bars * this.secondsPerBar();
    const attack = Math.min(1.4, dur * 0.3);
    const release = Math.min(1.4, dur * 0.3);
    const sustain = Math.max(0.05, dur - attack - release);

    // Diatonic triad: stack thirds within the scale (root, +2, +4 degrees).
    const tones = [rootDegree, rootDegree + 2, rootDegree + 4];
    const waves: OscillatorType[] = ['sawtooth', 'triangle'];

    tones.forEach((deg, i) => {
      const freq = midiToFreq(degreeToMidi(this.patch, deg, 0));
      // Two detuned voices per chord tone (+/- padDetuneCents) for width.
      this.playTone({ type: waves[i % 2], freq, detuneCents: this.patch.padDetuneCents, startTime: t, attack, sustainDur: sustain, release, peak: 0.16 });
      this.playTone({ type: waves[(i + 1) % 2], freq, detuneCents: -this.patch.padDetuneCents, startTime: t, attack, sustainDur: sustain, release, peak: 0.12 });
    });
  }

  private scheduleBass(rootDegree: number, t: number): void {
    const freq = midiToFreq(degreeToMidi(this.patch, rootDegree, -1));
    this.playTone({ type: 'triangle', freq, startTime: t, attack: 0.03, sustainDur: this.secondsPerBar() * 0.75, release: 0.15, peak: 0.32 });
  }

  private scheduleDrumHit(t: number): void {
    // Low sine "thump" plus a short bandpassed noise burst -- a
    // percussive stand-in for a kick/snare pair.
    this.playTone({ type: 'sine', freq: 62, startTime: t, attack: 0.005, sustainDur: 0.05, release: 0.12, peak: 0.5 });
    this.playNoise({ startTime: t, attack: 0.002, sustainDur: 0.03, release: 0.08, peak: 0.22, filterType: 'bandpass', filterFreq: 220 });
  }

  private scheduleHihat(t: number, eighth: number): void {
    // Slightly louder on the downbeats of each pair; kept very quiet overall.
    const peak = eighth % 2 === 0 ? 0.07 : 0.045;
    this.playNoise({ startTime: t, attack: 0.001, sustainDur: 0.01, release: 0.03, peak, filterType: 'highpass', filterFreq: 6000 });
  }

  private scheduleLeadNote(degree: number, t: number, isFirstOfPhrase: boolean): void {
    const patch = this.patch;
    const noteDur = (60 / patch.tempoBpm) * 0.42; // detached ~8th note
    const freq = midiToFreq(degreeToMidi(patch, degree, 1));
    const glideFrom = isFirstOfPhrase ? undefined : this.lastLeadFreq;

    if (patch.leadWave === 'brass') {
      // Brass-like stack for the boss motif: two detuned saws, faster attack.
      this.playTone({ type: 'sawtooth', freq, detuneCents: 6, startTime: t, attack: 0.01, sustainDur: noteDur, release: 0.08, peak: 0.22, glideFrom });
      this.playTone({ type: 'sawtooth', freq, detuneCents: -6, startTime: t, attack: 0.01, sustainDur: noteDur, release: 0.08, peak: 0.2, glideFrom });
    } else {
      this.playTone({ type: 'triangle', freq, startTime: t, attack: 0.02, sustainDur: noteDur, release: 0.12, peak: 0.3, glideFrom });
    }
    this.lastLeadFreq = freq;
  }

  // ── Low-level voice helpers ─────────────────────────────────────────

  private playTone(opts: ToneOpts): void {
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    if (opts.detuneCents) osc.detune.value = opts.detuneCents;

    const g = this.ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(this.lowpass);

    const t0 = opts.startTime;
    if (opts.glideFrom && opts.glideFrom > 0) {
      osc.frequency.setValueAtTime(opts.glideFrom, t0);
      osc.frequency.linearRampToValueAtTime(opts.freq, t0 + Math.min(0.08, opts.attack + 0.02));
    } else {
      osc.frequency.setValueAtTime(opts.freq, t0);
    }

    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.peak, t0 + opts.attack);
    g.gain.setValueAtTime(opts.peak, t0 + opts.attack + opts.sustainDur);
    g.gain.linearRampToValueAtTime(0, t0 + opts.attack + opts.sustainDur + opts.release);

    const stopAt = t0 + opts.attack + opts.sustainDur + opts.release + 0.02;
    osc.start(t0);
    osc.stop(stopAt);
    osc.onended = () => {
      this.activeNodes.delete(osc);
      try {
        g.disconnect();
      } catch {
        // ignore
      }
    };
    this.activeNodes.add(osc);
  }

  private playNoise(opts: NoiseOpts): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer();
    src.loop = true; // loop the 1s buffer; envelope decides audible length

    const filt = this.ctx.createBiquadFilter();
    filt.type = opts.filterType;
    filt.frequency.value = opts.filterFreq;

    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(filt);
    filt.connect(g);
    g.connect(this.lowpass);

    const t0 = opts.startTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.peak, t0 + opts.attack);
    g.gain.linearRampToValueAtTime(0, t0 + opts.attack + opts.sustainDur + opts.release);

    const stopAt = t0 + opts.attack + opts.sustainDur + opts.release + 0.02;
    src.start(t0);
    src.stop(stopAt);
    src.onended = () => {
      this.activeNodes.delete(src);
      try {
        g.disconnect();
        filt.disconnect();
      } catch {
        // ignore
      }
    };
    this.activeNodes.add(src);
  }

  /** One shared 1-second noise buffer per instance, reused (looped) for
   *  every hit/tick. This is texture, not composition -- Math.random here
   *  doesn't affect what notes play when, only what the noise sounds like. */
  private getNoiseBuffer(): AudioBuffer {
    if (!this.noiseBufferCache) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBufferCache = buf;
    }
    return this.noiseBufferCache;
  }
}
