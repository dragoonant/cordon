/**
 * CORDON audio module: voice, music, and SFX playback via Howler.
 *
 * Idempotent, safe to import in Node. All DOM/AudioContext access guarded.
 * Music and voice duck/fade automatically; SFX synthesized procedurally.
 */

// Check for browser environment (safe for vitest)
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

function isOperating(): boolean {
  return isBrowser && typeof (window as any).AudioContext !== 'undefined';
}

const getAudioContext = () => (isBrowser ? (window as any).AudioContext || (window as any).webkitAudioContext : null);

export interface VoiceManifest {
  version: number;
  pilots: Record<string, Record<string, string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

interface AudioState {
  voice: boolean;
  music: number;
  sfx: number;
}

let state: AudioState = { voice: false, music: 0, sfx: 0 };
let voiceManifest: VoiceManifest | null = null;
let voiceManifestFetchAttempted = false;
let currentVoiceHowl: any = null;
let currentMusicHowl: any = null;
let audioContext: AudioContext | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize or reset audio settings. Idempotent; safe to call multiple times.
 */
export function initAudio(settings: { voice: boolean; music: number; sfx: number }): void {
  state = { ...settings };
}

/**
 * Update partial audio settings.
 */
export function updateAudioSettings(partial: Partial<{ voice: boolean; music: number; sfx: number }>): void {
  state = { ...state, ...partial };

  // Apply volume updates to currently playing music if it exists
  if (currentMusicHowl && state.music !== undefined) {
    currentMusicHowl.volume(state.music);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice manifest loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load voice manifest from URL (default /audio/voice/manifest.json).
 * Cached after first successful load. On 404 or network error, returns null
 * and caches that null so we don't retry.
 */
export async function loadVoiceManifest(url = '/audio/voice/manifest.json'): Promise<VoiceManifest | null> {
  // Already attempted; return cached result (even if null)
  if (voiceManifestFetchAttempted) {
    return voiceManifest;
  }

  voiceManifestFetchAttempted = true;

  if (!isOperating()) {
    voiceManifest = null;
    return null;
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      voiceManifest = null;
      return null;
    }
    voiceManifest = await resp.json();
    return voiceManifest;
  } catch {
    voiceManifest = null;
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice playback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a voice line exists for a pilot in the manifest.
 */
export function hasVoice(pilotDefId: string, lineKey: string): boolean {
  if (!voiceManifest) return false;
  const pilotVoices = voiceManifest.pilots[pilotDefId];
  return pilotVoices ? lineKey in pilotVoices : false;
}

/**
 * Play a voice line for a pilot. Returns false if disabled or missing.
 * Stops any currently playing voice first. Resolves when playback starts.
 * Ducks music while playing.
 */
export async function playVoice(pilotDefId: string, lineKey: string): Promise<boolean> {
  if (!state.voice || !voiceManifest) {
    return false;
  }

  const pilotVoices = voiceManifest.pilots[pilotDefId];
  if (!pilotVoices || !pilotVoices[lineKey]) {
    return false;
  }

  if (!isOperating()) {
    return false;
  }

  // Stop any currently playing voice
  stopVoice();

  const voiceUrl = pilotVoices[lineKey];

  // Duck music while voice plays
  duckMusic(true);

  return new Promise((resolve) => {
    try {
      const Howl = (window as any).Howl;
      currentVoiceHowl = new Howl({
        src: [voiceUrl],
        html5: true,
        onend: () => {
          currentVoiceHowl = null;
          duckMusic(false);
        },
      });
      currentVoiceHowl.play();
      resolve(true);
    } catch {
      duckMusic(false);
      resolve(false);
    }
  });
}

/**
 * Stop any currently playing voice line.
 */
export function stopVoice(): void {
  if (currentVoiceHowl) {
    currentVoiceHowl.stop();
    currentVoiceHowl = null;
    duckMusic(false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SFX synthesis (procedural, no asset files)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synthesize and play a short SFX. Procedural generation via WebAudio;
 * respects sfx volume. No-op if AudioContext unavailable or SFX disabled.
 */
export function playSfx(name: 'ui_click' | 'ui_confirm' | 'ui_back' | 'hit' | 'crit' | 'miss' | 'explosion' | 'callout' | 'alert' | 'victory' | 'defeat'): void {
  if (!state.sfx || state.sfx === 0 || !isOperating()) {
    return;
  }

  // Lazily create AudioContext after first user gesture (try/catch handles failure)
  try {
    if (!audioContext) {
      const AudioCtx = getAudioContext();
      if (!AudioCtx) return;
      audioContext = new AudioCtx();
    }

    const ctx = audioContext;
    if (!ctx) return;
    const now = ctx.currentTime;

    // Define SFX by type: { freq, duration, attack, release }
    const specs: Record<string, { freq: number; dur: number; attack: number; release: number }> = {
      ui_click: { freq: 800, dur: 0.1, attack: 0.01, release: 0.05 },
      ui_confirm: { freq: 600, dur: 0.15, attack: 0.01, release: 0.1 },
      ui_back: { freq: 400, dur: 0.12, attack: 0.01, release: 0.08 },
      hit: { freq: 150, dur: 0.08, attack: 0.01, release: 0.05 },
      crit: { freq: 300, dur: 0.15, attack: 0.01, release: 0.1 },
      miss: { freq: 100, dur: 0.1, attack: 0.02, release: 0.06 },
      explosion: { freq: 80, dur: 0.3, attack: 0.02, release: 0.2 },
      callout: { freq: 550, dur: 0.2, attack: 0.01, release: 0.12 },
      alert: { freq: 700, dur: 0.2, attack: 0.01, release: 0.1 },
      victory: { freq: 800, dur: 0.4, attack: 0.02, release: 0.2 },
      defeat: { freq: 200, dur: 0.3, attack: 0.05, release: 0.2 },
    };

    const spec = specs[name];
    if (!spec) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = spec.freq;
    osc.connect(gain);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(state.sfx, now + spec.attack);
    gain.gain.linearRampToValueAtTime(0, now + spec.dur);

    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + spec.dur);
  } catch {
    // AudioContext not available or couldn't be created; silent no-op
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Music playback with crossfade
// ─────────────────────────────────────────────────────────────────────────────

// Track which music tracks have been checked for existence (and result)
const musicExists = new Map<string, boolean>();

/**
 * Check if a music track exists at public/audio/music/<track>.mp3 via HEAD fetch.
 * Result is cached.
 */
async function musicTrackExists(track: string): Promise<boolean> {
  if (musicExists.has(track)) {
    return musicExists.get(track)!;
  }

  if (!isOperating()) {
    musicExists.set(track, false);
    return false;
  }

  try {
    const url = `/audio/music/${track}.mp3`;
    const resp = await fetch(url, { method: 'HEAD' });
    const exists = resp.ok;
    musicExists.set(track, exists);
    return exists;
  } catch {
    musicExists.set(track, false);
    return false;
  }
}

/**
 * Play a looping music track with 800ms crossfade from current track.
 * Checks if track exists at public/audio/music/<track>.mp3; if not, no-op.
 * Never throws.
 */
export function playMusic(track: 'title' | 'map_space' | 'map_surface' | 'battle' | 'boss' | 'result'): void {
  // Fire the check asynchronously; don't block
  musicTrackExists(track).then((exists) => {
    if (!exists || !isOperating()) {
      return;
    }

    const url = `/audio/music/${track}.mp3`;
    const Howl = (window as any).Howl;

    if (!Howl) return;

    try {
      const newHowl = new Howl({
        src: [url],
        loop: true,
        volume: state.music,
        html5: true,
      });

      // Crossfade: fade out old track and fade in new one over 800ms
      const fadeDur = 0.8;

      if (currentMusicHowl) {
        currentMusicHowl.fade(currentMusicHowl.volume(), 0, fadeDur * 1000);
        setTimeout(() => {
          currentMusicHowl?.stop();
        }, fadeDur * 1000 + 50);
      }

      newHowl.play();
      newHowl.fade(0, state.music, fadeDur * 1000);

      currentMusicHowl = newHowl;
    } catch {
      // Howl not available or error creating; silent no-op
    }
  });
}

/**
 * Stop any currently playing music track.
 */
export function stopMusic(): void {
  if (currentMusicHowl) {
    currentMusicHowl.stop();
    currentMusicHowl = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Music ducking
// ─────────────────────────────────────────────────────────────────────────────

let isDucked = false;

/**
 * Duck (reduce) music volume by ~60% while voice plays or a cut-in occurs.
 */
export function duckMusic(on: boolean): void {
  if (!currentMusicHowl || !isOperating()) {
    isDucked = on;
    return;
  }

  isDucked = on;
  const targetVolume = on ? state.music * 0.4 : state.music;
  const fadeDur = 200; // 200ms fade

  currentMusicHowl.fade(currentMusicHowl.volume(), targetVolume, fadeDur);
}
