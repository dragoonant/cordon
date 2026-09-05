/**
 * Procedural WebAudio music generator.
 *
 * Tonight there are no composed/licensed tracks under public/audio/music/,
 * so index.ts's playMusic() falls back to this: a small, deterministic,
 * loopable synth built entirely from oscillators, noise, and envelopes.
 * No samples, no external libs.
 *
 * Direction (per GDD.md §8 + explicit feedback): Super Robot Wars energy --
 * UPBEAT, HOPEFUL, HEROIC. Not slow, not gothic. Every track sits at 110+
 * BPM, drives on a real kick/snare/hat kit, and carries a hand-composed
 * 8-bar fanfare lead (dotted rhythms, 4th/5th leaps, rises to the 5th/6th,
 * resolves to the tonic) rather than a generated wander.
 *
 * Design notes (why, not what):
 *
 * - `buildPatch()` is pure and has no AudioContext dependency, so it's
 *   unit-testable in Node. Every track's progression and melody is a fixed,
 *   hand-written array of scale-degree/duration pairs -- "procedural" here
 *   means "synthesized in real time from a data description," not "randomly
 *   generated." The only computed step is `fillMelody()` stretching the
 *   final note of each phrase so the whole thing sums to exactly 8 bars,
 *   which doubles as the "ends on a held note" cadence every track wants.
 * - `ProceduralMusicPlayer` implements the same tiny play/fade/volume/stop
 *   surface Howler gives index.ts, so playMusic() can crossfade between a
 *   real Howl and a procedural generator without knowing which one it's
 *   holding -- the existing duckMusic()/updateAudioSettings() code in
 *   index.ts needs no changes at all.
 * - Scheduling uses a classic lookahead pattern (setInterval polls ~100ms,
 *   schedules audio events ~300ms ahead on the AudioContext clock) so
 *   timing survives tab throttling/GC pauses instead of drifting like a
 *   naive setTimeout-per-note approach would. The grid is 16th notes (16
 *   steps/bar) so the battle/boss 16th-note arpeggio and the hi-hat pattern
 *   both land on real subdivisions.
 * - Kept deliberately under the mix ceiling: everything routes through one
 *   lowpass + compressor + final gain chain per generator instance, gain-
 *   staged so the ceiling sits at ~-12dBFS before the music volume slider
 *   even applies -- present but still under SFX and voice.
 */

export type MusicTrack = 'title' | 'map_space' | 'map_surface' | 'battle' | 'boss' | 'result';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic patch composition (pure; no AudioContext; unit-testable)
// ─────────────────────────────────────────────────────────────────────────────

/** Diatonic modes used across tracks, as semitone offsets from the root. */
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], // ionian
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10], // natural minor
} as const;

type ScaleName = keyof typeof SCALES;

/** One note of a hand-composed melody. `degree` is a scale-degree index
 *  (0 = tonic, 4 = the 5th, 7 = the octave, etc. -- see degreeToMidi);
 *  `null` is a rest. `dur` is in 16th-note units. */
export interface MelodyNote {
  degree: number | null;
  dur: number;
}

export interface MusicPatch {
  track: MusicTrack;
  tempoBpm: number;
  rootMidi: number; // MIDI note number for scale degree 0
  scale: readonly number[]; // semitone offsets, length 7
  scaleName: ScaleName;
  chordBars: number; // bars held per chord in the progression
  progression: number[]; // scale-degree indices, one per chord; loops over chordBars*length bars (== 8)
  melody: MelodyNote[]; // hand-composed 8-bar (128 sixteenth-note) lead phrase
  hasDrums: boolean; // kick/snare/hats/fill; everything except title/result
  hasPickup: boolean; // 8th-note kick pickup before beat 1 (battle/boss)
  hasCrash: boolean; // long noise crash on bar 1 of the loop (battle/boss)
  drivingBass: boolean; // 8th-note root-root-fifth-root saw bass (battle/boss) vs quarter-note pulse (others)
  hasArp: boolean; // square-wave arpeggio layer on chord tones (maps/battle/boss)
  arpDivision: 8 | 16; // arp notes per bar: 8ths on maps, 16ths on battle/boss
  padDetuneCents: number;
  bigFinalChord: boolean; // result: last chord of the loop swells bigger & longer
}

interface BaseConfig {
  tempoBpm: number;
  rootMidi: number;
  scaleName: ScaleName;
  chordBars: number;
  progression: number[];
  melody: [number | null, number][]; // [degree, dur] pairs, pre-normalization
  hasDrums: boolean;
  hasPickup: boolean;
  hasCrash: boolean;
  drivingBass: boolean;
  hasArp: boolean;
  arpDivision: 8 | 16;
  padDetuneCents: number;
  bigFinalChord: boolean;
}

const LOOP_SIXTEENTHS = 128; // 8 bars * 16 sixteenth-notes/bar

/** Stretch (or trim) the final note of a hand-written phrase so the whole
 *  thing sums to exactly one 8-bar loop -- formalizes "hold the last note
 *  out to the cadence," which every fanfare here wants anyway. */
function fillMelody(notes: [number | null, number][]): MelodyNote[] {
  const out: MelodyNote[] = notes.map(([degree, dur]) => ({ degree, dur }));
  const sumButLast = out.slice(0, -1).reduce((s, n) => s + n.dur, 0);
  const last = out[out.length - 1];
  last.dur = Math.max(1, LOOP_SIXTEENTHS - sumButLast);
  return out;
}

// Roman-numeral progressions are written here as 0-based scale-degree
// indices into the mode above (e.g. minor i-VI-VII -> [0, 5, 6]).
// chordBars * progression.length is always 8 (one loop).
const BASE_CONFIG: Record<MusicTrack, BaseConfig> = {
  title: {
    tempoBpm: 112,
    rootMidi: 60, // C4 -- warm, hopeful, the main theme
    scaleName: 'major',
    chordBars: 2,
    progression: [0, 3, 4, 3], // I - IV - V - IV
    melody: [
      [0, 4], [2, 2], [4, 2], [7, 6], [6, 2], [4, 4], [2, 4], [0, 4],
      [0, 2], [2, 2], [4, 4], [5, 4], [7, 6], [9, 2], [7, 4], [5, 4], [4, 4],
      [2, 4], [4, 2], [5, 2], [7, 4], [6, 2], [4, 2], [2, 4], [0, 8],
    ],
    hasDrums: false,
    hasPickup: false,
    hasCrash: false,
    drivingBass: false,
    hasArp: false,
    arpDivision: 8,
    padDetuneCents: 6,
    bigFinalChord: false,
  },
  map_surface: {
    tempoBpm: 128,
    rootMidi: 57, // A3
    scaleName: 'mixolydian',
    chordBars: 2,
    progression: [0, 3, 4, 3], // I - IV - V - IV
    melody: [
      [null, 2], [0, 2], [0, 2], [4, 2], [7, 4], [6, 2], [4, 2], [2, 2], [0, 4],
      [null, 2], [4, 2], [4, 2], [7, 2], [9, 2], [7, 4], [5, 2], [4, 2], [2, 4],
      [0, 2], [2, 2], [4, 2], [6, 2], [7, 6], [6, 2], [4, 2], [0, 8],
    ],
    hasDrums: true,
    hasPickup: false,
    hasCrash: false,
    drivingBass: false,
    hasArp: true,
    arpDivision: 8,
    padDetuneCents: 7,
    bigFinalChord: false,
  },
  map_space: {
    tempoBpm: 124,
    rootMidi: 55, // G3
    scaleName: 'mixolydian',
    chordBars: 2,
    progression: [0, 5, 3, 4], // I - vi - IV - V
    melody: [
      [0, 6], [4, 2], [7, 4], [9, 4], [7, 6], [5, 2], [4, 4],
      [2, 4], [4, 4], [6, 4], [7, 6], [6, 2], [4, 4], [2, 4], [0, 4],
      [4, 2], [5, 2], [7, 2], [9, 2], [7, 4], [4, 4], [2, 4], [0, 10],
    ],
    hasDrums: true,
    hasPickup: false,
    hasCrash: false,
    drivingBass: false,
    hasArp: true,
    arpDivision: 8,
    padDetuneCents: 8,
    bigFinalChord: false,
  },
  battle: {
    tempoBpm: 152,
    rootMidi: 45, // A2 -- driving, mid-low
    scaleName: 'mixolydian',
    chordBars: 2,
    progression: [0, 4, 5, 3], // I - V - vi - IV
    melody: [
      [null, 1], [7, 1], [0, 3], [4, 1], [7, 4], [6, 2], [4, 2], [2, 2], [0, 2],
      [null, 1], [4, 1], [5, 3], [7, 1], [9, 4], [7, 2], [6, 2], [4, 2], [2, 2],
      [0, 3], [4, 1], [7, 2], [6, 2], [4, 2], [2, 2], [0, 2], [2, 2], [4, 2],
      [7, 3], [9, 1], [7, 2], [4, 2], [0, 8],
    ],
    hasDrums: true,
    hasPickup: true,
    hasCrash: true,
    drivingBass: true,
    hasArp: true,
    arpDivision: 16,
    padDetuneCents: 10,
    bigFinalChord: false,
  },
  boss: {
    tempoBpm: 160,
    rootMidi: 40, // E2 -- low, driving, minor
    scaleName: 'aeolian',
    chordBars: 2,
    progression: [0, 5, 6, 0], // i - bVI - bVII - i
    melody: [
      [null, 1], [0, 3], [0, 1], [5, 2], [6, 2], [7, 4], [6, 2], [5, 2], [3, 2], [0, 2],
      [null, 1], [0, 3], [0, 1], [6, 2], [5, 2], [3, 4], [2, 2], [0, 2],
      [5, 2], [6, 2], [7, 4], [9, 4], [7, 2], [6, 2], [5, 2], [3, 2], [0, 8],
    ],
    hasDrums: true,
    hasPickup: true,
    hasCrash: true,
    drivingBass: true,
    hasArp: true,
    arpDivision: 16,
    padDetuneCents: 12,
    bigFinalChord: false,
  },
  result: {
    tempoBpm: 120,
    rootMidi: 60, // C4 -- warm, resolved, triumphant
    scaleName: 'major',
    chordBars: 2,
    progression: [0, 4, 3, 0], // I - V - IV - I
    melody: [
      [7, 4], [9, 4], [7, 4], [5, 4], [4, 6], [2, 2], [0, 8],
      [0, 4], [2, 4], [4, 4], [5, 4], [7, 6], [6, 2], [4, 4], [2, 4],
      [0, 4], [2, 4], [4, 4], [7, 6], [9, 2], [7, 4], [5, 4], [4, 4], [2, 4], [0, 16],
    ],
    hasDrums: false,
    hasPickup: false,
    hasCrash: false,
    drivingBass: false,
    hasArp: false,
    arpDivision: 8,
    padDetuneCents: 5,
    bigFinalChord: true, // ends on a held big chord
  },
};

/**
 * Build the fixed patch (progression + melody + instrumentation) for a
 * track. Pure and deterministic: same track in, same patch out, every
 * time, in any environment (including Node -- no AudioContext needed).
 */
export function buildPatch(track: MusicTrack): MusicPatch {
  const cfg = BASE_CONFIG[track];
  const scale = SCALES[cfg.scaleName];

  return {
    track,
    tempoBpm: cfg.tempoBpm,
    rootMidi: cfg.rootMidi,
    scale,
    scaleName: cfg.scaleName,
    chordBars: cfg.chordBars,
    progression: cfg.progression,
    melody: fillMelody(cfg.melody),
    hasDrums: cfg.hasDrums,
    hasPickup: cfg.hasPickup,
    hasCrash: cfg.hasCrash,
    drivingBass: cfg.drivingBass,
    hasArp: cfg.hasArp,
    arpDivision: cfg.arpDivision,
    padDetuneCents: cfg.padDetuneCents,
    bigFinalChord: cfg.bigFinalChord,
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

/** Ceiling applied at each generator's final gain node: ~-12dBFS. */
const PEAK_LINEAR = 0.25;

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

  // Slow filter LFO ("breathing" pad).
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
  private arpCounter = 0;
  private stopped = false;
  private started = false;

  // Precomputed melody schedule: sixteenth-step offset (within the 128-step
  // loop) -> note. Built once from patch.melody's cumulative durations.
  private melodySteps: { step: number; note: MelodyNote }[] = [];

  constructor(ctx: AudioContext, patch: MusicPatch) {
    this.ctx = ctx;
    this.patch = patch;

    let cursor = 0;
    for (const note of patch.melody) {
      this.melodySteps.push({ step: cursor, note });
      cursor += note.dur;
    }

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 4800; // bright enough for saw brass to cut through
    this.lowpass.Q.value = 0.4;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.2;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0;

    this.lowpass.connect(this.compressor);
    this.compressor.connect(this.gainNode);
    this.gainNode.connect(ctx.destination);

    // ~0.15Hz sweep, +-900Hz around the 4800Hz center -- slow breathing on
    // the whole mix so the drive doesn't feel static.
    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.type = 'sine';
    this.lfoOsc.frequency.value = 0.15;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 900;
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
        const stepDur = 60 / this.patch.tempoBpm / 4; // one 16th note
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

  private secondsPerSixteenth(): number {
    return 60 / this.patch.tempoBpm / 4;
  }

  /** Decide what (if anything) fires on 16th-note step `step`, at audio
   *  clock time `t`. 16 steps per bar, 128 steps (8 bars) per loop, 4/4
   *  throughout. */
  private scheduleStep(step: number, t: number): void {
    const patch = this.patch;
    const stepsPerBar = 16;
    const posInLoop = step % LOOP_SIXTEENTHS;
    const loopBar = Math.floor(posInLoop / stepsPerBar); // 0..7
    const sixteenth = posInLoop % stepsPerBar; // 0..15

    // Pad: change chords at the top of every `chordBars` bars.
    if (sixteenth === 0 && loopBar % patch.chordBars === 0) {
      const chordIdx = Math.floor(loopBar / patch.chordBars) % patch.progression.length;
      if (chordIdx !== this.currentChordIdx) {
        this.currentChordIdx = chordIdx;
        const isFinal = patch.bigFinalChord && chordIdx === patch.progression.length - 1;
        this.scheduleChordSwell(patch.progression[chordIdx], t, patch.chordBars, isFinal);
      }
    }
    const chordRoot = patch.progression[this.currentChordIdx < 0 ? 0 : this.currentChordIdx];

    // Bass: driving 8th-note root-root-fifth-root (battle/boss) or a
    // gentler quarter-note pulse (everything else).
    if (patch.drivingBass) {
      if (sixteenth % 2 === 0) {
        const eighthIdx = (sixteenth / 2) % 4;
        const bassDegree = eighthIdx === 2 ? chordRoot + 4 : chordRoot; // root-root-fifth-root
        this.scheduleDrivingBass(bassDegree, t);
      }
    } else if (sixteenth % 4 === 0) {
      this.scheduleBassPulse(chordRoot, t);
    }

    if (patch.hasDrums) {
      // Kick on 1 & 3, plus an 8th pickup into beat 1 (battle/boss).
      if (sixteenth === 0 || sixteenth === 8) this.scheduleKick(t);
      if (patch.hasPickup && sixteenth === 14) this.scheduleKick(t, 0.7);

      // Snare on 2 & 4.
      if (sixteenth === 4 || sixteenth === 12) this.scheduleSnare(t, 1);

      // Closed hat on every 8th, open hat on the "and" of 4 every 2 bars.
      const isOpenHatSlot = sixteenth === 14 && loopBar % 2 === 1;
      if (isOpenHatSlot) {
        this.scheduleOpenHat(t);
      } else if (sixteenth % 2 === 0) {
        this.scheduleClosedHat(t, sixteenth);
      }

      // Snare-roll fill building into the top of the next 8-bar loop.
      if (loopBar === 7 && sixteenth >= 12) {
        this.scheduleSnare(t, 0.5 + (sixteenth - 12) * 0.18);
      }

      // Crash on bar 1 of the loop (battle/boss only).
      if (patch.hasCrash && posInLoop === 0) {
        this.scheduleCrash(t);
      }
    }

    // Arpeggio: square-wave sparkle on chord tones (maps/battle/boss).
    if (patch.hasArp) {
      const arpStepSize = 16 / patch.arpDivision; // steps between arp notes
      if (sixteenth % arpStepSize === 0) {
        const arpTones = [chordRoot, chordRoot + 2, chordRoot + 4, chordRoot + 7];
        const arpDegree = arpTones[this.arpCounter % arpTones.length];
        this.arpCounter++;
        this.scheduleArpNote(arpDegree, t);
      }
    }

    // Lead melody: hand-composed 8-bar phrase, looping every 128 steps.
    const hit = this.melodySteps.find((m) => m.step === posInLoop);
    if (hit && hit.note.degree !== null) {
      this.scheduleLeadNote(hit.note.degree, hit.note.dur, t);
    }
  }

  private scheduleChordSwell(rootDegree: number, t: number, bars: number, big: boolean): void {
    const dur = (big ? bars * 1.6 : bars) * this.secondsPerBar();
    // Quicker attack than a slow pad swell so the chord change punches on
    // the downbeat instead of fading in behind it.
    const attack = Math.min(0.18, dur * 0.12);
    const release = Math.min(1.2, dur * 0.3);
    const sustain = Math.max(0.05, dur - attack - release);
    const peak = big ? 0.2 : 0.15;

    // Diatonic triad: stack thirds within the scale (root, +2, +4 degrees).
    const tones = big ? [rootDegree, rootDegree + 2, rootDegree + 4, rootDegree + 7] : [rootDegree, rootDegree + 2, rootDegree + 4];
    const waves: OscillatorType[] = ['sawtooth', 'triangle'];

    tones.forEach((deg, i) => {
      const freq = midiToFreq(degreeToMidi(this.patch, deg, 0));
      // Two detuned voices per chord tone (+/- padDetuneCents) for width.
      this.playTone({ type: waves[i % 2], freq, detuneCents: this.patch.padDetuneCents, startTime: t, attack, sustainDur: sustain, release, peak });
      this.playTone({ type: waves[(i + 1) % 2], freq, detuneCents: -this.patch.padDetuneCents, startTime: t, attack, sustainDur: sustain, release, peak: peak * 0.75 });
    });
  }

  private scheduleDrivingBass(degree: number, t: number): void {
    // Saw through the shared lowpass with a fast per-note decay so the
    // bass "pumps" on every 8th instead of droning.
    const freq = midiToFreq(degreeToMidi(this.patch, degree, -1));
    this.playTone({ type: 'sawtooth', freq, startTime: t, attack: 0.004, sustainDur: 0.05, release: 0.1, peak: 0.3 });
  }

  private scheduleBassPulse(degree: number, t: number): void {
    const freq = midiToFreq(degreeToMidi(this.patch, degree, -1));
    this.playTone({ type: 'triangle', freq, startTime: t, attack: 0.02, sustainDur: this.secondsPerBar() * 0.2, release: 0.18, peak: 0.24 });
  }

  private scheduleKick(t: number, velocity = 1): void {
    // Pitch-swept sine "punch": starts high, drops fast.
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const g = this.ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(this.lowpass);
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const peak = 0.55 * velocity;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.start(t);
    osc.stop(t + 0.2);
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

  private scheduleSnare(t: number, velocity: number): void {
    this.playNoise({ startTime: t, attack: 0.001, sustainDur: 0.02, release: 0.08, peak: 0.28 * velocity, filterType: 'bandpass', filterFreq: 1900 });
    this.playTone({ type: 'triangle', freq: 180, startTime: t, attack: 0.001, sustainDur: 0.02, release: 0.06, peak: 0.22 * velocity });
  }

  private scheduleClosedHat(t: number, sixteenth: number): void {
    const peak = sixteenth % 4 === 0 ? 0.09 : 0.055;
    this.playNoise({ startTime: t, attack: 0.001, sustainDur: 0.008, release: 0.02, peak, filterType: 'highpass', filterFreq: 8500 });
  }

  private scheduleOpenHat(t: number): void {
    this.playNoise({ startTime: t, attack: 0.001, sustainDur: 0.03, release: 0.14, peak: 0.1, filterType: 'highpass', filterFreq: 7000 });
  }

  private scheduleCrash(t: number): void {
    this.playNoise({ startTime: t, attack: 0.002, sustainDur: 0.4, release: 0.9, peak: 0.22, filterType: 'highpass', filterFreq: 4500 });
  }

  private scheduleArpNote(degree: number, t: number): void {
    const freq = midiToFreq(degreeToMidi(this.patch, degree, 2));
    const noteDur = this.secondsPerSixteenth() * 0.6;
    this.playTone({ type: 'square', freq, startTime: t, attack: 0.003, sustainDur: noteDur, release: 0.05, peak: 0.09 });
  }

  private scheduleLeadNote(degree: number, durSixteenths: number, t: number): void {
    const patch = this.patch;
    const noteSeconds = durSixteenths * this.secondsPerSixteenth();
    const attack = 0.012;
    const release = Math.min(0.2, noteSeconds * 0.35);
    const sustainDur = Math.max(0.02, noteSeconds - attack - release);
    const freq = midiToFreq(degreeToMidi(patch, degree, 1));
    const glideFrom = this.lastLeadFreq > 0 ? this.lastLeadFreq : undefined;

    // "Brass": three detuned saws + light vibrato through a bright lowpass.
    const vibrato = this.ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 5.5;
    const vibratoGain = this.ctx.createGain();
    vibratoGain.gain.value = 4; // cents of depth -- light, not warbly
    vibrato.connect(vibratoGain);
    vibrato.start(t);
    vibrato.stop(t + attack + sustainDur + release + 0.05);

    const brightFilter = this.ctx.createBiquadFilter();
    brightFilter.type = 'lowpass';
    brightFilter.frequency.value = 4200;
    brightFilter.Q.value = 0.7;
    brightFilter.connect(this.lowpass);

    const detunes = [-8, 0, 8];
    detunes.forEach((det) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = det;
      vibratoGain.connect(osc.detune);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(brightFilter);
      if (glideFrom) {
        osc.frequency.setValueAtTime(glideFrom, t);
        osc.frequency.linearRampToValueAtTime(freq, t + Math.min(0.06, attack + 0.02));
      } else {
        osc.frequency.setValueAtTime(freq, t);
      }
      const peak = 0.2;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + attack + sustainDur);
      g.gain.linearRampToValueAtTime(0, t + attack + sustainDur + release);
      const stopAt = t + attack + sustainDur + release + 0.03;
      osc.start(t);
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
    });

    vibrato.onended = () => {
      this.activeNodes.delete(vibrato);
      try {
        vibratoGain.disconnect();
        brightFilter.disconnect();
      } catch {
        // ignore
      }
    };
    this.activeNodes.add(vibrato);

    // Octave-down double at low volume, battle/boss only -- adds weight.
    if (patch.drivingBass) {
      this.playTone({ type: 'sawtooth', freq: freq / 2, startTime: t, attack, sustainDur, release, peak: 0.09 });
    }

    this.lastLeadFreq = freq;
  }

  // ── Low-level voice helpers ─────────────────────────────────────────

  private playTone(opts: { type: OscillatorType; freq: number; detuneCents?: number; startTime: number; attack: number; sustainDur: number; release: number; peak: number }): void {
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    if (opts.detuneCents) osc.detune.value = opts.detuneCents;

    const g = this.ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(this.lowpass);

    const t0 = opts.startTime;
    osc.frequency.setValueAtTime(opts.freq, t0);

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

  private playNoise(opts: { startTime: number; attack: number; sustainDur: number; release: number; peak: number; filterType: BiquadFilterType; filterFreq: number }): void {
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
